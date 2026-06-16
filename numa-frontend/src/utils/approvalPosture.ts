import type { AgentToolsConfig } from '../types/agents';
import type { ChatSettings } from '../Services/ChatSettingsService';

/**
 * Approval posture for an agent's integrations — used to warn, at schedule /
 * automation creation time, when an agent will perform integration actions that
 * an UNATTENDED run can't approve.
 *
 * The effective-mode resolution mirrors the server (agent_config.py
 * `resolve_per_integration_approval_modes`) and the CLI gate
 * (numa-cli `context/approval.ts`): an explicit agent Integrations mode wins
 * uniformly and suppresses per-slug user overrides; otherwise the user's
 * per-slug override applies, else the user's Integrations-category default.
 *
 * Integrations have NO static "safe" op set, so `non_destructive` always gates a
 * write — only `never` (UI label "Auto-approve all") is safe for unattended runs.
 */
export type IntegrationApprovalMode = 'always' | 'non_destructive' | 'never';

const isMode = (v: unknown): v is IntegrationApprovalMode => v === 'always' || v === 'non_destructive' || v === 'never';

export interface AtRiskIntegration {
  slug: string;
  name: string;
  mode: IntegrationApprovalMode;
}

type ApprovalSettings = Pick<ChatSettings, 'approvalMode' | 'integrationApprovalModes'>;

/** Effective approval mode for one integration slug, agent + user resolved. */
export function effectiveIntegrationMode(
  slug: string,
  toolsConfig: AgentToolsConfig | undefined,
  settings: ApprovalSettings
): IntegrationApprovalMode {
  const agentMode = toolsConfig?.approvalModes?.integrations ?? toolsConfig?.approvalMode;
  if (isMode(agentMode)) return agentMode; // agent override wins uniformly
  const perSlug = settings.integrationApprovalModes?.[slug];
  if (isMode(perSlug)) return perSlug;
  return isMode(settings.approvalMode) ? settings.approvalMode : 'non_destructive';
}

/**
 * Integrations the agent has enabled whose effective approval mode is NOT
 * auto-approve — i.e. ones that will stall on an unattended run. Returns an
 * empty array when the agent has no integrations enabled (so callers can simply
 * check `.length` — no warning is relevant for an agent without integrations).
 */
export function atRiskIntegrationsForSchedule(
  toolsConfig: AgentToolsConfig | undefined,
  settings: ApprovalSettings
): AtRiskIntegration[] {
  if (!toolsConfig) return [];
  const list =
    toolsConfig.enabledIntegrations && toolsConfig.enabledIntegrations.length > 0
      ? toolsConfig.enabledIntegrations.map((i) => ({ slug: i.slug, name: i.name || i.slug }))
      : (toolsConfig.enabledConnections ?? []).map((slug) => ({ slug, name: slug }));

  const atRisk: AtRiskIntegration[] = [];
  for (const item of list) {
    const mode = effectiveIntegrationMode(item.slug, toolsConfig, settings);
    if (mode !== 'never') atRisk.push({ slug: item.slug, name: item.name, mode });
  }
  return atRisk;
}
