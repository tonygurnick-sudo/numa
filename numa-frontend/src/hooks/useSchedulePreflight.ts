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
  // True while the connected-integrations lookup is in flight. We must NOT
  // assert "integration not connected" before it resolves — otherwise the
  // blocker flashes on first render (when the set is still empty) and clears
  // a second later once the async status calls return.
  const [statusLoading, setStatusLoading] = useState(false);
  // False when a status lookup we relied on failed transiently (network /
  // cold-start / 5xx) or returned `check_failed`. In that case
  // `connectedIntegrations` may be MISSING a real connection, so it's unsafe
  // to claim something isn't connected. Confirmed `disconnected` reads keep
  // this true — those are reliable signals and SHOULD surface the blocker.
  const [statusReliable, setStatusReliable] = useState(true);

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
    setStatusReliable(true);
    if (!agent || !user) {
      setStatusLoading(false);
      return;
    }
    if (!agent.requiredIntegrations || agent.requiredIntegrations.length === 0) {
      setStatusLoading(false);
      return;
    }
    let cancelled = false;
    setStatusLoading(true);
    (async () => {
      const satisfied = new Set<string>();
      // Flipped to false the moment any lookup we depend on fails transiently
      // (so `satisfied` might be incomplete). Confirmed `disconnected` reads
      // do NOT flip it — those are reliable "not connected" answers.
      let reliable = true;

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
          // Couldn't read the Pipedream side — a required slug might be
          // connected there, so we can't trust an "absent" result.
          console.warn('[useSchedulePreflight] Pipedream status lookup failed', err);
          reliable = false;
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
                if (st.status === 'connected') return { slug, connected: true, confirmed: true };
                // `disconnected` / `error` are confirmed answers; `check_failed`
                // means the fetch itself failed — NOT a real disconnect, so we
                // must not let it drop a possibly-connected integration.
                const confirmed = st.status === 'disconnected' || st.status === 'error';
                return { slug, connected: false, confirmed };
              } catch {
                return { slug, connected: false, confirmed: false };
              }
            })
          );
          for (const r of results) {
            if (!r.confirmed) reliable = false;
            if (!r.connected) continue;
            satisfied.add(r.slug);
            const pairedPd = pipedreamSlugForConnector(r.slug);
            if (pairedPd) satisfied.add(pairedPd);
          }
        } catch (err) {
          console.warn('[useSchedulePreflight] native catalog lookup failed', err);
          reliable = false;
        }
      }

      if (!cancelled) {
        setConnectedIntegrations(Array.from(satisfied));
        setStatusReliable(reliable);
        setStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, user, lambdaClient, relayLambdaArn, hasPipedreamIntegrations, dataConnectorsFeatureEnabled, numaGet]);

  return useMemo<SchedulePreflightBlocker[]>(() => {
    if (!agent) return [];
    const blockers = runSchedulePreflight({
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
    // Only surface "integration not connected" once we've reliably confirmed
    // the connected set. While the lookup is in flight, or if a status fetch
    // failed transiently, we can't assert an integration is missing — so we
    // drop just those blockers (other kinds don't depend on async status).
    // The backend re-checks at save time, so nothing slips through.
    if (statusLoading || !statusReliable) {
      return blockers.filter((b) => b.kind !== 'integration_not_connected');
    }
    return blockers;
  }, [agent, schedulingFeatureEnabled, connectedIntegrations, availableKBs, statusLoading, statusReliable]);
};
