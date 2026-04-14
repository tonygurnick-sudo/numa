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
  WorkspaceChatInlineToolSegment,
  WorkspaceChatSubagentSegment,
  WorkspaceChatTodoSegment,
  WorkspaceChatToolCardSegment,
  WorkspaceChatFileAttachmentSegment,
  WorkspaceChatFolderAttachmentSegment,
  WorkspaceChatCompactionSegment,
  WorkspaceChatMessageHelpers,
  SDKToolApprovalEvent,
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
  ExecuteScriptInput,
} from '@/types/workspaceChatTypes';

// Document processing utilities
import { parseChunkWithoutDocComments, extractSingleDocBlock, createDocStripState } from './streamingProcessors';
import { resolveToolVisual, getToolActionSteps, resolveToolDescriptor } from './ToolConfig';

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
  isCompactionStatusEvent,
  isCompactBoundaryEvent,
} from '@/types/workspaceChatTypes';

// ============================================================
// Tool Categorization
// ============================================================

/** Tools that show as inline indicators (minimal UI) */
const INLINE_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'WebSearch',
  'WebFetch',
  'Bash',
  'Glob',
  'Grep',
  'Skill',
  'mcp__scripts__execute_script',
  'TaskOutput',
]);

/** Tools that are internal plumbing (hidden from UI) - kept for future use */
const PLUMBING_TOOLS = new Set<string>();

/** Thinking-related items to hide */
const HIDDEN_ITEMS = new Set(['redacted_thinking']);

/** Tools that get special card treatment - kept for future use */
const _SPECIAL_CARD_TOOLS = new Set(['Task', 'TodoWrite', 'AskUserQuestion']);

// ============================================================
// Tool Display Categorization (Transient vs Important vs Default)
// ============================================================

/** Transient tools - fade out after completion (file system exploration, internal plumbing) */
const TRANSIENT_TOOLS = new Set(['Glob', 'Grep', 'Read', 'TaskOutput']);

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
  // Script execution (MCP tool)
  ['mcp__scripts__execute_script', { icon: 'bi-terminal', name: 'Running script' }],
  // Numa Ops tool
  ['mcp__numa__numa_ops_tool', { icon: 'bi-card-checklist', name: 'Numa Ops' }],
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
 * Check if Bash command is a memory management command.
 */
function isBashMemoryCommand(cmd: string): boolean {
  return cmd.includes('numa-memories.py');
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
  input: unknown
): { category: ToolCategory; iconName?: string } {
  // Handle Skill tool - check skill name for icon
  if (toolName === 'Skill') {
    const skillInput = input as SkillInput | undefined;
    const skillName = skillInput?.skill || '';
    // Extract just the skill name from "numa-workspace:knowledge-search" format
    const shortName = skillName.includes(':') ? skillName.split(':').pop() || skillName : skillName;
    return { category: 'transient', iconName: getSkillIcon(shortName) };
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
    if (isBashMemoryCommand(cmd)) {
      return { category: 'important', iconName: 'bi-lightbulb' };
    }
    if (isBashTransient(cmd)) {
      return { category: 'transient' };
    }
    return { category: 'default' };
  }

  // Numa MCP tool: pick icon based on sub-tool name
  if (toolName === 'mcp__numa__numa_tool') {
    const inputObj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const subTool = (inputObj.name as string) || '';
    const NUMA_SUB_TOOL_ICONS: Record<string, string> = {
      knowledge_base: 'bi-folder2-open',
      web_search: 'bi-search',
      extract_content: 'bi-file-earmark-text',
      convert_document: 'bi-file-earmark-arrow-down',
      agents: 'bi-robot',
      memories: 'bi-lightbulb',
      render: 'bi-eye',
    };
    return { category: 'important', iconName: NUMA_SUB_TOOL_ICONS[subTool] || 'bi-tools' };
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
  // Integration MCP tools render as inline indicators with branded icons
  if (INTEGRATION_MCP_TOOLS.has(toolName)) return 'inline_tool';
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
// Integration Tool Label Formatting
// ============================================================

/** MCP integration tool names that should get branded rendering */
export const INTEGRATION_MCP_TOOLS = new Set([
  'mcp__integrations__run_action',
  'mcp__integrations__configure_props',
  'mcp__integrations__proxy_request',
]);

/**
 * Format integration MCP tool calls into branded labels and toolName overrides.
 * Returns null if the tool is not an integration MCP tool.
 */
export function formatIntegrationToolLabel(
  toolName: string,
  input: Record<string, unknown>
): { label: string; actionName: string; description: string; integrationToolName: string } | null {
  if (toolName === 'mcp__integrations__run_action') {
    const actionKey = (input.action_key as string) || '';
    const description = (input.description as string) || '';
    const dashIndex = actionKey.indexOf('-');
    if (dashIndex === -1) return null;
    const appSlug = actionKey.substring(0, dashIndex);
    const actionName = actionKey
      .substring(dashIndex + 1)
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const label = description ? `${actionName}: ${description}` : actionName;
    return { label, actionName, description, integrationToolName: `${appSlug}_integration` };
  }
  if (toolName === 'mcp__integrations__configure_props') {
    const actionKey = (input.action_key as string) || '';
    const propName = (input.prop_name as string) || '';
    const dashIndex = actionKey.indexOf('-');
    const appSlug = dashIndex > -1 ? actionKey.substring(0, dashIndex) : '';
    const label = `Configure: Getting options for ${propName}`;
    return {
      label,
      actionName: 'Configure',
      description: `Getting options for ${propName}`,
      integrationToolName: appSlug ? `${appSlug}_integration` : '',
    };
  }
  if (toolName === 'mcp__integrations__proxy_request') {
    const method = (input.method as string) || 'GET';
    const description = (input.description as string) || '';
    const label = description ? `API Request: ${description}` : `API Request: ${method}`;
    return { label, actionName: 'API Request', description: description || method, integrationToolName: '' };
  }
  return null;
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
      // Friendly labels for known Numa tool commands
      const bashCmd = bashInput.command || '';
      if (bashCmd.includes('numa-memories.py')) {
        if (bashCmd.includes(' add ')) return { text: 'Saving memory — manage in Settings' };
        if (bashCmd.includes(' update ')) return { text: 'Updating memory — manage in Settings' };
        if (bashCmd.includes(' list')) return { text: 'Reading memories — manage in Settings' };
        return { text: 'Managing memories — manage in Settings' };
      }
      // Fallback to truncated command
      const cmd = bashCmd.slice(0, 50);
      return { text: `Running: ${cmd}${cmd.length >= 50 ? '...' : ''}` };
    }
    case 'mcp__scripts__execute_script': {
      const scriptInput = inputObj as ExecuteScriptInput;
      // Use description field if present (human-friendly)
      if (scriptInput.description && typeof scriptInput.description === 'string') {
        return { text: scriptInput.description };
      }
      // Fallback to interpreter + truncated code
      const interpreter = scriptInput.interpreter || 'python3';
      const code = (scriptInput.code || '').slice(0, 30);
      return { text: `Running ${interpreter} script${code ? `: ${code}...` : ''}` };
    }
    case 'TaskOutput':
      // Internal tool for retrieving background task results
      return { text: 'Getting task results...' };
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
    case 'mcp__numa__numa_tool': {
      // Use description field (human-friendly), fall back to sub-tool name
      const numaInput = inputObj as { name?: string; description?: string };
      if (numaInput.description && typeof numaInput.description === 'string') {
        return { text: numaInput.description };
      }
      if (numaInput.name && typeof numaInput.name === 'string') {
        return { text: numaInput.name.replace(/_/g, ' ') };
      }
      return { text: 'Running Numa tool...' };
    }
    case 'mcp__numa__numa_ops_tool': {
      // Use description field (human-friendly), fall back to operation name
      const opsInput = inputObj as { operation?: string; description?: string };
      if (opsInput.description && typeof opsInput.description === 'string') {
        return { text: opsInput.description };
      }
      if (opsInput.operation && typeof opsInput.operation === 'string') {
        return { text: `Ops: ${opsInput.operation.replace(/_/g, ' ')}` };
      }
      return { text: 'Running Numa Ops...' };
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
    case 'tool_card': {
      // Integration MCP tools get a placeholder; real label set in updateSegmentWithInput
      const isIntegration = INTEGRATION_MCP_TOOLS.has(toolName);
      const isNumaTool = toolName === 'mcp__numa__numa_tool';
      return {
        kind: 'tool_card',
        toolUseId,
        toolName,
        label: isIntegration ? 'Integration' : isNumaTool ? 'Numa Tool' : toolName,
        steps: isIntegration ? ['Connecting...'] : isNumaTool ? ['Loading...'] : [`Using ${toolName}`],
        isLoading: true,
      };
    }
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
  input: unknown
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
      // Integration MCP tools get branded display
      if (INTEGRATION_MCP_TOOLS.has(toolName)) {
        const integrationInfo = formatIntegrationToolLabel(toolName, inputObj);
        if (integrationInfo) {
          const visual = resolveToolVisual(integrationInfo.integrationToolName);
          const iconImage = visual.kind === 'image' ? visual.src : undefined;
          const iconName = visual.kind === 'icon' ? visual.className.replace('bi ', '') : undefined;
          return {
            ...segment,
            toolName: integrationInfo.integrationToolName || segment.toolName,
            displayText: integrationInfo.description
              ? `Calling ${integrationInfo.actionName} tool: ${integrationInfo.description}`
              : `Calling ${integrationInfo.actionName} tool`,
            isComplete: false,
            category: 'important' as ToolCategory,
            iconName,
            iconImage,
          };
        }
      }
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
      const inputObj2 = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      const integrationInfo = formatIntegrationToolLabel(toolName, inputObj2);
      if (integrationInfo) {
        return {
          ...segment,
          input,
          toolName: integrationInfo.integrationToolName || segment.toolName,
          label: integrationInfo.label,
          steps: [integrationInfo.label],
        };
      }
      // For mcp__numa__numa_tool, derive label and steps from the sub-tool name
      if (toolName === 'mcp__numa__numa_tool') {
        const subTool = inputObj2.name as string | undefined;
        const label = subTool ? resolveToolDescriptor(subTool).label : segment.toolName;
        return {
          ...segment,
          input,
          label,
          steps: getToolActionSteps(toolName, input),
        };
      }
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
  setButtonStatus: (status: 'idle' | 'loading' | 'streaming') => void
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

    // Find the last non-finalized text segment
    let textSegIdx = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].kind === 'text' && !segments[i].finalized) {
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
 * Add an inline tool segment.
 */
function addInlineToolSegment(
  helpers: WorkspaceChatMessageHelpers,
  toolUseId: string,
  toolName: string,
  displayText: string,
  filePath?: string
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
 * Set the approval decision on an inline tool segment (e.g., 'execution_timeout', 'execution_failed').
 * Walks backwards through messages to find the matching segment.
 */
function setApprovalDecision(
  helpers: WorkspaceChatMessageHelpers,
  toolUseId: string,
  decision: 'approved' | 'denied' | 'timeout' | 'execution_timeout' | 'execution_failed'
): void {
  helpers.setMessages((prev) => {
    const updated = [...prev];
    for (let i = updated.length - 1; i >= 0; i--) {
      const msg = updated[i];
      if (msg.role !== 'assistant' || !msg.segments) continue;
      const segIdx = msg.segments.findIndex(
        (s) => s.kind === 'inline_tool' && (s as WorkspaceChatInlineToolSegment).toolUseId === toolUseId
      );
      if (segIdx >= 0) {
        const newMsg = { ...msg, segments: [...msg.segments] };
        const seg = { ...newMsg.segments[segIdx] } as WorkspaceChatInlineToolSegment;
        if (seg.approval) {
          seg.approval = { ...seg.approval, decision };
        }
        newMsg.segments[segIdx] = seg;
        updated[i] = newMsg;
        return updated;
      }
    }
    return prev;
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
      (s) => s.kind === 'inline_tool' && (s as WorkspaceChatInlineToolSegment).toolUseId === toolUseId
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
      (s) => s.kind === 'subagent' && (s as WorkspaceChatSubagentSegment).parentToolUseId === parentToolUseId
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
      (s) => s.kind === 'subagent' && (s as WorkspaceChatSubagentSegment).parentToolUseId === parentToolUseId
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

    // Mark all todo segments in ALL messages (including current) as complete so they auto-collapse.
    // Both todos can end up in the same message during streaming (placeholder + full input),
    // so we must mark the current message's todos too, not just previous messages.
    for (let i = 0; i <= lastIdx; i++) {
      const msg = updated[i];
      if (!msg.segments) continue;
      const hasTodo = msg.segments.some((s) => s.kind === 'todo' && !(s as WorkspaceChatTodoSegment).isComplete);
      if (hasTodo) {
        updated[i] = {
          ...msg,
          segments: msg.segments.map((s) =>
            s.kind === 'todo' && !(s as WorkspaceChatTodoSegment).isComplete ? { ...s, isComplete: true } : s
          ),
        };
      }
    }

    // Re-read the last message after marking (it may have been updated above)
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    // Find existing todo with the same toolUseId to update, or add a new one
    const existingIdx = segments.findIndex(
      (s) => s.kind === 'todo' && (s as WorkspaceChatTodoSegment).toolUseId === toolUseId
    );
    const newTodo: WorkspaceChatTodoSegment = {
      kind: 'todo',
      toolUseId,
      items: items.map((item) => ({
        content: item.content,
        status: item.status,
        activeForm: item.activeForm,
      })),
      isComplete: false,
    };

    if (existingIdx >= 0) {
      segments[existingIdx] = newTodo;
    } else {
      segments.push(newTodo);
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
  metadata: { preTokens?: number; trigger?: 'auto' | 'manual' }
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
  const inputObj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const integrationInfo = formatIntegrationToolLabel(toolName, inputObj);

  let effectiveToolName = integrationInfo?.integrationToolName || toolName;
  let effectiveLabel = integrationInfo?.label || toolName;
  let effectiveSteps = integrationInfo ? [integrationInfo.label] : [`Using ${toolName}`];

  // For mcp__numa__numa_tool, derive label and steps from the sub-tool name
  if (toolName === 'mcp__numa__numa_tool' && !integrationInfo) {
    const subTool = inputObj.name as string | undefined;
    if (subTool) effectiveLabel = resolveToolDescriptor(subTool).label;
    effectiveSteps = getToolActionSteps(toolName, input);
  }

  // For mcp__numa__numa_ops_tool, derive label and steps from the operation
  if (toolName === 'mcp__numa__numa_ops_tool' && !integrationInfo) {
    effectiveLabel = resolveToolDescriptor(toolName).label;
    effectiveSteps = getToolActionSteps(toolName, input);
  }

  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    segments.push({
      kind: 'tool_card',
      toolUseId,
      toolName: effectiveToolName,
      label: effectiveLabel,
      input,
      steps: effectiveSteps,
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
  isError = false
): void {
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    const idx = segments.findIndex(
      (s) => s.kind === 'tool_card' && (s as WorkspaceChatToolCardSegment).toolUseId === toolUseId
    );

    if (idx >= 0) {
      const seg = segments[idx] as WorkspaceChatToolCardSegment;
      segments[idx] = {
        ...seg,
        result,
        isLoading: false,
        isError,
      };

      // Also mark any approvalOnly inline_tool segment with the same toolUseId
      // as complete so the approval panel cleans up properly.
      const approvalIdx = segments.findIndex(
        (s) =>
          s.kind === 'inline_tool' &&
          (s as WorkspaceChatInlineToolSegment).approvalOnly &&
          (s as WorkspaceChatInlineToolSegment).toolUseId === toolUseId
      );
      if (approvalIdx >= 0) {
        const approvalSeg = { ...segments[approvalIdx] } as WorkspaceChatInlineToolSegment;
        approvalSeg.isComplete = true;
        segments[approvalIdx] = approvalSeg;
      }

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
  helpers: WorkspaceChatMessageHelpers
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

  // When StreamEvents are active (skipTextFromAssistant=true), the StreamEvent
  // handler creates UI segments in real-time via content_block_start events.
  // The assistant SDK event can arrive BEFORE its corresponding StreamEvents,
  // so we must skip segment creation here to avoid duplicates. The tool is
  // already tracked in toolUseMap above for result matching.
  if (context.skipTextFromAssistant) {
    return;
  }

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

  // Integration MCP tools - inline indicator with branded icon
  if (INTEGRATION_MCP_TOOLS.has(name)) {
    const inputObj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const integrationInfo = formatIntegrationToolLabel(name, inputObj);
    if (integrationInfo) {
      const visual = resolveToolVisual(integrationInfo.integrationToolName);
      const iconImage = visual.kind === 'image' ? visual.src : undefined;
      const iconNameVal = visual.kind === 'icon' ? visual.className.replace('bi ', '') : undefined;
      const displayText = integrationInfo.description
        ? `Calling ${integrationInfo.actionName} tool: ${integrationInfo.description}`
        : `Calling ${integrationInfo.actionName} tool`;
      helpers.setMessages((prev) => {
        const updated = ensureAssistantMessage(prev);
        const lastIdx = updated.length - 1;
        const lastMsg = { ...updated[lastIdx] };
        const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];
        segments.push({
          kind: 'inline_tool',
          toolUseId: id,
          toolName: integrationInfo.integrationToolName || name,
          displayText,
          isComplete: false,
          category: 'important' as ToolCategory,
          iconName: iconNameVal,
          iconImage,
        });
        lastMsg.segments = segments;
        updated[lastIdx] = lastMsg;
        return updated;
      });
      return;
    }
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
  helpers: WorkspaceChatMessageHelpers
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

  if (INLINE_TOOLS.has(name) || INTEGRATION_MCP_TOOLS.has(name)) {
    // For integration tools, check if the result indicates an execution_timeout.
    // This happens when the action was approved but the relay call failed/timed out —
    // the action may have already executed on the external system.
    if (INTEGRATION_MCP_TOOLS.has(name) && block.content) {
      try {
        const resultStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        const parsed = JSON.parse(resultStr);
        if (parsed?.status === 'execution_timeout' || parsed?.status === 'execution_failed') {
          setApprovalDecision(helpers, tool_use_id, parsed.status);
        }
      } catch {
        // Not JSON — ignore
      }
    }
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
  helpers: WorkspaceChatMessageHelpers
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
  helpers: WorkspaceChatMessageHelpers
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
  helpers: WorkspaceChatMessageHelpers
): void {
  // Finalize all segments
  helpers.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };

    // Clear streaming status
    delete lastMsg.status;

    // Capture cost/usage from the result event. Always stored;
    // gating happens at render time via DEVELOPER_MODE + user toggle.
    if (event.total_cost_usd != null) lastMsg.costUsd = event.total_cost_usd;
    if (event.num_turns != null) lastMsg.numTurns = event.num_turns;
    if (event.duration_ms != null) lastMsg.durationMs = event.duration_ms;
    if (event.usage) {
      if (event.usage.input_tokens != null) lastMsg.inputTokens = event.usage.input_tokens;
      if (event.usage.output_tokens != null) lastMsg.outputTokens = event.usage.output_tokens;
      if (event.usage.cache_read_input_tokens != null) lastMsg.cacheReadTokens = event.usage.cache_read_input_tokens;
      if (event.usage.cache_creation_input_tokens != null)
        lastMsg.cacheCreationTokens = event.usage.cache_creation_input_tokens;
    }

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
 * Handle a tool_approval event — attaches approval data to the matching inline_tool segment
 * so the approval panel renders inline below the tool indicator.
 *
 * For tool_card segments (e.g., Numa Ops), inserts an approvalOnly inline_tool segment
 * right after the matching tool_card so the approval panel renders below it.
 */
function handleToolApprovalEvent(event: SDKToolApprovalEvent, helpers: WorkspaceChatMessageHelpers): void {
  helpers.setMessages((prev) => {
    const updated = [...prev];
    // Walk backwards to find the assistant message with the matching segment
    for (let i = updated.length - 1; i >= 0; i--) {
      const msg = updated[i];
      if (msg.role !== 'assistant' || !msg.segments) continue;

      // First try: inline_tool segment (integration tools)
      const inlineIdx = msg.segments.findIndex(
        (s) => s.kind === 'inline_tool' && (s as WorkspaceChatInlineToolSegment).toolUseId === event.tool_use_id
      );
      if (inlineIdx >= 0) {
        const newMsg = { ...msg, segments: [...msg.segments] };
        const seg = { ...newMsg.segments[inlineIdx] } as WorkspaceChatInlineToolSegment;
        seg.approval = {
          actionKey: event.action_key,
          description: event.description,
          propsPreview: event.props_preview,
          requestId: event.request_id,
          autoApproved: event.auto_approved,
          createdAt: event.created_at,
        };
        newMsg.segments[inlineIdx] = seg;
        updated[i] = newMsg;
        return updated;
      }

      // Fallback: tool_card segment (Numa Ops write operations) — insert an
      // approvalOnly inline_tool segment right after the matching tool_card.
      const cardIdx = msg.segments.findIndex(
        (s) => s.kind === 'tool_card' && (s as WorkspaceChatToolCardSegment).toolUseId === event.tool_use_id
      );
      if (cardIdx >= 0) {
        const newMsg = { ...msg, segments: [...msg.segments] };
        const approvalSegment: WorkspaceChatInlineToolSegment = {
          kind: 'inline_tool',
          toolUseId: event.tool_use_id,
          toolName: event.tool_name,
          displayText: event.description || event.action_key,
          isComplete: false,
          category: 'important' as ToolCategory,
          iconName: 'bi-card-checklist',
          approvalOnly: true,
          approval: {
            actionKey: event.action_key,
            description: event.description,
            propsPreview: event.props_preview,
            requestId: event.request_id,
            autoApproved: event.auto_approved,
            createdAt: event.created_at,
          },
        };
        newMsg.segments.splice(cardIdx + 1, 0, approvalSegment);
        updated[i] = newMsg;
        return updated;
      }
    }
    return prev;
  });
}

/**
 * Handle a tool_approval event from a sub-agent.
 * Creates an inline_tool segment with approval data so it renders through the same
 * WorkspaceChatInlineTool component used by main-agent approvals (branded icons,
 * countdown timer, styled approve/deny buttons).
 */
function handleSubagentToolApprovalEvent(event: SDKToolApprovalEvent, helpers: WorkspaceChatMessageHelpers): void {
  helpers.setMessages((prev) => {
    const updated = ensureAssistantMessage(prev);
    const lastIdx = updated.length - 1;
    const lastMsg = { ...updated[lastIdx] };
    const segments = [...(lastMsg.segments || [])] as WorkspaceChatSegment[];

    // Build the same branded display as main-agent integration tools
    const inputObj: Record<string, unknown> = {
      action_key: event.action_key,
      description: event.description,
    };
    const integrationInfo = formatIntegrationToolLabel(event.tool_name, inputObj);
    let displayText = event.description || event.action_key;
    let iconImage: string | undefined;
    let iconName: string | undefined;
    let toolName = event.tool_name;

    if (integrationInfo) {
      displayText = integrationInfo.description
        ? `Calling ${integrationInfo.actionName} tool: ${integrationInfo.description}`
        : `Calling ${integrationInfo.actionName} tool`;
      toolName = integrationInfo.integrationToolName || event.tool_name;
      const visual = resolveToolVisual(integrationInfo.integrationToolName);
      iconImage = visual.kind === 'image' ? visual.src : undefined;
      iconName = visual.kind === 'icon' ? visual.className.replace('bi ', '') : undefined;
    }

    const inlineToolSegment: WorkspaceChatInlineToolSegment = {
      kind: 'inline_tool',
      toolUseId: event.tool_use_id,
      toolName,
      displayText,
      isComplete: false,
      category: 'important' as ToolCategory,
      iconName,
      iconImage,
      approvalOnly: true,
      approval: {
        actionKey: event.action_key,
        description: event.description,
        propsPreview: event.props_preview,
        requestId: event.request_id,
        autoApproved: event.auto_approved,
        createdAt: event.created_at,
      },
    };

    segments.push(inlineToolSegment);
    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;

    return updated;
  });
}

/**
 * Process a single SDK event.
 *
 * Routes the event to the appropriate handler based on type.
 */
export function processSDKEvent(event: SDKEvent, context: SDKEventContext, helpers: WorkspaceChatMessageHelpers): void {
  // Tool approval events FIRST — before subagent routing, since approvals
  // need a standalone UI card even when the tool runs inside a subagent.
  if (event.type === 'tool_approval') {
    const approval = event as SDKToolApprovalEvent;
    if (approval.parent_tool_use_id) {
      // Sub-agent approval: create standalone tool_approval segment at message level
      handleSubagentToolApprovalEvent(approval, helpers);
    } else {
      // Main agent approval: attach to existing inline_tool segment
      handleToolApprovalEvent(approval, helpers);
    }
    return;
  }

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
  helpers: WorkspaceChatMessageHelpers
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
        (b: SDKContentBlock) => isSDKToolUseBlock(b) && b.name === 'Skill'
      );

    // Exit Skill context only when we see an assistant message with actual text content
    // (not just another tool_use from the same turn — the trace serializes each content block separately)
    if (isInsideSkill && event.type === 'assistant' && !isSkillToolUseEvent) {
      const assistantContent =
        (event as SDKAssistantEvent).message?.content ??
        (event as unknown as { content?: SDKContentBlock[] }).content ??
        [];
      const hasTextContent = (assistantContent as SDKContentBlock[]).some(
        (b) => b.type === 'text' && (b as { text?: string }).text?.trim()
      );
      if (hasTextContent) {
        activeSkillIds.clear();
      }
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

    // Handle user messages
    if (event.type === 'user') {
      const userEvent = event as { message?: { content?: unknown[] | string }; content?: unknown[] | string };
      const content = userEvent.message?.content ?? userEvent.content;

      // Check if this is a tool_result message (skip it, don't break assistant grouping)
      if (Array.isArray(content)) {
        const hasOnlyToolResults = content.every(
          (c) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'tool_result'
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
  subagentEvents: Map<string, SDKEvent[]>
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
        (s) => s.kind === 'text' && (s as WorkspaceChatTextSegment).text === block.text
      );
      if (existingTextIdx === -1 && block.text.trim()) {
        segments.push({
          kind: 'text',
          text: block.text,
          finalized: true,
        });
        message.content += block.text;
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

      // Integration MCP tools render as inline indicators
      if (INTEGRATION_MCP_TOOLS.has(toolName)) {
        const integrationInfo = formatIntegrationToolLabel(toolName, input);
        if (integrationInfo) {
          const visual = resolveToolVisual(integrationInfo.integrationToolName);
          const iconImage = visual.kind === 'image' ? visual.src : undefined;
          const iconNameVal = visual.kind === 'icon' ? visual.className.replace('bi ', '') : undefined;
          segments.push({
            kind: 'inline_tool',
            toolUseId: block.id,
            toolName: integrationInfo.integrationToolName || toolName,
            displayText: integrationInfo.description
              ? `Calling ${integrationInfo.actionName} tool: ${integrationInfo.description}`
              : `Calling ${integrationInfo.actionName} tool`,
            isComplete: true,
            isError: result?.isError || false,
            category: 'important' as ToolCategory,
            iconName: iconNameVal,
            iconImage,
          });
          continue;
        }
      }

      // Fallback: tool card for other tools
      const integrationInfo = formatIntegrationToolLabel(toolName, input);
      let effectiveToolName = integrationInfo?.integrationToolName || toolName;
      let effectiveLabel = integrationInfo?.label || toolName;
      let effectiveSteps = integrationInfo ? [integrationInfo.label] : [`Using ${toolName}`];

      // For mcp__numa__numa_tool, derive label and steps from the sub-tool name
      if (toolName === 'mcp__numa__numa_tool' && !integrationInfo) {
        const subTool = input?.name as string | undefined;
        if (subTool) effectiveLabel = resolveToolDescriptor(subTool).label;
        effectiveSteps = getToolActionSteps(toolName, input);
      }

      // For mcp__numa__numa_ops_tool, derive label and steps from the operation
      if (toolName === 'mcp__numa__numa_ops_tool' && !integrationInfo) {
        effectiveLabel = resolveToolDescriptor(toolName).label;
        effectiveSteps = getToolActionSteps(toolName, input);
      }

      segments.push({
        kind: 'tool_card',
        toolUseId: block.id,
        toolName: effectiveToolName,
        label: effectiveLabel,
        input,
        steps: effectiveSteps,
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
