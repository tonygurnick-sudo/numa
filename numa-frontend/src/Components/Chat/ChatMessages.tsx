// ChatMessages.tsx
import React, { useState, type CSSProperties, type RefObject } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import { WorkspaceChatMarkdown, type FileReference, type FolderReference } from '../Renderers/WorkspaceChatMarkdown';
import { ChatReferencesDropdown } from './ChatReferencesDropdown';
import { useAuthOptional } from '../../Providers/AuthProvider';
// Tool rendering is handled via unified tool cards; direct TOOL_CONFIG use removed
import { ClipboardList } from 'lucide-react';
import { UnifiedToolCard } from '../UnifiedToolCard';
import { OpsToolRenderer } from '../../toolRenderers/OpsToolRenderer';
import { RenderToolRenderer } from '../../toolRenderers/RenderToolRenderer';
import type { ToolResultLike } from '../../toolRenderers/helpers';
import { WebSearchInlineRenderer } from '../../toolRenderers/WebSearchInlineRenderer';
import { FileMessage } from '../FileMessage';
import AgentAvatar from '../Agents/AgentAvatar';
import type { AgentSummary } from '../../types/agents';
import { formatAgentDisplayName } from '../../utils/agentUtils';
import { useBranding } from '../../Providers/BrandingContext';
import { useBrandingAsset } from '../../hooks/useBrandingAsset';
import { useShowChatCost } from '../../hooks/useShowChatCost';
import { getFlag } from '../../utils/featureFlags';
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
 * Helper to extract file extension from a filename or title.
 */
function getExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
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
  input?: unknown;
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

  // Format Tables cleanly for plaintext/email displays
  const lines = plainText.split('\n');
  let tableRows: string[][] = [];
  let colWidths: number[] = [];
  const processedLines: string[] = [];

  const flushTable = () => {
    if (tableRows.length === 0) return;
    tableRows.forEach((row, rowIndex) => {
      const formattedRow = row
        .map((cell, i) => {
          const padding = Math.max(0, (colWidths[i] || 0) - cell.length);
          return cell + ' '.repeat(padding);
        })
        .join(' | ');
      processedLines.push(`| ${formattedRow} |`);

      // Add a clean divider row after the header
      if (rowIndex === 0) {
        const dividerRow = colWidths.map((w) => '-'.repeat(Math.max(3, w))).join('-|-');
        processedLines.push(`|-${dividerRow}-|`);
      }
    });
    processedLines.push(''); // Spacing after table
    tableRows = [];
    colWidths = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Ignore raw markdown divider rows; we render our own clean dividers
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        continue;
      }

      const cells = trimmed
        .substring(1, trimmed.length - 1)
        .split('|')
        .map((c) => c.trim());

      tableRows.push(cells);
      cells.forEach((c, idx) => {
        colWidths[idx] = Math.max(colWidths[idx] || 0, c.length);
      });
    } else {
      flushTable();
      processedLines.push(line);
    }
  }
  flushTable();

  plainText = processedLines.join('\n');

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
  // Dev-mode cost/usage info (from workspace agent SDK result events).
  // Always populated when available; only rendered when DEVELOPER_MODE
  // client flag is on AND the user has enabled the cost toggle.
  costUsd?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs?: number;
  // Set when this assistant turn ended with one or more `run_in_background`
  // bash shells still alive in the MicroVM. Footer note rendered below.
  pendingBackgroundTasks?: {
    count: number;
    shells: Array<{ shellId: string; command: string }>;
  };
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
  onSendPrompt,
  getCredentials: getCredentialsProp,
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
  onSendPrompt?: (text: string) => void;
  /** Optional credentials override -- when provided, skips useAuth() (e.g. public demo page) */
  getCredentials?: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>;
}) => {
  const { t } = useTranslation('chat');
  const auth = useAuthOptional();
  const getCredentials = getCredentialsProp || auth?.getCredentials;
  const { branding } = useBranding();
  const rawLogoSrc = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || numaIcon;
  const logoSrc = useBrandingAsset(rawLogoSrc, numaIcon);

  // Track which message index has been copied (for showing checkmark feedback)
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);

  // Index of the most recent assistant message — its copy button stays always visible.
  // Older assistant messages reveal the button on hover.
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  // Cost display gate: requires the DEVELOPER_MODE client config flag
  // AND the user-level toggle. Both must be true to render any cost UI.
  const [showChatCost] = useShowChatCost();
  const showCost = getFlag('DEVELOPER_MODE') && showChatCost;

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

          // Other statuses with text (initializing, processingFile, transcribing, etc.)
          let statusText: string | undefined;
          if (message.status === 'initializing') {
            statusText = t('messages.status.initializing');
          } else if (message.status === 'processingFile') {
            statusText = t('messages.status.processingFile');
          } else if (message.status === 'transcribing') {
            statusText = t('messages.status.transcribing');
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

        // System notification messages (agent finishing, stream timeout) get a clean alert-style rendering
        const msgAction = (message as ChatMessage & { action?: { type: string; label: string } }).action;
        if (message.role === 'system' && (message.status === 'agentFinishing' || msgAction)) {
          return (
            <div key={index} className="d-flex justify-content-center my-3">
              <div
                className="d-flex flex-column align-items-center text-center px-4 py-3 rounded-3"
                style={{
                  background: 'var(--color-bg-light, #f8f9fa)',
                  border: '1px solid var(--color-border, #dee2e6)',
                  maxWidth: '480px',
                  width: '100%',
                }}
              >
                {message.status === 'agentFinishing' && (
                  <Spinner
                    animation="border"
                    size="sm"
                    className="mb-2"
                    style={{ color: 'var(--brand-primary, #6f42c1)' }}
                  />
                )}
                <span className="text-muted small">{message.content}</span>
                {msgAction?.type === 'continue' && onSendPrompt && (
                  <button className="btn btn-sm btn-outline-primary mt-2" onClick={() => onSendPrompt('continue')}>
                    <i className="bi bi-arrow-clockwise me-1" />
                    {msgAction.label}
                  </button>
                )}
              </div>
            </div>
          );
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
                            conversationId={conversationId}
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
                    // Ops tool renders inline-style (no card box)
                    if (sc.toolName === 'mcp__numa__numa_ops_tool') {
                      const opsInput = sc.input as { description?: string; operation?: string } | undefined;
                      const displayText =
                        opsInput?.description || opsInput?.operation?.replace(/_/g, ' ') || 'Numa Ops';
                      return (
                        <div key={`ops-${idx}-${!!sc.result}`}>
                          <div className="workspace-chat-inline-tool-group">
                            <div className={`workspace-chat-inline-tool ${sc.isLoading ? '' : 'complete'}`}>
                              <span className={`inline-tool-icon ${sc.isLoading ? 'running' : 'complete'}`}>
                                <ClipboardList size={14} />
                              </span>
                              <div className="inline-tool-content">
                                <span className="inline-tool-text">{displayText}</span>
                                {sc.isLoading && (
                                  <span className="spinner-border spinner-border-sm inline-tool-trailing-spinner" />
                                )}
                              </div>
                            </div>
                          </div>
                          {sc.result && (
                            <OpsToolRenderer
                              result={sc.result as ToolResultLike}
                              conversationId={conversationId}
                              sub={sub}
                            />
                          )}
                        </div>
                      );
                    }
                    // Numa tool renders inline-style (like Ops): description + optional sub-tool renderer
                    if (sc.toolName === 'mcp__numa__numa_tool') {
                      const numaInput = sc.input as { name?: string; description?: string } | undefined;
                      const displayText = numaInput?.description || sc.steps?.[0] || sc.label || 'Numa Tool';
                      const subTool = numaInput?.name;
                      const NUMA_ICONS: Record<string, string> = {
                        knowledge_base: 'bi-folder2-open',
                        web_search: 'bi-search',
                        extract_content: 'bi-file-earmark-text',
                        convert_document: 'bi-file-earmark-arrow-down',
                        agents: 'bi-robot',
                        memories: 'bi-lightbulb',
                        render: 'bi-eye',
                        files: 'bi-folder',
                      };
                      const hasRenderResult = subTool === 'render' && sc.result;
                      const hasWebSearchResult = subTool === 'web_search' && sc.result && !sc.isLoading;
                      return (
                        <div key={`numa-${idx}-${!!sc.result}`}>
                          {/* Hide indicator once render content is ready */}
                          {!hasRenderResult && (
                            <div className="workspace-chat-inline-tool-group">
                              <div className={`workspace-chat-inline-tool ${sc.isLoading ? '' : 'complete'}`}>
                                <span className={`inline-tool-icon ${sc.isLoading ? 'running' : 'complete'}`}>
                                  <i className={`bi ${NUMA_ICONS[subTool || ''] || 'bi-tools'}`} />
                                </span>
                                <div className="inline-tool-content">
                                  <span className="inline-tool-text">{displayText}</span>
                                  {sc.isLoading && (
                                    <span className="spinner-border spinner-border-sm inline-tool-trailing-spinner" />
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          {hasRenderResult && (
                            <RenderToolRenderer
                              result={sc.result as ToolResultLike}
                              conversationId={conversationId}
                              sub={sub}
                              onSendPrompt={onSendPrompt}
                            />
                          )}
                          {hasWebSearchResult && (
                            <WebSearchInlineRenderer
                              result={sc.result as ToolResultLike}
                              onOpenFilePreview={onOpenFilePreview}
                              conversationId={conversationId}
                              userSub={sub}
                            />
                          )}
                        </div>
                      );
                    }
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

                    const handleFileClick = () => {
                      if (hasS3Data && onOpenFilePreview) {
                        const ext = getExtension(fs.filename);
                        onOpenFilePreview({
                          filename: fs.filename,
                          fullPath: fs.s3Key!,
                          relativePath: fs.filename,
                          extension: ext,
                        });
                      }
                    };

                    return (
                      <div key={idx} className="file-upload-message">
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

              {/* Pending-background-tasks footer. Rendered when this assistant
                  turn ended with one or more `run_in_background` shells still
                  alive in the MicroVM. Bubble-style note inviting the user
                  to send a message when they want to check on the tasks. */}
              {message.role === 'assistant' &&
                message.pendingBackgroundTasks &&
                message.pendingBackgroundTasks.count > 0 && (
                  <div
                    className="pending-background-tasks-note d-flex align-items-start gap-2 mt-3 px-3 py-2 rounded"
                    style={{
                      backgroundColor: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.2)',
                      fontSize: '0.875rem',
                    }}
                    role="status"
                    aria-live="polite"
                  >
                    <i
                      className="bi bi-hourglass-split text-primary"
                      style={{ fontSize: '1rem', lineHeight: '1.4', flexShrink: 0 }}
                      aria-hidden="true"
                    />
                    <span className="text-body-secondary fst-italic">
                      {message.pendingBackgroundTasks.count === 1
                        ? t('pendingBackgroundTasks.single')
                        : t('pendingBackgroundTasks.multiple', {
                            count: message.pendingBackgroundTasks.count,
                          })}
                    </span>
                  </div>
                )}

              {/* Dev-only cost footer for this assistant turn */}
              {showCost && message.role === 'assistant' && message.costUsd != null && (
                <div
                  className="message-cost-footer text-muted small mt-1"
                  style={{ fontFamily: 'monospace', opacity: 0.7 }}
                >
                  {t('cost.perMessage', {
                    cost: message.costUsd.toFixed(4),
                    turns: message.numTurns ?? 0,
                    inputTokens: (message.inputTokens ?? 0).toLocaleString(),
                    outputTokens: (message.outputTokens ?? 0).toLocaleString(),
                    durationSec: ((message.durationMs ?? 0) / 1000).toFixed(1),
                  })}{' '}
                  · {t('cost.devOnlyBadge')}
                </div>
              )}

              {/* If there's an inline doc, show it as a file pill (same style as file uploads) */}
              {message.role === 'assistant' && message.docTitle && message.docContent && (
                <div className="file-upload-message">
                  <FileMessage
                    filename={message.docTitle}
                    type="success"
                    onClick={() => onOpenDocument(message.docTitle!, message.docContent!)}
                    clickable
                  />
                </div>
              )}

              {hasCopyableContent && !message.status && (
                <div className={`message-actions${index === lastAssistantIndex ? ' message-actions-latest' : ''}`}>
                  <button
                    className="copy-message-btn"
                    onClick={() => handleCopyMessage(message, index)}
                    title={t('messages.copyMessage')}
                    aria-label={t('messages.copyMessageAria')}
                  >
                    <i className={`bi ${copiedMessageIndex === index ? 'bi-check' : 'bi-clipboard'}`} />
                  </button>
                </div>
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
