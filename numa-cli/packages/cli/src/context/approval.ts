/**
 * Mirror of the workspace SDK runner's per-category approval logic, so the
 * CLI gates its terminal prompts on the SAME policy the user already set in
 * chat. Same source of truth (`chat_settings.user.numaToolApprovalMode`),
 * same semantics, just enforced terminal-side here instead of via SSE/DDB.
 *
 * Semantics (from the workspace agent's resolve_all_approval_modes):
 *   never            → auto-approve (no prompt, ever)
 *   non_destructive  → auto-approve when the op is read-only / "safe"
 *   always           → always prompt
 *
 * Two sources, by auth mode:
 *   workspace-IAM — the agent resolves the modes per turn (agent override >
 *     user setting > default, incl. TASK-127 per-slug integration overrides)
 *     and injects them as NUMA_APPROVAL_MODES. There is no bootstrap context
 *     on disk in the MicroVM; absent/malformed env fails safe to
 *     `non_destructive` so write ops still gate.
 *   laptop — the bootstrap context file caches the user's chat settings;
 *     absent values default to `never` (a dev at their own terminal, with
 *     --yes available). No profile at all fails safe to `always`.
 *
 * This is a UX layer, not a security boundary — the env is model-visible.
 * The server-side gates in numa-cli-api remain authoritative.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { activeProfile, loadContext } from './store.js';

type ApprovalMode = 'always' | 'non_destructive' | 'never';
type Category = 'agents' | 'memories' | 'knowledgeBases' | 'ops' | 'integrations';

interface BootstrapUserSettings {
  numaToolApprovalMode?: Partial<Record<Category, ApprovalMode>>;
  /** Integrations-category mode (legacy top-level chat-settings field). */
  approvalMode?: ApprovalMode;
  /** TASK-127 per-slug overrides. */
  integrationApprovalModes?: Record<string, ApprovalMode>;
}

interface BootstrapSlice {
  chat_settings?: {
    user?: BootstrapUserSettings;
  };
}

/**
 * "Safe" sets — match the workspace SDK runner's per-category definitions.
 * Anything NOT in here is treated as destructive / unsafe for the purposes
 * of `non_destructive` mode. Integrations have no safe set: an action key's
 * read/write nature can't be known statically, so `non_destructive` always
 * prompts there.
 */
const SAFE_OPS: Record<Category, Set<string>> = {
  knowledgeBases: new Set(['query', 'list', 'download', 'download_folder']),
  agents: new Set(['get', 'list']),
  memories: new Set(['list']),
  ops: new Set(['get', 'list', 'search']),
  integrations: new Set([]),
};

const isValidMode = (v: unknown): v is ApprovalMode => v === 'never' || v === 'non_destructive' || v === 'always';

const isWorkspaceMode = (): boolean => process.env['NUMA_AUTH_MODE'] === 'workspace-iam';

interface WorkspaceApprovalModes {
  categories: Partial<Record<string, ApprovalMode>>;
  integrationOverrides: Record<string, ApprovalMode>;
}

/**
 * Parse NUMA_APPROVAL_MODES (set by the workspace agent per turn in
 * sdk_config.create_agent_options). Unknown category keys and invalid mode
 * values are dropped; a malformed payload reads as undefined so callers fall
 * back to the fail-safe default.
 */
const readWorkspaceApprovalModes = (): WorkspaceApprovalModes | undefined => {
  const raw = process.env['NUMA_APPROVAL_MODES'];
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const categoriesRaw = (parsed as Record<string, unknown>)['categories'];
  const overridesRaw = (parsed as Record<string, unknown>)['integration_overrides'];
  const categories: Partial<Record<string, ApprovalMode>> = {};
  if (typeof categoriesRaw === 'object' && categoriesRaw !== null) {
    for (const [key, value] of Object.entries(categoriesRaw)) {
      if (isValidMode(value)) categories[key] = value;
    }
  }
  const integrationOverrides: Record<string, ApprovalMode> = {};
  if (typeof overridesRaw === 'object' && overridesRaw !== null) {
    for (const [slug, value] of Object.entries(overridesRaw)) {
      if (slug && isValidMode(value)) integrationOverrides[slug] = value;
    }
  }
  return { categories, integrationOverrides };
};

const loadBootstrapUserSettings = (account?: string): BootstrapUserSettings | undefined => {
  const acct = account ?? activeProfile();
  if (!acct) return undefined;
  const ctx = loadContext<BootstrapSlice>(acct);
  return ctx?.chat_settings?.user;
};

export const readApprovalMode = (category: Category, account?: string): ApprovalMode => {
  if (isWorkspaceMode()) {
    const mode = readWorkspaceApprovalModes()?.categories[category];
    if (isValidMode(mode)) return mode;
    // Fail-safe — no/malformed env means we can't see the user's policy, so
    // write ops trigger the approval gate (matching the server-side default
    // for the approval UI setting).
    return 'non_destructive';
  }
  const acct = account ?? activeProfile();
  if (!acct) return 'always'; // fail-safe — no profile = no context = prompt
  const user = loadBootstrapUserSettings(acct);
  const mode = category === 'integrations' ? user?.approvalMode : user?.numaToolApprovalMode?.[category];
  if (isValidMode(mode)) return mode;
  return 'never'; // laptop mode with a context file: matches server default
};

/**
 * Per-slug integration approval mode (TASK-127). Consult chain:
 * slug override → integrations category mode → fail-safe default. In
 * workspace mode the agent has already applied agent-level precedence
 * (an agent-set Integrations mode arrives with an EMPTY override map).
 */
export const readIntegrationApprovalMode = (slug: string, account?: string): ApprovalMode => {
  if (isWorkspaceMode()) {
    const ws = readWorkspaceApprovalModes();
    const override = ws?.integrationOverrides[slug];
    if (isValidMode(override)) return override;
  } else {
    const override = loadBootstrapUserSettings(account)?.integrationApprovalModes?.[slug];
    if (isValidMode(override)) return override;
  }
  return readApprovalMode('integrations', account);
};

/**
 * Returns true if the local terminal should prompt the user before running
 * the op. False means the user's policy (or the op being inherently safe)
 * has already auto-approved.
 *
 * `operation` should match the workspace-chat-tools naming convention used
 * inside numa_tool dispatch (e.g. `upload`, `delete`, `query`, `kb_list`,
 * `download`, `download_folder`).
 */
export const requiresLocalApproval = (category: Category, operation: string, account?: string): boolean => {
  const mode = readApprovalMode(category, account);
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  // non_destructive: prompt only when op is NOT in the safe set
  return !SAFE_OPS[category].has(operation);
};

export interface IntegrationApprovalInput {
  slug: string;
  /** Action key for `integrations call`; absent for raw proxy requests. */
  actionKey?: string;
  /** HTTP method for raw proxy requests — GET/HEAD are read-only. */
  httpMethod?: string;
  /**
   * Inherently read-only native op (file browsing, Synergy metadata) — no
   * action-key schema and no HTTP method to infer safety from. Treated as a
   * "safe" op so it auto-approves under `non_destructive` and only prompts
   * under `always`, mirroring the pre-CLI SDK-runner rule that "always ask"
   * gated EVERY native connector operation, reads included (BUG-390).
   */
  readOnly?: boolean;
  account?: string;
}

// Env override is a test seam (the workspace path doesn't exist on laptops).
const integrationSchemaDir = (): string => process.env['NUMA_INTEGRATION_SCHEMA_DIR'] || '/workdir/tools/integrations';

/**
 * Mirror of the pre-CLI SDK-runner safety rule for `non_destructive` mode:
 * actions are judged by the schema annotations the workspace syncs to
 * /workdir/tools/integrations/{slug}/{action_key}.json — auto-approve when
 * `readOnlyHint` is true, or for draft actions explicitly marked
 * non-destructive (drafts are saved, not sent). Missing/unreadable schema
 * fails closed. Raw proxy requests have no schema; GET/HEAD are read-only.
 */
const isSafeIntegrationOp = (input: IntegrationApprovalInput): boolean => {
  if (input.readOnly) return true; // file browsing / metadata reads are always safe
  if (input.actionKey) {
    try {
      const schemaPath = join(integrationSchemaDir(), input.slug, `${input.actionKey}.json`);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
        annotations?: Record<string, unknown>;
      };
      const annotations = schema.annotations ?? {};
      const readOnly = annotations['readOnlyHint'] === true;
      const isDraft = input.actionKey.toLowerCase().includes('draft');
      const nonDestructive = annotations['destructiveHint'] === false;
      return readOnly || (isDraft && nonDestructive);
    } catch {
      return false; // fail-closed: no schema = prompt
    }
  }
  const method = (input.httpMethod || 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
};

/**
 * Integration-aware variant of `requiresLocalApproval` for `numa
 * integrations` commands — same semantics, but the mode comes from the
 * per-slug consult chain and safety from the action's schema annotations
 * (or HTTP method for raw requests).
 */
export const requiresLocalApprovalForIntegration = (input: IntegrationApprovalInput): boolean => {
  const mode = readIntegrationApprovalMode(input.slug, input.account);
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return !isSafeIntegrationOp(input);
};
