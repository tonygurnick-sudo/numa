/**
 * Event handlers for Numa Workspace Chat Agent streaming.
 *
 * Handles Claude Agent SDK format events.
 * Converts SDK events into UI segments for WorkspaceChatMessage display.
 */
import type {
  SDKEvent,
  SDKAssistantEvent,
  SDKUserEvent,
  SDKSystemEvent,
  SDKResultEvent,
  SDKErrorEvent,
  SDKContentBlock,
  SDKToolUseBlock,
  SDKToolResultBlock,
  SDKEventContext,
  WorkspaceChatMessage,
  WorkspaceChatSegment,
  WorkspaceChatTextSegment,
  WorkspaceChatThinkingSegment,
  WorkspaceChatInlineToolSegment,
  WorkspaceChatSubagentSegment,
  WorkspaceChatTodoSegment,
  WorkspaceChatToolCardSegment,
  WorkspaceChatFileAttachmentSegment,
  WorkspaceChatFolderAttachmentSegment,
  WorkspaceChatCompactionSegment,
  WorkspaceChatMessageHelpers,
  TaskInput,
  TodoWriteInput,
  BashInput,
  ReadInput,
  WriteInput,
  EditInput,
  WebSearchInput,
  WebFetchInput,
  ToolCategory,
  SkillInput,
} from '@/types/workspaceChatTypes';

// Document processing utilities
import { parseChunkWithoutDocComments, extractSingleDocBlock, createDocStripState } from './streamingProcessors';

// Type guards (runtime functions, not types)
import {
  isSDKAssistantEvent,
  isSDKUserEvent,
  isSDKSystemEvent,
  isSDKResultEvent,
  isSDKErrorEvent,
  isSubagentEvent,
  isSDKTextBlock,
  isSDKToolUseBlock,
  isSDKToolResultBlock,
  isSDKThinkingBlock,
  isCompactionStatusEvent,
  isCompactBoundaryEvent,
} from '@/types/workspaceChatTypes';

// ============================================================
// Tool Categorization
// ============================================================

/** Tools that show as inline indicators (minimal UI) */
const INLINE_TOOLS = new Set(['Read', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'Bash', 'Glob', 'Grep', 'Skill']);

/** Tools that are internal plumbing (hidden from UI) - kept for future use */
const PLUMBING_TOOLS = new Set<string>();

/** Thinking-related items to hide */
const HIDDEN_ITEMS = new Set(['redacted_thinking']);

/** Tools that get special card treatment - kept for future use */
const _SPECIAL_CARD_TOOLS = new Set(['Task', 'TodoWrite', 'AskUserQuestion']);

// ============================================================
// Tool Display Categorization (Transient vs Important vs Default)
// ============================================================

/** Transient tools - fade out after completion (file system exploration) */
const TRANSIENT_TOOLS = new Set(['Glob', 'Grep', 'Read']);

/** Important tools with icons - always visible */
const IMPORTANT_TOOLS = new Map<string, { icon: string; name: string }>([
  // WebSearch variants (PascalCase, snake_case, kebab-case)
  ['WebSearch', { icon: 'bi-search', name: 'Web Search' }],
  ['web_search', { icon: 'bi-search', name: 'Web Search' }],
  ['web-search', { icon: 'bi-search', name: 'Web Search' }],
  // WebFetch variants
  ['WebFetch', { icon: 'bi-globe', name: 'Web Fetch' }],
  ['web_fetch', { icon: 'bi-globe', name: 'Web Fetch' }],
  ['web-fetch', { icon: 'bi-globe', name: 'Web Fetch' }],
  // File operations
  ['Write', { icon: 'bi-file-earmark-plus', name: 'Created' }],
  ['Edit', { icon: 'bi-pencil-square', name: 'Edited' }],
]);

/**
 * Get icon for Skill tool based on skill name.
 * Knowledge search uses the folder icon (matches nav).
 */
function getSkillIcon(skillName: string): string {
  if (skillName === 'knowledge-search') return 'bi-folder2-open';
  if (skillName === 'web-search') return 'bi-search';
  return 'bi-lightning'; // Default skill icon
}

/**
 * Check if Bash command is a KB query (show KB icon instead of being transient).
 */
function isBashKBQuery(cmd: string): boolean {
  return cmd.includes('knowledge_base.py');
}

/**
 * Check if Bash command is an agent management command.
 */
function isBashAgentCommand(cmd: string): boolean {
  return cmd.includes('numa-agents.py');
}

/**
 * Check if Bash command is transient (file system navigation).
 */
function isBashTransient(cmd: string): boolean {
  // KB queries are not transient
  if (isBashKBQuery(cmd)) return false;
  // File system navigation commands are transient
  return /^(ls|find|cat|head|tail|wc|du|df)\s/.test(cmd.toLowerCase());
}

/**
 * Get tool category and optional icon for an inline tool.
 * Returns category for rendering decisions and icon for important tools.
 */
export function getToolCategoryAndIcon(
  toolName: string,
  input: unknown,
): { category: ToolCategory; iconName?: string } {
  // Handle Skill tool - check skill name for icon
  if (toolName === 'Skill') {
    const skillInput = input as SkillInput | undefined;
    const skillName = skillInput?.skill || '';
    // Extract just the skill name from "numa-workspace:knowledge-search" format
    const shortName = skillName.includes(':') ? skillName.split(':').pop() || skillName : skillName;
    return { category: 'important', iconName: getSkillIcon(shortName) };
  }

  // Handle Bash tool - check if KB query, agent command, or transient command
  if (toolName === 'Bash') {
    const bashInput = input as BashInput | undefined;
    const cmd = bashInput?.command || '';
    if (isBashKBQuery(cmd)) {
      return { category: 'important', iconName: 'bi-folder2-open' };
    }
    if (isBashAgentCommand(cmd)) {
      return { category: 'important', iconName: 'bi-robot' };
    }
    if (isBashTransient(cmd)) {
      return { category: 'transient' };
    }
    return { category: 'default' };
  }

  // Check important tools map
  const important = IMPORTANT_TOOLS.get(toolName);
  if (important) {
    return { category: 'important', iconName: important.icon };
  }

  // Check transient tools
  if (TRANSIENT_TOOLS.has(toolName)) {
    return { category: 'transient' };
  }

  return { category: 'default' };
}

/** Segment kind for a given tool */
export type ToolSegmentKind = 'subagent' | 'todo' | 'inline_tool' | 'tool_card' | 'hidden';

/**
 * Determine what kind of segment a tool should create.
 * Single source of truth for tool → segment mapping.
 */
export function getToolSegmentKind(toolName: string): ToolSegmentKind {
  if (toolName === 'Task') return 'subagent';
  if (toolName === 'TodoWrite') return 'todo';
  if (INLINE_TOOLS.has(toolName)) return 'inline_tool';
  if (PLUMBING_TOOLS.has(toolName) || HIDDEN_ITEMS.has(toolName)) return 'hidden';
  return 'tool_card'; // Skill, AskUserQuestion, and unknown tools
}

// ============================================================
// Event Context Management
// ============================================================

/**
 * Create a fresh SDK event context for a new streaming session.
 */
export function createSDKEventContext(): SDKEventContext {
  return {
    sessionId: null,
    currentMessageId: null,
    toolUseMap: new Map(),
    completedTools: new Set(),
    subagentEvents: new Map(),
    processedBlockIndices: new Map(),
    docStripState: { leftover: '' },
    isCompacting: false,
    isAwaitingCompactionSummary: false,
    compactionMetadata: undefined,
  };
}

/**
 * Reset context for a new turn within the same conversation.
 */
export function resetSDKEventContext(context: SDKEventContext): void {
  context.currentMessageId = null;
  context.processedBlockIndices.clear();
  context.subagentEvents.clear();
  context.docStripState = { leftover: '' };
  // Reset compaction state
  context.isCompacting = false;
  context.isAwaitingCompactionSummary = false;
  context.compactionMetadata = undefined;
  // Keep toolUseMap and completedTools for cross-turn matching
}

// ============================================================
// Tool Display Helpers
// ============================================================

/**
 * Get human-readable display text for an inline tool.
 */
export function getInlineToolDisplay(toolName: string, input: unknown): { text: string; filePath?: string } {
  const inputObj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  switch (toolName) {
    case 'Read': {
      const readInput = inputObj as unknown as ReadInput;
      const path = readInput.file_path || '';
      const filename = path.split('/').pop() || path;
      return { text: `Reading ${filename}`, filePath: path };
    }
    case 'Write': {
      const writeInput = inputObj as unknown as WriteInput;
      const path = writeInput.file_path || '';
      const filename = path.split('/').pop() || path;
      return { text: `Created ${filename}`, filePath: path };
    }
    case 'Edit': {
      const editInput = inputObj as unknown as EditInput;
      const path = editInput.file_path || '';
      const filename = path.split('/').pop() || path;
      return { text: `Updating ${filename}`, filePath: path };
    }
    case 'WebSearch': {
      const searchInput = inputObj as unknown as WebSearchInput;
      const query = searchInput.query || '...';
      const truncated = query.length > 40 ? query.slice(0, 40) + '...' : query;
      return { text: `Searching for "${truncated}"` };
    }
    case 'WebFetch': {
      const fetchInput = inputObj as unknown as WebFetchInput;
      const url = fetchInput.url || '';
      try {
        const domain = new URL(url).hostname;
        return { text: `Checking ${domain}...` };
      } catch {
        return { text: 'Fetching URL...' };
      }
    }
    case 'Bash': {
      const bashInput = inputObj as unknown as BashInput;
      // Use description field if present (human-friendly)
      if (bashInput.description && typeof bashInput.description === 'string') {
        return { text: bashInput.description };
      }
      // Fallback to truncated command
      const cmd = (bashInput.command || '').slice(0, 50);
      return { text: `Running: ${cmd}${cmd.length >= 50 ? '...' : ''}` };
    }
    case 'Glob':
      // Internal file-finding tool - show user-friendly message
      return { text: 'Searching files...' };
    case 'Grep':
      // Internal content search tool - show user-friendly message
      return { text: 'Searching...' };
    case 'Skill': {
      // Skill tool loads skill documentation into context
      const skillInput = inputObj as { skill?: string };
      const skillName = skillInput.skill || 'skill';
      // Extract just the skill name from "numa-workspace:knowledge-search" format
      const shortName = skillName.includes(':') ? skillName.split(':').pop() : skillName;
      return { text: `Loading ${shortName} skill` };
    }
    default:
      return { text: `Using ${toolName}` };
  }
}

/**
 * Get label for a subagent type.
 */
export function getSubagentLabel(subagentType: string): string {
  const labels: Record<string, string> = {
    explore: 'Exploring codebase',
    'general-purpose': 'Running analysis',
    plan: 'Planning',
    'knowledge-search': 'Searching knowledge base',
  };
  return labels[subagentType] || `Running ${subagentType}`;
}

// ============================================================
// Segment Factory Functions
// ============================================================

/**
 * Create initial segment for a tool during streaming.
 * Used when tool_use block starts but input isn't fully parsed yet.
 */
export function createInitialToolSegment(toolName: string, toolUseId: string): WorkspaceChatSegment | null {
  const kind = getToolSegmentKind(toolName);

  switch (kind) {
    case 'subagent':
      return {
        kind: 'subagent',
        parentToolUseId: toolUseId,
        taskDescription: 'Starting task...',
        subagentType: 'task',
        events: [],
        collapsed: false,
        isComplete: false,
      };
    case 'todo':
      return {
        kind: 'todo',
        toolUseId,
        items: [],
        isComplete: false,
      };
    case 'inline_tool': {
      // Get category and icon (will be updated with input later)
      const { category, iconName } = getToolCategoryAndIcon(toolName, undefined);
      return {
        kind: 'inline_tool',
        toolUseId,
        toolName,
        displayText: 'Working...',
        isComplete: false,
        category,
        iconName,
      };
    }
    case 'tool_card':
      return {
        kind: 'tool_card',
        toolUseId,
        toolName,
        label: toolName,
        steps: [`Using ${toolName}`],
        isLoading: true,
      };
    case 'hidden':
      return null;
  }
}

/**
 * Update a segment with parsed input data.
 * Called when tool input is fully received.
 */
export function updateSegmentWithInput(
  segment: WorkspaceChatSegment,
  toolName: string,
  input: unknown,
): WorkspaceChatSegment {
  const inputObj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  switch (segment.kind) {
    case 'subagent': {
      const taskInput = inputObj as { description?: string; subagent_type?: string };
      const description = taskInput.description || getSubagentLabel(taskInput.subagent_type || 'task');
      const subagentType = taskInput.subagent_type || 'task';
      return {
        ...segment,
        taskDescription: description,
        subagentType,
      };
    }
    case 'todo': {
      const todoInput = inputObj as { todos?: Array<{ content: string; status: string; activeForm: string }> };
      return {
        ...segment,
        items: (todoInput.todos || []).map((item) => ({
          content: item.content,
          status: item.status as 'pending' | 'in_progress' | 'completed',
          activeForm: item.activeForm,
        })),
      };
    }
    case 'inline_tool': {
      const { text, filePath } = getInlineToolDisplay(toolName, input);
      // Refine category and icon now that we have actual input
      const { category, iconName } = getToolCategoryAndIcon(toolName, input);
      return {
        ...segment,
        displayText: text,
        filePath,
        category,
        iconName,
      };
    }
    case 'tool_card': {
      return {
        ...segment,
        input,
      };
    }
    default:
      return segment;
  }
}

// ============================================================
// Message Helpers Factory
// ============================================================

/**
 * Create helper functions for updating workspace chat messages.
 */
export function createWorkspaceChatMessageHelpers(
  setMessages: (updater: (prev: WorkspaceChatMessage[]) => WorkspaceChatMessage[]) => void,
  setButtonStatus: (status: 'idle' | 'loading' | 'streaming') => void,
): WorkspaceChatMessageHelpers {
  return { setMessages, setButtonStatus };
}

// ============================================================
// Segment Update Functions
// ============================================================

/**
 * Ensure there's an assistant message to append to.
 */
function ensureAssistantMessage(messages: WorkspaceChatMessage[]): WorkspaceChatMessage[] {
  const updated = [...messages];
  const lastMsg = updated[updated.length - 1];

  if (!lastMsg || lastMsg.role !== 'assistant') {
    updated.push({
      role: 'assistant',
      content: '',
      segments: [],
      status: 'streaming',
    });
  }

  return updated;
}

/**
 * Append text to the last text segment or create a new one.
 */
function appendTextSegment(helpers: WorkspaceChatMessageHelpers, text: string): void {
  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    // Find the last text segment
    let textSegIdx = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].kind === 'text') {
        textSegIdx = i;
        break;
      }
    }

    if (textSegIdx >= 0) {
      // Append to existing text segment
      const textSeg = segments[textSegIdx] as WorkspaceChatTextSegment;
      segments[textSegIdx] = {
        ...textSeg,
        text: textSeg.text + text,
      };
    } else {
      // Create new text segment
      segments.push({
        kind: 'text',
        text,
        finalized: false,
      });
    }

    lastMsg.segments = segments;
    lastMsg.content = segments
      .filter((s): s is WorkspaceChatTextSegment => s.kind === 'text')
      .map((s) => s.text)
      .join('');
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Replace text in the last text segment (for partial message updates).
 */
function replaceTextSegment(helpers: WorkspaceChatMessageHelpers, newText: string): void {
  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    // Find the last text segment
    let textSegIdx = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].kind === 'text') {
        textSegIdx = i;
        break;
      }
    }

    if (textSegIdx >= 0) {
      segments[textSegIdx] = {
        kind: 'text',
        text: newText,
        finalized: false,
      };
    } else {
      segments.push({
        kind: 'text',
        text: newText,
        finalized: false,
      });
    }

    lastMsg.segments = segments;
    lastMsg.content = segments
      .filter((s): s is WorkspaceChatTextSegment => s.kind === 'text')
      .map((s) => s.text)
      .join('');
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Update or create thinking segment.
 */
function updateThinkingSegment(helpers: WorkspaceChatMessageHelpers, thinkingText: string): void {
  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    // Find existing thinking segment (should be first or early)
    const thinkingIdx = segments.findIndex((s) => s.kind === 'thinking');

    if (thinkingIdx >= 0) {
      const seg = segments[thinkingIdx] as WorkspaceChatThinkingSegment;
      segments[thinkingIdx] = {
        ...seg,
        text: thinkingText,
      };
    } else {
      // Insert thinking at the beginning
      segments.unshift({
        kind: 'thinking',
        text: thinkingText,
        collapsed: true,
      });
    }

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Add an inline tool segment.
 */
function addInlineToolSegment(
  helpers: WorkspaceChatMessageHelpers,
  toolUseId: string,
  toolName: string,
  displayText: string,
  filePath?: string,
): void {
  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    segments.push({
      kind: 'inline_tool',
      toolUseId,
      toolName,
      displayText,
      filePath,
      isComplete: false,
    });

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Mark an inline tool as complete.
 */
function completeInlineTool(helpers: WorkspaceChatMessageHelpers, toolUseId: string, isError = false): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex(
      (s) => s.kind === 'inline_tool' && (s as WorkspaceChatInlineToolSegment).toolUseId === toolUseId,
    );

    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatInlineToolSegment;
      segments[idx] = {
        ...seg,
        isComplete: true,
        isError,
      };
      lastMsg.segments = segments;
      updated[lastIdx] = lastMsg;
    }

    return updated;
  });
}

/**
 * Add a subagent segment for Task tool.
 */
function addSubagentSegment(helpers: WorkspaceChatMessageHelpers, toolUseId: string, input: unknown): void {
  const inputObj = input && typeof input === 'object' ? (input as TaskInput) : ({} as TaskInput);
  const description = inputObj.description || getSubagentLabel(inputObj.subagent_type || 'task');
  const subagentType = inputObj.subagent_type || 'task';

  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    segments.push({
      kind: 'subagent',
      parentToolUseId: toolUseId,
      taskDescription: description,
      subagentType,
      events: [],
      collapsed: false,
      isComplete: false,
    });

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Add events to a subagent segment.
 */
function addSubagentEvent(helpers: WorkspaceChatMessageHelpers, parentToolUseId: string, event: SDKEvent): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex(
      (s) => s.kind === 'subagent' && (s as WorkspaceChatSubagentSegment).parentToolUseId === parentToolUseId,
    );

    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatSubagentSegment;
      segments[idx] = {
        ...seg,
        events: [...seg.events, event],
      };
      lastMsg.segments = segments;
      updated[lastIdx] = lastMsg;
    }

    return updated;
  });
}

/**
 * Mark a subagent as complete.
 */
function completeSubagent(helpers: WorkspaceChatMessageHelpers, parentToolUseId: string): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex(
      (s) => s.kind === 'subagent' && (s as WorkspaceChatSubagentSegment).parentToolUseId === parentToolUseId,
    );

    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatSubagentSegment;
      segments[idx] = {
        ...seg,
        isComplete: true,
      };
      lastMsg.segments = segments;
      updated[lastIdx] = lastMsg;
    }

    return updated;
  });
}

/**
 * Add a todo checklist segment.
 */
function addTodoSegment(helpers: WorkspaceChatMessageHelpers, toolUseId: string, input: unknown): void {
  const inputObj = input && typeof input === 'object' ? (input as TodoWriteInput) : ({} as TodoWriteInput);
  const items = inputObj.todos || [];

  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    // Check if there's an existing todo segment to update
    const existingIdx = segments.findIndex((s) => s.kind === 'todo');
    if (existingIdx >= 0) {
      // Update existing todo segment
      segments[existingIdx] = {
        kind: 'todo',
        toolUseId,
        items: items.map((item) => ({
          content: item.content,
          status: item.status,
          activeForm: item.activeForm,
        })),
        isComplete: false,
      };
    } else {
      // Add new todo segment
      segments.push({
        kind: 'todo',
        toolUseId,
        items: items.map((item) => ({
          content: item.content,
          status: item.status,
          activeForm: item.activeForm,
        })),
        isComplete: false,
      });
    }

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Mark a todo segment as complete.
 */
function completeTodo(helpers: WorkspaceChatMessageHelpers, toolUseId: string): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex((s) => s.kind === 'todo' && (s as WorkspaceChatTodoSegment).toolUseId === toolUseId);

    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatTodoSegment;
      segments[idx] = {
        ...seg,
        isComplete: true,
      };
      lastMsg.segments = segments;
      updated[lastIdx] = lastMsg;
    }

    return updated;
  });
}

/**
 * Add a compaction segment (shows summarization in progress).
 */
function addCompactionSegment(helpers: WorkspaceChatMessageHelpers): void {
  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    // Check if there's already a compaction segment
    const existingIdx = segments.findIndex((s) => s.kind === 'compaction');
    if (existingIdx >= 0) {
      // Already exists, don't add another
      return prev;
    }

    segments.push({
      kind: 'compaction',
      status: 'summarizing',
    });

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Update the compaction segment with metadata from compact_boundary.
 */
function updateCompactionMetadata(
  helpers: WorkspaceChatMessageHelpers,
  metadata: { preTokens?: number; trigger?: 'auto' | 'manual' },
): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex((s) => s.kind === 'compaction');
    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatCompactionSegment;
      segments[idx] = {
        ...seg,
        preTokens: metadata.preTokens,
        trigger: metadata.trigger,
      };
      lastMsg.segments = segments;
      updated[lastIdx] = lastMsg;
    }

    return updated;
  });
}

/**
 * Complete the compaction segment with the summary text.
 */
function completeCompaction(helpers: WorkspaceChatMessageHelpers, summary: string): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex((s) => s.kind === 'compaction');
    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatCompactionSegment;
      segments[idx] = {
        ...seg,
        status: 'complete',
        summary,
      };
      lastMsg.segments = segments;
      updated[lastIdx] = lastMsg;
    }

    return updated;
  });
}

/**
 * Add a generic tool card segment (fallback for unknown tools).
 */
function addToolCard(helpers: WorkspaceChatMessageHelpers, toolUseId: string, toolName: string, input: unknown): void {
  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    segments.push({
      kind: 'tool_card',
      toolUseId,
      toolName,
      label: toolName,
      input,
      steps: [`Using ${toolName}`],
      isLoading: true,
    });

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });
}

/**
 * Complete a generic tool card.
 */
function completeToolCard(
  helpers: WorkspaceChatMessageHelpers,
  toolUseId: string,
  result: unknown,
  isError = false,
): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex(
      (s) => s.kind === 'tool_card' && (s as WorkspaceChatToolCardSegment).toolUseId === toolUseId,
    );

    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatToolCardSegment;
      segments[idx] = {
        ...seg,
        result,
        isLoading: false,
        isError,
      };
      lastMsg.segments = segments;
      updated[lastIdx] = lastMsg;
    }

    return updated;
  });
}

// ============================================================
// Content Block Handlers
// ============================================================

/**
 * Handle a tool_use content block.
 */
function handleToolUseBlock(
  block: SDKToolUseBlock,
  parentToolUseId: string | null,
  context: SDKEventContext,
  helpers: WorkspaceChatMessageHelpers,
): void {
  const { id, name, input } = block;

  // Skip if tool already tracked (e.g., via StreamEvent real-time handling)
  // This prevents duplicate tool indicators
  if (context.toolUseMap.has(id)) {
    // Update the input in case it was partial before
    const existing = context.toolUseMap.get(id)!;
    context.toolUseMap.set(id, { ...existing, input });
    return;
  }

  // Track tool for result matching
  context.toolUseMap.set(id, { name, input, parentToolUseId });

  // Special card tools
  if (name === 'Task') {
    addSubagentSegment(helpers, id, input);
    return;
  }

  if (name === 'TodoWrite') {
    addTodoSegment(helpers, id, input);
    return;
  }

  // Skip hidden tools
  if (HIDDEN_ITEMS.has(name)) {
    return;
  }

  // Plumbing tools - show as subtle thinking
  if (PLUMBING_TOOLS.has(name)) {
    // Could show a subtle "searching..." but for now just skip
    return;
  }

  // Inline tools - minimal indicator
  if (INLINE_TOOLS.has(name)) {
    const { text, filePath } = getInlineToolDisplay(name, input);
    addInlineToolSegment(helpers, id, name, text, filePath);
    return;
  }

  // Fallback: generic tool card for unknown/special tools (Skill, AskUserQuestion, etc.)
  addToolCard(helpers, id, name, input);
}

/**
 * Handle a tool_result content block.
 */
function handleToolResultBlock(
  block: SDKToolResultBlock,
  context: SDKEventContext,
  helpers: WorkspaceChatMessageHelpers,
): void {
  const { tool_use_id, is_error } = block;

  // Skip if already processed
  if (context.completedTools.has(tool_use_id)) {
    return;
  }
  context.completedTools.add(tool_use_id);

  // Find the original tool
  const toolInfo = context.toolUseMap.get(tool_use_id);
  if (!toolInfo) {
    return;
  }

  const { name } = toolInfo;

  // Complete the appropriate segment type
  if (name === 'Task') {
    completeSubagent(helpers, tool_use_id);
    return;
  }

  if (name === 'TodoWrite') {
    completeTodo(helpers, tool_use_id);
    return;
  }

  if (INLINE_TOOLS.has(name)) {
    completeInlineTool(helpers, tool_use_id, is_error);
    return;
  }

  // Generic tool card
  if (!PLUMBING_TOOLS.has(name) && !HIDDEN_ITEMS.has(name)) {
    completeToolCard(helpers, tool_use_id, block.content, is_error);
  }
}

// ============================================================
// Event Type Handlers
// ============================================================

/**
 * Handle SDK system event.
 */
function handleSystemEvent(
  event: SDKSystemEvent,
  context: SDKEventContext,
  helpers: WorkspaceChatMessageHelpers,
): void {
  if (event.subtype === 'init' && event.data?.session_id) {
    context.sessionId = event.data.session_id as string;
  }

  // Handle compaction status event (start of summarization)
  if (isCompactionStatusEvent(event)) {
    context.isCompacting = true;
    addCompactionSegment(helpers);
    return;
  }

  // Handle compact_boundary event (compaction metadata + flag for summary)
  if (isCompactBoundaryEvent(event)) {
    const data = event.data as { compact_metadata?: { pre_tokens?: number; trigger?: string } } | undefined;
    const metadata = data?.compact_metadata;
    if (metadata) {
      context.compactionMetadata = {
        preTokens: metadata.pre_tokens,
        trigger: metadata.trigger as 'auto' | 'manual' | undefined,
      };
      updateCompactionMetadata(helpers, context.compactionMetadata);
    }
    // Set flag to capture the next user message as the summary
    context.isAwaitingCompactionSummary = true;
    return;
  }

  // Handle status cleared event (compaction complete, but we wait for the summary user message)
  if (event.subtype === 'status' && event.data?.status === null && context.isCompacting) {
    // Compaction is done, but we'll complete the segment when we receive the summary
    return;
  }

  // Set status to streaming on init
  helpers.setButtonStatus('streaming');
}

/**
 * Handle SDK assistant event.
 */
function handleAssistantEvent(
  event: SDKAssistantEvent,
  context: SDKEventContext,
  helpers: WorkspaceChatMessageHelpers,
): void {
  const messageId = event.message.id;
  const content = event.message.content;

  // Track current message
  context.currentMessageId = messageId;

  // Get previously processed block count for this message
  const previousBlockCount = context.processedBlockIndices.get(messageId) || 0;

  // Process only new content blocks (for partial message handling)
  for (let i = previousBlockCount; i < content.length; i++) {
    const block = content[i];

    if (isSDKTextBlock(block)) {
      // Skip text if already streamed via StreamEvent (prevents duplicates)
      if (context.skipTextFromAssistant) {
        continue;
      }
      // For text, we append (SDK sends complete text in each event)
      const prevBlock = previousBlockCount > 0 ? content[previousBlockCount - 1] : undefined;
      if (i === previousBlockCount && previousBlockCount === 0) {
        // First text block
        appendTextSegment(helpers, block.text);
      } else if (prevBlock && isSDKTextBlock(prevBlock)) {
        // Continuation of text - replace with updated text
        replaceTextSegment(helpers, block.text);
      } else {
        // New text block after other content
        appendTextSegment(helpers, block.text);
      }
    } else if (isSDKThinkingBlock(block)) {
      if (!HIDDEN_ITEMS.has('redacted_thinking')) {
        updateThinkingSegment(helpers, block.thinking);
      }
    } else if (isSDKToolUseBlock(block)) {
      handleToolUseBlock(block, event.parent_tool_use_id, context, helpers);
    } else if (isSDKToolResultBlock(block)) {
      handleToolResultBlock(block, context, helpers);
    }
  }

  // Update processed block count
  context.processedBlockIndices.set(messageId, content.length);
}

/**
 * Handle SDK result event (end of turn).
 */
function handleResultEvent(
  event: SDKResultEvent,
  context: SDKEventContext,
  helpers: WorkspaceChatMessageHelpers,
): void {
  // Finalize all segments
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };

    // Clear streaming status
    delete lastMsg.status;

    // Finalize text segments
    if (lastMsg.segments) {
      lastMsg.segments = lastMsg.segments.map((seg) => {
        if (seg.kind === 'text') {
          return { ...seg, finalized: true };
        }
        if (seg.kind === 'inline_tool' && !(seg as WorkspaceChatInlineToolSegment).isComplete) {
          return { ...seg, isComplete: true };
        }
        if (seg.kind === 'subagent' && !(seg as WorkspaceChatSubagentSegment).isComplete) {
          return { ...seg, isComplete: true };
        }
        if (seg.kind === 'todo' && !(seg as WorkspaceChatTodoSegment).isComplete) {
          return { ...seg, isComplete: true };
        }
        if (seg.kind === 'tool_card' && (seg as WorkspaceChatToolCardSegment).isLoading) {
          return { ...seg, isLoading: false };
        }
        return seg;
      });
    }

    updated[lastIdx] = lastMsg;
    return updated;
  });

  helpers.setButtonStatus('idle');
}

/**
 * Handle SDK error event.
 */
function handleErrorEvent(event: SDKErrorEvent, _context: SDKEventContext, helpers: WorkspaceChatMessageHelpers): void {
  console.error('[WorkspaceChatSDK] Error:', event.error, event.detail);

  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };

    delete lastMsg.status;

    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];
    segments.push({
      kind: 'text',
      text: `\n\n**Error:** ${event.error}`,
      finalized: true,
    });

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });

  helpers.setButtonStatus('idle');
}

// ============================================================
// Main Event Processor
// ============================================================

/**
 * Process a single SDK event.
 *
 * Routes the event to the appropriate handler based on type.
 */
export function processSDKEvent(event: SDKEvent, context: SDKEventContext, helpers: WorkspaceChatMessageHelpers): void {
  // Route subagent events to their container
  if (isSubagentEvent(event)) {
    const parentId = event.parent_tool_use_id!;
    addSubagentEvent(helpers, parentId, event);

    // Track in context for potential future use
    if (!context.subagentEvents.has(parentId)) {
      context.subagentEvents.set(parentId, []);
    }
    context.subagentEvents.get(parentId)!.push(event);
    return;
  }

  // Handle user events - check if this is a compaction summary
  if (isSDKUserEvent(event) && context.isAwaitingCompactionSummary) {
    // Extract summary text from user message
    const userEvent = event as SDKUserEvent;
    const content = userEvent.message?.content;
    let summaryText = '';

    if (typeof content === 'string') {
      summaryText = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text') {
          summaryText += (block as { text?: string }).text || '';
        }
      }
    }

    if (summaryText) {
      completeCompaction(helpers, summaryText);
    }

    // Reset compaction flags
    context.isAwaitingCompactionSummary = false;
    context.isCompacting = false;
    context.compactionMetadata = undefined;

    // Skip creating a user message bubble - this is an injected summary, not user input
    return;
  }

  // Main agent events
  if (isSDKSystemEvent(event)) {
    handleSystemEvent(event, context, helpers);
  } else if (isSDKAssistantEvent(event)) {
    handleAssistantEvent(event, context, helpers);
  } else if (isSDKResultEvent(event)) {
    handleResultEvent(event, context, helpers);
  } else if (isSDKErrorEvent(event)) {
    handleErrorEvent(event, context, helpers);
  }
  // user events typically just contain the original prompt, no UI update needed
}

/**
 * Handle stream completion.
 */
export function handleSDKStreamComplete(context: SDKEventContext, helpers: WorkspaceChatMessageHelpers): void {
  // Mark any remaining incomplete segments as complete
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };

    delete lastMsg.status;

    if (lastMsg.segments) {
      lastMsg.segments = lastMsg.segments.map((seg) => {
        if (seg.kind === 'text') {
          return { ...seg, finalized: true };
        }
        if (seg.kind === 'inline_tool' && !(seg as WorkspaceChatInlineToolSegment).isComplete) {
          return { ...seg, isComplete: true };
        }
        if (seg.kind === 'subagent' && !(seg as WorkspaceChatSubagentSegment).isComplete) {
          return { ...seg, isComplete: true };
        }
        if (seg.kind === 'todo' && !(seg as WorkspaceChatTodoSegment).isComplete) {
          return { ...seg, isComplete: true };
        }
        if (seg.kind === 'tool_card' && (seg as WorkspaceChatToolCardSegment).isLoading) {
          return { ...seg, isLoading: false };
        }
        return seg;
      });
    }

    updated[lastIdx] = lastMsg;
    return updated;
  });

  helpers.setButtonStatus('idle');
  resetSDKEventContext(context);
}

/**
 * Handle stream error.
 */
export function handleSDKStreamError(
  error: Error,
  _context: SDKEventContext,
  helpers: WorkspaceChatMessageHelpers,
): void {
  console.error('[WorkspaceChatSDK] Stream error:', error);

  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };

    delete lastMsg.status;

    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];
    segments.push({
      kind: 'text',
      text: `\n\n**Error:** ${error.message}`,
      finalized: true,
    });

    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  });

  helpers.setButtonStatus('idle');
}

// ============================================================
// Raw Trace Parsing (for loading conversation history)
// ============================================================

/**
 * Parse raw trace NDJSON content into WorkspaceChatMessages.
 *
 * This reuses the same segment creation logic as live streaming,
 * ensuring consistent rendering between live and loaded conversations.
 */
export function parseRawTraceToMessages(traceContent: string): WorkspaceChatMessage[] {
  const messages: WorkspaceChatMessage[] = [];
  const context = createSDKEventContext();

  // Track tool results for matching
  const toolResults = new Map<string, { content: unknown; isError: boolean }>();

  // Track subagent events by their Task tool_use_id
  // Since the trace format doesn't include parent_tool_use_id, we detect subagent
  // boundaries by tracking when we're "inside" a Task tool call
  const subagentEvents = new Map<string, SDKEvent[]>();

  // First pass: parse all events and collect tool results
  const lines = traceContent.split('\n').filter((line) => line.trim());
  const events: SDKEvent[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as SDKEvent;
      events.push(event);

      // Collect tool results from user messages
      if (event.type === 'user') {
        const userEvent = event as { message?: { content?: unknown[] }; content?: unknown[] };
        const content = userEvent.message?.content ?? userEvent.content ?? [];
        for (const block of content) {
          if (typeof block === 'object' && block !== null && (block as { type?: string }).type === 'tool_result') {
            const resultBlock = block as { tool_use_id?: string; content?: unknown; is_error?: boolean };
            if (resultBlock.tool_use_id) {
              toolResults.set(resultBlock.tool_use_id, {
                content: resultBlock.content,
                isError: resultBlock.is_error || false,
              });
            }
          }
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  // Second pass: collect subagent events using parent_tool_use_id
  // With the SDK migration, events now have parent_tool_use_id set by the backend
  // This is much simpler than the old inference-based approach

  // First, find all Task tool IDs so we can initialize their event arrays
  for (const event of events) {
    if (event.type === 'assistant') {
      const assistantEvent = event as SDKAssistantEvent;
      const content =
        assistantEvent.message?.content ?? (assistantEvent as unknown as { content?: SDKContentBlock[] }).content ?? [];
      for (const block of content as SDKContentBlock[]) {
        if (isSDKToolUseBlock(block) && block.name === 'Task') {
          if (!subagentEvents.has(block.id)) {
            subagentEvents.set(block.id, []);
          }
        }
      }
    }
  }

  // Then collect events into their parent Task using parent_tool_use_id
  for (const event of events) {
    if (isSubagentEvent(event)) {
      const parentId = event.parent_tool_use_id!;
      if (!subagentEvents.has(parentId)) {
        subagentEvents.set(parentId, []);
      }
      subagentEvents.get(parentId)!.push(event);
    }
  }

  // Track Skill tool IDs for skipping injected user messages
  const activeSkillIds = new Set<string>();

  // Track pending attachments from 'attachments' events
  // These get added to the next user message
  let pendingAttachments: Array<{ filename: string; path: string; size: number }> = [];

  // Track pending assistant advice from 'assistant_advice' events
  // This gets added to the next assistant message
  let pendingAdvice: string | null = null;

  // Track compaction state for trace replay
  let isAwaitingCompactionSummary = false;
  let compactionMetadata: { preTokens?: number; trigger?: 'auto' | 'manual' } | null = null;

  // Third pass: build messages
  // Track which assistant message IDs we've processed (to handle duplicate partials)
  const seenMessageIds = new Set<string>();
  let currentAssistantMessage: WorkspaceChatMessage | null = null;

  // Build messages - skip subagent events (they're collected separately)
  for (const event of events) {
    // Skip subagent events - they have parent_tool_use_id set
    if (isSubagentEvent(event)) {
      continue;
    }

    // Track Skill tool usage to skip injected user messages
    if (event.type === 'assistant') {
      const assistantEvent = event as SDKAssistantEvent;
      const content =
        assistantEvent.message?.content ?? (assistantEvent as unknown as { content?: SDKContentBlock[] }).content ?? [];
      for (const block of content as SDKContentBlock[]) {
        if (isSDKToolUseBlock(block) && block.name === 'Skill') {
          activeSkillIds.add(block.id);
        }
      }
    }

    // Check if we're inside a Skill execution (skip injected user messages)
    const isInsideSkill = activeSkillIds.size > 0;
    const isSkillToolUseEvent =
      event.type === 'assistant' &&
      ((event as SDKAssistantEvent).message?.content ?? []).some(
        (b: SDKContentBlock) => isSDKToolUseBlock(b) && b.name === 'Skill',
      );

    // Exit Skill context on next assistant message (that doesn't start a new Skill)
    if (isInsideSkill && event.type === 'assistant' && !isSkillToolUseEvent) {
      activeSkillIds.clear();
    }

    // Skip ALL user messages while inside Skill execution
    // This includes both the tool_result AND the injected skill documentation
    if (isInsideSkill && event.type === 'user') {
      continue;
    }

    // Handle system events - process compaction events, skip others
    if (event.type === 'system') {
      const systemEvent = event as SDKSystemEvent;

      // Handle compaction status event (start of summarization)
      if (isCompactionStatusEvent(event)) {
        // Ensure we have an assistant message to add the compaction segment to
        if (!currentAssistantMessage) {
          currentAssistantMessage = {
            role: 'assistant',
            content: '',
            segments: [],
          };
        }

        // Add compaction segment (will be updated when we find the summary)
        currentAssistantMessage.segments!.push({
          kind: 'compaction',
          status: 'summarizing',
        });
        continue;
      }

      // Handle compact_boundary event (metadata + flag to capture summary)
      if (isCompactBoundaryEvent(event)) {
        const data = systemEvent.data as { compact_metadata?: { pre_tokens?: number; trigger?: string } } | undefined;
        const metadata = data?.compact_metadata;
        if (metadata) {
          compactionMetadata = {
            preTokens: metadata.pre_tokens,
            trigger: metadata.trigger as 'auto' | 'manual' | undefined,
          };

          // Update the compaction segment with metadata
          if (currentAssistantMessage?.segments) {
            const compactionIdx = currentAssistantMessage.segments.findIndex((s) => s.kind === 'compaction');
            if (compactionIdx >= 0) {
              const seg = currentAssistantMessage.segments[compactionIdx] as WorkspaceChatCompactionSegment;
              currentAssistantMessage.segments[compactionIdx] = {
                ...seg,
                preTokens: compactionMetadata.preTokens,
                trigger: compactionMetadata.trigger,
              };
            }
          }
        }
        isAwaitingCompactionSummary = true;
        continue;
      }

      // Skip other system events
      continue;
    }

    // Skip result events
    if (event.type === 'result') {
      continue;
    }

    // Handle attachments events - store for next user message
    if (event.type === 'attachments') {
      const attachmentsEvent = event as { files?: Array<{ filename: string; path: string; size: number }> };
      if (attachmentsEvent.files) {
        pendingAttachments = attachmentsEvent.files;
      }
      continue;
    }

    // Handle assistant_advice events - store for next assistant message
    if (event.type === 'assistant_advice') {
      const adviceEvent = event as { content?: string };
      if (adviceEvent.content) {
        pendingAdvice = adviceEvent.content;
      }
      continue;
    }

    // Handle user messages
    if (event.type === 'user') {
      const userEvent = event as { message?: { content?: unknown[] | string }; content?: unknown[] | string };
      const content = userEvent.message?.content ?? userEvent.content;

      // Check if this is a tool_result message (skip it, don't break assistant grouping)
      if (Array.isArray(content)) {
        const hasOnlyToolResults = content.every(
          (c) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'tool_result',
        );
        if (hasOnlyToolResults) continue; // Skip tool result messages
      }

      // Extract text from user message
      let userText = '';
      if (typeof content === 'string') {
        userText = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text') {
            userText += (block as { text?: string }).text || '';
          } else if (typeof block === 'string') {
            userText += block;
          }
        }
      }

      // Check if this is a compaction summary (injected by SDK after compact_boundary)
      if (isAwaitingCompactionSummary && userText.trim()) {
        // Update the compaction segment with the summary
        if (currentAssistantMessage?.segments) {
          const compactionIdx = currentAssistantMessage.segments.findIndex((s) => s.kind === 'compaction');
          if (compactionIdx >= 0) {
            const seg = currentAssistantMessage.segments[compactionIdx] as WorkspaceChatCompactionSegment;
            currentAssistantMessage.segments[compactionIdx] = {
              ...seg,
              status: 'complete',
              summary: userText.trim(),
            };
          }
        }
        // Reset compaction flags
        isAwaitingCompactionSummary = false;
        compactionMetadata = null;
        // Skip creating a user message bubble - this is an injected summary
        continue;
      }

      if (userText.trim()) {
        // Finalize any pending assistant message before user message
        if (currentAssistantMessage) {
          messages.push(currentAssistantMessage);
          currentAssistantMessage = null;
        }

        // Build segments for user message
        const userSegments: WorkspaceChatSegment[] = [];

        // Add attachment segments first (from pending attachments event)
        if (pendingAttachments.length > 0) {
          // Group attachments by folder for display
          const folderMap = new Map<string, Array<{ filename: string; path: string; size: number }>>();
          const rootFiles: Array<{ filename: string; path: string; size: number }> = [];

          for (const file of pendingAttachments) {
            const relativePath = file.path.replace(/^uploads\//, '');
            const lastSlash = relativePath.lastIndexOf('/');
            if (lastSlash === -1) {
              rootFiles.push(file);
            } else {
              const topFolder = relativePath.split('/')[0];
              if (!folderMap.has(topFolder)) {
                folderMap.set(topFolder, []);
              }
              folderMap.get(topFolder)!.push(file);
            }
          }

          // Add individual file segments
          for (const file of rootFiles) {
            userSegments.push({
              kind: 'file_attachment',
              filename: file.filename,
              path: file.path,
              size: file.size,
            } as WorkspaceChatFileAttachmentSegment);
          }

          // Add folder segments
          for (const [folderName, files] of folderMap) {
            userSegments.push({
              kind: 'folder_attachment',
              folderName,
              folderPath: folderName,
              fileCount: files.length,
              totalSize: files.reduce((sum, f) => sum + f.size, 0),
            } as WorkspaceChatFolderAttachmentSegment);
          }

          // Clear pending attachments after use
          pendingAttachments = [];
        }

        // Add text segment
        userSegments.push({ kind: 'text', text: userText.trim(), finalized: true });

        messages.push({
          role: 'user',
          content: userText.trim(),
          segments: userSegments,
        });

        // Reset seen message IDs for next assistant turn
        seenMessageIds.clear();
      }
      continue;
    }

    // Handle assistant messages - group all consecutive ones together
    if (event.type === 'assistant') {
      // Handle both streaming format (event.message.id) and trace format (event.id or generate one)
      const eventWithMessage = event as { message?: { id?: string }; id?: string };
      const msgId = eventWithMessage.message?.id ?? eventWithMessage.id ?? `assistant-${Date.now()}`;

      // Skip if we've already processed this exact message ID (duplicate partial)
      if (seenMessageIds.has(msgId)) {
        // Still process content - later partials may have more complete data
        if (currentAssistantMessage) {
          processAssistantContent(event, context, currentAssistantMessage, toolResults, subagentEvents);
        }
        continue;
      }

      seenMessageIds.add(msgId);

      // Create assistant message if we don't have one for this turn
      if (!currentAssistantMessage) {
        currentAssistantMessage = {
          role: 'assistant',
          content: '',
          segments: [],
        };

        // Add pending assistant advice as first segment
        if (pendingAdvice) {
          currentAssistantMessage.segments.push({
            kind: 'assistant_advice',
            text: pendingAdvice,
            collapsed: true,
          });
          pendingAdvice = null; // Clear after use
        }
      }

      // Add content to current assistant message (grouping consecutive assistant events)
      processAssistantContent(event, context, currentAssistantMessage, toolResults, subagentEvents);
    }
  }

  // Push final assistant message
  if (currentAssistantMessage) {
    messages.push(currentAssistantMessage);
  }

  // Finalize all segments, strip document markers, and extract document metadata
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.segments) {
      // Collect raw text from all text segments for document extraction
      const rawText = msg.segments
        .filter((s): s is WorkspaceChatTextSegment => s.kind === 'text')
        .map((s) => s.text)
        .join('');

      // Extract document if present and attach to message
      if (rawText) {
        const docBlock = extractSingleDocBlock(rawText);
        if (docBlock) {
          msg.docTitle = docBlock.docTitle;
          msg.docContent = docBlock.docContent;
        }
      }

      // Strip document markers from text segments for display
      // Also filter out transient tools (they don't need to show in history)
      msg.segments = msg.segments
        .filter((seg) => {
          // Remove transient inline tools from history
          if (seg.kind === 'inline_tool' && (seg as WorkspaceChatInlineToolSegment).category === 'transient') {
            return false;
          }
          return true;
        })
        .map((seg) => {
          if (seg.kind === 'text') {
            const docStripState = createDocStripState();
            const strippedText = parseChunkWithoutDocComments(seg.text, docStripState);
            return { ...seg, text: strippedText, finalized: true };
          }
          if (seg.kind === 'inline_tool') {
            return { ...seg, isComplete: true };
          }
          if (seg.kind === 'subagent') {
            return { ...seg, isComplete: true };
          }
          if (seg.kind === 'todo') {
            return { ...seg, isComplete: true };
          }
          if (seg.kind === 'tool_card') {
            return { ...seg, isLoading: false };
          }
          return seg;
        });

      // Update content to match stripped text
      msg.content = msg.segments
        .filter((s): s is WorkspaceChatTextSegment => s.kind === 'text')
        .map((s) => s.text)
        .join('');
    } else if (msg.segments) {
      // Non-assistant messages: just finalize segments
      msg.segments = msg.segments.map((seg) => {
        if (seg.kind === 'text') {
          return { ...seg, finalized: true };
        }
        return seg;
      });
    }
  }

  return messages;
}

/**
 * Process assistant message content into segments.
 * Handles both streaming format (event.message.content) and trace format (event.content).
 */
function processAssistantContent(
  event: SDKAssistantEvent | Record<string, unknown>,
  context: SDKEventContext,
  message: WorkspaceChatMessage,
  toolResults: Map<string, { content: unknown; isError: boolean }>,
  subagentEvents: Map<string, SDKEvent[]>,
): void {
  // Handle both streaming format (event.message.content) and trace format (event.content)
  const eventMessage = (event as SDKAssistantEvent).message;
  const directContent = (event as Record<string, unknown>).content as SDKContentBlock[] | undefined;
  const content = eventMessage?.content ?? directContent ?? [];
  const segments = message.segments as WorkspaceChatSegment[];

  for (const block of content) {
    if (isSDKTextBlock(block)) {
      // Check if we already have this text
      const existingTextIdx = segments.findIndex(
        (s) => s.kind === 'text' && (s as WorkspaceChatTextSegment).text === block.text,
      );
      if (existingTextIdx === -1 && block.text.trim()) {
        segments.push({
          kind: 'text',
          text: block.text,
          finalized: true,
        });
        message.content += block.text;
      }
    } else if (isSDKThinkingBlock(block)) {
      // Check if we already have thinking
      const existingThinking = segments.find((s) => s.kind === 'thinking');
      if (!existingThinking && block.thinking.trim()) {
        segments.unshift({
          kind: 'thinking',
          text: block.thinking,
          collapsed: true,
        });
      }
    } else if (isSDKToolUseBlock(block)) {
      // Skip if already tracked
      if (context.toolUseMap.has(block.id)) {
        continue;
      }

      const parentToolUseId = (event as SDKAssistantEvent).parent_tool_use_id;
      context.toolUseMap.set(block.id, {
        name: block.name,
        input: block.input,
        parentToolUseId,
      });

      const toolName = block.name;
      const input = block.input as Record<string, unknown>;
      const result = toolResults.get(block.id);

      // Task tool -> subagent segment (include collected subagent events)
      if (toolName === 'Task') {
        const taskInput = input as unknown as TaskInput;
        const collectedEvents = subagentEvents.get(block.id) || [];
        segments.push({
          kind: 'subagent',
          parentToolUseId: block.id,
          taskDescription: taskInput.description || `Running ${taskInput.subagent_type || 'task'}`,
          subagentType: taskInput.subagent_type || 'task',
          events: collectedEvents,
          collapsed: true,
          isComplete: true,
        });
        continue;
      }

      // TodoWrite -> todo segment
      if (toolName === 'TodoWrite') {
        const todoInput = input as unknown as TodoWriteInput;
        segments.push({
          kind: 'todo',
          toolUseId: block.id,
          items: (todoInput.todos || []).map((item) => ({
            content: item.content,
            status: item.status,
            activeForm: item.activeForm,
          })),
          isComplete: true,
        });
        continue;
      }

      // Inline tools
      if (INLINE_TOOLS.has(toolName)) {
        const { text, filePath } = getInlineToolDisplay(toolName, input);
        const { category, iconName } = getToolCategoryAndIcon(toolName, input);

        // Skip transient tools in history (they've done their job)
        if (category === 'transient') {
          continue;
        }

        segments.push({
          kind: 'inline_tool',
          toolUseId: block.id,
          toolName,
          displayText: text,
          filePath,
          isComplete: true,
          isError: result?.isError || false,
          category,
          iconName,
        });
        continue;
      }

      // Fallback: tool card for other tools
      segments.push({
        kind: 'tool_card',
        toolUseId: block.id,
        toolName,
        label: toolName,
        input,
        steps: [`Using ${toolName}`],
        result: result?.content,
        isLoading: false,
        isError: result?.isError || false,
      });
    }
  }
}

// ============================================================
// Legacy exports for backwards compatibility during migration
// ============================================================

// Re-export old names pointing to new implementations
export { createSDKEventContext as createEventContext };
export { resetSDKEventContext as resetEventContext };
export { processSDKEvent as processWorkspaceChatEvent };
export { handleSDKStreamComplete as handleStreamComplete };
export { handleSDKStreamError as handleStreamError };
