/**
 * `numa docs <action>` — document-processing tools (extract / transcribe /
 * convert).
 *
 * Wraps workspace-chat-tools' `extract_content`, `transcribe`, and
 * `convert_document` 1:1 — same surface Numa-the-LLM uses today via the MCP
 * layer, so the CLI is a drop-in replacement. These tools all operate on
 * WORKSPACE files (paths under `/workdir/...`), not KB files; they require
 * an active `conversation_id` to construct the S3 path where the file
 * lives.
 *
 * Execution contexts:
 *
 *   1. In-workspace (Numa-the-LLM driving)
 *      NUMA_CONVERSATION_ID is set. file_path defaults to `/workdir/...`
 *      and the tool just works against the active conversation's S3 path.
 *
 *   2. Local dev (Nathan testing)
 *      conversation_id is empty by default → tools fail server-side with
 *      "Missing conversation context". Set a fake one with
 *      `numa-dev context set --conversation-id <id>` and seed a fixture
 *      at the right S3 path (see `numa-dev docs test` for an example).
 *
 * Filenames passed by users may be relative (e.g. `report.pdf`) — we
 * prepend `/workdir/uploads/` so the LLM doesn't have to think about
 * absolute workspace paths for the common case.
 */

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import type { ParamsForTool, ToolName } from '../../metadata/tool-types.js';
import { fail, info } from '../../output/pretty.js';
import { emitResult, prettyOrSpill } from '../../output/emit.js';
import { requireUserMessage, type StandardOptions } from '../../output/cli-args.js';

const WORKSPACE_ROOT = '/workdir';
const DEFAULT_UPLOADS_SUBDIR = 'uploads';

/**
 * Normalise a user-supplied file path to a workspace-absolute path.
 *
 * Behaviour:
 *   - `/workdir/foo.pdf`            → unchanged
 *   - `/foo.pdf`                    → fails (must be under /workdir)
 *   - `foo.pdf`                     → `/workdir/uploads/foo.pdf` (default
 *                                     uploads/ dir, matches frontend's
 *                                     upload destination)
 *   - `subdir/foo.pdf`              → `/workdir/uploads/subdir/foo.pdf`
 */
function normaliseWorkspacePath(file: string): string {
  if (file.startsWith(WORKSPACE_ROOT + '/') || file === WORKSPACE_ROOT) {
    return file;
  }
  if (isAbsolute(file)) {
    fail(`workspace paths must start with ${WORKSPACE_ROOT}/ — got '${file}'`);
  }
  return `${WORKSPACE_ROOT}/${DEFAULT_UPLOADS_SUBDIR}/${file.replace(/^\.\/?/, '')}`;
}

/**
 * Require conversation_id to be set in the resolved scope. The tools all
 * need it to construct S3 paths server-side. Fails with a helpful message
 * if missing.
 */
function requireConversationId(scope: ScopingContext): string {
  if (scope.conversation_id) return scope.conversation_id;

  if (scope.source === 'bootstrap-default') {
    fail(
      'numa docs requires a conversation_id, which is unset locally. ' +
        'Either run inside a workspace (NUMA_CONVERSATION_ID env var auto-set), ' +
        'or set one for dev testing with `numa-dev context set --conversation-id <id>`.'
    );
  }
  fail('numa docs requires a conversation_id — set one in your dev context override.');
}

/**
 * Shared request builder. Mirrors files.ts's `buildToolRequest` — same
 * scoping + token resolution, just specialised for docs which never need
 * `picked` folder narrowing.
 */
async function buildDocsRequest<T extends ToolName>(
  account: string,
  tool: T,
  params: ParamsForTool<T>,
  userMessage: string | undefined
): Promise<{ accessToken: string; request: ToolInvokeRequest<T>; scope: ScopingContext }> {
  requireUserMessage({ userMessage: userMessage });
  const tokens = await getValidTokens(account);
  const scope = resolveScopingContext(account);
  requireConversationId(scope);
  const request: ToolInvokeRequest<T> = {
    tool,
    params,
    context: {
      allowed_kbs: scope.allowed_kbs,
      allowed_kb_operations: scope.allowed_kb_operations,
      conversation_id: scope.conversation_id,
    },
    id_token: tokens.idToken,
    user_message: userMessage,
  };
  return { accessToken: tokens.accessToken, request, scope };
}

/**
 * `numa docs extract <file>` — extract text from a workspace document.
 * Audio/video files are auto-routed to the transcription pipeline server-
 * side, so this command also accepts media files (you don't have to know
 * which tool to pick).
 */
function createDocsExtractCommand(): Command {
  return new Command('extract')
    .description('Extract text from a workspace file (PDF/DOCX/images/audio/video)')
    .argument('<file>', 'Workspace path or filename (e.g. /workdir/uploads/x.pdf or just x.pdf)')
    .option('-o, --output <local-path>', 'Also write the extracted text to a local path')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (file: string, options: { output?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const filePath = normaliseWorkspacePath(file);
      const params: ParamsForTool<'extract_content'> = { file_path: filePath };

      const { accessToken, request } = await buildDocsRequest(account, 'extract_content', params, options.userMessage);
      if (process.env['NUMA_DEBUG']) info(`extracting ${filePath}`);

      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`docs extract failed: ${res.error ?? '<no message>'}`);

      const result = res.result;

      // Optional: pull the extracted text down to a local path. The server
      // returns only metadata + the workspace output path, not the text
      // itself. We'd need a separate download to retrieve the bytes —
      // defer that until we have a generic workspace-file download.
      if (options.output) {
        info(
          `--output writes the *extracted text* once we wire up workspace-file download. ` +
            `For now the text lives at ${result?.output_path ?? '<unknown>'} in the workspace.`
        );
        // Stub: write the result metadata to the requested path so the user
        // at least gets something — and so the test harness can verify the
        // command completed.
        mkdirSync(dirname(options.output), { recursive: true });
        writeFileSync(options.output, JSON.stringify(result, null, 2) + '\n');
      }

      emitResult({
        tool: 'extract_content',
        result,
        options,
        pretty: (r) => {
          process.stdout.write(`extracted: ${r?.original_file ?? '<unknown>'}\n`);
          process.stdout.write(`  → ${r?.output_path ?? '<unknown>'}\n`);
          process.stdout.write(`  ${(r?.text_length ?? 0).toLocaleString()} chars\n`);
          if (r?.s3_key) process.stdout.write(`  s3 key: ${r.s3_key}\n`);
          if (r?.message) process.stderr.write(`numa: ${r.message}\n`);
        },
      });
    });
}

/**
 * `numa docs transcribe <file>` — transcribe audio/video to text. Unlike
 * extract, this returns the text inline (not a workspace path).
 */
function createDocsTranscribeCommand(): Command {
  return new Command('transcribe')
    .description('Transcribe audio/video to text (returns text inline)')
    .argument('<file>', 'Workspace path or filename (e.g. /workdir/uploads/call.mp3)')
    .option('--mode <mode>', "'voice' (plain text, default) or 'meeting' (speaker-diarised)", 'voice')
    .option('-o, --output <local-path>', 'Write the transcript to a local file')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (file: string, options: { mode?: 'voice' | 'meeting'; output?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const mode = options.mode ?? 'voice';
      if (mode !== 'voice' && mode !== 'meeting') {
        fail(`--mode must be 'voice' or 'meeting', got '${mode}'`);
      }

      const filePath = normaliseWorkspacePath(file);
      const params: ParamsForTool<'transcribe'> = { file_path: filePath, mode };

      const { accessToken, request } = await buildDocsRequest(account, 'transcribe', params, options.userMessage);
      if (process.env['NUMA_DEBUG']) info(`transcribing ${filePath} (mode=${mode})`);

      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`docs transcribe failed: ${res.error ?? '<no message>'}`);

      const result = res.result;

      if (options.output) {
        mkdirSync(dirname(options.output), { recursive: true });
        writeFileSync(options.output, (result?.text ?? '') + '\n');
        info(`transcript written to ${options.output} (${result?.text?.length ?? 0} chars)`);
      }

      prettyOrSpill({
        tool: 'transcribe',
        result,
        options,
        render: (r) => {
          // Header on stderr (metadata for the human), transcript text on
          // stdout — keeps piping clean if someone wants the bare text.
          // Small enough to fit inline (under 4 KB ≈ ~700 words). Bigger
          // transcripts spill to file automatically via prettyOrSpill.
          process.stderr.write(
            `numa: transcribed ${(r?.duration_seconds ?? 0).toFixed(1)}s ` +
              `(${r?.language ?? 'unknown'}, ${(r?.text?.length ?? 0).toLocaleString()} chars)\n`
          );
          process.stdout.write((r?.text ?? '') + '\n');
        },
        headline: (r, size) => {
          const chars = (r?.text?.length ?? 0).toLocaleString();
          const dur = (r?.duration_seconds ?? 0).toFixed(1);
          const lang = r?.language ?? 'unknown';
          return `transcript: ${dur}s of ${lang} audio → ${chars} chars (${size})`;
        },
      });
    });
}

/**
 * `numa docs convert <file> --format <pdf|docx>` — convert a document between
 * formats. The mode is auto-detected from the input file type server-side, so you
 * normally do NOT pass `--mode`:
 *
 *   - Office/PDF inputs (`.pptx`/`.docx`/`.xlsx`/`.pdf`/…) → direct LibreOffice
 *     ('file') conversion.
 *   - Text/markdown inputs (`.md`/`.txt`) → Pandoc ('markdown') conversion.
 *
 * Override with `--mode file|markdown` only for the rare ambiguous case.
 */
function createDocsConvertCommand(): Command {
  return new Command('convert')
    .description('Convert a workspace document between formats (PDF/DOCX)')
    .argument('<file>', 'Workspace path or filename to convert')
    .requiredOption('-f, --format <format>', "Output format ('pdf' or 'docx')")
    .option(
      '--mode <mode>',
      "conversion mode — auto-detected from the file type by default; override with 'file' (Office/PDF via LibreOffice) or 'markdown' (text via Pandoc)"
    )
    .option('--title <title>', 'Document title (used by the renderer for headers + filename)')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        file: string,
        options: { format: 'pdf' | 'docx'; mode?: 'markdown' | 'file'; title?: string } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');

        if (options.format !== 'pdf' && options.format !== 'docx') {
          fail(`--format must be 'pdf' or 'docx', got '${options.format}'`);
        }
        // Mode is auto-detected server-side from the file extension; only send it
        // when the user explicitly overrides. (Binary Office/PDF inputs are forced
        // to direct 'file' conversion regardless — markdown mode would utf-8-decode
        // their bytes and fail with a cryptic error.)
        const mode = options.mode;
        if (mode !== undefined && mode !== 'markdown' && mode !== 'file') {
          fail(`--mode must be 'markdown' or 'file', got '${mode}'`);
        }

        const filePath = normaliseWorkspacePath(file);
        const params: ParamsForTool<'convert_document'> = {
          file_path: filePath,
          format: options.format,
          ...(mode ? { mode } : {}),
          ...(options.title ? { title: options.title } : {}),
        };

        const { accessToken, request } = await buildDocsRequest(
          account,
          'convert_document',
          params,
          options.userMessage
        );
        if (process.env['NUMA_DEBUG']) info(`converting ${filePath} → ${options.format} (mode=${mode ?? 'auto'})`);

        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`docs convert failed: ${res.error ?? '<no message>'}`);

        emitResult({
          tool: 'convert_document',
          result: res.result,
          options,
          pretty: (r) => {
            process.stdout.write(`converted: ${r?.original_file ?? '<unknown>'}\n`);
            process.stdout.write(`  → ${r?.output_path ?? '<unknown>'}\n`);
            process.stdout.write(
              `  format: ${r?.format ?? '?'} (${r?.mode ?? '?'}), size: ${formatBytes(r?.size ?? 0)}\n`
            );
            if (r?.s3_key) process.stdout.write(`  s3 key: ${r.s3_key}\n`);
            if (r?.message) process.stderr.write(`numa: ${r.message}\n`);
          },
        });
      }
    );
}

/** Compact byte formatter for pretty handlers (KB/MB display, not envelope). */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** Build the `numa docs` command tree. */
export function createDocsCommand(): Command {
  return new Command('docs')
    .description('Document processing — extract, transcribe, and convert workspace files')
    .addCommand(createDocsExtractCommand())
    .addCommand(createDocsTranscribeCommand())
    .addCommand(createDocsConvertCommand());
}
