import { useEffect, useMemo, useState } from 'react';
import { getFlag } from '../utils/featureFlags';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { ConnectorsService } from '../Services/ConnectorsService';
import { AdminIntegrationsService } from '../Services/AdminIntegrationsService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import {
  connectorSlugForPipedream,
  pipedreamSlugForConnector,
} from '../Components/Integrations/integrationCatalogHelpers';
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
  const { numaGet } = useNumaRequest();
  // Slugs of integrations the user has connected via EITHER method.
  // Includes both raw slugs (Pipedream + native) AND their cross-method
  // pairings so a required `google_drive` is satisfied by either Pipedream
  // `google_drive` or native `googledrive` (and vice versa).
  const [connectedIntegrations, setConnectedIntegrations] = useState<string[]>([]);

  const schedulingFeatureEnabled = getFlag('SCHEDULING');
  const relayLambdaArn = useMemo(() => window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN') || '', []);
  const hasPipedreamIntegrations = getFlag('PIPEDREAM_INTEGRATIONS');
  const dataConnectorsFeatureEnabled = getFlag('DATA_CONNECTORS_ENABLED');

  // Load connected integrations (Pipedream + native) once per agent / user.
  // Mirrors the dual-method lookup the chat page does so required slugs
  // route through whichever method the user actually authed. Errors are
  // non-fatal — the preflight just won't flag missing integrations until
  // the backend save catches them.
  useEffect(() => {
    setConnectedIntegrations([]);
    if (!agent || !user) return;
    if (!agent.requiredIntegrations || agent.requiredIntegrations.length === 0) return;
    let cancelled = false;
    (async () => {
      const satisfied = new Set<string>();

      // Pipedream side — same shape as AgentCreateModal's lookup.
      if (hasPipedreamIntegrations && relayLambdaArn && lambdaClient) {
        try {
          const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
          const status = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
            ttlMs: 30 * 60 * 1000,
          });
          (status.connected_apps || []).forEach((name) => satisfied.add(name));
          for (const conn of status.connections ?? []) {
            const c = conn as unknown as Record<string, unknown>;
            const id =
              (c.app_name as string) || (c.integration as string) || (c.app as string) || (c.id as string) || '';
            const statusValue = (
              (c.status as string) ||
              (c.connection_status as string) ||
              (c.state as string) ||
              ''
            )?.toLowerCase?.();
            if (id && (Boolean(c.isConnected) || statusValue === 'connected')) {
              satisfied.add(id);
              // Pair a connected Pipedream slug with its native counterpart
              // so a required native slug ("googledrive") is satisfied by
              // a Pipedream connection ("google_drive").
              const pairedNative = connectorSlugForPipedream(id);
              if (pairedNative) satisfied.add(pairedNative);
            }
          }
        } catch (err) {
          console.warn('[useSchedulePreflight] Pipedream status lookup failed', err);
        }
      }

      // Native side — query each admin-enabled native connector in the
      // catalog for the user's auth status. Pair each connected native
      // slug with its Pipedream counterpart so a required Pipedream slug
      // ("google_drive") is satisfied by a native auth ("googledrive").
      if (dataConnectorsFeatureEnabled) {
        try {
          const catalog = await AdminIntegrationsService.catalogWithNuma(numaGet);
          const candidates = catalog
            .filter((e) => e.connectorSlug && e.connectorEnabled === true)
            .map((e) => e.connectorSlug as string);
          const results = await Promise.all(
            candidates.map(async (slug) => {
              try {
                const st = await ConnectorsService.getStatus(slug);
                return st.status === 'connected' ? slug : null;
              } catch {
                return null;
              }
            })
          );
          for (const slug of results) {
            if (!slug) continue;
            satisfied.add(slug);
            const pairedPd = pipedreamSlugForConnector(slug);
            if (pairedPd) satisfied.add(pairedPd);
          }
        } catch (err) {
          console.warn('[useSchedulePreflight] native catalog lookup failed', err);
        }
      }

      if (!cancelled) setConnectedIntegrations(Array.from(satisfied));
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, user, lambdaClient, relayLambdaArn, hasPipedreamIntegrations, dataConnectorsFeatureEnabled, numaGet]);

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
