import { useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { streamChat } from '../../Services/sharedChatService';

interface DropZoneInstructionsProps {
  uuid: string;
  instructions: string;
  enableChat: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const DropZoneInstructions: React.FC<DropZoneInstructionsProps> = ({ uuid, instructions, enableChat }) => {
  const { t } = useTranslation('files');
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const handleSendMessage = async () => {
    if (!input.trim() || streaming) return;

    const query = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setStreaming(true);

    // Add placeholder for assistant response
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await streamChat(
        uuid,
        query,
        (chunk) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + chunk };
            }
            return updated;
          });
        },
        () => setStreaming(false),
        (error) => {
          console.error('Chat error:', error);
          setStreaming(false);
        }
      );
    } catch {
      setStreaming(false);
    }
  };

  return (
    <div>
      {instructions && (
        <div className="mb-3">
          <h6>{t('dropzones.instructions')}</h6>
          <div className="p-3 border rounded bg-white">
            <ReactMarkdown>{instructions}</ReactMarkdown>
          </div>
        </div>
      )}

      {enableChat && (
        <div>
          {!showChat ? (
            <Button variant="outline-primary" size="sm" onClick={() => setShowChat(true)}>
              <i className="bi bi-chat-dots me-1" />
              {t('dropzones.askAboutInstructions')}
            </Button>
          ) : (
            <div className="border rounded">
              <div className="p-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {messages.length === 0 && (
                  <div className="text-center text-muted small py-3">{t('dropzones.askAboutInstructions')}</div>
                )}
                {messages.map((msg, idx) => (
                  <div key={idx} className={`mb-2 ${msg.role === 'user' ? 'text-end' : ''}`}>
                    <div
                      className={`d-inline-block p-2 rounded ${
                        msg.role === 'user' ? 'bg-primary text-white' : 'bg-light'
                      }`}
                      style={{ maxWidth: '85%', textAlign: 'left' }}
                    >
                      {msg.role === 'assistant' ? (
                        <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-2 border-top d-flex gap-2">
                <Form.Control
                  size="sm"
                  placeholder={t('dropzones.askAboutInstructions')}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  disabled={streaming}
                />
                <Button size="sm" variant="primary" onClick={handleSendMessage} disabled={streaming || !input.trim()}>
                  <i className="bi bi-send" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
