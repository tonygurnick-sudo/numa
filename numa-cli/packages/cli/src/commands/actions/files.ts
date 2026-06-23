/**
 * `numa files <action>` — the files (knowledge-base) action surface.
 *
 * Mirrors the workspace agent's `numa_tool` MCP operations 1:1 so the CLI is a
 * drop-in replacement: Numa-the-LLM running `numa files search "policy"` gets
 * the same result as the existing `numa_tool` with `operation=query`.
 *
 * Naming: the user-facing UI calls these "Files" / "Folders" (rebranded from
 * "Knowledge Bases"). The backend still calls them KBs — we keep that
 * vocabulary in the operation names because that's what `workspace-chat-
 * tools` understands.
 *
 * v1 ships read-only commands (`list`, `search`). Write ops (`upload`,
 * `download`, `delete`) follow once HITL is wired.
 *
 * Scoping: the command does not pick which KBs to search itself. The
 * `resolveScopingContext()` helper does that based on execution context
 * (in-workspace env vars / dev-override file / bootstrap default — see
 * `context/resolve.ts`). User can narrow further with `--folder <name|id>`.
 */

import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { atomicDownload, atomicWriteFile, IntegrityError, verifyBufferSha256 } from '../../api/integrity.js';
import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import type { ParamsForTool, ToolName } from '../../metadata/tool-types.js';
import { fail, info } from '../../output/pretty.js';
import { emitResult, prettyOrSpill } from '../../output/emit.js';
import { requireUserMessage, type StandardOptions } from '../../output/cli-args.js';
import { requiresLocalApproval } from '../../context/approval.js';
import { gateWriteOp } from './_hitl.js';

/**
 * KB id → S3 prefix.
 *
 * Mirrors `workspace-chat-tools tools/knowledge_base.py _get_s3_kb_id`:
 *   - System KBs ({company, numa-support}) keep their raw id
 *   - Everything else gets a `kb-` prefix
 *
 * Used when constructing S3 keys for `kb_manager` ops that take full keys
 * in their body (e.g. file move).
 */
const SYSTEM_KB_IDS = new Set(['company', 'numa-support']);
const s3KbPrefix = (kbId: string): string => (SYSTEM_KB_IDS.has(kbId) ? kbId : `kb-${kbId}`);

/**
 * Build the full S3 key for a file in a KB. Used by `mv` which takes an
 * array of full keys in the request body.
 */
const buildS3Key = (kbId: string, filename: string, subpath?: string): string => {
  const prefix = `documents/${s3KbPrefix(kbId)}`;
  const trimmedSub = (subpath ?? '').replace(/^\/+|\/+$/g, '');
  return trimmedSub ? `${prefix}/${trimmedSub}/${filename}` : `${prefix}/${filename}`;
};

/**
 * Resolve `--folder <name-or-id>` against the user's allowed_kbs. Accepts
 * either an exact id (uuid-shaped) or a case-insensitive name match. Returns
 * undefined if the flag wasn't provided.
 */
function pickFolder(flag: string | undefined, scope: ScopingContext): { id: string; name?: string } | undefined {
  if (!flag) return undefined;
  const lower = flag.toLowerCase();
  const byId = scope.allowed_kbs.find((kb) => kb.id === flag);
  if (byId) return byId;
  const byName = scope.allowed_kbs.find((kb) => (kb.name ?? '').toLowerCase() === lower);
  if (byName) return byName;
  fail(
    `unknown folder '${flag}' — not in your allowed list. ` +
      `Available: ${scope.allowed_kbs.map((k) => k.name ?? k.id).join(', ') || '(none)'}`
  );
}

/**
 * `numa files list` — no Lambda call. The bootstrap context already includes
 * the full KB list (`knowledge_bases.kbs`), so listing locally is a single
 * file read with zero latency. Bootstrap is the canonical source for "what
 * folders does this user have access to"; we just project it.
 *
 * When NUMA_CONVERSATION_ID is set (in-workspace), we project from the
 * scope's allowed_kbs instead — matches the MCP tool's behaviour of only
 * showing folders enabled for THIS conversation.
 */
function createFilesListCommand(): Command {
  return new Command('list')
    .description('List folders (knowledge bases) you have access to')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action((options: StandardOptions) => {
      const scope = resolveScopingContext();
      if (process.env['NUMA_DEBUG']) {
        info(`scope source: ${scope.source} (${scope.allowed_kbs.length} folders)`);
      }

      // No tool call here — bootstrap context is local — but still flow through
      // emitResult so the standard envelope works uniformly. The tool name is
      // synthetic; the LLM only needs the schema/sample to know the shape.
      emitResult({
        tool: 'list_folders',
        result: { folders: scope.allowed_kbs },
        options,
        pretty: ({ folders }) => {
          if (folders.length === 0) {
            process.stdout.write('(no folders accessible)\n');
            return;
          }
          const nameWidth = Math.max(...folders.map((kb) => (kb.name ?? '').length), 4);
          process.stdout.write(`${'name'.padEnd(nameWidth)}  id\n`);
          process.stdout.write(`${'-'.repeat(nameWidth)}  ${'-'.repeat(36)}\n`);
          for (const kb of folders) {
            process.stdout.write(`${(kb.name ?? '').padEnd(nameWidth)}  ${kb.id}\n`);
          }
        },
      });
    });
}

/**
 * `numa files search` — RAG query across one or more folders. Maps to the
 * `query_knowledgebase` tool in `workspace-chat-tools` (same tool the
 * workspace agent's MCP layer calls; the MCP `numa_tool` op=query is just a
 * router into this).
 */
function createFilesSearchCommand(): Command {
  return new Command('search')
    .description('Search across enabled folders (RAG query)')
    .argument('<query>', 'Search query (the literal text to match against)')
    .option(
      '--intent <text>',
      "What you're trying to accomplish (used for result summarisation; defaults to the query itself)"
    )
    .option('--folder <name-or-id>', 'Narrow to a single folder (by name or id)')
    .option(
      '--all',
      'Search across all enabled folders (the default when --folder is omitted; --all wins if both are given)'
    )
    .option('--max-results <n>', 'Maximum results to return', (v) => parseInt(v, 10))
    .option('--summarise', 'LLM-summarise the results into a single answer (default: return raw matches)')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        query: string,
        options: {
          intent?: string;
          folder?: string;
          all?: boolean;
          maxResults?: number;
          summarise?: boolean;
        } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');

        const tokens = await getValidTokens(account);
        const scope = resolveScopingContext(account);
        // --all forces a cross-folder search; otherwise --folder narrows to one.
        const picked = options.all ? undefined : pickFolder(options.folder, scope);

        const params: ParamsForTool<'query_knowledgebase'> = {
          query,
          // user_intent only matters when summarising; defaults to the query.
          user_intent: options.intent ?? query,
          // Summarisation is opt-in (--summarise); raw matches by default.
          summarise_results: options.summarise ?? false,
          ...(options.maxResults !== undefined ? { max_results: options.maxResults } : {}),
          ...(picked ? { kb_id: picked.id } : {}),
        };

        const request: ToolInvokeRequest<'query_knowledgebase'> = {
          tool: 'query_knowledgebase',
          params,
          context: {
            allowed_kbs: picked ? [picked] : scope.allowed_kbs,
            allowed_kb_operations: scope.allowed_kb_operations,
            conversation_id: scope.conversation_id || undefined,
          },
          id_token: tokens.idToken,
          user_message: options.userMessage,
        };

        if (process.env['NUMA_DEBUG']) {
          const target = picked ? (picked.name ?? picked.id) : `${scope.allowed_kbs.length} folders`;
          info(`scope source: ${scope.source}, search target: ${target}`);
        }

        const res = await invokeTool(account, tokens.accessToken, request);
        if (res.status === 'error') fail(`files search failed: ${res.error ?? '<no message>'}`);

        prettyOrSpill({
          tool: 'query_knowledgebase',
          result: res.result,
          options,
          render: (r) => {
            if (!r) {
              process.stdout.write('(no result)\n');
              return;
            }
            // 3 result shapes — narrow via field-presence type guards.
            const rec = r as unknown as Record<string, unknown>;

            // 1. Single KB, summarised
            if (typeof rec['summarised_content'] === 'string' && !('kbs_queried' in rec)) {
              process.stdout.write(`${rec['summarised_content']}\n\n`);
              const refs = Array.isArray(rec['references']) ? (rec['references'] as string[]) : [];
              if (refs.length > 0) {
                process.stdout.write(`Sources (${refs.length}):\n`);
                for (const ref of refs.slice(0, 10)) process.stdout.write(`  ${ref}\n`);
                if (refs.length > 10) process.stdout.write(`  …and ${refs.length - 10} more\n`);
              }
              process.stderr.write(
                `numa: ${rec['results_count'] ?? refs.length} results (${rec['provider'] ?? 'kb'})\n`
              );
              return;
            }

            // 2. Single KB, raw
            if (Array.isArray(rec['raw_content']) && !('kbs_queried' in rec)) {
              const snippets = rec['raw_content'] as string[];
              const refs = Array.isArray(rec['references']) ? (rec['references'] as string[]) : [];
              for (let i = 0; i < snippets.length; i++) {
                const snippet = snippets[i] ?? '';
                const ref = refs[i] ?? '';
                process.stdout.write(`[${i + 1}] ${ref}\n`);
                const preview = snippet.length > 400 ? snippet.slice(0, 399) + '…' : snippet;
                process.stdout.write(`    ${preview.replace(/\n/g, '\n    ')}\n\n`);
              }
              process.stderr.write(`numa: ${snippets.length} results (${rec['provider'] ?? 'kb'})\n`);
              return;
            }

            // 3. All-KBs aggregate
            const total = (rec['total_results_count'] as number | undefined) ?? 0;
            const kbs = (rec['kbs_queried'] as string[] | undefined) ?? [];
            process.stdout.write(`Searched ${kbs.length} folders → ${total} results\n`);
            if (typeof rec['summarised_content'] === 'string') {
              process.stdout.write(`\n${rec['summarised_content']}\n`);
            } else if (Array.isArray(rec['raw_content'])) {
              for (const s of (rec['raw_content'] as string[]).slice(0, 5)) {
                const preview = s.length > 200 ? s.slice(0, 199) + '…' : s;
                process.stdout.write(`  ${preview}\n`);
              }
            }
          },
          headline: (r, size) => {
            if (!r) return `search "${query}" → no result (${size})`;
            const rec = r as unknown as Record<string, unknown>;
            const count =
              (rec['total_results_count'] as number | undefined) ?? (rec['results_count'] as number | undefined) ?? 0;
            return `search "${query}" → ${count} results (${size})`;
          },
        });
      }
    );
}

/**
 * Shared helper: build the standard `{tool, params, context, id_token}`
 * request shape. Centralised so every files command applies the same scoping
 * + token resolution.
 */
async function buildToolRequest<T extends ToolName>(
  account: string,
  tool: T,
  params: ParamsForTool<T>,
  picked: { id: string; name?: string } | undefined,
  userMessage: string | undefined
): Promise<{ accessToken: string; request: ToolInvokeRequest<T>; scope: ScopingContext }> {
  requireUserMessage({ userMessage: userMessage });
  const tokens = await getValidTokens(account);
  const scope = resolveScopingContext(account);
  const request: ToolInvokeRequest<T> = {
    tool,
    params,
    context: {
      allowed_kbs: picked ? [picked] : scope.allowed_kbs,
      allowed_kb_operations: scope.allowed_kb_operations,
      conversation_id: scope.conversation_id || undefined,
    },
    id_token: tokens.idToken,
    user_message: userMessage,
  };
  return { accessToken: tokens.accessToken, request, scope };
}

/**
 * Parse a `<folder>/<file>` path. Folder may be a name or id. Returns the
 * resolved folder + filename, or fails loudly if the folder is unknown.
 */
function parseFolderFilePath(
  combined: string,
  scope: ScopingContext
): { folder: { id: string; name?: string }; filename: string } {
  const slash = combined.indexOf('/');
  if (slash === -1) {
    fail(`expected '<folder>/<file>', got '${combined}'`);
  }
  const folderRef = combined.slice(0, slash);
  const filename = combined.slice(slash + 1);
  const folder = pickFolder(folderRef, scope);
  if (!folder) fail(`could not resolve folder '${folderRef}'`);
  if (!filename) fail(`missing filename after '/'`);
  return { folder, filename };
}

/**
 * `numa files show <folder>` — list files inside a folder. Read-only.
 * Wraps `list_kb_files` from workspace-chat-tools (the same tool the
 * frontend uses to populate the folder view).
 */
function createFilesShowCommand(): Command {
  return new Command('show')
    .description('List files inside a folder (optionally a sub-path; -R for the full tree)')
    .argument('<folder>', "Folder name or id, optionally with a sub-path: 'Personal' or 'Personal/reports/2024'")
    .option('-R, --recursive', 'List every file at all depths (like `ls -R`) instead of one level')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (folderRef: string, options: { recursive?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);

      // Split "<folder>/<subpath>" — first segment is the folder (name or id),
      // the rest drills into a subfolder. Folder names/ids never contain '/'.
      const slash = folderRef.indexOf('/');
      const folderPart = slash === -1 ? folderRef : folderRef.slice(0, slash);
      const subpath = slash === -1 ? '' : folderRef.slice(slash + 1).replace(/^\/+|\/+$/g, '');
      const folder = pickFolder(folderPart, scope);
      if (!folder) fail(`could not resolve folder '${folderPart}'`);

      const { accessToken, request } = await buildToolRequest(
        account,
        'list_kb_files',
        {
          kb_ids: [folder.id],
          ...(subpath ? { subpath } : {}),
          ...(options.recursive ? { recursive: true } : {}),
          // An explicit `show` should not silently hide files at the 30-item
          // prompt-context cap; ask for a generous page (the handler spills to
          // S3 if the listing is genuinely huge).
          max_items: 1000,
        },
        folder,
        options.userMessage
      );
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`files show failed: ${res.error ?? '<no message>'}`);

      prettyOrSpill({
        tool: 'list_kb_files',
        result: res.result,
        options,
        render: (r) => {
          const listings = r?.listings ?? {};
          const ids = Object.keys(listings);
          if (ids.length === 0) {
            process.stdout.write('(no folders in result)\n');
            return;
          }
          for (const kbId of ids) {
            const listing = listings[kbId]!;
            const files = listing.files ?? [];
            const folders = listing.folders ?? [];
            const scopeLabel = `${folder.name ?? kbId}${subpath ? `/${subpath}` : ''}${options.recursive ? ' (recursive)' : ''}`;
            const header = `${scopeLabel} — ${listing.total_count} file${listing.total_count === 1 ? '' : 's'}${listing.truncated ? ' (truncated)' : ''}`;
            process.stdout.write(`${header}\n`);
            if (files.length === 0 && folders.length === 0) {
              process.stdout.write('  (empty)\n');
              continue;
            }
            if (folders.length > 0) {
              process.stdout.write('  folders:\n');
              for (const f of folders) process.stdout.write(`    ${f}/\n`);
            }
            if (files.length > 0) {
              const nameWidth = Math.max(...files.map((f) => f.name.length), 4);
              process.stdout.write(`  ${'name'.padEnd(nameWidth)}  size\n`);
              process.stdout.write(`  ${'-'.repeat(nameWidth)}  ----\n`);
              for (const f of files) {
                process.stdout.write(`  ${f.name.padEnd(nameWidth)}  ${f.size_formatted}\n`);
              }
            }
          }
          const errors = r?.errors ?? [];
          if (errors.length > 0) {
            process.stderr.write(`numa: ${errors.length} error${errors.length === 1 ? '' : 's'}:\n`);
            for (const e of errors) process.stderr.write(`  ${e.kb_id}: ${e.error}\n`);
          }
        },
        headline: (r, size) => {
          const listings = r?.listings ?? {};
          const totalFiles = Object.values(listings).reduce((sum, l) => sum + (l?.total_count ?? 0), 0);
          return `${folder.name ?? folder.id} — ${totalFiles} files (${size})`;
        },
      });
    });
}

/**
 * `numa files download <folder>/<file> [-o <path>]` — fetch a file's bytes.
 * Uses `retrieve_kb_file` mode=download with `get_presigned_url=true` so the
 * actual file transfer goes through S3, not through the API Gateway (the
 * 30-second API timeout would kill larger files otherwise).
 */
function createFilesDownloadCommand(): Command {
  return new Command('download')
    .description('Download a file from a folder (uses a presigned S3 URL under the hood)')
    .argument('<folder-slash-file>', "e.g. 'Personal/notes.md' or '<folder-id>/notes.md'")
    .option('-o, --output <path>', 'Local path to write to. Defaults to ./<filename>')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Write file + print status (default in TTY)')
    .option('--standard', 'Skip file write — emit metadata in standard envelope')
    .option('--json', 'Skip file write — emit raw metadata JSON')
    .action(async (combined: string, options: { output?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      requireUserMessage({ userMessage: options.userMessage });
      const scope = resolveScopingContext(account);
      const { folder, filename } = parseFolderFilePath(combined, scope);

      const { accessToken, request } = await buildToolRequest(
        account,
        'retrieve_kb_file',
        {
          mode: 'download',
          kb_id: folder.id,
          file: filename,
          get_presigned_url: true,
          auto_approved: true, // user consented by typing the command
        },
        folder,
        options.userMessage
      );
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`files download failed: ${res.error ?? '<no message>'}`);
      // retrieve_kb_file is a discriminated union — narrow to the download
      // variant. The CLI only ever issues mode=download here so the cast
      // is safe; alternatives would surface in res.result for callers
      // doing list/download_folder.
      const result = (res.result ?? {}) as {
        filename?: string;
        size_bytes?: number;
        presigned_url?: string;
        content_base64?: string;
        download_sha256?: string;
      };

      // --json / --standard are explicit-only and mean "give me metadata,
      // don't fetch the bytes". The TTY default (--pretty) writes the file
      // — that's the command's whole purpose. emitResult handles the
      // envelope wrapping for --standard.
      if (options.json || options.standard) {
        emitResult({ tool: 'retrieve_kb_file', result, options });
        return;
      }

      const outPath = options.output ?? `./${result.filename ?? filename}`;
      try {
        if (result.presigned_url) {
          // The presigned path carries no sha256 by design (the Lambda never
          // pulls the large file through itself) — size_bytes is the
          // truncation check. atomicDownload streams to a temp file and only
          // renames into place once the byte count matches.
          const written = await atomicDownload(result.presigned_url, outPath, {
            ...(typeof result.size_bytes === 'number' && result.size_bytes > 0
              ? { expectedSize: result.size_bytes }
              : {}),
          });
          info(`downloaded ${written} bytes → ${outPath}`);
        } else if (result.content_base64) {
          const buf = Buffer.from(result.content_base64, 'base64');
          if (result.download_sha256) verifyBufferSha256(buf, result.download_sha256, 'files download');
          await atomicWriteFile(outPath, buf);
          info(`downloaded ${buf.length} bytes${result.download_sha256 ? ' (sha256 verified)' : ''} → ${outPath}`);
        } else {
          fail('download response missing both presigned_url and content_base64');
        }
      } catch (e) {
        if (e instanceof IntegrityError) fail(`files download failed integrity check: ${e.message}`);
        throw e;
      }
    });
}

/**
 * `numa files upload <local> --to <folder>` — push a local file into a
 * folder. Wraps `add_to_kb`. Auto-approved (typing the command IS the
 * consent); Phase 3 will add terminal prompts on the dev binary.
 */
function createFilesUploadCommand(): Command {
  return new Command('upload')
    .description('Upload a local file into a folder')
    .argument('<local-path>', 'Local file path')
    .option('--to <folder>', 'Destination folder (name or id)')
    .option('--folder <folder>', 'Alias for --to (destination folder)')
    .option(
      '--path <subpath>',
      'Subfolder inside the destination folder (e.g. "archive/q3" → folder/archive/q3/<filename>)'
    )
    .option('--filename <name>', 'Override the destination filename (defaults to local basename)')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(
      async (
        localPath: string,
        options: { to?: string; folder?: string; path?: string; filename?: string; yes?: boolean } & StandardOptions
      ) => {
        const account = activeProfile();
        if (!account) fail('no active profile — run `numa login` first');
        if (!existsSync(localPath)) fail(`local file not found: ${localPath}`);
        // --to is canonical; --folder is an accepted alias.
        const dest = options.to ?? options.folder;
        if (!dest) fail("required option '--to <folder>' not specified (or use --folder)");
        const scope = resolveScopingContext(account);
        const folder = pickFolder(dest, scope);
        if (!folder) fail(`could not resolve folder '${dest}'`);

        const fileBuf = readFileSync(localPath);
        const dstName = options.filename ?? basename(localPath);
        const subpath = (options.path ?? '').replace(/^\/+|\/+$/g, '');
        const displayPath = subpath
          ? `${folder.name ?? folder.id}/${subpath}/${dstName}`
          : `${folder.name ?? folder.id}/${dstName}`;

        // Terminal HITL — gated on the user's per-category approval policy.
        const { requestId, autoApproved } = await gateWriteOp({
          requiresApproval: requiresLocalApproval('knowledgeBases', 'upload', account),
          yes: !!options.yes,
          confirmOpts: {
            title: `Upload ${dstName} (${fileBuf.length} bytes) → ${displayPath}`,
            detail: [`Source: ${localPath}`, 'Overwrites any file with the same name in this folder.'],
          },
          emit: {
            actionKey: 'numa_knowledgeBases_upload',
            toolName: 'numa_knowledge_base_tool',
            description: options.userMessage!,
            propsPreview: { kb_id: folder.id, filename: dstName },
            approvalCategory: 'numa_tool',
          },
        });

        const params: ParamsForTool<'add_to_kb'> = {
          kb_id: folder.id,
          filename: dstName,
          content_base64: fileBuf.toString('base64'),
          auto_approved: autoApproved,
          // add_to_kb accepts an optional `kb_path` for subfolder placement
          // (workspace-chat-tools/tools/knowledge_base.py line 993).
          ...(subpath ? { kb_path: subpath } : {}),
        };

        const { accessToken, request } = await buildToolRequest(
          account,
          'add_to_kb',
          params,
          folder,
          options.userMessage
        );
        if (requestId) request.request_id = requestId;
        const res = await invokeTool(account, accessToken, request);
        if (res.status === 'error') fail(`files upload failed: ${res.error ?? '<no message>'}`);

        emitResult({
          tool: 'add_to_kb',
          result: res.result,
          options,
          pretty: () => info(`uploaded ${fileBuf.length} bytes → ${displayPath}`),
        });
      }
    );
}

/**
 * `numa files delete <folder>/<file>` — remove a file. Wraps `delete_kb_file`.
 * The destructive op gets a stronger gate: the terminal prompt requires the
 * user to type the full word `yes` (not just `y`), matching the
 * `rm -i` / `terraform destroy` convention for ops that can't be undone.
 *
 * `--yes` skips the prompt. Non-TTY (script / workspace agent) passes
 * through silently — workspace-bound HITL goes through a separate
 * DDB+SSE flow.
 */
function createFilesDeleteCommand(): Command {
  return new Command('delete')
    .description('Delete a file from a folder')
    .argument('<folder-slash-file>', "e.g. 'Personal/old-notes.md'")
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (combined: string, options: { yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);
      const { folder, filename } = parseFolderFilePath(combined, scope);

      const { requestId, autoApproved } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('knowledgeBases', 'delete', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `Delete ${folder.name ?? folder.id}/${filename}`,
          detail: ['This permanently removes the file. It cannot be undone.'],
          requireWord: 'yes',
        },
        emit: {
          actionKey: 'numa_knowledgeBases_delete',
          toolName: 'numa_knowledge_base_tool',
          description: options.userMessage!,
          propsPreview: { kb_id: folder.id, filename },
          approvalCategory: 'numa_tool',
        },
      });

      const { accessToken, request } = await buildToolRequest(
        account,
        'delete_kb_file',
        {
          kb_id: folder.id,
          filename,
          auto_approved: autoApproved,
        },
        folder,
        options.userMessage
      );
      if (requestId) request.request_id = requestId;
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`files delete failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'delete_kb_file',
        result: res.result,
        options,
        pretty: () => info(`deleted ${folder.name ?? folder.id}/${filename}`),
      });
    });
}

/**
 * `numa files download-folder <folder> [-o <path>]` — bulk download. Wraps
 * `retrieve_kb_file` mode=download_folder which returns the whole folder as
 * a zip. Read-only op (in the KB "safe" set), so no approval prompt regardless
 * of policy.
 *
 * We write the zip to disk as-is rather than extract — keeps the Lambda
 * bundle dep-free (no `adm-zip` / `unzipper`). User extracts with their
 * tool of choice.
 */
function createFilesDownloadFolderCommand(): Command {
  return new Command('download-folder')
    .description('Download a whole folder as a zip')
    .argument('<folder>', 'Folder name or id')
    .option('-o, --output <path>', 'Local zip path to write. Defaults to ./<folder-name>.zip in the current dir')
    .option('--folder-path <path>', 'Subfolder path within the KB (defaults to root)')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Write zip + print status (default in TTY)')
    .option('--standard', 'Skip zip write — emit metadata in standard envelope')
    .option('--json', 'Skip zip write — emit raw metadata JSON')
    .action(async (folderRef: string, options: { output?: string; folderPath?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);
      const folder = pickFolder(folderRef, scope);
      if (!folder) fail(`could not resolve folder '${folderRef}'`);

      const { accessToken, request } = await buildToolRequest(
        account,
        'retrieve_kb_file',
        {
          mode: 'download_folder',
          kb_id: folder.id,
          folder_path: options.folderPath ?? '',
          auto_approved: true,
        },
        folder,
        options.userMessage
      );
      const res = await invokeTool(account, accessToken, request);
      if (res.status === 'error') fail(`files download-folder failed: ${res.error ?? '<no message>'}`);
      // Discriminated union narrowing — this command always sends
      // mode=download_folder so we know which variant came back.
      const result = (res.result ?? {}) as {
        filename?: string;
        size_bytes?: number;
        file_count?: number;
        content_base64?: string;
        presigned_url?: string;
        download_sha256?: string;
      };

      // --json / --standard are explicit-only here (same rationale as
      // `download`): the command's whole job is to write a zip,
      // regardless of TTY. Either flag means "metadata only, don't fetch".
      if (options.json || options.standard) {
        emitResult({ tool: 'retrieve_kb_file', result, options });
        return;
      }

      const safeName = (folder.name ?? folder.id).replace(/[^a-zA-Z0-9._-]+/g, '-');
      const outPath = options.output ?? `./${safeName}.zip`;
      try {
        if (result.presigned_url) {
          // The zip path stamps download_sha256 on BOTH variants — verify it
          // end-to-end while streaming, plus the byte count when supplied.
          const written = await atomicDownload(result.presigned_url, outPath, {
            ...(result.download_sha256 ? { expectedSha256: result.download_sha256 } : {}),
            ...(typeof result.size_bytes === 'number' && result.size_bytes > 0
              ? { expectedSize: result.size_bytes }
              : {}),
          });
          info(
            `downloaded ${result.file_count ?? '?'} files, ${written} bytes` +
              `${result.download_sha256 ? ' (sha256 verified)' : ''} → ${outPath}`
          );
        } else if (result.content_base64) {
          const buf = Buffer.from(result.content_base64, 'base64');
          if (result.download_sha256) verifyBufferSha256(buf, result.download_sha256, 'files download-folder');
          await atomicWriteFile(outPath, buf);
          info(
            `downloaded ${result.file_count ?? '?'} files, ${buf.length} bytes` +
              `${result.download_sha256 ? ' (sha256 verified)' : ''} → ${outPath}`
          );
        } else {
          fail('download-folder response missing both presigned_url and content_base64');
        }
      } catch (e) {
        if (e instanceof IntegrityError) fail(`files download-folder failed integrity check: ${e.message}`);
        throw e;
      }
    });
}

/**
 * `numa files find <pattern>` — filename search via `retrieve_kb_file`
 * mode=list. Read-only / "safe" op, no approval prompt regardless of policy.
 *
 * Two pieces of pattern matching to keep straight:
 *   - The `pattern` param is glob-style filename matching (fnmatch under
 *     the hood, per the workspace-chat-tools handler).
 *   - We pre-filter the scope: only the requested `--folder` (or every
 *     allowed folder when not given) is searched.
 *
 * For semantic content search, use `numa files search` instead.
 */
function createFilesFindCommand(): Command {
  return new Command('find')
    .description(
      'Search by filename pattern (glob), recursively across all subfolders. For content search use `numa files search`.'
    )
    .argument(
      '<pattern>',
      "Glob pattern matched against the file path. '*.pdf' finds PDFs at any depth; 'reports/*.csv' and '**/notes-*.md' scope by sub-path."
    )
    .option('--folder <name-or-id>', 'Narrow to a single folder (defaults to all allowed)')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (pattern: string, options: { folder?: string } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);
      const picked = pickFolder(options.folder, scope);
      const targets = picked ? [picked] : scope.allowed_kbs;
      if (targets.length === 0) fail('no folders accessible');

      // Fan out per folder — retrieve_kb_file mode=list takes a single kb_id
      // per call, so we issue one tool invoke per folder and aggregate.
      const tokens = await getValidTokens(account);
      const perFolder = await Promise.all(
        targets.map(async (folder) => {
          const { request } = await buildToolRequest(
            account,
            'retrieve_kb_file',
            { mode: 'list', kb_id: folder.id, pattern, recursive: true, auto_approved: true },
            folder,
            options.userMessage
          );
          const res = await invokeTool(account, tokens.accessToken, request);
          return { folder, result: res.status === 'error' ? null : res.result, error: res.error };
        })
      );

      const out = {
        pattern,
        matches: perFolder.map((p) => ({
          folder: { id: p.folder.id, name: p.folder.name },
          files: p.result && typeof p.result === 'object' && 'files' in p.result ? p.result.files : [],
          error: p.error,
        })),
      };

      emitResult({
        // Aggregated result across folders — use a descriptive synthetic
        // name (the underlying tool fan-out called retrieve_kb_file per
        // folder, but the aggregated shape is unique to this command).
        tool: 'find_files',
        result: out,
        options,
        pretty: (o) => {
          const totalCount = o.matches.reduce((sum, m) => sum + (Array.isArray(m.files) ? m.files.length : 0), 0);
          if (totalCount === 0) {
            process.stdout.write(`no files matching '${pattern}'\n`);
            return;
          }
          for (const m of o.matches) {
            if (!Array.isArray(m.files) || m.files.length === 0) continue;
            process.stdout.write(`\n${m.folder.name ?? m.folder.id}:\n`);
            for (const f of m.files) {
              const entry = f as { name?: string; relpath?: string; size?: number; size_formatted?: string };
              // Show the sub-path of nested hits so the user can tell where a
              // match lives; falls back to the basename at the folder root.
              const label = entry.relpath ?? entry.name;
              process.stdout.write(`  ${label}${entry.size_formatted ? `  (${entry.size_formatted})` : ''}\n`);
            }
          }
        },
      });
    });
}

/**
 * `numa files mv <src-folder>/<file> <dst-folder>[/<sub-path>]` — move a file
 * across (or within) folders. Wraps `kb_manager`'s
 * `POST /api/kb/{kb_id}/files/move`. Subfolder paths are supported on both
 * sides (`Personal/archive/notes.md`).
 *
 * Permissions: kb_manager requires EDITOR on source AND destination KB
 * (server-side check; we just send the request).
 */
function createFilesMoveCommand(): Command {
  return new Command('mv')
    .description('Move a file between folders (or to a subfolder)')
    .argument('<src>', "Source 'folder/file' or 'folder/subpath/file'")
    .argument('<dst>', "Destination folder, or 'folder/subpath' to land inside a subfolder")
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (src: string, dst: string, options: { yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);

      // Source: must include a filename.
      const srcSlash = src.indexOf('/');
      if (srcSlash === -1) fail(`expected '<src-folder>/<file>', got '${src}'`);
      const srcFolderRef = src.slice(0, srcSlash);
      const srcRest = src.slice(srcSlash + 1);
      const srcFolder = pickFolder(srcFolderRef, scope);
      if (!srcFolder) fail(`could not resolve source folder '${srcFolderRef}'`);
      // Split rest into subpath + filename
      const srcRestSlash = srcRest.lastIndexOf('/');
      const srcSubpath = srcRestSlash === -1 ? '' : srcRest.slice(0, srcRestSlash);
      const srcFilename = srcRestSlash === -1 ? srcRest : srcRest.slice(srcRestSlash + 1);
      if (!srcFilename) fail('source filename missing');

      // Destination: optional subpath, no filename (file keeps its name).
      const dstSlash = dst.indexOf('/');
      const dstFolderRef = dstSlash === -1 ? dst : dst.slice(0, dstSlash);
      const dstSubpath = dstSlash === -1 ? '' : dst.slice(dstSlash + 1).replace(/^\/+|\/+$/g, '');
      const dstFolder = pickFolder(dstFolderRef, scope);
      if (!dstFolder) fail(`could not resolve destination folder '${dstFolderRef}'`);

      // mv moves a file INTO a folder (it keeps its name). If the destination's
      // last segment looks like a filename, the user probably meant to rename —
      // nudge them toward `numa files rename` rather than silently creating a
      // subfolder named e.g. "renamed.md".
      const dstLeaf = (dstSubpath || dstFolderRef).split('/').pop() ?? '';
      if (/\.[a-z0-9]{1,5}$/i.test(dstLeaf)) {
        info(
          `'${dstLeaf}' looks like a filename. \`mv\` moves a file INTO a folder (keeping its name) ` +
            `— to rename a file in place, use \`numa files rename ${src} <new-name>\` instead.`
        );
      }

      const srcKey = buildS3Key(srcFolder.id, srcFilename, srcSubpath || undefined);
      const srcDisplay = `${srcFolder.name ?? srcFolder.id}/${srcSubpath ? srcSubpath + '/' : ''}${srcFilename}`;
      const dstDisplay = `${dstFolder.name ?? dstFolder.id}/${dstSubpath ? dstSubpath + '/' : ''}${srcFilename}`;

      // Move is a write op against both source AND destination — treat as
      // requiring approval. Approval check uses the destination's policy.
      const { requestId } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('knowledgeBases', 'mv', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `Move ${srcDisplay} → ${dstDisplay}`,
          detail: ['Source file is removed and re-created at the destination. Cannot be undone.'],
          requireWord: 'yes',
        },
        emit: {
          actionKey: 'numa_knowledgeBases_mv',
          toolName: 'numa_knowledge_base_tool',
          description: options.userMessage ?? `Move ${srcDisplay} → ${dstDisplay}`,
          propsPreview: { src: srcDisplay, dest: dstDisplay },
          approvalCategory: 'numa_tool',
        },
      });

      const tokens = await getValidTokens(account);
      const params: ParamsForTool<'move_kb_file'> = {
        kb_id: srcFolder.id, // URL path: /api/kb/{kb_id}/files/move (source)
        keys: [srcKey],
        destKbId: dstFolder.id,
        destPath: dstSubpath,
      };
      const request: ToolInvokeRequest<'move_kb_file'> = {
        tool: 'move_kb_file',
        params,
        // Forward scope hints; kb_manager doesn't use them (it has its own
        // DDB permission check), but keeping the shape consistent across all
        // CLI tool invocations is cheap and helpful.
        context: {
          allowed_kbs: [srcFolder, dstFolder],
          allowed_kb_operations: scope.allowed_kb_operations,
          conversation_id: scope.conversation_id || undefined,
        },
        id_token: tokens.idToken,
        user_message: options.userMessage,
      };
      if (requestId) request.request_id = requestId;

      const res = await invokeTool(account, tokens.accessToken, request);
      if (res.status === 'error') fail(`files mv failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'move_kb_file',
        result: res.result,
        options,
        pretty: () => info(`moved ${srcDisplay} → ${dstDisplay}`),
      });
    });
}

/**
 * `numa files rename <src> <new-filename>` — rename a file in-place. Wraps
 * kb_manager's `POST /api/kb/{kb_id}/files/rename` which is deliberately
 * scoped to "same folder, new name" (path separators in newFilename are
 * rejected server-side to prevent folder traversal).
 *
 * For moving across folders OR into a subfolder, use `numa files mv` —
 * that's a separate API endpoint with different semantics. Combined
 * move+rename = two CLI calls.
 */
function createFilesRenameCommand(): Command {
  return new Command('rename')
    .description('Rename a file in place (same folder + subpath, new filename only)')
    .argument('<src>', "Source 'folder/file' or 'folder/subpath/file'")
    .argument('<new-filename>', 'New filename only — no path separators (use `mv` for folder changes)')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (src: string, newFilename: string, options: { yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      if (newFilename.includes('/') || newFilename.includes('\\') || newFilename.includes('..')) {
        fail(`<new-filename> must not contain path separators or '..'. ` + 'Use `numa files mv` to change folders.');
      }

      const scope = resolveScopingContext(account);
      const srcSlash = src.indexOf('/');
      if (srcSlash === -1) fail(`expected '<folder>/<file>', got '${src}'`);
      const srcFolderRef = src.slice(0, srcSlash);
      const srcRest = src.slice(srcSlash + 1);
      const srcFolder = pickFolder(srcFolderRef, scope);
      if (!srcFolder) fail(`could not resolve folder '${srcFolderRef}'`);
      const srcRestSlash = srcRest.lastIndexOf('/');
      const srcSubpath = srcRestSlash === -1 ? '' : srcRest.slice(0, srcRestSlash);
      const srcFilename = srcRestSlash === -1 ? srcRest : srcRest.slice(srcRestSlash + 1);
      if (!srcFilename) fail('source filename missing');

      const srcKey = buildS3Key(srcFolder.id, srcFilename, srcSubpath || undefined);
      const srcDisplay = `${srcFolder.name ?? srcFolder.id}/${srcSubpath ? srcSubpath + '/' : ''}${srcFilename}`;
      const dstDisplay = `${srcFolder.name ?? srcFolder.id}/${srcSubpath ? srcSubpath + '/' : ''}${newFilename}`;

      // Rename is a destructive op (the original key is deleted after copy).
      // Use the same approval gating as `mv`.
      const { requestId } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('knowledgeBases', 'rename', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `Rename ${srcDisplay} → ${dstDisplay}`,
          detail: ['Original file is removed and re-created with the new name. Cannot be undone.'],
          requireWord: 'yes',
        },
        emit: {
          actionKey: 'numa_knowledgeBases_rename',
          toolName: 'numa_knowledge_base_tool',
          description: options.userMessage ?? `Rename ${srcDisplay} → ${dstDisplay}`,
          propsPreview: { src: srcDisplay, dest: dstDisplay },
          approvalCategory: 'numa_tool',
        },
      });

      const tokens = await getValidTokens(account);
      const params: ParamsForTool<'rename_kb_file'> = {
        kb_id: srcFolder.id, // URL path: /api/kb/{kb_id}/files/rename
        key: srcKey,
        newFilename,
      };
      const request: ToolInvokeRequest<'rename_kb_file'> = {
        tool: 'rename_kb_file',
        params,
        context: {
          allowed_kbs: [srcFolder],
          allowed_kb_operations: scope.allowed_kb_operations,
          conversation_id: scope.conversation_id || undefined,
        },
        id_token: tokens.idToken,
        user_message: options.userMessage,
      };
      if (requestId) request.request_id = requestId;

      const res = await invokeTool(account, tokens.accessToken, request);
      if (res.status === 'error') fail(`files rename failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'rename_kb_file',
        result: res.result,
        options,
        pretty: () => info(`renamed ${srcDisplay} → ${dstDisplay}`),
      });
    });
}

/**
 * `numa files mkdir <folder>/<subpath>` — create an empty subfolder inside an
 * existing folder. Wraps kb_manager's `POST /api/kb/{kb_id}/folders`.
 *
 * Subfolders are S3 prefixes — created by writing a zero-byte marker object
 * with a trailing slash so they show up in listings even when empty. Doesn't
 * (and can't) create top-level folders (KBs); those are admin-managed.
 */
function createFilesMkdirCommand(): Command {
  return new Command('mkdir')
    .description('Create an empty subfolder inside an existing folder')
    .argument('<folder-slash-path>', "e.g. 'Personal/test-subfolder' or 'Personal/reports/q3'")
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (combined: string, options: { yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);

      const slash = combined.indexOf('/');
      if (slash === -1) fail(`expected '<folder>/<subpath>', got '${combined}'`);
      const folderRef = combined.slice(0, slash);
      const subpath = combined.slice(slash + 1).replace(/^\/+|\/+$/g, '');
      const folder = pickFolder(folderRef, scope);
      if (!folder) fail(`could not resolve folder '${folderRef}'`);
      if (!subpath) fail('missing subfolder path');

      const { requestId } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('knowledgeBases', 'mkdir', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `Create subfolder ${folder.name ?? folder.id}/${subpath}/`,
        },
        emit: {
          actionKey: 'numa_knowledgeBases_mkdir',
          toolName: 'numa_knowledge_base_tool',
          description: options.userMessage ?? `Create subfolder ${folder.name ?? folder.id}/${subpath}/`,
          propsPreview: { kb_id: folder.id, path: subpath },
          approvalCategory: 'numa_tool',
        },
      });

      const tokens = await getValidTokens(account);
      const request: ToolInvokeRequest<'create_kb_subfolder'> = {
        tool: 'create_kb_subfolder',
        params: {
          kb_id: folder.id, // → URL path /api/kb/{kb_id}/folders
          path: subpath, // → body
        },
        context: {
          allowed_kbs: [folder],
          allowed_kb_operations: scope.allowed_kb_operations,
          conversation_id: scope.conversation_id || undefined,
        },
        id_token: tokens.idToken,
        user_message: options.userMessage,
      };
      if (requestId) request.request_id = requestId;

      const res = await invokeTool(account, tokens.accessToken, request);
      if (res.status === 'error') fail(`files mkdir failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'create_kb_subfolder',
        result: res.result,
        options,
        pretty: () => info(`created ${folder.name ?? folder.id}/${subpath}/`),
      });
    });
}

/**
 * `numa files rmdir <folder>/<subpath>` — delete a subfolder (and its
 * contents). Wraps kb_manager's `POST /api/kb/{kb_id}/folders/delete`.
 * Destructive — requires explicit `yes` confirmation unless --yes.
 */
function createFilesRmdirCommand(): Command {
  return new Command('rmdir')
    .description('Delete a subfolder and everything inside it')
    .argument('<folder-slash-path>', "e.g. 'Personal/test-subfolder'")
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option(
      '-m, --user-message <text>',
      'Short caption shown to the user in chat ("Numa <cat>: <msg>"); also the approval card text on HITL writes'
    )
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (combined: string, options: { yes?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');
      const scope = resolveScopingContext(account);

      const slash = combined.indexOf('/');
      if (slash === -1) fail(`expected '<folder>/<subpath>', got '${combined}'`);
      const folderRef = combined.slice(0, slash);
      const subpath = combined.slice(slash + 1).replace(/^\/+|\/+$/g, '');
      const folder = pickFolder(folderRef, scope);
      if (!folder) fail(`could not resolve folder '${folderRef}'`);
      if (!subpath) fail('missing subfolder path');

      const { requestId } = await gateWriteOp({
        requiresApproval: requiresLocalApproval('knowledgeBases', 'rmdir', account),
        yes: !!options.yes,
        confirmOpts: {
          title: `Delete subfolder ${folder.name ?? folder.id}/${subpath}/`,
          detail: ['Removes the folder and every file inside it. Cannot be undone.'],
          requireWord: 'yes',
        },
        emit: {
          actionKey: 'numa_knowledgeBases_rmdir',
          toolName: 'numa_knowledge_base_tool',
          description: options.userMessage ?? `Delete subfolder ${folder.name ?? folder.id}/${subpath}/`,
          propsPreview: { kb_id: folder.id, path: subpath },
          approvalCategory: 'numa_tool',
        },
      });

      const tokens = await getValidTokens(account);
      const request: ToolInvokeRequest<'delete_kb_subfolder'> = {
        tool: 'delete_kb_subfolder',
        params: { kb_id: folder.id, path: subpath },
        context: {
          allowed_kbs: [folder],
          allowed_kb_operations: scope.allowed_kb_operations,
          conversation_id: scope.conversation_id || undefined,
        },
        id_token: tokens.idToken,
        user_message: options.userMessage,
      };
      if (requestId) request.request_id = requestId;

      const res = await invokeTool(account, tokens.accessToken, request);
      if (res.status === 'error') fail(`files rmdir failed: ${res.error ?? '<no message>'}`);

      emitResult({
        tool: 'delete_kb_subfolder',
        result: res.result,
        options,
        pretty: () => info(`deleted ${folder.name ?? folder.id}/${subpath}/`),
      });
    });
}

export function createFilesCommand(): Command {
  return new Command('files')
    .description('Search and manage your Numa files (folders / knowledge bases)')
    .addCommand(createFilesListCommand())
    .addCommand(createFilesShowCommand())
    .addCommand(createFilesSearchCommand())
    .addCommand(createFilesFindCommand())
    .addCommand(createFilesDownloadCommand())
    .addCommand(createFilesDownloadFolderCommand())
    .addCommand(createFilesUploadCommand())
    .addCommand(createFilesMoveCommand())
    .addCommand(createFilesRenameCommand())
    .addCommand(createFilesMkdirCommand())
    .addCommand(createFilesRmdirCommand())
    .addCommand(createFilesDeleteCommand());
}
