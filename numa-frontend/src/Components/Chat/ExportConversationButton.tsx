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

/* ---------- Types ---------- */

interface ExportMessage {
  role: string;
  content?: string;
  segments?: WorkspaceChatSegment[];
}

interface ExportConversationButtonProps {
  messages: ExportMessage[];
  conversationId: string | null;
}

type ExportSegment =
  | { kind: 'text'; markdown: string }
  | { kind: 'tool'; displayText: string; isError?: boolean }
  | { kind: 'todo'; items: Array<{ content: string; status: string }> }
  | { kind: 'subagent'; taskDescription: string; subagentType: string }
  | { kind: 'file'; label: string };

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

          case 'tool_card':
            if (seg.label) {
              segments.push({
                kind: 'tool',
                displayText: t('workspace.export.segments.callingTool', {
                  tool: formatToolName(seg.toolName),
                  description: seg.label,
                }),
                isError: seg.isError,
              });
            }
            break;

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

/* ---------- HTML Generation ---------- */

function renderSegmentHtml(seg: ExportSegment): string {
  switch (seg.kind) {
    case 'text':
      return `<div class="content">${markdownToHtml(seg.markdown)}</div>`;

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
  }
}

function generateHtml(
  exportedMessages: ExportedMessage[],
  dateStr: string,
  conversationId: string,
  t: TFunction
): string {
  const messagesHtml = exportedMessages
    .map((msg) => {
      const roleLabel = msg.role === 'user' ? t('workspace.export.roles.user') : t('workspace.export.roles.assistant');
      const segmentsHtml = msg.segments.map(renderSegmentHtml).join('\n');
      return `
    <div class="message ${msg.role}">
      <div class="role">${escapeHtml(roleLabel)}</div>
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
  .role { font-weight: 600; margin-bottom: 0.5rem; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .message.user .role { color: var(--brand-primary); }
  .message.assistant .role { color: var(--brand-primary); }

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
</style>
</head>
<body>
<h1>${escapeHtml(t('workspace.export.title'))}</h1>
<div class="meta">${escapeHtml(t('workspace.export.exportedOn', { date: dateStr }))}</div>
<div class="meta">${escapeHtml(t('workspace.export.conversationId', { id: conversationId }))}</div>
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
  }
}

function generatePlainText(
  exportedMessages: ExportedMessage[],
  dateStr: string,
  conversationId: string,
  t: TFunction
): string {
  const title = t('workspace.export.title');
  const exportedOn = t('workspace.export.exportedOn', { date: dateStr });
  const convId = t('workspace.export.conversationId', { id: conversationId });
  const lines = [title, exportedOn, convId, '', '---', ''];

  for (const msg of exportedMessages) {
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

export function ExportConversationButton({ messages, conversationId }: ExportConversationButtonProps) {
  const { t } = useTranslation('chat');

  const handleExport = (format: 'html' | 'txt') => {
    const exportedMessages = extractExportMessages(messages, t);
    if (exportedMessages.length === 0) return;

    const dateStr = new Date().toLocaleString();
    const shortId = conversationId ? conversationId.substring(0, 8) : 'chat';
    const dateSlug = new Date().toISOString().slice(0, 10);

    if (format === 'html') {
      const html = generateHtml(exportedMessages, dateStr, conversationId, t);
      downloadFile(html, `conversation-${shortId}-${dateSlug}.html`, 'text/html');
    } else {
      const text = generatePlainText(exportedMessages, dateStr, conversationId, t);
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
