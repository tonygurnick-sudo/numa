/**
 * `numa-dev docs test` — self-test runner for the docs surface.
 *
 * Workspace docs tools (extract / transcribe / convert) operate against
 * files at the *workspace* S3 path
 * (`numa-chat/workspace/{user_sub}/conversations/{conv_id}/uploads/{name}`),
 * not KB files. So unlike the files self-test which can do the full
 * roundtrip through Lambda APIs, this one has to:
 *
 *   1. Synthesise a `conversation_id` (we use one starting `numa-cli-test-…`).
 *   2. Seed a small fixture at the workspace S3 path via `aws s3 cp` —
 *      this assumes the dev has the `q-demo` profile available locally;
 *      the test fails fast with a clear message if AWS calls error out.
 *   3. Set that conversation_id as the active dev-context override so the
 *      docs commands resolve to it.
 *   4. Run convert + extract against the fixture, verifying outputs land.
 *   5. Tear down: delete the S3 fixtures + restore the previous
 *      dev-context.
 *
 * `transcribe` is intentionally not covered — Amazon Transcribe needs real
 * speech (silence files return empty transcripts) and a ~30-60s wall-clock
 * minimum per chunk. Manual test recipe lives in `dev-notes/tasks/numa-cli/`.
 *
 * Cleanup is best-effort: if a step fails mid-run we still try to nuke
 * the S3 fixtures so the next run starts clean.
 */

import { Command } from 'commander';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getValidTokens } from '@numa/cli/auth';
import { activeProfile, loadContext, loadTokens } from '@numa/cli/context';
import { resolveScopingContext } from '@numa/cli/context';
import { loadDevContext, saveDevContext, clearDevContext, type DevContext } from '@numa/cli/context';
import { invokeTool, type ToolInvokeRequest, type ToolInvokeResponse } from '@numa/cli/api';
import type { ParamsForTool, ToolName, ToolResult } from '@numa/cli/metadata';
import { fail, info } from '@numa/cli/output';

const TEST_CONV_PREFIX = 'numa-cli-test-';
const TEST_FIXTURE_NAME = 'docs-test-fixture.md';
const TEST_MARKDOWN_CONTENT = `# Numa CLI Docs Test

This is a fixture file created by \`numa-dev docs test\`. It contains the
word **arcanum** so we can sanity-check semantic search later if needed.

## Section

The point of this file is to exercise the docs command roundtrip:

- \`numa docs convert\` → markdown → PDF
- \`numa docs extract\` → PDF → text

If you see this file lingering in nd-labs's outputs bucket, the test
crashed mid-run and the cleanup step did not finish. Safe to delete.
`;

const AWS_PROFILE = process.env['NUMA_DEV_AWS_PROFILE'] ?? 'q-demo';
const AWS_REGION = process.env['NUMA_DEV_AWS_REGION'] ?? 'us-east-1';

// ── Step framework (mirrors files-test.ts) ────────────────────────────────

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
    return {
      name,
      ok: false,
      durationMs: now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// ── AWS S3 helpers (shell out — keeps the CLI dep-light) ───────────────────

/**
 * Copy a local file to S3 via `aws s3 cp`. Throws with a useful diagnostic
 * if the AWS CLI is missing or the call fails. We shell out instead of
 * adding `@aws-sdk/client-s3` purely to avoid bloating the prod bundle
 * for a dev-only test.
 */
function s3Upload(localPath: string, s3Uri: string): void {
  const result = spawnSync('aws', ['s3', 'cp', localPath, s3Uri, '--profile', AWS_PROFILE, '--region', AWS_REGION], {
    encoding: 'utf-8',
  });
  if (result.error) {
    throw new Error(`aws s3 cp failed to launch (is the AWS CLI installed?): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`aws s3 cp ${s3Uri} exited ${result.status}: ${(result.stderr ?? '').trim()}`);
  }
}

function s3Exists(s3Uri: string): boolean {
  // `aws s3 ls <uri>` exits 0 if the key matches, 1 if not. We don't
  // need the output — just the exit code.
  const result = spawnSync('aws', ['s3', 'ls', s3Uri, '--profile', AWS_PROFILE, '--region', AWS_REGION], {
    encoding: 'utf-8',
  });
  return result.status === 0;
}

/** Delete by prefix — single call handles all per-conversation artefacts. */
function s3DeletePrefix(s3UriPrefix: string): void {
  const result = spawnSync(
    'aws',
    ['s3', 'rm', s3UriPrefix, '--recursive', '--profile', AWS_PROFILE, '--region', AWS_REGION],
    { encoding: 'utf-8' }
  );
  if (result.status !== 0 && process.env['NUMA_DEBUG']) {
    info(`cleanup: aws s3 rm ${s3UriPrefix} exited ${result.status}: ${(result.stderr ?? '').trim()}`);
  }
}

// ── Test entry ─────────────────────────────────────────────────────────────

export function createDocsTestCommand(): Command {
  return new Command('test')
    .description('Run a roundtrip self-test against the docs surface (cleans up after itself)')
    .option('--keep-artefacts', 'Leave the S3 fixture + dev-context override in place (for debugging)')
    .action(async (options: { keepArtefacts?: boolean }) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      // Need user_sub + outputs bucket for the S3 path. Both come from
      // the local cache we built at login time.
      const tokens = loadTokens(account);
      if (!tokens?.sub) fail('no stored tokens — run `numa login` first');

      const bootstrap = loadContext<{ client_config?: { OUTPUTS_BUCKET_NAME?: string } }>(account);
      const bucket = bootstrap?.client_config?.OUTPUTS_BUCKET_NAME;
      if (!bucket) {
        fail('no OUTPUTS_BUCKET_NAME in bootstrap context. ' + 'Run `numa bootstrap` to refresh and try again.');
      }

      // Verify AWS CLI is available up-front — gives a friendlier error
      // than waiting until the first s3 call.
      try {
        execFileSync('aws', ['--version'], { stdio: 'pipe' });
      } catch {
        fail(
          `aws CLI not found on PATH. The docs self-test seeds an S3 fixture via \`aws s3 cp\` ` +
            `(profile=${AWS_PROFILE}). Install AWS CLI or override with NUMA_DEV_AWS_PROFILE.`
        );
      }

      const stamp = Date.now();
      const convId = `${TEST_CONV_PREFIX}${stamp}`;
      const userSub = tokens.sub;
      const workspacePrefix = `numa-chat/workspace/${userSub}/conversations/${convId}`;
      const fixtureS3 = `s3://${bucket}/${workspacePrefix}/uploads/${TEST_FIXTURE_NAME}`;
      const cleanupPrefix = `s3://${bucket}/${workspacePrefix}/`;

      const tmpDir = mkdtempSync(join(tmpdir(), 'numa-docs-test-'));
      const fixtureLocal = join(tmpDir, TEST_FIXTURE_NAME);
      writeFileSync(fixtureLocal, TEST_MARKDOWN_CONTENT);

      // Capture pre-existing dev-context so we can restore it after.
      const previousDevContext = loadDevContext(account);

      info(`account: ${account}`);
      info(`user_sub: ${userSub}`);
      info(`bucket: ${bucket}`);
      info(`conversation_id: ${convId}`);
      info(`fixture: ${fixtureS3}`);
      info('');

      // Resolve creds once, then build per-step requests. Reusing the
      // pattern from files-test for narrowed types.
      const tokenBundle = await getValidTokens(account);
      const invoke = async <T extends ToolName>(tool: T, params: ParamsForTool<T>): Promise<ToolInvokeResponse<T>> => {
        const scope = resolveScopingContext(account);
        const request: ToolInvokeRequest<T> = {
          tool,
          params,
          context: {
            allowed_kbs: scope.allowed_kbs,
            allowed_kb_operations: scope.allowed_kb_operations,
            conversation_id: scope.conversation_id || undefined,
          },
          id_token: tokenBundle.idToken,
        };
        return invokeTool<T>(account, tokenBundle.accessToken, request);
      };

      const expectOk = <T extends ToolName>(res: ToolInvokeResponse<T>, label: string): ToolResult<T> => {
        if (res.status === 'error') throw new Error(`${label}: ${res.error ?? '<no message>'}`);
        return res.result as ToolResult<T>;
      };

      const TOTAL_STEPS = 6;
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

      // Track what convert produced so extract can target it on the
      // next step (convert's output_path is the source of truth — names
      // can drift if the server applies sanitisation). Same for extract's
      // output_path so the S3-verify step doesn't have to re-predict the
      // sanitised filename (the Python handler builds it from the input
      // file's stem, applies regex sanitisation, prepends `extracted_` —
      // brittle to mirror in TS).
      let convertedWorkspacePath: string | undefined;
      let extractedWorkspacePath: string | undefined;

      try {
        // 1. Seed the markdown fixture at the workspace S3 path.
        await step('seed fixture (aws s3 cp)', async () => {
          s3Upload(fixtureLocal, fixtureS3);
          if (!s3Exists(fixtureS3)) throw new Error(`fixture upload did not land at ${fixtureS3}`);
        });

        // 2. Swap dev-context so docs commands resolve to our convId.
        await step('set dev-context conversation_id', async () => {
          const next: DevContext = {
            ...(previousDevContext ?? {}),
            conversation_id: convId,
          };
          saveDevContext(account, next);
          // Verify it round-trips through resolveScopingContext.
          const scope = resolveScopingContext(account);
          if (scope.conversation_id !== convId) {
            throw new Error(`scope.conversation_id is '${scope.conversation_id}', expected '${convId}'`);
          }
        });

        // 3. Convert markdown → PDF.
        await step('convert markdown → PDF', async () => {
          const res = await invoke('convert_document', {
            file_path: `/workdir/uploads/${TEST_FIXTURE_NAME}`,
            format: 'pdf',
            mode: 'markdown',
            title: 'Numa CLI Docs Test',
          });
          const result = expectOk(res, 'convert');
          if (!result.output_path || !result.output_path.endsWith('.pdf')) {
            throw new Error(`convert returned unexpected output_path: ${result.output_path}`);
          }
          if (!result.s3_key) throw new Error('convert returned no s3_key');
          convertedWorkspacePath = result.output_path;
        });

        // 4. Extract text from the converted PDF.
        await step('extract PDF → text', async () => {
          if (!convertedWorkspacePath) throw new Error('previous step did not set convertedWorkspacePath');
          const res = await invoke('extract_content', {
            file_path: convertedWorkspacePath,
          });
          const result = expectOk(res, 'extract');
          if (!result.output_path) throw new Error('extract returned no output_path');
          if (typeof result.text_length !== 'number' || result.text_length <= 0) {
            throw new Error(`extract returned suspect text_length: ${result.text_length}`);
          }
          if (process.env['NUMA_DEBUG']) {
            info(`extract output_path: ${result.output_path} (${result.text_length} chars)`);
          }
          extractedWorkspacePath = result.output_path;
        });

        // 5. Verify the extracted text S3 key actually exists. We use the
        // workspace path the server returned rather than predicting the
        // sanitised filename ourselves.
        await step('verify extracted text in S3', async () => {
          if (!extractedWorkspacePath) throw new Error('no extracted workspace path to check');
          const rel = extractedWorkspacePath.replace(/^\/workdir\//, '');
          const s3Uri = `s3://${bucket}/${workspacePrefix}/${rel}`;
          if (!s3Exists(s3Uri)) {
            const tmpPrefix = `s3://${bucket}/${workspacePrefix}/tmp/`;
            const listResult = spawnSync(
              'aws',
              ['s3', 'ls', tmpPrefix, '--profile', AWS_PROFILE, '--region', AWS_REGION],
              { encoding: 'utf-8' }
            );
            throw new Error(
              `expected extracted file not found at ${s3Uri}. ` +
                `Contents of tmp/: ${(listResult.stdout ?? '').trim() || '(empty)'}`
            );
          }
        });

        // 6. Verify the converted PDF also exists at the s3_key reported
        // by the convert step.
        await step('verify converted PDF in S3', async () => {
          if (!convertedWorkspacePath) throw new Error('no converted workspace path to check');
          // Map workspace path back to S3:
          // `/workdir/outputs/converted_x.pdf` → outputs/converted_x.pdf
          const rel = convertedWorkspacePath.replace(/^\/workdir\//, '');
          const s3Uri = `s3://${bucket}/${workspacePrefix}/${rel}`;
          if (!s3Exists(s3Uri)) {
            throw new Error(`converted PDF not at expected S3 key: ${s3Uri}`);
          }
        });
      } finally {
        // Cleanup — best-effort but loud about it. Skip if --keep-artefacts.
        if (!options.keepArtefacts) {
          try {
            s3DeletePrefix(cleanupPrefix);
          } catch (err) {
            info(`cleanup: s3 prefix delete failed (${err instanceof Error ? err.message : String(err)})`);
          }
          if (previousDevContext) {
            saveDevContext(account, previousDevContext);
          } else {
            clearDevContext(account);
          }
        } else {
          info(`--keep-artefacts: leaving ${cleanupPrefix} and dev-context conv_id=${convId} in place`);
        }
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
      }

      // Summary.
      info('');
      const passed = results.filter((r) => r.ok).length;
      const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
      const summary = `${passed}/${results.length} steps passed in ${fmtDuration(totalMs)}`;
      if (passed === results.length) {
        info(`✓ docs test passed — ${summary}`);
        process.exit(0);
      } else {
        info(`✗ docs test failed — ${summary}`);
        process.exit(1);
      }
    });
}
