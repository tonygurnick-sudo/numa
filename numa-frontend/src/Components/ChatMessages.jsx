// ChatMessages.jsx
import { Spinner, Button } from 'react-bootstrap';
import { MarkdownContent } from './MarkdownContent';
import numaIcon from '../../public/numa-logo.svg';
import { ChatReferencesDropdown } from '../Components/ChatReferencesDropdown';
import { useAuth } from '../Providers/AuthProvider';
import { TOOL_CONFIG } from '../utils/ToolConfig';

/**
 * A small helper bubble for opening doc if docTitle/docContent exist
 */
function DocOpenBubble({ docTitle, docContent, onClick }) {
  if (!docTitle || !docContent) return null;

  // Renders a button in the bottom-right corner of the message
  // On click, calls onClick(docTitle, docContent)
  return (
    <div className="doc-open-bubble">
      <Button className="doc-open-bubble-button" onClick={() => onClick(docTitle, docContent)}>
        <i className="bi bi-file-earmark-text" />
        <span className="open-label">Open: {docTitle}</span>
      </Button>
    </div>
  );
}

const ChatMessages = ({ messages, messageEndRef, loadingIndicatorStyle, onOpenDocument, isConversationLoading }) => {
  const { getCredentials } = useAuth();

  // Check if agent mode is enabled
  const useAgentMode = sessionStorage.getItem('NUMA_CHAT_AGENTS') === 'true';

  // Show conversation loading state
  if (isConversationLoading) {
    return (
      <div
        className="chat-messages d-flex justify-content-center align-items-center h-100"
        style={{ maxWidth: '100%', overflowX: 'hidden', wordWrap: 'break-word' }}
      >
        <div className="text-center">
          <Spinner animation="border" role="status" className="text-primary">
            <span className="visually-hidden">Loading conversation...</span>
          </Spinner>
        </div>
        <div ref={messageEndRef} />
      </div>
    );
  }

  return (
    <div className="chat-messages" style={{ maxWidth: '100%', overflowX: 'hidden', wordWrap: 'break-word' }}>
      {messages.map((message, index) => {
        // ephemeral statuses
        if (message.role === 'assistant' && message.status) {
          let statusText;
          if (message.status === 'initializing') {
            statusText = 'Initializing chat...';
          } else if (message.status === 'processingFile') {
            statusText = 'Processing Upload...';
          } else if (message.status === 'thinking') {
            statusText = 'Thinking...';
          } else if (!useAgentMode && message.status === 'querying') {
            statusText = 'Querying data sources...';
          } else if (!useAgentMode && message.status === 'searching') {
            statusText = 'Searching the web...';
          }
          return (
            <div key={index} className="message assistant ephemeral">
              <strong className="message-role" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <img
                  src={numaIcon}
                  alt="Numa"
                  style={{
                    width: '20px',
                    height: '20px',
                    marginRight: '7px',
                    marginBottom: '2px',
                    verticalAlign: 'middle',
                  }}
                />
                Numa:
              </strong>
              <div className="message-content d-flex align-items-center" style={loadingIndicatorStyle}>
                <Spinner animation="border" size="sm" className="me-2" />
                {statusText}
              </div>
            </div>
          );
        }

        return (
          <div
            key={index}
            className={`message ${message.role} ${message.role === 'assistant' && message.docTitle && message.docContent ? 'message-with-doc' : ''}`}
          >
            <strong className="message-role" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {message.role === 'assistant' ? (
                <>
                  <img
                    src={numaIcon}
                    alt="Numa"
                    style={{
                      width: '20px',
                      height: '20px',
                      marginRight: '7px',
                      marginBottom: '2px',
                      verticalAlign: 'middle',
                    }}
                  />
                  Numa:
                </>
              ) : message.role === 'user' ? (
                'You:'
              ) : (
                'System:'
              )}
            </strong>
            <div className="message-content markdown-content">
              {useAgentMode ? (
                // Agent mode: segment-based rendering
                message.segments ? (
                  message.segments.map((seg, idx) => {
                    if (seg.kind === 'text') {
                      return <MarkdownContent key={idx} content={seg.text} />;
                    } else if (seg.kind === 'tool') {
                      return (
                        <div key={idx} className="tool-event-bubble">
                          <i className="bi bi-tools me-1" />
                          {seg.label}
                          {seg.isLoading && (
                            <Spinner
                              animation="border"
                              size="sm"
                              className="ms-2 tool-loading-spinner"
                              style={{ width: '16px', height: '16px' }}
                            />
                          )}
                        </div>
                      );
                    } else if (seg.kind === 'result') {
                      const toolName = seg.toolName || 'unknown';
                      const descriptor = TOOL_CONFIG[toolName] || TOOL_CONFIG._default;
                      const Renderer = descriptor.renderer;
                      return <Renderer key={idx} result={seg.payload} />;
                    }
                    return null;
                  })
                ) : (
                  // Fallback for legacy messages without segments in agent mode
                  <>
                    {message.content && <MarkdownContent content={message.content} />}
                    {message.toolEvents?.length > 0 && (
                      <div className="tool-events-container">
                        {message.toolEvents.map((evt, idx) => (
                          <div key={idx} className="tool-event-bubble">
                            {evt}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              ) : (
                // Legacy mode: simple message content rendering
                <MarkdownContent content={message.content} />
              )}

              {/* If there are references, show the dropdown */}
              {message.role === 'assistant' && message.references?.length > 0 && (
                <ChatReferencesDropdown references={message.references} getCredentials={getCredentials} />
              )}

              {/* If there's a doc, show the bubble */}
              {message.role === 'assistant' && message.docTitle && message.docContent && (
                <DocOpenBubble docTitle={message.docTitle} docContent={message.docContent} onClick={onOpenDocument} />
              )}
            </div>
          </div>
        );
      })}
      <div ref={messageEndRef} />
    </div>
  );
};

export { ChatMessages };
