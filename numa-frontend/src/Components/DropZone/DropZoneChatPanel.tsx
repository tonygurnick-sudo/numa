import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { streamChat, DocumentProcessingError } from '../../Services/sharedChatService';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import './DropZoneChatPanel.scss';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | null;
}

interface DropZoneChatPanelProps {
  uuid: string;
  maxCalls?: number | null;
  callCount?: number;
  onCallComplete?: () => void;
}

export const DropZoneChatPanel: React.FC<DropZoneChatPanelProps> = ({
  uuid,
  maxCalls,
  callCount = 0,
  onCallComplete,
}) => {
  const { t } = useTranslation('files');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const textBufferRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLimitReached = maxCalls != null && callCount >= maxCalls;
  const hasLimit = maxCalls != null;
  const remaining = hasLimit ? maxCalls - callCount : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (retryCount = 0, retryMessage?: string) => {
    const message = retryMessage ?? input.trim();
    if (!message || isStreaming || isLimitReached) return;

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
        (chunk: string) => {
          textBufferRef.current += chunk;
          const bufferSnapshot = textBufferRef.current;
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: bufferSnapshot };
            }
            return updated;
          });
        },
        () => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], status: null };
            }
            return updated;
          });
          setIsStreaming(false);
          onCallComplete?.();
        },
        (error: string) => {
          // Retry on DocumentProcessingError (same as SharedChatPanel)
          if (error.includes('still being processed') || error.includes('202')) {
            if (retryCount < 3) {
              retryTimeoutRef.current = setTimeout(() => {
                handleSubmit(retryCount + 1, message);
              }, 5000);
              return;
            }
          }

          console.error('Chat error:', error);
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { role: 'assistant', content: error, status: null };
            }
            return updated;
          });
          setIsStreaming(false);
        }
      );
    } catch (err) {
      if (err instanceof DocumentProcessingError && retryCount < 3) {
        retryTimeoutRef.current = setTimeout(() => {
          handleSubmit(retryCount + 1, message);
        }, 5000);
        return;
      }
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="dropzone-chat-panel">
      <div className="chat-header">
        <i className="bi bi-chat-dots me-2" />
        <h6 className="mb-0">{t('dropzones.askAboutInstructions')}</h6>
      </div>

      {isLimitReached && (
        <div className="limit-reached-banner">
          <i className="bi bi-x-circle me-2" />
          <div>
            <div className="fw-semibold">{t('dropzones.questionsLimitReached')}</div>
            <small className="text-muted">{t('dropzones.questionsLimitReachedMessage')}</small>
          </div>
        </div>
      )}

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-chat-dots" />
            <p>{t('dropzones.askAboutInstructions')}</p>
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

      <div className="input-container">
        {remaining !== null && !isLimitReached && (
          <div className="questions-remaining">{t('dropzones.questionsRemaining', { remaining })}</div>
        )}
        <div className="input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('dropzones.askAboutInstructions')}
            disabled={isStreaming || isLimitReached}
            rows={1}
          />
          <button
            onClick={() => handleSubmit()}
            disabled={!input.trim() || isStreaming || isLimitReached}
            className="btn btn-primary send-button"
          >
            {isStreaming ? (
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            ) : (
              <i className="bi bi-send-fill" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
