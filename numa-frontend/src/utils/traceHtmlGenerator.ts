/**
 * Utility for generating styled HTML from Claude Code trace files.
 *
 * This is a dev tool for downloading and viewing traces locally.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TraceEvent = Record<string, any>;

/**
 * Parse NDJSON trace content into an array of events.
 */
function parseNdjson(content: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  const lines = content.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Filter events based on mode.
 * - 'full': Keep all events
 * - 'clean': Remove stream_event (noisy streaming deltas)
 */
function filterEvents(events: TraceEvent[], mode: 'full' | 'clean'): TraceEvent[] {
  if (mode === 'full') {
    return events;
  }

  // Clean mode: filter out stream_event types
  return events.filter((event) => event.type !== 'stream_event');
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Format JSON with syntax highlighting.
 */
function formatJson(obj: unknown): string {
  try {
    const json = JSON.stringify(obj, null, 2);
    return `<pre class="json-block">${escapeHtml(json)}</pre>`;
  } catch {
    return `<pre class="json-block">${escapeHtml(String(obj))}</pre>`;
  }
}

/**
 * Get CSS class for event type.
 */
function getEventClass(type: string): string {
  switch (type) {
    case 'system':
      return 'event-system';
    case 'user':
      return 'event-user';
    case 'assistant':
      return 'event-assistant';
    case 'stream_event':
      return 'event-stream';
    case 'error':
      return 'event-error';
    default:
      return 'event-other';
  }
}

/**
 * Render a single event to HTML.
 */
function renderEvent(event: TraceEvent, index: number): string {
  const eventClass = getEventClass(event.type);
  const eventType = escapeHtml(event.type || 'unknown');

  let content = '';

  // Handle different event types
  if (event.type === 'system' && event.subtype === 'init') {
    // System init - show key info
    content = `
      <div class="event-header">System Init</div>
      <div class="event-meta">
        <span>Model: ${escapeHtml(event.model || 'unknown')}</span>
        <span>Session: ${escapeHtml((event.session_id || '').substring(0, 8))}...</span>
      </div>
      <div class="event-detail">
        <strong>Tools:</strong> ${(event.tools || []).map(escapeHtml).join(', ')}
      </div>
      <div class="event-detail">
        <strong>Agents:</strong> ${(event.agents || []).map(escapeHtml).join(', ')}
      </div>
    `;
  } else if (event.type === 'user') {
    // User message or tool result
    const message = event.message;
    if (message?.content) {
      content = '<div class="event-header">User</div>';
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          const resultContent =
            typeof block.content === 'string' ? escapeHtml(block.content) : formatJson(block.content);
          content += `
            <div class="tool-result">
              <div class="tool-result-header">Tool Result: ${escapeHtml(block.tool_use_id || '').substring(0, 12)}...</div>
              <pre class="tool-result-content">${resultContent}</pre>
            </div>
          `;
        } else if (block.type === 'text') {
          content += `<div class="user-text">${escapeHtml(block.text || '')}</div>`;
        }
      }
    } else {
      content = formatJson(event);
    }
  } else if (event.type === 'assistant') {
    // Assistant message
    const message = event.message;
    content = '<div class="event-header">Assistant</div>';

    if (message?.content) {
      for (const block of message.content) {
        if (block.type === 'thinking') {
          const thinking = block.thinking || '';
          // Show first 200 chars with expand
          const _preview = thinking.substring(0, 200);
          const _hasMore = thinking.length > 200;
          content += `
            <details class="thinking-block">
              <summary>Thinking (${thinking.length} chars)</summary>
              <div class="thinking-content">${escapeHtml(thinking)}</div>
            </details>
          `;
        } else if (block.type === 'text') {
          content += `<div class="assistant-text">${escapeHtml(block.text || '')}</div>`;
        } else if (block.type === 'tool_use') {
          content += `
            <div class="tool-use">
              <div class="tool-use-header">${escapeHtml(block.name || 'Unknown Tool')}</div>
              <div class="tool-use-id">ID: ${escapeHtml((block.id || '').substring(0, 12))}...</div>
              ${formatJson(block.input)}
            </div>
          `;
        }
      }
    } else {
      content = formatJson(event);
    }
  } else if (event.type === 'stream_event') {
    // Streaming delta - show compact
    const eventData = event.event;
    const eventSubtype = eventData?.type || 'unknown';
    content = `
      <div class="event-header">Stream: ${escapeHtml(eventSubtype)}</div>
      <details>
        <summary>Event data</summary>
        ${formatJson(event)}
      </details>
    `;
  } else if (event.type === 'error') {
    content = `
      <div class="event-header">Error</div>
      <pre class="error-content">${escapeHtml(JSON.stringify(event, null, 2))}</pre>
    `;
  } else {
    // Generic event
    content = `
      <div class="event-header">${eventType}</div>
      ${formatJson(event)}
    `;
  }

  return `
    <div class="event ${eventClass}" data-index="${index}">
      <div class="event-index">#${index + 1}</div>
      ${content}
    </div>
  `;
}

/**
 * Generate complete HTML document for trace.
 */
export function generateTraceHtml(traceContent: string, mode: 'full' | 'clean', conversationId: string): string {
  const allEvents = parseNdjson(traceContent);
  const events = filterEvents(allEvents, mode);
  const timestamp = new Date().toISOString();

  const styles = `
    :root {
      --bg-primary: #1e1e1e;
      --bg-secondary: #252526;
      --bg-tertiary: #2d2d30;
      --text-primary: #d4d4d4;
      --text-secondary: #9cdcfe;
      --text-muted: #808080;
      --border-color: #404040;
      --system-color: #4fc3f7;
      --system-bg: #1e3a5f;
      --user-color: #4caf50;
      --user-bg: #1b4332;
      --assistant-color: #9c27b0;
      --assistant-bg: #2d1b4e;
      --tool-color: #ff9800;
      --tool-bg: #3d2c1e;
      --stream-color: #607d8b;
      --stream-bg: #263238;
      --error-color: #f44336;
      --error-bg: #3d1e1e;
    }
    * { box-sizing: border-box; }
    body {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
      padding: 20px;
    }
    h1 {
      color: var(--text-secondary);
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    .meta {
      color: var(--text-muted);
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border-color);
    }
    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 10px;
    }
    .stat {
      background: var(--bg-secondary);
      padding: 8px 16px;
      border-radius: 4px;
    }
    .event {
      margin: 12px 0;
      padding: 12px;
      border-radius: 6px;
      position: relative;
      border-left: 4px solid var(--border-color);
    }
    .event-index {
      position: absolute;
      top: 8px;
      right: 12px;
      color: var(--text-muted);
      font-size: 11px;
    }
    .event-header {
      font-weight: bold;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .event-meta {
      display: flex;
      gap: 16px;
      color: var(--text-muted);
      font-size: 12px;
      margin-bottom: 8px;
    }
    .event-detail {
      margin: 4px 0;
      font-size: 12px;
    }
    .event-system { background: var(--system-bg); border-left-color: var(--system-color); }
    .event-system .event-header { color: var(--system-color); }
    .event-user { background: var(--user-bg); border-left-color: var(--user-color); }
    .event-user .event-header { color: var(--user-color); }
    .event-assistant { background: var(--assistant-bg); border-left-color: var(--assistant-color); }
    .event-assistant .event-header { color: var(--assistant-color); }
    .event-stream { background: var(--stream-bg); border-left-color: var(--stream-color); }
    .event-stream .event-header { color: var(--stream-color); }
    .event-error { background: var(--error-bg); border-left-color: var(--error-color); }
    .event-error .event-header { color: var(--error-color); }
    .event-other { background: var(--bg-secondary); }
    pre, .json-block {
      background: var(--bg-tertiary);
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 8px 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .tool-use {
      background: var(--tool-bg);
      border-left: 3px solid var(--tool-color);
      padding: 10px;
      margin: 8px 0;
      border-radius: 4px;
    }
    .tool-use-header {
      color: var(--tool-color);
      font-weight: bold;
      margin-bottom: 4px;
    }
    .tool-use-id {
      color: var(--text-muted);
      font-size: 11px;
      margin-bottom: 8px;
    }
    .tool-result {
      background: var(--bg-tertiary);
      padding: 10px;
      margin: 8px 0;
      border-radius: 4px;
      border-left: 3px solid var(--user-color);
    }
    .tool-result-header {
      color: var(--user-color);
      font-weight: bold;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .tool-result-content {
      margin: 0;
      max-height: 400px;
      overflow-y: auto;
    }
    .thinking-block {
      background: var(--bg-tertiary);
      padding: 8px;
      margin: 8px 0;
      border-radius: 4px;
    }
    .thinking-block summary {
      cursor: pointer;
      color: var(--text-muted);
      font-style: italic;
    }
    .thinking-content {
      margin-top: 8px;
      color: var(--text-muted);
      white-space: pre-wrap;
    }
    .user-text, .assistant-text {
      white-space: pre-wrap;
      margin: 8px 0;
    }
    details summary {
      cursor: pointer;
      color: var(--text-secondary);
    }
    details[open] summary {
      margin-bottom: 8px;
    }
  `;

  const eventsHtml = events.map((event, i) => renderEvent(event, i)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trace: ${escapeHtml(conversationId.substring(0, 8))}...</title>
  <style>${styles}</style>
</head>
<body>
  <h1>Conversation Trace</h1>
  <div class="meta">
    <div class="stats">
      <div class="stat">ID: ${escapeHtml(conversationId)}</div>
      <div class="stat">Mode: ${escapeHtml(mode)}</div>
      <div class="stat">Events: ${events.length}${mode === 'clean' ? ` (filtered from ${allEvents.length})` : ''}</div>
    </div>
    <div>Generated: ${escapeHtml(timestamp)}</div>
  </div>
  <div class="events">
    ${eventsHtml}
  </div>
</body>
</html>`;
}

/**
 * Trigger download of HTML content as a file.
 */
export function downloadHtmlFile(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
