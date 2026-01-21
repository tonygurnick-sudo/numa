import React, { useState } from 'react';
import { Collapse } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

type TraceThinkingBlock = { type: 'thinking'; thinking?: string };
type TraceTextBlock = { type: 'text'; text?: string };
type TraceToolUseBlock = { type: 'tool_use'; name?: string; input?: unknown };
type TraceToolResultBlock = { type: 'tool_result'; is_error?: boolean; content?: unknown };
export type TraceContentBlock =
  | TraceThinkingBlock
  | TraceTextBlock
  | TraceToolUseBlock
  | TraceToolResultBlock
  | { type: string; [key: string]: unknown };

export interface TraceEventData {
  type: 'system' | 'assistant' | 'user' | string;
  subtype?: string;
  model?: string;
  tools?: string[];
  message?: { content?: TraceContentBlock[] };
  content?: TraceContentBlock[];
}

interface TraceEventProps {
  event: TraceEventData;
}

export const TraceEvent: React.FC<TraceEventProps> = ({ event }) => {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(true);

  // Render system initialization event
  const renderSystemEvent = () => {
    return (
      <div className="trace-step">
        <span className="step-indicator system" />
        <div className="flex-grow-1">
          <div className="trace-event-card system-event">
            <div className="trace-event-header">
              <i className="bi bi-gear-fill me-2"></i>
              <span className="trace-event-title">{t('traceViewer.sessionInitialized')}</span>
            </div>
            <div className="trace-event-details">
              <div>{t('traceViewer.modelLabel', { model: event.model || t('traceViewer.unknownModel') })}</div>
              <div>{t('traceViewer.toolsLabel', { tools: event.tools?.join(', ') || t('traceViewer.none') })}</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render assistant message (thinking + text + tool_use)
  const renderAssistantMessage = () => {
    const content = (event.message?.content ?? event.content ?? []) as TraceContentBlock[];

    return (
      <div className="trace-step">
        <span className="step-indicator assistant" />
        <div className="flex-grow-1">
          {content.map((block, blockIndex: number) => {
            // Thinking block
            if (block.type === 'thinking') {
              return (
                <div key={blockIndex} className="trace-event-card thinking-card" onClick={() => setExpanded(!expanded)}>
                  <div className="trace-event-header">
                    <i className="bi bi-lightbulb me-2"></i>
                    <span className="trace-event-title">{t('traceViewer.thinking')}</span>
                    <i className={`bi bi-chevron-${expanded ? 'up' : 'down'} ms-auto`}></i>
                  </div>
                  <Collapse in={expanded}>
                    <div className="trace-event-content">
                      <pre>{block.thinking}</pre>
                    </div>
                  </Collapse>
                </div>
              );
            }

            // Text block
            if (block.type === 'text') {
              return (
                <div key={blockIndex} className="trace-event-card text-card">
                  <div className="trace-event-header">
                    <img src="/numa-logo.svg" alt={t('traceViewer.numaAlt')} className="numa-logo-icon" />
                    <span className="trace-event-title">{t('traceViewer.numa')}</span>
                  </div>
                  <div className="trace-event-content">{block.text}</div>
                </div>
              );
            }

            // Tool use block
            if (block.type === 'tool_use') {
              return (
                <div key={blockIndex} className="trace-event-card tool-use-card" onClick={() => setExpanded(!expanded)}>
                  <div className="trace-event-header">
                    <i className="bi bi-tools me-2"></i>
                    <span className="trace-event-title">{block.name}</span>
                    <span className="trace-event-label">{t('traceViewer.toolCall')}</span>
                    <i className={`bi bi-chevron-${expanded ? 'up' : 'down'} ms-auto`}></i>
                  </div>
                  <Collapse in={expanded}>
                    <div className="trace-event-content">
                      <pre>{JSON.stringify(block.input, null, 2)}</pre>
                    </div>
                  </Collapse>
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    );
  };

  // Render user message (tool results)
  const renderUserMessage = () => {
    const content = (event.message?.content ?? event.content ?? []) as TraceContentBlock[];

    return (
      <div className="trace-step">
        <span className="step-indicator result" />
        <div className="flex-grow-1">
          {content.map((block, blockIndex: number) => {
            if (block.type === 'tool_result') {
              const isError = block.is_error === true;
              return (
                <div
                  key={blockIndex}
                  className={`trace-event-card tool-result-card ${isError ? 'error' : 'success'}`}
                  onClick={() => setExpanded(!expanded)}
                >
                  <div className="trace-event-header">
                    <i className={`bi ${isError ? 'bi-x-circle' : 'bi-check-circle'} me-2`}></i>
                    <span className="trace-event-title">{t('traceViewer.toolResult')}</span>
                    {isError && <span className="trace-event-label error">{t('traceViewer.error')}</span>}
                    <i className={`bi bi-chevron-${expanded ? 'up' : 'down'} ms-auto`}></i>
                  </div>
                  <Collapse in={expanded}>
                    <div className="trace-event-content">
                      <pre>
                        {typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
                      </pre>
                    </div>
                  </Collapse>
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    );
  };

  // Route to appropriate renderer
  if (event.type === 'system') {
    return renderSystemEvent();
  } else if (event.type === 'assistant') {
    return renderAssistantMessage();
  } else if (event.type === 'user') {
    return renderUserMessage();
  }

  return null;
};
