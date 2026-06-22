/**
 * In-workspace pre-invoke flush — close the same-tool-call attach race.
 *
 * Several tools read their target file from S3 inside the Lambda
 * (`agents --attach`, `docs convert/extract/transcribe`, `vision`). Agent-
 * generated files only reach S3 at the post-turn sync, so the PreToolUse
 * `workspace_sync` hook flushes them eagerly. But that hook fires BEFORE the
 * whole Bash command, so it can't see a file the command itself just created —
 * the classic `echo > /workdir/outputs/x && numa agents create --attach
 * /workdir/outputs/x`: at flush time `x` doesn't exist yet, so the Lambda 404s.
 *
 * The `numa` CLI, by contrast, runs AFTER the file lands (it IS the second half
 * of that command), so flushing the named file-path arguments here is
 * deterministic. We write to the exact conversation-scoped key the server
 * resolver reads — `_get_s3_path_for_file` in
 * `services/numa-workspace-agent/numa_workspace_agent/s3_workspace.py` is the
 * source of truth; we mirror the uploads/outputs/root + chat-workflows cases.
 *
 * The conversation id, user sub, and bucket all come from the same env the
 * runtime sets (`NUMA_CONVERSATION_ID` == the value used for sync keys), so the
 * key matches by construction. Best-effort: any failure is swallowed — the
 * PreToolUse hook and the authoritative post-turn sync remain the backstop, and
 * the server still validates the file's presence (and now fails loud if absent).
 *
 * Laptop mode (no `NUMA_CONVERSATION_ID`) is a no-op: `--attach` there already
 * requires a conversation context and the file lives only in S3 anyway.
 */

import { createReadStream, statSync } from 'node:fs';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const S3_PREFIX = 'numa-chat/workspace';
const WORKSPACE_ROOT = '/workdir';

/**
 * Which param key on each file-reading tool holds workspace path(s), and whether
 * it's a list. Keep in lockstep with the tools whose Lambda handler reads the
 * file from the conversation S3 prefix (mirrors the `workspace_sync` hook's
 * command set). Tools absent here are left untouched.
 */
const FILE_PATH_PARAMS: Record<string, { key: string; list: boolean }> = {
  create_agent: { key: 'attachFiles', list: true },
  update_agent: { key: 'attachFiles', list: true },
  extract_content: { key: 'file_path', list: false },
  transcribe: { key: 'file_path', list: false },
  convert_document: { key: 'file_path', list: false },
  view_image: { key: 'file_path', list: false },
};

let _s3: S3Client | undefined;

/**
 * S3 client on the native-account role creds (same source as the Lambda client
 * in `client.ts`). On Bedrock quota-sharing clients `sdk_config.py` overwrites
 * the standard `AWS_*` env with Bedrock-only creds, stashing the native role
 * creds — which carry the outputs-bucket S3 access the runtime syncs with —
 * under `NUMA_LOCAL_AWS_*`. Prefer those; fall back to the default chain
 * (non-quota clients, where the two sets are identical).
 */
function s3Client(): S3Client {
  if (!_s3) {
    const accessKeyId = process.env['NUMA_LOCAL_AWS_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['NUMA_LOCAL_AWS_SECRET_ACCESS_KEY'];
    const region = process.env['AWS_REGION'] || process.env['NUMA_LOCAL_AWS_REGION'];
    _s3 = new S3Client({
      ...(region ? { region } : {}),
      ...(accessKeyId && secretAccessKey
        ? {
            credentials: {
              accessKeyId,
              secretAccessKey,
              sessionToken: process.env['NUMA_LOCAL_AWS_SESSION_TOKEN'],
            },
          }
        : {}),
    });
  }
  return _s3;
}

/** `/workdir/outputs/x.md` → `outputs/x.md`; null if not under the workspace root. */
function toRelPath(filePath: string): string | null {
  if (!filePath.startsWith(WORKSPACE_ROOT + '/')) return null;
  return filePath.slice(WORKSPACE_ROOT.length + 1);
}

/**
 * Conversation/global S3 key for a workspace-relative path. Mirrors
 * `_get_s3_path_for_file`: `chat-workflows/` is user-global, everything else
 * (uploads, outputs, root files) is conversation-scoped. We deliberately do NOT
 * handle `agent-workflows/` / the trace here — they aren't tool file arguments.
 */
function s3KeyFor(relPath: string, userSub: string, conversationId: string): string {
  if (relPath.startsWith('chat-workflows/')) return `${S3_PREFIX}/${userSub}/${relPath}`;
  return `${S3_PREFIX}/${userSub}/conversations/${conversationId}/${relPath}`;
}

function collectPaths(params: unknown, spec: { key: string; list: boolean }): string[] {
  const raw = (params as Record<string, unknown> | undefined)?.[spec.key];
  if (spec.list) return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
  return typeof raw === 'string' ? [raw] : [];
}

/**
 * Flush the file-path arguments of a file-reading tool to S3 before it runs.
 * No-op off-workspace or for tools without file args. Never throws.
 */
export async function flushWorkspacePathsForTool(
  tool: string,
  params: unknown,
  conversationId: string | undefined
): Promise<void> {
  const spec = FILE_PATH_PARAMS[tool];
  if (!spec) return;

  const convId = conversationId || process.env['NUMA_CONVERSATION_ID'];
  const userSub = process.env['NUMA_USER_SUB'];
  const bucket = process.env['OUTPUTS_BUCKET_NAME'];
  // Off-workspace (laptop) or unconfigured → nothing to flush; the server-side
  // path resolution + validation handles it.
  if (!convId || !userSub || !bucket) return;

  const paths = collectPaths(params, spec);
  if (paths.length === 0) return;

  await Promise.all(
    paths.map(async (filePath) => {
      try {
        const relPath = toRelPath(filePath);
        if (!relPath) return; // not a workspace path (server will resolve/validate)
        const stat = statSync(filePath);
        if (!stat.isFile()) return;
        await s3Client().send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3KeyFor(relPath, userSub, convId),
            Body: createReadStream(filePath),
            ContentLength: stat.size,
          })
        );
      } catch {
        // Best-effort: the PreToolUse hook + post-turn sync are the backstop,
        // and the server now fails loud if the file truly isn't there.
      }
    })
  );
}
