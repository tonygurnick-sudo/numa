/**
 * Tool param + result schemas — TypeScript mirror of the Python handlers'
 * documented inputs and outputs. Source of truth for the CLI, frontend
 * renderers, and anyone else consuming `@numa/cli/metadata`.
 *
 * Discriminated union `ToolCall` keys on `tool` — TypeScript narrows the
 * `params` shape automatically once the tool name is known. Result types
 * are looked up via the conditional `ToolResult<T>` mapped type.
 *
 * Maintenance discipline:
 *   - When a Python handler's required-param check or response shape
 *     changes, update the matching interface here. The Python handlers
 *     are the canonical schemas; this file is the typed mirror.
 *   - Don't try to fully type fields whose Python types are themselves
 *     loose (e.g. agent kwargs); use `unknown` or `Record<string, unknown>`
 *     rather than guess.
 *   - Common dispatcher-injected fields (user_sub, allowed_kbs,
 *     conversation_id, id_token) are NOT in these interfaces — they're
 *     added by the numa-cli-api Lambda from auth context, not by callers.
 */

// ─── Shared base types ──────────────────────────────────────────────────────

/**
 * HITL approval fields. Optional on every write op; set by the CLI after
 * the local terminal prompt, by the workspace SDK runner after SSE
 * approval, etc.
 */
export interface HitlParams {
  /**
   * Mark this call as pre-approved — workspace-chat-tools' `check_approval`
   * skips the DDB poll loop and just runs the op. Used by the CLI's dev
   * binary after a local `[y/N]` prompt and by the workspace runner after
   * the SDK's approval gate resolves.
   */
  auto_approved?: boolean;
  /**
   * Deterministic approval-id seed, used by the SSE flow to match an
   * approval back to its tool-use. CLI doesn't currently set this; the
   * field's here for API completeness.
   */
  request_id?: string;
}

// ─── Files / KB tools ───────────────────────────────────────────────────────

export interface QueryKnowledgebaseParams {
  /** Literal text to match against (Bedrock KB or Q Business). */
  query: string;
  /**
   * What the caller is trying to accomplish — used to drive the LLM-
   * powered result summary. Required by workspace-chat-tools'
   * handle_query_knowledgebase. CLI defaults this to the query itself
   * when the user doesn't pass `--intent`.
   */
  user_intent: string;
  /** Specific KB id to scope to. Omit to use the request's allowed_kbs. */
  kb_id?: string;
  /** Default 6, capped at 15 server-side. */
  max_results?: number;
  /** When true the server runs an LLM summary; pass false for raw results. */
  summarise_results?: boolean;
  /**
   * When true, search across ALL allowed KBs instead of a single kb_id.
   * Defaults to false.
   */
  all_kbs?: boolean;
}

/**
 * `query_knowledgebase` returns one of three shapes depending on which
 * inputs were combined:
 *   - single-KB raw   — `summarise_results: false`, `all_kbs: false` (or unset)
 *   - single-KB summarised — `summarise_results: true`, `all_kbs: false`
 *   - all-KBs (raw or summarised) — `all_kbs: true`
 *
 * Modelled as a union so describeResult etc. have to narrow before reading
 * mode-specific fields. Python source: `workspace-chat-tools/tools/
 * knowledge_base.py:_query_single_kb` + `_query_all_kbs`.
 */
export type QueryKnowledgebaseResult =
  | QueryKnowledgebaseSingleRawResult
  | QueryKnowledgebaseSingleSummarisedResult
  | QueryKnowledgebaseAllKbsResult;

export interface QueryKnowledgebaseSingleRawResult {
  /** Per-source text content, ordered by relevance. */
  raw_content: string[];
  /** s3:// URIs matching `raw_content` 1:1. */
  references: string[];
  provider: 'bedrock' | 'q_business' | string;
  query: string;
  results_count: number;
}

export interface QueryKnowledgebaseSingleSummarisedResult {
  /** LLM-condensed summary of the matched sources. */
  summarised_content: string;
  references: string[];
  provider: 'bedrock' | 'q_business' | string;
  query: string;
  results_count: number;
}

export interface QueryKnowledgebaseAllKbsResult {
  /** Either raw or summarised content, depending on `summarise_results`. */
  raw_content?: string[];
  summarised_content?: string;
  /** Nested per-KB references when querying multiple KBs. */
  references: Record<string, string[]> | string[];
  kbs_queried: string[];
  total_results_count: number;
  query: string;
}

export interface ListKbFilesParams {
  /** One entry per KB to list. workspace-chat-tools accepts batches. */
  kb_ids: string[];
}

export interface ListKbFilesResult {
  listings: Record<
    string,
    {
      files: Array<{ name: string; size: number; size_formatted: string }>;
      folders: string[];
      total_count: number;
      truncated: boolean;
    }
  >;
  kb_count: number;
  errors: Array<{ kb_id: string; error: string }>;
}

/**
 * Multi-mode tool. Each mode has a different param shape — discriminated
 * here so callers get compile-time guidance on what to pass.
 */
export type RetrieveKbFileParams =
  | RetrieveKbFileListParams
  | RetrieveKbFileDownloadParams
  | RetrieveKbFileDownloadFolderParams;

export interface RetrieveKbFileListParams extends HitlParams {
  mode: 'list';
  kb_id: string;
  /** fnmatch-style filename pattern (e.g. `*.pdf`, `notes-*.md`). Optional. */
  pattern?: string;
}

export interface RetrieveKbFileDownloadParams extends HitlParams {
  mode: 'download';
  kb_id: string;
  /** Filename within the KB (use `uri` instead for cross-KB s3:// references). */
  file?: string;
  /** Full S3 URI alternative to `file`. */
  uri?: string;
  /** When true, the result returns a presigned URL instead of base64 bytes. */
  get_presigned_url?: boolean;
}

export interface RetrieveKbFileDownloadFolderParams extends HitlParams {
  mode: 'download_folder';
  kb_id: string;
  /** Subfolder inside the KB. Empty string for root. */
  folder_path?: string;
  get_presigned_url?: boolean;
}

export type RetrieveKbFileResult =
  | RetrieveKbFileListResult
  | RetrieveKbFileDownloadResult
  | RetrieveKbFileDownloadFolderResult;

export interface RetrieveKbFileListResult {
  files: Array<{
    name: string;
    size: number;
    size_formatted: string;
    /** Full S3 key (e.g. `documents/kb-{id}/foo.md`). */
    key?: string;
    /** ISO-8601 last-modified timestamp from S3. */
    last_modified?: string;
    s3_uri?: string;
  }>;
  /** Subfolders found at this level (when not recursive listing). */
  folders?: string[];
  kb_id: string;
  /** Subfolder requested, if any. */
  folder?: string;
  count: number;
  /** Echoed back from the call. */
  pattern?: string;
  recursive?: boolean;
}

export interface RetrieveKbFileDownloadResult {
  filename: string;
  size_bytes: number;
  content_base64?: string;
  presigned_url?: string;
  /**
   * sha256 of the file bytes — present on the inline (content_base64) path.
   * The presigned path deliberately omits it (the Lambda never pulls the
   * large file through itself just to hash it); size_bytes is the check there.
   */
  download_sha256?: string;
  /** Server always returns the canonical S3 URI for the downloaded file. */
  s3_uri: string;
}

export interface RetrieveKbFileDownloadFolderResult {
  filename: string;
  size_bytes: number;
  file_count: number;
  content_base64?: string;
  presigned_url?: string;
  /** sha256 over the exact zip bytes — present on BOTH inline and presigned paths. */
  download_sha256?: string;
}

export interface AddToKbParams extends HitlParams {
  kb_id: string;
  filename: string;
  /** Base64-encoded file bytes. */
  content_base64: string;
  /** Subfolder within the KB. e.g. `archive/q3`. Empty / omitted = root. */
  kb_path?: string;
}

export interface AddToKbResult {
  message: string;
  s3_uri: string;
  kb_id: string;
  filename: string;
  kb_path?: string;
}

export interface DeleteKbFileParams extends HitlParams {
  kb_id: string;
  /**
   * Filename within the KB. For files in subfolders, include the subpath
   * in the filename itself (e.g. `archive/q3/report.pdf`) — the handler
   * does NOT accept a separate `kb_path` field; it builds the key as
   * `documents/{kb_prefix}/{filename}`. Source: `workspace-chat-tools/
   * tools/knowledge_base.py:_delete_kb_file`.
   */
  filename: string;
}

export interface DeleteKbFileResult {
  message: string;
  deleted_key: string;
}

// ─── kb_manager-backed ──────────────────────────────────────────────────────

export interface MoveKbFileParams extends HitlParams {
  /** Source KB (goes in URL path). */
  kb_id: string;
  /** Full S3 keys of the source files (e.g. `documents/kb-X/foo.md`). */
  keys: string[];
  /** Destination KB id — may equal `kb_id` for same-KB moves. */
  destKbId: string;
  /** Optional subpath in destination. Empty string for root. */
  destPath?: string;
}

export interface MoveKbFileResult {
  /**
   * Per-file outcome. Each entry maps `sourceKey` → `destKey` so callers
   * can rebuild references. Source: `numa-kb-manager/numa_kb_manager/
   * app.py:move_kb_files` (search `successful.append`).
   */
  successful: Array<{ sourceKey: string; destKey: string }>;
  failed: Array<{ key: string; error: string }>;
  message?: string;
}

export interface RenameKbFileParams extends HitlParams {
  /** KB containing the file (URL path). */
  kb_id: string;
  /** Full S3 key of the file. */
  key: string;
  /** New filename only — no path separators (server rejects them). */
  newFilename: string;
}

export interface RenameKbFileResult {
  /** Original S3 key (echoed back). */
  sourceKey: string;
  /** New S3 key after the copy-then-delete rename. */
  destKey: string;
  message?: string;
}

export interface CreateKbSubfolderParams extends HitlParams {
  kb_id: string;
  /** Path within the KB (e.g. `reports/q3`). Trailing slash added server-side. */
  path: string;
}

export interface CreateKbSubfolderResult {
  path: string;
  key: string;
}

export interface DeleteKbSubfolderParams extends HitlParams {
  kb_id: string;
  path: string;
  /**
   * When false (default), the server rejects with 409 if the folder
   * contains files. When true, deletes the folder + all contents
   * recursively. Source: `numa-kb-manager/numa_kb_manager/app.py:
   * delete_kb_folder` (`body.get("recursive", False)`).
   */
  recursive?: boolean;
}

export interface DeleteKbSubfolderResult {
  /** Echoed back from the call. */
  path: string;
  /** Server uses camelCase here, not snake_case like the chat-tools handlers. */
  deletedCount: number;
  message?: string;
}

// ─── Search ─────────────────────────────────────────────────────────────────

/**
 * `web_search` dispatches on `operation`. Two modes: 'search' (returns
 * results list, optionally summarised) and 'fetch_url' (fetches a single
 * URL's content). Source: `workspace-chat-tools/tools/web_search.py`.
 */
export type WebSearchParams = WebSearchSearchParams | WebSearchFetchUrlParams;

export interface WebSearchSearchParams extends HitlParams {
  operation?: 'search';
  query: string;
  max_results?: number;
  /** What the caller's trying to accomplish — used for summary if enabled. */
  user_intent?: string;
  /** When true, server runs LLM summarisation over the snippets. */
  summarise?: boolean;
  /** Force the Playwright-backed browser fallback instead of the lightweight scraper. */
  force_playwright?: boolean;
}

export interface WebSearchFetchUrlParams extends HitlParams {
  operation: 'fetch_url';
  url: string;
  user_intent?: string;
  summarise?: boolean;
  force_playwright?: boolean;
}

export interface WebSearchResult {
  results?: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  /** Fetch-url mode returns the page content here. */
  content?: string;
  /** Hint message — e.g. "no results, try a broader query". */
  hint?: string;
  /** When summarisation runs, the LLM output. */
  summarised_content?: string;
  query?: string;
  url?: string;
  results_count?: number;
  error?: string;
  /**
   * Binary fetch_url path: browser-lambda sniffed a binary payload (PDF/zip/
   * image/...) and streamed it to S3 instead of decoding it as text. There is
   * no `content`; the CLI delivers the bytes into the workspace from
   * `download_url` (verifying `download_sha256` when stamped) or surfaces the
   * `s3_key` reference on older builds that omit the URL.
   */
  result_type?: 'binary_file';
  content_type?: string;
  s3_key?: string;
  file_type?: string;
  file_size?: number;
  download_url?: string;
  download_sha256?: string;
}

// ─── Documents (extract / transcribe / convert) ─────────────────────────────
//
// These tools all operate on WORKSPACE files (paths under `/workdir/...`),
// not KB files. They require a `conversation_id` to construct the S3 path
// where the file lives (`numa-chat/workspace/{user_sub}/conversations/
// {conversation_id}/{rel}`). The numa-cli-api dispatcher injects user_sub +
// conversation_id at the event level; workspace-chat-tools' handler then
// promotes those into `__user_sub` / `__conversation_id` on the params (see
// `lambda_function.py:497-528`). Callers don't include the `__` fields.

export interface ExtractContentParams extends HitlParams {
  /**
   * Workspace path to the file to extract from, e.g.
   * `/workdir/uploads/document.pdf`. Must start with `/workdir/`. Audio
   * and video files are auto-routed to the transcription pipeline.
   */
  file_path: string;
}

export interface ExtractContentResult {
  message: string;
  /** Workspace path of the extracted text file (always under `tmp/`). */
  output_path: string;
  /** S3 key the extracted text was written to. */
  s3_key: string;
  /** Echoed input path. */
  original_file: string;
  text_length: number;
}

/**
 * Two transcription modes — both return the same shape. Source:
 * `workspace-chat-tools/tools/transcribe.py:handle_transcribe`.
 *   - `voice`: plain text (default). Used by voice-input preprocessing.
 *   - `meeting`: speaker-diarised (`[Speaker 1]: ...` per line). Used by
 *     extract_content's audio/video routing.
 */
export interface TranscribeParams extends HitlParams {
  /** Workspace path, e.g. `/workdir/uploads/recording.mp3`. */
  file_path: string;
  /** Default `'voice'`. */
  mode?: 'voice' | 'meeting';
}

export interface TranscribeResult {
  text: string;
  /** Detected language code from Amazon Transcribe (e.g. `en-US`, `unknown`). */
  language: string;
  duration_seconds: number;
}

/**
 * Two conversion modes — pick based on input:
 *   - `markdown`: input is markdown/text → output via Pandoc + LibreOffice
 *   - `file`: direct file conversion (e.g. DOCX↔PDF) via LibreOffice
 *
 * Source: `workspace-chat-tools/tools/convert_document.py:handle_convert_document`.
 */
export interface ConvertDocumentParams extends HitlParams {
  /** Workspace path, e.g. `/workdir/outputs/draft.md` or `/workdir/uploads/x.docx`. */
  file_path: string;
  format: 'pdf' | 'docx';
  /** Default `'markdown'`. */
  mode?: 'markdown' | 'file';
  /** Optional document title (affects rendering metadata + filename). */
  title?: string;
}

export interface ConvertDocumentResult {
  message: string;
  /** Workspace path of the converted file (always under `outputs/`). */
  output_path: string;
  s3_key: string;
  original_file: string;
  format: 'pdf' | 'docx';
  mode: 'markdown' | 'file';
  /** Bytes of the converted file. */
  size: number;
}

// ─── Vision (view_image) ────────────────────────────────────────────────────
//
// `view_image` operates on a WORKSPACE file (path under `/workdir/...`), like
// the document tools. It requires `conversation_id` to construct the S3 path
// where the image lives. The numa-cli-api dispatcher injects user_sub +
// conversation_id at the event level; workspace-chat-tools' handler promotes
// those into `__user_sub` / `__conversation_id` (callers don't include `__`).
//
// Purpose: the non-multimodal Numa Standard Model can't see images natively —
// the handler reads the image and runs it through a vision model (Haiku 4.5)
// to return a textual description. Source: `workspace-chat-tools/tools/
// view_image.py:handle_view_image`.

export interface ViewImageParams extends HitlParams {
  /**
   * Workspace path to the image, e.g. `/workdir/uploads/slide.png`. Must
   * start with `/workdir/`. Supported: png, jpg/jpeg, gif, webp.
   */
  file_path: string;
  /**
   * What to look for / question to answer about the image. Optional —
   * defaults server-side to a full description.
   */
  prompt?: string;
}

export interface ViewImageResult {
  /** The vision model's textual description / answer for the image. */
  description: string;
}

// ─── Memories (user_profile) ────────────────────────────────────────────────
//
// Memory ops live on the user's chat-settings profile (DynamoDB
// `chat-settings` table, attribute `userProfile.memories`). All three
// ops require `event.allowed_tools` to include `"memories_tool"` —
// dispatcher gates on it before injecting `__user_sub`. There is
// intentionally NO delete handler today; flagged as a gap in the CLI
// session notes.
//
// Memory shape (echoed in list/add/update results):
//   { id: "mem_<12hex>", content: string ≤ 300, scope: "general" |
//     "integration:<slug>" | "agent:<agentId>", createdAt: ISO-8601,
//     source: "ai" | "user" }
//
// Source: `workspace-chat-tools/tools/user_profile.py`.

/** Scope tag — `general` for free-form, or category-prefixed. */
export type MemoryScope = 'general' | `integration:${string}` | `agent:${string}`;

export interface Memory {
  id: string;
  content: string;
  scope: MemoryScope | string;
  createdAt: string;
  /** AI-written (via these handlers) vs user-edited via the chat UI. */
  source: 'ai' | 'user' | string;
}

export interface UserProfileListMemoriesParams extends HitlParams {
  /** Optional: only return memories with this exact scope. */
  scope?: MemoryScope | string;
}

export interface UserProfileListMemoriesResult {
  memories: Memory[];
  total_count: number;
  filtered_count: number;
}

export interface UserProfileAddMemoryParams extends HitlParams {
  /** Max 300 chars (server rejects longer). */
  content: string;
  /** Defaults to `'general'` server-side. */
  scope?: MemoryScope | string;
}

export interface UserProfileAddMemoryResult {
  memory: Memory;
  total_count: number;
}

export interface UserProfileUpdateMemoryParams extends HitlParams {
  /** The `mem_…` id returned from list/add. */
  memory_id: string;
  content: string;
}

export interface UserProfileUpdateMemoryResult {
  memory: Memory;
}

export interface UserProfileDeleteMemoryParams extends HitlParams {
  /** The `mem_…` id of the memory to remove. */
  memory_id: string;
}

export interface UserProfileDeleteMemoryResult {
  /** The memory that was deleted (echoed back so the CLI can show what disappeared). */
  memory: Memory;
  /** Memories remaining on the profile after the delete. */
  total_count: number;
}

// ─── Agents ─────────────────────────────────────────────────────────────────
//
// Workspace-chat-tools' agent handlers gate on `event.allowed_tools`
// containing `"create_agent_tool"` AND require `user_email` + `user_groups`
// on the event (used for createdByName fallback + admin override on workspace
// agents). The CLI dispatcher plumbs all three through.
//
// Two-table model (see `agents.py:_map_workspace_agent` / `_map_user_agent`):
//   - `scope: 'user'`      → personal agents, stored in USER_AGENTS_TABLE.
//                            Visibility is always 'personal'.
//   - `scope: 'workspace'` → workspace-shared, stored in WORKSPACE_AGENTS_TABLE.
//                            Visibility is always 'public'.
// Choice is driven by `visibility` at create time — 'public' creates a
// workspace agent, 'personal' creates a user agent.
//
// IMPORTANT: there's no separate delete tool in the Python before this
// session — we added `handle_delete_agent` alongside the existing five
// handlers, same as we did for memories.

/** Agent scope — which DynamoDB table backs it (server-derived from visibility). */
export type AgentScope = 'user' | 'workspace';

export type AgentVisibility = 'personal' | 'public';

/**
 * Per-agent tools toggle config. Mirror of `_normalise_tools_config` in
 * agents.py. Optional fields default server-side. `approvalMode` /
 * `approvalModes` exist but are intentionally untyped here — they're a
 * loose record the handler preserves verbatim.
 */
export interface AgentToolsConfig {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  /** Pipedream / native integration slugs the agent can call. */
  enabledConnections?: string[];
  /** KB ids the agent is scoped to. `null` = unrestricted. */
  allowedKnowledgeBases?: string[] | null;
  approvalMode?: string;
  approvalModes?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Reference file pinned to an agent (uploaded once, kept across
 * conversations). Server stores 5 max per agent (server-enforced).
 */
export interface AgentReferenceFile {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  s3Key: string;
  s3Bucket?: string;
  /** S3 key of extracted-text companion file, when extract_content ran on it. */
  extractedContentS3Key?: string | null;
  uploadedAt?: number;
  source?: 'workspace' | 'upload' | string;
}

/**
 * Canonical Agent shape — what all list/get/create/update/duplicate/delete
 * handlers return inside `{ agent: ... }`. `list_agents` trims `systemPrompt`
 * to 200 chars and drops most ref-file fields; `get_agent` returns the full
 * record.
 */
export interface Agent {
  agentId: string;
  scope: AgentScope;
  visibility: AgentVisibility | string;
  agentType: string;
  title: string;
  description?: string | null;
  /** Trimmed to 200 chars in `list_agents`; full text in `get_agent`. */
  systemPrompt?: string;
  userWelcomeMessage?: string | null;
  estimatedTimeSavedMinutes?: number | null;
  isFavorite?: boolean | null;
  icon?: string | null;
  iconImage?: { s3Bucket?: string; s3Key?: string } | null;
  requiredIntegrations: string[];
  toolsConfig: AgentToolsConfig;
  referenceFiles: AgentReferenceFile[];
  createdBy: { userId?: string; name?: string };
  createdAt?: number;
  updatedAt?: number;
  version?: number;
  /** Only on user agents — the workspace/personal id the duplicate was forked from. */
  sourceAgentId?: string;
}

// ── list ────────────────────────────────────────────────────────────────────

export interface ListAgentsParams extends HitlParams {
  /**
   * Default `'owned'` — agents the user created.
   *   - `owned`  → personal agents + workspace agents created by user
   *   - `public` → workspace agents shared across the tenant
   *   - `all`    → both
   */
  scope?: 'owned' | 'public' | 'all';
  /** Case-insensitive filter on `agentType`. */
  agent_type?: string;
  /** Case-insensitive substring of title. */
  title?: string;
  /** Case-insensitive substring across title/description/tags. */
  search?: string;
  /** Max items; capped server-side at 200. 0 (default) = no limit. */
  limit?: number;
  offset?: number;
}

export interface ListAgentsResult {
  agents: Agent[];
  pagination?: { total: number; limit: number; offset: number; hasMore: boolean };
}

// ── get ─────────────────────────────────────────────────────────────────────

export interface GetAgentParams extends HitlParams {
  agent_id: string;
}

export interface GetAgentResult {
  agent: Agent;
}

// ── create ──────────────────────────────────────────────────────────────────

export interface CreateAgentParams extends HitlParams {
  title: string;
  /** Required, non-empty after trim. Max length not enforced server-side. */
  systemPrompt: string;
  /** Default `'personal'`. `'public'` creates a workspace-shared agent. */
  visibility?: AgentVisibility;
  description?: string;
  /** Default `'task'`. Free-form string. */
  agentType?: string;
  userWelcomeMessage?: string;
  estimatedTimeSavedMinutes?: number;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string };
  requiredIntegrations?: string[];
  toolsConfig?: AgentToolsConfig;
  /** Server caps at 5. Use `attachFiles` if you want to attach from workspace paths. */
  referenceFiles?: AgentReferenceFile[];
  /**
   * Workspace paths (`/workdir/...`) to attach as reference files. Server
   * copies them from the conversation's S3 prefix to the agent's prefix
   * and merges into `referenceFiles`. REQUIRES `__conversation_id` —
   * fails otherwise.
   */
  attachFiles?: string[];
  /** Display name for `createdBy.name`. Defaults to user_email if absent. */
  createdByName?: string;
}

export interface CreateAgentResult {
  agent: Agent;
  /** Skipped attachments / S3 errors. Present only when `attachFiles` was used. */
  fileWarnings?: string[];
}

// ── update ──────────────────────────────────────────────────────────────────

/** Same fields as create, all optional except `agent_id`. */
export interface UpdateAgentParams extends HitlParams {
  agent_id: string;
  title?: string;
  systemPrompt?: string;
  visibility?: AgentVisibility;
  description?: string;
  agentType?: string;
  userWelcomeMessage?: string;
  estimatedTimeSavedMinutes?: number;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string };
  requiredIntegrations?: string[];
  toolsConfig?: AgentToolsConfig;
  referenceFiles?: AgentReferenceFile[];
  attachFiles?: string[];
  isFavorite?: boolean;
}

export interface UpdateAgentResult {
  agent: Agent;
  fileWarnings?: string[];
}

// ── patch_agent_prompt ──────────────────────────────────────────────────────

/**
 * Edit-tool-style find/replace against `system_prompt`. Cheaper than
 * `update_agent` for long prompts — only the diff travels over output
 * tokens. Server-side enforces unique match unless `replace_all=true`.
 */
export interface PatchAgentPromptParams extends HitlParams {
  agent_id: string;
  /** Required non-empty. Must match exactly (whitespace, punctuation, case). */
  old_text: string;
  /** Use `''` to delete the matched span. */
  new_text: string;
  /** When false (default), 0 or >1 matches → error. */
  replace_all?: boolean;
}

export interface PatchAgentPromptResult {
  agent: Agent;
}

// ── duplicate ───────────────────────────────────────────────────────────────

export interface DuplicateAgentParams extends HitlParams {
  /** Either a personal or workspace agent id. Result is always a personal agent. */
  agent_id: string;
}

export interface DuplicateAgentResult {
  /** Always a `scope: 'user'` agent with `sourceAgentId` pointing back to the source. */
  agent: Agent;
}

// ── delete ──────────────────────────────────────────────────────────────────

export interface DeleteAgentParams extends HitlParams {
  agent_id: string;
}

export interface DeleteAgentResult {
  /** Echoes the agent that was deleted so the CLI can show what disappeared. */
  agent: Agent;
}

// ─── Integrations (Pipedream + native) ──────────────────────────────────────
//
// Two MCP tool families today (see `services/numa-workspace-agent/
// numa_workspace_agent/mcp_tools/`):
//   - `mcp__integrations__*` (Pipedream) → `pipedream_run_action`,
//     `pipedream_configure_props`, `pipedream_proxy_request`. Routed through
//     `workspace-chat-tools` Lambda.
//   - `mcp__connectors__*` (native) → single `connectors` dispatcher with
//     `status`, `request`, etc. Routed through a DIFFERENT Lambda:
//     `oauth_workspace_tools`. Event shape: `{tool, user_sub,
//     conversation_id, params}`.
//
// Per-user, each integration slug has EXACTLY ONE method active at a time —
// the catalog may list a service on both rows (e.g. Google Drive as both
// pipedream and native), but what's enabled per-conversation picks one. The
// CLI reads `[{slug, method, name}]` from the resolved scope and routes
// based on the method tag.
//
// Tool gating:
//   - Pipedream tools require the integration slug in `event.allowed_tools`
//     (e.g. `"gmail"` for `gmail-send-email`). Same pattern as
//     `memories_tool` / `create_agent_tool`.
//   - Native tools have no `allowed_tools` gate — `oauth_workspace_tools`
//     enforces per-`user_sub` ownership.

export type IntegrationMethod = 'pipedream' | 'native';

// ── Pipedream — pipedream_list_actions ─────────────────────────────────────

export interface PipedreamListActionsParams extends HitlParams {
  /** App slug (e.g. `gmail`, `slack`, `google_drive`). */
  app_slug: string;
  /** Pipedream Connect external user id — usually `<client>_<user_sub>`. Server
   * fills this in when missing in CLI flow. */
  external_user_id?: string;
}

export interface PipedreamActionIndexEntry {
  key: string;
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
  prop_count?: number;
  file?: string;
}

export interface PipedreamListActionsResult {
  /** Same shape `_index.json` stores at `/workdir/tools/integrations/<slug>/`. */
  actions: PipedreamActionIndexEntry[];
}

// ── Pipedream — pipedream_batch_get_schemas ────────────────────────────────

export interface PipedreamBatchGetSchemasParams extends HitlParams {
  app_slugs: string[];
  external_user_id?: string;
}

export interface PipedreamBatchGetSchemasResult {
  schemas: Record<string, { actions: unknown[]; index?: PipedreamActionIndexEntry[] }>;
}

// ── Pipedream — pipedream_configure_props ──────────────────────────────────

export interface PipedreamConfigurePropsParams extends HitlParams {
  /** Action key e.g. `gmail-send-email`. */
  action_key: string;
  /** Prop to populate. */
  prop_name: string;
  /** What's been configured so far (some dropdowns depend on earlier picks). */
  configured_props: Record<string, unknown>;
  external_user_id?: string;
}

/**
 * Pipedream's `configure_props` return shape varies by prop type — the handler
 * passes through whatever the relay returns verbatim. Common shapes:
 *   - String props with dynamic options: `{stringOptions: string[]}`
 *   - Object props (record dropdowns):    `{options: [{label, value}, ...]}`
 *   - Reload-props side-effects:          may include `dynamicProps` (rerun list)
 * Plus diagnostic fields (`observations`, `timings`, `t`) that wrap every
 * response. We type the well-known fields and allow anything else through.
 */
export interface PipedreamConfigurePropsResult {
  /** Object-shaped dropdown options (label/value pairs). */
  options?: Array<{ label?: string; value?: unknown; [key: string]: unknown }>;
  /** String dropdown options (e.g. Gmail send-as aliases). */
  stringOptions?: string[];
  /** Reload-props payload — present when the prop change triggers a schema reload. */
  dynamicProps?: { configurable_props?: unknown[] } & Record<string, unknown>;
  /** Diagnostic observations from the relay (non-blocking warnings). */
  observations?: unknown[];
  /** Timing data (lambda_configure_prop_called, lambda_done, etc.). */
  timings?: Record<string, number>;
  t?: Record<string, number>;
  [key: string]: unknown;
}

// ── Pipedream — pipedream_run_action ───────────────────────────────────────

export interface PipedreamRunActionParams extends HitlParams {
  action_key: string;
  configured_props: Record<string, unknown>;
  /** Human-readable description shown in the approval card (HITL). */
  description: string;
  /** Optional file-stash id (use `'NEW'` for first file download). */
  stash_id?: string | null;
  external_user_id?: string;
}

export interface PipedreamRunActionResult {
  /** Wrapper status — distinct from upstream HTTP status. */
  status?: 'success' | 'denied' | 'timeout' | 'execution_failed' | 'already_executed' | string;
  /** Approval id used by the SSE flow; informational here. */
  approval_id?: string;
  /** Whatever the upstream returned. Shape varies wildly per action. */
  result?: unknown;
  /** Error message when status != success. */
  message?: string;
  deny_reason?: string;
}

// ── Pipedream — pipedream_proxy_request ────────────────────────────────────

export interface PipedreamProxyRequestParams extends HitlParams {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  upstream_url: string;
  /** Slug for auth + gating. Must match an enabled Pipedream integration. */
  integration_slug: string;
  description: string;
  body?: unknown;
  headers?: Record<string, string>;
  external_user_id?: string;
}

/** Same wrapper shape as run_action. */
export type PipedreamProxyRequestResult = PipedreamRunActionResult;

// ── Native — connect_request (via oauth_workspace_tools) ───────────────────

export interface ConnectRequestParams extends HitlParams {
  /** Slug of the native connector (e.g. `googledrive`, `synergy`, `xero`). */
  connector: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Full upstream URL. */
  url: string;
  description: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ConnectRequestResult {
  result?: {
    status_code?: number;
    body?: unknown;
    headers?: Record<string, string>;
    description?: string;
  };
  error?: string;
  error_code?: string;
}

// ── Native — connect_status ────────────────────────────────────────────────

export interface ConnectStatusParams extends HitlParams {
  /** Optional — when set, returns just this connector's status. */
  connector?: string;
}

export interface ConnectStatusEntry {
  status: 'connected' | 'disconnected' | 'awaiting_credential' | string;
  auth_type?: 'oauth' | 'iam' | 'api_key' | string;
  display_name?: string;
  connect_url?: string;
  pending_hint?: string;
  credential_fields?: unknown[];
}

/** Server returns a map of connector-slug → status entry. */
export type ConnectStatusResult = Record<string, ConnectStatusEntry>;

// ─── Ops — generic operation pass-through ──────────────────────────────────
//
// The ops surface has 50+ operations (tickets, boards, customers, suppliers,
// projects, custom fields, statuses, work units, etc.). Rather than spinning
// up a typed wrapper per op, we pass through generically — the CLI shapes
// the tool name as `ops_<operation>` and the server-side dispatcher in
// `workspace-chat-tools/lambda_function.py` routes any `ops_*` to the
// generic `handle_ops_operation` Python handler. Same code path the MCP
// `mcp__numa__numa_ops_tool` uses today.
//
// Approval model:
//   - Safe ops (list_*, get_*, search_*): no approval needed, auto-approved
//   - Unsafe ops (create_*, update_*, delete_*, add_comment, upload_attachment):
//     require approval. Locally, the CLI prompts via the terminal; in
//     workspace, the SDK's Bash PreToolUse hook emits the SSE approval card
//     (planned, Phase 2 of the workspace integration).

/** Safe (read-only) ops operations — auto-approved server-side. */
export const SAFE_OPS_OPERATIONS = [
  'get_config',
  'list_boards',
  'get_board',
  'list_tickets',
  'get_ticket',
  'search_tickets',
  'list_comments',
  'get_audit',
  'list_work_units',
  'list_customers',
  'get_customer',
  'list_suppliers',
  'get_supplier',
  'list_projects',
  'get_metrics',
] as const;

export type OpsOperation = string;

export interface OpsOperationParams extends HitlParams {
  /** Op-specific payload (whatever the underlying handler expects). */
  params?: Record<string, unknown>;
  /** Human-readable description shown in the approval card (HITL). */
  description?: string;
  request_id?: string;
}

/**
 * Response shape is operation-specific. The wrapper status fields below
 * (status/message/etc.) match the approval-handling envelope; the actual
 * domain payload (ticket list, board details, etc.) lives in `result`.
 */
export interface OpsOperationResult {
  status?: 'success' | 'denied' | 'timeout' | string;
  approval_id?: string;
  message?: string;
  deny_reason?: string;
  result?: unknown;
  [key: string]: unknown;
}

// ─── Discriminated union ────────────────────────────────────────────────────

/**
 * The CLI's tool-call envelope, discriminated on `tool`. TypeScript narrows
 * `params` automatically once the literal tool name is known:
 *
 *   const c: ToolCall = { tool: 'add_to_kb', params: { ... } };
 *                                                       ^^^^^
 *   ← params is AddToKbParams here, not a record-of-unknown
 */
export type ToolCall =
  | { tool: 'query_knowledgebase'; params: QueryKnowledgebaseParams }
  | { tool: 'list_kb_files'; params: ListKbFilesParams }
  | { tool: 'retrieve_kb_file'; params: RetrieveKbFileParams }
  | { tool: 'add_to_kb'; params: AddToKbParams }
  | { tool: 'delete_kb_file'; params: DeleteKbFileParams }
  | { tool: 'move_kb_file'; params: MoveKbFileParams }
  | { tool: 'rename_kb_file'; params: RenameKbFileParams }
  | { tool: 'create_kb_subfolder'; params: CreateKbSubfolderParams }
  | { tool: 'delete_kb_subfolder'; params: DeleteKbSubfolderParams }
  | { tool: 'web_search'; params: WebSearchParams }
  | { tool: 'extract_content'; params: ExtractContentParams }
  | { tool: 'transcribe'; params: TranscribeParams }
  | { tool: 'convert_document'; params: ConvertDocumentParams }
  | { tool: 'view_image'; params: ViewImageParams }
  | { tool: 'user_profile_list_memories'; params: UserProfileListMemoriesParams }
  | { tool: 'user_profile_add_memory'; params: UserProfileAddMemoryParams }
  | { tool: 'user_profile_update_memory'; params: UserProfileUpdateMemoryParams }
  | { tool: 'user_profile_delete_memory'; params: UserProfileDeleteMemoryParams }
  | { tool: 'list_agents'; params: ListAgentsParams }
  | { tool: 'get_agent'; params: GetAgentParams }
  | { tool: 'create_agent'; params: CreateAgentParams }
  | { tool: 'update_agent'; params: UpdateAgentParams }
  | { tool: 'patch_agent_prompt'; params: PatchAgentPromptParams }
  | { tool: 'duplicate_agent'; params: DuplicateAgentParams }
  | { tool: 'delete_agent'; params: DeleteAgentParams }
  | { tool: 'pipedream_list_actions'; params: PipedreamListActionsParams }
  | { tool: 'pipedream_batch_get_schemas'; params: PipedreamBatchGetSchemasParams }
  | { tool: 'pipedream_configure_props'; params: PipedreamConfigurePropsParams }
  | { tool: 'pipedream_run_action'; params: PipedreamRunActionParams }
  | { tool: 'pipedream_proxy_request'; params: PipedreamProxyRequestParams }
  | { tool: 'connect_request'; params: ConnectRequestParams }
  | { tool: 'connect_status'; params: ConnectStatusParams }
  // Ops uses a dynamic tool name pattern (`ops_<operation>`) — template
  // literal type captures the convention without enumerating all 50+ ops.
  // Server-side dispatcher routes anything prefixed `ops_` to a single
  // generic handler.
  | { tool: `ops_${string}`; params: OpsOperationParams };

export type ToolName = ToolCall['tool'];

/**
 * Result type for a given tool name. Conditional mapped type — feed in a
 * `ToolName` literal and get back the matching result shape.
 *
 *   type R = ToolResult<'query_knowledgebase'>; // QueryKnowledgebaseResult
 */
export type ToolResult<T extends ToolName> = T extends 'query_knowledgebase'
  ? QueryKnowledgebaseResult
  : T extends 'list_kb_files'
    ? ListKbFilesResult
    : T extends 'retrieve_kb_file'
      ? RetrieveKbFileResult
      : T extends 'add_to_kb'
        ? AddToKbResult
        : T extends 'delete_kb_file'
          ? DeleteKbFileResult
          : T extends 'move_kb_file'
            ? MoveKbFileResult
            : T extends 'rename_kb_file'
              ? RenameKbFileResult
              : T extends 'create_kb_subfolder'
                ? CreateKbSubfolderResult
                : T extends 'delete_kb_subfolder'
                  ? DeleteKbSubfolderResult
                  : T extends 'web_search'
                    ? WebSearchResult
                    : T extends 'extract_content'
                      ? ExtractContentResult
                      : T extends 'transcribe'
                        ? TranscribeResult
                        : T extends 'convert_document'
                          ? ConvertDocumentResult
                          : T extends 'view_image'
                            ? ViewImageResult
                            : T extends 'user_profile_list_memories'
                              ? UserProfileListMemoriesResult
                              : T extends 'user_profile_add_memory'
                                ? UserProfileAddMemoryResult
                                : T extends 'user_profile_update_memory'
                                  ? UserProfileUpdateMemoryResult
                                  : T extends 'user_profile_delete_memory'
                                    ? UserProfileDeleteMemoryResult
                                    : T extends 'list_agents'
                                      ? ListAgentsResult
                                      : T extends 'get_agent'
                                        ? GetAgentResult
                                        : T extends 'create_agent'
                                          ? CreateAgentResult
                                          : T extends 'update_agent'
                                            ? UpdateAgentResult
                                            : T extends 'patch_agent_prompt'
                                              ? PatchAgentPromptResult
                                              : T extends 'duplicate_agent'
                                                ? DuplicateAgentResult
                                                : T extends 'delete_agent'
                                                  ? DeleteAgentResult
                                                  : T extends 'pipedream_list_actions'
                                                    ? PipedreamListActionsResult
                                                    : T extends 'pipedream_batch_get_schemas'
                                                      ? PipedreamBatchGetSchemasResult
                                                      : T extends 'pipedream_configure_props'
                                                        ? PipedreamConfigurePropsResult
                                                        : T extends 'pipedream_run_action'
                                                          ? PipedreamRunActionResult
                                                          : T extends 'pipedream_proxy_request'
                                                            ? PipedreamProxyRequestResult
                                                            : T extends 'connect_request'
                                                              ? ConnectRequestResult
                                                              : T extends 'connect_status'
                                                                ? ConnectStatusResult
                                                                : T extends `ops_${string}`
                                                                  ? OpsOperationResult
                                                                  : never;

/**
 * Extracts the params type for a given tool name. Useful for typing
 * helpers that construct or normalise per-tool params.
 */
export type ParamsForTool<T extends ToolName> = Extract<ToolCall, { tool: T }>['params'];
