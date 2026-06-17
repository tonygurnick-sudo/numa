/**
 * `numa vision view` — describe a workspace image the model can't see natively.
 *
 * The non-multimodal "Numa Standard Model" has no eyes: it cannot read images,
 * charts, screenshots, or scanned-document pages directly. This command wraps
 * the `view_image` tool in `workspace-chat-tools`, which reads the workspace
 * file from S3 and runs it through a vision model (Haiku 4.5 by default) to
 * produce a textual description the model CAN consume.
 *
 * Read-only: there is no HITL gate. Looking at an image the user already
 * uploaded is non-destructive, so it follows the same auto-permitted path as
 * `numa web` / `numa docs extract` (no `gateWriteOp`).
 *
 * Tool gating: server-side this is just another `numa-cli-api` tool call. The
 * `numa-chat` agent type is unrestricted, so the Phase-5 allow-list
 * auto-permits the new `vision` category; the model only reaches for it when
 * its prompt advertises it (the Standard-model-conditional addendum).
 *
 * Flow:
 *   numa vision view --file-path /workdir/uploads/slide.png \
 *     --prompt "What does this chart show?" -m "Looking at the slide"
 *
 * Output shape: `{description: string}`. The standard envelope's file-dump
 * kicks in automatically for a large description (no per-command tuning).
 */

import { Command } from 'commander';
import { getValidTokens } from '../../auth/tokens.js';
import { activeProfile } from '../../context/store.js';
import { resolveScopingContext, type ScopingContext } from '../../context/resolve.js';
import { invokeTool, type ToolInvokeRequest } from '../../api/tools.js';
import type { ParamsForTool } from '../../metadata/tool-types.js';
import { fail } from '../../output/pretty.js';
import { prettyOrSpill } from '../../output/emit.js';
import { addStandardOptions, requireUserMessage, type StandardOptions } from '../../output/cli-args.js';

const VIEW_IMAGE_TOOL = 'view_image';

/**
 * Mirror the workspace/local split used by web + memory. In a workspace the
 * enabled-tools list is authoritative (respects the frontend toggle); on a
 * laptop we auto-inject so the tool is always reachable for dev.
 */
function resolveEnabledTools(scope: ScopingContext): string[] {
  const base = scope.enabled_tools ?? [];
  if (scope.source === 'workspace-env') return base;
  return base.includes(VIEW_IMAGE_TOOL) ? base : [...base, VIEW_IMAGE_TOOL];
}

function createVisionViewCommand(): Command {
  const cmd = new Command('view')
    .description("Describe a workspace image you can't see natively (vision model reads it for you)")
    .requiredOption('--file-path <path>', 'Workspace image under /workdir/ (e.g. /workdir/uploads/slide.png)')
    .option('--prompt <text>', 'What to look for / question to answer about the image (default: a full description)');
  addStandardOptions(cmd);
  return cmd.action(async (options: { filePath: string; prompt?: string } & StandardOptions) => {
    requireUserMessage({ userMessage: options.userMessage });

    const account = activeProfile();
    if (!account) fail('no active profile — run `numa login` first');

    const tokens = await getValidTokens(account);
    const scope = resolveScopingContext(account);

    // The CLI runs IN the workspace container and can read /workdir directly.
    // Ship small images inline (base64) so the server-side tool doesn't depend
    // on the post-turn S3 sync — essential for agent-GENERATED images (charts/
    // slides just rendered) that aren't in S3 yet. Cap at 4 MB so the encoded
    // payload stays under the Lambda sync-invoke 6 MB limit; larger files fall
    // back to the server's S3 read.
    let imageB64: string | undefined;
    try {
      const { statSync, readFileSync } = await import('node:fs');
      const st = statSync(options.filePath);
      if (st.isFile() && st.size <= 4 * 1024 * 1024) {
        imageB64 = readFileSync(options.filePath).toString('base64');
      }
    } catch {
      // Not locally readable (e.g. an S3-only path) — server falls back to S3.
    }

    const params: ParamsForTool<'view_image'> = {
      file_path: options.filePath,
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(imageB64 ? { image_b64: imageB64 } : {}),
    };

    const request: ToolInvokeRequest<'view_image'> = {
      tool: 'view_image',
      params,
      context: {
        allowed_kbs: scope.allowed_kbs,
        allowed_kb_operations: scope.allowed_kb_operations,
        enabled_tools: resolveEnabledTools(scope),
        conversation_id: scope.conversation_id || undefined,
      },
      id_token: tokens.idToken,
      user_message: options.userMessage,
    };

    const res = await invokeTool(account, tokens.accessToken, request);
    if (res.status === 'error') fail(`vision view failed: ${res.error ?? '<no message>'}`);

    prettyOrSpill({
      tool: 'view_image',
      result: res.result,
      options,
      render: (r) => {
        process.stdout.write(`${r?.description ?? ''}\n`);
      },
      headline: (r, size) => {
        const chars = (r?.description?.length ?? 0).toLocaleString();
        return `described ${options.filePath} → ${chars} chars (${size})`;
      },
    });
  });
}

/** Build the `numa vision` command tree. */
export function createVisionCommand(): Command {
  return new Command('vision')
    .description('Look at workspace images via a vision model')
    .addCommand(createVisionViewCommand());
}
