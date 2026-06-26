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
  /**
   * Synergy only: which corpus to search. Omit/"document" = per-document content
   * (default); "job_rollup" = per-job similarity records ("find similar jobs").
   */
  doc_type?: string;
  /**
   * Synergy only: structured metadata filters combined with the semantic query
   * for breadth search. Whitelisted server-side (anything else ignored). Keys:
   * `created_after` / `created_before` (ISO dates), `parent_job_id` (string),
   * `is_template` (boolean).
   */
  structured_filters?: Record<string, unknown>;
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
  /** Drill into a subfolder of the KB (e.g. `reports/2024`). Root if omitted. */
  subpath?: string;
  /** Walk the full tree (`ls -R`) instead of one level. Default false. */
  recursive?: boolean;
  /** Cap on files returned per KB. Defaults to the prompt-context limit (30). */
  max_items?: number;
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
  /**
   * fnmatch-style pattern matched against both the basename and the
   * KB-relative path, so `*.pdf`, `reports/*.csv` and `**\/*.md` all work.
   * Optional.
   */
  pattern?: string;
  /** Walk all subfolders. `find` sets this so matches aren't limited to root. */
  recursive?: boolean;
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
    /** KB-relative path of the match (e.g. `reports/q3.csv`); basename at root. */
    relpath?: string;
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
 * Two conversion modes, auto-detected from the input extension server-side:
 *   - `file`: binary Office/PDF inputs (`.pptx`/`.docx`/`.xlsx`/`.pdf`/…) →
 *     direct LibreOffice conversion. Forced for these formats regardless of input.
 *   - `markdown`: text/markdown inputs (`.md`/`.txt`) → Pandoc + LibreOffice.
 *
 * Source: `workspace-chat-tools/tools/convert_document.py:handle_convert_document`.
 */
export interface ConvertDocumentParams extends HitlParams {
  /** Workspace path, e.g. `/workdir/outputs/draft.md` or `/workdir/uploads/x.docx`. */
  file_path: string;
  format: 'pdf' | 'docx';
  /** Optional override — auto-detected from the input extension when omitted. */
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
  /**
   * Presigned GET for the converted file. The conversion runs server-side, so
   * the bytes only exist in S3 — the in-workspace CLI uses this to materialise
   * the file at `output_path` under `/workdir` for same-turn use.
   */
  presigned_url?: string;
  /** sha256 of the converted bytes, for end-to-end verification of the pull. */
  download_sha256?: string;
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
  /**
   * Optional base64-encoded image bytes. The CLI populates this for files it
   * can read locally in the workspace container, so the server-side tool can
   * describe agent-GENERATED images that haven't synced to S3 yet. When absent,
   * the server reads the file from the conversation's workspace S3 prefix.
   */
  image_b64?: string;
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
  memoriesEnabled?: boolean;
  numaOpsEnabled?: boolean;
  /** Legacy flat integration-slug list. Kept in parallel with `enabledIntegrations`. */
  enabledConnections?: string[];
  /** Method-tagged integration rows — the source of truth. */
  enabledIntegrations?: { slug: string; method: 'pipedream' | 'native'; name: string }[];
  /** KB ids the agent is scoped to. `null` = unrestricted, `[]` = none. */
  allowedKnowledgeBases?: string[] | null;
  /** Global default approval mode. */
  approvalMode?: 'always' | 'non_destructive' | 'never';
  /** Per-category approval: keys integrations|agents|memories|knowledgeBases|ops|connectors. */
  approvalModes?: Record<string, 'always' | 'non_destructive' | 'never'>;
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
  /** Free-form labels (server caps at 20, dedupes). */
  tags?: string[];
  /** Taxonomy-validated: CEO|Finance|HR|Operations|Commercial. */
  personas?: string[];
  /** Taxonomy-validated: Manufacturing|Construction|Engineering|Professional Services|Franchise. */
  industries?: string[];
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
  tags?: string[];
  personas?: string[];
  industries?: string[];
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

// ── Native — connect_soap_credentials (via oauth_workspace_tools) ────────────
//
// AutoPlay-only. Hands the agent the company-level SOAP credentials AutoPlay's
// Lead API needs (its auth must be embedded in the SOAP <Authentication>
// envelope, not as an HTTP header — the generic request path can't do that).
// Deliberate credential disclosure, HARD-gated server-side on TWO admin opt-ins
// stored on the AutoPlay connector config: `soap_token_passthrough == 'true'`
// AND `lead_api_enabled == 'true'`. The connector is pinned to `autoplay` — no
// other slug can reach this path. If any gate fails the handler returns an auth
// error and exposes nothing. user_sub is dispatcher-injected. Source:
// `lambdas/python/oauth-workspace-tools/tools/connect_tools.py:
// handle_connect_soap_credentials`.

export interface ConnectSoapCredentialsParams extends HitlParams {
  /** Native connector slug — only `autoplay` is permitted. Defaults to `autoplay`. */
  connector?: string;
}

/**
 * Standard `{status, result, error}` envelope server-side; the CLI surfaces
 * `result` as this shape on success. On any gate failure the handler returns
 * `status: 'error'` with `result` null and NOTHING about the credentials leaks.
 */
export interface ConnectSoapCredentialsResult {
  connector: string;
  /** SOAP endpoint base URL (admin override, else AutoPlay's fixed Lead API URL). */
  base_url: string;
  /** Company-level SOAP API key — embedded in the <Authentication> envelope. */
  api_key: string;
  /** Company-level SOAP API token — embedded in the <Authentication> envelope. */
  api_token: string;
  /** Dealership identifier (may be empty string when the admin didn't set it). */
  dealership_id: string;
  /** Yard identifier (may be empty string when the admin didn't set it). */
  yard_id: string;
}

// ── Native — connector file browsing (Synergy + OAuth cloud storage) ────────
//
// Restores the file ops the MCP `connect.py` tool exposed before the MCP→CLI
// migration (commit 6bebe5603) deleted them. Two backends, one surface:
//   - Synergy 12d  → `connect_synergy_{list,search,download}` (jobs-as-folders;
//                     folder_id uses `job:{id}` / `folder:{id}` prefixes).
//   - OAuth cloud storage (Google Drive / Gmail / OneDrive / Dropbox) →
//     `oauth_{list_files,search_files,download_file,get_file_metadata}`, keyed
//     by a `provider` param (== the connector slug).
// All read-only / auto-approved. The CLI's `numa integrations list-files`
// etc. pick the right tool per connector. user_sub is dispatcher-injected.
// Source: `lambdas/python/oauth-workspace-tools/tools/{connect,oauth}_tools.py`.

export interface ConnectorFolderEntry {
  /** Opaque, backend-scoped id. Synergy prefixes with `job:` / `folder:`. */
  folder_id: string;
  name: string;
  path?: string;
  has_subfolders?: boolean;
  no_of_subfolders?: number | null;
  [key: string]: unknown;
}

export interface ConnectorFileEntry {
  file_id: string;
  name: string;
  size?: number | null;
  content_type?: string | null;
  modified_at?: string | null;
  path?: string;
  web_view_link?: string;
  [key: string]: unknown;
}

/** Shared list/search result shape. `connector` (Synergy) or `provider` (OAuth). */
export interface ConnectorListResult {
  folders: ConnectorFolderEntry[];
  files: ConnectorFileEntry[];
  total_count: number;
  connector?: string;
  provider?: string;
  /** OAuth providers paginate; Synergy omits this. */
  next_page_token?: string | null;
  /** Echoed back on search. */
  query?: string;
  /** Synergy: true when the all-pages fetch hit its safety cap (more jobs exist). */
  truncated?: boolean;
}

/**
 * Download result. The bytes ride one of two ways (the `build_download_payload`
 * inline-or-staged shape): small files inline as `file_content` (hex) with a
 * `content_sha256`; large files as a presigned `file_content_url` (+ sha256).
 * `workspace_path` is the suggested in-workspace destination.
 */
export interface ConnectorDownloadResult {
  filename: string;
  size: number;
  connector?: string;
  provider?: string;
  original_file_id?: string;
  workspace_path?: string;
  /** Inline hex-encoded bytes (small files). */
  file_content?: string;
  /** Presigned S3 URL (large files). */
  file_content_url?: string;
  /** sha256 of the file bytes — present on BOTH inline and presigned paths. */
  content_sha256?: string;
  s3_key?: string;
}

/** OAuth-only single-file metadata (Synergy has no separate endpoint). */
export interface ConnectorFileMetadataResult {
  name: string;
  size?: number;
  content_type?: string;
  modified_at?: string;
  created_at?: string;
  path?: string;
  checksum?: string;
  version?: string;
  file_id: string;
  provider: string;
  [key: string]: unknown;
}

export interface ConnectSynergyListParams extends HitlParams {
  /** Empty/omitted = list jobs; `job:{id}` = job folders; `folder:{id}` = items. */
  folder_id?: string;
  /** Filter jobs by name at the root level. */
  query?: string;
  page_size?: number;
}

/** Read-only Synergy metadata: structural counts + attributes for one job. */
export interface ConnectSynergyJobMetaParams extends HitlParams {
  /** Bare job IDString (e.g. "8_1"), from list-files / search. */
  job_id: string;
}

/** Read-only Synergy metadata: subfolder + file counts for one folder. */
export interface ConnectSynergyFolderSummaryParams extends HitlParams {
  /** Bare folder id, from a job's folder listing. */
  folder_id: string;
}

/**
 * Read-only Synergy metadata: the attribute / type / enum / category vocabulary.
 *
 * Wave 2 EXTENSION (instead of a separate `connect_synergy_vocab`): the original
 * zero-arg behaviour (standard + standard-search JOB attributes) stays the
 * default mode, so existing callers are unaffected. New modes expose the
 * per-entity searchable+system attribute sets, the decode enums
 * (attributeTypes / matchOperations / entityTypes / file / folder / folderStates
 * / noteTargetTypes + a named enum), the category taxonomy, single-attribute
 * resolution by name+context, and an attribute's valid enum choices. Read-only.
 */
export interface ConnectSynergySchemaParams extends HitlParams {
  /**
   * Which slice of the vocabulary to return. `job` (default when omitted →
   * standard + standard-search job attributes, the original behaviour; explicit
   * `job` also adds default-search + defined-search + system job attributes),
   * `file` / `contact` (per-entity searchable + system attributes), `types`
   * (decode enums + a named enum via type_name), `categories` (taxonomy),
   * `find` (one attribute by name + context), `choices` (valid enum choices for
   * an attribute). Omitted → `job` default for backward compatibility.
   */
  mode?: 'job' | 'file' | 'contact' | 'types' | 'categories' | 'find' | 'choices';
  /** Entity scope for attribute lookups (drives file/contact, maps to search_context for find). Default `job`. */
  entity?: 'job' | 'file' | 'contact';
  /** Attribute name to resolve (mode=find) or the attribute ref (mode=choices). */
  name?: string;
  /** Named enum to resolve via GET /types?type_name=… (mode=types). Omitted → the fixed decode-enum set. */
  type_name?: string;
  /** File extension (e.g. `dwg`) for the system file-attributes call (mode=file). Omitted → skipped. */
  extension?: string;
}

/** Read-only Synergy metadata: detail for one file (powers `file-info synergy`) + Wave 3 access / by-name / version-N modes. */
export interface ConnectSynergyFileInfoParams extends HitlParams {
  /**
   * Wave 3: info (default — file metadata, existing behaviour) | permission
   * (caller's permission on the file) | access (users + groups, merged) |
   * by-name (lookup by name within a folder, needs name+folder_id) | version
   * (one historical version's metadata, needs version). Inferred from
   * name/folder_id/version when omitted.
   */
  mode?: 'info' | 'permission' | 'access' | 'by-name' | 'version';
  /** File IDString — required for info / permission / access / version modes. */
  file_id?: string;
  /** Wave 3 (mode=by-name): file name to look up — URL-encoded server-side. */
  name?: string;
  /** Wave 3 (mode=by-name): the folder id to look the name up within. */
  folder_id?: string;
  /** Wave 3 (mode=version): the version number to fetch metadata for. */
  version?: number;
  /** Wave 3: include custom attributes in by-name/version reads (default true). */
  retrieve_attributes?: boolean;
  /** Wave 3 (mode=by-name): also flatten parent-folder attributes (default false). */
  retrieve_flatten_parent_attributes?: boolean;
}

/** Read-only Synergy aggregate: counts + file-type mix + size buckets for a job. */
export interface ConnectSynergyJobStatsParams extends HitlParams {
  job_id: string;
}

/** Read-only Synergy aggregate: a job's folder outline (depth-bounded). */
export interface ConnectSynergyJobTreeParams extends HitlParams {
  job_id: string;
  max_depth?: number;
}

/**
 * Exact-term search (4th mode): which jobs contain these literal words/codes,
 * ACL-enforced + exhaustive. Reads the crawl TERM index. `terms` are normalized
 * server-side with the same tokenizer the crawler indexed with.
 */
export interface ConnectSynergyExactTermParams extends HitlParams {
  terms: string[];
  /** AND (all terms) or OR (any term). Default AND. */
  mode?: 'AND' | 'OR';
  limit?: number;
}

/**
 * Exhaustive structured/portfolio query over crawled jobs (counts + list by
 * attribute, ACL-enforced). Reads the crawl JOB# table, not the semantic KB —
 * flag-gated on synergyKbCrawl. `attrs` keys are stamped `attr_<snake>` keys.
 */
export interface ConnectSynergyPortfolioParams extends HitlParams {
  attrs?: Record<string, string>;
  created_after?: string;
  created_before?: string;
  exclude_templates?: boolean;
  /** A stamped key to facet-count by, e.g. `attr_status` / `is_template`. */
  group_by?: string;
  limit?: number;
}

// ── Wave 1 read-only Synergy tools (PAT-scoped live reads; no Numa ACL, no
//    metering). 12d enforces permissions on the user's PAT. Each mirrors the
//    `connect_synergy_job_meta` pattern: defensively-parsed live 12d responses,
//    standard {status,result,error} envelope server-side. Several response
//    schemas are `[UNKNOWN]` (Swagger-200-only) and parsed defensively. ──────

/** Read-only Synergy: tasks on a job (owner, state, due dates) + Wave 3 single-task detail / task vocab. */
export interface ConnectSynergyTasksParams extends HitlParams {
  /**
   * Wave 3: list (default — job tasks, existing behaviour) | detail (one task +
   * children/history, needs task_id) | vocab (task types + states, needs
   * task_type_id). Inferred from task_id / task_type_id when omitted.
   */
  mode?: 'list' | 'detail' | 'vocab';
  /** Job id — accepts bare `8_1` or `job:`/`folder:` prefixed. Required for list mode. */
  job_id?: string;
  /** Filter by assignee EntityID — forces the POST /tasks/search path (list mode). */
  assignee_id?: string;
  /** Include closed tasks (default false = open only); any value forces search (list mode). */
  include_closed?: boolean;
  /** Wave 3: single-task id → detail mode (one task + children/history). */
  task_id?: string;
  /** Wave 3: task-type id → vocab mode (states/types for a task type). */
  task_type_id?: string;
  /** Client-side truncation cap (default 200). */
  limit?: number;
}

/** Read-only Synergy: people on a job / directory lookup (Wave 3 adds full directory + global lists). */
export interface ConnectSynergyContactsParams extends HitlParams {
  /**
   * job = contacts on a job; search = directory lookup; get = single contact;
   * Wave 3: directory = the full paged address book; global-lists = the global
   * contact lists. Inferred if omitted.
   */
  mode?: 'job' | 'search' | 'get' | 'directory' | 'global-lists';
  /** Required for mode=job (accepts bare or `job:`/`folder:` prefixed). */
  job_id?: string;
  /** Required for mode=get — a contact id (reject `job:`/`folder:` prefixes). */
  contact_id?: string;
  /** Free-text directory search (simpleSearch path). */
  query?: string;
  /** Structured search fields (Contacts/search path). */
  first_name?: string;
  last_name?: string;
  email?: string;
  /** Restrict to 12d user contacts only (default false). */
  users_only?: boolean;
  /** Wave 3 (mode=directory): 1-based start page for the paged address-book walk (default 1). */
  page?: number;
  /** Page size for structured search / directory walk (default 50). */
  page_size?: number;
}

/** Read-only Synergy: issues / RFIs on a job, or detail for one issue. */
export interface ConnectSynergyIssuesParams extends HitlParams {
  /** List mode — job id (accepts bare or `job:`/`folder:` prefixed). Exactly one of job_id/issue_id. */
  job_id?: string;
  /** Detail mode — issue ticket id. Exactly one of job_id/issue_id. */
  issue_id?: string;
  /** List paging (default 1). */
  page?: number;
  /** List page size (default 50; walk bounded + truncated). */
  page_size?: number;
  /** Detail: retrieve full issue details (default true). */
  retrieve_details?: boolean;
  /** Detail: also fetch the issue change log (default false). */
  include_changes?: boolean;
}

/** Read-only Synergy: workflow status (definitions / live instance / log / diagram). */
export interface ConnectSynergyWorkflowParams extends HitlParams {
  /** definitions = all workflows; definition = one; instance = live state; transition_log; diagram = staged image. Default definitions (or instance if entity_id present). */
  mode?: 'definitions' | 'definition' | 'instance' | 'transition_log' | 'diagram';
  /** Workflow id (definition / instance / diagram modes). */
  workflow_id?: string;
  /** The entity the workflow runs on (job / issue / task) — instance mode. */
  entity_id?: string;
  /** Entity kind — encoding UNVERIFIED against live 12d. */
  entity_type?: 'job' | 'issue' | 'task';
  /** Workflow instance id (transition_log / instance secondaries). */
  instance_id?: string;
  /** Current state id — required for the diagram image. */
  current_state_id?: string;
  /** Return all states/transitions on a definition (default true). */
  return_all?: boolean;
}

/** Read-only Synergy: file version history. 1:1 port of the proven get_file_history. */
export interface ConnectSynergyFileHistoryParams extends HitlParams {
  /** MUST be a FILE id — reject `job:`/`folder:` prefixes with a hint. */
  file_id: string;
  /** 1-based page (default 1). */
  page?: number;
  /** Page size (default 50). */
  page_size?: number;
}

/** Read-only Synergy: what changed recently on a job or folder (polling, no webhooks). */
export interface ConnectSynergyRecentParams extends HitlParams {
  /** Job scope (XOR folder_id). */
  job_id?: string;
  /** Folder scope (wins if both supplied). */
  folder_id?: string;
  /** Look-back window in days (default 7). */
  days?: number;
  /** ISO-UTC lower bound — overrides days. */
  since?: string;
  /** Result cap (default 100). */
  limit?: number;
}

// ── Wave 2 read-only Synergy tools (PAT-scoped live 12d reads; no Numa ACL, no
//    metering). Same defensively-parsed `[UNKNOWN]`-schema handling as Wave 1. ──

/** Read-only Synergy: forum / discussion drill (forums → categories → topics → posts). */
export interface ConnectSynergyForumsParams extends HitlParams {
  /** list|forum|categories|category|topics|topic|posts. Inferred from the deepest id supplied. */
  mode?: 'list' | 'forum' | 'categories' | 'category' | 'topics' | 'topic' | 'posts';
  /** Job id (mode=list) — accepts bare or `job:`/`folder:` prefixed. */
  job_id?: string;
  /** Forum id (mode=forum/categories/category) — reject `job:`/`folder:` prefixes. */
  forum_id?: string;
  /** Category id (mode=category/topics). */
  category_id?: string;
  /** Topic / thread id (mode=topic/posts). */
  topic_id?: string;
  /** Start page for the paged modes (topics, posts). Default 1. */
  page?: number;
  /** Page size for paged modes. Default 50. */
  page_size?: number;
  /** mode=forum only: also fetch the caller's permission on the forum (best-effort). */
  include_permission?: boolean;
}

/** Read-only Synergy: 12d Projects (the 12d Model software projects embedded inside jobs/folders). */
export interface ConnectSynergyProjectsParams extends HitlParams {
  /** find|list|get|folders|file-info|associations|notes|permission|history|changed-elements|latest-change|preview. Inferred when omitted. */
  mode?:
    | 'find'
    | 'list'
    | 'get'
    | 'folders'
    | 'file-info'
    | 'associations'
    | 'notes'
    | 'permission'
    | 'history'
    | 'changed-elements'
    | 'latest-change'
    | 'preview';
  /** 12d Project IDString (NOT a job id). Required for the per-project modes. */
  project_id?: string;
  /** Synergy JOB id to list 12d projects under (mode=list, job scope). */
  job_id?: string;
  /** Synergy FOLDER id to list under (mode=list, folder scope) OR a sub-folder scope for mode=history. */
  folder_id?: string;
  /** Project name to locate (mode=find). */
  name?: string;
  /** Name of a file/folder inside the project (mode=file-info). */
  file_name?: string;
  /** mode=file-info: treat file_name as a folder. Default false. */
  is_folder?: boolean;
  /** Version for changed-elements / preview. Omitted → resolved via latest-change. */
  version?: number;
  /** 1-based start page (mode=history). Default 1. */
  page?: number;
  /** Page size (mode=history). Default 50. */
  page_size?: number;
  /** Pull custom attributes on get/folders/file-info. Default true. */
  retrieve_attributes?: boolean;
}

/** Read-only Synergy: Issued Files / transmittals (file-set types → sets → issues → published files + recipients). */
export interface ConnectSynergyTransmittalsParams extends HitlParams {
  /** types|sets|set|issue|discover|attributes. Inferred from the deepest id supplied. */
  mode?: 'types' | 'sets' | 'set' | 'issue' | 'discover' | 'attributes';
  /** Job id (modes types / sets / discover) — accepts bare or `job:`/`folder:` prefixed. */
  job_id?: string;
  /** File-set TYPE id (required for mode=sets; optional for one type's definition in mode=types). */
  type_id?: string;
  /** Issued file-SET id (required for mode=set). */
  set_id?: string;
  /** mode=set: include the set's issues (publish events). Default true. */
  get_issues?: boolean;
  /** mode=set: when supplied, also fetch that set version's files. */
  version?: number;
  /** Issue (publish/transmittal EVENT) id (mode=issue). NOT an issue-tracking RFI id. */
  issue_id?: string;
}

/** Read-only Synergy: companies / organisations (list / get / jobs / staff / schema). */
export interface ConnectSynergyCompaniesParams extends HitlParams {
  /** list|get|jobs|staff|schema. Inferred when omitted (company_id → get, else list). */
  mode?: 'list' | 'get' | 'jobs' | 'staff' | 'schema';
  /** Company IDString (required for get/jobs/staff). */
  company_id?: string;
  /** Client-side cap for list/jobs/staff (default 200). */
  limit?: number;
}

/** Read-only Synergy: web forms — definitions + fills/submissions. */
export interface ConnectSynergyWebformsParams extends HitlParams {
  /** enabled|definitions|fills. Inferred from the supplied id/scope. */
  mode?: 'enabled' | 'definitions' | 'fills';
  /** Job id — default scope for both definitions and fills. */
  job_id?: string;
  /** Task id — scopes definitions (by-task) and fills (by-task). */
  task_id?: string;
  /** Task-type id — scopes definitions to a task type. */
  task_type_id?: string;
  /** File id — scopes fills to a file. */
  file_id?: string;
  /** Form-definition change id (fetch one definition's structure). */
  definition_id?: string;
  /** Definition fetch: the {for_view} path segment (default true). */
  for_view?: boolean;
  /** Form-fill id (fetch one submission). */
  fill_id?: string;
  /** fills + fill_id: return the submission's output-file-list instead of its body. */
  output_files?: boolean;
  /** fills: use the POST /form-fills/search body endpoint instead of a path-scoped list. */
  search?: boolean;
  /** fills by-job / by-task: filter to one Synergy user (path segment; absent → all users). */
  user_id?: string;
  /** 1-based start page for the fills walk (default 1). */
  page?: number;
  /** Page size for the fills walk / search (default 50). */
  page_size?: number;
  /** Client-side cap on total fills returned across the bounded walk (default 100). */
  limit?: number;
}

/** Read-only Synergy: job/entity extras — Teams, Reports, ClashDetection + Wave 3 job-header reads (dashboard / categories / job-file-attributes). */
export interface ConnectSynergyJobExtrasParams extends HitlParams {
  /**
   * team|roles|reports|report|report_inputs|clashes|clash_items|clash_report;
   * Wave 3 job-header reads: dashboard | job-roles | categories | job-file-attributes.
   * `roles` is the GLOBAL role-definition reference; `job-roles` is the per-job
   * role assignments (jobs/{id}/roles, honours users_only) — they are distinct.
   */
  section:
    | 'team'
    | 'roles'
    | 'reports'
    | 'report'
    | 'report_inputs'
    | 'clashes'
    | 'clash_items'
    | 'clash_report'
    | 'dashboard'
    | 'job-roles'
    | 'categories'
    | 'job-file-attributes';
  /** Job id (section=team / dashboard / job-roles / categories / job-file-attributes) — accepts bare or `job:`/`folder:` prefixed. */
  job_id?: string;
  /** Wave 3 (section=job-roles): restrict to users only (GET jobs/{id}/roles/{users_only}). Default false. */
  users_only?: boolean;
  /** Entity id for entity-scoped reports (section=reports). */
  entity_id?: string;
  /** Entity-type discriminator for entity-scoped reports — encoding UNVERIFIED, passed verbatim. */
  entity_type?: string;
  /** Report type filter (section=reports). Absent → the entityTypeReports catalog. */
  report_type?: string;
  /** Report GUID (section=report / report_inputs). NOT an N_N IDString. */
  report_id?: string;
  /** Folder holding the federated model (section=clashes) — accepts `folder:`/`job:` prefixed. */
  folder_id?: string;
  /** Clash-detection run id (section=clash_items / clash_report). */
  clash_id?: string;
  /** Clash report format (section=clash_report; default `csv`). */
  report_format?: string;
  /** Clash report delimiter for delimited formats (section=clash_report; default `,`). */
  delimiter?: string;
  /** Client-side cap for clash_items (default 200). */
  limit?: number;
}

/** Read-only Synergy: notes + associations on any entity (cross-cutting annotations/links). */
export interface ConnectSynergyNotesParams extends HitlParams {
  /** notes (default) | associations. Inferred: an expected_type → associations, else notes. */
  section?: 'notes' | 'associations';
  /** The entity the notes/associations hang off — accepts bare or `job:`/`folder:`/`file:` prefixed. */
  target_id: string;
  /** Entity-type enum (noteTargetTypes / entityTypes). Required unless `scope` lets a convenience path be used. */
  target_type?: string;
  /** job|file|folder|project — routes to a scoped convenience path so the enum isn't needed. */
  scope?: 'job' | 'file' | 'folder' | 'project';
  /** section=notes: fetch one note's message body. */
  note_id?: string;
  /** section=notes: hydrate each header's body via getMessage (default true). */
  include_message?: boolean;
  /** section=associations: optional filter to one associated-entity type. */
  expected_type?: string;
  /** Use the cheap count endpoint and return just the count. */
  count_only?: boolean;
}

/** Read-only Synergy: connection health / identity probe (no params). */
export type ConnectSynergyStatusParams = HitlParams;

/** Read-only Synergy: users — lookup by id, the caller's job checkouts, license-module access. */
export interface ConnectSynergyUsersParams extends HitlParams {
  /** lookup|checkouts|module. Inferred: user_id → lookup, job_id → checkouts, module → module. */
  mode?: 'lookup' | 'checkouts' | 'module';
  /** User IDString (mode=lookup) — reject `job:`/`folder:` prefixes. */
  user_id?: string;
  /** Job id (mode=checkouts) — accepts bare or `job:`/`folder:` prefixed. */
  job_id?: string;
  /** License-module name (mode=module). Vocabulary UNVERIFIED — 404 surfaces a verify hint. */
  module?: string;
  /** mode=lookup: pull the user's attributes (the required path segment). Default true. */
  retrieve_attributes?: boolean;
}

// ── Wave 3 read-only Synergy tool (PAT-scoped live 12d reads; no Numa ACL, no
//    metering). Same defensively-parsed `[UNKNOWN]`-schema handling as Waves 1/2.
//    The 4 fold-ins (tasks / file_info / contacts / job_extras) EXTEND their
//    existing param shapes above with optional Wave 3 fields — no new tool ids. ──

/**
 * Read-only Synergy: turn a pasted 12d link / path into an entity (+ a clickable
 * URL). Wraps the admin-controller link/path lookups — non-mutating reads.
 */
export interface ConnectSynergyResolveParams extends HitlParams {
  /** link = parse a synergy:// or web link → entity ref (+ best-effort getWebLink); path = find entity by its 12d path; weblink = entity_id+entity_type → URL. Inferred when omitted. */
  mode?: 'link' | 'path' | 'weblink';
  /** A pasted `synergy://` or web link to parse (mode=link). */
  link?: string;
  /** A 12d entity path to resolve (mode=path) — URL-encoded server-side. */
  path?: string;
  /** Entity IDString to build a web link for (mode=weblink, or the parsed ref). */
  entity_id?: string;
  /** Entity-type discriminator (mode=weblink) — encoding UNVERIFIED, passed verbatim. */
  entity_type?: string;
}

export interface ConnectSynergySearchParams extends HitlParams {
  query: string;
  page_size?: number;
}

export interface ConnectSynergyDownloadParams extends HitlParams {
  file_id: string;
}

export interface OauthListFilesParams extends HitlParams {
  /** Provider id == connector slug (e.g. `googledrive`, `onedrive`, `dropbox`). */
  provider: string;
  folder_id?: string;
  page_size?: number;
  page_token?: string;
}

export interface OauthSearchFilesParams extends HitlParams {
  provider: string;
  query: string;
  folder_id?: string;
  page_size?: number;
  page_token?: string;
}

export interface OauthDownloadFileParams extends HitlParams {
  provider: string;
  file_id: string;
  /** Optional filename hint; the provider supplies the canonical name otherwise. */
  filename?: string;
}

export interface OauthGetFileMetadataParams extends HitlParams {
  provider: string;
  file_id: string;
}

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
  | { tool: 'connect_soap_credentials'; params: ConnectSoapCredentialsParams }
  | { tool: 'connect_synergy_list'; params: ConnectSynergyListParams }
  | { tool: 'connect_synergy_search'; params: ConnectSynergySearchParams }
  | { tool: 'connect_synergy_download'; params: ConnectSynergyDownloadParams }
  | { tool: 'connect_synergy_job_meta'; params: ConnectSynergyJobMetaParams }
  | { tool: 'connect_synergy_folder_summary'; params: ConnectSynergyFolderSummaryParams }
  | { tool: 'connect_synergy_schema'; params: ConnectSynergySchemaParams }
  | { tool: 'connect_synergy_file_info'; params: ConnectSynergyFileInfoParams }
  | { tool: 'connect_synergy_job_stats'; params: ConnectSynergyJobStatsParams }
  | { tool: 'connect_synergy_job_tree'; params: ConnectSynergyJobTreeParams }
  | { tool: 'connect_synergy_portfolio'; params: ConnectSynergyPortfolioParams }
  | { tool: 'connect_synergy_exact_term'; params: ConnectSynergyExactTermParams }
  | { tool: 'connect_synergy_tasks'; params: ConnectSynergyTasksParams }
  | { tool: 'connect_synergy_contacts'; params: ConnectSynergyContactsParams }
  | { tool: 'connect_synergy_issues'; params: ConnectSynergyIssuesParams }
  | { tool: 'connect_synergy_workflow'; params: ConnectSynergyWorkflowParams }
  | { tool: 'connect_synergy_file_history'; params: ConnectSynergyFileHistoryParams }
  | { tool: 'connect_synergy_recent'; params: ConnectSynergyRecentParams }
  | { tool: 'connect_synergy_forums'; params: ConnectSynergyForumsParams }
  | { tool: 'connect_synergy_projects'; params: ConnectSynergyProjectsParams }
  | { tool: 'connect_synergy_transmittals'; params: ConnectSynergyTransmittalsParams }
  | { tool: 'connect_synergy_companies'; params: ConnectSynergyCompaniesParams }
  | { tool: 'connect_synergy_webforms'; params: ConnectSynergyWebformsParams }
  | { tool: 'connect_synergy_job_extras'; params: ConnectSynergyJobExtrasParams }
  | { tool: 'connect_synergy_notes'; params: ConnectSynergyNotesParams }
  | { tool: 'connect_synergy_status'; params: ConnectSynergyStatusParams }
  | { tool: 'connect_synergy_users'; params: ConnectSynergyUsersParams }
  | { tool: 'connect_synergy_resolve'; params: ConnectSynergyResolveParams }
  | { tool: 'oauth_list_files'; params: OauthListFilesParams }
  | { tool: 'oauth_search_files'; params: OauthSearchFilesParams }
  | { tool: 'oauth_download_file'; params: OauthDownloadFileParams }
  | { tool: 'oauth_get_file_metadata'; params: OauthGetFileMetadataParams }
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
                                                                : T extends 'connect_soap_credentials'
                                                                  ? ConnectSoapCredentialsResult
                                                                  : T extends 'connect_synergy_list'
                                                                    ? ConnectorListResult
                                                                  : T extends 'connect_synergy_search'
                                                                    ? ConnectorListResult
                                                                    : T extends 'connect_synergy_download'
                                                                      ? ConnectorDownloadResult
                                                                      : T extends 'connect_synergy_job_meta'
                                                                        ? Record<string, unknown>
                                                                        : T extends 'connect_synergy_folder_summary'
                                                                          ? Record<string, unknown>
                                                                          : T extends 'connect_synergy_schema'
                                                                            ? Record<string, unknown>
                                                                            : T extends 'connect_synergy_file_info'
                                                                              ? ConnectorFileMetadataResult
                                                                              : T extends 'connect_synergy_job_stats'
                                                                                ? Record<string, unknown>
                                                                                : T extends 'connect_synergy_job_tree'
                                                                                  ? Record<string, unknown>
                                                                                  : T extends 'connect_synergy_portfolio'
                                                                                    ? Record<string, unknown>
                                                                                    : T extends 'connect_synergy_exact_term'
                                                                                      ? Record<string, unknown>
                                                                                      : T extends 'connect_synergy_tasks'
                                                                                        ? Record<string, unknown>
                                                                                        : T extends 'connect_synergy_contacts'
                                                                                          ? Record<string, unknown>
                                                                                          : T extends 'connect_synergy_issues'
                                                                                            ? Record<string, unknown>
                                                                                            : T extends 'connect_synergy_workflow'
                                                                                              ? Record<string, unknown>
                                                                                              : T extends 'connect_synergy_file_history'
                                                                                                ? Record<
                                                                                                    string,
                                                                                                    unknown
                                                                                                  >
                                                                                                : T extends 'connect_synergy_recent'
                                                                                                  ? Record<
                                                                                                      string,
                                                                                                      unknown
                                                                                                    >
                                                                                                  : T extends 'connect_synergy_forums'
                                                                                                    ? Record<
                                                                                                        string,
                                                                                                        unknown
                                                                                                      >
                                                                                                    : T extends 'connect_synergy_projects'
                                                                                                      ? Record<
                                                                                                          string,
                                                                                                          unknown
                                                                                                        >
                                                                                                      : T extends 'connect_synergy_transmittals'
                                                                                                        ? Record<
                                                                                                            string,
                                                                                                            unknown
                                                                                                          >
                                                                                                        : T extends 'connect_synergy_companies'
                                                                                                          ? Record<
                                                                                                              string,
                                                                                                              unknown
                                                                                                            >
                                                                                                          : T extends 'connect_synergy_webforms'
                                                                                                            ? Record<
                                                                                                                string,
                                                                                                                unknown
                                                                                                              >
                                                                                                            : T extends 'connect_synergy_job_extras'
                                                                                                              ? Record<
                                                                                                                  string,
                                                                                                                  unknown
                                                                                                                >
                                                                                                              : T extends 'connect_synergy_notes'
                                                                                                                ? Record<
                                                                                                                    string,
                                                                                                                    unknown
                                                                                                                  >
                                                                                                                : T extends 'connect_synergy_status'
                                                                                                                  ? Record<
                                                                                                                      string,
                                                                                                                      unknown
                                                                                                                    >
                                                                                                                  : T extends 'connect_synergy_users'
                                                                                                                    ? Record<
                                                                                                                        string,
                                                                                                                        unknown
                                                                                                                      >
                                                                                                                    : T extends 'connect_synergy_resolve'
                                                                                                                      ? Record<
                                                                                                                          string,
                                                                                                                          unknown
                                                                                                                        >
                                                                                                                      : T extends 'oauth_list_files'
                                                                                                                        ? ConnectorListResult
                                                                                                                        : T extends 'oauth_search_files'
                                                                                                                          ? ConnectorListResult
                                                                                                                          : T extends 'oauth_download_file'
                                                                                                                            ? ConnectorDownloadResult
                                                                                                                            : T extends 'oauth_get_file_metadata'
                                                                                                                              ? ConnectorFileMetadataResult
                                                                                                                              : T extends `ops_${string}`
                                                                                                                                ? OpsOperationResult
                                                                                                                                : never;

/**
 * Extracts the params type for a given tool name. Useful for typing
 * helpers that construct or normalise per-tool params.
 */
export type ParamsForTool<T extends ToolName> = Extract<ToolCall, { tool: T }>['params'];
