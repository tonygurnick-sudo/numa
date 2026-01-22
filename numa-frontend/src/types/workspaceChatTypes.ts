/**
 * Workspace Chat Agent Types
 *
 * Types for the Numa Workspace Chat Agent which uses Claude CLI trace format.
 * Different from chat.ts which handles Strands/Bedrock events.
 */

// ============================================================
// Model Selection Types
// ============================================================

/** Available workspace chat model IDs (us-east-1 regional inference profiles) */
export type WorkspaceChatModelId =
  | 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
  | 'us.anthropic.claude-opus-4-5-20251101-v1:0'
  | 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
  | 'us.anthropic.claude-sonnet-4-20250514-v1:0';

/** Model option for display in the UI */
export interface WorkspaceChatModelOption {
  id: WorkspaceChatModelId;
  label: string;
  description: string;
}

/** Default model for workspace chat */
export const DEFAULT_WORKSPACE_MODEL: WorkspaceChatModelId = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

/** Available model options for the selector */
export const WORKSPACE_MODEL_OPTIONS: WorkspaceChatModelOption[] = [
  {
    id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    label: 'Claude Sonnet 4.5',
    description: 'Balanced',
  },
  {
    id: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
    label: 'Claude Opus 4.5',
    description: 'Complex - 66% more expensive then sonnet',
  },
  {
    id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    label: 'Claude Haiku 4.5',
    description: 'Fast - 3x cheaper than sonnet',
  },
  {
    id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    label: 'Numa Chat V1 Model',
    description: 'Claude Sonnet 4',
  },
];

// ============================================================
// Claude CLI Trace Event Types
// ============================================================

/** Top-level event types from Claude CLI --output-format stream-json */
export type ClaudeCliEventType =
  | 'system'
  | 'stream_event'
  | 'assistant'
  | 'user'
  | 'error'
  | 'session_init'
  | 'conversation_switch'
  | 'assistant_advice'
  | 'completion';

/** Stream event types (nested within stream_event) */
export type StreamEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop';

/** Content block types */
export type ContentBlockType = 'text' | 'tool_use' | 'thinking';

/** Delta types for streaming updates */
export type DeltaType = 'text_delta' | 'input_json_delta' | 'thinking_delta' | 'signature_delta';

/** Base event structure from Claude CLI NDJSON output */
export interface ClaudeCliEvent {
  type: ClaudeCliEventType;
  subtype?: string;
  session_id?: string;
  uuid?: string;
  parent_tool_use_id?: string | null;
  request_id?: string;
  stop_reason?: string;
  reason?: string;
  event?: StreamEvent;
  message?: ClaudeMessage;
  error?: string;
  detail?: string;
}

/** System init event (first event in trace) */
export interface SystemInitEvent extends ClaudeCliEvent {
  type: 'system';
  subtype: 'init';
  cwd?: string;
  session_id: string;
  tools?: string[];
  model?: string;
  claude_code_version?: string;
}

/** AgentCore session initialization event (on cold start) */
export interface SessionInitEvent {
  type: 'session_init';
  isNewSession: boolean;
  status: 'syncing_workspace' | 'ready';
}

/** AgentCore conversation switch event (when switching between conversations) */
export interface ConversationSwitchEvent {
  type: 'conversation_switch';
  status: 'switching' | 'ready';
  fromConversation?: string;
  toConversation?: string;
  conversationId?: string;
}

/** Pre-request assistant advice event (fast model analysis before main agent) */
export interface AssistantAdviceEvent {
  type: 'assistant_advice';
  content: string;
  timestamp?: string;
}

/** Terminal completion event (emitted on normal end or user stop) */
export interface CompletionEvent {
  type: 'completion';
  timestamp?: string;
  reason?: 'user_cancelled' | string;
  stop_reason?: string | null;
  session_id?: string;
  request_id?: string;
}

/** Nested stream event from Anthropic API */
export interface StreamEvent {
  type: StreamEventType;
  index?: number;
  content_block?: ContentBlock;
  delta?: ContentDelta;
  message?: ClaudeMessagePayload;
  stop_reason?: string;
  stop_sequence?: string | null;
  usage?: UsageInfo;
  'amazon-bedrock-invocationMetrics'?: BedrockMetrics;
}

/** Content block in stream events */
export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string; // tool_use id
  name?: string; // tool name
  input?: unknown; // tool input (may be partial during streaming)
}

/** Delta for streaming updates */
export interface ContentDelta {
  type: DeltaType;
  text?: string;
  thinking?: string;
  partial_json?: string;
  signature?: string;
}

/** Message payload in stream events */
export interface ClaudeMessagePayload {
  model?: string;
  id?: string;
  type?: string;
  role?: 'user' | 'assistant';
  content?: MessageContent[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: UsageInfo;
}

/** Complete message structure (from 'assistant' or 'user' type events) */
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: MessageContent[];
  model?: string;
  id?: string;
  stop_reason?: string | null;
  usage?: UsageInfo;
}

/** Message content item types */
export type MessageContent = TextContent | ToolUseContent | ToolResultContent | ThinkingContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown;
  is_error?: boolean;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

/** Usage information */
export interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Bedrock invocation metrics */
export interface BedrockMetrics {
  inputTokenCount?: number;
  outputTokenCount?: number;
  invocationLatency?: number;
  firstByteLatency?: number;
  cacheReadInputTokenCount?: number;
  cacheWriteInputTokenCount?: number;
}

// ============================================================
// Workspace Chat Conversation Types
// ============================================================

/** Workspace chat conversation metadata (from S3) */
export interface WorkspaceChatConversation {
  conversationId: string;
  conversationName: string;
  createdAt: string;
  updatedAt: string;
  hasTrace: boolean;
  sessionId?: string;
  uploadsCount?: number;
  sessionCount?: number;
}

/** Workspace chat message for UI display */
export interface WorkspaceChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  segments?: WorkspaceChatSegment[];
  timestamp?: number;
  /**
   * Ephemeral status for loading states:
   * - 'processing': Request sent, waiting for any response from backend
   * - 'thinking': Receiving thinking blocks (extended thinking content streaming)
   * - 'streaming': Receiving text or tool events
   * - 'initializing': Session initialization (workspace sync in progress)
   */
  status?: 'processing' | 'thinking' | 'streaming' | 'initializing';
  /** Document title if message contains a document */
  docTitle?: string;
  /** Document content if message contains a document */
  docContent?: string;
}

/** Segment types for rendering message content */
export type WorkspaceChatSegment =
  | WorkspaceChatTextSegment
  | WorkspaceChatToolCardSegment
  | WorkspaceChatThinkingSegment
  | WorkspaceChatAssistantAdviceSegment
  | WorkspaceChatFileUploadSegment
  | WorkspaceChatFileAttachmentSegment
  | WorkspaceChatFolderAttachmentSegment
  | WorkspaceChatInlineToolSegment
  | WorkspaceChatSubagentSegment
  | WorkspaceChatTodoSegment
  | WorkspaceChatInlineThinkingSegment
  | WorkspaceChatCompactionSegment;

export interface WorkspaceChatTextSegment {
  kind: 'text';
  text: string;
  finalized?: boolean;
}

export interface WorkspaceChatToolCardSegment {
  kind: 'tool_card';
  toolName: string;
  toolUseId: string;
  label: string;
  input?: unknown;
  steps: string[];
  result?: unknown;
  isLoading: boolean;
  isError?: boolean;
}

export interface WorkspaceChatThinkingSegment {
  kind: 'thinking';
  text: string;
  collapsed?: boolean;
}

/** Pre-request assistant advice segment (displayed as collapsible dropdown) */
export interface WorkspaceChatAssistantAdviceSegment {
  kind: 'assistant_advice';
  text: string;
  collapsed?: boolean;
}

/**
 * Inline thinking spinner segment.
 * Shows while thinking blocks are streaming, disappears when text/tool content arrives.
 */
export interface WorkspaceChatInlineThinkingSegment {
  kind: 'inline_thinking';
  /** Whether thinking is actively streaming */
  isStreaming: boolean;
}

/**
 * Compaction/summarization segment.
 * Shows when conversation reaches context limits (~125K tokens) and is being summarized.
 * Displays progress during summarization and the resulting summary when complete.
 */
export interface WorkspaceChatCompactionSegment {
  kind: 'compaction';
  /** Current status: 'summarizing' while in progress, 'complete' when done */
  status: 'summarizing' | 'complete';
  /** The summary text when compaction is complete */
  summary?: string;
  /** Number of tokens before compaction (from compact_boundary metadata) */
  preTokens?: number;
  /** What triggered the compaction */
  trigger?: 'auto' | 'manual';
}

export interface WorkspaceChatFileUploadSegment {
  kind: 'file_upload';
  filename: string;
  path: string;
  size: number;
  uploadStatus: 'success' | 'processing' | 'error';
}

/** Segment for file attachments in user messages */
export interface WorkspaceChatFileAttachmentSegment {
  kind: 'file_attachment';
  filename: string;
  path: string; // e.g., "uploads/report.pdf"
  size: number;
}

/** A file that has been uploaded but not yet attached to a message */
export interface PendingUploadedFile {
  filename: string;
  path: string; // e.g., "uploads/report.pdf"
  size: number;
  uploadedAt: number; // timestamp
}

// ============================================================
// Staged Upload Types (localStorage)
// ============================================================

/** A single file that has been uploaded and staged */
export interface StagedFile {
  kind: 'file';
  filename: string;
  path: string; // Full path including folder structure, e.g., "uploads/invoices/2024/a.pdf"
  size: number;
  uploadedAt: number;
}

/** A folder that has been uploaded (group of files) */
export interface StagedFolder {
  kind: 'folder';
  folderName: string; // Display name (last segment)
  folderPath: string; // e.g., "invoices/2024"
  files: StagedFile[];
  totalSize: number;
}

/** Union type for staged items (can be file or folder) */
export type StagedItem = StagedFile | StagedFolder;

/** Segment for folder attachments in user messages */
export interface WorkspaceChatFolderAttachmentSegment {
  kind: 'folder_attachment';
  folderName: string;
  folderPath: string;
  fileCount: number;
  totalSize: number;
}

// ============================================================
// API Request/Response Types
// ============================================================

/** Request body for POST /api/workspace-chat-agent/chat */
export interface WorkspaceChatRequest {
  prompt: string;
  conversationId?: string;
  requestId?: string;
  timezone?: string;
  userEmail?: string;
  todayString?: string;
  // Parity with ChatAgentRequest
  availableKBs?: Array<{ id: string; name: string }>;
  enabledTools?: string[];
  enabledConnections?: string[];
  // Model selection (global cross-region inference profile)
  modelId?: WorkspaceChatModelId;
  // Attachment handling - files and optional folder metadata
  attachments?: {
    files: Array<{ path: string; filename: string; size: number }>;
    folders?: Array<{ name: string; path: string; fileCount: number; totalSize: number }>;
  };
  hasUploads?: boolean;
  expectedUploadPaths?: string[];
  // V1 to V2 migration flag - set when continuing a V1 conversation in V2
  migrateFromV1?: boolean;
  // Agent support - ID of the agent to use for this chat session
  agentId?: string;
}

/** Response from GET /api/workspace-chat-agent/conversations */
export interface WorkspaceChatConversationsResponse {
  status: string;
  conversations: WorkspaceChatConversation[];
}

/** Response from GET /api/workspace-chat-agent/conversation/{id}/history */
export interface WorkspaceChatConversationDetailResponse {
  status: string;
  conversation: {
    conversationId: string;
    conversationName: string;
    messages: WorkspaceChatMessage[];
    metadata: {
      hasTrace: boolean;
      sessionId?: string;
      uploadsCount: number;
      sessionCount: number;
      traceSizeBytes?: number;
    };
  };
}

/** Response from POST /api/workspace-chat-agent/upload */
export interface WorkspaceChatUploadResponse {
  status: string;
  path: string;
  filename: string;
  size: number;
}

/** Response from GET /api/workspace-chat-agent/status */
export interface WorkspaceChatAgentStatusResponse {
  status: string;
  client: string;
  capabilities: string[];
  userSub: string;
  claudeCliVersion?: string;
}

/** File info from GET /api/workspace-chat-agent/workspace/files */
export interface WorkspaceChatFileInfo {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isDirectory?: boolean;
}

/** Response from GET /api/workspace-chat-agent/workspace/files */
export interface WorkspaceChatFilesResponse {
  status: string;
  files: WorkspaceChatFileInfo[];
}

/** Response from DELETE /api/workspace-chat-agent/conversation/{id}/tmp */
export interface WorkspaceChatCleanupResponse {
  status: string;
  deleted: number;
}

// ============================================================
// Callback Types
// ============================================================

/** Callback for receiving Claude CLI events during streaming */
export type OnWorkspaceChatEvent = (event: ClaudeCliEvent) => void;

/** Callback for stream completion */
export type OnWorkspaceChatComplete = () => void;

/** Callback for stream errors */
export type OnWorkspaceChatError = (error: Error) => void;

// ============================================================
// Event Processing Types
// ============================================================

/** Context for tracking event processing state across a streaming session */
export interface WorkspaceChatEventContext {
  /** Session ID from system init event */
  sessionId: string | null;
  /** Current content block index */
  currentBlockIndex: number;
  /** Current content block type */
  currentBlockType: ContentBlockType | null;
  /** Accumulated text for current text block */
  textBuffer: string;
  /** Accumulated thinking text */
  thinkingBuffer: string;
  /** Accumulated tool input JSON string */
  toolInputBuffer: string;
  /** Map of tool_use_id -> tool info for result matching */
  toolUseMap: Map<string, { name: string; input: unknown }>;
  /** Set of tool_use_ids that have received results */
  processedToolResults: Set<string>;
}

/** Helper functions passed to event handlers for updating UI state */
export interface WorkspaceChatMessageHelpers {
  setMessages: (updater: (prev: WorkspaceChatMessage[]) => WorkspaceChatMessage[]) => void;
  setButtonStatus: (status: 'idle' | 'loading' | 'streaming') => void;
}

// ============================================================
// Type Guards
// ============================================================

export function isSystemInitEvent(event: ClaudeCliEvent): event is SystemInitEvent {
  return event.type === 'system' && event.subtype === 'init';
}

export function isStreamEvent(event: ClaudeCliEvent): boolean {
  return event.type === 'stream_event' && event.event !== undefined;
}

export function isAssistantMessage(event: ClaudeCliEvent): boolean {
  return event.type === 'assistant' && event.message !== undefined;
}

export function isUserMessage(event: ClaudeCliEvent): boolean {
  return event.type === 'user' && event.message !== undefined;
}

export function isErrorEvent(event: ClaudeCliEvent): boolean {
  return event.type === 'error';
}

export function isSessionInitEvent(event: unknown): event is SessionInitEvent {
  return typeof event === 'object' && event !== null && (event as SessionInitEvent).type === 'session_init';
}

export function isConversationSwitchEvent(event: unknown): event is ConversationSwitchEvent {
  return (
    typeof event === 'object' && event !== null && (event as ConversationSwitchEvent).type === 'conversation_switch'
  );
}

export function isAssistantAdviceEvent(event: unknown): event is AssistantAdviceEvent {
  return typeof event === 'object' && event !== null && (event as AssistantAdviceEvent).type === 'assistant_advice';
}

export function isToolUseContent(content: MessageContent): content is ToolUseContent {
  return content.type === 'tool_use';
}

export function isToolResultContent(content: MessageContent): content is ToolResultContent {
  return content.type === 'tool_result';
}

export function isTextContent(content: MessageContent): content is TextContent {
  return content.type === 'text';
}

export function isThinkingContent(content: MessageContent): content is ThinkingContent {
  return content.type === 'thinking';
}

// ============================================================
// Claude Agent SDK Event Types
// ============================================================

/** SDK event types (top-level) */
export type SDKEventType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'result'
  | 'error'
  | 'StreamEvent'
  | 'completion'
  | 'assistant_advice';

/** Base SDK event with common fields */
export interface SDKBaseEvent {
  type: SDKEventType;
  timestamp?: string;
  session_id?: string;
  uuid?: string;
  /** null = main agent, string = inside subagent (parent Task's tool_use_id) */
  parent_tool_use_id: string | null;
}

/** SDK Assistant message event */
export interface SDKAssistantEvent extends SDKBaseEvent {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    model?: string;
    content: SDKContentBlock[];
  };
}

/** SDK User message event */
export interface SDKUserEvent extends SDKBaseEvent {
  type: 'user';
  message: {
    role: 'user';
    content: SDKContentBlock[] | string;
  };
}

/** SDK System event */
export interface SDKSystemEvent extends SDKBaseEvent {
  type: 'system';
  subtype: string;
  data?: Record<string, unknown>;
}

/** SDK Result event (end of conversation turn) */
export interface SDKResultEvent extends SDKBaseEvent {
  type: 'result';
  subtype?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  result?: unknown;
}

/** SDK Error event */
export interface SDKErrorEvent extends SDKBaseEvent {
  type: 'error';
  error: string;
  detail?: string;
}

/** SDK completion event (terminal) */
export interface SDKCompletionEvent extends SDKBaseEvent {
  type: 'completion';
  reason?: string;
  stop_reason?: string | null;
  request_id?: string;
}

/** Claude streaming event types */
export type StreamEventInnerType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop';

/** SDK StreamEvent - raw Claude API streaming events wrapped by the backend */
export interface SDKStreamEvent extends SDKBaseEvent {
  type: 'StreamEvent';
  event: {
    type: StreamEventInnerType;
    index?: number;
    content_block?: {
      type: 'text' | 'tool_use' | 'thinking';
      id?: string;
      name?: string;
      thinking?: string;
      signature?: string;
    };
    delta?: {
      type: 'text_delta' | 'input_json_delta' | 'thinking_delta';
      text?: string;
      partial_json?: string;
      thinking?: string;
    };
    message?: {
      id?: string;
      model?: string;
      role?: string;
      content?: unknown[];
      usage?: Record<string, number>;
    };
  };
}

/** SDK Content block types */
export type SDKContentBlock = SDKTextBlock | SDKToolUseBlock | SDKToolResultBlock | SDKThinkingBlock;

export interface SDKTextBlock {
  type: 'text';
  text: string;
}

export interface SDKToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface SDKToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown;
  is_error?: boolean;
}

export interface SDKThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

/** Event for file attachments (emitted before user message) */
export interface SDKAttachmentsEvent {
  type: 'attachments';
  timestamp: string;
  files: Array<{
    filename: string;
    path: string;
    size: number;
  }>;
  /** Folder metadata for folder uploads - helps AI understand folder structure */
  folders?: Array<{
    name: string;
    path: string;
    fileCount: number;
    totalSize: number;
  }>;
  session_id?: string;
  parent_tool_use_id?: string | null;
}

/** Assistant advice event (pre-request hint) */
export interface SDKAssistantAdviceEvent {
  type: 'assistant_advice';
  content: string;
  timestamp?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
}

/** Union of all SDK events */
export type SDKEvent =
  | SDKAssistantEvent
  | SDKUserEvent
  | SDKSystemEvent
  | SDKResultEvent
  | SDKErrorEvent
  | SDKStreamEvent
  | SDKAttachmentsEvent
  | SDKCompletionEvent
  | SDKAssistantAdviceEvent;

// ============================================================
// SDK Tool Input Types
// ============================================================

/** Read tool input */
export interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

/** Write tool input */
export interface WriteInput {
  file_path: string;
  content: string;
}

/** Edit tool input */
export interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/** Glob tool input */
export interface GlobInput {
  pattern: string;
  path?: string;
}

/** Grep tool input */
export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
}

/** Bash tool input */
export interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

/** WebFetch tool input */
export interface WebFetchInput {
  url: string;
  prompt: string;
}

/** WebSearch tool input */
export interface WebSearchInput {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

/** Task (subagent) tool input */
export interface TaskInput {
  subagent_type: string;
  prompt: string;
  description?: string;
  thoroughness?: 'quick' | 'medium' | 'very_thorough';
  run_in_background?: boolean;
  model?: 'sonnet' | 'opus' | 'haiku';
  resume?: string;
}

/** Skill tool input */
export interface SkillInput {
  skill: string;
  args?: string;
}

/** TodoWrite tool input */
export interface TodoWriteInput {
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
}

/** AskUserQuestion tool input */
export interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
}

// ============================================================
// New SDK Segment Types
// ============================================================

/** Tool category for rendering decisions */
export type ToolCategory = 'transient' | 'important' | 'default';

/** Inline tool indicator segment (minimal UI with connected dots or icons) */
export interface WorkspaceChatInlineToolSegment {
  kind: 'inline_tool';
  toolUseId: string;
  toolName: string;
  displayText: string;
  filePath?: string;
  isComplete: boolean;
  isError?: boolean;
  /** Tool category for rendering decisions (transient tools fade out after completion) */
  category?: ToolCategory;
  /** Bootstrap icon class name for important tools (e.g., 'bi-search' for web search) */
  iconName?: string;
}

/** Subagent container segment (for Task tool) */
export interface WorkspaceChatSubagentSegment {
  kind: 'subagent';
  parentToolUseId: string;
  taskDescription: string;
  subagentType: string;
  events: SDKEvent[];
  collapsed: boolean;
  isComplete: boolean;
}

/** Todo checklist segment (for TodoWrite tool) */
export interface WorkspaceChatTodoSegment {
  kind: 'todo';
  toolUseId: string;
  items: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
  isComplete: boolean;
}

// ============================================================
// SDK Event Processing Context
// ============================================================

/** Context for SDK event processing */
export interface SDKEventContext {
  /** Session ID from system init event */
  sessionId: string | null;
  /** Current message ID being processed */
  currentMessageId: string | null;
  /** Map of tool_use_id -> tool info for result matching */
  toolUseMap: Map<string, { name: string; input: unknown; parentToolUseId: string | null }>;
  /** Set of tool_use_ids that have received results */
  completedTools: Set<string>;
  /** Map of parent_tool_use_id -> accumulated subagent events */
  subagentEvents: Map<string, SDKEvent[]>;
  /** Track processed content block indices per message to handle partial messages */
  processedBlockIndices: Map<string, number>;
  /** Flag to skip text blocks when streaming via StreamEvent (prevents duplicates) */
  skipTextFromAssistant?: boolean;
  /** State for stripping document comments across streaming chunks */
  docStripState: { leftover: string };
  /** Flag: compaction is in progress */
  isCompacting?: boolean;
  /** Flag: awaiting the summary user message after compact_boundary */
  isAwaitingCompactionSummary?: boolean;
  /** Metadata from compact_boundary event */
  compactionMetadata?: { preTokens?: number; trigger?: 'auto' | 'manual' };
}

// ============================================================
// SDK Type Guards
// ============================================================

export function isSDKAssistantEvent(event: SDKEvent): event is SDKAssistantEvent {
  return event.type === 'assistant';
}

export function isSDKUserEvent(event: SDKEvent): event is SDKUserEvent {
  return event.type === 'user';
}

export function isSDKSystemEvent(event: SDKEvent): event is SDKSystemEvent {
  return event.type === 'system';
}

export function isSDKResultEvent(event: SDKEvent): event is SDKResultEvent {
  return event.type === 'result';
}

export function isSDKErrorEvent(event: SDKEvent): event is SDKErrorEvent {
  return event.type === 'error';
}

export function isMainAgentEvent(event: SDKEvent): boolean {
  // Use == null to match both null and undefined (event without parent_tool_use_id)
  return event.parent_tool_use_id == null;
}

export function isSubagentEvent(event: SDKEvent): boolean {
  // Use != null to ensure parent_tool_use_id is actually set (not null or undefined)
  return event.parent_tool_use_id != null;
}

export function isSDKTextBlock(block: SDKContentBlock): block is SDKTextBlock {
  return block.type === 'text';
}

export function isSDKToolUseBlock(block: SDKContentBlock): block is SDKToolUseBlock {
  return block.type === 'tool_use';
}

export function isSDKToolResultBlock(block: SDKContentBlock): block is SDKToolResultBlock {
  return block.type === 'tool_result';
}

export function isSDKThinkingBlock(block: SDKContentBlock): block is SDKThinkingBlock {
  return block.type === 'thinking';
}

// ============================================================
// Compaction Event Type Guards
// ============================================================

/**
 * Check if event is a compaction status event (status: "compacting").
 * This indicates the start of conversation summarization.
 */
export function isCompactionStatusEvent(event: SDKEvent): boolean {
  return (
    event.type === 'system' &&
    (event as SDKSystemEvent).subtype === 'status' &&
    (event as SDKSystemEvent).data?.status === 'compacting'
  );
}

/**
 * Check if event is a compact_boundary event.
 * Contains metadata about the compaction (pre_tokens, trigger).
 */
export function isCompactBoundaryEvent(event: SDKEvent): boolean {
  return event.type === 'system' && (event as SDKSystemEvent).subtype === 'compact_boundary';
}

/**
 * Check if event is a status cleared event (status: null after compacting).
 * Indicates compaction is complete.
 */
export function isCompactionCompleteStatusEvent(event: SDKEvent): boolean {
  return (
    event.type === 'system' &&
    (event as SDKSystemEvent).subtype === 'status' &&
    (event as SDKSystemEvent).data?.status === null
  );
}
