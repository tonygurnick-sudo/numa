/**
 * `numa-dev files test` — self-test runner for the full files surface.
 *
 * Runs a deterministic roundtrip against the user's Personal folder, leaving
 * no artefacts behind. Each step reports pass/fail/time on stderr; the test
 * exit code is non-zero if any step failed.
 *
 * Test sequence:
 *   1.  List folders                                  (read, local)
 *   2.  Upload a temp file → Personal                 (write)
 *   3.  Show Personal, verify file present            (read)
 *   4.  Find by glob (`numa-cli-test-*`)              (read, kb_files list+pattern)
 *   5.  Search "arcanum" — string we know             (semantic search)
 *   6.  Download back, byte-compare                   (read)
 *   7.  Download-folder Personal as zip               (read, bulk)
 *   8.  Move to subfolder (Personal/numa-cli-test/)   (write, kb_manager)
 *   9.  Rename within subfolder                       (write, kb_manager)
 *   10. Move back to root (with renamed filename)     (write, kb_manager)
 *   11. Delete                                        (write)
 *   12. Show again, verify gone                       (read)
 *
 * Steps 6 and 9 catch S3 key construction bugs (subfolder paths). Step 4
 * exercises filename search. Step 7 covers bulk download. The whole run
 * is ~10 seconds; semantic search (step 5) is the slowest because Bedrock
 * summarisation runs even with results = 1.
 *
 * Cleanup is best-effort — if a step fails mid-run we still try to delete
 * the upload artefact so the next run starts clean.
 */

import { Command } from 'commander';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getValidTokens } from '@numa/cli/auth';
import { activeProfile } from '@numa/cli/context';
import { resolveScopingContext } from '@numa/cli/context';
import { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from '@numa/cli/api';
import type { ParamsForTool, ToolName, ToolResult } from '@numa/cli/metadata';
import { fail, info } from '@numa/cli/output';

const TEST_FOLDER_NAME = 'Personal';
const TEST_FILE_PREFIX = 'numa-cli-test-';
const TEST_CONTENT = `numa CLI self-test artefact — created by 'numa-dev files test'.\nThis file should be auto-deleted at the end of the run.\nContains the word arcanum for semantic search testing.\n`;

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
  if (r.ok) {
    process.stderr.write(`ok (${fmtDuration(r.durationMs)})\n`);
  } else {
    process.stderr.write(`FAIL (${fmtDuration(r.durationMs)})\n   ${r.error}\n`);
  }
};

const runStep = async (name: string, fn: () => Promise<void>): Promise<StepResult> => {
  const start = now();
  try {
    await fn();
    return { name, ok: true, durationMs: now() - start };
  } catch (err) {
    return {
      name,
      ok: false,
      durationMs: now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export function createFilesTestCommand(): Command {
  return new Command('test')
    .description('Run a roundtrip self-test against the Personal folder (cleans up after itself)')
    .option('--skip-search', 'Skip the semantic search step (Bedrock indexing can be flaky)')
    .option('--keep-artefacts', 'Leave the uploaded test file in place (for debugging)')
    .action(async (options: { skipSearch?: boolean; keepArtefacts?: boolean }) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const tokens = await getValidTokens(account);
      const scope = resolveScopingContext(account);
      const personal = scope.allowed_kbs.find((kb) => (kb.name ?? '').toLowerCase() === TEST_FOLDER_NAME.toLowerCase());
      if (!personal) {
        fail(
          `could not find '${TEST_FOLDER_NAME}' folder in your bootstrap context. ` +
            'Run `numa bootstrap` to refresh, then retry.'
        );
      }

      const stamp = Date.now();
      const testFilename = `${TEST_FILE_PREFIX}${stamp}.txt`;
      const tmpDir = mkdtempSync(join(tmpdir(), 'numa-files-test-'));
      const srcPath = join(tmpDir, testFilename);
      const downloadPath = join(tmpDir, 'downloaded.txt');
      const folderZipPath = join(tmpDir, 'personal.zip');
      writeFileSync(srcPath, TEST_CONTENT);

      info(`scope: ${scope.source} (${scope.allowed_kbs.length} folders)`);
      info(`folder: ${personal.name} (${personal.id})`);
      info(`test file: ${testFilename}`);
      info('');

      /**
       * Generic test helper — pass a tool name and TypeScript narrows the
       * `params` shape AND the return's `result` shape from the discriminated
       * union in @numa/cli/metadata. Mirrors what real consumer code does.
       */
      const invoke = async <T extends ToolName>(
        tool: T,
        params: ParamsForTool<T>,
        contextOverride?: { folder?: { id: string; name?: string } }
      ): Promise<ToolInvokeResponse<T>> => {
        const folder = contextOverride?.folder ?? personal;
        const request: ToolInvokeRequest<T> = {
          tool,
          params,
          context: {
            allowed_kbs: [folder],
            allowed_kb_operations: scope.allowed_kb_operations,
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

      const totalSteps = options.skipSearch ? 11 : 12;
      const results: StepResult[] = [];
      let stepIdx = 0;
      const step = async (name: string, fn: () => Promise<void>): Promise<StepResult> => {
        stepIdx += 1;
        writeStep(stepIdx, totalSteps, name);
        const r = await runStep(name, fn);
        writeResult(r);
        results.push(r);
        return r;
      };

      // 1. List folders (local read).
      await step('list folders', async () => {
        if (scope.allowed_kbs.length === 0) throw new Error('bootstrap returned 0 folders');
      });

      // 2. Upload.
      await step('upload', async () => {
        const res = await invoke('add_to_kb', {
          kb_id: personal.id,
          filename: testFilename,
          content_base64: readFileSync(srcPath).toString('base64'),
          auto_approved: true,
        });
        expectOk(res, 'upload');
      });

      // 3. Show, verify present.
      await step('show + verify present', async () => {
        const res = await invoke('list_kb_files', {
          kb_ids: [personal.id],
        });
        const listing = expectOk(res, 'show');
        const files = listing.listings?.[personal.id]?.files ?? [];
        if (!files.some((f) => f.name === testFilename)) {
          throw new Error(`file '${testFilename}' not in listing (got ${files.length} files)`);
        }
      });

      // 4. Find by glob.
      await step('find by glob', async () => {
        const res = await invoke('retrieve_kb_file', {
          mode: 'list',
          kb_id: personal.id,
          pattern: `${TEST_FILE_PREFIX}*`,
          auto_approved: true,
        });
        // mode=list returns the list variant of RetrieveKbFileResult.
        const result = expectOk(res, 'find') as unknown as { files?: Array<{ name: string }> };
        const matched = (result.files ?? []).some((f) => f.name === testFilename);
        if (!matched) throw new Error(`pattern did not match '${testFilename}'`);
      });

      // 5. Semantic search — optional. Bedrock indexing is async; the file
      // we just uploaded may not be searchable yet. We test against the
      // literal word 'arcanum' which exists in older content too — so we
      // accept any non-empty result set.
      if (!options.skipSearch) {
        await step('semantic search (arcanum)', async () => {
          const res = await invoke('query_knowledgebase', {
            query: 'arcanum',
            user_intent: 'self-test',
            kb_id: personal.id,
            max_results: 1,
            summarise_results: false,
          });
          const result = expectOk(res, 'search');
          // We sent kb_id (no all_kbs), so the response is a single-KB
          // variant — narrow before reading `results_count`. Falls back
          // to total_results_count if the server route is bypassed.
          const count =
            'results_count' in result
              ? result.results_count
              : 'total_results_count' in result
                ? result.total_results_count
                : 0;
          if (count < 1) throw new Error('search returned 0 results');
        });
      }

      // 6. Download, byte-compare.
      await step('download + byte-compare', async () => {
        const res = await invoke('retrieve_kb_file', {
          mode: 'download',
          kb_id: personal.id,
          file: testFilename,
          get_presigned_url: true,
          auto_approved: true,
        });
        // We sent mode=download so the result is the download variant of
        // RetrieveKbFileResult — cast through `unknown` to narrow.
        const result = expectOk(res, 'download') as unknown as {
          content_base64?: string;
          presigned_url?: string;
        };
        let buf: Buffer;
        if (result.presigned_url) {
          const r = await fetch(result.presigned_url);
          if (!r.ok) throw new Error(`presigned HTTP ${r.status}`);
          buf = Buffer.from(await r.arrayBuffer());
        } else if (result.content_base64) {
          buf = Buffer.from(result.content_base64, 'base64');
        } else {
          throw new Error('no presigned_url or content_base64 in download response');
        }
        writeFileSync(downloadPath, buf);
        if (buf.toString('utf-8') !== TEST_CONTENT) {
          throw new Error('downloaded content did not match upload');
        }
      });

      // 7. Bulk download-folder.
      await step('download-folder (bulk zip)', async () => {
        const res = await invoke('retrieve_kb_file', {
          mode: 'download_folder',
          kb_id: personal.id,
          folder_path: '',
          auto_approved: true,
        });
        // Cast to the download_folder variant — we know the mode we sent.
        const result = expectOk(res, 'download-folder') as unknown as {
          content_base64?: string;
          presigned_url?: string;
          file_count?: number;
        };
        let buf: Buffer;
        if (result.presigned_url) {
          const r = await fetch(result.presigned_url);
          if (!r.ok) throw new Error(`presigned HTTP ${r.status}`);
          buf = Buffer.from(await r.arrayBuffer());
        } else if (result.content_base64) {
          buf = Buffer.from(result.content_base64, 'base64');
        } else {
          throw new Error('no presigned_url or content_base64 in download-folder response');
        }
        writeFileSync(folderZipPath, buf);
        if (buf.length === 0) throw new Error('downloaded zip is empty');
      });

      // 8. Move to subfolder.
      await step('mv → numa-cli-test/ subfolder', async () => {
        const srcKey =
          personal.id === 'company' || personal.id === 'numa-support'
            ? `documents/${personal.id}/${testFilename}`
            : `documents/kb-${personal.id}/${testFilename}`;
        const res = await invoke('move_kb_file', {
          kb_id: personal.id,
          keys: [srcKey],
          destKbId: personal.id,
          destPath: 'numa-cli-test',
        });
        expectOk(res, 'mv');
      });

      // 9. Rename within the subfolder.
      const renamedFilename = testFilename.replace('.txt', '-renamed.txt');
      await step('rename in subfolder', async () => {
        const subKey =
          personal.id === 'company' || personal.id === 'numa-support'
            ? `documents/${personal.id}/numa-cli-test/${testFilename}`
            : `documents/kb-${personal.id}/numa-cli-test/${testFilename}`;
        const res = await invoke('rename_kb_file', {
          kb_id: personal.id,
          key: subKey,
          newFilename: renamedFilename,
        });
        expectOk(res, 'rename');
      });

      // 10. Move back to root (with the renamed filename).
      await step('mv back to root', async () => {
        const subKey =
          personal.id === 'company' || personal.id === 'numa-support'
            ? `documents/${personal.id}/numa-cli-test/${renamedFilename}`
            : `documents/kb-${personal.id}/numa-cli-test/${renamedFilename}`;
        const res = await invoke('move_kb_file', {
          kb_id: personal.id,
          keys: [subKey],
          destKbId: personal.id,
          destPath: '',
        });
        expectOk(res, 'mv-back');
      });

      // 11. Delete the (now renamed) file.
      let deleted = false;
      await step('delete', async () => {
        if (options.keepArtefacts) {
          throw new Error('--keep-artefacts skipped delete (run `numa-dev files delete ...` manually to clean up)');
        }
        const res = await invoke('delete_kb_file', {
          kb_id: personal.id,
          filename: renamedFilename,
          auto_approved: true,
        });
        expectOk(res, 'delete');
        deleted = true;
      });

      // 12. Verify gone — check that neither the original nor renamed
      // filename are still around.
      if (deleted) {
        await step('show + verify gone', async () => {
          const res = await invoke('list_kb_files', {
            kb_ids: [personal.id],
          });
          const listing = expectOk(res, 'verify-gone');
          const files = listing.listings?.[personal.id]?.files ?? [];
          const stillPresent = files.filter((f) => f.name === testFilename || f.name === renamedFilename);
          if (stillPresent.length > 0) {
            throw new Error(
              `test artefact(s) still present after delete: ${stillPresent.map((f) => f.name).join(', ')}`
            );
          }
        });
      }

      // Cleanup local tmpdir.
      try {
        if (existsSync(srcPath)) unlinkSync(srcPath);
        if (existsSync(downloadPath)) unlinkSync(downloadPath);
        if (existsSync(folderZipPath)) unlinkSync(folderZipPath);
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Non-fatal — best-effort.
      }

      // Summary.
      const passed = results.filter((r) => r.ok).length;
      const failed = results.length - passed;
      const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

      process.stderr.write('\n');
      process.stderr.write(`${passed}/${results.length} passed (${fmtDuration(totalMs)})\n`);

      if (failed > 0) {
        process.stderr.write('\nFailures:\n');
        for (const r of results.filter((x) => !x.ok)) {
          process.stderr.write(`  - ${r.name}: ${r.error}\n`);
        }
        // Best-effort cleanup of any leftover artefact. The file could be in
        // one of four states depending on where we failed: root with original
        // name, subfolder with original name, subfolder with renamed name, or
        // root with renamed name. `delete_kb_file` takes the subpath as part
        // of `filename` (no separate kb_path field — handler builds the key
        // as `documents/{prefix}/{filename}`).
        if (!options.keepArtefacts) {
          const attempts: string[] = [
            testFilename,
            `numa-cli-test/${testFilename}`,
            `numa-cli-test/${renamedFilename}`,
            renamedFilename,
          ];
          for (const filename of attempts) {
            try {
              await invoke('delete_kb_file', { kb_id: personal.id, filename, auto_approved: true });
            } catch {
              // ignore — likely "not found", which is fine
            }
          }
        }
        process.exit(1);
      }
    });
}
