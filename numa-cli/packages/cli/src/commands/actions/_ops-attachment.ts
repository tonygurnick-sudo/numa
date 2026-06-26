/**
 * `numa ops upload_attachment` — attach a workspace file to an Ops ticket as
 * ONE logical command (BUG-389).
 *
 * The generic `numa ops <op>` pass-through can't do this on its own:
 *
 *   - The model can't move the bytes itself — `curl`/`wget` are blocked by the
 *     workspace security hook, so it can't PUT to the presigned URL the
 *     presign step returns. (The download direction already solved the mirror
 *     of this in `_integration-files.ts`: "the CLI delivers the bytes … the
 *     model shouldn't have to fish presigned URLs out of JSON".)
 *   - The server-side Python handler runs in a REMOTE Lambda with no access to
 *     `/workdir`, so it can't read the file either.
 *
 * The CLI is the only component that can do both: it runs INSIDE the MicroVM
 * (so it can read the workspace file) and its own `fetch` reaches S3 (the same
 * outbound path `atomicDownload` already uses). So it orchestrates the whole
 * thing the model otherwise couldn't, exactly as the frontend's
 * `attachmentUploader.ts` does for human uploads:
 *
 *   1. read the workspace file               (bytes + size, here in the VM)
 *   2. ops_upload_attachment → presigned PUT  (the gated step — one approval)
 *   3. PUT the bytes to the presigned URL     (CLI fetch, not curl)
 *   4. ops_add_comment with attachments[]     (registers it on the ticket)
 *
 * The model never sees the presigned URL — it calls one command and gets back
 * a success summary. The single HITL approval is the presign step (already a
 * write op); the follow-on comment that registers the attachment is the
 * mechanical completion of that already-approved action, so it's
 * auto-approved (no second card).
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { uploadToPresignedUrl } from '../../api/integrity.js';
import type { ToolInvokeResponse } from '../../api/tools.js';

/** Workspace root inside the MicroVM — reads are confined here in-workspace. */
const WORKSPACE_ROOT = '/workdir';

/**
 * The CLI's bound tool invoker for ops operations. The command site builds
 * this capturing account/tokens/scope/user-message so this module stays free
 * of transport knowledge (and is unit-testable with a fake invoker).
 */
export interface OpsInvoke {
  (
    operation: string,
    params: Record<string, unknown>,
    gate: { autoApproved: boolean; requestId?: string }
  ): Promise<ToolInvokeResponse>;
}

export interface UploadAttachmentResult {
  status: 'success';
  operation: 'upload_attachment';
  fileName: string;
  s3Key: string;
  size: number;
  mimeType: string;
  /** Whatever ticket reference the caller supplied (displayId or UUID). */
  ticket: string;
  message: string;
}

/** Minimal extension → MIME map for when the caller omits `contentType`. */
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

const inferContentType = (fileName: string): string => {
  const ext = fileName.includes('.') ? (fileName.split('.').pop() ?? '').toLowerCase() : '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
};

const firstString = (params: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = params[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
};

/**
 * Pull `uploadUrl`/`s3Key` out of the presign response, tolerating the two
 * envelope shapes the handler can use: the fields at the top of `result`, or
 * nested one deeper under `result.result` (the approval-wrapper form).
 */
const readPresign = (res: ToolInvokeResponse): { uploadUrl?: string; s3Key?: string } => {
  const r = res.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return {};
  const inner = (typeof r['uploadUrl'] === 'string' ? r : (r['result'] as Record<string, unknown> | undefined)) ?? {};
  return {
    uploadUrl: typeof inner['uploadUrl'] === 'string' ? (inner['uploadUrl'] as string) : undefined,
    s3Key: typeof inner['s3Key'] === 'string' ? (inner['s3Key'] as string) : undefined,
  };
};

/**
 * Run the full attach flow. Throws on any failure (missing file, denied
 * approval, failed PUT, failed registration) — the command site turns that
 * into a tool error so the model never reports a half-finished upload as done.
 */
export async function runUploadAttachment(args: {
  invoke: OpsInvoke;
  opParams: Record<string, unknown>;
  gate: { autoApproved: boolean; requestId?: string };
}): Promise<UploadAttachmentResult> {
  const { invoke, opParams, gate } = args;

  // ── 1. Resolve + read the workspace file ────────────────────────────────
  const workspaceFilePath = firstString(opParams, 'workspaceFilePath', 'workspace_file_path', 'filePath', 'file_path');
  if (!workspaceFilePath) {
    throw new Error(
      'missing workspaceFilePath — pass the absolute path of the workspace file to attach ' +
        '(e.g. {"workspaceFilePath":"/workdir/tmp/integrations-results/screenshot.png"})'
    );
  }

  const ticketId = firstString(opParams, 'ticketId', 'ticket_id');
  const displayId = firstString(opParams, 'displayId', 'display_id');
  if (!ticketId && !displayId) {
    throw new Error('missing ticket reference — pass displayId (e.g. "BUG-389") or ticketId (UUID)');
  }
  const ticketRef = displayId ?? ticketId ?? '';

  const resolved = resolve(workspaceFilePath);
  // In-workspace (NUMA_CONVERSATION_ID set) confine reads to /workdir: the
  // model itself can't read outside the workspace, and the CLI shouldn't
  // smuggle a system file onto a ticket on its behalf. Laptop/dev (no conv id)
  // is unrestricted for convenience.
  if (
    process.env['NUMA_CONVERSATION_ID'] &&
    resolved !== WORKSPACE_ROOT &&
    !resolved.startsWith(WORKSPACE_ROOT + '/')
  ) {
    throw new Error(`refusing to attach a file outside the workspace '${WORKSPACE_ROOT}': ${workspaceFilePath}`);
  }

  let bytes: Buffer;
  try {
    const st = await stat(resolved);
    if (!st.isFile()) throw new Error('not a regular file');
    bytes = await readFile(resolved);
  } catch (e) {
    throw new Error(`cannot read '${workspaceFilePath}': ${e instanceof Error ? e.message : String(e)}`);
  }

  const fileName = firstString(opParams, 'fileName', 'file_name') ?? basename(resolved);
  const mimeType = firstString(opParams, 'contentType', 'content_type') ?? inferContentType(fileName);
  const size = bytes.byteLength;

  // ── 2. Presign (the one gated, user-approved step) ──────────────────────
  const presignRes = await invoke(
    'upload_attachment',
    { ...(ticketId ? { ticketId } : {}), ...(displayId ? { displayId } : {}), fileName, contentType: mimeType },
    gate
  );
  // A denied/timed-out approval or any gate/handler error surfaces here as
  // status==='error' (invokeTool normalises denied/timeout → error). Stop
  // BEFORE moving any bytes — never PUT after the user said no.
  if (presignRes.status === 'error') {
    throw new Error(presignRes.error ?? 'presign step failed');
  }
  const { uploadUrl, s3Key } = readPresign(presignRes);
  if (!uploadUrl || !s3Key) {
    throw new Error('presign step did not return an upload URL / S3 key');
  }

  // ── 3. PUT the bytes (CLI fetch — curl is blocked for the model) ─────────
  try {
    await uploadToPresignedUrl(uploadUrl, bytes, mimeType);
  } catch (e) {
    throw new Error(`uploading bytes to S3 failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 4. Register the attachment on the ticket via a system comment ────────
  // An Ops attachment IS a comment carrying an attachments[] record (same
  // shape the frontend writes). Auto-approved: the user already approved the
  // upload at step 2; this is its mechanical completion, not a new decision.
  const registerRes = await invoke(
    'add_comment',
    {
      ...(ticketId ? { ticketId } : {}),
      ...(displayId ? { displayId } : {}),
      content: `📎 Attached: ${fileName}`,
      attachments: [{ name: fileName, s3Key, size, mimeType }],
    },
    { autoApproved: true }
  );
  if (registerRes.status === 'error') {
    // Bytes are in S3 but nothing references them — surface the s3Key so it's
    // recoverable, and make clear the attachment did NOT land on the ticket.
    throw new Error(
      `file uploaded to S3 (${s3Key}) but registering it on ${ticketRef} failed: ${registerRes.error ?? 'unknown error'}`
    );
  }

  return {
    status: 'success',
    operation: 'upload_attachment',
    fileName,
    s3Key,
    size,
    mimeType,
    ticket: ticketRef,
    message: `Attached ${fileName} (${size} bytes) to ${ticketRef}`,
  };
}
