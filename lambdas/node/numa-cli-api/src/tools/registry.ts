/**
 * Tool routing registry. Maps tool names to the downstream Lambda that
 * handles them.
 *
 * Three downstream shapes today:
 *
 *   1. workspace-chat-tools  (event-shaped)
 *      Receives {tool, params, user_sub, allowed_kbs, ...} as a Lambda event.
 *      Dispatches internally by `tool` name. This is the default fallback
 *      for any unregistered tool — keeps the CLI / Lambda decoupled so
 *      adding a new chat-tools tool doesn't need a registry entry here.
 *
 *   2. kb_manager  (REST-shaped)
 *      Sits behind a CloudFront-fronted Function URL, takes synthetic API
 *      Gateway events with a method + path. Path templates use {placeholder}
 *      substitution from request params (e.g. `/api/kb/{kb_id}/files/move`
 *      with params.kb_id="x" → `/api/kb/x/files/move`). Forwards the
 *      CloudFront secret header so it bypasses the function URL gate the
 *      same way bootstrap does for the same Lambda.
 *
 *   3. oauth_workspace_tools  (simpler event shape)
 *      The native-connector Lambda backing the LLM's connector tools.
 *      Event: {tool, user_sub, conversation_id, params}. Tool names are
 *      `connect_*` (status / request / Synergy file ops) and `oauth_*`
 *      (per-provider file ops for the OAuth cloud-storage connectors —
 *      Google Drive / Gmail / OneDrive / Dropbox, keyed by a `provider`
 *      param). Lives in a separate Lambda from workspace-chat-tools because
 *      it predates the unified dispatcher and is still being incubated.
 *
 * Adding a new tool:
 *   - If it lives in workspace-chat-tools → no registry entry needed.
 *   - If it lives in kb_manager (REST-shaped) → add a `KbManagerRoute`
 *     entry below with the right method + path template.
 *   - If it lives in oauth_workspace_tools → add an `OauthWorkspaceToolsRoute`
 *     entry (or rely on the explicit registry mapping below).
 *   - If it lives in a brand-new Lambda → extend the `ToolRoute` union and
 *     add a dispatch case in `tools/index.ts`.
 */

export interface WorkspaceChatToolsRoute {
  target: 'workspace_chat_tools';
}

export interface KbManagerRoute {
  target: 'kb_manager';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /**
   * URL path on kb_manager. Curly-brace placeholders (e.g. `{kb_id}`) are
   * substituted from request `params` before invocation. Substituted
   * placeholders are then removed from the params object so they don't
   * double up as request body fields.
   */
  pathTemplate: string;
}

export interface OauthWorkspaceToolsRoute {
  target: 'oauth_workspace_tools';
}

export type ToolRoute = WorkspaceChatToolsRoute | KbManagerRoute | OauthWorkspaceToolsRoute;

/**
 * Native-connector Synergy tool names. Single source of truth shared across
 * the routing registry (below), the policy category map (`policy.ts`), and
 * their tests — so adding a Synergy tool in one place can't silently miss the
 * route or the category bucket. All route to `oauth_workspace_tools` and all
 * bucket as the `integrations` CLI category.
 *   - list/search/download: file browsing (MCP→CLI re-exposure, 6bebe5603).
 *   - the metadata/structure/stats group + the 4th `exact_term` search mode
 *     (commit 00d7edd48) — without explicit routes these default to
 *     workspace_chat_tools and the agent reports them "not available".
 */
export const SYNERGY_TOOLS = [
  'connect_synergy_list',
  'connect_synergy_search',
  'connect_synergy_download',
  'connect_synergy_job_meta',
  'connect_synergy_folder_summary',
  'connect_synergy_schema',
  'connect_synergy_file_info',
  'connect_synergy_job_stats',
  'connect_synergy_job_tree',
  'connect_synergy_portfolio',
  'connect_synergy_exact_term',
  // Wave 1 read-only live-read tools (PAT-scoped; no Numa ACL, no metering).
  'connect_synergy_tasks',
  'connect_synergy_contacts',
  'connect_synergy_issues',
  'connect_synergy_workflow',
  'connect_synergy_file_history',
  'connect_synergy_recent',
  // Wave 2 read-only live-read tools (PAT-scoped; no Numa ACL, no metering).
  // connect_synergy_schema is already present above (its vocab extension adds
  // modes, not a new tool id).
  'connect_synergy_forums',
  'connect_synergy_projects',
  'connect_synergy_transmittals',
  'connect_synergy_companies',
  'connect_synergy_webforms',
  'connect_synergy_job_extras',
  'connect_synergy_notes',
  'connect_synergy_status',
  'connect_synergy_users',
  // Wave 3 read-only live-read tool (PAT-scoped; no Numa ACL, no metering).
  // The Wave 3 fold-ins extend existing tool params (no new tool ids) — only
  // this link/path resolver is a brand-new id.
  'connect_synergy_resolve',
] as const;

/**
 * Explicit routing entries. Anything NOT in here defaults to
 * workspace_chat_tools (pass-through).
 */
export const TOOL_REGISTRY: Record<string, ToolRoute> = {
  // kb_manager — file management ops the workspace-chat-tools dispatcher
  // doesn't have. Same `kb_manager` Lambda the frontend's file UI calls.
  move_kb_file: {
    target: 'kb_manager',
    method: 'POST',
    pathTemplate: '/api/kb/{kb_id}/files/move',
  },
  rename_kb_file: {
    target: 'kb_manager',
    method: 'POST',
    pathTemplate: '/api/kb/{kb_id}/files/rename',
  },
  create_kb_subfolder: {
    target: 'kb_manager',
    method: 'POST',
    pathTemplate: '/api/kb/{kb_id}/folders',
  },
  delete_kb_subfolder: {
    target: 'kb_manager',
    method: 'POST',
    pathTemplate: '/api/kb/{kb_id}/folders/delete',
  },

  // oauth_workspace_tools — native-connector backend. The CLI hits these
  // directly (these tool names default-route to workspace_chat_tools, which
  // doesn't have them — so they MUST be registered here explicitly).
  connect_status: { target: 'oauth_workspace_tools' },
  connect_request: { target: 'oauth_workspace_tools' },
  // AutoPlay SOAP credential passthrough — hands the agent AutoPlay's gated
  // SOAP creds (admin opt-in: soap_token_passthrough + lead_api_enabled).
  // Like connect_status/connect_request, default-routes to workspace_chat_tools
  // (no such handler) without this explicit entry → agent gets "not available".
  connect_soap_credentials: { target: 'oauth_workspace_tools' },

  // Native-connector file browsing. These were the agent's only path to
  // connector files via the MCP `connect.py` tool, which the MCP→CLI
  // migration (6bebe5603) deleted without porting — re-exposed here as
  // `numa integrations list-files/search-files/download-file/file-info`.
  // Synergy 12d uses dedicated handlers (jobs-as-folders); the OAuth
  // cloud-storage providers (Google Drive / Gmail / OneDrive / Dropbox)
  // share the generic `oauth_*` ops with a `provider` param. All read-only.
  //
  // Synergy file browsing + metadata / structure / stats + the 4th search mode
  // are routed from the shared SYNERGY_TOOLS list so a new Synergy tool can't
  // be added without a route — without one, numa-cli-api defaults it to
  // workspace_chat_tools (no such handler) and the agent reports it "not
  // available".
  ...Object.fromEntries(
    SYNERGY_TOOLS.map((tool) => [tool, { target: 'oauth_workspace_tools' } as OauthWorkspaceToolsRoute])
  ),
  oauth_list_files: { target: 'oauth_workspace_tools' },
  oauth_search_files: { target: 'oauth_workspace_tools' },
  oauth_download_file: { target: 'oauth_workspace_tools' },
  oauth_get_file_metadata: { target: 'oauth_workspace_tools' },
};

/**
 * Resolve a tool name → route. Unknown tools default to workspace-chat-tools
 * so the Lambda doesn't need to know about every chat-tools tool name.
 */
export const resolveToolRoute = (toolName: string): ToolRoute =>
  TOOL_REGISTRY[toolName] ?? { target: 'workspace_chat_tools' };
