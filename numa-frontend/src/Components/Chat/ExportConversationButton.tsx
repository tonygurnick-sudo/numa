/**
 * ExportConversationButton - Export conversation as HTML or plain text.
 *
 * Extracts user-visible content including text (rendered as markdown),
 * tool call indicators, task lists, subagent tasks, and file attachments.
 */
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { Dropdown } from 'react-bootstrap';
import { Share } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { WorkspaceChatSegment } from '@/types/workspaceChatTypes';
import {
  fetchS3WorkspaceJson,
  getRenderPayload,
  type RenderPayload,
  type ToolResultLike,
} from '../../toolRenderers/helpers';

/* ---------- Constants ---------- */

// Inline Numa wordmark used in the HTML export header next to assistant messages.
// Mirrors public/numa-logo.svg so the export is self-contained.
const NUMA_LOGO_SVG =
  '<svg viewBox="0 0 34 33" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14" aria-hidden="true">' +
  '<rect x="15.3877" width="3.2252" height="23.456" fill="currentColor"/>' +
  '<path d="M18.6123 0H21.8375V3.0786L20.6647 6.15719H18.6123V0Z" fill="currentColor"/>' +
  '<rect x="18.6123" y="32.252" width="3.2252" height="23.456" transform="rotate(-180 18.6123 32.252)" fill="currentColor"/>' +
  '<path d="M15.3877 32.252L12.1625 32.252L12.1625 29.1734L13.3353 26.0948L15.3877 26.0948L15.3877 32.252Z" fill="currentColor"/>' +
  '<rect x="33.126" y="14.5134" width="3.2252" height="23.456" transform="rotate(90 33.126 14.5134)" fill="currentColor"/>' +
  '<path d="M33.126 17.7386L33.126 20.9638L30.0474 20.9638L26.9688 19.791L26.9688 17.7386L33.126 17.7386Z" fill="currentColor"/>' +
  '<rect x="0.874023" y="17.7386" width="3.2252" height="23.456" transform="rotate(-90 0.874023 17.7386)" fill="currentColor"/>' +
  '<path d="M0.874023 14.5134L0.874024 11.2882L3.95262 11.2882L7.03122 12.461L7.03122 14.5134L0.874023 14.5134Z" fill="currentColor"/>' +
  '<rect x="27.2627" y="3.58289" width="3.2252" height="23.456" transform="rotate(45 27.2627 3.58289)" fill="currentColor"/>' +
  '<path d="M29.543 5.86346L31.8235 8.14402L29.6466 10.3209L26.6404 11.6685L25.1892 10.2173L29.543 5.86346Z" fill="currentColor"/>' +
  '<rect x="6.7373" y="28.6691" width="3.2252" height="23.456" transform="rotate(-135 6.7373 28.6691)" fill="currentColor"/>' +
  '<path d="M4.45703 26.3885L2.17647 24.1079L4.35337 21.931L7.35956 20.5834L8.81082 22.0347L4.45703 26.3885Z" fill="currentColor"/>' +
  '<rect x="29.543" y="26.3885" width="3.2252" height="23.456" transform="rotate(135 29.543 26.3885)" fill="currentColor"/>' +
  '<path d="M27.2627 28.6691L24.9821 30.9496L22.8052 28.7727L21.4576 25.7665L22.9089 24.3153L27.2627 28.6691Z" fill="currentColor"/>' +
  '<rect x="4.45703" y="5.86346" width="3.2252" height="23.456" transform="rotate(-45 4.45703 5.86346)" fill="currentColor"/>' +
  '<path d="M6.7373 3.58289L9.01786 1.30233L11.1948 3.47923L12.5424 6.48541L11.0911 7.93668L6.7373 3.58289Z" fill="currentColor"/>' +
  '</svg>';

/* ---------- Types ---------- */

interface ExportMessage {
  role: string;
  content?: string;
  segments?: WorkspaceChatSegment[];
}

type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string };

interface ExportConversationButtonProps {
  messages: ExportMessage[];
  conversationId: string | null;
  agentName?: string;
  agentId?: string;
  userId?: string;
  userEmail?: string;
  environment?: string;
  // Optional: when provided, large render payloads stored in S3 are fetched
  // and inlined so the export captures the rendered visuals.
  getCredentials?: () => Promise<AwsCredentials>;
}

type ExportSegment =
  | { kind: 'text'; markdown: string }
  | { kind: 'tool'; displayText: string; isError?: boolean }
  | { kind: 'todo'; items: Array<{ content: string; status: string }> }
  | { kind: 'subagent'; taskDescription: string; subagentType: string }
  | { kind: 'file'; label: string }
  | {
      kind: 'render';
      renderType: 'html' | 'image';
      content: string;
      title?: string;
      height?: number;
      mimeType?: string;
    }
  | {
      // Placeholder for large render payloads stored in S3. Resolved to a
      // `render` segment before HTML/text generation when credentials are
      // available; otherwise downgraded to a tool indicator line.
      kind: 'pending_render';
      filePath: string;
      title?: string;
      height?: number;
    };

interface ExportedMessage {
  role: string;
  segments: ExportSegment[];
}

/* ---------- Helpers ---------- */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function markdownToHtml(md: string): string {
  return micromark(md, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Format a tool name for display (e.g. "mcp__integrations__run_action" -> "Run Action").
 */
function formatToolName(name: string): string {
  // Strip MCP-style prefixes
  const base = name.includes('__') ? name.split('__').pop()! : name;
  // Convert snake_case to Title Case
  return base
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ---------- Extraction ---------- */

function extractExportMessages(messages: ExportMessage[], t: TFunction): ExportedMessage[] {
  const result: ExportedMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      const segments: ExportSegment[] = [];
      const text = msg.content?.trim();
      if (text) {
        segments.push({ kind: 'text', markdown: text });
      }
      // Include user file/folder attachment segments
      for (const seg of msg.segments || []) {
        if (seg.kind === 'file_attachment') {
          segments.push({
            kind: 'file',
            label: t('workspace.export.segments.file', {
              filename: seg.filename,
              size: formatFileSize(seg.size),
            }),
          });
        } else if (seg.kind === 'folder_attachment') {
          segments.push({
            kind: 'file',
            label: t('workspace.export.segments.folder', {
              name: seg.folderName,
              count: seg.fileCount,
              size: formatFileSize(seg.totalSize),
            }),
          });
        }
      }
      if (segments.length > 0) {
        result.push({ role: 'user', segments });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const segments: ExportSegment[] = [];

      for (const seg of msg.segments || []) {
        switch (seg.kind) {
          case 'text':
            if (seg.text?.trim()) {
              segments.push({ kind: 'text', markdown: seg.text.trim() });
            }
            break;

          case 'inline_tool':
            if (seg.displayText) {
              if (seg.isError) {
                segments.push({
                  kind: 'tool',
                  displayText: t('workspace.export.segments.callingTool', {
                    tool: formatToolName(seg.toolName),
                    description: seg.displayText,
                  }),
                  isError: true,
                });
              } else {
                segments.push({
                  kind: 'tool',
                  displayText: t('workspace.export.segments.callingTool', {
                    tool: formatToolName(seg.toolName),
                    description: seg.displayText,
                  }),
                });
              }
            }
            break;

          case 'tool_card': {
            const tcInput = seg.input as { name?: string; description?: string } | undefined;
            const isNumaTool = seg.toolName === 'mcp__numa__numa_tool';
            const subTool = tcInput?.name;

            // Render sub-tool: inline the rendered visual when content is available
            if (isNumaTool && subTool === 'render' && seg.result) {
              const renderPayload = getRenderPayload(seg.result as ToolResultLike);
              if (renderPayload?.content) {
                segments.push({
                  kind: 'render',
                  renderType: renderPayload.render_type,
                  content: renderPayload.content,
                  title: renderPayload.title,
                  height: renderPayload.height,
                  mimeType: renderPayload.mime_type,
                });
                break;
              }
              // Large render: content was stripped, full payload lives at file_path
              // in S3. Emit a placeholder the resolver will replace with the
              // fetched content (kind: 'pending_render') before generation.
              if (renderPayload?.file_path) {
                segments.push({
                  kind: 'pending_render',
                  filePath: renderPayload.file_path,
                  title: renderPayload.title,
                  height: renderPayload.height,
                });
                break;
              }
            }

            // For numa_tool calls, fall back to the agent-provided description
            // first (live UI does the same) so the export reads naturally even
            // when `label` resolves to "Numa Tool" / "Unknown Tool".
            const description = (isNumaTool ? tcInput?.description : undefined) || seg.label;
            if (description) {
              const toolLabel = isNumaTool && subTool ? formatToolName(subTool) : formatToolName(seg.toolName);
              segments.push({
                kind: 'tool',
                displayText: t('workspace.export.segments.callingTool', {
                  tool: toolLabel,
                  description,
                }),
                isError: seg.isError,
              });
            }
            break;
          }

          case 'subagent':
            if (seg.taskDescription) {
              segments.push({
                kind: 'subagent',
                taskDescription: seg.taskDescription,
                subagentType: seg.subagentType || 'agent',
              });
            }
            break;

          case 'todo':
            if (seg.items?.length) {
              segments.push({
                kind: 'todo',
                items: seg.items.map((item) => ({
                  content: item.content,
                  status: item.status,
                })),
              });
            }
            break;

          case 'file_upload':
            segments.push({
              kind: 'file',
              label: t('workspace.export.segments.uploaded', { filename: seg.filename }),
            });
            break;

          // Skip ephemeral/internal segments
          case 'inline_thinking':
          case 'thinking':
          case 'compaction':
          case 'assistant_advice':
          case 'tool_approval':
            break;
        }
      }

      // Fall back to content if no segments extracted
      if (segments.length === 0 && msg.content?.trim()) {
        segments.push({ kind: 'text', markdown: msg.content.trim() });
      }

      if (segments.length > 0) {
        result.push({ role: 'assistant', segments });
      }
    }
  }

  return result;
}

/* ---------- Pending render resolution ---------- */

/**
 * Resolve any `pending_render` placeholders by fetching the payload from S3
 * and swapping in a fully-inlined `render` segment. Placeholders without
 * credentials, or with failed fetches, are downgraded to a tool indicator.
 */
async function resolvePendingRenders(
  messages: ExportedMessage[],
  conversationId: string,
  userId: string | undefined,
  getCredentials: (() => Promise<AwsCredentials>) | undefined,
  t: TFunction
): Promise<ExportedMessage[]> {
  if (!userId || !getCredentials) {
    return messages.map((m) => ({
      ...m,
      segments: m.segments.map((s) => downgradePending(s, t)),
    }));
  }

  // Stable credentials for the batch — fetch once, reuse across renders.
  let cachedCreds: AwsCredentials | null = null;
  const credProvider = async () => {
    if (!cachedCreds) cachedCreds = await getCredentials();
    return cachedCreds;
  };

  return Promise.all(
    messages.map(async (m) => ({
      ...m,
      segments: await Promise.all(
        m.segments.map(async (s) => {
          if (s.kind !== 'pending_render') return s;
          const payload = await fetchS3WorkspaceJson<RenderPayload>(s.filePath, conversationId, userId, credProvider, {
            maxRetries: 2,
          });
          if (payload?.content) {
            return {
              kind: 'render',
              renderType: payload.render_type,
              content: payload.content,
              title: payload.title ?? s.title,
              height: payload.height ?? s.height,
              mimeType: payload.mime_type,
            } as ExportSegment;
          }
          return downgradePending(s, t);
        })
      ),
    }))
  );
}

function downgradePending(seg: ExportSegment, t: TFunction): ExportSegment {
  if (seg.kind !== 'pending_render') return seg;
  return {
    kind: 'tool',
    displayText: t('workspace.export.segments.callingTool', {
      tool: 'Render',
      description: seg.title || 'Rendered content (not available in export)',
    }),
  };
}

/* ---------- Inline reference preprocessing ---------- */

// Matches the same set of inline refs the live UI handles in WorkspaceChatMarkdown.tsx
// but rewrites them inline so micromark + the export styles render them as
// labelled chips/links instead of leaving raw `<file:...>` text in the output.
const INLINE_REF_PATTERN = /<(file|folder|kb-source):([^>]+)>/g;

function preprocessInlineReferences(markdown: string): string {
  return markdown.replace(INLINE_REF_PATTERN, (_match, kind: string, target: string) => {
    const trimmed = target.trim();
    if (kind === 'kb-source') {
      // s3://bucket/.../filename.ext — show the filename only
      const label = trimmed.split('/').pop() || trimmed;
      return `<span class="ref-chip ref-kb">${escapeHtml(label)}</span>`;
    }
    const label = trimmed.split('/').pop() || trimmed;
    const cssClass = kind === 'folder' ? 'ref-folder' : 'ref-file';
    return `<span class="ref-chip ${cssClass}">${escapeHtml(label)}</span>`;
  });
}

/* ---------- HTML Generation ---------- */

function renderSegmentHtml(seg: ExportSegment): string {
  switch (seg.kind) {
    case 'text':
      return `<div class="content">${markdownToHtml(preprocessInlineReferences(seg.markdown))}</div>`;

    case 'pending_render':
      // Should have been resolved by resolvePendingRenders. Render a neutral
      // placeholder if it slipped through.
      return `<div class="segment-tool complete"><span class="tool-text">Rendered content (unavailable)</span></div>`;

    case 'tool': {
      const statusClass = seg.isError ? 'error' : 'complete';
      const iconSvg = seg.isError
        ? '<svg class="tool-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
        : '<svg class="tool-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7 10.5l-2.5-2.5 1-1L7 8.5l3.5-3.5 1 1L7 10.5z"/></svg>';
      return `<div class="segment-tool ${statusClass}">${iconSvg}<span class="tool-text">${escapeHtml(seg.displayText)}</span></div>`;
    }

    case 'todo': {
      const completed = seg.items.filter((i) => i.status === 'completed').length;
      return `<div class="todo-card">
        <div class="todo-header">
          <span class="todo-title"><svg class="todo-header-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2zm0 3h8v1H2zm0 3h10v1H2zm0 3h6v1H2z"/><path d="M13 7l-3 3-1.5-1.5.7-.7.8.8L12.3 7l.7.7z" fill="#22c55e"/></svg>${escapeHtml('Task List')}</span>
          <span class="todo-progress">${completed}/${seg.items.length}</span>
        </div>
        <div class="todo-list">${seg.items
          .map((item) => {
            const iconSvg =
              item.status === 'completed'
                ? '<svg class="todo-icon completed" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.1 5.4l-3.6 3.6a.5.5 0 01-.7 0L5 8.2l.7-.7 1.5 1.5 3.2-3.2.7.7z"/></svg>'
                : item.status === 'in_progress'
                  ? '<svg class="todo-icon in-progress" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 1a5 5 0 110 10A5 5 0 018 3zm-.5 2v3.5l2.5 1.5.5-.87-2-1.2V5h-1z"/></svg>'
                  : '<svg class="todo-icon pending" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="6"/></svg>';
            return `<div class="todo-item status-${item.status}">${iconSvg}<span class="todo-text">${escapeHtml(item.content)}</span></div>`;
          })
          .join('')}</div></div>`;
    }

    case 'subagent':
      return `<div class="segment-subagent"><svg class="subagent-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 2h6v1H5V7zm0 2h4v1H5V9z"/></svg><span>${escapeHtml(seg.taskDescription)}</span></div>`;

    case 'file':
      return `<div class="segment-file"><svg class="file-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h5.5L14 5.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm5 1v4h4L9 2z"/></svg><span>${escapeHtml(seg.label)}</span></div>`;

    case 'render': {
      const titleHtml = seg.title ? `<div class="render-export-title">${escapeHtml(seg.title)}</div>` : '';
      if (seg.renderType === 'html') {
        const height = seg.height || 400;
        return `${titleHtml}<iframe srcdoc="${escapeHtml(seg.content)}" sandbox="allow-scripts" style="width:100%;height:${height}px;border:1px solid var(--border-color);border-radius:8px;background:#fff;"></iframe>`;
      }
      const src = seg.content.startsWith('data:')
        ? seg.content
        : `data:${seg.mimeType || 'image/png'};base64,${seg.content}`;
      return `${titleHtml}<img src="${src}" alt="${escapeHtml(seg.title || 'Rendered image')}" style="max-width:100%;border-radius:8px;" />`;
    }
  }
}

interface ExportContext {
  conversationId: string;
  dateStr: string;
  agentName?: string;
  agentId?: string;
  userId?: string;
  userEmail?: string;
  environment?: string;
}

function renderContextMetaHtml(ctx: ExportContext, t: TFunction): string {
  const lines: string[] = [];
  lines.push(`<div class="meta">${escapeHtml(t('workspace.export.exportedOn', { date: ctx.dateStr }))}</div>`);
  lines.push(`<div class="meta">${escapeHtml(t('workspace.export.conversationId', { id: ctx.conversationId }))}</div>`);
  if (ctx.agentName) {
    lines.push(`<div class="meta">${escapeHtml(t('workspace.export.agentName', { name: ctx.agentName }))}</div>`);
  }
  if (ctx.agentId) {
    lines.push(`<div class="meta">${escapeHtml(t('workspace.export.agentId', { id: ctx.agentId }))}</div>`);
  }
  if (ctx.userId) {
    lines.push(`<div class="meta">${escapeHtml(t('workspace.export.userId', { id: ctx.userId }))}</div>`);
  }
  if (ctx.userEmail) {
    lines.push(`<div class="meta">${escapeHtml(t('workspace.export.userEmail', { email: ctx.userEmail }))}</div>`);
  }
  if (ctx.environment) {
    lines.push(`<div class="meta">${escapeHtml(t('workspace.export.environment', { env: ctx.environment }))}</div>`);
  }
  return lines.join('\n');
}

function renderContextMetaText(ctx: ExportContext, t: TFunction): string[] {
  const lines: string[] = [];
  lines.push(t('workspace.export.exportedOn', { date: ctx.dateStr }));
  lines.push(t('workspace.export.conversationId', { id: ctx.conversationId }));
  if (ctx.agentName) lines.push(t('workspace.export.agentName', { name: ctx.agentName }));
  if (ctx.agentId) lines.push(t('workspace.export.agentId', { id: ctx.agentId }));
  if (ctx.userId) lines.push(t('workspace.export.userId', { id: ctx.userId }));
  if (ctx.userEmail) lines.push(t('workspace.export.userEmail', { email: ctx.userEmail }));
  if (ctx.environment) lines.push(t('workspace.export.environment', { env: ctx.environment }));
  return lines;
}

function generateHtml(exportedMessages: ExportedMessage[], ctx: ExportContext, t: TFunction): string {
  const assistantLabel = t('workspace.export.roles.assistant');
  const messagesHtml = exportedMessages
    .map((msg) => {
      const segmentsHtml = msg.segments.map(renderSegmentHtml).join('\n');
      // User messages: no role label — the styled card already signals it.
      // Assistant messages: Numa wordmark + name so the export feels branded.
      const header =
        msg.role === 'assistant'
          ? `<div class="role"><span class="role-mark">${NUMA_LOGO_SVG}</span><span>${escapeHtml(assistantLabel)}</span></div>`
          : '';
      return `
    <div class="message ${msg.role}">
      ${header}
      ${segmentsHtml}
    </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(t('workspace.export.title'))}</title>
<style>
  :root {
    --brand-primary: #8e50a7;
    --text-primary: #1f2937;
    --text-secondary: #4b5563;
    --text-muted: #6b7280;
    --text-light: #9ca3af;
    --border-color: #e5e7eb;
    --bg-page: #faf9fb;
    --bg-card: #ffffff;
    --green: #22c55e;
    --red: #dc2626;
  }

  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: var(--bg-page); color: var(--text-primary); }
  h1 { font-size: 1.5rem; border-bottom: 2px solid var(--border-color); padding-bottom: 0.75rem; color: var(--text-primary); }
  .meta { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 2rem; }

  /* Messages */
  .message { margin-bottom: 1.5rem; padding: 1rem 1.25rem; border-radius: 12px; }
  .message.user { background: #f0ecf4; border-left: 4px solid var(--brand-primary); }
  .message.assistant { background: var(--bg-card); border: 1px solid var(--border-color); border-left: 4px solid var(--brand-primary); }
  .role { font-weight: 600; margin-bottom: 0.5rem; font-size: 0.8125rem; letter-spacing: 0.01em; display: inline-flex; align-items: center; gap: 0.4rem; color: var(--brand-primary); }
  .role-mark { display: inline-flex; align-items: center; color: var(--brand-primary); }
  .role-mark svg { display: block; }

  /* Inline reference chips (file/folder/kb-source) — mirrors live chat pills */
  .ref-chip { display: inline-flex; align-items: center; gap: 0.3em; padding: 0.05em 0.45em; margin: 0 0.1em; border-radius: 6px; background: #f1ecf6; color: var(--brand-primary); font-size: 0.9em; font-family: 'SF Mono', Monaco, Consolas, monospace; vertical-align: baseline; }
  .ref-chip.ref-folder { background: #ebf2fa; color: #185fa5; }
  .ref-chip.ref-kb { background: #eaf3de; color: #3b6d11; }

  /* Markdown content */
  .content { line-height: 1.6; color: var(--text-primary); }
  .content p { margin: 0 0 0.75rem 0; }
  .content p:last-child { margin-bottom: 0; }
  .content strong { font-weight: 600; }
  .content em { font-style: italic; }
  .content code { background: #f1f3f5; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.875em; font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', monospace; color: var(--brand-primary); }
  .content pre { background: #1e1e2e; color: #cdd6f4; padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 0.75rem 0; }
  .content pre code { background: none; padding: 0; color: inherit; font-size: 0.85em; }
  .content blockquote { border-left: 3px solid var(--border-color); padding-left: 1rem; color: var(--text-muted); margin: 0.75rem 0; }
  .content ul, .content ol { margin: 0.5rem 0; padding-left: 1.5rem; }
  .content li { margin-bottom: 0.25rem; }
  .content table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
  .content th, .content td { border: 1px solid var(--border-color); padding: 0.5rem 0.75rem; text-align: left; }
  .content th { background: #f9fafb; font-weight: 600; }
  .content h1, .content h2, .content h3, .content h4 { margin: 1rem 0 0.5rem 0; }
  .content hr { border: none; border-top: 1px solid var(--border-color); margin: 1rem 0; }
  .content a { color: var(--brand-primary); text-decoration: none; }
  .content a:hover { text-decoration: underline; }
  .content img { max-width: 100%; }

  /* Inline tool calls — matches Numa UI inline tool style */
  .segment-tool { display: flex; align-items: center; gap: 0.5rem; padding: 0.125rem 0; margin: 0.375rem 0; font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5; }
  .segment-tool.error { color: var(--red); }
  .segment-tool.error .tool-icon { color: var(--red); }
  .tool-icon { width: 16px; height: 16px; min-width: 16px; flex-shrink: 0; color: var(--brand-primary); opacity: 0.7; }
  .tool-text { flex: 1; min-width: 0; }

  /* Todo card — matches Numa UI task list card */
  .todo-card { border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-card); margin: 0.75rem 0; overflow: hidden; }
  .todo-header { display: flex; align-items: center; justify-content: space-between; padding: 0.625rem 1rem; background: #f9fafb; border-bottom: 1px solid var(--border-color); font-size: 0.8125rem; }
  .todo-title { color: #374151; font-weight: 500; display: flex; align-items: center; gap: 0.375rem; }
  .todo-header-icon { width: 16px; height: 16px; color: var(--text-light); }
  .todo-progress { color: var(--text-muted); font-size: 0.75rem; background: var(--border-color); padding: 0.125rem 0.5rem; border-radius: 12px; }
  .todo-list { padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .todo-item { display: flex; align-items: flex-start; gap: 0.625rem; font-size: 0.875rem; line-height: 1.4; }
  .todo-icon { width: 16px; height: 16px; min-width: 16px; flex-shrink: 0; margin-top: 0.125rem; }
  .todo-icon.completed { color: var(--green); }
  .todo-icon.in-progress { color: var(--brand-primary); }
  .todo-icon.pending { color: #d1d5db; }
  .todo-item.status-pending .todo-text { color: var(--text-muted); }
  .todo-item.status-in_progress .todo-text { color: #374151; font-weight: 500; }
  .todo-item.status-completed .todo-text { color: var(--text-light); text-decoration: line-through; }

  /* Subagent segments */
  .segment-subagent { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0; margin: 0.375rem 0; font-size: 0.875rem; color: var(--text-secondary); }
  .subagent-icon { width: 16px; height: 16px; min-width: 16px; flex-shrink: 0; color: var(--brand-primary); opacity: 0.7; }

  /* File segments */
  .segment-file { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; margin: 0.375rem 0; background: #f3f4f6; border-radius: 8px; font-size: 0.875rem; color: var(--text-secondary); }
  .file-icon { width: 14px; height: 14px; min-width: 14px; flex-shrink: 0; color: var(--text-muted); }

  /* Render tool exports */
  .render-export-title { font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px; margin-top: 0.5rem; }
</style>
</head>
<body>
<h1>${escapeHtml(t('workspace.export.title'))}</h1>
${renderContextMetaHtml(ctx, t)}
${messagesHtml}
</body>
</html>`;
}

/* ---------- Plain Text Generation ---------- */

function renderSegmentText(seg: ExportSegment): string {
  switch (seg.kind) {
    case 'text':
      return seg.markdown;

    case 'tool':
      return seg.isError ? `[Tool Error: ${seg.displayText}]` : `[Tool: ${seg.displayText}]`;

    case 'todo':
      return seg.items
        .map((item) => {
          const marker = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[~]' : '[ ]';
          return `${marker} ${item.content}`;
        })
        .join('\n');

    case 'subagent':
      return `[Task (${seg.subagentType}): ${seg.taskDescription}]`;

    case 'file':
      return `[${seg.label}]`;

    case 'render':
      return seg.title ? `[Rendered: ${seg.title}]` : '[Rendered content]';

    case 'pending_render':
      return seg.title ? `[Rendered: ${seg.title}]` : '[Rendered content]';
  }
}

function generatePlainText(exportedMessages: ExportedMessage[], ctx: ExportContext, t: TFunction): string {
  const title = t('workspace.export.title');
  const metaLines = renderContextMetaText(ctx, t);
  const lines = [title, ...metaLines, '', '---', ''];

  for (const msg of exportedMessages) {
    // Plain text: keep a role label so it's still parseable. The HTML export
    // drops the user label since the styling already conveys it.
    const label = msg.role === 'user' ? t('workspace.export.roles.user') : t('workspace.export.roles.assistant');
    lines.push(`${label}:`);

    for (const seg of msg.segments) {
      lines.push(renderSegmentText(seg));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/* ---------- Download ---------- */

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Component ---------- */

export function ExportConversationButton({
  messages,
  conversationId,
  agentName,
  agentId,
  userId,
  userEmail,
  environment,
  getCredentials,
}: ExportConversationButtonProps) {
  const { t } = useTranslation('chat');

  const handleExport = async (format: 'html' | 'txt') => {
    const initial = extractExportMessages(messages, t);
    if (initial.length === 0) return;

    // Resolve any large render payloads from S3 before generating the document.
    // Without credentials (or on fetch failure) placeholders downgrade to a
    // tool indicator line — better than dropping the segment silently.
    const exportedMessages = conversationId
      ? await resolvePendingRenders(initial, conversationId, userId, getCredentials, t)
      : initial;

    const dateStr = new Date().toLocaleString();
    const shortId = conversationId ? conversationId.substring(0, 8) : 'chat';
    const dateSlug = new Date().toISOString().slice(0, 10);
    const ctx: ExportContext = {
      conversationId: conversationId!,
      dateStr,
      agentName,
      agentId,
      userId,
      userEmail,
      environment,
    };

    if (format === 'html') {
      const html = generateHtml(exportedMessages, ctx, t);
      downloadFile(html, `conversation-${shortId}-${dateSlug}.html`, 'text/html');
    } else {
      const text = generatePlainText(exportedMessages, ctx, t);
      downloadFile(text, `conversation-${shortId}-${dateSlug}.txt`, 'text/plain');
    }
  };

  const hasMessages = messages.some((m) => m.role === 'user' || m.role === 'assistant');

  if (!conversationId || !hasMessages) {
    return null;
  }

  return (
    <Dropdown>
      <Dropdown.Toggle
        as="button"
        className="workspace-chat-settings-btn"
        title={t('workspace.export.button')}
        aria-label={t('workspace.export.button')}
      >
        <Share size={18} />
      </Dropdown.Toggle>

      <Dropdown.Menu>
        <Dropdown.Item onClick={() => handleExport('html')}>
          <i className="bi bi-filetype-html me-2"></i>
          {t('workspace.export.html')}
          <div className="small text-muted">{t('workspace.export.htmlDesc')}</div>
        </Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => handleExport('txt')}>
          <i className="bi bi-file-text me-2"></i>
          {t('workspace.export.text')}
          <div className="small text-muted">{t('workspace.export.textDesc')}</div>
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}

export default ExportConversationButton;
