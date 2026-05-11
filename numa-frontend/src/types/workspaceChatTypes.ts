/**
 * Workspace Chat Agent Types
 *
 * Types for the Numa Workspace Chat Agent which uses Claude CLI trace format.
 * Different from chat.ts which handles Strands/Bedrock events.
 */

// ============================================================
// Model Selection Types
// ============================================================

/** Available workspace chat model IDs (bare, without regional prefix).
 * The backend adds the correct regional prefix (us., au.) based on deployment region.
 *
 * IDs may carry an "@<thinking-suffix>" — recognised suffixes are no-thinking,
 * low-thinking, high-thinking. The backend splits the suffix off (see
 * parse_model_id_with_thinking in sdk_config.py) and applies a THINKING_PRESETS
 * override to type_config.thinking / type_config.effort. This is throwaway
 * comparison-testing plumbing; production will set thinking per-model server-side. */
export type WorkspaceChatModelId =
  | 'anthropic.claude-sonnet-4-6'
  | 'anthropic.claude-sonnet-4-6@no-thinking'
  | 'anthropic.claude-sonnet-4-6@low-thinking'
  | 'anthropic.claude-sonnet-4-6@high-thinking'
  | 'anthropic.claude-opus-4-6-v1'
  | 'anthropic.claude-opus-4-6-v1@no-thinking'
  | 'anthropic.claude-haiku-4-5-20251001-v1:0';

/** Model option for display in the UI */
export interface WorkspaceChatModelOption {
  id: WorkspaceChatModelId;
  label: string;
  description: string;
}

/** Default model for workspace chat */
export const DEFAULT_WORKSPACE_MODEL: WorkspaceChatModelId = 'anthropic.claude-sonnet-4-6';

/** Available model options for the selector */
export const WORKSPACE_MODEL_OPTIONS: WorkspaceChatModelOption[] = [
  {
    id: 'anthropic.claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: 'Balanced',
  },
  {
    id: 'anthropic.claude-sonnet-4-6@no-thinking',
    label: 'Claude Sonnet 4.6 — no thinking',
    description: 'Test: thinking disabled',
  },
  {
    id: 'anthropic.claude-sonnet-4-6@low-thinking',
    label: 'Claude Sonnet 4.6 — low effort',
    description: 'Test: adaptive thinking, low effort',
  },
  {
    id: 'anthropic.claude-sonnet-4-6@high-thinking',
    label: 'Claude Sonnet 4.6 — high effort',
    description: 'Test: adaptive thinking, high effort',
  },
  {
    id: 'anthropic.claude-opus-4-6-v1',
    label: 'Claude Opus 4.6',
    description: 'Complex',
  },
  {
    id: 'anthropic.claude-opus-4-6-v1@no-thinking',
    label: 'Claude Opus 4.6 — no thinking',
    description: 'Test: thinking disabled',
  },
  {
    id: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    label: 'Claude Haiku 4.5',
    description: 'Fast',
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
  outputsCount?: number;
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
  /**
   * Cost/usage data for this turn (from the SDK result event).
   * Always populated when available; only rendered when the
   * DEVELOPER_MODE client flag is on AND the user has enabled the
   * in-chat cost toggle. Never expose elsewhere.
   */
  costUsd?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs?: number;
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
  | WorkspaceChatCompactionSegment
  | WorkspaceChatToolApprovalSegment;

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

export interface WorkspaceChatToolApprovalSegment {
  kind: 'tool_approval';
  toolName: string;
  toolUseId: string;
  actionKey: string;
  description: string;
  propsPreview: string;
  requestId: string;
  decision?: 'approved' | 'denied' | 'timeout' | 'execution_timeout' | 'execution_failed';
  isLoading: boolean;
  autoApproved?: boolean;
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

/** A file currently being uploaded via drag-and-drop (shown in PendingFilesBar with progress) */
export interface UploadingFile {
  id: string;
  file: File;
  filename: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

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
/** Agent type identifier (e.g. "numa-chat", "document-summariser", "research-agent") */
export type WorkspaceAgentTypeId = string;

/** Response mode for non-streaming agent types */
export type WorkspaceResponseMode = 'stream' | 'sync' | 'fire-and-forget';

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
  availableIntegrations?: Array<{ id: string; name: string }>;
  /** Connected data connectors (OAuth/token connectors from Data Connectors page) */
  connectedDataConnectors?: Array<{ id: string; name: string }>;
  /** Whether the data connectors tool is enabled for this chat session */
  dataConnectorsEnabled?: boolean;
  // Model selection (global cross-region inference profile)
  modelId?: WorkspaceChatModelId;
  // Attachment handling - files and optional folder metadata
  attachments?: {
    files: Array<{ path: string; filename: string; size: number }>;
    folders?: Array<{ name: string; path: string; fileCount: number; totalSize: number }>;
  };
  hasUploads?: boolean;
  expectedUploadPaths?: string[];
  /** Paths to voice recordings that should be auto-transcribed into the user message */
  voiceRecordings?: string[];
  // V1 to V2 migration flag - set when continuing a V1 conversation in V2
  migrateFromV1?: boolean;
  // Agent support - ID of the agent to use for this chat session
  agentId?: string;
  // Agent type system — selects a registered agent type config (default: "numa-chat")
  type?: WorkspaceAgentTypeId;
  // Response mode override — controls how the response is delivered.
  // When omitted, defaults to the agent type's configured mode.
  responseMode?: WorkspaceResponseMode;
}

/** Sync response from a non-streaming agent invocation */
export interface WorkspaceSyncResponse {
  status: 'completed' | 'error';
  result: {
    text: string;
    artifacts: Array<{ path: string; name: string; size: number }>;
    usage: {
      num_turns?: number;
      total_cost_usd?: number;
      duration_ms?: number;
    };
  };
  conversationId: string;
}

/** Fire-and-forget response (returned immediately, poll for result) */
export interface WorkspaceFireAndForgetResponse {
  status: 'started';
  run_id: string;
  conversationId: string;
  poll_endpoint: string;
}

/** Agent type metadata from GET /types */
export interface WorkspaceAgentTypeInfo {
  type_id: string;
  display_name: string;
  response_mode: WorkspaceResponseMode;
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
      outputsCount: number;
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

/** Request body for upload_complete action (direct S3 upload notification) */
export interface WorkspaceChatUploadCompleteRequest {
  action: 'upload_complete';
  conversationId: string;
  filename: string;
  s3Key: string;
  size: number;
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
export type OnWorkspaceChatComplete = (info: { receivedCompletion: boolean }) => void;

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
  | 'assistant_advice'
  | 'tool_approval';

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
  | SDKAssistantAdviceEvent
  | SDKToolApprovalEvent;

/** SDK Tool Approval event — emitted when an integration tool needs user approval */
export interface SDKToolApprovalEvent {
  type: 'tool_approval';
  timestamp?: string;
  /** Unix epoch seconds when the backend created the approval request.
   *  Used by the frontend to synchronize the countdown timer. */
  created_at?: number;
  tool_use_id: string;
  tool_name: string;
  action_key: string;
  description: string;
  props_preview: string;
  request_id: string;
  auto_approved?: boolean;
  /** Category of the approval: "integration", "numa_tool", etc. Used by frontend for label rendering. */
  approval_category?: string;
  parent_tool_use_id?: string | null;
}

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

/** Execute script MCP tool input */
export interface ExecuteScriptInput {
  interpreter: string;
  code: string;
  description?: string;
  timeout?: number;
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
  /** Image URL for branded icons (e.g., integration logos) */
  iconImage?: string;
  /** When true, only render the approval panel — skip the tool indicator line.
   *  Used for sub-agent approvals where the tool call is already shown inside the subagent card. */
  approvalOnly?: boolean;
  /** Approval data for integration tools requiring human-in-the-loop confirmation */
  approval?: {
    actionKey: string;
    description: string;
    propsPreview: string;
    requestId: string;
    decision?: 'approved' | 'denied' | 'timeout' | 'execution_timeout' | 'execution_failed';
    isSubmitting?: boolean;
    autoApproved?: boolean;
    /** Unix epoch seconds when the backend created the approval — used to sync countdown */
    createdAt?: number;
  };
  /** Credential-capture prompt — attached when a non-OAuth connector tool call returned
   *  error_code "needs_credential". Renders an inline credential entry card;
   *  on submit the credential is POSTed to the user vault and the user is told to retry. */
  credentialRequest?: {
    connectorId: string;
    displayName: string;
    authType: 'token' | 'api-key' | 'username-password' | string;
    fields: Array<{
      key: string;
      label: string;
      type?: string;
      placeholder?: string;
      required?: boolean;
    }>;
    /** Form state: which field values the user has entered so far */
    values?: Record<string, string>;
    status?: 'idle' | 'submitting' | 'submitted' | 'error';
    error?: string;
  };
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
