/**
 * Tool display metadata — the source of truth for how tools are surfaced in
 * any UI that consumes them.
 *
 *   - Numa CLI uses this for `--help` consistency and debug output.
 *   - Frontend imports this (via `@numa/cli/metadata`) for chat-bubble
 *     labels, icons, inline-vs-card hint, and tool-call descriptions. The
 *     React renderer components stay on the frontend — those are bound to
 *     JSX so can't be runtime-shared with Node — but everything ELSE
 *     about a tool's UI presentation lives here.
 *
 * Adding a new tool:
 *   1. Add param + result interfaces in `tool-types.ts` + extend ToolCall
 *      / ToolResult unions.
 *   2. Add a `ToolDisplayInfo` entry below keyed by the backend tool name.
 *   3. Add the matching i18n key in `numa-frontend/src/locales/<lang>/common.json`
 *      under `toolLabels.*`.
 *   4. Only if the tool has a new result shape the frontend can't already
 *      render — add a React renderer in `numa-frontend/src/toolRenderers/`
 *      and wire it into `ToolConfig.ts`'s `TOOL_RENDERERS` map under the
 *      same `rendererKey`.
 *
 * Zero runtime deps; pure data + pure functions. Safe to import in
 * browser bundles; tree-shakes cleanly.
 */

import type {
  AddToKbParams,
  ConnectRequestParams,
  ConnectRequestResult,
  ConnectStatusParams,
  ConnectStatusResult,
  ConvertDocumentParams,
  ConvertDocumentResult,
  CreateAgentParams,
  CreateAgentResult,
  CreateKbSubfolderParams,
  DeleteAgentParams,
  DeleteAgentResult,
  DeleteKbFileParams,
  DeleteKbSubfolderParams,
  DuplicateAgentParams,
  DuplicateAgentResult,
  ExtractContentParams,
  ExtractContentResult,
  GetAgentParams,
  GetAgentResult,
  ListAgentsParams,
  ListAgentsResult,
  ListKbFilesParams,
  ListKbFilesResult,
  MoveKbFileParams,
  ParamsForTool,
  PatchAgentPromptParams,
  PatchAgentPromptResult,
  PipedreamBatchGetSchemasParams,
  PipedreamBatchGetSchemasResult,
  PipedreamConfigurePropsParams,
  PipedreamConfigurePropsResult,
  PipedreamListActionsParams,
  PipedreamListActionsResult,
  PipedreamProxyRequestParams,
  PipedreamProxyRequestResult,
  PipedreamRunActionParams,
  PipedreamRunActionResult,
  QueryKnowledgebaseParams,
  QueryKnowledgebaseResult,
  RenameKbFileParams,
  RetrieveKbFileParams,
  RetrieveKbFileResult,
  ToolName,
  ToolResult,
  TranscribeParams,
  TranscribeResult,
  UpdateAgentParams,
  UpdateAgentResult,
  UserProfileAddMemoryParams,
  UserProfileAddMemoryResult,
  UserProfileDeleteMemoryParams,
  UserProfileDeleteMemoryResult,
  UserProfileListMemoriesParams,
  UserProfileListMemoriesResult,
  UserProfileUpdateMemoryParams,
  UserProfileUpdateMemoryResult,
  WebSearchParams,
  WebSearchResult,
} from './tool-types.js';

export type ToolCategory =
  | 'files'
  | 'search'
  | 'integrations'
  | 'agents'
  | 'ops'
  | 'memories'
  | 'documents'
  | 'vault'
  | 'meta';

/**
 * Where in the chat the tool's progress and result get drawn.
 *
 *   - 'inline' — minimal chip / indicator that lives within the assistant
 *     message stream (e.g. Read, Write, web fetch). Frontend groups
 *     consecutive inline tools into a connected strip.
 *   - 'card'   — full tool card with header + collapsible body.
 *     Used for tools whose result the user wants to see expanded
 *     (KB query, integrations call, ops list).
 */
export type ToolDisplay = 'inline' | 'card';

/**
 * The metadata entry for a single tool. Generic over the tool name so
 * describeCall/describeResult are properly typed against ParamsForTool<T>
 * and ToolResult<T> — TypeScript catches param-name typos and result-
 * shape drift at compile time.
 */
export interface ToolDisplayInfo<T extends ToolName = ToolName> {
  tool: T;
  /**
   * Frontend renderer-registry key. Defaults to a per-category renderer
   * for files/search/etc.; tools with a unique result shape can use their
   * own key.
   */
  rendererKey: string;
  /** i18n key, resolved at runtime by the frontend via i18next. */
  i18nLabelKey: string;
  /**
   * Plain-English fallback label, used when i18n hasn't loaded or by
   * non-i18n consumers (CLI debug output, logs).
   */
  fallbackLabel: string;
  /** Lucide icon name (https://lucide.dev/icons). */
  icon: string;
  category: ToolCategory;
  /** How the frontend should render this tool. See `ToolDisplay`. */
  display: ToolDisplay;
  /**
   * One-line description from params. Used for the "running" / inline
   * label ("Searching for 'meeting notes'"). Return `null` for "no
   * description, just show the label".
   */
  describeCall?: (params: ParamsForTool<T>) => string | null;
  /**
   * One-line summary from a successful result. Used for the completed
   * tool card's header.
   */
  describeResult?: (result: ToolResult<T>) => string | null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const truncate = (s: string, n = 60): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Strip the `/workdir/` prefix for compact display ("uploads/x.pdf" beats "/workdir/uploads/x.pdf"). */
const workspaceRelative = (path: string): string =>
  path.startsWith('/workdir/') ? path.slice('/workdir/'.length) : path;

/** Human-readable byte size — matches the `size_formatted` convention used by other tools. */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * Best-effort folder label from a tool call's params. Just reads `kb_id` —
 * the Python workspace-chat-tools dispatcher injects an `__allowed_kbs_with_names`
 * array into per-handler params, but consumers of describeCall (frontend
 * + CLI) don't see those `__`-prefixed fields. The frontend has its own
 * `KnowledgeBaseProvider` that resolves kb_id → friendly name and should
 * post-process the output of describeCall to swap UUIDs for names.
 */
const folderLabel = (params: { kb_id?: unknown }): string => {
  return typeof params.kb_id === 'string' ? params.kb_id : '';
};

// ─── registry ───────────────────────────────────────────────────────────────

/**
 * The full registry — one entry per tool. Typed as a mapped object so the
 * keys are checked against ToolName (extra tools or typos error at compile
 * time) and per-entry describeCall/describeResult are typed against the
 * matching tool's params/result.
 */
export const TOOL_DISPLAY: { [T in ToolName]: ToolDisplayInfo<T> } = {
  // ─── files (workspace-chat-tools + kb_manager) ──────────────────────────
  query_knowledgebase: {
    tool: 'query_knowledgebase',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesSearch',
    fallbackLabel: 'Search files',
    icon: 'Search',
    category: 'files',
    display: 'card',
    describeCall: (p: QueryKnowledgebaseParams) => {
      const q = truncate(p.query);
      const folder = folderLabel(p);
      if (q && folder) return `Searching "${q}" in ${folder}`;
      if (q) return `Searching "${q}"`;
      return null;
    },
    describeResult: (r: QueryKnowledgebaseResult) => {
      // QueryKnowledgebaseResult is a discriminated union — narrow before
      // reading. all_kbs mode uses `total_results_count`; single-KB uses
      // `results_count`.
      if ('total_results_count' in r) {
        const n = r.total_results_count;
        return `${n} result${n === 1 ? '' : 's'} across ${r.kbs_queried.length} folders`;
      }
      const n = r.results_count;
      return `${n} result${n === 1 ? '' : 's'}`;
    },
  },

  list_kb_files: {
    tool: 'list_kb_files',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesShow',
    fallbackLabel: 'List files',
    icon: 'FolderOpen',
    category: 'files',
    display: 'card',
    describeCall: (p: ListKbFilesParams) =>
      p.kb_ids.length > 0 ? `Listing ${p.kb_ids.length} folder${p.kb_ids.length === 1 ? '' : 's'}` : null,
    describeResult: (r: ListKbFilesResult) => {
      const totalFiles = Object.values(r.listings).reduce((sum, l) => sum + l.files.length, 0);
      return `${totalFiles} file${totalFiles === 1 ? '' : 's'}`;
    },
  },

  retrieve_kb_file: {
    tool: 'retrieve_kb_file',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesRetrieve',
    fallbackLabel: 'Retrieve files',
    icon: 'Download',
    category: 'files',
    display: 'card',
    describeCall: (p: RetrieveKbFileParams) => {
      const folder = folderLabel(p);
      if (p.mode === 'list') {
        return p.pattern ? `Finding files matching "${p.pattern}" in ${folder}` : `Listing files in ${folder}`;
      }
      if (p.mode === 'download') {
        const name = p.file ?? p.uri?.split('/').pop() ?? '';
        return name ? `Downloading ${name}` : null;
      }
      if (p.mode === 'download_folder') {
        const subpath = p.folder_path ? `/${p.folder_path}` : '';
        return `Downloading folder ${folder}${subpath}`;
      }
      return null;
    },
    describeResult: (r: RetrieveKbFileResult) => {
      // Discriminate explicitly on the marker field per variant rather than
      // casting. Returns null on a malformed shape rather than reading an
      // undefined field — frontend will fall back to the bare tool label.
      if ('count' in r && typeof r.count === 'number') {
        return `${r.count} file${r.count === 1 ? '' : 's'}`;
      }
      if ('file_count' in r && typeof r.file_count === 'number' && typeof r.size_bytes === 'number') {
        return `${r.file_count} file${r.file_count === 1 ? '' : 's'}, ${r.size_bytes} bytes`;
      }
      if ('size_bytes' in r && typeof r.size_bytes === 'number') {
        return `${r.size_bytes} bytes`;
      }
      return null;
    },
  },

  add_to_kb: {
    tool: 'add_to_kb',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesUpload',
    fallbackLabel: 'Upload file',
    icon: 'Upload',
    category: 'files',
    display: 'card',
    describeCall: (p: AddToKbParams) => {
      const folder = folderLabel(p);
      const path = p.kb_path ? `${folder}/${p.kb_path}` : folder;
      return p.filename && path ? `Uploading ${p.filename} → ${path}` : null;
    },
  },

  delete_kb_file: {
    tool: 'delete_kb_file',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesDelete',
    fallbackLabel: 'Delete file',
    icon: 'Trash2',
    category: 'files',
    display: 'card',
    describeCall: (p: DeleteKbFileParams) => {
      const folder = folderLabel(p);
      return p.filename && folder ? `Deleting ${folder}/${p.filename}` : null;
    },
  },

  move_kb_file: {
    tool: 'move_kb_file',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesMove',
    fallbackLabel: 'Move file',
    icon: 'FolderInput',
    category: 'files',
    display: 'card',
    describeCall: (p: MoveKbFileParams) => {
      const firstKey = p.keys[0];
      if (!firstKey) return null;
      const fileBasename = firstKey.split('/').pop() ?? '';
      const destDisplay = p.destPath ? `${p.destKbId}/${p.destPath}` : p.destKbId;
      return `Moving ${fileBasename} → ${destDisplay}`;
    },
  },

  rename_kb_file: {
    tool: 'rename_kb_file',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesRename',
    fallbackLabel: 'Rename file',
    icon: 'FilePen',
    category: 'files',
    display: 'card',
    describeCall: (p: RenameKbFileParams) => {
      const oldName = p.key.split('/').pop() ?? '';
      return oldName && p.newFilename ? `Renaming ${oldName} → ${p.newFilename}` : null;
    },
  },

  create_kb_subfolder: {
    tool: 'create_kb_subfolder',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesMkdir',
    fallbackLabel: 'Create subfolder',
    icon: 'FolderPlus',
    category: 'files',
    display: 'inline',
    describeCall: (p: CreateKbSubfolderParams) => {
      const folder = folderLabel(p);
      return p.path && folder ? `Creating ${folder}/${p.path}/` : null;
    },
  },

  delete_kb_subfolder: {
    tool: 'delete_kb_subfolder',
    rendererKey: 'KnowledgeBaseRenderer',
    i18nLabelKey: 'common:toolLabels.filesRmdir',
    fallbackLabel: 'Delete subfolder',
    icon: 'FolderMinus',
    category: 'files',
    display: 'card',
    describeCall: (p: DeleteKbSubfolderParams) => {
      const folder = folderLabel(p);
      return p.path && folder ? `Deleting ${folder}/${p.path}/` : null;
    },
  },

  // ─── search ─────────────────────────────────────────────────────────────
  web_search: {
    tool: 'web_search',
    rendererKey: 'WebSearchRenderer',
    i18nLabelKey: 'common:toolLabels.webSearch',
    fallbackLabel: 'Web search',
    icon: 'Globe',
    category: 'search',
    display: 'card',
    describeCall: (p: WebSearchParams) => {
      // WebSearchParams discriminates on `operation`: 'search' (default) or
      // 'fetch_url'. Narrow before pulling query vs url.
      if (p.operation === 'fetch_url') {
        return p.url ? `Fetching ${truncate(p.url, 80)}` : null;
      }
      const q = truncate(p.query);
      return q ? `Searching the web for "${q}"` : null;
    },
    describeResult: (r: WebSearchResult) => {
      // Search mode populates results_count + results; fetch_url mode
      // returns content with no count. Return null when neither is set.
      if (typeof r.results_count === 'number') {
        return `${r.results_count} result${r.results_count === 1 ? '' : 's'}`;
      }
      if (typeof r.content === 'string') return `${r.content.length} chars`;
      return null;
    },
  },

  // ─── documents (workspace-chat-tools) ───────────────────────────────────
  extract_content: {
    tool: 'extract_content',
    rendererKey: 'DocumentRenderer',
    i18nLabelKey: 'common:toolLabels.docsExtract',
    fallbackLabel: 'Extract document content',
    icon: 'FileText',
    category: 'documents',
    display: 'card',
    describeCall: (p: ExtractContentParams) =>
      p.file_path ? `Extracting text from ${workspaceRelative(p.file_path)}` : null,
    describeResult: (r: ExtractContentResult) => {
      if (typeof r.text_length !== 'number') return null;
      return `${r.text_length.toLocaleString()} char${r.text_length === 1 ? '' : 's'} → ${workspaceRelative(r.output_path)}`;
    },
  },

  transcribe: {
    tool: 'transcribe',
    rendererKey: 'DocumentRenderer',
    i18nLabelKey: 'common:toolLabels.docsTranscribe',
    fallbackLabel: 'Transcribe audio/video',
    icon: 'Mic',
    category: 'documents',
    display: 'card',
    describeCall: (p: TranscribeParams) => {
      if (!p.file_path) return null;
      const modeLabel = p.mode === 'meeting' ? ' (meeting mode)' : '';
      return `Transcribing ${workspaceRelative(p.file_path)}${modeLabel}`;
    },
    describeResult: (r: TranscribeResult) => {
      // Amazon Transcribe sometimes returns 0/unset for very short clips —
      // fall back to text length rather than reporting a misleading "0s".
      const parts: string[] = [];
      if (r.duration_seconds > 0) parts.push(`${r.duration_seconds.toFixed(1)}s`);
      if (r.language && r.language !== 'unknown') parts.push(r.language);
      if (typeof r.text === 'string') parts.push(`${r.text.length.toLocaleString()} chars`);
      return parts.length > 0 ? parts.join(' · ') : null;
    },
  },

  convert_document: {
    tool: 'convert_document',
    rendererKey: 'DocumentRenderer',
    i18nLabelKey: 'common:toolLabels.docsConvert',
    fallbackLabel: 'Convert document',
    icon: 'FileType',
    category: 'documents',
    display: 'card',
    describeCall: (p: ConvertDocumentParams) =>
      p.file_path && p.format ? `Converting ${workspaceRelative(p.file_path)} → ${p.format.toUpperCase()}` : null,
    describeResult: (r: ConvertDocumentResult) => {
      if (!r.output_path) return null;
      const sizeLabel = typeof r.size === 'number' ? ` (${formatBytes(r.size)})` : '';
      return `${workspaceRelative(r.output_path)}${sizeLabel}`;
    },
  },

  // ─── memories (user_profile_*) ──────────────────────────────────────────
  user_profile_list_memories: {
    tool: 'user_profile_list_memories',
    rendererKey: 'MemoryRenderer',
    i18nLabelKey: 'common:toolLabels.memoriesList',
    fallbackLabel: 'List memories',
    icon: 'Lightbulb',
    category: 'memories',
    display: 'card',
    describeCall: (p: UserProfileListMemoriesParams) =>
      p.scope ? `Listing memories scoped to "${p.scope}"` : 'Listing memories',
    describeResult: (r: UserProfileListMemoriesResult) => {
      if (r.filtered_count === r.total_count) {
        return `${r.total_count} memor${r.total_count === 1 ? 'y' : 'ies'}`;
      }
      return `${r.filtered_count} of ${r.total_count} memories matched`;
    },
  },

  user_profile_add_memory: {
    tool: 'user_profile_add_memory',
    rendererKey: 'MemoryRenderer',
    i18nLabelKey: 'common:toolLabels.memoriesAdd',
    fallbackLabel: 'Remember',
    icon: 'BookmarkPlus',
    category: 'memories',
    display: 'card',
    describeCall: (p: UserProfileAddMemoryParams) => {
      if (!p.content) return null;
      const scopeSuffix = p.scope && p.scope !== 'general' ? ` (${p.scope})` : '';
      return `Remember: "${truncate(p.content)}"${scopeSuffix}`;
    },
    describeResult: (r: UserProfileAddMemoryResult) =>
      r.memory?.id ? `Added ${r.memory.id} (${r.total_count} total)` : null,
  },

  user_profile_update_memory: {
    tool: 'user_profile_update_memory',
    rendererKey: 'MemoryRenderer',
    i18nLabelKey: 'common:toolLabels.memoriesUpdate',
    fallbackLabel: 'Update memory',
    icon: 'NotebookPen',
    category: 'memories',
    display: 'card',
    describeCall: (p: UserProfileUpdateMemoryParams) => {
      if (!p.memory_id) return null;
      return p.content ? `Updating ${p.memory_id}: "${truncate(p.content)}"` : `Updating ${p.memory_id}`;
    },
    describeResult: (r: UserProfileUpdateMemoryResult) => (r.memory?.id ? `Updated ${r.memory.id}` : null),
  },

  user_profile_delete_memory: {
    tool: 'user_profile_delete_memory',
    rendererKey: 'MemoryRenderer',
    i18nLabelKey: 'common:toolLabels.memoriesDelete',
    fallbackLabel: 'Forget',
    icon: 'BookmarkX',
    category: 'memories',
    display: 'card',
    describeCall: (p: UserProfileDeleteMemoryParams) => (p.memory_id ? `Forgetting ${p.memory_id}` : null),
    describeResult: (r: UserProfileDeleteMemoryResult) => {
      // Don't echo arbitrary user content in the summary — just confirm
      // the id and how many memories remain.
      const id = r.memory?.id ?? '<unknown>';
      return `Deleted ${id} (${r.total_count} remaining)`;
    },
  },

  // ─── agents (workspace-chat-tools) ──────────────────────────────────────
  list_agents: {
    tool: 'list_agents',
    rendererKey: 'AgentRenderer',
    i18nLabelKey: 'common:toolLabels.agentsList',
    fallbackLabel: 'List agents',
    icon: 'Bot',
    category: 'agents',
    display: 'card',
    describeCall: (p: ListAgentsParams) => {
      const scope = p.scope ?? 'owned';
      if (p.search) return `Listing agents matching "${truncate(p.search, 40)}" (${scope})`;
      if (p.title) return `Listing agents with title "${truncate(p.title, 40)}" (${scope})`;
      return `Listing ${scope} agents`;
    },
    describeResult: (r: ListAgentsResult) => {
      const total = r.pagination?.total ?? r.agents.length;
      const shown = r.agents.length;
      return total === shown ? `${total} agent${total === 1 ? '' : 's'}` : `${shown} of ${total} agents`;
    },
  },

  get_agent: {
    tool: 'get_agent',
    rendererKey: 'AgentRenderer',
    i18nLabelKey: 'common:toolLabels.agentsGet',
    fallbackLabel: 'Get agent',
    icon: 'Bot',
    category: 'agents',
    display: 'card',
    describeCall: (p: GetAgentParams) => (p.agent_id ? `Loading agent ${p.agent_id}` : null),
    describeResult: (r: GetAgentResult) => (r.agent?.title ? `${r.agent.title} (${r.agent.scope})` : null),
  },

  create_agent: {
    tool: 'create_agent',
    rendererKey: 'AgentRenderer',
    i18nLabelKey: 'common:toolLabels.agentsCreate',
    fallbackLabel: 'Create agent',
    icon: 'BotMessageSquare',
    category: 'agents',
    display: 'card',
    describeCall: (p: CreateAgentParams) => {
      if (!p.title) return null;
      const vis = p.visibility ?? 'personal';
      return `Creating "${truncate(p.title, 50)}" (${vis})`;
    },
    describeResult: (r: CreateAgentResult) =>
      r.agent?.agentId ? `Created ${r.agent.title} (${r.agent.agentId})` : null,
  },

  update_agent: {
    tool: 'update_agent',
    rendererKey: 'AgentRenderer',
    i18nLabelKey: 'common:toolLabels.agentsUpdate',
    fallbackLabel: 'Update agent',
    icon: 'BotMessageSquare',
    category: 'agents',
    display: 'card',
    describeCall: (p: UpdateAgentParams) => {
      if (!p.agent_id) return null;
      const target = p.title ? `"${truncate(p.title, 50)}"` : p.agent_id;
      return `Updating ${target}`;
    },
    describeResult: (r: UpdateAgentResult) =>
      r.agent?.agentId ? `Updated ${r.agent.title} (${r.agent.agentId})` : null,
  },

  patch_agent_prompt: {
    tool: 'patch_agent_prompt',
    rendererKey: 'AgentRenderer',
    i18nLabelKey: 'common:toolLabels.agentsPatchPrompt',
    fallbackLabel: 'Edit agent prompt',
    icon: 'FileEdit',
    category: 'agents',
    display: 'card',
    describeCall: (p: PatchAgentPromptParams) => {
      if (!p.agent_id) return null;
      const delta = (p.new_text?.length ?? 0) - (p.old_text?.length ?? 0);
      const sign = delta > 0 ? `+${delta}` : `${delta}`;
      const scope = p.replace_all ? ' (all)' : '';
      return `Editing ${p.agent_id} prompt: ${sign} chars${scope}`;
    },
    describeResult: (r: PatchAgentPromptResult) =>
      r.agent?.systemPrompt ? `${r.agent.title} (prompt now ${r.agent.systemPrompt.length} chars)` : null,
  },

  duplicate_agent: {
    tool: 'duplicate_agent',
    rendererKey: 'AgentRenderer',
    i18nLabelKey: 'common:toolLabels.agentsDuplicate',
    fallbackLabel: 'Duplicate agent',
    icon: 'Copy',
    category: 'agents',
    display: 'card',
    describeCall: (p: DuplicateAgentParams) => (p.agent_id ? `Duplicating ${p.agent_id}` : null),
    describeResult: (r: DuplicateAgentResult) =>
      r.agent?.agentId ? `Forked → ${r.agent.title} (${r.agent.agentId})` : null,
  },

  delete_agent: {
    tool: 'delete_agent',
    rendererKey: 'AgentRenderer',
    i18nLabelKey: 'common:toolLabels.agentsDelete',
    fallbackLabel: 'Delete agent',
    icon: 'Trash2',
    category: 'agents',
    display: 'card',
    describeCall: (p: DeleteAgentParams) => (p.agent_id ? `Deleting agent ${p.agent_id}` : null),
    describeResult: (r: DeleteAgentResult) => (r.agent?.title ? `Deleted ${r.agent.title} (${r.agent.agentId})` : null),
  },

  // ─── integrations (Pipedream + native) ──────────────────────────────────

  pipedream_list_actions: {
    tool: 'pipedream_list_actions',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsPipedreamActions',
    fallbackLabel: 'List integration actions',
    icon: 'List',
    category: 'integrations',
    display: 'card',
    describeCall: (p: PipedreamListActionsParams) => (p.app_slug ? `Listing actions for ${p.app_slug}` : null),
    describeResult: (r: PipedreamListActionsResult) =>
      Array.isArray(r?.actions) ? `${r.actions.length} action${r.actions.length === 1 ? '' : 's'}` : null,
  },

  pipedream_batch_get_schemas: {
    tool: 'pipedream_batch_get_schemas',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsPipedreamSchemas',
    fallbackLabel: 'Fetch integration schemas',
    icon: 'PackageOpen',
    category: 'integrations',
    display: 'card',
    describeCall: (p: PipedreamBatchGetSchemasParams) =>
      Array.isArray(p?.app_slugs)
        ? `Fetching schemas for ${p.app_slugs.length} integration${p.app_slugs.length === 1 ? '' : 's'}`
        : null,
    describeResult: (r: PipedreamBatchGetSchemasResult) => {
      const keys = Object.keys(r?.schemas ?? {});
      return `${keys.length} schema${keys.length === 1 ? '' : 's'} loaded`;
    },
  },

  pipedream_configure_props: {
    tool: 'pipedream_configure_props',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsPipedreamPropsOptions',
    fallbackLabel: 'Get prop options',
    icon: 'Sliders',
    category: 'integrations',
    display: 'card',
    describeCall: (p: PipedreamConfigurePropsParams) =>
      p?.action_key && p?.prop_name ? `Resolving options for ${p.action_key}.${p.prop_name}` : null,
    describeResult: (r: PipedreamConfigurePropsResult) =>
      Array.isArray(r?.options) ? `${r.options.length} option${r.options.length === 1 ? '' : 's'}` : null,
  },

  pipedream_run_action: {
    tool: 'pipedream_run_action',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsPipedreamCall',
    fallbackLabel: 'Run integration action',
    icon: 'Zap',
    category: 'integrations',
    display: 'card',
    describeCall: (p: PipedreamRunActionParams) =>
      p?.action_key ? `Running ${p.action_key}${p.description ? ` — ${truncate(p.description, 60)}` : ''}` : null,
    describeResult: (r: PipedreamRunActionResult) => {
      if (r?.status === 'denied') return 'denied by user';
      if (r?.status === 'timeout') return 'approval timed out';
      if (r?.status && r.status !== 'success') return r.status;
      return 'completed';
    },
  },

  pipedream_proxy_request: {
    tool: 'pipedream_proxy_request',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsRequest',
    fallbackLabel: 'Integration HTTP request',
    icon: 'Globe',
    category: 'integrations',
    display: 'card',
    describeCall: (p: PipedreamProxyRequestParams) =>
      p?.method && p?.upstream_url ? `${p.method} ${truncate(p.upstream_url, 80)} (via ${p.integration_slug})` : null,
    describeResult: (r: PipedreamProxyRequestResult) => {
      if (r?.status === 'denied') return 'denied by user';
      if (r?.status === 'timeout') return 'approval timed out';
      if (r?.status && r.status !== 'success') return r.status;
      return 'completed';
    },
  },

  connect_request: {
    tool: 'connect_request',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsRequest',
    fallbackLabel: 'Integration HTTP request',
    icon: 'Globe',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectRequestParams) =>
      p?.method && p?.url ? `${p.method} ${truncate(p.url, 80)} (via ${p.connector})` : null,
    describeResult: (r: ConnectRequestResult) => {
      const sc = r?.result?.status_code;
      if (typeof sc === 'number') return `HTTP ${sc}`;
      if (r?.error || r?.error_code) return `error: ${r.error_code ?? r.error}`;
      return null;
    },
  },

  connect_status: {
    tool: 'connect_status',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsStatus',
    fallbackLabel: 'Integration status',
    icon: 'Plug',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectStatusParams) =>
      p?.connector ? `Checking ${p.connector} status` : 'Checking all native connector status',
    describeResult: (r: ConnectStatusResult) => {
      const total = Object.keys(r ?? {}).length;
      const connected = Object.values(r ?? {}).filter((e) => e?.status === 'connected').length;
      return `${connected}/${total} connected`;
    },
  },

  // Helper to satisfy the mapped-object exhaustiveness. Listed tools above.
} satisfies { [T in ToolName]: ToolDisplayInfo<T> };

/**
 * Lookup helper — returns the entry for a tool name, or undefined. Frontend
 * should fall back to a generic renderer ("FallbackRenderer") + a generic
 * label when this is undefined.
 *
 * The input is `string` (not `ToolName`) so frontend callers handling raw
 * SDK tool names don't have to cast first.
 */
export const getToolDisplay = (tool: string): ToolDisplayInfo | undefined =>
  (TOOL_DISPLAY as Record<string, ToolDisplayInfo>)[tool];

/**
 * All tool names known to the registry — useful for the LLM's discovery
 * and for the frontend's "is this tool one we know about" gating.
 */
export const knownTools = (): ToolName[] => Object.keys(TOOL_DISPLAY) as ToolName[];

/**
 * Convenience predicate matching frontend's old `INLINE_TOOLS.has(name)`
 * check. Returns false for unknown tools (frontend's previous behaviour
 * was also false-by-default).
 */
export const isInlineTool = (tool: string): boolean => {
  const info = getToolDisplay(tool);
  return info?.display === 'inline';
};
