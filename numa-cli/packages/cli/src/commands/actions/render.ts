/**
 * `numa render` — display HTML/SVG/image content inline in the chat.
 *
 * Unlike every other action command, render is NOT a data call to the
 * dispatcher Lambda. It pushes a synthetic `tool_render` event straight onto
 * the workspace agent's localhost SSE queue (the SAME rail as HITL approvals,
 * via /internal/emit-render). The frontend drains it and renders the content
 * inline through RenderToolRenderer. There is no token, no scope, no Lambda —
 * just a localhost POST.
 *
 * Because the transport is the live SSE stream, render ONLY works inside an
 * active workspace chat (NUMA_AUTH_MODE=workspace-iam + NUMA_CONVERSATION_ID,
 * detected by `workspaceHitlContext()`). Run locally with neither set, it
 * fails fast with a clear message. Run inside a non-streaming context (no
 * queue drained), the agent returns 409 and we tell the user a live stream is
 * required.
 *
 * Two content sources, mutually exclusive:
 *   --content <str>     inline HTML/SVG (html only)
 *   --file-path <path>  a file under /workdir/. html → read text; image →
 *                       read + base64-encode + derive mime_type from the
 *                       extension.
 *
 * `--type` may be omitted when `--file-path` is given — we infer it from the
 * extension (.html/.htm/.svg → html; .png/.jpg/.jpeg/.gif/.webp → image).
 */

import { Command } from 'commander';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  workspaceHitlContext,
  emitWorkspaceRender,
  NoActiveStreamError,
  type RenderType,
} from '../../context/workspace-approval.js';
import { fail, info, success } from '../../output/pretty.js';
import { requireUserMessage, type StandardOptions } from '../../output/cli-args.js';

const WORKSPACE_ROOT = '/workdir';
/** Backend caps render payloads at 2MB — reject oversized files client-side. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Extension → render type. Drives `--type` inference from `--file-path`. */
const HTML_EXTS = new Set(['.html', '.htm', '.svg']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** Extension → image MIME type, sent so the frontend can build the data URI. */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Infer the render type from a file extension, or null if unrecognised. */
function inferTypeFromPath(filePath: string): RenderType | null {
  const ext = extname(filePath).toLowerCase();
  if (HTML_EXTS.has(ext)) return 'html';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return null;
}

/**
 * Resolve `(content | filePath)` + `type` into the payload the backend wants:
 * for `--file-path`, the file is read here and (for images) base64-encoded,
 * matching the contract's "content carries base64 image data, file_path is
 * optional metadata". We always send `content` so the frontend never has to
 * hit S3 — the file lives in the MicroVM, not necessarily synced yet.
 */
function buildPayload(
  type: RenderType,
  content: string | undefined,
  filePath: string | undefined
): { content: string; filePath: string | null; mimeType: string | null } {
  if (filePath) {
    if (!filePath.startsWith(WORKSPACE_ROOT + '/') && filePath !== WORKSPACE_ROOT) {
      fail(`--file-path must be under ${WORKSPACE_ROOT}/ — got '${filePath}'`);
    }
    if (!existsSync(filePath)) {
      fail(`--file-path not found: ${filePath}`);
    }
    const size = statSync(filePath).size;
    if (size > MAX_FILE_BYTES) {
      fail(`--file-path is ${(size / 1024 / 1024).toFixed(1)}MB — exceeds the 2MB render cap`);
    }

    if (type === 'image') {
      const ext = extname(filePath).toLowerCase();
      const mimeType = IMAGE_MIME[ext];
      if (!mimeType) {
        fail(`unsupported image extension '${ext}' — use one of ${Object.keys(IMAGE_MIME).join(', ')}`);
      }
      const b64 = readFileSync(filePath).toString('base64');
      return { content: b64, filePath, mimeType };
    }

    // html (incl. svg) — read as UTF-8 text.
    const text = readFileSync(filePath, 'utf-8');
    return { content: text, filePath, mimeType: null };
  }

  // Inline content path — html/svg only.
  if (type === 'image') {
    fail('--content is for inline HTML/SVG only; render an image with --file-path');
  }
  // content presence is validated by the caller (exactly-one check) before
  // we get here, so `content` is defined.
  return { content: content as string, filePath: null, mimeType: null };
}

/** Build the `numa render` command. */
export function createRenderCommand(): Command {
  return new Command('render')
    .description('Display HTML/SVG/image content inline in the chat (workspace stream only)')
    .option('--type <type>', "'html' or 'image' (inferred from --file-path extension when omitted)")
    .option('--content <html>', 'Inline HTML/SVG string (html only; mutually exclusive with --file-path)')
    .option('--file-path <path>', 'Workspace file under /workdir/ to render (mutually exclusive with --content)')
    .option('--title <text>', 'Title shown above the rendered content')
    .option(
      '--height <n>',
      'Max render height in px before it scrolls (html only). Content auto-fits below this; default cap ~600. Raise it for a genuinely tall layout.',
      (v) => parseInt(v, 10)
    )
    .option(
      '-m, --user-message <text>',
      'Short human-readable caption shown to the user in chat ("Numa <category>: <msg>"). REQUIRED.'
    )
    .action(
      async (
        options: {
          type?: string;
          content?: string;
          filePath?: string;
          title?: string;
          height?: number;
        } & StandardOptions
      ) => {
        requireUserMessage({ userMessage: options.userMessage });

        // Render rides the live SSE stream — only meaningful inside a
        // workspace chat. Bail clearly when run locally.
        const ws = workspaceHitlContext();
        if (!ws) {
          fail(
            '`numa render` only works inside the workspace chat stream ' +
              '(needs NUMA_AUTH_MODE=workspace-iam + NUMA_CONVERSATION_ID). ' +
              'There is no live chat viewport to render into here.'
          );
        }

        // Exactly one of --content / --file-path.
        const hasContent = options.content !== undefined;
        const hasFile = options.filePath !== undefined;
        if (hasContent === hasFile) {
          fail('provide exactly one of --content or --file-path');
        }

        // Resolve --type: explicit, or inferred from the file extension.
        let type: RenderType;
        if (options.type) {
          if (options.type !== 'html' && options.type !== 'image') {
            fail(`--type must be 'html' or 'image', got '${options.type}'`);
          }
          type = options.type;
        } else if (hasFile) {
          const inferred = inferTypeFromPath(options.filePath!);
          if (!inferred) {
            fail(
              `could not infer --type from '${options.filePath}'. ` +
                `Pass --type html|image, or use a recognised extension ` +
                `(${[...HTML_EXTS, ...IMAGE_EXTS].join(', ')}).`
            );
          }
          type = inferred;
        } else {
          // --content with no --type → inline HTML is the only thing that
          // makes sense (you can't paste a binary image inline).
          type = 'html';
        }

        const { content, filePath, mimeType } = buildPayload(type, options.content, options.filePath);

        const toolUseId = `cli_render_${randomUUID()}`;
        try {
          await emitWorkspaceRender(ws, {
            toolUseId,
            renderType: type,
            content,
            filePath,
            title: options.title ?? null,
            ...(options.height !== undefined ? { height: options.height } : {}),
            mimeType,
          });
        } catch (err) {
          if (err instanceof NoActiveStreamError) {
            fail(
              'render needs an active chat stream to display into — the agent ' +
                'reported no live stream for this conversation (HTTP 409). ' +
                'This happens in non-streaming runs (e.g. scheduled/automation contexts).'
            );
          }
          fail(`render emit failed — ${err instanceof Error ? err.message : String(err)}`);
        }

        // Short confirmation to stdout — the visual itself lands in the chat
        // viewport, so the LLM just needs to know it went through.
        success(`rendered ${type} inline${options.title ? ` ("${options.title}")` : ''}.`);
        process.stdout.write('Rendered inline.\n');
        if (process.env['NUMA_DEBUG']) info(`tool_use_id=${toolUseId}`);
      }
    );
}
