// ChatMessages.jsx
import { Spinner, Button } from 'react-bootstrap';
import { MarkdownContent } from './MarkdownContent';
import numaIcon from '../assets/images/numa-logo.svg';
import { ChatReferencesDropdown } from '../Components/ChatReferencesDropdown';
import { useAuth } from '../Providers/AuthProvider';

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

const ChatMessages = ({ messages, messageEndRef, loadingIndicatorStyle, onOpenDocument }) => {
  const { getIdentityPoolCredentials } = useAuth();
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
          } else if (message.status === 'querying') {
            statusText = 'Querying data sources...';
          } else if (message.status === 'thinking') {
            statusText = 'Thinking...';
          } else if (message.status === 'searching') {
            statusText = 'Searching the web...';
          }
          return (
            <div key={index} className="message assistant ephemeral">
              <strong className="message-role" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <img src={numaIcon} alt="Numa" style={{ width: '20px', height: '20px', marginRight: '7px' }} />
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
              {/* Render the message content */}
              <MarkdownContent content={message.content} />

              {/* If there are references, show the dropdown */}
              {message.role === 'assistant' && message.references?.length > 0 && (
                <ChatReferencesDropdown
                  references={message.references}
                  getIdentityPoolCredentials={getIdentityPoolCredentials}
                />
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
