/**
 * `numa-dev web test` — roundtrip self-test for the web surface.
 *
 * Web search hits the public internet (DDG → Startpage → Yahoo → Google
 * failover), and fetch_url hits a single URL via the browser Lambda. Both
 * are nondeterministic (results vary by time of day; rate limits vary by
 * source IP), so the test asserts shape + non-emptiness rather than
 * specific result content.
 *
 * Test sequence (4 steps):
 *   1. search "arcanum ai"             results array shape + length ≥ 1
 *   2. search with --max + --intent    max_results echoes back, count ≤ max
 *   3. fetch a stable URL              content is non-empty
 *   4. search with --summarise         summarised_content is populated
 *
 * Steps 3 + 4 are skippable via --quick (skips anything that goes through
 * the heavier paths — page scrape, LLM summary) so devs running this in
 * a tight inner loop don't pay 10-30s per run.
 *
 * No cleanup needed — web search has no side effects.
 */

import { Command } from 'commander';
import { getValidTokens } from '@numa/cli/auth';
import { activeProfile } from '@numa/cli/context';
import { resolveScopingContext, type ScopingContext } from '@numa/cli/context';
import { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from '@numa/cli/api';
import type { ParamsForTool } from '@numa/cli/metadata';
import { fail, info } from '@numa/cli/output';

const WEB_SEARCH_TOOL = 'web_search';
// Stable URL with predictable text content — arcanum.ai's homepage is
// safer than something like example.com (which the browser Lambda might
// strip to nothing) and is on-brand for a Numa test fixture.
const FETCH_TEST_URL = 'https://www.arcanum.ai/';

// ── Step framework (mirrors files/agents/memory/docs tests) ───────────────

interface StepResult {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

const now = (): number => Date.now();
const fmtDuration = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const writeStep = (idx: number, total: number, name: string): void => {
  process.stderr.write(`[${idx}/${total}] ${name} ... `);
};
const writeResult = (r: StepResult): void => {
  if (r.ok) process.stderr.write(`ok (${fmtDuration(r.durationMs)})\n`);
  else process.stderr.write(`FAIL (${fmtDuration(r.durationMs)})\n   ${r.error}\n`);
};
const runStep = async (name: string, fn: () => Promise<void>): Promise<StepResult> => {
  const start = now();
  try {
    await fn();
    return { name, ok: true, durationMs: now() - start };
  } catch (err) {
    return { name, ok: false, durationMs: now() - start, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Mirror agents/memory pattern — workspace narrows, local auto-injects. */
const resolveEnabledTools = (scope: ScopingContext): string[] => {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(WEB_SEARCH_TOOL) ? base : [...base, WEB_SEARCH_TOOL];
};

export function createWebTestCommand(): Command {
  return new Command('test')
    .description('Run a roundtrip self-test against the web surface (no cleanup needed)')
    .option('--quick', 'Skip the slower steps (page fetch + LLM summarisation)')
    .action(async (options: { quick?: boolean }) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const tokens = await getValidTokens(account);
      const scope = resolveScopingContext(account);
      const enabledTools = resolveEnabledTools(scope);

      info(`account: ${account}`);
      info(`scope source: ${scope.source}`);
      info(`enabled_tools: ${enabledTools.join(', ') || '(empty)'}`);
      info('');

      const invoke = async (params: ParamsForTool<'web_search'>): Promise<ToolInvokeResponse<'web_search'>> => {
        const request: ToolInvokeRequest<'web_search'> = {
          tool: 'web_search',
          params,
          context: {
            allowed_kbs: scope.allowed_kbs,
            allowed_kb_operations: scope.allowed_kb_operations,
            enabled_tools: enabledTools,
            conversation_id: scope.conversation_id || undefined,
          },
          id_token: tokens.idToken,
        };
        return invokeTool<'web_search'>(account, tokens.accessToken, request);
      };

      const TOTAL_STEPS = options.quick ? 2 : 4;
      const results: StepResult[] = [];
      let stepIdx = 0;
      const step = async (name: string, fn: () => Promise<void>): Promise<StepResult> => {
        stepIdx += 1;
        writeStep(stepIdx, TOTAL_STEPS, name);
        const r = await runStep(name, fn);
        writeResult(r);
        results.push(r);
        return r;
      };

      // 1. Basic search.
      await step('search "arcanum ai"', async () => {
        const res = await invoke({ operation: 'search', query: 'arcanum ai' });
        if (res.status === 'error') throw new Error(res.error ?? 'no error message');
        const result = res.result;
        if (!result || !Array.isArray(result.results)) {
          throw new Error(`expected result.results array, got ${JSON.stringify(result).slice(0, 200)}`);
        }
        if (result.results.length === 0) {
          // Could be a transient engine outage — surface clearly rather
          // than asserting hard, but still fail the step so the user
          // notices.
          throw new Error(`search returned 0 results (likely engine failover exhausted — try again)`);
        }
        // Spot-check shape of first result.
        const first = result.results[0];
        if (!first || typeof first.title !== 'string' || typeof first.url !== 'string') {
          throw new Error(`malformed result item: ${JSON.stringify(first).slice(0, 200)}`);
        }
      });

      // 2. Bounded search w/ --max. Intentionally NOT passing
      // user_intent — the server flips to the legacy summary pipeline
      // when intent is present (even with summarise=false), which would
      // return summarised_content instead of a results array. The CLI
      // mirrors this by only forwarding intent when summarise is set.
      await step('search with --max 3', async () => {
        const res = await invoke({
          operation: 'search',
          query: 'aws bedrock agentcore',
          max_results: 3,
        });
        if (res.status === 'error') throw new Error(res.error ?? 'no error message');
        const result = res.result;
        if (!result || !Array.isArray(result.results)) {
          throw new Error(
            `expected result.results array (default search path), got keys=${Object.keys(result ?? {}).join(',')}`
          );
        }
        // Server caps at max_results — should not exceed what we asked for.
        if (result.results.length > 3) {
          throw new Error(`expected ≤ 3 results, got ${result.results.length}`);
        }
      });

      if (!options.quick) {
        // 3. Fetch a stable page.
        await step(`fetch ${FETCH_TEST_URL}`, async () => {
          const res = await invoke({ operation: 'fetch_url', url: FETCH_TEST_URL });
          if (res.status === 'error') throw new Error(res.error ?? 'no error message');
          const result = res.result;
          if (!result || typeof result.content !== 'string') {
            throw new Error(`expected result.content string, got ${typeof result?.content}`);
          }
          if (result.content.length < 100) {
            throw new Error(`content suspiciously short: ${result.content.length} chars`);
          }
        });

        // 4. Search + summarise. This exercises the LLM-summarisation
        // branch which is the slowest path (~15-30s end-to-end). Keeps
        // the test honest: --quick skips it for fast iteration.
        await step('search with --summarise', async () => {
          const res = await invoke({
            operation: 'search',
            query: 'what is claude code',
            max_results: 3,
            summarise: true,
            user_intent: 'verify summarisation populates summarised_content',
          });
          if (res.status === 'error') throw new Error(res.error ?? 'no error message');
          const result = res.result;
          // Summary may be empty if the LLM call fails or all snippets
          // were too thin — but it should at least be a string.
          if (typeof result?.summarised_content !== 'string') {
            throw new Error(
              `expected summarised_content string, got ${typeof result?.summarised_content}. ` +
                `Result keys: ${Object.keys(result ?? {}).join(', ')}`
            );
          }
          if (result.summarised_content.length === 0) {
            throw new Error('summarised_content was empty — summariser likely failed');
          }
        });
      }

      info('');
      const passed = results.filter((r) => r.ok).length;
      const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
      const summary = `${passed}/${results.length} steps passed in ${fmtDuration(totalMs)}`;
      if (passed === results.length) {
        info(`✓ web test passed — ${summary}`);
        process.exit(0);
      } else {
        info(`✗ web test failed — ${summary}`);
        process.exit(1);
      }
    });
}
