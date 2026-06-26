import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dropdown, Spinner } from 'react-bootstrap';
import { Download } from 'react-bootstrap-icons';
import { ClientSidebar } from '@/components/NumaDashboard/ClientSidebar';
import { WindowSelector } from '@/components/NumaDashboard/WindowSelector';
import { OverviewTab } from '@/components/NumaDashboard/tabs/OverviewTab';
import { FleetMapTab } from '@/components/NumaDashboard/tabs/FleetMapTab';
import { CostEfficiencyTab } from '@/components/NumaDashboard/tabs/CostEfficiencyTab';
import { ChatTab } from '@/components/NumaDashboard/tabs/ChatTab';
import { ToolsModelsTab } from '@/components/NumaDashboard/tabs/ToolsModelsTab';
import { OperationsTab } from '@/components/NumaDashboard/tabs/OperationsTab';
import { ImpactTab } from '@/components/NumaDashboard/tabs/ImpactTab';
import { ReadmeTab, README_MARKDOWN } from '@/components/NumaDashboard/tabs/ReadmeTab';
import { CurrencyProvider } from '@/components/NumaDashboard/currencyContext';
import { CurrencyControl } from '@/components/NumaDashboard/CurrencyControl';
import { FileEarmarkText } from 'react-bootstrap-icons';
import { fleetAnalyticsService } from '@/services/fleetAnalyticsService';
import {
  aggregateSnapshots,
  ceForSnapshot,
  isAggregate,
  isInternalClient,
  isRandDDevStack,
  poolForAggregate,
  setLastNDays,
} from '@/components/NumaDashboard/shared';
import { computeInferredCosts } from '@/components/NumaDashboard/inferredCosts';
import { buildDashboardExport } from '@/components/NumaDashboard/dashboardExport';
import type { WindowState } from '@/components/NumaDashboard/shared';
import type { ClientSnapshot, DashboardView, SnapshotMetadata } from '@/types/fleetAnalytics';
import '@/components/NumaDashboard/styles.css';

const DEFAULT_SELECTION = '_FLEET';

type TabKey = 'overview' | 'fleet_map' | 'cost' | 'chat' | 'tools' | 'ops' | 'impact' | 'readme';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'fleet_map', label: 'Fleet Map' },
  { key: 'cost', label: 'Cost & Efficiency' },
  { key: 'chat', label: 'Chat & Conversations' },
  { key: 'tools', label: 'Tools & Models' },
  { key: 'ops', label: 'Operations' },
  { key: 'impact', label: 'Impact' },
  { key: 'readme', label: 'README.md' },
];

/**
 * Numa Dashboard — native React rendering of fleet analytics.
 *
 *   ┌─ sidebar ─┐ ┌─ header (client name, export) ──────────────────┐
 *   │ All Stacks│ │ window selector                                  │
 *   │ Client    │ │ tab bar                                          │
 *   │  Stacks   │ │ <tab content>                                    │
 *   │ ───────── │ │                                                  │
 *   │ nd-labs   │ │                                                  │
 *   │ av-media  │ │                                                  │
 *   │ ...       │ │                                                  │
 *   └───────────┘ └──────────────────────────────────────────────────┘
 *
 * Data flow: one `fetchAllSnapshots()` on mount loads every per-client
 * snapshot into memory (~30KB × ~150 stacks = ~5MB). The dashboard's
 * "view" is derived from that cache:
 *   - Real client selection → the matching snapshot directly
 *   - `_FLEET` / `_CLIENTS` → aggregateSnapshots(...) computed in browser
 *
 * This keeps the backend single-purpose (per-client only) and lets us add
 * new aggregate filters (nextgen / non-nextgen / dev / account-id dedupe)
 * without a Lambda redeploy.
 */
export default function NumaDashboard() {
  const [allSnapshots, setAllSnapshots] = useState<ClientSnapshot[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>(DEFAULT_SELECTION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [windowState, setWindowState] = useState<WindowState>(() => setLastNDays(30));

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fleetAnalyticsService.fetchAllSnapshots();
      // Defensive: filter out anything not shaped like a per-client snapshot
      // (e.g. legacy `_FLEET` / `_CLIENTS` items still sitting in DDB from the
      // pre-rewrite era — we ignore them; aggregates are derived in browser).
      const perClient: ClientSnapshot[] = [];
      for (const [name, body] of Object.entries(all)) {
        if (name.startsWith('_')) continue;
        perClient.push(body as ClientSnapshot);
      }
      setAllSnapshots(perClient);
    } catch (e) {
      setError(`Failed to load snapshots: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Sidebar metadata — derived from the loaded snapshots, no separate fetch
  const sidebarMetadata: SnapshotMetadata[] = useMemo(
    () =>
      allSnapshots.map((s) => ({
        clientName: s.client,
        generated_at: s.generated_at,
        dev_instance: Boolean(s.client_config?.dev_instance),
        client_account_id: s.client_config?.client_account_id,
        region: s.client_config?.region,
        chat_cost: s.chat?.totals?.cost || 0,
        ce_total: s.cost_explorer?.grand_total || 0,
        account_org: s.client_config?.account_org ?? null,
      })),
    [allSnapshots]
  );

  // Compute the currently-displayed view from the cache + selection
  const currentView: DashboardView | null = useMemo(() => {
    if (!allSnapshots.length) return null;
    if (selectedClient === '_FLEET') {
      return aggregateSnapshots(allSnapshots, { key: '_FLEET', kind: 'fleet' });
    }
    if (selectedClient === '_CLIENTS') {
      // External customer stacks only — exclude R&D dev stacks AND Arcanum's
      // own internal Numa deployment (hq). hq is dogfooding, not a customer.
      const prod = allSnapshots.filter(
        (s) => !isRandDDevStack(s.client, s.client_config?.dev_instance) && !isInternalClient(s.client)
      );
      return aggregateSnapshots(prod, { key: '_CLIENTS', kind: 'clients' });
    }
    if (selectedClient === '_NEXTGEN') {
      // Customer-owned NextGen sub-accounts (one stack per account by design).
      // Drives the "NextGen Clients" sidebar entry.
      const ng = allSnapshots.filter((s) => s.client_config?.account_org === 'nextgen');
      return aggregateSnapshots(ng, { key: '_NEXTGEN', kind: 'nextgen' });
    }
    if (selectedClient === '_STANDALONE') {
      // Customer-owned standalone accounts. Numa-attributable cost filter is
      // already applied inside aggregateSnapshots (dedupedCostExplorer) so
      // OpenSearch / RDS / etc. don't bleed into the donut.
      const sa = allSnapshots.filter((s) => s.client_config?.account_org === 'standalone');
      return aggregateSnapshots(sa, { key: '_STANDALONE', kind: 'standalone' });
    }
    if (selectedClient === '_ARCANUM') {
      // Every Arcanum-owned account (account_org !== 'standalone'): HQ +
      // dev/demo + all NextGen — i.e. everything Arcanum pays the AWS bill for.
      // Excludes customer-owned standalone accounts. This is the "Arcanum
      // spend" roll-up. Quota-sharing nets out within the pool (a NextGen
      // borrower's Claude billed to an Arcanum lender is reattributed by the
      // per-stack inferred-cost math).
      const arc = poolForAggregate(allSnapshots, 'arcanum');
      return aggregateSnapshots(arc, { key: '_ARCANUM', kind: 'arcanum' });
    }
    // Per-client view: apply the standalone Numa-attributable filter here so
    // every consumer (Overview KPIs, inferred-cost math, Cost Efficiency,
    // Chat, etc.) sees a filtered cost_explorer for standalone customers.
    // Without this, picking retailcare directly from the sidebar would expose
    // the customer's OpenSearch/RDS/EC2 spend in the "Total spend (inferred)"
    // KPI. nextgen/arcanum pass through unchanged.
    const snap = allSnapshots.find((s) => s.client === selectedClient);
    if (!snap) return null;
    const { ce, droppedTotal } = ceForSnapshot(snap);
    if (droppedTotal === 0) return snap; // pass-through (nothing was filtered)
    return {
      ...snap,
      cost_explorer: { ...ce, non_numa_filtered_total: droppedTotal },
    };
  }, [allSnapshots, selectedClient]);

  const triggerDownload = useCallback((payload: unknown, filenameSuffix: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `numa-dashboard-${filenameSuffix}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  /**
   * Raw export — every per-client snapshot as stored in DDB, plus the
   * snapshot-window inferred-cost block for each client. Daily maps included
   * so downstream consumers can slice their own windows.
   */
  const handleExportRaw = useCallback(() => {
    setExporting(true);
    setError(null);
    try {
      const snapshots: Record<string, ClientSnapshot> = {};
      const inferredCosts: Record<string, ReturnType<typeof computeInferredCosts>> = {};
      for (const s of allSnapshots) {
        snapshots[s.client] = s;
        // Use the snapshot's own window so the inferred numbers cover the
        // same range the rollup gathered (typically 90d), not the user's
        // current UI window selection.
        const win: WindowState = s.cost_explorer?.window
          ? {
              startDate: s.cost_explorer.window.start,
              endDate: s.cost_explorer.window.end,
              label: `${s.cost_explorer.window.days}d`,
            }
          : windowState;
        inferredCosts[s.client] = computeInferredCosts(s as unknown as DashboardView, win);
      }
      const payload = {
        exported_at: new Date().toISOString(),
        snapshot_count: allSnapshots.length,
        export_kind: 'raw_snapshots' as const,
        snapshots,
        inferred_costs: inferredCosts,
      };
      triggerDownload(payload, 'raw');
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }, [allSnapshots, triggerDownload, windowState]);

  /**
   * Dashboard-view export — per-client + _FLEET + _CLIENTS aggregates,
   * each rendered across all preset windows (7/14/30/60/90d) with KPIs and
   * the headline tables already computed. No raw daily maps — this is the
   * "what's on screen" view, suitable for LLM analysis without re-deriving.
   */
  const handleExportDashboardView = useCallback(() => {
    setExporting(true);
    setError(null);
    try {
      const bundle = {
        export_kind: 'dashboard_view' as const,
        ...buildDashboardExport(allSnapshots),
      };
      triggerDownload(bundle, 'view');
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }, [allSnapshots, triggerDownload]);

  /** Save the schema/design-decision README as a standalone .md file so it can
   * be paired with an exported JSON when handing the bundle to an LLM. */
  const handleDownloadReadme = useCallback(() => {
    const blob = new Blob([README_MARKDOWN], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `numa-dashboard-README-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const selectedMeta = sidebarMetadata.find((s) => s.clientName === selectedClient);

  const headerTitle = useMemo(() => {
    if (selectedClient === '_FLEET') return 'All Stacks';
    if (selectedClient === '_CLIENTS') return 'Client Stacks';
    if (selectedClient === '_NEXTGEN') return 'NextGen Clients';
    if (selectedClient === '_STANDALONE') return 'Standalone Clients';
    return selectedClient;
  }, [selectedClient]);

  return (
    <CurrencyProvider>
      <div className="d-flex nd-page-shell" style={{ marginTop: '-1.5rem', marginLeft: '-12px', marginRight: '-12px' }}>
        <ClientSidebar
          snapshots={sidebarMetadata}
          loading={loading}
          selectedClientName={selectedClient}
          onSelect={setSelectedClient}
        />

        <div className="flex-grow-1 d-flex flex-column" style={{ minWidth: 0 }}>
          <div className="d-flex align-items-center justify-content-between nd-page-header">
            <div>
              <h5 className="nd-page-title">
                {headerTitle}
                {selectedMeta?.dev_instance && <span className="nd-page-badge nd-dev">DEV STACK</span>}
                {currentView && isAggregate(currentView) && (
                  <span className="nd-page-badge nd-stack">
                    {currentView.stack_count} stacks
                    {currentView.unique_account_count !== currentView.stack_count
                      ? ` · ${currentView.unique_account_count} accounts`
                      : ''}
                  </span>
                )}
              </h5>
              {selectedMeta?.generated_at && (
                <div className="nd-page-sub">
                  Last refreshed {new Date(selectedMeta.generated_at).toLocaleString()}{' '}
                  <span className="nd-page-sub-faint">· auto-refreshed nightly</span>
                </div>
              )}
            </div>

            <div className="d-flex align-items-center gap-3">
              <CurrencyControl />
              <Button
                variant="outline-light"
                size="sm"
                onClick={handleDownloadReadme}
                className="d-flex align-items-center gap-2"
                title="Schema reference + design decisions. Hand this to an LLM alongside the exported JSON so it interprets the numbers correctly."
              >
                <FileEarmarkText />
                Download README for LLM analysis
              </Button>
              <Dropdown align="end">
                <Dropdown.Toggle
                  variant="outline-light"
                  size="sm"
                  disabled={exporting || !allSnapshots.length}
                  className="d-flex align-items-center gap-2"
                >
                  {exporting ? <Spinner animation="border" size="sm" /> : <Download />}
                  {exporting ? 'Bundling…' : 'Export all (JSON)'}
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item
                    onClick={handleExportRaw}
                    title="Every client's latest snapshot as stored in DDB, plus the inferred-cost block. Daily maps included so consumers can slice any window."
                  >
                    <div className="fw-semibold">Raw snapshots</div>
                    <div className="small text-muted">Per-client snapshots + inferred_costs · daily maps included</div>
                  </Dropdown.Item>
                  <Dropdown.Item
                    onClick={handleExportDashboardView}
                    title="What the dashboard renders: KPIs + key tables for every preset window (7/14/30/60/90d), per-client + _FLEET + _CLIENTS aggregates. No raw daily maps."
                  >
                    <div className="fw-semibold">Dashboard view</div>
                    <div className="small text-muted">
                      KPIs + tables across 7/14/30/60/90d windows · per-client + aggregates
                    </div>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </div>
          </div>

          {error && (
            <Alert variant="warning" className="m-3" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <div className="flex-grow-1" style={{ minHeight: 0, overflowY: 'auto' }}>
            {loading && !currentView && (
              <div className="nd-empty-state">
                <div className="d-flex align-items-center">
                  <Spinner animation="border" />
                  <span className="ms-2">Loading snapshots…</span>
                </div>
              </div>
            )}
            {!loading && !currentView && (
              <div className="nd-empty-state">
                <div>
                  <div className="mb-2">No snapshot data for {selectedClient}.</div>
                  <div className="nd-empty-state-hint">
                    The rollup Lambda runs nightly at midnight UTC. To trigger an ad-hoc refresh, start the{' '}
                    <code>numa-fleet-analytics-rollup-orchestrator</code> state machine.
                  </div>
                </div>
              </div>
            )}

            {currentView && (
              <div className="nd-root">
                <div className="nd-container">
                  <WindowSelector data={currentView} value={windowState} onChange={setWindowState} />

                  <div className="nd-tabs">
                    {TABS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={`nd-tab ${activeTab === t.key ? 'nd-active' : ''}`}
                        onClick={() => setActiveTab(t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'overview' && (
                    <OverviewTab data={currentView} window={windowState} snapshots={allSnapshots} />
                  )}
                  {activeTab === 'fleet_map' && (
                    <FleetMapTab
                      snapshots={allSnapshots}
                      sidebarSelection={selectedClient}
                      onSelectClient={(c) => setSelectedClient(c ?? DEFAULT_SELECTION)}
                    />
                  )}
                  {activeTab === 'cost' && <CostEfficiencyTab data={currentView} window={windowState} />}
                  {activeTab === 'chat' && <ChatTab data={currentView} window={windowState} snapshots={allSnapshots} />}
                  {activeTab === 'tools' && <ToolsModelsTab data={currentView} window={windowState} />}
                  {activeTab === 'ops' && <OperationsTab data={currentView} window={windowState} />}
                  {activeTab === 'impact' && <ImpactTab data={currentView} window={windowState} />}
                  {activeTab === 'readme' && <ReadmeTab />}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </CurrencyProvider>
  );
}
