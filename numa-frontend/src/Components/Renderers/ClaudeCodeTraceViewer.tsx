import React, { useState, useEffect } from 'react';
import { Spinner, Button, Collapse, Dropdown } from 'react-bootstrap';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { TraceEvent, TraceEventData, TraceContentBlock } from './ClaudeCodeTraceEvent';

interface TraceViewerProps {
  traceS3Key: string; // e.g., "data-analysis/{userId}/{jobId}/trace/trace.jsonl"
  bucket: string;
  region: string;
  defaultExpanded?: boolean;
}

export const TraceViewer: React.FC<TraceViewerProps> = ({ traceS3Key, bucket, defaultExpanded = false }) => {
  const { getCredentials } = useAuth();
  const { fetchS3Content } = useNumaApp();
  const [traceContent, setTraceContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedEvents, setParsedEvents] = useState<TraceEventData[]>([]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Fetch trace file from S3 when expanded
  useEffect(() => {
    if (!expanded || traceContent) return;

    const loadTrace = async () => {
      setLoading(true);
      setError(null);

      try {
        const credentials = await getCredentials();
        if (!credentials) {
          throw new Error('Failed to get credentials');
        }

        const content = await fetchS3Content(bucket, traceS3Key, credentials);
        setTraceContent(content);
      } catch (err) {
        console.error('Error loading trace file:', err);
        setError(`Failed to load trace: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    loadTrace();
  }, [expanded, traceContent, bucket, traceS3Key, getCredentials, fetchS3Content]);

  // Parse NDJSON and filter to meaningful events
  useEffect(() => {
    if (!traceContent) return;

    try {
      const lines = traceContent.split('\n').filter((line) => line.trim());
      const events: TraceEventData[] = [];

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as TraceEventData;

          // Filter: only include system, assistant, and user message types
          // Exclude stream_event (these are partial/incremental deltas)
          if (event.type === 'system' && event.subtype === 'init') {
            events.push(event);
          } else if (event.type === 'assistant') {
            events.push(event);
          } else if (event.type === 'user') {
            events.push(event);
          }
        } catch (parseError) {
          // Skip malformed lines
          console.warn('Failed to parse trace line:', parseError);
        }
      }

      setParsedEvents(events);
    } catch (err) {
      console.error('Error parsing trace content:', err);
      setError('Failed to parse trace file');
    }
  }, [traceContent]);

  const generateFormattedHTML = (events: TraceEventData[], totalLines: number): string => {
    const eventsHTML = events
      .map((event) => {
        if (event.type === 'system' && event.subtype === 'init') {
          return `
            <div class="trace-step">
              <span class="step-indicator system"></span>
              <div class="flex-grow-1">
                <div class="trace-event-card system-event">
                  <div class="trace-event-header">
                    <i class="bi bi-gear-fill"></i>
                    <span class="trace-event-title">Session Initialized</span>
                  </div>
                  <div class="trace-event-details">
                    <div>Model: ${event.model || 'N/A'}</div>
                    <div>Tools: ${event.tools?.join(', ') || 'None'}</div>
                  </div>
                </div>
              </div>
            </div>`;
        }

        if (event.type === 'assistant') {
          const content = (event.message?.content ?? event.content ?? []) as TraceContentBlock[];
          return content
            .map((block) => {
              if (block.type === 'thinking') {
                return `
                  <div class="trace-step">
                    <span class="step-indicator assistant"></span>
                    <div class="flex-grow-1">
                      <div class="trace-event-card thinking-card">
                        <div class="trace-event-header">
                          <i class="bi bi-lightbulb"></i>
                          <span class="trace-event-title">Thinking</span>
                        </div>
                        <div class="trace-event-content">
                          <pre>${escapeHtml(block.thinking || '')}</pre>
                        </div>
                      </div>
                    </div>
                  </div>`;
              }
              if (block.type === 'text') {
                return `
                  <div class="trace-step">
                    <span class="step-indicator assistant"></span>
                    <div class="flex-grow-1">
                      <div class="trace-event-card text-card">
                        <div class="trace-event-header">
                          <span class="trace-event-title">Numa</span>
                        </div>
                        <div class="trace-event-content">${escapeHtml(block.text || '')}</div>
                      </div>
                    </div>
                  </div>`;
              }
              if (block.type === 'tool_use') {
                return `
                  <div class="trace-step">
                    <span class="step-indicator assistant"></span>
                    <div class="flex-grow-1">
                      <div class="trace-event-card tool-use-card">
                        <div class="trace-event-header">
                          <i class="bi bi-tools"></i>
                          <span class="trace-event-title">${escapeHtml(block.name || '')}</span>
                          <span class="trace-event-label">Tool Call</span>
                        </div>
                        <div class="trace-event-content">
                          <pre>${escapeHtml(JSON.stringify(block.input, null, 2))}</pre>
                        </div>
                      </div>
                    </div>
                  </div>`;
              }
              return '';
            })
            .join('');
        }

        if (event.type === 'user') {
          const content = (event.message?.content ?? event.content ?? []) as TraceContentBlock[];
          return content
            .map((block) => {
              if (block.type === 'tool_result') {
                const isError = block.is_error === true;
                const contentStr =
                  typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
                return `
                  <div class="trace-step">
                    <span class="step-indicator result"></span>
                    <div class="flex-grow-1">
                      <div class="trace-event-card tool-result-card ${isError ? 'error' : 'success'}">
                        <div class="trace-event-header">
                          <i class="bi ${isError ? 'bi-x-circle' : 'bi-check-circle'}"></i>
                          <span class="trace-event-title">Tool Result</span>
                          ${isError ? '<span class="trace-event-label error">Error</span>' : ''}
                        </div>
                        <div class="trace-event-content">
                          <pre>${escapeHtml(contentStr)}</pre>
                        </div>
                      </div>
                    </div>
                  </div>`;
              }
              return '';
            })
            .join('');
        }

        return '';
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Execution Trace</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f8f9fa;
      padding: 2rem;
      color: #212529;
    }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; color: #8e50a7; }
    .meta { color: #6c757d; font-size: 0.875rem; margin-bottom: 2rem; }
    .trace-timeline { display: flex; flex-direction: column; gap: 1rem; }
    .trace-step { display: flex; gap: 1rem; position: relative; }
    .step-indicator { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; margin-top: 0.5rem; }
    .step-indicator.system { background: #6c757d; }
    .step-indicator.assistant { background: #8e50a7; }
    .step-indicator.result { background: #28a745; }
    .flex-grow-1 { flex: 1; }
    .trace-event-card {
      border: 1px solid #dee2e6;
      border-radius: 6px;
      overflow: hidden;
      background: white;
      margin-bottom: 0.5rem;
    }
    .trace-event-card.thinking-card { border-left: 4px solid #ffc107; }
    .trace-event-card.text-card { border-left: 4px solid #8e50a7; }
    .trace-event-card.tool-use-card { border-left: 4px solid #17a2b8; }
    .trace-event-card.tool-result-card.success { border-left: 4px solid #28a745; }
    .trace-event-card.tool-result-card.error { border-left: 4px solid #dc3545; }
    .trace-event-card.system-event { border-left: 4px solid #6c757d; }
    .trace-event-header {
      background: #f8f9fa;
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
    }
    .trace-event-header i { color: #8e50a7; }
    .trace-event-title { font-size: 0.95rem; }
    .trace-event-label {
      margin-left: auto;
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      background: #e9ecef;
      color: #495057;
    }
    .trace-event-label.error { background: #f8d7da; color: #721c24; }
    .trace-event-content { padding: 1rem; }
    .trace-event-content pre {
      background: #f8f9fa;
      padding: 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .trace-event-details { padding: 0.75rem 1rem; font-size: 0.9rem; }
    .trace-event-details div { margin-bottom: 0.25rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>
      <i class="bi bi-clock-history"></i>
      Execution Trace
    </h1>
    <div class="meta">
      Showing ${events.length} events (filtered from ${totalLines} total lines)
    </div>
    <div class="trace-timeline">
      ${eventsHTML}
    </div>
  </div>
</body>
</html>`;
  };

  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const handleDownloadRaw = () => {
    if (!traceContent) return;
    const blob = new Blob([traceContent], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trace.jsonl';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadFormatted = () => {
    if (!parsedEvents.length) return;

    const html = generateFormattedHTML(parsedEvents, traceContent?.split('\n').filter((l) => l.trim()).length || 0);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trace.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="trace-viewer-section mt-5 pt-4 border-top">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0">
          <i className="bi bi-clock-history me-2"></i>
          Execution Trace
        </h4>
        <div className="d-flex gap-2">
          {traceContent && (
            <Dropdown>
              <Dropdown.Toggle variant="outline-secondary" size="sm" id="trace-download-dropdown">
                <i className="bi bi-download me-1"></i>
                Download
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item onClick={handleDownloadRaw}>
                  <i className="bi bi-file-earmark-code me-2"></i>
                  Raw (JSONL)
                </Dropdown.Item>
                <Dropdown.Item onClick={handleDownloadFormatted}>
                  <i className="bi bi-file-earmark-richtext me-2"></i>
                  Formatted (HTML)
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          )}
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            aria-controls="trace-viewer-collapse"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                <i className="bi bi-chevron-up me-1"></i>
                Hide Trace
              </>
            ) : (
              <>
                <i className="bi bi-chevron-down me-1"></i>
                Show Trace
              </>
            )}
          </Button>
        </div>
      </div>

      <Collapse in={expanded}>
        <div id="trace-viewer-collapse">
          {loading && (
            <div className="text-center py-4">
              <Spinner animation="border" size="sm" />
              <span className="ms-2">Loading execution trace...</span>
            </div>
          )}

          {error && (
            <div className="alert alert-warning">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {error}
            </div>
          )}

          {!loading && !error && parsedEvents.length === 0 && traceContent && (
            <div className="alert alert-info">
              <i className="bi bi-info-circle me-2"></i>
              No trace events found
            </div>
          )}

          {!loading && !error && parsedEvents.length > 0 && (
            <div className="trace-timeline">
              <div className="mb-3 d-flex justify-content-between align-items-center">
                <span className="text-muted small">
                  <i className="bi bi-info-circle me-1"></i>
                  Showing {parsedEvents.length} events (filtered from{' '}
                  {traceContent?.split('\n').filter((l) => l.trim()).length || 0} total lines)
                </span>
              </div>
              <div className="trace-events-container">
                {parsedEvents.map((event, index) => (
                  <TraceEvent key={index} event={event} />
                ))}
              </div>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
};
