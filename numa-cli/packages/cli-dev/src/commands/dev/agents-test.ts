/**
 * `numa-dev agents test` — roundtrip self-test for the agents surface.
 *
 * Agents live in DynamoDB (no S3 fixture), so this is structurally close
 * to the memory test: exercise all the ops + verify side effects via a
 * subsequent list/get.
 *
 * Test sequence (10 steps):
 *   1.  List baseline                        count starting agents (owned scope)
 *   2.  Create personal agent                assert id format + scope=user
 *   3.  Get + verify created                 round-trips via get_agent
 *   4.  Update title + description           server returns new fields
 *   5.  Patch prompt (unique-match)          delta visible in returned prompt
 *   6.  Patch prompt with --replace-all      multi-replace works
 *   7.  Duplicate                            new agent with sourceAgentId set
 *   8.  List + verify both present           count = baseline + 2
 *   9.  Delete duplicate                     gone from list
 *   10. Delete original                      gone from list, back to baseline
 *
 * Cleanup is part of the test (steps 9 + 10). If a step fails mid-run we
 * still try to delete both agents so the user's library doesn't fill up
 * with `numa-cli-test-*` entries. --keep-artefacts skips the deletes and
 * the finally-cleanup so devs can inspect the agents.
 *
 * Workspace agents (visibility='public') are NOT covered here — they
 * pollute the tenant-wide list and need admin to clean up. Manual test
 * recipe lives in dev-notes if needed.
 */

import { Command } from 'commander';
import { getValidTokens } from '@numa/cli/auth';
import { activeProfile } from '@numa/cli/context';
import { resolveScopingContext, type ScopingContext } from '@numa/cli/context';
import { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from '@numa/cli/api';
import type { ParamsForTool, ToolName, ToolResult } from '@numa/cli/metadata';
import { fail, info } from '@numa/cli/output';

const CREATE_AGENT_TOOL = 'create_agent_tool';
const TEST_MARKER = 'numa-cli-test-';

// ── Step framework (mirrors memory-test) ──────────────────────────────────

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

/** Same logic as agents.ts — workspace narrows, local auto-injects. */
const resolveEnabledTools = (scope: ScopingContext): string[] => {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(CREATE_AGENT_TOOL) ? base : [...base, CREATE_AGENT_TOOL];
};

export function createAgentsTestCommand(): Command {
  return new Command('test')
    .description('Run a 10-step roundtrip self-test against the agents surface (cleans up)')
    .option('--keep-artefacts', 'Leave the test agents in place (skip the deletes + finally cleanup)')
    .action(async (options: { keepArtefacts?: boolean }) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const tokens = await getValidTokens(account);
      const scope = resolveScopingContext(account);
      const enabledTools = resolveEnabledTools(scope);

      const stamp = Date.now();
      const initialTitle = `${TEST_MARKER}${stamp}`;
      // Use a sentinel string in the prompt that we can find/replace in
      // step 5. Repeat it 3× so step 6 (replace-all) has multiple matches.
      // No trailing newline — the server `.strip()`s system_prompt during
      // _build_user_item so a trailing \n won't round-trip and the equality
      // checks below would fail. Test the actual stored shape.
      const sentinelUnique = `SENTINEL_UNIQUE_${stamp}`;
      const sentinelMulti = 'SENTINEL_MULTI';
      const initialPrompt =
        `You are a test agent created by 'numa-dev agents test'.\n\n` +
        `This is the original system prompt. Look for this token to verify patch: ${sentinelUnique}.\n\n` +
        `Here are two repeated tokens: ${sentinelMulti} and ${sentinelMulti} and ${sentinelMulti}.`;
      const updatedTitle = `${TEST_MARKER}${stamp}-updated`;
      const updatedDescription = 'Updated description by numa-dev test step 4.';
      const replacedUnique = `REPLACED_UNIQUE_${stamp}`;
      const replacedMulti = 'REPLACED_MULTI';

      info(`account: ${account}`);
      info(`scope source: ${scope.source}`);
      info(`enabled_tools: ${enabledTools.join(', ') || '(empty)'}`);
      info(`test title: ${initialTitle}`);
      info('');

      const invoke = async <T extends ToolName>(tool: T, params: ParamsForTool<T>): Promise<ToolInvokeResponse<T>> => {
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

      const TOTAL_STEPS = options.keepArtefacts ? 8 : 10;
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

      let baselineCount = 0;
      let createdAgentId: string | undefined;
      let duplicateAgentId: string | undefined;

      try {
        // 1. Baseline.
        await step('list baseline (owned)', async () => {
          const res = await invoke('list_agents', { scope: 'owned' });
          const r = expectOk(res, 'list-baseline');
          baselineCount = r.agents.length;
          if (process.env['NUMA_DEBUG']) info(`baseline: ${baselineCount} owned agents`);
        });

        // 2. Create.
        await step('create personal agent', async () => {
          const res = await invoke('create_agent', {
            title: initialTitle,
            systemPrompt: initialPrompt,
            visibility: 'personal',
            agentType: 'task',
            description: 'Created by numa-dev agents test — safe to delete.',
            auto_approved: true,
          });
          const r = expectOk(res, 'create');
          if (!r.agent?.agentId?.startsWith('agt_')) {
            throw new Error(`create returned malformed agentId: ${r.agent?.agentId}`);
          }
          if (r.agent.scope !== 'user') {
            throw new Error(`expected scope=user, got '${r.agent.scope}'`);
          }
          if (r.agent.title !== initialTitle) {
            throw new Error(`title mismatch: got '${r.agent.title}'`);
          }
          createdAgentId = r.agent.agentId;
        });

        // 3. Get + verify.
        await step('get + verify created', async () => {
          if (!createdAgentId) throw new Error('no createdAgentId');
          const res = await invoke('get_agent', { agent_id: createdAgentId });
          const r = expectOk(res, 'get');
          if (r.agent.agentId !== createdAgentId) {
            throw new Error(`get returned wrong id: ${r.agent.agentId}`);
          }
          if (r.agent.systemPrompt !== initialPrompt) {
            throw new Error('systemPrompt did not round-trip through DDB');
          }
        });

        // 4. Update title + description.
        await step('update title + description', async () => {
          if (!createdAgentId) throw new Error('no createdAgentId');
          const res = await invoke('update_agent', {
            agent_id: createdAgentId,
            title: updatedTitle,
            description: updatedDescription,
            auto_approved: true,
          });
          const r = expectOk(res, 'update');
          if (r.agent.title !== updatedTitle) {
            throw new Error(`update returned stale title: '${r.agent.title}'`);
          }
          if (r.agent.description !== updatedDescription) {
            throw new Error(`update returned stale description: '${r.agent.description}'`);
          }
          // System prompt should be unchanged (we didn't pass it).
          if (r.agent.systemPrompt !== initialPrompt) {
            throw new Error('update wiped systemPrompt — should only change passed fields');
          }
        });

        // 5. Patch prompt (unique match).
        await step('patch-prompt (unique match)', async () => {
          if (!createdAgentId) throw new Error('no createdAgentId');
          const res = await invoke('patch_agent_prompt', {
            agent_id: createdAgentId,
            old_text: sentinelUnique,
            new_text: replacedUnique,
            auto_approved: true,
          });
          const r = expectOk(res, 'patch-unique');
          if (!r.agent.systemPrompt?.includes(replacedUnique)) {
            throw new Error('patch unique: replacement not in prompt');
          }
          if (r.agent.systemPrompt.includes(sentinelUnique)) {
            throw new Error('patch unique: original sentinel still present');
          }
        });

        // 6. Patch prompt (replace-all).
        await step('patch-prompt (replace-all)', async () => {
          if (!createdAgentId) throw new Error('no createdAgentId');
          const res = await invoke('patch_agent_prompt', {
            agent_id: createdAgentId,
            old_text: sentinelMulti,
            new_text: replacedMulti,
            replace_all: true,
            auto_approved: true,
          });
          const r = expectOk(res, 'patch-all');
          if (r.agent.systemPrompt?.includes(sentinelMulti)) {
            throw new Error('patch replace-all: original sentinel still present');
          }
          // Should have 3 instances of the replacement.
          const count = (r.agent.systemPrompt?.match(new RegExp(replacedMulti, 'g')) ?? []).length;
          if (count !== 3) {
            throw new Error(`patch replace-all: expected 3 replacements, got ${count}`);
          }
        });

        // 7. Duplicate.
        await step('duplicate', async () => {
          if (!createdAgentId) throw new Error('no createdAgentId');
          const res = await invoke('duplicate_agent', { agent_id: createdAgentId, auto_approved: true });
          const r = expectOk(res, 'duplicate');
          if (!r.agent?.agentId?.startsWith('agt_')) {
            throw new Error(`duplicate returned malformed agentId: ${r.agent?.agentId}`);
          }
          if (r.agent.agentId === createdAgentId) {
            throw new Error('duplicate returned the source id, not a new one');
          }
          if (r.agent.sourceAgentId !== createdAgentId) {
            throw new Error(`duplicate did not set sourceAgentId: got '${r.agent.sourceAgentId}'`);
          }
          if (r.agent.scope !== 'user') {
            throw new Error(`duplicate landed in non-user scope: ${r.agent.scope}`);
          }
          duplicateAgentId = r.agent.agentId;
        });

        // 8. List + verify both present.
        await step('list + verify both present', async () => {
          const res = await invoke('list_agents', { scope: 'owned' });
          const r = expectOk(res, 'list-after-dup');
          if (r.agents.length !== baselineCount + 2) {
            throw new Error(`expected ${baselineCount + 2} agents after dup, got ${r.agents.length}`);
          }
          if (!r.agents.some((a) => a.agentId === createdAgentId)) {
            throw new Error(`original ${createdAgentId} missing from list`);
          }
          if (!r.agents.some((a) => a.agentId === duplicateAgentId)) {
            throw new Error(`duplicate ${duplicateAgentId} missing from list`);
          }
        });

        // 9 + 10. Delete (skipped under --keep-artefacts).
        if (!options.keepArtefacts) {
          await step('delete duplicate', async () => {
            if (!duplicateAgentId) throw new Error('no duplicateAgentId');
            const res = await invoke('delete_agent', { agent_id: duplicateAgentId, auto_approved: true });
            const r = expectOk(res, 'delete-dup');
            if (r.agent.agentId !== duplicateAgentId) {
              throw new Error(`delete echoed wrong id: ${r.agent.agentId}`);
            }
            duplicateAgentId = undefined; // mark cleaned-up
          });

          await step('delete original + verify baseline', async () => {
            if (!createdAgentId) throw new Error('no createdAgentId');
            const res = await invoke('delete_agent', { agent_id: createdAgentId, auto_approved: true });
            const r = expectOk(res, 'delete-orig');
            if (r.agent.agentId !== createdAgentId) {
              throw new Error(`delete echoed wrong id: ${r.agent.agentId}`);
            }
            createdAgentId = undefined;
            // Final list — should be back to baseline.
            const listRes = await invoke('list_agents', { scope: 'owned' });
            const listed = expectOk(listRes, 'list-after-deletes');
            if (listed.agents.length !== baselineCount) {
              throw new Error(`expected baseline ${baselineCount}, got ${listed.agents.length}`);
            }
          });
        }
      } finally {
        // Best-effort cleanup if a step failed mid-run (and not --keep-artefacts).
        if (!options.keepArtefacts) {
          for (const [id, label] of [
            [duplicateAgentId, 'duplicate'],
            [createdAgentId, 'original'],
          ] as const) {
            if (!id) continue;
            try {
              await invoke('delete_agent', { agent_id: id, auto_approved: true });
              info(`cleanup: deleted leftover ${label} agent ${id}`);
            } catch (err) {
              info(`cleanup: failed to delete ${label} ${id}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } else if (createdAgentId || duplicateAgentId) {
          info(
            `--keep-artefacts: left agents in place${createdAgentId ? ` original=${createdAgentId}` : ''}${duplicateAgentId ? ` duplicate=${duplicateAgentId}` : ''}`
          );
        }
      }

      info('');
      const passed = results.filter((r) => r.ok).length;
      const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
      const summary = `${passed}/${results.length} steps passed in ${fmtDuration(totalMs)}`;
      if (passed === results.length) {
        info(`✓ agents test passed — ${summary}`);
        process.exit(0);
      } else {
        info(`✗ agents test failed — ${summary}`);
        process.exit(1);
      }
    });
}
