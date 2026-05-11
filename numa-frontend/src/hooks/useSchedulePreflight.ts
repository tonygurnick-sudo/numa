import { useEffect, useMemo, useState } from 'react';
import { getFlag } from '../utils/featureFlags';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { runSchedulePreflight, type SchedulePreflightBlocker } from '../utils/scheduleSavePreflight';
import type { AgentSummary } from '../types/agents';

/**
 * Resolve the list of blockers that prevent saving a schedule for the
 * given agent. Used by `AgentScheduleModal` and the Automations wizard
 * review step to render `SchedulePreflightStepper` upfront so users see
 * "scheduling not enabled" / "Gmail not connected" / "you can't access
 * folder X" before they hit Save.
 *
 * Sources:
 *   - SCHEDULING feature flag → `feature_disabled_company` blocker
 *   - Agent archived/visibility → blockers
 *   - Pipedream integration status → `integration_not_connected` blockers
 *   - KnowledgeBaseProvider availableKBs → `kb_not_accessible` blockers
 *
 * Failures fetching integration status fall through silently — the agent
 * may still be schedulable, and a hard backend check at save time catches
 * anything missed here.
 */
export const useSchedulePreflight = (agent: AgentSummary | null): SchedulePreflightBlocker[] => {
  const { user, lambdaClient } = useAuth();
  const { availableKBs } = useKnowledgeBase();
  const [connectedIntegrations, setConnectedIntegrations] = useState<string[]>([]);

  const schedulingFeatureEnabled = getFlag('SCHEDULING');
  const relayLambdaArn = useMemo(() => window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN') || '', []);
  const hasPipedreamIntegrations = getFlag('PIPEDREAM_INTEGRATIONS');

  // Load connected Pipedream integrations once per agent / user. Mirrors
  // the lookup `AgentCreateModal` does. Errors are non-fatal — the
  // preflight just won't flag missing integrations until the backend save
  // catches them.
  useEffect(() => {
    // Reset state up-front so an agent switch (A → B) doesn't keep stale
    // connections from A. Done before any early returns so missing prereqs
    // also clear the previous result.
    setConnectedIntegrations([]);
    if (!agent || !hasPipedreamIntegrations || !relayLambdaArn || !user || !lambdaClient) return;
    if (!agent.requiredIntegrations || agent.requiredIntegrations.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        const status = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
          ttlMs: 30 * 60 * 1000,
        });
        const set = new Set<string>();
        (status.connected_apps || []).forEach((name) => set.add(name));
        for (const conn of status.connections ?? []) {
          const c = conn as unknown as Record<string, unknown>;
          const id = (c.app_name as string) || (c.integration as string) || (c.app as string) || (c.id as string) || '';
          const statusValue = (
            (c.status as string) ||
            (c.connection_status as string) ||
            (c.state as string) ||
            ''
          )?.toLowerCase?.();
          if (id && (Boolean(c.isConnected) || statusValue === 'connected')) set.add(id);
        }
        if (!cancelled) setConnectedIntegrations(Array.from(set));
      } catch (err) {
        console.warn('[useSchedulePreflight] integration-status lookup failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, user, lambdaClient, relayLambdaArn, hasPipedreamIntegrations]);

  return useMemo<SchedulePreflightBlocker[]>(() => {
    if (!agent) return [];
    return runSchedulePreflight({
      schedulingFeatureEnabled,
      agent: {
        agentId: agent.agentId,
        // `AgentSummary` doesn't carry an archived flag — the modal/wizard
        // only opens for active agents anyway, so leave this off.
        visibility: agent.visibility,
        requiredIntegrations: agent.requiredIntegrations,
        // Allowed-KB list is nested on the agent's tools config.
        allowedKnowledgeBases: agent.toolsConfig?.allowedKnowledgeBases ?? null,
      },
      connectedIntegrations,
      accessibleKBIds: availableKBs.map((kb) => kb.kb_id),
    });
  }, [agent, schedulingFeatureEnabled, connectedIntegrations, availableKBs]);
};
