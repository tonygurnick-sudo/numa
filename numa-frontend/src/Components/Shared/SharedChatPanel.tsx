import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { streamChat } from '../../Services/sharedChatService';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import './SharedChatPanel.scss';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | null;
}

interface SharedChatPanelProps {
  uuid: string;
}

/**
 * Chat panel for shared document Q&A with streaming responses.
 * Displays messages and handles real-time token streaming from Nova.
 */
export const SharedChatPanel = ({ uuid }: SharedChatPanelProps) => {
  const { t } = useTranslation('shared');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const textBufferRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    setIsStreaming(true);
    textBufferRef.current = '';

    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    // Add assistant placeholder
    setMessages((prev) => [...prev, { role: 'assistant', content: '', status: 'streaming' }]);

    try {
      await streamChat(
        uuid,
        userMessage,
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
        },
      );
    } catch {
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

      <div className="input-container">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          disabled={isStreaming}
          rows={1}
        />
        <button onClick={handleSubmit} disabled={!input.trim() || isStreaming} className="btn btn-primary send-button">
          {isStreaming ? (
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
          ) : (
            <i className="bi bi-send-fill" />
          )}
        </button>
      </div>
    </div>
  );
};
