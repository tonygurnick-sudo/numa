/**
 * Per-agent-type CLI category allow-list (Phase 5).
 *
 * Some agent types must not be able to run the full `numa` surface. The
 * driving case: **Nolia processes UNTRUSTED documents** — a prompt-injection
 * in an uploaded tender/application could make a Nolia phase run
 * `numa ops delete_ticket`, `numa memory add`, or `numa agents update`. We
 * restrict every Nolia type to the `docs` category (extract/convert) and
 * enforce it here, server-side, where the LLM can't reach.
 *
 * Trust model (decided with Nathan): the agent type arrives as
 * `context.agent_type`, sourced from the `NUMA_AGENT_TYPE` env the workspace
 * agent injects — a *trusted-env* channel, not a signed claim. We rely on the
 * agent not overwriting its own env var (and only the opaque type travels, not
 * the allow-list itself, so a prompt-injected agent would also have to know
 * which type is unprivileged to escape). Defence-in-depth with the
 * dynamic-prompt gating. If this ever needs to be unforgeable, mint the type
 * into the proxy's service-token claim and read it from the verified token.
 *
 * Parity: the allowed-categories rule MUST match the Python side
 * (`agent_types/__init__.py` — the `nolia*` → `["docs"]` default). Both use the
 * same `nolia` type-id prefix rule; `policy.test.ts` pins the behaviour.
 */

export type CliCategory = 'files' | 'web' | 'docs' | 'agents' | 'memory' | 'integrations' | 'ops' | 'render' | 'vision';

/**
 * Authoritative tool-name → CLI category map. Mirrors `@numa/cli`'s
 * tool-display metadata, but normalised to the CLI *command* vocabulary the
 * allow-list speaks (metadata says `search`/`documents`/`memories`; the CLI
 * commands are `web`/`docs`/`memory`). Kept explicit so enforcement never
 * silently mis-buckets a tool. Unlisted tools fall through to the prefix rules
 * in `toolCategory`.
 */
const TOOL_CATEGORY: Record<string, CliCategory> = {
  // files (Numa Files / KB)
  query_knowledgebase: 'files',
  list_kb_files: 'files',
  retrieve_kb_file: 'files',
  add_to_kb: 'files',
  delete_kb_file: 'files',
  move_kb_file: 'files',
  rename_kb_file: 'files',
  create_kb_subfolder: 'files',
  delete_kb_subfolder: 'files',
  // web
  web_search: 'web',
  // docs
  extract_content: 'docs',
  transcribe: 'docs',
  convert_document: 'docs',
  // vision (non-multimodal model's "eyes")
  view_image: 'vision',
  // memory
  user_profile_list_memories: 'memory',
  user_profile_add_memory: 'memory',
  user_profile_update_memory: 'memory',
  user_profile_delete_memory: 'memory',
  // agents
  list_agents: 'agents',
  get_agent: 'agents',
  create_agent: 'agents',
  update_agent: 'agents',
  patch_agent_prompt: 'agents',
  duplicate_agent: 'agents',
  delete_agent: 'agents',
  // integrations (pipedream + native connect)
  pipedream_list_actions: 'integrations',
  pipedream_batch_get_schemas: 'integrations',
  pipedream_configure_props: 'integrations',
  pipedream_run_action: 'integrations',
  pipedream_proxy_request: 'integrations',
  connect_status: 'integrations',
  connect_request: 'integrations',
};

/**
 * Bucket a tool name into its CLI category. Explicit map first, then prefix
 * rules so newly-added tools (a new `pipedream_*`, `*_agent`, `ops_*`) are
 * covered without a code change. Returns null only for genuinely unknown
 * tools — for a RESTRICTED agent that resolves to "deny" (fail closed).
 */
export function toolCategory(tool: string): CliCategory | null {
  const explicit = TOOL_CATEGORY[tool];
  if (explicit) return explicit;
  if (tool.startsWith('ops_')) return 'ops';
  if (tool.startsWith('pipedream_') || tool.startsWith('connect_') || tool.startsWith('oauth_')) return 'integrations';
  if (tool.endsWith('_agent') || tool.endsWith('_agents')) return 'agents';
  if (tool.includes('memor')) return 'memory';
  if (tool.includes('_kb') || tool.includes('kb_') || tool.includes('knowledgebase')) return 'files';
  return null;
}

/**
 * Allowed CLI categories for an agent type. `null` = unrestricted (the default
 * for every type that isn't explicitly locked down — numa-chat, data-analysis,
 * laptop dev, etc.). Mirror of the Python `allowed_cli_commands` default.
 */
export function allowedCategoriesForAgentType(agentType: string | undefined): Set<CliCategory> | null {
  if (!agentType) return null; // no type asserted → unrestricted (laptop / interactive numa-chat)
  // Nolia + nolia_funding process untrusted documents → docs only.
  if (agentType.startsWith('nolia')) return new Set<CliCategory>(['docs']);
  return null;
}

export interface AllowVerdict {
  allowed: boolean;
  category: CliCategory | null;
  /** The categories this agent type is limited to, for the error message. */
  allowedCategories: CliCategory[] | null;
}

/**
 * Decide whether `tool` is permitted for `agentType`. Unrestricted types always
 * pass. Restricted types pass only if the tool's category is in their set; an
 * uncategorizable tool under a restricted type is denied (fail closed).
 */
export function isToolAllowedForAgentType(agentType: string | undefined, tool: string): AllowVerdict {
  const allowed = allowedCategoriesForAgentType(agentType);
  if (allowed === null) return { allowed: true, category: null, allowedCategories: null };
  const category = toolCategory(tool);
  const allowedCategories = [...allowed];
  if (category === null) return { allowed: false, category: null, allowedCategories };
  return { allowed: allowed.has(category), category, allowedCategories };
}
