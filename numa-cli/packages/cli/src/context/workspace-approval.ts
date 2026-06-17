/**
 * Workspace-IAM HITL emission. In workspace mode (NUMA_AUTH_MODE=workspace-iam
 * + NUMA_CONVERSATION_ID set), write-op commands POST a synthetic
 * tool_approval event to the workspace agent's localhost /internal/emit-approval
 * endpoint BEFORE invoking the Lambda. The Lambda's poll_approval blocks until
 * the frontend approves/denies. No terminal prompt; the user is in the chat UI.
 */
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

export type ApprovalCategory = 'ops' | 'integration' | 'numa_tool';

export interface EmitApprovalInput {
  requestId: string;
  actionKey: string;
  toolName: string;
  description: string;
  propsPreview: Record<string, unknown>;
  approvalCategory: ApprovalCategory;
}

export type RenderType = 'html' | 'image';

export interface EmitRenderInput {
  /** `cli_render_<uuid>` — caller-generated so it can be referenced/logged. */
  toolUseId: string;
  renderType: RenderType;
  /** Inline HTML/SVG string, or base64 image data. Empty string when filePath is set. */
  content: string;
  /** Optional workspace file path (under /workdir/). */
  filePath?: string | null;
  title?: string | null;
  /** Iframe height in px (html only). Defaults server-side to 400. */
  height?: number;
  /** MIME type for images (derived from extension). */
  mimeType?: string | null;
}

export interface WorkspaceHitlContext {
  conversationId: string;
}

export const workspaceHitlContext = (): WorkspaceHitlContext | null => {
  if (process.env['NUMA_AUTH_MODE'] !== 'workspace-iam') return null;
  const cid = process.env['NUMA_CONVERSATION_ID'];
  return cid ? { conversationId: cid } : null;
};

export const emitWorkspaceApproval = async (ctx: WorkspaceHitlContext, input: EmitApprovalInput): Promise<void> => {
  const port = process.env['NUMA_AGENT_PORT'] ?? '8080';
  const body = JSON.stringify({
    conversation_id: ctx.conversationId,
    request_id: input.requestId,
    tool_use_id: `cli_${randomUUID()}`,
    tool_name: input.toolName,
    action_key: input.actionKey,
    description: input.description,
    props_preview: input.propsPreview,
    approval_category: input.approvalCategory,
    parent_tool_use_id: null,
  });

  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: Number(port),
        path: '/internal/emit-approval',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        timeout: 5_000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode && res.statusCode < 300) resolve();
          else reject(new Error(`emit-approval HTTP ${res.statusCode}`));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('emit-approval timeout')));
    req.write(body);
    req.end();
  });
};

/**
 * Raised when the agent returns HTTP 409 from /internal/emit-render — i.e.
 * there's no active SSE stream draining the conversation queue (non-streaming
 * context). The render command catches this to print a tailored message rather
 * than a generic "HTTP 409".
 */
export class NoActiveStreamError extends Error {
  constructor(message = 'no active stream for conversation') {
    super(message);
    this.name = 'NoActiveStreamError';
  }
}

/**
 * Sibling of {@link emitWorkspaceApproval}: POST a synthetic `tool_render`
 * event to the workspace agent's localhost /internal/emit-render endpoint.
 * The agent pushes it onto the active conversation's SSE queue (the SAME rail
 * as HITL approvals); the frontend renders it inline via RenderToolRenderer.
 *
 * Returns when the agent acknowledges with `{"status":"queued"}` (HTTP 200).
 * Throws {@link NoActiveStreamError} on HTTP 409 (non-streaming context).
 */
export const emitWorkspaceRender = async (ctx: WorkspaceHitlContext, input: EmitRenderInput): Promise<void> => {
  const port = process.env['NUMA_AGENT_PORT'] ?? '8080';
  const body = JSON.stringify({
    conversation_id: ctx.conversationId,
    tool_use_id: input.toolUseId,
    render_type: input.renderType,
    content: input.content,
    file_path: input.filePath ?? null,
    title: input.title ?? null,
    height: input.height ?? 400,
    mime_type: input.mimeType ?? null,
  });

  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: Number(port),
        path: '/internal/emit-render',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        timeout: 5_000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode && res.statusCode < 300) resolve();
          else if (res.statusCode === 409) reject(new NoActiveStreamError());
          else reject(new Error(`emit-render HTTP ${res.statusCode}`));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('emit-render timeout')));
    req.write(body);
    req.end();
  });
};
