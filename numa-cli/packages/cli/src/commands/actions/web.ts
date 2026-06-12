/**
 * `numa web <action>` — web search + page fetch. Wraps `workspace-chat-
 * tools`' single `web_search` tool, which dispatches internally on the
 * `operation` param (`'search'` | `'fetch_url'`).
 *
 * Tool gating: server requires `event.allowed_tools` to include
 * `"web_search"`. Same workspace-vs-local resolution as memory/agents:
 * workspace context inherits NUMA_ENABLED_TOOLS (respects frontend
 * toggle); local CLI auto-injects.
 *
 * Two flows worth knowing about:
 *   - `numa web search "query"`         → multi-engine search w/ failover
 *                                          (DDG → Startpage → Yahoo → Google)
 *   - `numa web fetch <url>`            → single-URL scrape (uses the
 *                                          browser Lambda by default)
 *
 * Output shape: search returns `{results: [{title, url, snippet}], ...}`;
 * fetch returns `{content: string, url, ...}`. Both can pick up
 * `summarised_content` when `--summarise` is set. The standard envelope's
 * file-dump kicks in for large `content` payloads automatically (no
 * per-command tuning needed).
 */

import { Command } from 'commander';
import { resolve as resolvePath } from 'node:path';
import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import { atomicDownload } from '../../api/integrity.js';
import type { ParamsForTool, WebSearchResult } from '../../metadata/tool-types.js';
import { fail, info } from '../../output/pretty.js';
import { emitResult, prettyOrSpill } from '../../output/emit.js';
import { addStandardOptions, requireUserMessage, type StandardOptions } from '../../output/cli-args.js';

const WEB_SEARCH_TOOL = 'web_search';

/** Mirror the workspace/local split used by memory + agents. */
function resolveEnabledTools(scope: ScopingContext): string[] {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(WEB_SEARCH_TOOL) ? base : [...base, WEB_SEARCH_TOOL];
}

/**
 * Both subcommands fan into the same `web_search` handler — the only
 * difference is the `operation` discriminator. Factored out so the two
 * commands share the request build + emit path.
 */
async function invokeWebSearch(
  account: string,
  params: ParamsForTool<'web_search'>,
  userMessage: string | undefined
): Promise<{ result: WebSearchResult | undefined }> {
  requireUserMessage({ userMessage: userMessage });
  const tokens = await getValidTokens(account);
  const scope = resolveScopingContext(account);
  const request: ToolInvokeRequest<'web_search'> = {
    tool: 'web_search',
    params,
    context: {
      allowed_kbs: scope.allowed_kbs,
      allowed_kb_operations: scope.allowed_kb_operations,
      enabled_tools: resolveEnabledTools(scope),
      conversation_id: scope.conversation_id || undefined,
    },
    id_token: tokens.idToken,
    user_message: userMessage,
  };
  const res = await invokeTool(account, tokens.accessToken, request);
  if (res.status === 'error') fail(`web search failed: ${res.error ?? '<no message>'}`);
  return { result: res.result };
}

// ── search ──────────────────────────────────────────────────────────────────

function createWebSearchCommand(): Command {
  const cmd = new Command('search')
    .description('Search the web (DuckDuckGo with Startpage/Yahoo/Google failover)')
    .argument('<query>', 'Search query')
    .option('--max <n>', 'Max results (1-10, default 5)', (v) => parseInt(v, 10))
    .option(
      '--intent <text>',
      "What you're trying to accomplish (only used when --summarise is set; sending it alone triggers the server's legacy summary path)"
    )
    .option('--summarise', 'LLM-summarise the scraped pages (default: just URLs + snippets)')
    .option('--force-playwright', 'Always use the headless-browser Lambda (slower, more reliable)');
  addStandardOptions(cmd);
  return cmd.action(
    async (
      query: string,
      options: {
        max?: number;
        intent?: string;
        summarise?: boolean;
        forcePlaywright?: boolean;
      } & StandardOptions
    ) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      // Only forward `user_intent` when --summarise is set. The server
      // treats `user_intent OR summarise` as a signal to use the legacy
      // summary pipeline (which returns `summarised_content`, NOT a
      // `results` array) — sending `--intent` alone silently flips the
      // result shape. Surfacing intent only with summarise keeps the
      // semantics predictable: flag-on → summary, flag-off → list.
      const summarise = options.summarise ?? false;
      const params: ParamsForTool<'web_search'> = {
        operation: 'search',
        query,
        ...(options.max !== undefined ? { max_results: options.max } : {}),
        ...(summarise ? { summarise: true } : {}),
        ...(summarise && options.intent ? { user_intent: options.intent } : {}),
        ...(options.forcePlaywright ? { force_playwright: true } : {}),
      };

      const { result } = await invokeWebSearch(account, params, options.userMessage);

      emitResult({
        tool: 'web_search',
        result,
        options,
        pretty: (r) => {
          const summary = r?.summarised_content;
          const results = r?.results ?? [];
          if (summary) {
            process.stdout.write(`${summary}\n\n`);
            process.stdout.write(`--- sources ---\n`);
          }
          if (results.length === 0) {
            process.stdout.write(r?.hint ?? '(no results)\n');
            return;
          }
          for (const hit of results) {
            process.stdout.write(`${hit.title}\n  ${hit.url}\n`);
            if (hit.snippet) {
              const snippet = hit.snippet.length > 200 ? hit.snippet.slice(0, 199) + '…' : hit.snippet;
              process.stdout.write(`  ${snippet}\n`);
            }
            process.stdout.write('\n');
          }
          if (r?.hint) process.stderr.write(`numa: ${r.hint}\n`);
        },
      });
    }
  );
}

// ── fetch ───────────────────────────────────────────────────────────────────

/**
 * Workspace destination for web-fetched binaries. In the MicroVM the CLI can
 * write straight into the user's workspace; on a laptop we land in the cwd.
 */
const WEB_DOWNLOAD_DIR = '/workdir/uploads/web';

/**
 * Deliver a binary fetch_url result (PDF/zip/image sniffed by browser-lambda
 * and streamed to S3 instead of being mojibake'd into text). Mirrors the
 * deleted MCP layer's `_deliver_binary_fetch_url`:
 *
 *  - newer browser-lambda → presigned `download_url` (+ `download_sha256`):
 *    stream atomically into the workspace, hard-fail on hash mismatch.
 *  - older browser-lambda → no URL: surface the `s3_key` reference so the
 *    bytes aren't lost (tolerant reader).
 */
async function deliverBinaryFetch(r: WebSearchResult, url: string, options: StandardOptions): Promise<void> {
  const s3Key = r.s3_key ?? '';
  if (!r.download_url) {
    emitResult({
      tool: 'web_search',
      result: {
        status: 'success',
        url: r.url ?? url,
        result_type: 'binary_file',
        content_type: r.content_type ?? 'application/octet-stream',
        s3_key: s3Key,
        file_type: r.file_type ?? '',
        file_size: r.file_size ?? 0,
        message:
          'This URL returned binary content (not a text/HTML page), so it was ' +
          'downloaded to storage instead of being read as text. The raw bytes ' +
          'are preserved uncorrupted at the s3_key above.',
      },
      options,
    });
    return;
  }

  // Safe filename: URL basename → s3_key basename → constant. Same
  // sanitisation style as the rest of the platform's download handlers.
  const urlPath = (() => {
    try {
      return new URL(r.url ?? url).pathname;
    } catch {
      return '';
    }
  })();
  const rawName = urlPath.split('/').filter(Boolean).pop() ?? s3Key.split('/').filter(Boolean).pop() ?? '';
  const safeFilename = rawName.replace(/[^\w\s.-]/g, '_').replace(/^[. ]+|[. ]+$/g, '') || 'web_download';

  // In the MicroVM, deliver into the workspace uploads dir (and keep the
  // resolved path inside it — same containment check the MCP layer ran).
  // On a laptop, the cwd is the natural destination.
  const inWorkspace = Boolean(process.env['NUMA_CONVERSATION_ID']);
  const dest = inWorkspace ? `${WEB_DOWNLOAD_DIR}/${safeFilename}` : `./${safeFilename}`;
  if (inWorkspace && !resolvePath(dest).startsWith('/workdir/uploads/')) {
    fail(`invalid download path for fetched binary: ${dest}`);
  }

  try {
    const written = await atomicDownload(r.download_url, dest, {
      ...(r.download_sha256 ? { expectedSha256: r.download_sha256 } : {}),
    });
    info(`fetched binary → ${dest} (${written} bytes${r.download_sha256 ? ', sha256 verified' : ''})`);
    emitResult({
      tool: 'web_search',
      result: {
        status: 'success',
        url: r.url ?? url,
        result_type: 'binary_file',
        content_type: r.content_type ?? 'application/octet-stream',
        file_type: r.file_type ?? '',
        file_size: written,
        output_path: dest,
        sha256_verified: Boolean(r.download_sha256),
        message: `Binary download delivered to ${dest}.`,
      },
      options,
    });
  } catch (e) {
    // Don't pretend the file landed: surface the S3 ref so the bytes aren't
    // lost. On a sha256 mismatch atomicDownload already discarded the temp
    // file, so nothing unverified is left behind.
    fail(
      `failed to download fetched binary into workspace: ${e instanceof Error ? e.message : String(e)} ` +
        `(the binary is preserved uncorrupted at s3_key: ${s3Key || '<unknown>'})`
    );
  }
}

function createWebFetchCommand(): Command {
  const cmd = new Command('fetch')
    .description("Fetch a single URL's content (uses the browser Lambda by default for JS-rendered pages)")
    .argument('<url>', 'URL to fetch')
    .option('--intent <text>', "What you're trying to accomplish (used for --summarise)")
    .option('--summarise', 'LLM-summarise the fetched content')
    .option(
      '--no-playwright',
      'Skip the headless browser; fall back to the lightweight scraper (faster, no JS rendering)'
    );
  addStandardOptions(cmd);
  return cmd.action(
    async (url: string, options: { intent?: string; summarise?: boolean; playwright?: boolean } & StandardOptions) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const params: ParamsForTool<'web_search'> = {
        operation: 'fetch_url',
        url,
        ...(options.intent ? { user_intent: options.intent } : {}),
        ...(options.summarise ? { summarise: true } : {}),
        // commander inverts --no-playwright to playwright:false.
        // Default behaviour is force_playwright=true server-side, so we
        // only need to send the flag when the user opted out.
        ...(options.playwright === false ? { force_playwright: false } : {}),
      };

      const { result } = await invokeWebSearch(account, params, options.userMessage);

      // Binary payload (PDF/zip/image at an extensionless URL): there is no
      // text content to render — deliver the bytes instead.
      if (result?.result_type === 'binary_file') {
        await deliverBinaryFetch(result, url, options);
        return;
      }

      prettyOrSpill({
        tool: 'web_search',
        result,
        options,
        render: (r) => {
          // Small page (under threshold) — render inline. Summary first
          // if present, then raw content.
          if (r?.summarised_content) {
            process.stdout.write(`${r.summarised_content}\n\n`);
            process.stdout.write(`--- raw (${r.content?.length ?? 0} chars from ${r.url ?? url}) ---\n`);
          }
          process.stdout.write(`${r?.content ?? ''}\n`);
        },
        headline: (r, size) => {
          const chars = (r?.content?.length ?? 0).toLocaleString();
          return `fetched ${r?.url ?? url} → ${chars} chars (${size})`;
        },
      });
    }
  );
}

/** Build the `numa web` command tree. */
export function createWebCommand(): Command {
  return new Command('web')
    .description('Web search + page fetch')
    .addCommand(createWebSearchCommand())
    .addCommand(createWebFetchCommand());
}
