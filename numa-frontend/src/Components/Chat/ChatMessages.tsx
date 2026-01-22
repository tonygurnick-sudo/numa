// ChatMessages.tsx
import React, { useState, type CSSProperties, type RefObject } from 'react';
import { Spinner, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import { WorkspaceChatMarkdown, type FileReference, type FolderReference } from '../Renderers/WorkspaceChatMarkdown';
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
import { useBrandingAsset } from '../../hooks/useBrandingAsset';
import numaIcon from '/numa-logo.svg?url';
import { ThinkingBlock } from './ThinkingBlock';
import { AssistantAdviceBlock } from './AssistantAdviceBlock';
import { UserFileAttachments } from './UserFileAttachments';
import { WorkspaceChatInlineTool } from '../WorkspaceChat/WorkspaceChatInlineTool';
import { WorkspaceChatSubagentCard } from '../WorkspaceChat/WorkspaceChatSubagentCard';
import { WorkspaceChatTodoCard } from '../WorkspaceChat/WorkspaceChatTodoCard';
import { WorkspaceChatInlineThinking } from '../WorkspaceChat/WorkspaceChatInlineThinking';
import { WorkspaceChatCompactionBlock } from '../WorkspaceChat/WorkspaceChatCompactionBlock';
import type {
  WorkspaceChatThinkingSegment,
  WorkspaceChatAssistantAdviceSegment,
  WorkspaceChatFileAttachmentSegment,
  WorkspaceChatInlineToolSegment,
  WorkspaceChatSubagentSegment,
  WorkspaceChatTodoSegment,
  WorkspaceChatCompactionSegment,
} from '../../types/workspaceChatTypes';

/**
 * Parse file attachment tags from message content (workspace mode only).
 * Format: <file:path:filename:size>
 * Returns clean content (without tags) and parsed file attachments.
 */
function parseFileAttachmentTags(content: string): {
  cleanContent: string;
  files: WorkspaceChatFileAttachmentSegment[];
} {
  const fileTagRegex = /<file:([^:>]+):([^:>]+):(\d+)>/g;
  const files: WorkspaceChatFileAttachmentSegment[] = [];
  let match;

  while ((match = fileTagRegex.exec(content)) !== null) {
    files.push({
      kind: 'file_attachment',
      path: match[1],
      filename: match[2],
      size: parseInt(match[3], 10),
    });
  }

  // Remove file tags from content and trim trailing whitespace
  const cleanContent = content.replace(fileTagRegex, '').replace(/\n+$/, '').trim();

  return { cleanContent, files };
}

/**
 * A small helper bubble for opening doc if docTitle/docContent exist
 */
function DocOpenBubble({
  docTitle,
  docContent,
  onClick,
  openLabel,
}: {
  docTitle?: string;
  docContent?: string;
  onClick: (title: string, content: string) => void;
  openLabel: string;
}) {
  if (!docTitle || !docContent) return null;

  // Renders a button in the bottom-right corner of the message
  // On click, calls onClick(docTitle, docContent)
  return (
    <div className="doc-open-bubble">
      <Button className="doc-open-bubble-button" onClick={() => onClick(docTitle, docContent)}>
        <i className="bi bi-file-earmark-text" />
        <span className="open-label">{openLabel}</span>
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
type ThinkingSegment = { kind: 'thinking'; text: string; collapsed?: boolean };
type InlineThinkingSegment = { kind: 'inline_thinking'; isStreaming: boolean };
type AssistantAdviceSegment = { kind: 'assistant_advice'; text: string; collapsed?: boolean };
type FileAttachmentSegment = { kind: 'file_attachment'; filename: string; path: string; size: number };
type InlineToolSegment = {
  kind: 'inline_tool';
  toolUseId: string;
  toolName: string;
  displayText: string;
  filePath?: string;
  isComplete?: boolean;
  isError?: boolean;
};
type SubagentSegment = {
  kind: 'subagent';
  parentToolUseId: string;
  taskDescription: string;
  subagentType: string;
  events: unknown[];
  collapsed: boolean;
  isComplete: boolean;
};
type TodoSegment = {
  kind: 'todo';
  toolUseId: string;
  items: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
  isComplete: boolean;
};
type CompactionSegment = {
  kind: 'compaction';
  status: 'summarizing' | 'complete';
  summary?: string;
  preTokens?: number;
  trigger?: 'auto' | 'manual';
};
type MessageSegment =
  | TextSegment
  | ToolSegment
  | ResultSegment
  | ToolCardSegment
  | FileUploadSegment
  | ThinkingSegment
  | InlineThinkingSegment
  | AssistantAdviceSegment
  | FileAttachmentSegment
  | InlineToolSegment
  | SubagentSegment
  | TodoSegment
  | CompactionSegment;

/** Render group - either a single segment or a group of consecutive inline_tools */
type RenderGroup =
  | { type: 'single'; segment: MessageSegment; originalIndex: number }
  | { type: 'inline_tool_group'; segments: InlineToolSegment[]; startIndex: number };

/**
 * Group consecutive inline_tool segments together for proper connected rendering.
 * Other segments remain as individual items.
 */
function groupSegmentsForRendering(segments: MessageSegment[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let currentInlineToolGroup: InlineToolSegment[] = [];
  let groupStartIndex = 0;

  segments.forEach((seg, idx) => {
    if (seg.kind === 'inline_tool') {
      if (currentInlineToolGroup.length === 0) {
        groupStartIndex = idx;
      }
      currentInlineToolGroup.push(seg as InlineToolSegment);
    } else {
      // Flush any pending inline_tool group
      if (currentInlineToolGroup.length > 0) {
        groups.push({ type: 'inline_tool_group', segments: currentInlineToolGroup, startIndex: groupStartIndex });
        currentInlineToolGroup = [];
      }
      groups.push({ type: 'single', segment: seg, originalIndex: idx });
    }
  });

  // Flush any remaining inline_tool group
  if (currentInlineToolGroup.length > 0) {
    groups.push({ type: 'inline_tool_group', segments: currentInlineToolGroup, startIndex: groupStartIndex });
  }

  return groups;
}

/**
 * Convert markdown to plain text for clipboard copying.
 * Replicates the pattern from ResultActions.tsx.
 */
function convertMarkdownToPlainText(markdown: string): string {
  let plainText = markdown.replace(/<br\s*\/?>/gi, '\n');
  plainText = plainText.replace(/<[^>]+>/g, '');
  plainText = plainText.replace(/^\s*[-*+]\s+(.+)$/gm, '• $1');
  plainText = plainText.replace(/^\s*(\d+)\.?\s+(.+)$/gm, '$1. $2');
  plainText = plainText.replace(/^((?:•|\d+\.)[^\n]+)$(?!\n^(?:•|\d+\.))/gm, '$1\n');
  plainText = plainText.replace(/^(\s*•\s+.*)$/gm, '    $1');
  plainText = plainText.replace(/^#{1,6}\s+(.+)$/gm, '$1\n');
  plainText = plainText.replace(/\*\*(.+?)\*\*/g, '$1');
  plainText = plainText.replace(/\*(.+?)\*/g, '$1');
  plainText = plainText.replace(/__(.+?)__/g, '$1');
  plainText = plainText.replace(/_(.+?)_/g, '$1');
  plainText = plainText.replace(/~~(.+?)~~/g, '$1');
  plainText = plainText.replace(/`(.+?)`/g, '$1');
  plainText = plainText.replace(/```(?:\w+)?\n([\s\S]*?)\n```/g, '\n$1\n');
  plainText = plainText.replace(/\n{3,}/g, '\n\n');
  return plainText.trim();
}

/**
 * Extract all text content from message segments (only TextSegment types).
 */
function extractTextFromSegments(segments: MessageSegment[]): string {
  return segments
    .filter((seg): seg is TextSegment => seg.kind === 'text')
    .map((seg) => seg.text)
    .join('\n');
}

type ChatMessage = {
  role: 'assistant' | 'user' | 'system';
  status?: 'processing' | 'thinking' | 'streaming' | 'initializing' | 'processingFile' | string | null;
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
  isWorkspaceMode,
  outputsBucket,
  region,
  onOpenFilePreview,
  onOpenFolderPreview,
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
  isWorkspaceMode?: boolean;
  outputsBucket?: string;
  region?: string;
  onOpenFilePreview?: (ref: FileReference) => void;
  onOpenFolderPreview?: (ref: FolderReference) => void;
}) => {
  const { t } = useTranslation('chat');
  const { getCredentials } = useAuth();
  const { branding } = useBranding();
  const rawLogoSrc = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || numaIcon;
  const logoSrc = useBrandingAsset(rawLogoSrc, numaIcon);

  // Track which message index has been copied (for showing checkmark feedback)
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);

  // Copy message content to clipboard
  const handleCopyMessage = async (message: ChatMessage, messageIndex: number) => {
    try {
      let textContent = '';
      if (message.segments && message.segments.length > 0) {
        textContent = extractTextFromSegments(message.segments);
      } else if (message.content) {
        textContent = message.content;
      }

      if (!textContent) return;

      const plainText = convertMarkdownToPlainText(textContent);
      await navigator.clipboard.writeText(plainText);

      // Show checkmark feedback for 2 seconds
      setCopiedMessageIndex(messageIndex);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

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
            <span className="visually-hidden">{t('messages.loadingConversation')}</span>
          </Spinner>
        </div>
        <div ref={messageEndRef} />
      </div>
    );
  }

  return (
    <div className="chat-messages" style={{ maxWidth: '100%', overflowX: 'hidden', wordWrap: 'break-word' }}>
      {messages.map((message, index) => {
        // ephemeral statuses - show loading indicator for specific statuses
        // Skip this block for 'streaming' status - render message normally
        if (message.role === 'assistant' && message.status && message.status !== 'streaming') {
          // 'processing' status - spinner with Numa header (no text)
          // This shows while waiting for any response from backend
          if (message.status === 'processing') {
            return (
              <div key={index} className="message assistant ephemeral processing">
                <strong className="message-role" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {currentAgent ? (
                    <>
                      <AgentAvatar agent={currentAgent} size={20} className="me-2" />
                      {formatAgentDisplayName(currentAgent.title)}:
                    </>
                  ) : (
                    <>
                      <img
                        src={logoSrc}
                        alt={`${branding.name ?? t('messages.roles.assistant')} logo`}
                        style={{
                          maxHeight: '20px',
                          maxWidth: '60px',
                          objectFit: 'contain',
                          marginRight: '7px',
                          marginBottom: '2px',
                          verticalAlign: 'middle',
                        }}
                      />
                      {branding.name || t('messages.roles.assistant')}:
                    </>
                  )}
                </strong>
                <div className="message-content processing-spinner">
                  <Spinner animation="border" size="sm" />
                </div>
              </div>
            );
          }

          // 'thinking' status handling
          if (message.status === 'thinking') {
            // Workspace mode: handled inline via inline_thinking segment
            if (isWorkspaceMode) {
              if (message.segments && message.segments.length > 0) {
                // Fall through to normal message rendering below
              } else {
                // No segments yet - the inline_thinking component will be added by streaming
                return null;
              }
            } else {
              // V1 chat: show traditional "Thinking..." with spinner
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
                        <img
                          src={logoSrc}
                          alt={`${branding.name ?? t('messages.roles.assistant')} logo`}
                          style={{
                            maxHeight: '20px',
                            maxWidth: '60px',
                            objectFit: 'contain',
                            marginRight: '7px',
                            marginBottom: '2px',
                            verticalAlign: 'middle',
                          }}
                        />
                        {branding.name || t('messages.roles.assistant')}:
                      </>
                    )}
                  </strong>
                  <div className="message-content d-flex align-items-center">
                    <Spinner animation="border" size="sm" className="me-2" />
                    {t('messages.status.thinking')}
                  </div>
                </div>
              );
            }
          }

          // Other statuses with text (initializing, processingFile, etc.)
          let statusText: string | undefined;
          if (message.status === 'initializing') {
            statusText = t('messages.status.initializing');
          } else if (message.status === 'processingFile') {
            statusText = t('messages.status.processingFile');
          }
          // Skip legacy statuses we don't handle
          if (statusText) {
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
                      <img
                        src={logoSrc}
                        alt={`${branding.name ?? t('messages.roles.assistant')} logo`}
                        style={{
                          maxHeight: '20px',
                          maxWidth: '60px',
                          objectFit: 'contain',
                          marginRight: '7px',
                          marginBottom: '2px',
                          verticalAlign: 'middle',
                        }}
                      />
                      {branding.name || t('messages.roles.assistant')}:
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
        }

        // Check if this is the first assistant message (agent welcome)
        const isInitialAgentMessage = message.role === 'assistant' && index === 0 && currentAgent;

        // Check if message has copyable content
        const hasCopyableContent =
          message.role === 'assistant' &&
          ((message.segments && message.segments.some((seg) => seg.kind === 'text')) || message.content);

        return (
          <div
            key={index}
            className={`message ${message.role} ${message.role === 'assistant' && message.docTitle && message.docContent ? 'message-with-doc' : ''} ${isInitialAgentMessage ? 'agent-welcome-message' : ''}`}
          >
            <div className="message-header">
              <strong className="message-role" style={{ display: 'inline-flex', alignItems: 'center' }}>
                {message.role === 'assistant' ? (
                  currentAgent ? (
                    <>
                      <AgentAvatar agent={currentAgent} size={20} className="me-2" />
                      {formatAgentDisplayName(currentAgent.title)}:
                    </>
                  ) : (
                    <>
                      <img
                        src={logoSrc}
                        alt={`${branding.name ?? t('messages.roles.assistant')} logo`}
                        style={{
                          maxHeight: '20px',
                          maxWidth: '60px',
                          objectFit: 'contain',
                          marginRight: '7px',
                          marginBottom: '2px',
                          verticalAlign: 'middle',
                        }}
                      />
                      {branding.name || t('messages.roles.assistant')}:
                    </>
                  )
                ) : message.role === 'user' ? (
                  `${t('messages.roles.you')}:`
                ) : (
                  `${t('messages.roles.system')}:`
                )}
              </strong>
              {hasCopyableContent && (
                <button
                  className="copy-message-btn"
                  onClick={() => handleCopyMessage(message, index)}
                  title={t('messages.copyMessage')}
                  aria-label={t('messages.copyMessageAria')}
                >
                  <i className={`bi ${copiedMessageIndex === index ? 'bi-check' : 'bi-clipboard'}`} />
                </button>
              )}
            </div>
            <div className="message-content markdown-content">
              {message.segments && message.segments.length > 0 ? (
                groupSegmentsForRendering(message.segments).map((group, _groupIdx) => {
                  // Handle grouped inline_tools with proper container
                  if (group.type === 'inline_tool_group') {
                    return (
                      <div key={`inline-group-${group.startIndex}`} className="workspace-inline-tool-group">
                        {group.segments.map((its, toolIdx) => (
                          <WorkspaceChatInlineTool
                            key={its.toolUseId || `tool-${group.startIndex + toolIdx}`}
                            segment={its as WorkspaceChatInlineToolSegment}
                            isLast={toolIdx === group.segments.length - 1}
                          />
                        ))}
                      </div>
                    );
                  }

                  // Handle individual segments
                  const seg = group.segment;
                  const idx = group.originalIndex;

                  if (seg.kind === 'text') {
                    // Use WorkspaceChatMarkdown for workspace mode to handle file references
                    if (isWorkspaceMode && outputsBucket && region && conversationId && sub) {
                      return (
                        <WorkspaceChatMarkdown
                          key={idx}
                          content={seg.text}
                          conversationId={conversationId}
                          userSub={sub}
                          bucket={outputsBucket}
                          region={region}
                          onOpenFilePreview={onOpenFilePreview}
                          onOpenFolderPreview={onOpenFolderPreview}
                          getCredentials={getCredentials}
                        />
                      );
                    }
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
                        <div className="file-upload-text">{t('messages.fileUploaded', { name: fs.filename })}</div>
                        <FileMessage
                          filename={fs.filename}
                          type={fs.type || 'success'}
                          onClick={hasS3Data ? handleFileClick : undefined}
                          clickable={!!hasS3Data}
                        />
                      </div>
                    );
                  } else if (seg.kind === 'thinking') {
                    // Thinking blocks are only shown in workspace mode
                    const ts = seg as ThinkingSegment;
                    return (
                      <ThinkingBlock
                        key={idx}
                        segment={
                          { kind: 'thinking', text: ts.text, collapsed: ts.collapsed } as WorkspaceChatThinkingSegment
                        }
                      />
                    );
                  } else if (seg.kind === 'inline_thinking') {
                    // Inline thinking spinner - shows while thinking before text arrives
                    const its = seg as InlineThinkingSegment;
                    return <WorkspaceChatInlineThinking key={`inline-thinking-${idx}`} isStreaming={its.isStreaming} />;
                  } else if (seg.kind === 'assistant_advice') {
                    // Assistant advice blocks show pre-analysis hints
                    const as = seg as AssistantAdviceSegment;
                    return (
                      <AssistantAdviceBlock
                        key={idx}
                        segment={
                          {
                            kind: 'assistant_advice',
                            text: as.text,
                            collapsed: as.collapsed,
                          } as WorkspaceChatAssistantAdviceSegment
                        }
                      />
                    );
                  } else if (seg.kind === 'subagent') {
                    // Task tool calls render as collapsible cards with activity
                    return (
                      <WorkspaceChatSubagentCard
                        key={`subagent-${(seg as SubagentSegment).parentToolUseId}`}
                        segment={seg as WorkspaceChatSubagentSegment}
                      />
                    );
                  } else if (seg.kind === 'todo') {
                    // TodoWrite renders as a checklist card
                    return (
                      <WorkspaceChatTodoCard
                        key={`todo-${(seg as TodoSegment).toolUseId}`}
                        segment={seg as WorkspaceChatTodoSegment}
                      />
                    );
                  } else if (seg.kind === 'compaction') {
                    // Compaction/summarization shows progress and summary
                    return (
                      <WorkspaceChatCompactionBlock
                        key={`compaction-${idx}`}
                        segment={seg as WorkspaceChatCompactionSegment}
                      />
                    );
                  } else if (seg.kind === 'file_attachment') {
                    // File attachments are handled separately below for user messages
                    return null;
                  }
                  return null;
                })
              ) : (
                // Fallback for messages without segments in agent mode
                <>
                  {message.content &&
                    (() => {
                      // For user messages in workspace mode, parse embedded file tags
                      if (message.role === 'user' && isWorkspaceMode) {
                        const { cleanContent, files } = parseFileAttachmentTags(message.content);
                        return (
                          <>
                            {cleanContent && <MarkdownContent content={cleanContent} />}
                            {files.length > 0 && <UserFileAttachments files={files} />}
                          </>
                        );
                      }
                      // For assistant messages in workspace mode, use WorkspaceMarkdown
                      if (isWorkspaceMode && outputsBucket && region && conversationId && sub) {
                        return (
                          <WorkspaceChatMarkdown
                            content={message.content}
                            conversationId={conversationId}
                            userSub={sub}
                            bucket={outputsBucket}
                            region={region}
                            onOpenFilePreview={onOpenFilePreview}
                            onOpenFolderPreview={onOpenFolderPreview}
                            getCredentials={getCredentials}
                          />
                        );
                      }
                      // Default: regular markdown
                      return <MarkdownContent content={message.content} />;
                    })()}
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
                <DocOpenBubble
                  docTitle={message.docTitle}
                  docContent={message.docContent}
                  onClick={onOpenDocument}
                  openLabel={t('messages.openDocument', { title: message.docTitle })}
                />
              )}
            </div>
          </div>
        );
      })}
      <div ref={messageEndRef} />
    </div>
  );
};

// Memoize to prevent re-renders when unrelated parent state (like inputMessage) changes
const MemoizedChatMessages = React.memo(ChatMessages);

export { MemoizedChatMessages as ChatMessages };
