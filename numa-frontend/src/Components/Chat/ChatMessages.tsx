// ChatMessages.tsx
import type { CSSProperties, RefObject } from 'react';
import { Spinner, Button } from 'react-bootstrap';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import { ChatReferencesDropdown } from './ChatReferencesDropdown';
import { useAuth } from '../../Providers/AuthProvider';
// Tool rendering is handled via unified tool cards; direct TOOL_CONFIG use removed
import { UnifiedToolCard } from '../UnifiedToolCard';
import { FileMessage } from '../FileMessage';
import AgentAvatar from '../Agents/AgentAvatar';
import type { AgentSummary } from '../../types/agents';
import { formatAgentDisplayName } from '../../utils/agentUtils';
import { downloadFileFromS3 } from '../../utils/s3Utils';
import { useBranding } from '../../Providers/BrandingContext';

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

type TextSegment = { kind: 'text'; text: string; finalized?: boolean };
type ToolSegment = { kind: 'tool'; label: string; isLoading?: boolean };
type ResultSegment = { kind: 'result'; toolName?: string; payload: unknown };
type ToolCardSegment = {
  kind: 'tool_card';
  toolName: string;
  label: string;
  toolUseId: string | null;
  isLoading?: boolean;
  steps: string[];
  result?: unknown;
};
type FileUploadSegment = {
  kind: 'file_upload';
  filename: string;
  type?: 'success' | 'processing';
  s3Key?: string;
  s3Bucket?: string;
  region?: string;
};
type MessageSegment = TextSegment | ToolSegment | ResultSegment | ToolCardSegment | FileUploadSegment;

type ChatMessage = {
  role: 'assistant' | 'user' | 'system';
  status?: 'initializing' | 'processingFile' | 'thinking' | string | null;
  content?: string;
  segments?: MessageSegment[];
  docTitle?: string;
  docContent?: string;
  toolEvents?: Array<string>;
  references?: Array<string>;
};

const ChatMessages = ({
  messages,
  messageEndRef,
  loadingIndicatorStyle,
  onOpenDocument,
  isConversationLoading,
  currentAgent,
  conversationId,
  sub,
  numaChatDynamoUtils,
  setMessages,
}: {
  messages: ChatMessage[];
  messageEndRef: RefObject<HTMLDivElement>;
  loadingIndicatorStyle: CSSProperties;
  onOpenDocument: (title: string, content: string) => void;
  isConversationLoading: boolean;
  currentAgent?: AgentSummary | null;
  conversationId?: string;
  sub?: string;
  numaChatDynamoUtils?: {
    addFileMessage: (args: {
      conversationId: string;
      userId: string;
      fileName: string;
      fileType: string;
      s3Key: string;
      s3Bucket: string;
      extractedContentS3Key?: string;
    }) => Promise<unknown>;
  };
  setMessages?: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
}) => {
  const { getCredentials } = useAuth();
  const { branding } = useBranding();

  // Agent mode is the default and only mode; remove legacy flag checks

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
          }
          if (!statusText) return null; // Skip legacy statuses in agent-only mode
          return (
            <div key={index} className="message assistant ephemeral">
              <strong className="message-role" style={{ display: 'inline-flex', alignItems: 'center' }}>
                {currentAgent ? (
                  <>
                    <AgentAvatar agent={currentAgent} size={20} className="me-2" />
                    {formatAgentDisplayName(currentAgent.title)}:
                  </>
                ) : (
                  <>
                    {branding.resolvedAssets?.logoNav ? (
                      <img
                        src={branding.resolvedAssets.logoNav}
                        alt={`${branding.name ?? 'Assistant'} logo`}
                        style={{
                          width: '20px',
                          height: '20px',
                          marginRight: '7px',
                          marginBottom: '2px',
                          verticalAlign: 'middle',
                        }}
                      />
                    ) : null}
                    {branding.name ?? 'Numa'}:
                  </>
                )}
              </strong>
              <div className="message-content d-flex align-items-center" style={loadingIndicatorStyle}>
                <Spinner animation="border" size="sm" className="me-2" />
                {statusText}
              </div>
            </div>
          );
        }

        // Check if this is the first assistant message (agent welcome)
        const isInitialAgentMessage = message.role === 'assistant' && index === 0 && currentAgent;

        return (
          <div
            key={index}
            className={`message ${message.role} ${message.role === 'assistant' && message.docTitle && message.docContent ? 'message-with-doc' : ''} ${isInitialAgentMessage ? 'agent-welcome-message' : ''}`}
          >
            <strong className="message-role" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {message.role === 'assistant' ? (
                currentAgent ? (
                  <>
                    <AgentAvatar agent={currentAgent} size={20} className="me-2" />
                    {formatAgentDisplayName(currentAgent.title)}:
                  </>
                ) : (
                  <>
                    {branding.resolvedAssets?.logoNav ? (
                      <img
                        src={branding.resolvedAssets.logoNav}
                        alt={`${branding.name ?? 'Assistant'} logo`}
                        style={{
                          width: '20px',
                          height: '20px',
                          marginRight: '7px',
                          marginBottom: '2px',
                          verticalAlign: 'middle',
                        }}
                      />
                    ) : null}
                    {branding.name ?? 'Numa'}:
                  </>
                )
              ) : message.role === 'user' ? (
                'You:'
              ) : (
                'System:'
              )}
            </strong>
            <div className="message-content markdown-content">
              {message.segments ? (
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
                  } else if (seg.kind === 'tool_card') {
                    const sc = seg as ToolCardSegment;
                    return (
                      <UnifiedToolCard
                        key={idx}
                        toolName={sc.toolName}
                        label={sc.label}
                        steps={sc.steps}
                        result={sc.result}
                        isLoading={!!sc.isLoading}
                        conversationId={conversationId}
                        sub={sub}
                        numaChatDynamoUtils={numaChatDynamoUtils}
                        setMessages={setMessages}
                      />
                    );
                  } else if (seg.kind === 'file_upload') {
                    const fs = seg as FileUploadSegment;
                    const hasS3Data = fs.s3Key && fs.s3Bucket && fs.region;

                    const handleFileClick = async () => {
                      if (hasS3Data) {
                        try {
                          await downloadFileFromS3(fs.s3Key!, fs.s3Bucket!, fs.region!, getCredentials, fs.filename);
                        } catch (error) {
                          console.error('Error downloading file:', error);
                        }
                      }
                    };

                    return (
                      <div key={idx} className="file-upload-message">
                        <div className="file-upload-text">File &apos;{fs.filename}&apos; uploaded successfully.</div>
                        <FileMessage
                          filename={fs.filename}
                          type={fs.type || 'success'}
                          onClick={hasS3Data ? handleFileClick : undefined}
                          clickable={hasS3Data}
                        />
                      </div>
                    );
                  }
                  return null;
                })
              ) : (
                // Fallback for messages without segments in agent mode
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
