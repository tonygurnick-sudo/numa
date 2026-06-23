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
  ConnectSynergyCompaniesParams,
  ConnectSynergyContactsParams,
  ConnectSynergyDownloadParams,
  ConnectSynergyFileHistoryParams,
  ConnectSynergyFileInfoParams,
  ConnectSynergyFolderSummaryParams,
  ConnectSynergyForumsParams,
  ConnectSynergyIssuesParams,
  ConnectSynergyJobExtrasParams,
  ConnectSynergyJobMetaParams,
  ConnectSynergyExactTermParams,
  ConnectSynergyJobStatsParams,
  ConnectSynergyJobTreeParams,
  ConnectSynergyNotesParams,
  ConnectSynergyPortfolioParams,
  ConnectSynergyListParams,
  ConnectSynergyProjectsParams,
  ConnectSynergyRecentParams,
  ConnectSynergyResolveParams,
  ConnectSynergySchemaParams,
  ConnectSynergySearchParams,
  ConnectSynergyTasksParams,
  ConnectSynergyTransmittalsParams,
  ConnectSynergyUsersParams,
  ConnectSynergyWebformsParams,
  ConnectSynergyWorkflowParams,
  ConnectorDownloadResult,
  ConnectorFileMetadataResult,
  ConnectorListResult,
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
  OauthDownloadFileParams,
  OauthGetFileMetadataParams,
  OauthListFilesParams,
  OauthSearchFilesParams,
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
  ViewImageParams,
  ViewImageResult,
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

/** Shared result summary for native-connector list/search (folders + files counts). */
const describeConnectorList = (r: ConnectorListResult): string | null => {
  const folders = r?.folders?.length ?? 0;
  const files = r?.files?.length ?? 0;
  const parts: string[] = [];
  if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
  if (files) parts.push(`${files} file${files === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(', ') : 'no items';
};

/** Shared result summary for a native-connector download. */
const describeConnectorDownload = (r: ConnectorDownloadResult): string | null =>
  r?.filename ? `${r.filename}${typeof r.size === 'number' ? ` (${formatBytes(r.size)})` : ''}` : null;

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

  view_image: {
    tool: 'view_image',
    rendererKey: 'DocumentRenderer',
    i18nLabelKey: 'common:toolLabels.visionView',
    fallbackLabel: 'Look at image',
    icon: 'Eye',
    category: 'documents',
    display: 'card',
    describeCall: (p: ViewImageParams) => {
      if (!p.file_path) return null;
      const rel = workspaceRelative(p.file_path);
      return p.prompt ? `Looking at ${rel}: "${truncate(p.prompt, 50)}"` : `Looking at ${rel}`;
    },
    describeResult: (r: ViewImageResult) =>
      typeof r.description === 'string' ? `${r.description.length.toLocaleString()} chars` : null,
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

  // ─── native connector file browsing (Synergy + OAuth cloud storage) ──────
  // Restored after the MCP→CLI migration dropped the MCP `connect.py` file
  // ops. Synergy uses dedicated handlers; the OAuth providers share generic
  // `oauth_*` ops keyed by a `provider` param. All read-only.

  connect_synergy_list: {
    tool: 'connect_synergy_list',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsListFiles',
    fallbackLabel: 'List connector files',
    icon: 'FolderOpen',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyListParams) => {
      if (p.query) return `Searching Synergy jobs for "${truncate(p.query, 50)}"`;
      if (p.folder_id) return `Listing Synergy ${p.folder_id}`;
      return 'Listing Synergy jobs';
    },
    describeResult: describeConnectorList,
  },

  connect_synergy_search: {
    tool: 'connect_synergy_search',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSearchFiles',
    fallbackLabel: 'Search connector files',
    icon: 'Search',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergySearchParams) =>
      p.query ? `Searching Synergy jobs for "${truncate(p.query, 50)}"` : null,
    describeResult: describeConnectorList,
  },

  connect_synergy_download: {
    tool: 'connect_synergy_download',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsDownloadFile',
    fallbackLabel: 'Download connector file',
    icon: 'Download',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyDownloadParams) => (p.file_id ? `Downloading Synergy file ${p.file_id}` : null),
    describeResult: describeConnectorDownload,
  },

  connect_synergy_job_meta: {
    tool: 'connect_synergy_job_meta',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyJobMeta',
    fallbackLabel: 'Synergy job details',
    icon: 'Info',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyJobMetaParams) => (p.job_id ? `Looking up Synergy job ${p.job_id}` : null),
    describeResult: () => null,
  },

  connect_synergy_folder_summary: {
    tool: 'connect_synergy_folder_summary',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyFolderSummary',
    fallbackLabel: 'Synergy folder contents',
    icon: 'FolderOpen',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyFolderSummaryParams) =>
      p.folder_id ? `Counting what's in Synergy folder ${p.folder_id}` : null,
    describeResult: () => null,
  },

  connect_synergy_schema: {
    tool: 'connect_synergy_schema',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergySchema',
    fallbackLabel: 'Synergy fields & vocabulary',
    icon: 'Info',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergySchemaParams) => {
      if (p.mode === 'types')
        return p.type_name ? `Looking up the Synergy "${p.type_name}" enum` : 'Looking up the Synergy decode enums';
      if (p.mode === 'categories') return 'Looking up the Synergy category vocabulary';
      if (p.mode === 'find')
        return p.name ? `Resolving the Synergy attribute "${p.name}"` : 'Resolving a Synergy attribute';
      if (p.mode === 'choices')
        return p.name
          ? `Looking up valid choices for Synergy attribute "${p.name}"`
          : 'Looking up valid Synergy attribute choices';
      if (p.mode === 'file' || p.entity === 'file') return 'Looking up the Synergy file fields';
      if (p.mode === 'contact' || p.entity === 'contact') return 'Looking up the Synergy contact fields';
      return 'Looking up the Synergy job fields';
    },
    describeResult: () => null,
  },

  connect_synergy_file_info: {
    tool: 'connect_synergy_file_info',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsFileInfo',
    fallbackLabel: 'Synergy file details',
    icon: 'Info',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyFileInfoParams) => (p.file_id ? `Looking up Synergy file ${p.file_id}` : null),
    describeResult: (r: ConnectorFileMetadataResult) =>
      r?.name ? `${r.name}${typeof r.size === 'number' ? ` (${formatBytes(r.size)})` : ''}` : null,
  },

  connect_synergy_job_stats: {
    tool: 'connect_synergy_job_stats',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyJobStats',
    fallbackLabel: 'Synergy job summary',
    icon: 'BarChart',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyJobStatsParams) => (p.job_id ? `Summarising Synergy job ${p.job_id}` : null),
    describeResult: () => null,
  },

  connect_synergy_job_tree: {
    tool: 'connect_synergy_job_tree',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyJobTree',
    fallbackLabel: 'Synergy folder layout',
    icon: 'FolderTree',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyJobTreeParams) =>
      p.job_id ? `Mapping the folders in Synergy job ${p.job_id}` : null,
    describeResult: () => null,
  },

  connect_synergy_exact_term: {
    tool: 'connect_synergy_exact_term',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyExactTerm',
    fallbackLabel: 'Synergy exact-word search',
    icon: 'Search',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyExactTermParams) =>
      Array.isArray(p.terms) && p.terms.length
        ? `Finding Synergy jobs containing ${p.terms.join(p.mode === 'OR' ? ' or ' : ' + ')}`
        : 'Searching Synergy jobs by exact word',
    describeResult: () => null,
  },

  connect_synergy_portfolio: {
    tool: 'connect_synergy_portfolio',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyPortfolio',
    fallbackLabel: 'Synergy job search',
    icon: 'BarChart',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyPortfolioParams) =>
      p.group_by ? `Counting Synergy jobs by ${p.group_by.replace(/^attr_/, '')}` : 'Searching across Synergy jobs',
    describeResult: () => null,
  },

  // ─── Wave 1 read-only Synergy tools (PAT-scoped live 12d reads) ───────────

  connect_synergy_tasks: {
    tool: 'connect_synergy_tasks',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyTasks',
    fallbackLabel: 'Synergy tasks',
    icon: 'ListChecks',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyTasksParams) => {
      if (!p.job_id) return null;
      if (p.assignee_id) return `Listing Synergy tasks for ${p.assignee_id} on job ${p.job_id}`;
      return `Listing Synergy tasks on job ${p.job_id}`;
    },
    describeResult: () => null,
  },

  connect_synergy_contacts: {
    tool: 'connect_synergy_contacts',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyContacts',
    fallbackLabel: 'Synergy contacts',
    icon: 'Users',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyContactsParams) => {
      if (p.contact_id) return `Looking up Synergy contact ${p.contact_id}`;
      if (p.job_id) return `Listing Synergy contacts on job ${p.job_id}`;
      const term = p.query || [p.first_name, p.last_name, p.email].filter(Boolean).join(' ');
      return term ? `Searching Synergy contacts for "${truncate(term, 50)}"` : 'Searching Synergy contacts';
    },
    describeResult: () => null,
  },

  connect_synergy_issues: {
    tool: 'connect_synergy_issues',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyIssues',
    fallbackLabel: 'Synergy issues',
    icon: 'AlertCircle',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyIssuesParams) => {
      if (p.issue_id) return `Looking up Synergy issue ${p.issue_id}`;
      if (p.job_id) return `Listing Synergy issues on job ${p.job_id}`;
      return 'Looking up Synergy issues';
    },
    describeResult: () => null,
  },

  connect_synergy_workflow: {
    tool: 'connect_synergy_workflow',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyWorkflow',
    fallbackLabel: 'Synergy workflow status',
    icon: 'GitBranch',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyWorkflowParams) => {
      if (p.mode === 'instance' || (p.entity_id && p.mode !== 'definitions')) {
        return `Checking Synergy workflow status${p.entity_id ? ` for ${p.entity_id}` : ''}`;
      }
      if (p.mode === 'diagram') return 'Fetching the Synergy workflow diagram';
      if (p.workflow_id) return `Looking up Synergy workflow ${p.workflow_id}`;
      return 'Listing Synergy workflows';
    },
    describeResult: () => null,
  },

  connect_synergy_file_history: {
    tool: 'connect_synergy_file_history',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyFileHistory',
    fallbackLabel: 'Synergy file history',
    icon: 'History',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyFileHistoryParams) =>
      p.file_id ? `Looking up version history for Synergy file ${p.file_id}` : null,
    describeResult: () => null,
  },

  connect_synergy_recent: {
    tool: 'connect_synergy_recent',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyRecent',
    fallbackLabel: 'Synergy recent changes',
    icon: 'Clock',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyRecentParams) => {
      const scope = p.folder_id ? `folder ${p.folder_id}` : p.job_id ? `job ${p.job_id}` : 'Synergy';
      return `Checking recent changes in ${scope}`;
    },
    describeResult: () => null,
  },

  // ─── Wave 2 read-only Synergy tools (PAT-scoped live 12d reads) ───────────

  connect_synergy_forums: {
    tool: 'connect_synergy_forums',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyForums',
    fallbackLabel: 'Synergy forums',
    icon: 'MessagesSquare',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyForumsParams) => {
      if (p.topic_id) return `Reading Synergy forum thread ${p.topic_id}`;
      if (p.category_id) return `Listing Synergy forum topics in ${p.category_id}`;
      if (p.forum_id) return `Opening Synergy forum ${p.forum_id}`;
      if (p.job_id) return `Listing Synergy forums on job ${p.job_id}`;
      return 'Looking up Synergy forums';
    },
    describeResult: () => null,
  },

  connect_synergy_projects: {
    tool: 'connect_synergy_projects',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyProjects',
    fallbackLabel: 'Synergy 12d projects',
    icon: 'Box',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyProjectsParams) => {
      if (p.mode === 'preview')
        return `Fetching the Synergy 12d project preview${p.project_id ? ` for ${p.project_id}` : ''}`;
      if (p.name) return `Finding the Synergy 12d project "${truncate(p.name, 50)}"`;
      if (p.project_id) return `Looking up Synergy 12d project ${p.project_id}`;
      if (p.job_id) return `Listing 12d projects in Synergy job ${p.job_id}`;
      if (p.folder_id) return `Listing 12d projects in Synergy folder ${p.folder_id}`;
      return 'Looking up Synergy 12d projects';
    },
    describeResult: () => null,
  },

  connect_synergy_transmittals: {
    tool: 'connect_synergy_transmittals',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyTransmittals',
    fallbackLabel: 'Synergy transmittals',
    icon: 'Send',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyTransmittalsParams) => {
      if (p.issue_id) return `Looking up Synergy transmittal ${p.issue_id}`;
      if (p.set_id) return `Looking up Synergy issued file-set ${p.set_id}`;
      if (p.job_id) return `Listing Synergy transmittals on job ${p.job_id}`;
      return 'Looking up Synergy transmittals';
    },
    describeResult: () => null,
  },

  connect_synergy_companies: {
    tool: 'connect_synergy_companies',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyCompanies',
    fallbackLabel: 'Synergy companies',
    icon: 'Building2',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyCompaniesParams) => {
      if (p.mode === 'jobs') return `Listing jobs for Synergy company ${p.company_id ?? ''}`.trim();
      if (p.mode === 'staff') return `Listing staff for Synergy company ${p.company_id ?? ''}`.trim();
      if (p.mode === 'schema') return 'Looking up the Synergy company fields';
      if (p.company_id) return `Looking up Synergy company ${p.company_id}`;
      return 'Listing Synergy companies';
    },
    describeResult: () => null,
  },

  connect_synergy_webforms: {
    tool: 'connect_synergy_webforms',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyWebforms',
    fallbackLabel: 'Synergy web forms',
    icon: 'ClipboardList',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyWebformsParams) => {
      if (p.mode === 'enabled') return 'Checking whether Synergy web forms are enabled';
      if (p.fill_id) return `Looking up Synergy form submission ${p.fill_id}`;
      if (p.definition_id) return `Looking up Synergy form definition ${p.definition_id}`;
      if (p.mode === 'definitions') {
        const scope = p.task_type_id ?? p.task_id ?? p.job_id;
        return scope ? `Listing Synergy form definitions for ${scope}` : 'Listing Synergy form definitions';
      }
      const scope = p.file_id ?? p.task_id ?? p.job_id;
      return scope ? `Listing Synergy form submissions for ${scope}` : 'Looking up Synergy web forms';
    },
    describeResult: () => null,
  },

  connect_synergy_job_extras: {
    tool: 'connect_synergy_job_extras',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyJobExtras',
    fallbackLabel: 'Synergy job extras',
    icon: 'LayoutGrid',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyJobExtrasParams) => {
      switch (p.section) {
        case 'team':
          return `Looking up the Synergy job team${p.job_id ? ` on ${p.job_id}` : ''}`;
        case 'roles':
          return 'Looking up Synergy team role definitions';
        case 'reports':
          return 'Listing Synergy reports';
        case 'report':
          return `Looking up Synergy report ${p.report_id ?? ''}`.trim();
        case 'report_inputs':
          return `Looking up inputs for Synergy report ${p.report_id ?? ''}`.trim();
        case 'clashes':
          return `Listing Synergy clash detections${p.folder_id ? ` in ${p.folder_id}` : ''}`;
        case 'clash_items':
          return `Listing items in Synergy clash ${p.clash_id ?? ''}`.trim();
        case 'clash_report':
          return `Fetching the Synergy clash report ${p.clash_id ?? ''}`.trim();
        default:
          return 'Looking up Synergy job extras';
      }
    },
    describeResult: () => null,
  },

  connect_synergy_notes: {
    tool: 'connect_synergy_notes',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyNotes',
    fallbackLabel: 'Synergy notes',
    icon: 'StickyNote',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyNotesParams) => {
      const target = p.target_id ? ` on ${p.target_id}` : '';
      if (p.section === 'associations') return `Looking up Synergy associations${target}`;
      return `Looking up Synergy notes${target}`;
    },
    describeResult: () => null,
  },

  connect_synergy_status: {
    tool: 'connect_synergy_status',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyStatus',
    fallbackLabel: 'Synergy connection status',
    icon: 'Activity',
    category: 'integrations',
    display: 'card',
    describeCall: () => 'Checking the Synergy connection health',
    describeResult: () => null,
  },

  connect_synergy_users: {
    tool: 'connect_synergy_users',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyUsers',
    fallbackLabel: 'Synergy users',
    icon: 'UserCircle',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyUsersParams) => {
      if (p.mode === 'module' || p.module) return `Checking Synergy module access${p.module ? ` for ${p.module}` : ''}`;
      if (p.mode === 'checkouts' || p.job_id)
        return `Listing Synergy checkouts${p.job_id ? ` on job ${p.job_id}` : ''}`;
      if (p.user_id) return `Looking up Synergy user ${p.user_id}`;
      return 'Looking up Synergy users';
    },
    describeResult: () => null,
  },

  // ─── Wave 3 read-only Synergy tool (PAT-scoped live 12d reads) ────────────

  connect_synergy_resolve: {
    tool: 'connect_synergy_resolve',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSynergyResolve',
    fallbackLabel: 'Synergy link resolver',
    icon: 'Link',
    category: 'integrations',
    display: 'card',
    describeCall: (p: ConnectSynergyResolveParams) => {
      if (p.mode === 'path' || (p.path && p.mode !== 'link' && p.mode !== 'weblink')) {
        return p.path ? `Resolving Synergy path ${truncate(p.path, 60)}` : 'Resolving a Synergy path';
      }
      if (p.mode === 'weblink' || (p.entity_id && !p.link && !p.path)) {
        return p.entity_id ? `Building a Synergy link for ${p.entity_id}` : 'Building a Synergy link';
      }
      return p.link ? `Resolving Synergy link ${truncate(p.link, 60)}` : 'Resolving a Synergy link';
    },
    describeResult: () => null,
  },

  oauth_list_files: {
    tool: 'oauth_list_files',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsListFiles',
    fallbackLabel: 'List connector files',
    icon: 'FolderOpen',
    category: 'integrations',
    display: 'card',
    describeCall: (p: OauthListFilesParams) => {
      if (!p.provider) return null;
      return p.folder_id ? `Listing ${p.provider} folder ${p.folder_id}` : `Listing ${p.provider} files`;
    },
    describeResult: describeConnectorList,
  },

  oauth_search_files: {
    tool: 'oauth_search_files',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsSearchFiles',
    fallbackLabel: 'Search connector files',
    icon: 'Search',
    category: 'integrations',
    display: 'card',
    describeCall: (p: OauthSearchFilesParams) =>
      p.provider && p.query ? `Searching ${p.provider} for "${truncate(p.query, 50)}"` : null,
    describeResult: describeConnectorList,
  },

  oauth_download_file: {
    tool: 'oauth_download_file',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsDownloadFile',
    fallbackLabel: 'Download connector file',
    icon: 'Download',
    category: 'integrations',
    display: 'card',
    describeCall: (p: OauthDownloadFileParams) =>
      p.provider && p.file_id ? `Downloading ${p.filename ?? p.file_id} from ${p.provider}` : null,
    describeResult: describeConnectorDownload,
  },

  oauth_get_file_metadata: {
    tool: 'oauth_get_file_metadata',
    rendererKey: 'IntegrationsRenderer',
    i18nLabelKey: 'common:toolLabels.integrationsFileInfo',
    fallbackLabel: 'Connector file info',
    icon: 'Info',
    category: 'integrations',
    display: 'card',
    describeCall: (p: OauthGetFileMetadataParams) =>
      p.provider && p.file_id ? `Getting ${p.provider} file info for ${p.file_id}` : null,
    describeResult: (r: ConnectorFileMetadataResult) =>
      r?.name ? `${r.name}${typeof r.size === 'number' ? ` (${formatBytes(r.size)})` : ''}` : null,
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
