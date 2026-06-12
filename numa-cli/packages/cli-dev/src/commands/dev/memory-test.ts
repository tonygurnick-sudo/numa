/**
 * `numa-dev memory test` — roundtrip self-test for the memories surface.
 *
 * Memories live on the user's chat-settings profile, not in S3, so this
 * is the simplest of the three self-tests — no fixture staging, no
 * dev-context conversation override. Just exercise all four ops and
 * verify each one's side-effects via a subsequent list.
 *
 * Test sequence (5 steps):
 *   1. List baseline                     count starting memories so we can verify deltas
 *   2. Add a memory                      assert id format + total_count += 1
 *   3. List + verify added               read it back through list_memories
 *   4. Update content + verify           update + re-list, check content changed
 *   5. Delete + verify gone              delete + re-list, check id absent
 *
 * Cleanup is part of the test (step 5). If a step fails mid-run we still
 * try to delete the test memory so the user's profile doesn't accumulate
 * `numa-cli-test-*` entries. --keep-artefacts skips both step 5 and the
 * finally-cleanup so devs can inspect the persisted memory.
 */

import { Command } from 'commander';
import { getValidTokens } from '@numa/cli/auth';
import { activeProfile } from '@numa/cli/context';
import { resolveScopingContext, type ScopingContext } from '@numa/cli/context';
import { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from '@numa/cli/api';
import type { ParamsForTool, ToolName, ToolResult } from '@numa/cli/metadata';
import { fail, info } from '@numa/cli/output';

const MEMORIES_TOOL = 'memories_tool';
const TEST_MARKER = 'numa-cli-test-';

// ── Step framework (mirrors files-test / docs-test) ───────────────────────

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

/**
 * Mirror of memory.ts's resolveEnabledTools — same logic: respect
 * workspace-env list, auto-inject `memories_tool` locally. Kept inline
 * rather than exported because it's two lines and the test should
 * exercise the same effective behaviour rather than depend on the
 * command's internals.
 */
const resolveEnabledTools = (scope: ScopingContext): string[] => {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(MEMORIES_TOOL) ? base : [...base, MEMORIES_TOOL];
};

export function createMemoryTestCommand(): Command {
  return new Command('test')
    .description('Run a roundtrip self-test against the memory surface (cleans up after itself)')
    .option('--keep-artefacts', 'Leave the test memory in place (skips delete + finally cleanup)')
    .action(async (options: { keepArtefacts?: boolean }) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const tokens = await getValidTokens(account);
      const scope = resolveScopingContext(account);
      const enabledTools = resolveEnabledTools(scope);

      const stamp = Date.now();
      const initialContent = `${TEST_MARKER}initial-${stamp} — created by 'numa-dev memory test', safe to delete.`;
      const updatedContent = `${TEST_MARKER}updated-${stamp} — content has been replaced via update step.`;
      const testScope = 'general';

      info(`account: ${account}`);
      info(`scope source: ${scope.source}`);
      info(`enabled_tools: ${enabledTools.join(', ') || '(empty)'}`);
      info('');

      // Generic invoke helper — narrows params + result types from the
      // tool literal, matches files-test pattern.
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

      const TOTAL_STEPS = options.keepArtefacts ? 4 : 5;
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

      // State carried between steps.
      let baselineCount = 0;
      let createdMemoryId: string | undefined;

      try {
        // 1. List baseline.
        await step('list baseline', async () => {
          const res = await invoke('user_profile_list_memories', {});
          const result = expectOk(res, 'list');
          baselineCount = result.total_count;
          if (process.env['NUMA_DEBUG']) info(`baseline: ${baselineCount} memories`);
        });

        // 2. Add a memory.
        await step('add memory', async () => {
          const res = await invoke('user_profile_add_memory', {
            content: initialContent,
            scope: testScope,
            auto_approved: true,
          });
          const result = expectOk(res, 'add');
          if (!result.memory?.id?.startsWith('mem_')) {
            throw new Error(`add returned malformed memory id: ${result.memory?.id}`);
          }
          if (result.total_count !== baselineCount + 1) {
            throw new Error(`expected total_count ${baselineCount + 1}, got ${result.total_count}`);
          }
          createdMemoryId = result.memory.id;
        });

        // 3. List + verify present.
        await step('list + verify added', async () => {
          if (!createdMemoryId) throw new Error('no createdMemoryId to verify');
          const res = await invoke('user_profile_list_memories', {});
          const result = expectOk(res, 'list');
          const found = result.memories.find((m) => m.id === createdMemoryId);
          if (!found) {
            throw new Error(`memory ${createdMemoryId} not in list (${result.memories.length} total)`);
          }
          if (found.content !== initialContent) {
            throw new Error(`memory content mismatch after add — got '${found.content.slice(0, 60)}…'`);
          }
        });

        // 4. Update + verify content changed.
        await step('update + verify content', async () => {
          if (!createdMemoryId) throw new Error('no createdMemoryId to update');
          const updateRes = await invoke('user_profile_update_memory', {
            memory_id: createdMemoryId,
            content: updatedContent,
            auto_approved: true,
          });
          const updated = expectOk(updateRes, 'update');
          if (updated.memory.content !== updatedContent) {
            throw new Error(`update returned stale content: ${updated.memory.content.slice(0, 60)}…`);
          }
          // Read back via list to confirm DDB write landed (vs handler
          // returning an in-memory transformation that didn't persist).
          const listRes = await invoke('user_profile_list_memories', {});
          const listed = expectOk(listRes, 'list-after-update');
          const found = listed.memories.find((m) => m.id === createdMemoryId);
          if (!found) throw new Error(`memory ${createdMemoryId} disappeared after update`);
          if (found.content !== updatedContent) {
            throw new Error(`DDB still has old content after update — got '${found.content.slice(0, 60)}…'`);
          }
        });

        // 5. Delete + verify gone. Skipped under --keep-artefacts so the
        // memory persists for manual inspection.
        if (!options.keepArtefacts) {
          await step('delete + verify gone', async () => {
            if (!createdMemoryId) throw new Error('no createdMemoryId to delete');
            const delRes = await invoke('user_profile_delete_memory', {
              memory_id: createdMemoryId,
              auto_approved: true,
            });
            const deleted = expectOk(delRes, 'delete');
            if (deleted.memory.id !== createdMemoryId) {
              throw new Error(`delete echoed different id: ${deleted.memory.id}`);
            }
            if (deleted.total_count !== baselineCount) {
              throw new Error(`expected total_count back to ${baselineCount}, got ${deleted.total_count}`);
            }
            // Confirm via list.
            const listRes = await invoke('user_profile_list_memories', {});
            const listed = expectOk(listRes, 'list-after-delete');
            if (listed.memories.some((m) => m.id === createdMemoryId)) {
              throw new Error(`memory ${createdMemoryId} still present after delete`);
            }
            // Clear so the finally block doesn't try to delete a second
            // time and trip 'not found' from the handler.
            createdMemoryId = undefined;
          });
        }
      } finally {
        // Best-effort cleanup if a step failed mid-run, EXCEPT when
        // --keep-artefacts (then we want the memory to stick around).
        if (createdMemoryId && !options.keepArtefacts) {
          try {
            await invoke('user_profile_delete_memory', {
              memory_id: createdMemoryId,
              auto_approved: true,
            });
            info(`cleanup: deleted leftover test memory ${createdMemoryId}`);
          } catch (err) {
            info(
              `cleanup: failed to delete leftover ${createdMemoryId}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        if (options.keepArtefacts && createdMemoryId) {
          info(`--keep-artefacts: left memory ${createdMemoryId} in place`);
        }
      }

      info('');
      const passed = results.filter((r) => r.ok).length;
      const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
      const summary = `${passed}/${results.length} steps passed in ${fmtDuration(totalMs)}`;
      if (passed === results.length) {
        info(`✓ memory test passed — ${summary}`);
        process.exit(0);
      } else {
        info(`✗ memory test failed — ${summary}`);
        process.exit(1);
      }
    });
}
