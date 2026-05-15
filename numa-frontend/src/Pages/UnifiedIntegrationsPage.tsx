/**
 * UnifiedIntegrationsPage — single user-facing surface for Pipedream
 * integrations and native data connectors.
 *
 * Each catalog entry becomes one card. The card knows which method to use
 * (admin's preferred_method, or the only available method, or — when both
 * are configured but the admin hasn't picked — a chooser the user resolves
 * at connect time). Connect dispatches to existing services so we don't
 * reinvent the auth wizards.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Spinner, Alert, Modal, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Link2, RefreshCw, Grid3X3, RefreshCcw, AlertTriangle, Settings, Eye, EyeOff } from 'lucide-react';

import { getFlag } from '../utils/featureFlags';

import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useConfirm } from '../Providers/ConfirmContext';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import { MethodBadge } from '../Components/Integrations/MethodBadge';

import {
  AdminIntegrationsService,
  type CatalogEntry,
  type IntegrationMethod,
} from '../Services/AdminIntegrationsService';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { ConnectorsService, type PATCredentialField } from '../Services/ConnectorsService';
import { DataConnectorsService } from '../Services/DataConnectorsService';

import {
  getConnectionDisplayName,
  getConnectionDescription,
  getConnectionIcon,
  getConnectionConfig,
} from '../config/integrationsConfig';
import { getConnectorById } from '../Components/DataConnectors/connectorRegistry';
import type { DataConnectorStatus } from '../types/dataConnectors';
import type { ConnectionStatus } from '../types/pipedream';

import { createFrontendClient } from '@pipedream/sdk/browser';

type ServiceRow = {
  entry: CatalogEntry;
  availableMethods: IntegrationMethod[];
  effectiveMethod: IntegrationMethod | null; // null when user must choose
  display: { name: string; description: string; iconUrl?: string; iconClass?: string };
  isConnected: boolean;
  /** Pipedream-side health signal: false → token rotted / refresh failing;
   *  surfaced on the card so users can reconnect before chat errors. Only
   *  meaningful for Pipedream connections. */
  healthy?: boolean | null;
  /** Pipedream-side dead signal: account inactive on Pipedream's end. */
  dead?: boolean | null;
};

/** Resolve display info for a service from whichever registry has it. */
function resolveDisplay(entry: CatalogEntry): ServiceRow['display'] {
  if (entry.pipedreamSlug) {
    return {
      name: getConnectionDisplayName(entry.pipedreamSlug),
      description: getConnectionDescription(entry.pipedreamSlug),
      iconUrl: getConnectionIcon(entry.pipedreamSlug),
    };
  }
  if (entry.connectorSlug) {
    const reg = getConnectorById(entry.connectorSlug);
    return {
      name: reg?.displayName ?? entry.connectorSlug,
      description: reg?.description ?? '',
      iconClass: reg?.icon,
    };
  }
  return { name: entry.slug, description: '' };
}

/** A method is "available" when admin has actively enabled it in its settings table. */
/**
 * Backwards-compatibility: services where admin configured native credentials
 * BEFORE the data-connector-settings flag convention existed will have a vault
 * secret but no settings row. Honour either signal so legacy setups still
 * surface as "native available" to users.
 */
function computeAvailableMethods(entry: CatalogEntry, configuredNativeSlugs: Set<string>): IntegrationMethod[] {
  const out: IntegrationMethod[] = [];
  if (entry.methods.includes('pipedream') && entry.pipedreamEnabled) out.push('pipedream');
  if (entry.methods.includes('native')) {
    // catalog.connectorEnabled is tri-state:
    //   true  → data-connector-settings row says enabled
    //   false → row exists with status='disabled' (admin explicitly paused)
    //   null  → no row exists yet; fall back to vault presence (legacy
    //           admin-setup path where the vault has credentials but no
    //           explicit flag row was ever written).
    // The legacy fallback ONLY applies when the row is null — otherwise
    // an admin who paused the integration would still see it surface to
    // users, which defeats the toggle.
    let nativeAvailable: boolean;
    if (entry.connectorEnabled === true) {
      nativeAvailable = true;
    } else if (entry.connectorEnabled === false) {
      nativeAvailable = false;
    } else {
      nativeAvailable = entry.connectorSlug ? configuredNativeSlugs.has(entry.connectorSlug) : false;
    }
    if (nativeAvailable) out.push('native');
  }
  return out;
}

function computeEffectiveMethod(entry: CatalogEntry, available: IntegrationMethod[]): IntegrationMethod | null {
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];
  if (entry.preferred_method && available.includes(entry.preferred_method)) {
    return entry.preferred_method;
  }
  return null; // user must choose
}

export const UnifiedIntegrationsPage = () => {
  const { t } = useTranslation('integrations');
  const { t: tCommon } = useTranslation('common');
  const { user, lambdaClient } = useAuth();
  const { numaGet, numaDelete } = useNumaRequest();
  const confirm = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<CatalogEntry[]>(() => AdminIntegrationsService.getCachedCatalog() ?? []);
  const [pipedreamConnections, setPipedreamConnections] = useState<ConnectionStatus[]>([]);
  const [nativeConnections, setNativeConnections] = useState<DataConnectorStatus[]>([]);
  // Vault-side configured native connectors. Used to keep legacy native setups
  // (vault secret exists, no data-connector-settings row) visible as an
  // available method when computing what users can connect through.
  const [configuredNativeSlugs, setConfiguredNativeSlugs] = useState<Set<string>>(new Set());
  // Per-OAuth-connector connection status. Native OAuth tokens live in the
  // user's vault (under `oauth-{slug}`), not in the data-connectors table —
  // so the only reliable way to know if a user is connected is to hit the
  // per-provider /oauth/{slug}/status endpoint. Keyed by connector slug.
  const [oauthConnectedSlugs, setOauthConnectedSlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Tracks whether we've EVER completed a full status load. We can't show
  // cards on the basis of catalog presence alone — the SWR cache pre-fills
  // the catalog instantly, but the connection-status fetches resolve later,
  // so any card rendered before initialLoadComplete would flash "Not
  // connected" and then flip to "Connected" once status arrives. Gating the
  // grid on this state means cards appear with the correct state from the
  // first paint.
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [chooserService, setChooserService] = useState<ServiceRow | null>(null);
  // Switch-method intent: when set, the chooser modal is shown as a "switch"
  // dialog — picking a new method first disconnects the current one, then
  // connects via the chosen alternative. Distinct from the first-time choose
  // flow (which doesn't need a prior disconnect).
  const [switchingService, setSwitchingService] = useState<ServiceRow | null>(null);
  // Per-user tool policy editor. When set, opens a modal showing all MCP
  // tools exposed by the integration's Pipedream MCP server; user toggles
  // them individually. Writes to PipedreamProxyService.setMcpPolicy so each
  // user can deny tools globally disabled by admin AND deny additional ones
  // for themselves. Native connectors don't go through this path.
  const [toolsModalSvc, setToolsModalSvc] = useState<ServiceRow | null>(null);
  const [patPrompt, setPatPrompt] = useState<{
    connectorId: string;
    displayName: string;
    fields: PATCredentialField[];
  } | null>(null);
  // "Show unavailable" toggle: users can see every catalog entry — including
  // services the admin hasn't enabled yet — so they know what's possible and
  // can ask their admin to flip the switch. Off by default so the page stays
  // focused on what they can actually connect to today.
  const [showUnavailable, setShowUnavailable] = useState(false);

  const reload = useCallback(
    async (opts: { forceRefresh?: boolean } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const tasks: Promise<unknown>[] = [
          AdminIntegrationsService.catalogWithNuma(numaGet).then(setCatalog),
          DataConnectorsService.listStatus(numaGet).then(setNativeConnections),
          ConnectorsService.listConfigured()
            .then(async ({ oauth, pat }) => {
              const oauthSlugs = oauth.map((c) => c.id);
              setConfiguredNativeSlugs(new Set([...oauthSlugs, ...pat.map((c) => c.id)]));
              // Per-OAuth connection status — fetch each in parallel. The
              // backend status check reads from the consolidated vault, so
              // this is the only reliable way to know if a user has a live
              // OAuth token for a given connector.
              const statuses = await Promise.all(
                oauthSlugs.map(async (slug) => {
                  try {
                    const s = await ConnectorsService.getStatus(slug);
                    return [slug, s.status === 'connected'] as const;
                  } catch {
                    return [slug, false] as const;
                  }
                })
              );
              setOauthConnectedSlugs(new Set(statuses.filter(([, c]) => c).map(([slug]) => slug)));
            })
            .catch(() => undefined),
        ];
        if (user && lambdaClient) {
          const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
          tasks.push(
            PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
              ttlMs: 30 * 60 * 1000,
              forceRefresh: opts.forceRefresh,
            }).then((res) => {
              const connectedNames = res.connected_apps || [];
              const connections = (res.connections || []).map((c) => ({
                app_name: c.app_name,
                status: connectedNames.includes(c.app_name) ? 'connected' : 'not_connected',
                pipedream_account_id: c.pipedream_account_id,
                last_auth_check: c.last_auth_check || new Date().toISOString(),
                healthy: c.healthy,
                dead: c.dead,
                connection_name: c.connection_name,
                connected_at: c.connected_at,
              })) as ConnectionStatus[];
              setPipedreamConnections(connections);
            })
          );
        }
        await Promise.all(tasks);
      } catch (e) {
        setError((e as Error).message || t('errors.loadStatus', { message: '' }));
      } finally {
        setLoading(false);
        // Flip once we've finished a load attempt — even on error, so the grid
        // can render and surface the error rather than spin forever.
        setInitialLoadComplete(true);
      }
    },
    [numaGet, user, lambdaClient, t]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Handle Files-Remote redirect: scroll + briefly highlight the target card.
  // Gated on `loading === false` rather than a 350ms guess so we don't miss
  // the element when the catalog fetch is slow. Both timers are tracked so a
  // navigation away within the highlight window doesn't leak a setTimeout
  // closure against an unmounted DOM node.
  useEffect(() => {
    if (loading) return;
    const slug = location.hash.replace('#', '');
    if (!slug) return;
    const el = document.getElementById(`integration-card-${slug}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('integration-card--highlight');
    const removeId = window.setTimeout(() => {
      el.classList.remove('integration-card--highlight');
    }, 2000);
    return () => {
      window.clearTimeout(removeId);
      el.classList.remove('integration-card--highlight');
    };
  }, [location.hash, loading]);

  const services = useMemo<ServiceRow[]>(() => {
    return catalog
      .map((entry) => {
        const availableMethods = computeAvailableMethods(entry, configuredNativeSlugs);
        // Detect which method (if any) the user currently has an active
        // connection on. This drives both the "Connected" state and lets us
        // fall back to it as effectiveMethod when admin is in user-choice
        // mode — otherwise the card would say "Not connected" even when
        // there's an active session via one of the methods.
        // For native: OAuth tokens live in the user vault (oauthConnectedSlugs
        // from /oauth/{slug}/status), PAT/token connectors live in the
        // data-connectors DDB table (nativeConnections).
        const connectedVia: IntegrationMethod | null = (() => {
          if (entry.pipedreamSlug) {
            const conn = pipedreamConnections.find((c) => c.app_name === entry.pipedreamSlug);
            if (conn?.status === 'connected') return 'pipedream';
          }
          if (entry.connectorSlug) {
            if (oauthConnectedSlugs.has(entry.connectorSlug)) return 'native';
            // Status filter is critical: without it, a row left behind from a
            // prior connect (status='disconnected', 'configured', etc.) makes
            // the card look connected and traps the user. Only rows that
            // explicitly say 'connected' count.
            if (nativeConnections.some((c) => c.connector_id === entry.connectorSlug && c.status === 'connected'))
              return 'native';
          }
          return null;
        })();
        const adminEffective = computeEffectiveMethod(entry, availableMethods);
        const effectiveMethod = adminEffective ?? connectedVia;
        const isConnected = connectedVia !== null && availableMethods.includes(connectedVia);
        const display = resolveDisplay(entry);
        // Surface Pipedream health/dead signals on the card so users see
        // "Reconnect required" / "Account inactive" before chat fails.
        // Only meaningful for Pipedream — native OAuth has its own
        // error surface via the OAuth status endpoint, and PAT connectors
        // surface auth_error via the credential-request flow at tool-call time.
        const pdConn =
          entry.pipedreamSlug && connectedVia === 'pipedream'
            ? pipedreamConnections.find((c) => c.app_name === entry.pipedreamSlug)
            : undefined;
        return {
          entry,
          availableMethods,
          effectiveMethod,
          display,
          isConnected,
          healthy: pdConn?.healthy ?? null,
          dead: pdConn?.dead ?? null,
        };
      })
      .filter((s) => {
        // hq_only integrations (legacy gate from the pre-FEAT-143 page) —
        // hidden from non-admins. The catalog returns them to everyone, so
        // we re-apply the client-side filter here. Admins always see them.
        if (!s.entry.pipedreamSlug) return true;
        const cfg = getConnectionConfig(s.entry.pipedreamSlug);
        if (!cfg?.hq_only) return true;
        return Boolean(user?.groups?.includes('admin'));
      })
      .sort((a, b) => {
        if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
        return a.display.name.localeCompare(b.display.name);
      });
  }, [catalog, configuredNativeSlugs, pipedreamConnections, nativeConnections, oauthConnectedSlugs, user]);

  // Split into two groups: services the user can actually connect to right
  // now (≥1 admin-enabled method) vs. services that exist in the catalog but
  // are not currently enabled. The unavailable list only renders when the
  // "Show unavailable" toggle is on so it stays out of the way by default.
  const availableServices = useMemo(() => services.filter((s) => s.availableMethods.length > 0), [services]);
  const unavailableServices = useMemo(() => services.filter((s) => s.availableMethods.length === 0), [services]);

  const connectPipedream = useCallback(
    async (pipedreamSlug: string) => {
      if (!lambdaClient || !user) return;
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const tokenResponse = await PipedreamProxyService.generateConnectToken(lambdaClient, externalUserId);
      const { connectToken } = tokenResponse;
      const pd = createFrontendClient({
        tokenCallback: async () => ({
          token: connectToken,
          connectLinkUrl: tokenResponse.connectLinkUrl,
          expiresAt: new Date(tokenResponse.expiresAt),
        }),
        externalUserId,
        token: connectToken,
      });
      await new Promise<void>((resolve, reject) => {
        pd.connectAccount({
          app: pipedreamSlug,
          token: connectToken,
          onSuccess: () => resolve(),
          onError: (err) => reject(err),
        });
      });

      // Pipedream connect succeeded. Three things have to happen for the
      // card to flip to "Connected":
      //   1. Optimistic state update so the user sees instant feedback
      //      (otherwise the next render still reads the stale cache).
      //   2. Wipe every Pipedream status cache layer (in-memory, session,
      //      SWR/localStorage) — getIntegrationStatus defaults to a 30s TTL
      //      AND has SWR layers that survive page refresh; without an
      //      explicit invalidate the next reload serves stale data.
      //   3. forceRefresh: true on reload so the proxy is actually hit.
      // Without #2 + #3 the card stays "Not connected" for up to 30 min
      // even after a successful auth flow.
      setPipedreamConnections((prev) => {
        const existing = prev.find((c) => c.app_name === pipedreamSlug);
        if (existing) {
          return prev.map((c) => (c.app_name === pipedreamSlug ? { ...c, status: 'connected' as const } : c));
        }
        return [
          ...prev,
          {
            app_name: pipedreamSlug,
            status: 'connected' as const,
            pipedream_account_id: '',
            last_auth_check: new Date().toISOString(),
            healthy: true,
            dead: false,
          },
        ];
      });
      await PipedreamProxyService.invalidateIntegrationStatus(externalUserId);
      await reload({ forceRefresh: true });
    },
    [lambdaClient, user, reload]
  );

  const connectNative = useCallback(async (connectorSlug: string) => {
    // Stash a return path BEFORE ConnectorsService.connect — the OAuth path
    // does `window.location.href = authUrl` synchronously, so anything we set
    // afterward never runs. `OAuthCallback.tsx` reads this on success to send
    // the user back to the same integrations card.
    try {
      sessionStorage.setItem('integrations-return-path', `/integrations#${connectorSlug}`);
    } catch {
      /* sessionStorage unavailable — fall back to default redirect */
    }
    const action = await ConnectorsService.connect(connectorSlug);
    if (action.kind === 'unsupported') {
      // Connect didn't actually start — clear the return marker so a later
      // OAuth flow on a different page doesn't accidentally inherit it.
      try {
        sessionStorage.removeItem('integrations-return-path');
      } catch {
        /* ignore */
      }
      throw new Error(action.reason);
    }
    if (action.kind === 'redirecting') {
      return; // window will navigate
    }
    // PAT flow doesn't redirect → clear the marker we just set.
    try {
      sessionStorage.removeItem('integrations-return-path');
    } catch {
      /* ignore */
    }
    // PAT flow: open the inline credentials modal. The modal calls
    // ConnectorsService.saveCredentials and then triggers a reload.
    setPatPrompt({
      connectorId: action.connectorId,
      displayName: action.displayName,
      fields: action.fields,
    });
  }, []);

  const handleConnect = useCallback(
    async (svc: ServiceRow, methodOverride?: IntegrationMethod) => {
      const method = methodOverride ?? svc.effectiveMethod;
      if (!method) {
        setChooserService(svc);
        return;
      }
      setBusySlug(svc.entry.slug);
      try {
        if (method === 'pipedream' && svc.entry.pipedreamSlug) {
          await connectPipedream(svc.entry.pipedreamSlug);
        } else if (method === 'native' && svc.entry.connectorSlug) {
          await connectNative(svc.entry.connectorSlug);
        }
      } catch (e) {
        setError((e as Error).message || 'Connect failed');
      } finally {
        setBusySlug(null);
        setChooserService(null);
      }
    },
    [connectPipedream, connectNative]
  );

  const handleDisconnect = useCallback(
    async (svc: ServiceRow) => {
      // Surface impact warnings — disconnecting an integration cascades to
      // agents that reference it and automations (event triggers + scheduled
      // runs) wired to its tools. We can't cheaply enumerate the affected
      // resources here, so we surface a flat warning rather than a count.
      // Two flags gate the automations line so we only mention it when the
      // workspace actually has the feature available.
      const automationsEnabled = getFlag('SCHEDULING') || getFlag('EVENT_TRIGGERS');
      const ok = await confirm({
        message: (
          <div>
            <p className="mb-2">
              {t('actions.disconnectConfirmIntro', {
                defaultValue: 'Disconnect {{name}}?',
                name: svc.display.name,
              })}
            </p>
            <Alert variant="warning" className="py-2 px-3 mb-0 small d-flex align-items-start gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-1" />
              <div>
                <div className="fw-semibold">
                  {t('actions.disconnectWarnTitle', {
                    defaultValue: 'This may break things that depend on it',
                  })}
                </div>
                <ul className="mb-0 ps-3 mt-1">
                  <li>
                    {t('actions.disconnectWarnAgents', {
                      defaultValue: 'Agents that use this integration will stop working until you reconnect.',
                    })}
                  </li>
                  {automationsEnabled && (
                    <li>
                      {t('actions.disconnectWarnAutomations', {
                        defaultValue:
                          'Automations (triggers and scheduled agents) wired to this integration will fail to run.',
                      })}
                    </li>
                  )}
                </ul>
              </div>
            </Alert>
          </div>
        ),
        confirmLabel: tCommon('confirm.disconnect'),
        variant: 'danger',
      });
      if (!ok) return;

      // Detect which methods are CURRENTLY connected — disconnect every one.
      // Without this, a service like Gmail in user-choice mode might have
      // active connections on both methods (e.g. Pipedream cached, Native via
      // OAuth). Disconnecting only the "effective" method leaves the other
      // alive, and stale-cache fetches can resurrect the appearance of being
      // connected a few seconds later.
      const pdSlug = svc.entry.pipedreamSlug;
      const conSlug = svc.entry.connectorSlug;
      const pdActive = pdSlug ? pipedreamConnections.find((c) => c.app_name === pdSlug)?.status === 'connected' : false;
      const nativeOAuthActive = conSlug ? oauthConnectedSlugs.has(conSlug) : false;
      // Filter PAT activity by status='connected' — a stale row left over
      // from a prior failed disconnect must NOT count as "still active" or
      // we end up firing the wrong disconnect path and looping.
      const nativePatActive = conSlug
        ? nativeConnections.some((c) => c.connector_id === conSlug && c.status === 'connected')
        : false;
      // Whether there is ANY row in the data-connectors table for this
      // connector — we want to clear it regardless of OAuth vs PAT so a
      // re-connect starts from a clean slate. Critical for Gmail-native
      // where OAuth revoke alone leaves the DDB row "connected".
      const hasDataConnectorRow = conSlug ? nativeConnections.some((c) => c.connector_id === conSlug) : false;

      setBusySlug(svc.entry.slug);

      // Optimistic: drop the visible "connected" state immediately so the
      // user sees feedback in the same React tick. Real state catches up on
      // reload; on error we roll back via reload's response anyway.
      if (pdActive && pdSlug) {
        setPipedreamConnections((prev) =>
          prev.map((c) => (c.app_name === pdSlug ? { ...c, status: 'not_connected' } : c))
        );
      }
      if (nativeOAuthActive && conSlug) {
        setOauthConnectedSlugs((prev) => {
          const next = new Set(prev);
          next.delete(conSlug);
          return next;
        });
      }
      if (hasDataConnectorRow && conSlug) {
        setNativeConnections((prev) => prev.filter((c) => c.connector_id !== conSlug));
      }

      const tasks: Promise<unknown>[] = [];
      try {
        if (pdActive && pdSlug && lambdaClient && user) {
          const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
          tasks.push(
            PipedreamProxyService.disconnectIntegration(lambdaClient, externalUserId, {
              appName: pdSlug,
            })
          );
        }
        if ((nativeOAuthActive || nativePatActive) && conSlug) {
          // Facade routes to the right backend per registry authType, and
          // throws when the underlying revoke/delete fails so the catch below
          // can surface the error.
          tasks.push(ConnectorsService.disconnect(conSlug));
        }
        // ALWAYS clear the data-connector row when we know about one. OAuth
        // revoke + PAT delete only touch the credential store; the
        // data-connector row is a separate truth that, if left behind, keeps
        // the connector visibly "connected" in the UI on the next reload.
        // Idempotent backend — safe to call when there's nothing to remove.
        if (hasDataConnectorRow && conSlug) {
          tasks.push(DataConnectorsService.disconnect(conSlug, numaDelete).catch(() => undefined));
        }
        await Promise.all(tasks);
        // Force-refresh: bypass the 30-min Pipedream status cache (and the
        // OAuth statusCache, which our disconnect already invalidated) so the
        // page reflects truth, not a stale snapshot.
        await reload({ forceRefresh: true });
      } catch (e) {
        setError((e as Error).message || 'Disconnect failed');
        await reload({ forceRefresh: true });
      } finally {
        setBusySlug(null);
      }
    },
    [
      confirm,
      t,
      tCommon,
      lambdaClient,
      user,
      pipedreamConnections,
      oauthConnectedSlugs,
      nativeConnections,
      reload,
      numaDelete,
    ]
  );

  // Tear down EVERY currently-live method for a service. Shared by disconnect
  // and switch — extracted so the switch path can run the same teardown
  // contract right before connecting via the alternative method.
  const teardownAllMethods = useCallback(
    async (svc: ServiceRow) => {
      const pdSlug = svc.entry.pipedreamSlug;
      const conSlug = svc.entry.connectorSlug;
      const pdActive = pdSlug ? pipedreamConnections.find((c) => c.app_name === pdSlug)?.status === 'connected' : false;
      const nativeOAuthActive = conSlug ? oauthConnectedSlugs.has(conSlug) : false;
      const nativePatActive = conSlug
        ? nativeConnections.some((c) => c.connector_id === conSlug && c.status === 'connected')
        : false;
      const hasDataConnectorRow = conSlug ? nativeConnections.some((c) => c.connector_id === conSlug) : false;

      const tasks: Promise<unknown>[] = [];
      if (pdActive && pdSlug && lambdaClient && user) {
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        tasks.push(
          PipedreamProxyService.disconnectIntegration(lambdaClient, externalUserId, {
            appName: pdSlug,
          })
        );
      }
      if ((nativeOAuthActive || nativePatActive) && conSlug) {
        tasks.push(ConnectorsService.disconnect(conSlug));
      }
      if (hasDataConnectorRow && conSlug) {
        tasks.push(DataConnectorsService.disconnect(conSlug, numaDelete).catch(() => undefined));
      }
      await Promise.all(tasks);
    },
    [lambdaClient, user, pipedreamConnections, oauthConnectedSlugs, nativeConnections, numaDelete]
  );

  // Switch flow: open the method chooser immediately. The actual disconnect
  // + reconnect runs after the user picks a target method (see the chooser's
  // onPick below), so the user lands on a picker rather than a "Are you
  // sure?" prompt. Cleaner UX and the user can't get stranded mid-flow.
  const handleSwitch = useCallback((svc: ServiceRow) => {
    setSwitchingService(svc);
  }, []);

  return (
    <div className="dashboard integrations-page d-flex flex-column h-100">
      <LayoutDashboard>
        <PageHeader
          title={t('header.title')}
          subtitle={t('header.subtitle')}
          actions={
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => void reload({ forceRefresh: true })}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Spinner animation="border" size="sm" className="me-1" />
                  {tCommon('common.refreshing', { defaultValue: 'Refreshing' })}
                </>
              ) : (
                <>
                  <RefreshCw size={14} className="me-1" />
                  {tCommon('common.refresh', { defaultValue: 'Refresh' })}
                </>
              )}
            </Button>
          }
        />
        <Container fluid className="integrations-page-content">
          <div className="integrations-page-content__inner">
            {error && (
              <Alert variant="danger" dismissible onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            {/* Onboarding hero — four-step strip explaining the page. Uses the
              same `.integrations-step-*` styles defined for the old
              NumaIntegrations page so the number badges render as filled
              brand-coloured circles. */}
            {initialLoadComplete && (
              <div className="integrations-steps-card mb-4">
                <Row className="g-4">
                  {(['connect', 'signIn', 'optimize', 'work'] as const).map((stepKey, idx) => (
                    <Col md={3} key={stepKey}>
                      <div className="integrations-step-item">
                        <div className="integrations-step-badge integrations-step-item__number">{idx + 1}</div>
                        <h6 className="integrations-step-item__title">{t(`steps.${stepKey}.title`)}</h6>
                        <p className="integrations-step-item__body">
                          {stepKey === 'work' ? (
                            <>
                              {t('steps.work.bodyPrefix')}{' '}
                              <Button
                                variant="link"
                                size="sm"
                                className="integrations-step-item__link"
                                onClick={() => navigate('/chat')}
                              >
                                {t('steps.work.chatLink')}
                              </Button>
                            </>
                          ) : (
                            t(`steps.${stepKey}.body`)
                          )}
                        </p>
                      </div>
                    </Col>
                  ))}
                </Row>
              </div>
            )}
            {!initialLoadComplete ? (
              <div className="text-center py-5">
                <Spinner animation="border" variant="primary" />
              </div>
            ) : availableServices.length === 0 && unavailableServices.length === 0 ? (
              <Alert variant="info">{t('availableIntegrations')}</Alert>
            ) : (
              <>
                <div className="integrations-section-heading d-flex align-items-center">
                  <Grid3X3 size={20} className="integrations-available-heading__icon me-2" />
                  <h4 className="integrations-available-heading__text mb-0">
                    {t('availableIntegrationsWithCount', {
                      defaultValue: 'Available Integrations ({{count}})',
                      count: availableServices.length,
                    })}
                  </h4>
                  {unavailableServices.length > 0 && (
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="ms-auto"
                      onClick={() => setShowUnavailable((v) => !v)}
                    >
                      {showUnavailable ? <EyeOff size={14} className="me-1" /> : <Eye size={14} className="me-1" />}
                      {showUnavailable
                        ? t('actions.hideUnavailable', {
                            defaultValue: 'Hide unavailable ({{count}})',
                            count: unavailableServices.length,
                          })
                        : t('actions.showUnavailable', {
                            defaultValue: 'Show unavailable ({{count}})',
                            count: unavailableServices.length,
                          })}
                    </Button>
                  )}
                </div>
                {availableServices.length === 0 ? (
                  <Alert variant="info" className="mb-3">
                    {t('noAvailableIntegrations', {
                      defaultValue:
                        'No integrations are enabled yet — ask your admin to enable some, or browse the unavailable list below.',
                    })}
                  </Alert>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {availableServices.map((svc) => (
                      <IntegrationCard
                        key={svc.entry.slug}
                        svc={svc}
                        busy={busySlug === svc.entry.slug}
                        onConnect={() => void handleConnect(svc)}
                        onDisconnect={() => void handleDisconnect(svc)}
                        onSwitch={
                          svc.availableMethods.length === 2 && svc.isConnected ? () => handleSwitch(svc) : undefined
                        }
                        onConfigureTools={
                          svc.isConnected && svc.effectiveMethod === 'pipedream' && svc.entry.pipedreamSlug
                            ? () => setToolsModalSvc(svc)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
                {showUnavailable && unavailableServices.length > 0 && (
                  <>
                    <div className="integrations-section-heading mt-4">
                      <Grid3X3 size={20} className="integrations-available-heading__icon me-2 text-muted" />
                      <h4 className="integrations-available-heading__text mb-0 text-muted">
                        {t('unavailableIntegrationsWithCount', {
                          defaultValue: 'Not enabled by your admin ({{count}})',
                          count: unavailableServices.length,
                        })}
                      </h4>
                    </div>
                    <div className="d-flex flex-column gap-3">
                      {unavailableServices.map((svc) => (
                        <IntegrationCard
                          key={svc.entry.slug}
                          svc={svc}
                          busy={false}
                          onConnect={() => undefined}
                          onDisconnect={() => undefined}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </Container>
      </LayoutDashboard>

      <MethodChooserModal
        svc={chooserService}
        onHide={() => setChooserService(null)}
        onPick={(method) => {
          if (chooserService) void handleConnect(chooserService, method);
        }}
      />

      {/* Switch chooser: opens immediately when the user clicks Switch. The
          user picks the target method here; we then tear down ALL existing
          methods (Pipedream, native OAuth, native PAT, data-connector row)
          and connect via the chosen alternative. Re-resolve against the live
          `services` list so the chooser reflects current availableMethods,
          not the snapshot captured at click time. */}
      <MethodChooserModal
        svc={(() => {
          if (!switchingService) return null;
          return services.find((s) => s.entry.slug === switchingService.entry.slug) ?? switchingService;
        })()}
        onHide={() => setSwitchingService(null)}
        excludeMethod={switchingService?.effectiveMethod ?? undefined}
        onPick={(method) => {
          if (!switchingService) return;
          const live = services.find((s) => s.entry.slug === switchingService.entry.slug) ?? switchingService;
          setSwitchingService(null);
          // Sequence: teardown -> reload -> connect via chosen method. We
          // can't fire teardown + connect in parallel because some Connect
          // flows redirect the browser (OAuth) and need the prior credential
          // gone before they reauthorize.
          void (async () => {
            setBusySlug(live.entry.slug);
            try {
              await teardownAllMethods(live);
              await reload({ forceRefresh: true });
              const refreshed = services.find((s) => s.entry.slug === live.entry.slug) ?? live;
              await handleConnect(refreshed, method);
            } catch (e) {
              setError((e as Error).message || t('errors.switchFailed', { defaultValue: 'Switch failed' }));
            } finally {
              setBusySlug(null);
            }
          })();
        }}
      />

      <PATCredentialsModal
        prompt={patPrompt}
        onHide={() => setPatPrompt(null)}
        onSaved={async () => {
          setPatPrompt(null);
          await reload();
        }}
        onError={(msg) => setError(msg)}
      />

      <UserToolPolicyModal svc={toolsModalSvc} onHide={() => setToolsModalSvc(null)} onError={(msg) => setError(msg)} />
    </div>
  );
};

const IntegrationCard = ({
  svc,
  busy,
  onConnect,
  onDisconnect,
  onSwitch,
  onConfigureTools,
}: {
  svc: ServiceRow;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Provided only when the service has two methods available AND the user is
   *  currently connected — clicking opens the chooser to swap methods. */
  onSwitch?: () => void;
  /** Provided for connected Pipedream integrations — opens the per-user
   *  MCP tool policy modal where the user can deny individual tools. */
  onConfigureTools?: () => void;
}) => {
  const { t } = useTranslation('integrations');
  const { display, effectiveMethod, availableMethods, isConnected, healthy, dead } = svc;
  // No admin-enabled methods → card is purely informational. Render it muted,
  // swap the status pill for "Not enabled", and replace the action with a
  // hint pointing the user at their admin.
  const unavailable = availableMethods.length === 0;

  const status = unavailable ? (
    <span
      className="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle"
      style={{
        fontSize: '0.75rem',
        padding: '0.25rem 0.6rem',
        fontWeight: 500,
        letterSpacing: '0.01em',
      }}
    >
      {t('status.notEnabled', { defaultValue: 'Not enabled' })}
    </span>
  ) : !isConnected ? (
    <span className="integrations-row-status integrations-row-status--error">
      <span className="integrations-row-status__dot integrations-row-status__dot--error" />
      {t('status.notConnected', { defaultValue: 'Not connected' })}
    </span>
  ) : dead === true ? (
    <span className="integrations-row-status integrations-row-status--error">
      <AlertTriangle size={12} className="integrations-row-status__icon" aria-hidden />
      {t('status.dead', { defaultValue: 'Account inactive' })}
    </span>
  ) : healthy === false ? (
    <span className="integrations-row-status is-warning">
      <AlertTriangle size={12} className="integrations-row-status__icon" aria-hidden />
      {t('status.reconnectRequired', { defaultValue: 'Reconnect required' })}
    </span>
  ) : (
    <span className="integrations-row-status">
      <span className="integrations-row-status__dot" />
      {t('status.connected')}
    </span>
  );

  const actions = (
    <div className="integrations-row-actions">
      {unavailable ? (
        <span
          className="text-muted small fst-italic"
          title={t('actions.unavailableTooltip', {
            defaultValue: 'Ask your admin to enable this integration',
          })}
        >
          {t('actions.unavailableHint', { defaultValue: 'Ask your admin to enable' })}
        </span>
      ) : isConnected ? (
        <>
          {onConfigureTools && (
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={onConfigureTools}
              disabled={busy}
              title={t('actions.configureToolsTooltip', {
                defaultValue: 'Choose which actions this integration can use in your chats',
              })}
            >
              <Settings size={12} className="me-1" />
              {t('actions.configureTools', { defaultValue: 'Settings' })}
            </Button>
          )}
          {onSwitch && (
            <Button variant="outline-secondary" size="sm" onClick={onSwitch} disabled={busy}>
              <RefreshCcw size={12} className="me-1" />
              {t('actions.switch', { defaultValue: 'Switch' })}
            </Button>
          )}
          <Button variant="outline-danger" size="sm" onClick={onDisconnect} disabled={busy}>
            {busy ? <Spinner size="sm" /> : t('actions.disconnect', { defaultValue: 'Disconnect' })}
          </Button>
        </>
      ) : (
        <Button variant="primary" size="sm" onClick={onConnect} disabled={busy || availableMethods.length === 0}>
          {busy ? <Spinner size="sm" /> : t('actions.connect', { defaultValue: 'Connect' })}
        </Button>
      )}
    </div>
  );

  return (
    <div
      id={`integration-card-${svc.entry.slug}`}
      className="integrations-row-card"
      style={unavailable ? { opacity: 0.65 } : undefined}
    >
      <div className="integrations-row-card__inner">
        <div className="integrations-row-card__identity">
          <div className="integrations-row-card__app-icon d-flex align-items-center justify-content-center">
            {display.iconUrl ? (
              <img src={display.iconUrl} alt={display.name} width={28} height={28} style={{ objectFit: 'contain' }} />
            ) : display.iconClass ? (
              <i className={display.iconClass} style={{ fontSize: '1.5rem' }} />
            ) : (
              <Link2 size={20} />
            )}
          </div>
          <div className="integrations-row-card__text">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h6 className="integrations-row-card__name mb-0">{display.name}</h6>
              {unavailable ? null : effectiveMethod ? (
                <MethodBadge method={effectiveMethod} size="xs" />
              ) : (
                <span
                  className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle"
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontWeight: 500,
                    letterSpacing: '0.01em',
                    lineHeight: 1.2,
                    verticalAlign: 'middle',
                  }}
                >
                  {t('methodChooser.userPicks', { defaultValue: 'Choose method' })}
                </span>
              )}
            </div>
            <p className="integrations-row-card__description">{display.description}</p>
          </div>
        </div>
        <div className="integrations-row-card__controls">
          {status}
          {actions}
        </div>
      </div>
    </div>
  );
};

const MethodChooserModal = ({
  svc,
  onHide,
  onPick,
  excludeMethod,
}: {
  svc: ServiceRow | null;
  onHide: () => void;
  onPick: (method: IntegrationMethod) => void;
  /** Hide a method option (e.g. the user's CURRENT method in a switch flow,
   *  so they can only pick the alternative). */
  excludeMethod?: IntegrationMethod;
}) => {
  const { t } = useTranslation('integrations');
  if (!svc) return null;
  const showNative = svc.availableMethods.includes('native') && excludeMethod !== 'native';
  const showPipedream = svc.availableMethods.includes('pipedream') && excludeMethod !== 'pipedream';
  const isSwitch = Boolean(excludeMethod);
  return (
    <Modal show centered onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>
          {isSwitch
            ? t('methodChooser.switchTitle', {
                defaultValue: 'Switch connection method',
              })
            : t('methodChooser.title', { defaultValue: 'Choose connection method' })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">
          {isSwitch
            ? t('methodChooser.switchIntro', {
                defaultValue:
                  'Your existing connection will be disconnected first. Any agents or automations relying on it will need to be reconnected.',
              })
            : t('methodChooser.intro', {
                defaultValue:
                  "This service is available through both Numa's native connector and Pipedream. Pick whichever fits your needs.",
              })}
        </p>
        <div className="d-grid gap-2">
          {showNative && (
            <Button variant="outline-primary" onClick={() => onPick('native')} className="text-start">
              <div className="d-flex align-items-center gap-2 mb-1">
                <MethodBadge method="native" size="xs" />
                <strong>{t('methodChooser.nativeHeading', { defaultValue: 'Connect natively' })}</strong>
              </div>
              <div className="small text-muted">
                {t('methodChooser.nativeBody', {
                  defaultValue: 'Direct OAuth with the service. Tighter scopes, simpler permissions.',
                })}
              </div>
            </Button>
          )}
          {showPipedream && (
            <Button variant="outline-primary" onClick={() => onPick('pipedream')} className="text-start">
              <div className="d-flex align-items-center gap-2 mb-1">
                <MethodBadge method="pipedream" size="xs" />
                <strong>{t('methodChooser.pipedreamHeading', { defaultValue: 'Connect via Pipedream' })}</strong>
              </div>
              <div className="small text-muted">
                {t('methodChooser.pipedreamBody', {
                  defaultValue: 'Pipedream-managed OAuth with a broad pre-built action library.',
                })}
              </div>
            </Button>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
};

const PATCredentialsModal = ({
  prompt,
  onHide,
  onSaved,
  onError,
}: {
  prompt: { connectorId: string; displayName: string; fields: PATCredentialField[] } | null;
  onHide: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) => {
  const { t } = useTranslation('integrations');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset form when a new prompt opens.
  useEffect(() => {
    setValues({});
    setSaving(false);
  }, [prompt?.connectorId]);

  if (!prompt) return null;

  const missingRequired = prompt.fields.some((f) => f.required !== false && !values[f.key]?.trim());

  const submit = async () => {
    setSaving(true);
    try {
      await ConnectorsService.saveCredentials(prompt.connectorId, values);
      await onSaved();
    } catch (e) {
      onError((e as Error).message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal show centered onHide={onHide} backdrop={saving ? 'static' : true}>
      <Modal.Header closeButton={!saving}>
        <Modal.Title>
          {t('patCredentials.title', { defaultValue: 'Connect {{name}}', name: prompt.displayName })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">
          {t('patCredentials.intro', {
            defaultValue:
              'Enter your credentials. They are stored securely and only used to access this service on your behalf.',
          })}
        </p>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            if (!missingRequired) void submit();
          }}
        >
          {prompt.fields.map((field) => (
            <Form.Group key={field.key} className="mb-3">
              <Form.Label className="small fw-semibold">
                {t(field.label, { defaultValue: field.label })}
                {field.required !== false && <span className="text-danger ms-1">*</span>}
              </Form.Label>
              <Form.Control
                type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
                placeholder={field.placeholder}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                disabled={saving}
                autoComplete="off"
              />
              {field.helpText && (
                <Form.Text className="text-muted small">
                  {t(field.helpText, { defaultValue: field.helpText })}
                </Form.Text>
              )}
            </Form.Group>
          ))}
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={saving}>
          {t('actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || missingRequired}>
          {saving ? <Spinner size="sm" /> : t('actions.connect', { defaultValue: 'Connect' })}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// Per-user MCP tool policy editor for Pipedream-method integrations. Lists
// every action the integration's MCP server exposes; the user can deny any
// of them just for themselves (on top of whatever the workspace admin has
// already globally disabled). Writes to PipedreamProxyService.setMcpPolicy
// — that policy is scoped to the user's external_user_id, so it doesn't
// affect anyone else in the workspace.
const UserToolPolicyModal = ({
  svc,
  onHide,
  onError,
}: {
  svc: ServiceRow | null;
  onHide: () => void;
  onError: (msg: string) => void;
}) => {
  const { t } = useTranslation('integrations');
  const { user, lambdaClient } = useAuth();
  const [tools, setTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [initialToggles, setInitialToggles] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const pdSlug = svc?.entry.pipedreamSlug ?? null;
  const displayName = svc?.display.name ?? '';

  useEffect(() => {
    if (!svc || !pdSlug || !user || !lambdaClient) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        // Two parallel reads — list of available tools and the current
        // user policy (deny list). Admin-side deny lists aren't separately
        // surfaced here: the workspace agent already enforces them at the
        // tool layer, so anything admin disabled simply won't work even
        // if the user toggles it on here. The catalog/`global-integration-
        // settings` lookup that the old SettingsModal did for visual
        // distinction is intentionally skipped to avoid an extra
        // round-trip on modal open.
        const [toolsRes, userPolicy] = await Promise.all([
          PipedreamProxyService.listMcpTools(lambdaClient, externalUserId, pdSlug),
          PipedreamProxyService.getMcpPolicy(lambdaClient, externalUserId, pdSlug).catch(() => ({
            mode: 'deny' as const,
            denyTools: [] as string[],
          })),
        ]);
        if (cancelled) return;
        const toolList = toolsRes.tools ?? [];
        const userDeny = new Set(userPolicy.denyTools ?? []);
        const initial: Record<string, boolean> = {};
        for (const tool of toolList) {
          // "checked" = tool allowed (i.e. NOT in the user's deny list).
          initial[tool.name] = !userDeny.has(tool.name);
        }
        setTools(toolList);
        setToggles(initial);
        setInitialToggles(initial);
      } catch (e) {
        if (!cancelled) onError((e as Error).message || 'Failed to load tools');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [svc, pdSlug, user, lambdaClient, onError]);

  if (!svc || !pdSlug) return null;

  const dirty = JSON.stringify(toggles) !== JSON.stringify(initialToggles);

  const save = async () => {
    if (!user || !lambdaClient) return;
    setSaving(true);
    try {
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const denyTools = Object.entries(toggles)
        .filter(([, allowed]) => !allowed)
        .map(([name]) => name);
      await PipedreamProxyService.setMcpPolicy(lambdaClient, externalUserId, pdSlug, {
        mode: 'deny',
        denyTools,
      });
      onHide();
    } catch (e) {
      onError((e as Error).message || 'Failed to save tool policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show centered size="lg" onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>
          {t('toolPolicy.title', {
            defaultValue: 'Configure tools for {{name}}',
            name: displayName,
          })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        <p className="text-muted small">
          {t('toolPolicy.intro', {
            defaultValue:
              'Pick which actions this integration can use in your chats. Disabled here only affects you — the workspace admin controls what is available to everyone.',
          })}
        </p>
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" variant="primary" />
          </div>
        ) : tools.length === 0 ? (
          <Alert variant="info">{t('toolPolicy.empty', { defaultValue: 'No tools available.' })}</Alert>
        ) : (
          <div className="d-flex flex-column gap-2">
            {tools.map((tool) => (
              <div key={tool.name} className="d-flex align-items-start gap-3 p-2 border rounded-3 bg-white">
                <Form.Check
                  type="switch"
                  id={`tool-policy-${tool.name}`}
                  checked={Boolean(toggles[tool.name])}
                  disabled={saving}
                  onChange={(e) => setToggles((prev) => ({ ...prev, [tool.name]: e.target.checked }))}
                  label=""
                  className="mt-1"
                />
                <div className="flex-grow-1 min-w-0">
                  <div className="fw-semibold">{tool.name}</div>
                  {tool.description && <div className="small text-muted mt-1">{tool.description}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={saving}>
          {t('actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving || loading}>
          {saving ? (
            <Spinner animation="border" size="sm" />
          ) : (
            t('actions.saveChanges', { defaultValue: 'Save changes' })
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default UnifiedIntegrationsPage;
