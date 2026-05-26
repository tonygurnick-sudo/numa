/**
 * Client-side preflight checks for scheduling an agent.
 *
 * Returns a typed list of blockers that the user must resolve before they
 * can save a schedule. Each blocker includes a remediation path that the
 * frontend can deep-link to (e.g. the integrations page if a required
 * integration isn't connected).
 *
 * The same checks happen server-side at submit time; this is purely UX —
 * showing the stepper up-front so users don't get to "Save" only to be told
 * something's wrong.
 */

export type SchedulePreflightBlockerKind =
  | 'feature_disabled_company'
  | 'feature_disabled_user'
  | 'integration_not_connected'
  | 'integration_revoked'
  | 'kb_not_accessible'
  | 'agent_archived'
  | 'agent_no_visibility';

export type SchedulePreflightBlocker = {
  kind: SchedulePreflightBlockerKind;
  title: string;
  detail: string;
  /** Identifier the blocker is about (integration slug, KB id, etc.). */
  resource?: string;
  /** Path the user can navigate to in order to resolve this. */
  remediationPath?: string;
  /** Label for the remediation CTA button. */
  remediationLabel?: string;
};

export type SchedulePreflightInput = {
  schedulingFeatureEnabled: boolean;
  agent: {
    agentId: string;
    archived?: boolean;
    visibility?: string;
    requiredIntegrations?: string[];
    allowedKnowledgeBases?: string[] | null;
  };
  /** Slugs of integrations the user has connected (e.g. ["gmail", "slack"]). */
  connectedIntegrations: string[];
  /** Set of KB ids the user can access. Pass `null` if "all KBs allowed" applies. */
  accessibleKBIds: string[];
};

const integrationLabel = (slug: string): string => {
  return slug
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
};

/**
 * Compute the list of preflight blockers that prevent saving a schedule
 * for the given agent. Empty list = ready to save.
 */
export const runSchedulePreflight = (input: SchedulePreflightInput): SchedulePreflightBlocker[] => {
  const blockers: SchedulePreflightBlocker[] = [];

  if (!input.schedulingFeatureEnabled) {
    blockers.push({
      kind: 'feature_disabled_company',
      title: 'Scheduling not enabled',
      detail: 'Your company has not enabled the scheduling feature. An admin must turn it on in Settings.',
      remediationPath: '/settings',
      remediationLabel: 'Open Settings',
    });
    // No point in continuing — the rest is noise.
    return blockers;
  }

  if (input.agent.archived) {
    blockers.push({
      kind: 'agent_archived',
      title: 'Agent is archived',
      detail: 'You cannot create a schedule for an archived agent. Restore it first or pick a different agent.',
      resource: input.agent.agentId,
      remediationPath: `/agents`,
      remediationLabel: 'Open Agents',
    });
  }

  for (const slug of input.agent.requiredIntegrations ?? []) {
    const isConnected = input.connectedIntegrations.includes(slug);
    if (!isConnected) {
      blockers.push({
        kind: 'integration_not_connected',
        title: `Connect ${integrationLabel(slug)}`,
        detail: `This agent needs ${integrationLabel(slug)} to be connected on your account before it can run autonomously.`,
        resource: slug,
        remediationPath: `/integrations`,
        remediationLabel: 'Open integrations',
      });
    }
  }

  // KB validation:
  //  null  → all-KBs-allowed; if user has no accessible KBs the schedule
  //          is still creatable (the agent might be set up to not need KBs).
  //  []    → no KBs explicitly; nothing to validate.
  //  [...] → check each id is accessible.
  const allowedKBs = input.agent.allowedKnowledgeBases;
  if (Array.isArray(allowedKBs) && allowedKBs.length > 0) {
    const accessibleSet = new Set(input.accessibleKBIds);
    for (const kbId of allowedKBs) {
      if (!accessibleSet.has(kbId)) {
        // Post-rebrand vocabulary: "Numa Files" / "folder". The internal
        // kb_not_accessible kind enum stays (see TypedScheduleErrorSchema)
        // since stored records / typed errors still use it.
        blockers.push({
          kind: 'kb_not_accessible',
          title: 'Folder not accessible',
          detail: `The agent is configured to use a folder ("${kbId}") that you don't have access to. Ask the folder owner to share it with you.`,
          resource: kbId,
          remediationPath: `/numa-files`,
          remediationLabel: 'Open Numa Files',
        });
      }
    }
  }

  return blockers;
};
