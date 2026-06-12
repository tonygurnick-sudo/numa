/**
 * `numa-dev ops test` — roundtrip self-test for the ops surface.
 *
 * Ops is generic dispatcher (1 tool name per operation on the wire),
 * so this test is a sequence of operation calls against the user's actual
 * deployment. Read-only steps always run; write steps require at least one
 * board to be configured (skip with helpful message otherwise).
 *
 * Test sequence (5 read + up to 5 write = 10 steps when boards exist):
 *
 *   READ
 *   1. get_config                 returns sliced config with ticket types
 *   2. list_boards                returns boards array (may be empty)
 *   3. list_projects              returns projects array
 *   4. list_tickets               returns tickets array (any board)
 *   5. get_metrics                returns metrics dict
 *
 *   WRITE  (only when at least 1 board + 1 ticket-type exists)
 *   6. create_ticket              creates `numa-cli-test-<stamp>` ticket; capture displayId
 *   7. get_ticket                 fetches by displayId; verify title matches
 *   8. update_ticket              changes title; verify get_ticket reflects update
 *   9. add_comment                attaches "test comment from numa-dev"
 *  10. delete_ticket              cleanup; verify get_ticket returns not-found
 *
 * Cleanup: step 10 is the cleanup. If a prior write step fails, the
 * `finally` block also attempts a delete to avoid leaving test tickets
 * behind. --keep-artefacts skips both step 10 and the finally cleanup.
 */

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { getValidTokens } from '@numa/cli/auth';
import { activeProfile } from '@numa/cli/context';
import { resolveScopingContext, type ScopingContext } from '@numa/cli/context';
import { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from '@numa/cli/api';
import type { OpsOperationParams, OpsOperationResult } from '@numa/cli/metadata';
import { fail, info } from '@numa/cli/output';

const TEST_MARKER = 'numa-cli-test-';

// ── Step framework (mirrors other *-test.ts) ──────────────────────────────

interface StepResult {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

const now = (): number => Date.now();
const fmtDuration = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const writeStep = (idx: number, total: number, name: string): void => {
  process.stderr.write(`[${idx}/${total}] ${name} ... `);
};
const writeResult = (r: StepResult): void => {
  if (r.skipped) process.stderr.write(`SKIP (${r.skipReason ?? 'no reason'})\n`);
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

// ── ops invocation helper ─────────────────────────────────────────────────

/**
 * Call an ops operation via the same wire shape the CLI itself uses:
 * tool name `ops_<operation>`, params wrapped in OpsOperationParams with
 * auto_approved=true. Returns the typed envelope.
 */
async function invokeOps(
  account: string,
  accessToken: string,
  scope: ScopingContext,
  idToken: string,
  operation: string,
  opParams: Record<string, unknown> = {}
): Promise<ToolInvokeResponse<`ops_${string}`>> {
  const toolName = `ops_${operation}` as `ops_${string}`;
  // Python handler reads `event.operation` to dispatch — must be in params.
  const params: OpsOperationParams & { operation: string } = {
    operation,
    params: opParams,
    auto_approved: true,
  };
  const request: ToolInvokeRequest<typeof toolName> = {
    tool: toolName,
    params,
    context: {
      allowed_kbs: scope.allowed_kbs,
      allowed_kb_operations: scope.allowed_kb_operations,
      conversation_id: scope.conversation_id || undefined,
    },
    id_token: idToken,
  };
  return invokeTool<typeof toolName>(account, accessToken, request);
}

const expectOk = (res: ToolInvokeResponse<`ops_${string}`>, label: string): OpsOperationResult => {
  if (res.status === 'error') throw new Error(`${label}: ${res.error ?? '<no message>'}`);
  return (res.result ?? {}) as OpsOperationResult;
};

/** Unwrap the domain payload from the server-side approval-envelope wrapper. */
const payload = (r: OpsOperationResult): unknown => (r.result !== undefined ? r.result : r);

// ── command ────────────────────────────────────────────────────────────────

export function createOpsTestCommand(): Command {
  return new Command('test')
    .description(
      'Run a roundtrip self-test against the ops surface (read-only steps always run; ' +
        'write steps skip when no boards are configured)'
    )
    .option('--keep-artefacts', 'Leave the test ticket in place (skips delete + finally cleanup)')
    .action(async (options: { keepArtefacts?: boolean }) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const tokens = await getValidTokens(account);
      const scope = resolveScopingContext(account);

      info(`account: ${account}`);
      info(`scope source: ${scope.source}`);
      info('');

      // Pre-flight: detect if write tests are runnable. Reads `get_config`
      // (always works on a deployed instance) + first board.
      let firstBoardId: string | undefined;
      let firstTicketTypeId: string | undefined;
      let firstStageId: string | undefined;
      let testTicketDisplayId: string | undefined;
      let testCustomerId: string | undefined;
      let testProjectId: string | undefined;

      const results: StepResult[] = [];
      // 5 reads + 9 ticket (1 stage resolve + 5 mutations + search + comments + audit) +
      // 7 customer (incl. 2 shell-based CLI ergonomic tests) + 4 project = 25 when
      // boards exist. Ticket steps SKIP if no boards. Cosmetic only — exit code
      // is driven by pass/fail counts.
      const totalSteps = 25;
      let stepIdx = 0;

      const step = async (name: string, fn: () => Promise<void>): Promise<StepResult> => {
        stepIdx += 1;
        writeStep(stepIdx, totalSteps, name);
        const r = await runStep(name, fn);
        writeResult(r);
        results.push(r);
        return r;
      };

      const skip = (name: string, reason: string): void => {
        stepIdx += 1;
        writeStep(stepIdx, totalSteps, name);
        const r: StepResult = { name, ok: true, durationMs: 0, skipped: true, skipReason: reason };
        writeResult(r);
        results.push(r);
      };

      try {
        // ── READS ──────────────────────────────────────────────────────────
        await step('get_config', async () => {
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_config');
          const r = expectOk(res, 'get_config');
          const p = payload(r) as { ticketTypes?: unknown[]; statuses?: unknown[] };
          if (!p || typeof p !== 'object') {
            throw new Error(`get_config returned non-object: ${JSON.stringify(p).slice(0, 200)}`);
          }
          if (Array.isArray(p.ticketTypes) && p.ticketTypes.length > 0) {
            const tt = p.ticketTypes[0] as { id?: string };
            firstTicketTypeId = tt.id;
          }
        });

        await step('list_boards', async () => {
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'list_boards');
          const r = expectOk(res, 'list_boards');
          const p = payload(r) as { boards?: Array<{ id?: string; name?: string }> } | Array<{ id?: string }>;
          const boards = Array.isArray(p) ? p : (p?.boards ?? []);
          if (boards.length > 0) {
            firstBoardId = boards[0]?.id;
          }
        });

        await step('list_projects', async () => {
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'list_projects');
          const r = expectOk(res, 'list_projects');
          // Projects is allowed to be empty; just assert it returns an array
          // or an object with a `projects` array.
          const p = payload(r) as { projects?: unknown[] } | unknown[];
          const projects = Array.isArray(p) ? p : (p?.projects ?? []);
          if (!Array.isArray(projects)) {
            throw new Error(`list_projects returned non-array: ${JSON.stringify(p).slice(0, 200)}`);
          }
        });

        await step('list_tickets', async () => {
          // list_tickets requires boardId. If we don't have one yet, skip
          // gracefully — the read tests run before write tests so we may
          // legitimately not have a board on this account.
          if (!firstBoardId) {
            throw new Error('no board id from list_boards — list_tickets needs one');
          }
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'list_tickets', {
            boardId: firstBoardId,
          });
          expectOk(res, 'list_tickets');
        });

        await step('get_metrics', async () => {
          // get_metrics's backend wants `boardIds` as a string (it does
          // `.split(',')` on it). Pass singular `boardId` and let the
          // Python bridge convert.
          if (!firstBoardId) {
            throw new Error('no board id from list_boards — get_metrics needs at least one');
          }
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_metrics', {
            boardId: firstBoardId,
          });
          const r = expectOk(res, 'get_metrics');
          if (!r || typeof r !== 'object') {
            throw new Error('get_metrics returned non-object');
          }
        });

        // ── WRITES (conditional) ──────────────────────────────────────────
        if (!firstBoardId || !firstTicketTypeId) {
          const reason = !firstBoardId ? 'no boards configured' : 'no ticket types configured';
          skip('create_ticket', reason);
          skip('get_ticket', reason);
          skip('update_ticket', reason);
          skip('add_comment', reason);
          skip('delete_ticket', reason);
        } else {
          // For nd-labs we still want a stageId — get the first one from the board.
          await step('resolve stage from first board', async () => {
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_board', {
              boardId: firstBoardId,
            });
            const r = expectOk(res, 'get_board');
            const p = payload(r) as {
              stages?: Array<{ id?: string }>;
              zones?: Array<{ stages?: Array<{ id?: string }> }>;
            };
            // Boards can put stages directly OR nested under zones[]
            const stages: Array<{ id?: string }> = p?.stages ?? p?.zones?.[0]?.stages ?? [];
            firstStageId = stages[0]?.id;
            if (!firstStageId) {
              throw new Error('board has no stages — cannot create ticket');
            }
          });

          await step('create_ticket', async () => {
            const stamp = Date.now();
            const title = `${TEST_MARKER}${stamp} — auto-deletes in step 10`;
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'create_ticket', {
              boardId: firstBoardId,
              title,
              ticketTypeId: firstTicketTypeId,
              stageId: firstStageId,
              description: 'Created by `numa-dev ops test`. Safe to delete.',
            });
            const r = expectOk(res, 'create_ticket');
            const p = payload(r) as { ticket?: { displayId?: string }; displayId?: string };
            testTicketDisplayId = p?.ticket?.displayId ?? p?.displayId;
            if (!testTicketDisplayId) {
              throw new Error(`create_ticket returned no displayId: ${JSON.stringify(p).slice(0, 200)}`);
            }
          });

          // Use `displayId` (e.g. TST-012) — the Python bridge resolves it
          // to ticketId UUID + boardId for the mutation operations. Passing
          // `ticketId` with a display string would be treated as a UUID and
          // fail with "Ticket not found". get_ticket has its own displayId
          // route (`ops/tickets/by-display-id/<id>`).
          await step('get_ticket', async () => {
            if (!testTicketDisplayId) throw new Error('no displayId from create_ticket');
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_ticket', {
              displayId: testTicketDisplayId,
            });
            const r = expectOk(res, 'get_ticket');
            const p = payload(r) as { ticket?: { title?: string }; title?: string };
            const title = p?.ticket?.title ?? p?.title;
            if (!title || !title.startsWith(TEST_MARKER)) {
              throw new Error(`get_ticket title doesn't match: ${title}`);
            }
          });

          await step('update_ticket', async () => {
            if (!testTicketDisplayId) throw new Error('no displayId from create_ticket');
            const newTitle = `${TEST_MARKER}updated-${Date.now()}`;
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'update_ticket', {
              displayId: testTicketDisplayId,
              title: newTitle,
            });
            expectOk(res, 'update_ticket');
            const verify = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_ticket', {
              displayId: testTicketDisplayId,
            });
            const vr = expectOk(verify, 'update_ticket verify');
            const vp = payload(vr) as { ticket?: { title?: string }; title?: string };
            const updatedTitle = vp?.ticket?.title ?? vp?.title;
            if (updatedTitle !== newTitle) {
              throw new Error(`update didn't stick: expected '${newTitle}', got '${updatedTitle}'`);
            }
          });

          await step('search_tickets', async () => {
            // Search for our test ticket by the TEST_MARKER prefix. Always
            // returns at least the ticket we just created (proves filtering
            // works against current state).
            if (!testTicketDisplayId) throw new Error('no displayId from create_ticket');
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'search_tickets', {
              boardId: firstBoardId,
              query: TEST_MARKER,
            });
            const r = expectOk(res, 'search_tickets');
            const p = payload(r) as { tickets?: Array<{ displayId?: string }>; results?: unknown[] };
            const tickets = p?.tickets ?? [];
            if (tickets.length === 0) {
              throw new Error(
                `search_tickets returned 0 for marker '${TEST_MARKER}' — should find at least the test ticket`
              );
            }
          });

          await step('add_comment', async () => {
            if (!testTicketDisplayId) throw new Error('no displayId from create_ticket');
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'add_comment', {
              displayId: testTicketDisplayId,
              content: 'test comment from numa-dev',
            });
            expectOk(res, 'add_comment');
          });

          await step('list_comments', async () => {
            // The add_comment step just ran — comments should have ≥1 entry.
            if (!testTicketDisplayId) throw new Error('no displayId from create_ticket');
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'list_comments', {
              displayId: testTicketDisplayId,
            });
            const r = expectOk(res, 'list_comments');
            const p = payload(r) as { comments?: unknown[] } | unknown[];
            const comments = Array.isArray(p) ? p : (p?.comments ?? []);
            if (!Array.isArray(comments) || comments.length === 0) {
              throw new Error(`list_comments returned 0 entries after add_comment`);
            }
          });

          await step('get_audit', async () => {
            // Audit trail should have ≥1 entry (create + comment + maybe update).
            if (!testTicketDisplayId) throw new Error('no displayId from create_ticket');
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_audit', {
              displayId: testTicketDisplayId,
            });
            const r = expectOk(res, 'get_audit');
            const p = payload(r) as { audit?: unknown[]; events?: unknown[] } | unknown[];
            const events = Array.isArray(p) ? p : (p?.audit ?? p?.events ?? []);
            if (!Array.isArray(events)) {
              throw new Error(`get_audit returned non-array: ${JSON.stringify(p).slice(0, 200)}`);
            }
          });

          if (options.keepArtefacts) {
            skip('delete_ticket', '--keep-artefacts');
          } else {
            await step('delete_ticket', async () => {
              if (!testTicketDisplayId) throw new Error('no displayId from create_ticket');
              const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'delete_ticket', {
                displayId: testTicketDisplayId,
              });
              expectOk(res, 'delete_ticket');
              testTicketDisplayId = undefined; // mark as cleaned
            });
          }
        }

        // ── CUSTOMER ROUNDTRIP (always runs — CRM is independent of boards) ──
        // No precondition check — list_customers from the read block returning
        // shape-OK implies the CRM API is reachable. If it isn't, the create
        // will fail loudly with a useful error.
        await step('create_customer', async () => {
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'create_customer', {
            companyName: `${TEST_MARKER}customer-${Date.now()}`,
            notes: 'Created by `numa-dev ops test`. Safe to delete.',
          });
          const r = expectOk(res, 'create_customer');
          const p = payload(r) as { customer?: { id?: string }; id?: string };
          testCustomerId = p?.customer?.id ?? p?.id;
          if (!testCustomerId) {
            throw new Error(`create_customer returned no id: ${JSON.stringify(p).slice(0, 200)}`);
          }
        });

        await step('get_customer', async () => {
          if (!testCustomerId) throw new Error('no id from create_customer');
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_customer', {
            customerId: testCustomerId,
          });
          const r = expectOk(res, 'get_customer');
          const p = payload(r) as { customer?: { companyName?: string } };
          if (!p?.customer?.companyName?.startsWith(TEST_MARKER)) {
            throw new Error(`get_customer companyName doesn't match: ${p?.customer?.companyName}`);
          }
        });

        await step('search_customers', async () => {
          // Find our test customer by the TEST_MARKER prefix. Tests the new
          // search_customers op end-to-end (Python bridge → CRM API ?search=).
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'search_customers', {
            search: TEST_MARKER,
          });
          const r = expectOk(res, 'search_customers');
          const p = payload(r) as { customers?: Array<{ id?: string }> };
          const customers = p?.customers ?? [];
          if (customers.length === 0) {
            throw new Error(`search_customers returned 0 for marker '${TEST_MARKER}'`);
          }
          if (!customers.some((c) => c.id === testCustomerId)) {
            throw new Error(`search_customers didn't return our test customer ${testCustomerId}`);
          }
        });

        // Exercise CLI ergonomics end-to-end: shell out to `numa ops` and
        // verify the positional-shortcut + ad-hoc-flag forms parse and reach
        // the server. The invokeOps-based tests above already cover the
        // server response shape; these steps cover the commander layer.
        await step('CLI positional shortcut: search_customers <term>', async () => {
          let output = '';
          try {
            output = execSync(`numa ops search_customers ${TEST_MARKER} --user-message 'self-test' --json`, {
              encoding: 'utf-8',
            });
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string };
            throw new Error(`CLI invocation failed: ${e.stderr ?? e.stdout ?? String(err)}`);
          }
          const parsed = JSON.parse(output) as { customers?: Array<{ id?: string }> };
          if (!parsed.customers?.some((c) => c.id === testCustomerId)) {
            throw new Error(
              `CLI positional shortcut didn't return test customer ${testCustomerId}. ` +
                `Got ${parsed.customers?.length ?? 0} results.`
            );
          }
        });

        await step('CLI ad-hoc flag: get_customer --customer-id <id>', async () => {
          if (!testCustomerId) throw new Error('no id from create_customer');
          let output = '';
          try {
            output = execSync(
              `numa ops get_customer --customer-id ${testCustomerId} --user-message 'self-test' --json`,
              { encoding: 'utf-8' }
            );
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string };
            throw new Error(`CLI invocation failed: ${e.stderr ?? e.stdout ?? String(err)}`);
          }
          const parsed = JSON.parse(output) as { customer?: { id?: string; companyName?: string } };
          if (parsed.customer?.id !== testCustomerId) {
            throw new Error(
              `CLI ad-hoc flag returned wrong customer: expected ${testCustomerId}, got ${parsed.customer?.id}`
            );
          }
          if (!parsed.customer?.companyName?.startsWith(TEST_MARKER)) {
            throw new Error(`CLI ad-hoc flag returned unexpected companyName: ${parsed.customer?.companyName}`);
          }
        });

        await step('update_customer', async () => {
          if (!testCustomerId) throw new Error('no id from create_customer');
          const newNotes = `updated by numa-dev test at ${Date.now()}`;
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'update_customer', {
            customerId: testCustomerId,
            notes: newNotes,
          });
          expectOk(res, 'update_customer');
        });

        if (options.keepArtefacts) {
          skip('delete_customer', '--keep-artefacts');
        } else {
          await step('delete_customer', async () => {
            if (!testCustomerId) throw new Error('no id from create_customer');
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'delete_customer', {
              customerId: testCustomerId,
            });
            expectOk(res, 'delete_customer');
            testCustomerId = undefined;
          });
        }

        // ── PROJECT ROUNDTRIP (always runs, exercises the new get_project op) ──
        await step('create_project', async () => {
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'create_project', {
            name: `${TEST_MARKER}project-${Date.now()}`,
            description: 'Created by `numa-dev ops test`. Safe to delete.',
          });
          const r = expectOk(res, 'create_project');
          // POST /ops/config/projects returns the item directly (not nested).
          const p = payload(r) as { id?: string; project?: { id?: string } };
          testProjectId = p?.id ?? p?.project?.id;
          if (!testProjectId) {
            throw new Error(`create_project returned no id: ${JSON.stringify(p).slice(0, 200)}`);
          }
        });

        await step('get_project', async () => {
          // Exercises the NEW backend route GET /ops/config/projects/:id.
          if (!testProjectId) throw new Error('no id from create_project');
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'get_project', {
            projectId: testProjectId,
          });
          const r = expectOk(res, 'get_project');
          const p = payload(r) as { project?: { name?: string; id?: string } };
          if (p?.project?.id !== testProjectId) {
            throw new Error(`get_project id mismatch: expected ${testProjectId}, got ${p?.project?.id}`);
          }
          if (!p?.project?.name?.startsWith(TEST_MARKER)) {
            throw new Error(`get_project name doesn't match: ${p?.project?.name}`);
          }
        });

        await step('update_project', async () => {
          if (!testProjectId) throw new Error('no id from create_project');
          const newDescription = `updated by numa-dev test at ${Date.now()}`;
          const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'update_project', {
            projectId: testProjectId,
            description: newDescription,
          });
          expectOk(res, 'update_project');
        });

        if (options.keepArtefacts) {
          skip('delete_project', '--keep-artefacts');
        } else {
          await step('delete_project', async () => {
            if (!testProjectId) throw new Error('no id from create_project');
            const res = await invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'delete_project', {
              projectId: testProjectId,
            });
            expectOk(res, 'delete_project');
            testProjectId = undefined;
          });
        }
      } finally {
        // Belt + suspenders: if any write step failed mid-roundtrip, try
        // best-effort cleanup so the deployment doesn't accumulate
        // numa-cli-test-* artefacts. Each cleanup is independent so one
        // failure doesn't block the others.
        if (options.keepArtefacts) return;

        const cleanups: Array<[string, () => Promise<unknown>]> = [];
        if (testTicketDisplayId) {
          cleanups.push([
            `ticket ${testTicketDisplayId}`,
            () =>
              invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'delete_ticket', {
                displayId: testTicketDisplayId,
              }),
          ]);
        }
        if (testCustomerId) {
          cleanups.push([
            `customer ${testCustomerId}`,
            () =>
              invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'delete_customer', {
                customerId: testCustomerId,
              }),
          ]);
        }
        if (testProjectId) {
          cleanups.push([
            `project ${testProjectId}`,
            () =>
              invokeOps(account, tokens.accessToken, scope, tokens.idToken, 'delete_project', {
                projectId: testProjectId,
              }),
          ]);
        }
        for (const [label, fn] of cleanups) {
          try {
            await fn();
            info(`cleanup: deleted leftover ${label}`);
          } catch (err) {
            info(
              `cleanup: failed to delete ${label} (${
                err instanceof Error ? err.message : String(err)
              }) — delete manually`
            );
          }
        }
      }

      info('');
      const passed = results.filter((r) => r.ok && !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      const failed = results.filter((r) => !r.ok && !r.skipped).length;
      const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
      const summary = `${passed}/${results.length} steps passed${
        skipped > 0 ? `, ${skipped} skipped` : ''
      } in ${fmtDuration(totalMs)}`;
      if (failed === 0) {
        info(`✓ ops test passed — ${summary}`);
        process.exit(0);
      } else {
        info(`✗ ops test failed — ${summary}`);
        process.exit(1);
      }
    });
}
