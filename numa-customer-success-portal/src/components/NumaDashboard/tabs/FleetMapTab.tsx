/**
 * Fleet Map — bird's-eye constellation view.
 *
 * Adapts to the sidebar selection:
 *   - Aggregate selected (_FLEET / _CLIENTS / _NEXTGEN / _STANDALONE) →
 *     CLIENT constellation: each planet is a stack.
 *   - Real client selected → USER constellation: each planet is one of that
 *     client's users. Surfaces who's at risk, who's expensive, who's gone dark.
 *
 *   ┌──── filter rail ─────────────────────────────────────────┐
 *   │ search · org · trend · pulse · min ··                    │
 *   └──────────────────────────────────────────────────────────┘
 *   ┌──── constellation ────────────────┐  ┌── side panel ──┐
 *   │           ✸                       │  │ Legend         │
 *   │       NUMA  ✸    ✸                │  │ Selected stack │
 *   │   ✸               ✸               │  │ stats          │
 *   └───────────────────────────────────┘  └────────────────┘
 */
import { useEffect, useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import { Constellation } from '../Constellation';
import {
  COST_BUCKETS,
  COST_INTENSITY,
  HEALTH_BUCKETS,
  ORG_KIND_LABEL,
  buildFleetPlanets,
  computeFleetMap,
  fleetRingLabels,
} from '../fleetMap';
import type {
  CostBucket,
  FleetMapMetrics,
  FleetMapStats,
  FleetMode,
  HealthBucket,
  OrgKind,
  TrendDirection,
} from '../fleetMap';
import {
  USER_COST_BUCKETS,
  USER_ENGAGEMENT_BUCKETS,
  USER_RECENCY_LABELS,
  buildUserPlanets,
  computeClientUserMap,
  userRingLabels,
} from '../clientUserMap';
import type { UserEngagementBucket, UserMapMetrics, UserMapStats, UserRecency } from '../clientUserMap';
import { fmtN, fmtUSD0, friendlyAccountName } from '../shared';
import { ND_COLORS } from '../theme';
import { useCurrency } from '../currencyContext';
import type { ClientSnapshot } from '@/types/fleetAnalytics';

interface FleetMapTabProps {
  snapshots: ClientSnapshot[];
  /** The sidebar's current selection. If it's a real client (not an aggregate
   *  key like `_FLEET`), the constellation auto-switches to USER view for
   *  that client and isolates the matching planet. */
  sidebarSelection: string | null;
  /** Notify the parent when a CLIENT planet is clicked (fleet view), so the
   *  sidebar follows. Not used in user view (clicking a user planet just
   *  isolates locally — users aren't selectable in the sidebar). */
  onSelectClient: (client: string | null) => void;
}

const isRealClient = (sel: string | null): sel is string => !!sel && !sel.startsWith('_');

export function FleetMapTab({ snapshots, sidebarSelection, onSelectClient }: FleetMapTabProps) {
  useCurrency();
  const isUserView = isRealClient(sidebarSelection);
  // The matching snapshot when in user view.
  const clientSnapshot = useMemo(
    () => (isUserView ? (snapshots.find((s) => s.client === sidebarSelection) ?? null) : null),
    [isUserView, sidebarSelection, snapshots]
  );

  return isUserView && clientSnapshot ? (
    <ClientUserView snapshot={clientSnapshot} />
  ) : (
    <FleetView snapshots={snapshots} sidebarSelection={sidebarSelection} onSelectClient={onSelectClient} />
  );
}

// ─── FLEET VIEW (clients as planets) ────────────────────────────────────

interface FleetFilterState {
  search: string;
  orgKinds: Set<OrgKind>;
  trendFilter: TrendDirection | 'all';
  minProvisioned: number;
  pulseOnly: boolean;
  healthBuckets: Set<HealthBucket>;
  costBuckets: Set<CostBucket>;
}

function defaultFleetFilters(): FleetFilterState {
  return {
    search: '',
    orgKinds: new Set<OrgKind>(['nextgen', 'standalone', 'internal']),
    trendFilter: 'all',
    minProvisioned: 0,
    pulseOnly: false,
    healthBuckets: new Set<HealthBucket>(HEALTH_BUCKETS.map((b) => b.key)),
    costBuckets: new Set<CostBucket>(COST_BUCKETS.map((b) => b.key)),
  };
}

function applyFleetFilters(metrics: FleetMapMetrics[], f: FleetFilterState, mode: FleetMode): FleetMapMetrics[] {
  const q = f.search.trim().toLowerCase();
  return metrics.filter((m) => {
    if (q && !m.client.toLowerCase().includes(q)) return false;
    if (!f.orgKinds.has(m.orgKind)) return false;
    if (f.minProvisioned > 0 && m.provisionedUsers < f.minProvisioned) return false;
    if (f.pulseOnly && !(mode === 'health' ? m.pulse : m.costPulse)) return false;
    if (f.trendFilter !== 'all') {
      const dir = mode === 'health' ? m.trendDirection : m.costTrendDirection;
      if (dir !== f.trendFilter) return false;
    }
    if (mode === 'health' && !f.healthBuckets.has(m.healthBucket)) return false;
    if (mode === 'cost' && !f.costBuckets.has(m.costPerSeatBucket)) return false;
    return true;
  });
}

interface FleetViewProps {
  snapshots: ClientSnapshot[];
  sidebarSelection: string | null;
  onSelectClient: (client: string | null) => void;
}

function FleetView({ snapshots, sidebarSelection, onSelectClient }: FleetViewProps) {
  const [mode, setMode] = useState<FleetMode>('health');
  const [filters, setFilters] = useState<FleetFilterState>(defaultFleetFilters);

  // Sidebar selection sync (sidebar holds aggregate here — no client to isolate).
  const sidebarPlanetSelection = isRealClient(sidebarSelection) ? sidebarSelection : null;
  const [selectedClient, setSelectedClient] = useState<string | null>(sidebarPlanetSelection);
  useEffect(() => setSelectedClient(sidebarPlanetSelection), [sidebarPlanetSelection]);

  const handlePlanetSelect = (key: string | null) => {
    setSelectedClient(key);
    if (key) onSelectClient(key);
  };

  const { metrics, stats } = useMemo(() => computeFleetMap(snapshots), [snapshots]);
  const visible = useMemo(() => applyFleetFilters(metrics, filters, mode), [metrics, filters, mode]);
  const planets = useMemo(() => buildFleetPlanets(visible, stats, mode), [visible, stats, mode]);
  const selectedMetric = selectedClient ? (metrics.find((m) => m.client === selectedClient) ?? null) : null;

  return (
    <div className="fm-tab">
      <div className="nd-subtabs">
        {(['health', 'cost'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`nd-subtab ${mode === k ? 'nd-active' : ''}`}
            onClick={() => setMode(k)}
          >
            {k === 'health' ? 'Client Health' : 'Cost Map'}
          </button>
        ))}
      </div>

      <FleetFilterRail
        filters={filters}
        setFilters={setFilters}
        mode={mode}
        totalCount={metrics.length}
        visibleCount={visible.length}
      />

      <div className="fm-layout">
        <div className="fm-canvas-card">
          <Constellation
            planets={planets}
            ringLabels={fleetRingLabels(mode)}
            centerLabel="NUMA"
            selectedKey={selectedClient}
            onSelect={handlePlanetSelect}
          />
        </div>
        <div className="fm-side">
          <FleetLegend mode={mode} stats={stats} />
          {selectedMetric ? (
            <FleetDetailPanel
              metric={selectedMetric}
              mode={mode}
              stats={stats}
              onClear={() => setSelectedClient(null)}
            />
          ) : (
            <FleetEmptyDetail mode={mode} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Fleet filter rail / legend / detail panel ─────────────────────────

interface FleetFilterRailProps {
  filters: FleetFilterState;
  setFilters: (next: FleetFilterState) => void;
  mode: FleetMode;
  totalCount: number;
  visibleCount: number;
}

function FleetFilterRail({ filters, setFilters, mode, totalCount, visibleCount }: FleetFilterRailProps) {
  const toggleOrg = (k: OrgKind) => {
    const next = new Set(filters.orgKinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setFilters({ ...filters, orgKinds: next });
  };
  const toggleHealth = (k: HealthBucket) => {
    const next = new Set(filters.healthBuckets);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setFilters({ ...filters, healthBuckets: next });
  };
  const toggleCost = (k: CostBucket) => {
    const next = new Set(filters.costBuckets);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setFilters({ ...filters, costBuckets: next });
  };

  return (
    <div className="fm-filters nd-card">
      <div className="fm-filter-row">
        <div className="fm-filter-grow">
          <Form.Control
            type="search"
            size="sm"
            placeholder="Search clients…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>

        <div className="fm-filter-group">
          <span className="fm-filter-label">Org</span>
          {(Object.keys(ORG_KIND_LABEL) as OrgKind[]).map((k) => (
            <label key={k} className="nd-filter-pill">
              <input type="checkbox" checked={filters.orgKinds.has(k)} onChange={() => toggleOrg(k)} />
              {ORG_KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </div>

      <div className="fm-filter-row">
        <div className="fm-filter-group">
          <span className="fm-filter-label">Trend</span>
          {(['all', 'growing', 'flat', 'declining', 'unknown'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`fm-chip ${filters.trendFilter === t ? 'fm-chip-active' : ''}`}
              onClick={() => setFilters({ ...filters, trendFilter: t })}
            >
              {t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="fm-filter-group">
          <label className="nd-filter-pill">
            <input
              type="checkbox"
              checked={filters.pulseOnly}
              onChange={(e) => setFilters({ ...filters, pulseOnly: e.target.checked })}
            />
            Pulse only (7d Δ &gt; 20%)
          </label>
        </div>

        <div className="fm-filter-group">
          <span className="fm-filter-label">Min users</span>
          <Form.Control
            type="number"
            size="sm"
            min={0}
            value={filters.minProvisioned || ''}
            placeholder="0"
            style={{ width: 80 }}
            onChange={(e) =>
              setFilters({ ...filters, minProvisioned: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })
            }
          />
        </div>
      </div>

      <div className="fm-filter-row">
        {mode === 'health' ? (
          <div className="fm-filter-group">
            <span className="fm-filter-label">Ring</span>
            {HEALTH_BUCKETS.map((b) => (
              <label key={b.key} className="nd-filter-pill">
                <input
                  type="checkbox"
                  checked={filters.healthBuckets.has(b.key)}
                  onChange={() => toggleHealth(b.key)}
                />
                {b.label}
              </label>
            ))}
          </div>
        ) : (
          <div className="fm-filter-group">
            <span className="fm-filter-label">Ring</span>
            {COST_BUCKETS.map((b) => (
              <label key={b.key} className="nd-filter-pill">
                <input type="checkbox" checked={filters.costBuckets.has(b.key)} onChange={() => toggleCost(b.key)} />
                {b.label}
              </label>
            ))}
          </div>
        )}

        <div className="fm-filter-group fm-filter-count">
          Showing <strong>{visibleCount}</strong> of {totalCount} stacks
        </div>
      </div>
    </div>
  );
}

interface FleetLegendProps {
  mode: FleetMode;
  stats: FleetMapStats;
}

function FleetLegend({ mode, stats }: FleetLegendProps) {
  const costSeat = stats.costPerSeatBands;
  const costActive = stats.costPerActiveBands;
  return (
    <div className="nd-card fm-legend">
      <div className="fm-legend-title">How to read it</div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-position" />
        <div>
          <div className="fm-legend-label">Distance from Numa</div>
          <div className="fm-legend-desc">
            {mode === 'health' ? (
              'Engagement level today: % of provisioned users active in the last 30 days.'
            ) : (
              <>
                Inferred cost per <em>seat</em> per 30 days (how we bill). Closer to center = healthier margin.
              </>
            )}
          </div>
          {mode === 'cost' && (
            <div className="fm-legend-bands">
              <span className="fm-band fm-band-efficient">≤ {fmtUSD0(costSeat.efficientMax)}</span>
              <span className="fm-band fm-band-typical">≤ {fmtUSD0(costSeat.typicalMax)}</span>
              <span className="fm-band fm-band-expensive">≤ {fmtUSD0(costSeat.expensiveMax)}</span>
              <span className="fm-band fm-band-very-expensive">&gt; {fmtUSD0(costSeat.expensiveMax)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-size" />
        <div>
          <div className="fm-legend-label">Circle size</div>
          <div className="fm-legend-desc">Total provisioned users — bigger = more seats. Same on both views.</div>
        </div>
      </div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-colors">
          {mode === 'health' ? (
            <>
              <span style={{ background: ND_COLORS.good }} />
              <span style={{ background: ND_COLORS.warn }} />
              <span style={{ background: ND_COLORS.bad }} />
            </>
          ) : (
            <>
              <span style={{ background: ND_COLORS.good }} />
              <span style={{ background: '#84cc16' }} />
              <span style={{ background: ND_COLORS.warn }} />
              <span style={{ background: ND_COLORS.bad }} />
            </>
          )}
        </div>
        <div>
          <div className="fm-legend-label">Colour</div>
          <div className="fm-legend-desc">
            {mode === 'health' ? (
              <>
                30-day usage <em>direction</em>: are users using Numa more or less than the 30 days before? Green =
                growing, amber = flat, red = shrinking. (±20% noise band.)
              </>
            ) : (
              <>
                Cost per <em>active</em> user. Green = light usage per active, red = each active user burns lots of
                compute. Flags &quot;heavy users&quot;.
              </>
            )}
          </div>
          {mode === 'cost' && (
            <div className="fm-legend-bands">
              <span className="fm-band fm-band-light">≤ {fmtUSD0(costActive.lightMax)}</span>
              <span className="fm-band fm-band-moderate">≤ {fmtUSD0(costActive.moderateMax)}</span>
              <span className="fm-band fm-band-heavy">≤ {fmtUSD0(costActive.heavyMax)}</span>
              <span className="fm-band fm-band-very-heavy">&gt; {fmtUSD0(costActive.heavyMax)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-badge">
          <BadgeGlyph direction="up" />
          <BadgeGlyph direction="down" />
        </div>
        <div>
          <div className="fm-legend-label">↑ / ↓ Badge</div>
          <div className="fm-legend-desc">
            Significant 7-day shift (|Δ| &gt; 20%). {mode === 'health' ? 'Usage' : 'Cost'} up or down vs the week
            before.
          </div>
        </div>
      </div>

      {mode === 'health' && (
        <div className="fm-legend-explainer">
          <div className="fm-legend-explainer-title">Two signals, not one</div>
          <div className="fm-legend-explainer-body">
            <strong>Ring</strong> tells you where engagement <em>sits today</em>. <strong>Colour</strong> tells you
            where it&apos;s <em>headed</em>. A planet can be in the &quot;At risk&quot; ring (few seats active) but
            glowing green — the few users it has are using Numa more than before. That&apos;s a turnaround in progress,
            not an escalation.
          </div>
        </div>
      )}

      {mode === 'cost' && (
        <div className="fm-legend-explainer">
          <div className="fm-legend-explainer-title">Distance ≠ colour</div>
          <div className="fm-legend-explainer-body">
            <strong>Ring</strong> = cost per <em>seat</em> (margin economics — that&apos;s how we bill).
            <strong> Colour</strong> = cost per <em>active</em> user (intensity — heavy vs light users). A client can be
            &quot;Efficient&quot; (cheap per seat) but red (each active user burns lots) — usually a low-engagement
            client with a few power users.
          </div>
        </div>
      )}

      <div className="fm-legend-tip">
        Pick a client in the sidebar to switch to the user-level constellation for that customer.
      </div>
    </div>
  );
}

function BadgeGlyph({ direction }: { direction: 'up' | 'down' }) {
  const fill = direction === 'up' ? ND_COLORS.good : ND_COLORS.bad;
  const path = direction === 'up' ? 'M -3 1.5 L 0 -1.5 L 3 1.5' : 'M -3 -1.5 L 0 1.5 L 3 -1.5';
  return (
    <svg width={16} height={16} viewBox="-8 -8 16 16" style={{ display: 'block' }}>
      <circle r={7} fill="#FFFFFF" stroke={fill} strokeWidth={1.5} />
      <path d={path} stroke={fill} strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface FleetDetailPanelProps {
  metric: FleetMapMetrics;
  mode: FleetMode;
  stats: FleetMapStats;
  onClear: () => void;
}

function FleetDetailPanel({ metric: m, mode, stats, onClear }: FleetDetailPanelProps) {
  const ratioVsFleet = stats.meanActivityRatio
    ? (m.activityRatio - stats.meanActivityRatio) / stats.meanActivityRatio
    : 0;

  return (
    <div className="nd-card fm-detail">
      <div className="fm-detail-header">
        <div>
          <div className="fm-detail-name">{m.client}</div>
          <div className="fm-detail-meta">
            {ORG_KIND_LABEL[m.orgKind]}
            {m.region ? ` · ${m.region}` : ''}
            {m.accountId ? ` · ${friendlyAccountName(m.accountId)}` : ''}
          </div>
        </div>
        <button type="button" className="fm-detail-close" onClick={onClear} aria-label="Close">
          ×
        </button>
      </div>

      <div className="fm-detail-section">
        <div className="fm-detail-section-title">Engagement</div>
        <div className="fm-stat-row">
          <div className="fm-stat">
            <div className="fm-stat-label">Active (30d)</div>
            <div className="fm-stat-value">{fmtN(m.activeUsers30d)}</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Provisioned</div>
            <div className="fm-stat-value">{fmtN(m.provisionedUsers)}</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Activity ratio</div>
            <div className="fm-stat-value">{(m.activityRatio * 100).toFixed(0)}%</div>
            <div className="fm-stat-sub">
              {ratioVsFleet > 0 ? '+' : ''}
              {(ratioVsFleet * 100).toFixed(0)}% vs fleet
            </div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Bucket</div>
            <div className="fm-stat-value">
              <span className={`fm-bucket fm-bucket-${m.healthBucket}`}>
                {HEALTH_BUCKETS.find((b) => b.key === m.healthBucket)?.label ?? m.healthBucket}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="fm-detail-section">
        <div className="fm-detail-section-title">Trend & pulse</div>
        <div className="fm-stat-row">
          <div
            className="fm-stat"
            title="Sum of daily active-user counts. 5 users active for 3 days each = 15 active-days. Measures usage volume."
          >
            <div className="fm-stat-label">30d active days</div>
            <div className="fm-stat-value">{fmtN(m.userDays30d)}</div>
            <div className="fm-stat-sub">prior 30d {fmtN(m.userDaysPrior30d)}</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">30d direction</div>
            <div className={`fm-stat-value fm-dir-${m.trendDirection}`}>
              {m.trendDirection}{' '}
              <span className="fm-stat-sub">
                {m.trendDirection !== 'unknown' && `${m.trend30d > 0 ? '+' : ''}${(m.trend30d * 100).toFixed(0)}%`}
              </span>
            </div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">7d change</div>
            <div className={`fm-stat-value ${m.pulse ? 'fm-pulse-flag' : ''}`}>
              {m.pulseDelta > 0 ? '+' : ''}
              {(m.pulseDelta * 100).toFixed(0)}%
            </div>
            <div className="fm-stat-sub">{m.pulse ? '⚡ flagged' : 'within noise'}</div>
          </div>
        </div>
      </div>

      <div className="fm-detail-section">
        <div className="fm-detail-section-title">Cost (inferred)</div>
        <div className="fm-stat-row">
          <div className="fm-stat" title="How we bill: cost amortised across every provisioned seat.">
            <div className="fm-stat-label">Cost / seat / 30d</div>
            <div className="fm-stat-value">{fmtUSD0(m.costPerSeat)}</div>
            <div className="fm-stat-sub">
              {COST_BUCKETS.find((b) => b.key === m.costPerSeatBucket)?.label ?? m.costPerSeatBucket}
            </div>
          </div>
          <div className="fm-stat" title="Compute weight per engaged user — flags heavy users.">
            <div className="fm-stat-label">Cost / active / 30d</div>
            <div className="fm-stat-value">{isFinite(m.costPerActiveUser) ? fmtUSD0(m.costPerActiveUser) : '—'}</div>
            <div className="fm-stat-sub">
              {COST_INTENSITY.find((b) => b.key === m.costPerActiveIntensity)?.label ?? m.costPerActiveIntensity}
            </div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">30d total</div>
            <div className="fm-stat-value">{fmtUSD0(m.cost30d)}</div>
            <div className="fm-stat-sub">prior 30d {fmtUSD0(m.costPrior30d)}</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Cost trend</div>
            <div className={`fm-stat-value fm-dir-${m.costTrendDirection}`}>
              {m.costTrendDirection}{' '}
              <span className="fm-stat-sub">
                {m.costTrendDirection !== 'unknown' &&
                  `${m.costTrend > 0 ? '+' : ''}${(m.costTrend * 100).toFixed(0)}%`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {mode === 'health' && m.healthBucket === 'at_risk' && (
        <div className="fm-detail-callout fm-callout-warn">
          At-risk: only {fmtN(m.activeUsers30d)} of {fmtN(m.provisionedUsers)} provisioned users are active.
        </div>
      )}
      {mode === 'cost' && m.costPerSeatBucket === 'very_expensive' && (
        <div className="fm-detail-callout fm-callout-warn">
          Cost/seat above {fmtUSD0(stats.costPerSeatBands.expensiveMax)} — margin under stress. The cheapest fleet
          contract is ~$27/seat/mo, so anything above that is losing money there.
        </div>
      )}
      {mode === 'cost' && m.costPerActiveIntensity === 'very_heavy' && m.costPerSeatBucket !== 'very_expensive' && (
        <div className="fm-detail-callout fm-callout-warn">
          Each active user costs {fmtUSD0(m.costPerActiveUser)} / 30d to serve — heavy power-user pattern. Margin is OK
          at the seat level but watch if engagement broadens.
        </div>
      )}
    </div>
  );
}

function FleetEmptyDetail({ mode }: { mode: FleetMode }) {
  return (
    <div className="nd-card fm-detail fm-detail-empty">
      <div className="fm-detail-empty-title">No client selected</div>
      <div className="fm-detail-empty-body">
        Click a planet to drill into its {mode === 'health' ? 'engagement' : 'cost'} breakdown. Hover for a quick
        summary. Pick a client in the sidebar to drop into its user-level constellation.
      </div>
    </div>
  );
}

// ─── USER VIEW (users of a single client as planets) ───────────────────

interface UserFilterState {
  search: string;
  recencyKinds: Set<UserRecency>;
  pulseOnly: boolean;
  hideDormant: boolean;
  engagementBuckets: Set<UserEngagementBucket>;
}

function defaultUserFilters(): UserFilterState {
  return {
    search: '',
    recencyKinds: new Set<UserRecency>(['recent', 'lapsing', 'going_dark', 'dormant']),
    pulseOnly: false,
    hideDormant: false,
    engagementBuckets: new Set<UserEngagementBucket>(USER_ENGAGEMENT_BUCKETS.map((b) => b.key)),
  };
}

function applyUserFilters(metrics: UserMapMetrics[], f: UserFilterState): UserMapMetrics[] {
  const q = f.search.trim().toLowerCase();
  return metrics.filter((m) => {
    if (q && !m.displayName.toLowerCase().includes(q) && !m.userId.toLowerCase().includes(q)) return false;
    if (!f.recencyKinds.has(m.recency)) return false;
    if (f.pulseOnly && !m.badge) return false;
    if (f.hideDormant && m.engagementBucket === 'dormant') return false;
    if (!f.engagementBuckets.has(m.engagementBucket)) return false;
    return true;
  });
}

interface ClientUserViewProps {
  snapshot: ClientSnapshot;
}

function ClientUserView({ snapshot }: ClientUserViewProps) {
  const [filters, setFilters] = useState<UserFilterState>(defaultUserFilters);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  // Reset selection when the client changes (different user pool).
  useEffect(() => setSelectedUser(null), [snapshot.client]);

  const { metrics, stats } = useMemo(() => computeClientUserMap(snapshot), [snapshot]);
  const visible = useMemo(() => applyUserFilters(metrics, filters), [metrics, filters]);
  const planets = useMemo(() => buildUserPlanets(visible, stats), [visible, stats]);
  const selectedMetric = selectedUser ? (metrics.find((m) => m.userId === selectedUser) ?? null) : null;

  return (
    <div className="fm-tab">
      <UserFilterRail
        filters={filters}
        setFilters={setFilters}
        stats={stats}
        clientName={snapshot.client}
        visibleCount={visible.length}
      />

      <div className="fm-layout">
        <div className="fm-canvas-card">
          <Constellation
            planets={planets}
            ringLabels={userRingLabels()}
            centerLabel={snapshot.client.toUpperCase()}
            selectedKey={selectedUser}
            onSelect={setSelectedUser}
          />
        </div>
        <div className="fm-side">
          <UserLegend stats={stats} />
          {selectedMetric ? (
            <UserDetailPanel metric={selectedMetric} stats={stats} onClear={() => setSelectedUser(null)} />
          ) : (
            <UserEmptyDetail clientName={snapshot.client} stats={stats} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── User filter rail ──────────────────────────────────────────────────

interface UserFilterRailProps {
  filters: UserFilterState;
  setFilters: (next: UserFilterState) => void;
  stats: UserMapStats;
  clientName: string;
  visibleCount: number;
}

function UserFilterRail({ filters, setFilters, stats, clientName, visibleCount }: UserFilterRailProps) {
  const toggleRecency = (k: UserRecency) => {
    const next = new Set(filters.recencyKinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setFilters({ ...filters, recencyKinds: next });
  };
  const toggleEngagement = (k: UserEngagementBucket) => {
    const next = new Set(filters.engagementBuckets);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setFilters({ ...filters, engagementBuckets: next });
  };

  return (
    <div className="fm-filters nd-card">
      <div className="fm-filter-row">
        <div className="fm-filter-grow">
          <Form.Control
            type="search"
            size="sm"
            placeholder={`Search ${clientName} users…`}
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>

        <div className="fm-filter-group">
          <span className="fm-filter-label">Recency</span>
          {(Object.keys(USER_RECENCY_LABELS) as UserRecency[]).map((k) => (
            <label key={k} className="nd-filter-pill" title={USER_RECENCY_LABELS[k].description}>
              <input type="checkbox" checked={filters.recencyKinds.has(k)} onChange={() => toggleRecency(k)} />
              {USER_RECENCY_LABELS[k].label}
            </label>
          ))}
        </div>
      </div>

      <div className="fm-filter-row">
        <div className="fm-filter-group">
          <label className="nd-filter-pill">
            <input
              type="checkbox"
              checked={filters.pulseOnly}
              onChange={(e) => setFilters({ ...filters, pulseOnly: e.target.checked })}
            />
            Pulse only (7d Δ &gt; 20%)
          </label>
          <label className="nd-filter-pill">
            <input
              type="checkbox"
              checked={filters.hideDormant}
              onChange={(e) => setFilters({ ...filters, hideDormant: e.target.checked })}
            />
            Hide dormant (license waste)
          </label>
        </div>
      </div>

      <div className="fm-filter-row">
        <div className="fm-filter-group">
          <span className="fm-filter-label">Ring</span>
          {USER_ENGAGEMENT_BUCKETS.map((b) => (
            <label key={b.key} className="nd-filter-pill" title={b.description}>
              <input
                type="checkbox"
                checked={filters.engagementBuckets.has(b.key)}
                onChange={() => toggleEngagement(b.key)}
              />
              {b.label}
            </label>
          ))}
        </div>

        <div className="fm-filter-group fm-filter-count">
          Showing <strong>{visibleCount}</strong> of {stats.totalUsers} users · {stats.activeUsers30d} active in 30d
        </div>
      </div>
    </div>
  );
}

// ─── User legend ────────────────────────────────────────────────────────

interface UserLegendProps {
  stats: UserMapStats;
}

function UserLegend({ stats }: UserLegendProps) {
  return (
    <div className="nd-card fm-legend">
      <div className="fm-legend-title">How to read it</div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-position" />
        <div>
          <div className="fm-legend-label">Distance from centre</div>
          <div className="fm-legend-desc">
            How <em>frequently</em> the user logs in. Closer to centre = more active days in last 30.
          </div>
          <div className="fm-legend-bands">
            {USER_ENGAGEMENT_BUCKETS.map((b) => (
              <span key={b.key} className={`fm-band fm-band-engagement-${b.key}`}>
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-size" />
        <div>
          <div className="fm-legend-label">Circle size</div>
          <div className="fm-legend-desc">30-day inferred cost — bigger = heavier compute footprint.</div>
          <div className="fm-legend-bands">
            {USER_COST_BUCKETS.map((b) => (
              <span key={b.key} className={`fm-band fm-band-${b.key}`}>
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-colors">
          <span style={{ background: ND_COLORS.good }} />
          <span style={{ background: ND_COLORS.warn }} />
          <span style={{ background: ND_COLORS.bad }} />
          <span style={{ background: '#a8a29e' }} />
        </div>
        <div>
          <div className="fm-legend-label">Colour — recency</div>
          <div className="fm-legend-desc">
            When the user last logged in. Green = last 7d, amber = 8-14d, red = 15-30d, grey = no activity in 30d or
            never.
          </div>
        </div>
      </div>

      <div className="fm-legend-row">
        <div className="fm-legend-glyph fm-legend-badge">
          <BadgeGlyph direction="up" />
          <BadgeGlyph direction="down" />
        </div>
        <div>
          <div className="fm-legend-label">↑ / ↓ Badge</div>
          <div className="fm-legend-desc">Significant 7-day cost shift (|Δ| &gt; 20%) — usage ramp or drop-off.</div>
        </div>
      </div>

      <div className="fm-legend-explainer">
        <div className="fm-legend-explainer-title">What to look for</div>
        <div className="fm-legend-explainer-body">
          <strong>Big + far edge + red</strong> = was a heavy user, has gone dark. Escalation candidate.
          <br />
          <strong>Big + near centre + green</strong> = champion. Reference customer material.
          <br />
          <strong>Small + dormant + grey</strong> = provisioned but never used. License waste.
        </div>
      </div>

      <div className="fm-legend-tip">
        {stats.dormantUsers > 0 && (
          <>
            <strong>{stats.dormantUsers}</strong> of {stats.totalUsers} provisioned users had no activity in the last
            30d.
          </>
        )}
      </div>
    </div>
  );
}

// ─── User detail panel ────────────────────────────────────────────────

interface UserDetailPanelProps {
  metric: UserMapMetrics;
  stats: UserMapStats;
  onClear: () => void;
}

function UserDetailPanel({ metric: m, stats, onClear }: UserDetailPanelProps) {
  const shareOfClientCost = stats.totalCost30d > 0 ? m.cost30d / stats.totalCost30d : 0;

  return (
    <div className="nd-card fm-detail">
      <div className="fm-detail-header">
        <div>
          <div className="fm-detail-name">{m.displayName}</div>
          <div className="fm-detail-meta">
            {USER_RECENCY_LABELS[m.recency].label} ·{' '}
            {USER_ENGAGEMENT_BUCKETS.find((b) => b.key === m.engagementBucket)?.label}
          </div>
        </div>
        <button type="button" className="fm-detail-close" onClick={onClear} aria-label="Close">
          ×
        </button>
      </div>

      <div className="fm-detail-section">
        <div className="fm-detail-section-title">Activity</div>
        <div className="fm-stat-row">
          <div className="fm-stat" title="Number of distinct days in the last 30 with at least one message.">
            <div className="fm-stat-label">Active days / 30d</div>
            <div className="fm-stat-value">{fmtN(m.activeDays30d)}</div>
            <div className="fm-stat-sub">of 30 possible</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Last active</div>
            <div className="fm-stat-value">
              {m.daysSinceActive == null ? '—' : m.daysSinceActive === 0 ? 'Today' : `${fmtN(m.daysSinceActive)}d ago`}
            </div>
            <div className="fm-stat-sub">{m.lastActiveDay ?? 'No record'}</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Messages / 30d</div>
            <div className="fm-stat-value">{fmtN(m.messages30d)}</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Recency</div>
            <div className="fm-stat-value">
              <span className={`fm-bucket fm-bucket-recency-${m.recency}`}>{USER_RECENCY_LABELS[m.recency].label}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="fm-detail-section">
        <div className="fm-detail-section-title">Cost (inferred)</div>
        <div className="fm-stat-row">
          <div className="fm-stat">
            <div className="fm-stat-label">30d cost</div>
            <div className="fm-stat-value">{fmtUSD0(m.cost30d)}</div>
            <div className="fm-stat-sub">{(shareOfClientCost * 100).toFixed(0)}% of customer total</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">7d cost</div>
            <div className="fm-stat-value">{fmtUSD0(m.cost7d)}</div>
            <div className="fm-stat-sub">prior 7d {fmtUSD0(m.costPrior7d)}</div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">7d trend</div>
            <div className={`fm-stat-value ${m.badge ? `fm-dir-${m.badge === 'up' ? 'growing' : 'declining'}` : ''}`}>
              {m.badge ? (
                <>
                  {m.badge === 'up' ? '↑' : '↓'}{' '}
                  <span className="fm-stat-sub">
                    {m.costTrend7d > 0 ? '+' : ''}
                    {(m.costTrend7d * 100).toFixed(0)}%
                  </span>
                </>
              ) : (
                <span className="fm-stat-sub">within noise</span>
              )}
            </div>
          </div>
          <div className="fm-stat">
            <div className="fm-stat-label">Cost bucket</div>
            <div className="fm-stat-value">
              <span className={`fm-bucket fm-bucket-cost-${m.costBucket}`}>
                {USER_COST_BUCKETS.find((b) => b.key === m.costBucket)?.label ?? m.costBucket}
              </span>
            </div>
          </div>
        </div>
      </div>

      {m.engagementBucket === 'dormant' && m.daysSinceActive == null && (
        <div className="fm-detail-callout fm-callout-warn">
          Provisioned but never active. License waste signal — worth reaching out or freeing the seat.
        </div>
      )}
      {m.engagementBucket === 'dormant' && m.daysSinceActive != null && m.cost30d === 0 && m.daysSinceActive > 30 && (
        <div className="fm-detail-callout fm-callout-warn">
          No activity in last 30d (last seen {fmtN(m.daysSinceActive)}d ago). User has gone dark — possible churn risk.
        </div>
      )}
      {m.engagementBucket === 'power' && m.recency === 'recent' && (
        <div className="fm-detail-callout fm-callout-warn" style={{ borderColor: 'rgba(34, 197, 94, 0.22)' }}>
          Power user — uses Numa {fmtN(m.activeDays30d)} days a month. Champion candidate.
        </div>
      )}
    </div>
  );
}

function UserEmptyDetail({ clientName, stats }: { clientName: string; stats: UserMapStats }) {
  return (
    <div className="nd-card fm-detail fm-detail-empty">
      <div className="fm-detail-empty-title">{clientName} · user constellation</div>
      <div className="fm-detail-empty-body">
        {stats.totalUsers === 0 ? (
          <>No user data for this customer yet — the rollup may not have captured chat activity.</>
        ) : (
          <>
            Click a planet to drill into that user. {stats.activeUsers30d} of {stats.totalUsers} users active in the
            last 30 days; {stats.dormantUsers} dormant.
          </>
        )}
      </div>
    </div>
  );
}
