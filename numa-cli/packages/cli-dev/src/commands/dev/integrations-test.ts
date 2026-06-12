/**
 * `numa-dev integrations test` — roundtrip self-test for the integrations
 * surface.
 *
 * Tests against the user's actually-enabled integrations (read from the
 * resolved scope) rather than a fixed slug, since which integrations are
 * enabled varies per account. Picks the first Pipedream slug for the
 * Pipedream-shape tests; picks the first native slug (if any) for the
 * `request` routing test.
 *
 * Test sequence (variable based on what's enabled):
 *   1. list shape                          enabled_integrations list resolves
 *   2. docs <pipedream-slug>               returns index (workspace OR API)
 *   3. search "send"                       finds matching actions
 *   4. pipedream-actions <slug>            returns action list ≥ 1
 *   5. pipedream-props <slug> <action>     returns action schema
 *   6. method-mismatch error               pipedream-call against a native slug
 *                                          errors with the expected message
 *                                          (only when a native slug exists)
 *
 * Deliberately does NOT exercise pipedream-call or request — those have
 * real side effects (sends emails, creates records, hits external APIs)
 * and there's no safe "noop" action universally available. Manual test
 * recipe: `numa integrations pipedream-call <slug> <action> --props '{}'`
 * with --description set to make the approval card meaningful.
 *
 * No cleanup needed — all tested ops are read-only.
 */

import { Command } from 'commander';
import { execSync } from 'node:child_process';

import { getValidTokens } from '@numa/cli/auth';
import { activeProfile } from '@numa/cli/context';
import { resolveScopingContext } from '@numa/cli/context';
import { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from '@numa/cli/api';
import type { ParamsForTool, ToolName, ToolResult } from '@numa/cli/metadata';
import { fail, info } from '@numa/cli/output';

// ── Step framework (mirrors files/agents/memory/docs tests) ───────────────

interface StepResult {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  skipped?: boolean;
}

const now = (): number => Date.now();
const fmtDuration = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const writeStep = (idx: number, total: number, name: string): void => {
  process.stderr.write(`[${idx}/${total}] ${name} ... `);
};
const writeResult = (r: StepResult): void => {
  if (r.skipped) process.stderr.write(`skipped (${r.error ?? 'no reason'})\n`);
  else if (r.ok) process.stderr.write(`ok (${fmtDuration(r.durationMs)})\n`);
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

export function createIntegrationsTestCommand(): Command {
  return new Command('test')
    .description('Roundtrip self-test for integrations (read-only ops; uses your actual enabled integrations)')
    .action(async () => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const tokens = await getValidTokens(account);
      const scope = resolveScopingContext(account);

      const pipedreamSlugs = scope.enabled_integrations.filter((i) => i.method === 'pipedream').map((i) => i.slug);
      const nativeSlugs = scope.enabled_integrations.filter((i) => i.method === 'native').map((i) => i.slug);
      const probeSlug = pipedreamSlugs[0];
      const nativeSlug = nativeSlugs[0];

      info(`account: ${account}`);
      info(`scope source: ${scope.source}`);
      info(`enabled (pipedream): ${pipedreamSlugs.join(', ') || '(none)'}`);
      info(`enabled (native):    ${nativeSlugs.join(', ') || '(none)'}`);
      info(`probe slug:          ${probeSlug ?? '(none — pipedream tests will skip)'}`);
      info('');

      if (!probeSlug) {
        fail(
          'no pipedream integrations enabled — most tests need at least one. ' +
            'Connect an integration in your chat settings and retry.'
        );
      }

      const invoke = async <T extends ToolName>(
        tool: T,
        params: ParamsForTool<T>,
        toolSlug?: string
      ): Promise<ToolInvokeResponse<T>> => {
        const enabledTools =
          toolSlug && scope.source !== 'workspace-env'
            ? [...(scope.enabled_tools ?? []), toolSlug]
            : scope.enabled_tools;
        const request: ToolInvokeRequest<T> = {
          tool,
          params,
          context: {
            allowed_kbs: scope.allowed_kbs,
            allowed_kb_operations: scope.allowed_kb_operations,
            enabled_tools: enabledTools,
            conversation_id: scope.conversation_id || undefined,
          },
          id_token: tokens.idToken,
        };
        return invokeTool<T>(account, tokens.accessToken, request);
      };

      const expectOk = <T extends ToolName>(res: ToolInvokeResponse<T>, label: string): ToolResult<T> => {
        if (res.status === 'error') throw new Error(`${label}: ${res.error ?? '<no message>'}`);
        return res.result as ToolResult<T>;
      };

      const hasGmail = pipedreamSlugs.includes('gmail');
      // 5 base + 1 props-options (gmail) + 2 ad-hoc ergonomic (gmail-only,
      // shell-based) + 1 method-mismatch (native). Adjusts as gmail/native
      // presence varies.
      const TOTAL_STEPS = 5 + (hasGmail ? 3 : 0) + (nativeSlug ? 1 : 0);
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

      let firstActionKey: string | undefined;

      // 1. List shape — already loaded; just sanity-check.
      await step('list shape', async () => {
        if (scope.enabled_integrations.length === 0) {
          throw new Error('enabled_integrations is empty');
        }
        for (const i of scope.enabled_integrations) {
          if (i.method !== 'pipedream' && i.method !== 'native') {
            throw new Error(`invalid method '${i.method}' on slug '${i.slug}'`);
          }
        }
      });

      // 2. Docs for the probe slug. In-workspace reads from /workdir/;
      // locally hits the API. Either way we want a non-empty result.
      await step(`docs ${probeSlug}`, async () => {
        // Don't go through the CLI command (would dump to stdout). Hit
        // the underlying API the command would call, with the same code
        // path the LLM gets — pipedream_list_actions.
        const res = await invoke('pipedream_list_actions', { app_slug: probeSlug }, probeSlug);
        const result = expectOk(res, 'docs');
        if (!Array.isArray(result.actions) || result.actions.length === 0) {
          throw new Error(`${probeSlug} returned 0 actions`);
        }
        firstActionKey = result.actions[0]!.key;
      });

      // 3. Search — query is the first word of the first action's key,
      // which guarantees a match (and exercises the same fuzzy logic
      // the `search` command uses, just inlined here).
      await step('search probe-action prefix', async () => {
        if (!firstActionKey) throw new Error('no action key from step 2');
        // First action key is e.g. `gmail-send-email`; grab `send` as
        // the query. Falls back to `email` if no hyphens. Either should
        // match at least the action it came from.
        const parts = firstActionKey.split('-');
        const query = parts.length > 2 ? parts[1]! : parts[0]!;
        if (process.env['NUMA_DEBUG']) info(`search query: '${query}'`);
        const res = await invoke('pipedream_list_actions', { app_slug: probeSlug }, probeSlug);
        const result = expectOk(res, 'search');
        const matches = (result.actions ?? []).filter((a) =>
          (a.name + ' ' + (a.description ?? '')).toLowerCase().includes(query.toLowerCase())
        );
        if (matches.length === 0) {
          throw new Error(`'${query}' matched 0 actions in ${probeSlug}`);
        }
      });

      // 4. pipedream-actions — same call as docs above, but a different
      // test point: verifies the per-action shape (key + name + props).
      await step(`pipedream-actions ${probeSlug}`, async () => {
        const res = await invoke('pipedream_list_actions', { app_slug: probeSlug }, probeSlug);
        const result = expectOk(res, 'actions');
        const a = result.actions?.[0];
        if (!a?.key || !a?.name) {
          throw new Error(`malformed action entry: ${JSON.stringify(a).slice(0, 200)}`);
        }
      });

      // 5. pipedream-props — single-action schema. Same fetch path.
      await step(`pipedream-props ${probeSlug} ${firstActionKey}`, async () => {
        if (!firstActionKey) throw new Error('no action key from step 2');
        const res = await invoke('pipedream_list_actions', { app_slug: probeSlug }, probeSlug);
        const result = expectOk(res, 'props');
        const found = (result.actions ?? []).find((a) => a.key === firstActionKey);
        if (!found) {
          throw new Error(`action '${firstActionKey}' missing from list_actions response`);
        }
      });

      // 6 (conditional, gmail-only). pipedream-props-options dynamic dropdown
      // resolution. Tests that the relay's `configure_props` round-trip works.
      // We target `gmail-send-email` × `fromEmail` because:
      //   - The action is universally available on any Gmail connection
      //   - `fromEmail` is a dynamic dropdown (stringOptions shape)
      //   - It always returns at least the primary email address (assertion safe)
      // Skips when gmail isn't enabled — no other universally-safe combo
      // exists across the dozen-odd integrations we typically test against.
      if (hasGmail) {
        await step('pipedream-props-options gmail/send-email/fromEmail', async () => {
          const res = await invoke(
            'pipedream_configure_props',
            {
              action_key: 'gmail-send-email',
              prop_name: 'fromEmail',
              configured_props: { gmail: { authProvisionId: 'auto' } },
            },
            'gmail'
          );
          const result = expectOk(res, 'props-options');
          const opts = result.stringOptions ?? result.options ?? [];
          if (!Array.isArray(opts) || opts.length === 0) {
            throw new Error(`expected at least one option, got: ${JSON.stringify(result).slice(0, 300)}`);
          }
        });

        // 7-8 (gmail only): exercise the CLI ad-hoc flag layer end-to-end
        // via execSync. Existing invoke()-based steps cover server
        // behaviour; these cover the commander layer (variadic args +
        // splitExtraArgs + merge into the JSON-blob param). Both halves
        // matter — neither catches the other's regressions.
        await step('CLI ad-hoc flag: pipedream-call --gmail <json> (read-only action)', async () => {
          let output = '';
          try {
            output = execSync(
              `numa integrations pipedream-call gmail gmail-get-current-user ` +
                `--gmail '{"authProvisionId":"auto"}' --user-message 'self-test' --yes --json 2>&1`,
              { encoding: 'utf-8' }
            );
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
            throw new Error(
              `CLI invocation failed (exit ${e.status ?? '?'}): stderr='${e.stderr ?? ''}' stdout='${e.stdout ?? ''}' msg='${e.message ?? String(err)}'`
            );
          }
          const parsed = JSON.parse(output) as {
            status?: string;
            result?: { ret?: { emailAddress?: string } };
          };
          if (parsed.status !== 'success') {
            throw new Error(`expected status=success, got ${parsed.status}: ${output.slice(0, 300)}`);
          }
          if (!parsed.result?.ret?.emailAddress) {
            throw new Error(`gmail-get-current-user via ad-hoc returned no emailAddress`);
          }
        });

        await step('CLI ad-hoc flag: pipedream-props-options --gmail <json>', async () => {
          let output = '';
          try {
            output = execSync(
              `numa integrations pipedream-props-options gmail gmail-send-email fromEmail ` +
                `--gmail '{"authProvisionId":"auto"}' --user-message 'self-test' --json 2>&1`,
              { encoding: 'utf-8' }
            );
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
            throw new Error(
              `CLI invocation failed (exit ${e.status ?? '?'}): stderr='${e.stderr ?? ''}' stdout='${e.stdout ?? ''}' msg='${e.message ?? String(err)}'`
            );
          }
          const parsed = JSON.parse(output) as { stringOptions?: string[]; options?: unknown[] };
          const opts = parsed.stringOptions ?? parsed.options ?? [];
          if (!Array.isArray(opts) || opts.length === 0) {
            throw new Error(`props-options via ad-hoc returned 0 options: ${output.slice(0, 200)}`);
          }
        });
      }

      // 9. Method-mismatch error (only when a native slug is also enabled).
      // Calls `pipedream-call <native-slug> ...` directly via Bash and
      // asserts the CLI rejects with the expected message. Bash because
      // we want the actual CLI behaviour (including fail()), not an
      // imported helper.
      if (nativeSlug) {
        await step(`method-mismatch rejects pipedream-call on ${nativeSlug}`, async () => {
          let output = '';
          let exitCode = 0;
          try {
            output = execSync(
              `numa integrations pipedream-call ${nativeSlug} fake-action ` +
                `--props '{}' --user-message 'should fail' --yes 2>&1`,
              { encoding: 'utf-8' }
            );
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string; status?: number };
            output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
            exitCode = e.status ?? 1;
          }
          if (exitCode === 0) {
            throw new Error('expected non-zero exit, got 0');
          }
          if (!output.toLowerCase().includes('native integration method')) {
            throw new Error(`expected method-mismatch error, got: ${output.slice(0, 300)}`);
          }
        });
      }

      info('');
      const passed = results.filter((r) => r.ok).length;
      const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
      const summary = `${passed}/${results.length} steps passed in ${fmtDuration(totalMs)}`;
      if (passed === results.length) {
        info(`✓ integrations test passed — ${summary}`);
        if (!hasGmail) {
          info('  (props-options test skipped — gmail not enabled)');
        }
        if (!nativeSlug) {
          info('  (method-mismatch test skipped — no native integrations connected)');
        }
        process.exit(0);
      } else {
        info(`✗ integrations test failed — ${summary}`);
        process.exit(1);
      }
    });
}
