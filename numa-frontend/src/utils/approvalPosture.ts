import type { AgentToolsConfig } from '../types/agents';
import type { ApprovalMode, ChatSettings } from '../Services/ChatSettingsService';
import {
  pipedreamSlugForConnector,
  connectorSlugForPipedream,
} from '../Components/Integrations/integrationCatalogHelpers';

/**
 * Approval posture for an agent's tools — used to warn, at schedule / automation
 * creation time, when an agent will perform actions an UNATTENDED run can't
 * approve. Covers EVERY approval-gated tool category the agent has enabled
 * (integrations, Numa Files / knowledge bases, agents, memories, Numa Ops) —
 * not just integrations — because any of them under a require-approval mode will
 * stall a scheduled/triggered run.
 *
 * The effective-mode resolution mirrors the server (agent_config.py
 * `resolve_all_approval_modes` / `resolve_per_integration_approval_modes`) and
 * the CLI gate (numa-cli `context/approval.ts`):
 *   - an explicit agent per-category mode wins (for integrations the legacy
 *     single `approvalMode` field also applies, and a set agent mode suppresses
 *     per-slug user overrides);
 *   - else, for integrations, the user's per-slug override, then the user's
 *     integrations default (`approvalMode`); for the other categories the user's
 *     per-category default (`numaToolApprovalMode[category]`).
 *
 * Only `never` (UI label "Auto-approve all") is safe for unattended runs:
 * `always` gates every op and `non_destructive` gates writes (and integrations
 * have no static "safe" op set, so `non_destructive` gates them entirely).
 */
export type ApprovalCategory = 'integrations' | 'knowledgeBases' | 'agents' | 'memories' | 'ops';

const isMode = (v: unknown): v is ApprovalMode => v === 'always' || v === 'non_destructive' || v === 'never';

export interface AtRiskCapability {
  category: ApprovalCategory;
  mode: ApprovalMode;
  /** For `integrations`: the human names of the at-risk integrations. */
  integrationNames?: string[];
}

type ApprovalSettings = Pick<ChatSettings, 'approvalMode' | 'numaToolApprovalMode' | 'integrationApprovalModes'>;

/** The user-level default for a category (the layer below any agent override). */
function userDefaultMode(category: ApprovalCategory, settings: ApprovalSettings): ApprovalMode {
  if (category === 'integrations') {
    return isMode(settings.approvalMode) ? settings.approvalMode : 'non_destructive';
  }
  const m = settings.numaToolApprovalMode?.[category];
  return isMode(m) ? m : 'never';
}

/** Effective approval mode for a category (+ optional integration slug). */
export function effectiveModeFor(
  category: ApprovalCategory,
  toolsConfig: AgentToolsConfig | undefined,
  settings: ApprovalSettings,
  slug?: string
): ApprovalMode {
  const agentOverride =
    toolsConfig?.approvalModes?.[category] ?? (category === 'integrations' ? toolsConfig?.approvalMode : undefined);
  if (isMode(agentOverride)) return agentOverride; // agent override wins (suppresses per-slug)

  if (category === 'integrations' && slug) {
    // The override is saved under ONE slug per service — the Pipedream slug when
    // the service has one (e.g. `google_drive`). A native connector is keyed by
    // its own slug (`googledrive`), so check the cross-method alias too, else a
    // native Drive/Dropbox/etc. under "always" silently reads as auto-approve
    // and the unattended-run warning never fires (BUG-390).
    const perSlug =
      settings.integrationApprovalModes?.[slug] ??
      settings.integrationApprovalModes?.[pipedreamSlugForConnector(slug) ?? ''] ??
      settings.integrationApprovalModes?.[connectorSlugForPipedream(slug) ?? ''];
    if (isMode(perSlug)) return perSlug;
  }
  return userDefaultMode(category, settings);
}

function kbEnabled(toolsConfig: AgentToolsConfig): boolean {
  // null/undefined = all KBs, a non-empty array = specific KBs (both = access).
  const kbs = toolsConfig.allowedKnowledgeBases;
  return kbs == null || kbs.length > 0;
}

/**
 * The agent's enabled, approval-gated capabilities whose effective mode is NOT
 * auto-approve — i.e. ones that will stall an unattended run. Empty when nothing
 * the agent can do needs approval (so callers check `.length` to decide whether
 * to warn). A category the agent doesn't have enabled is never included.
 */
export function atRiskCapabilitiesForSchedule(
  toolsConfig: AgentToolsConfig | undefined,
  settings: ApprovalSettings
): AtRiskCapability[] {
  if (!toolsConfig) return [];
  const out: AtRiskCapability[] = [];

  // Integrations — grouped into a single capability listing the at-risk slugs.
  const integrations =
    toolsConfig.enabledIntegrations && toolsConfig.enabledIntegrations.length > 0
      ? toolsConfig.enabledIntegrations.map((i) => ({ slug: i.slug, name: i.name || i.slug }))
      : (toolsConfig.enabledConnections ?? []).map((slug) => ({ slug, name: slug }));
  const atRiskInts = integrations.filter(
    (i) => effectiveModeFor('integrations', toolsConfig, settings, i.slug) !== 'never'
  );
  if (atRiskInts.length > 0) {
    out.push({
      category: 'integrations',
      mode: effectiveModeFor('integrations', toolsConfig, settings, atRiskInts[0].slug),
      integrationNames: atRiskInts.map((i) => i.name),
    });
  }

  // Other approval-gated categories the agent has enabled.
  const others: Array<{ category: ApprovalCategory; enabled: boolean }> = [
    { category: 'knowledgeBases', enabled: kbEnabled(toolsConfig) },
    { category: 'agents', enabled: !!toolsConfig.createAgentEnabled },
    { category: 'memories', enabled: !!toolsConfig.memoriesEnabled },
    { category: 'ops', enabled: !!toolsConfig.numaOpsEnabled },
  ];
  for (const { category, enabled } of others) {
    if (!enabled) continue;
    const mode = effectiveModeFor(category, toolsConfig, settings);
    if (mode !== 'never') out.push({ category, mode });
  }

  return out;
}
