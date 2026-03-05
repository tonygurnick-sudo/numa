import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { streamChat, DocumentProcessingError } from '../../Services/sharedChatService';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import './SharedChatPanel.scss';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | null;
}

interface SharedChatPanelProps {
  uuid: string;
  maxCalls?: number | null; // null/undefined = unlimited
  callCount?: number;
  onCallComplete?: () => void;
}

/**
 * Chat panel for shared document Q&A with streaming responses.
 * Displays messages and handles real-time token streaming from Nova.
 */
export const SharedChatPanel = ({ uuid, maxCalls, callCount = 0, onCallComplete }: SharedChatPanelProps) => {
  const { t } = useTranslation('shared');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDocumentProcessing, setIsDocumentProcessing] = useState(false);
  const textBufferRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isLimitReached = maxCalls != null && callCount >= maxCalls;
  const hasLimit = maxCalls != null;
  const remaining = hasLimit ? maxCalls - callCount : null;

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clean up retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (retryCount = 0, retryMessage?: string) => {
    const message = retryMessage ?? input.trim();
    if (!message || isStreaming || isLimitReached || isDocumentProcessing) return;

    // Only clear input and add message bubbles on first attempt
    if (retryCount === 0) {
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: message }]);
      setMessages((prev) => [...prev, { role: 'assistant', content: '', status: 'streaming' }]);
    }

    setIsStreaming(true);
    textBufferRef.current = '';

    try {
      await streamChat(
        uuid,
        message,
        // onChunk callback - called for each text token
        (chunk: string) => {
          textBufferRef.current += chunk;
          const bufferSnapshot = textBufferRef.current;

          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: bufferSnapshot,
              };
            }
            return updated;
          });
        },
        // onComplete callback
        () => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                status: null,
              };
            }
            return updated;
          });
          onCallComplete?.();
          setIsStreaming(false);
        },
        // onError callback
        (error: string) => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                role: 'assistant',
                content: t('chat.error', { error }),
                status: null,
              };
            }
            return updated;
          });
          setIsStreaming(false);
        }
      );
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        // Document is still being processed - show processing state and retry
        setIsDocumentProcessing(true);
        setIsStreaming(false);

        // Clear any existing retry timeout
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }

        // Retry after 3 seconds, max 5 retries
        if (retryCount < 5) {
          retryTimeoutRef.current = setTimeout(() => {
            setIsDocumentProcessing(false);
            handleSubmit(retryCount + 1, message);
          }, 3000);
        } else {
          // Max retries reached - show error
          setIsDocumentProcessing(false);
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                role: 'assistant',
                content: t('processing.message'),
                status: null,
              };
            }
            return updated;
          });
        }
      } else {
        setIsStreaming(false);
        setIsDocumentProcessing(false);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(0); // Start with retry count 0
    }
  };

  return (
    <div className="shared-chat-panel">
      <div className="chat-header">
        <h4>{t('chat.title')}</h4>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-chat-dots" />
            <p>{t('chat.emptyState')}</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`message message-${msg.role}`}>
              <div className="message-content">
                {msg.role === 'assistant' ? (
                  <>
                    {msg.content && <MarkdownContent content={msg.content} />}
                    {msg.status === 'streaming' && <span className="cursor">{'\u258C'}</span>}
                  </>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {isLimitReached ? (
        <div className="limit-reached-banner">
          <i className="bi bi-x-circle" />
          <div>
            <strong>{t('chat.limitReached')}</strong>
            <p>{t('chat.limitReachedMessage')}</p>
          </div>
        </div>
      ) : isDocumentProcessing ? (
        <div className="processing-banner">
          <div className="d-flex align-items-center">
            <div className="spinner-border spinner-border-sm me-3" role="status" aria-hidden="true" />
            <div>
              <strong>{t('processing.title')}</strong>
              <p className="mb-0">{t('processing.message')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="input-container">
          {hasLimit && remaining != null && (
            <div className="questions-remaining">{t('chat.questionsRemaining', { remaining })}</div>
          )}
          <div className="input-row">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.placeholder')}
              disabled={isStreaming || isDocumentProcessing}
              rows={1}
            />
            <button
              onClick={() => handleSubmit(0)}
              disabled={!input.trim() || isStreaming || isDocumentProcessing}
              className="btn btn-primary send-button"
            >
              {isStreaming || isDocumentProcessing ? (
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              ) : (
                <i className="bi bi-send-fill" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
