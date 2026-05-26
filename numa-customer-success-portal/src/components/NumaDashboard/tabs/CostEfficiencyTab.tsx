import { useMemo, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import '../chartSetup';
import {
  buildDayRange,
  filterDailyMap,
  fmtN,
  fmtUSD,
  fmtUSDc,
  isAggregate,
  pct,
  rollingMA,
  sumByKeyInWindow,
  sumDailyInWindow,
} from '../shared';
import { computeInferredCosts } from '../inferredCosts';
import { useCurrency } from '../currencyContext';
import { ND_COLORS, ND_FILL } from '../theme';
import type { WindowState } from '../shared';
import type { DashboardView } from '@/types/fleetAnalytics';

interface Props {
  data: DashboardView;
  window: WindowState;
}

/**
 * Cost & Efficiency tab. Replaces the old per-conversation iteration with
 * pure daily-bucket math — efficiency trends (cost/conv, cost/turn, etc.)
 * are derived by elementwise-dividing daily series. Works identically for
 * per-client + aggregate views since both have the same daily buckets.
 */
type CatFilter = 'all' | 'agent_run' | 'agent_chat' | 'plain_chat';

const CAT_OPTS: Array<{ key: CatFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'agent_run', label: 'Agent runs (sched/trig)' },
  { key: 'agent_chat', label: 'Agent chat (ad-hoc)' },
  { key: 'plain_chat', label: 'Plain chat' },
];

/**
 * For a metric, pick the right daily map based on the active category
 * filter. `key` is the metric (cost / messages / convs / turns / tool_calls).
 * Returns undefined when the active category doesn't have per-category data
 * for that metric (active_users, scheduled_count) — the metric is then
 * marked unavailable for that filter.
 */
function pickDailyMap(
  data: DashboardView,
  cat: CatFilter,
  key: 'cost' | 'messages' | 'convs' | 'turns' | 'tool_calls' | 'active_users' | 'scheduled_count'
): Record<string, number> | undefined {
  if (cat === 'all') {
    switch (key) {
      case 'cost':
        return data.chat?.daily_cost;
      case 'messages':
        return data.chat?.daily_messages;
      case 'convs':
        return data.chat?.daily_convs;
      case 'turns':
        return data.chat?.daily_turns;
      case 'tool_calls':
        return data.chat?.daily_tool_calls;
      case 'active_users':
        return data.chat?.daily_active_users;
      case 'scheduled_count':
        return data.chat?.daily_scheduled_count;
    }
  }
  // Category-scoped: pull from daily_*_by_category maps. Returns undefined
  // for metrics we don't break out per category (active_users).
  switch (key) {
    case 'cost':
      return data.chat?.daily_cost_by_category?.[cat];
    case 'messages':
      return data.chat?.daily_messages_by_category?.[cat];
    case 'convs':
      return data.chat?.daily_convs_by_category?.[cat];
    case 'turns':
      return data.chat?.daily_turns_by_category?.[cat];
    case 'tool_calls':
      return data.chat?.daily_tool_calls_by_category?.[cat];
    case 'active_users':
      return undefined;
    case 'scheduled_count':
      return undefined;
  }
}

interface EffMetric {
  key: string;
  lbl: string;
  sub: string;
  /** Numerator/denominator metric ids (used to lookup the right daily map). */
  num: 'cost' | 'messages' | 'convs' | 'turns' | 'tool_calls' | 'active_users' | 'scheduled_count';
  den: 'cost' | 'messages' | 'convs' | 'turns' | 'tool_calls' | 'active_users' | 'scheduled_count';
  fmt: (n: number) => string;
  /** Cat filters this metric does NOT support (greyed out). */
  unavailableFor?: CatFilter[];
}

const METRICS: EffMetric[] = [
  {
    key: 'cost_per_msg',
    lbl: 'Cost / message',
    sub: 'Chat cost ÷ user messages',
    num: 'cost',
    den: 'messages',
    fmt: fmtUSDc,
  },
  { key: 'cost_per_turn', lbl: 'Cost / turn', sub: 'Chat cost ÷ total turns', num: 'cost', den: 'turns', fmt: fmtUSDc },
  {
    key: 'cost_per_conv',
    lbl: 'Cost / conv',
    sub: 'Chat cost ÷ conversations',
    num: 'cost',
    den: 'convs',
    fmt: fmtUSD,
  },
  {
    key: 'cost_per_active_user',
    lbl: 'Cost / active user',
    sub: 'Chat cost ÷ active users (per day)',
    num: 'cost',
    den: 'active_users',
    fmt: fmtUSD,
    unavailableFor: ['agent_run', 'agent_chat', 'plain_chat'],
  },
  {
    key: 'msgs_per_user',
    lbl: 'Msgs / active user',
    sub: 'User msgs ÷ daily active users',
    num: 'messages',
    den: 'active_users',
    fmt: (n) => n.toFixed(1),
    unavailableFor: ['agent_run', 'agent_chat', 'plain_chat'],
  },
  {
    key: 'tools_per_msg',
    lbl: 'Tools / message',
    sub: 'Tool calls ÷ user messages',
    num: 'tool_calls',
    den: 'messages',
    fmt: (n) => n.toFixed(2),
  },
  {
    key: 'turns_per_conv',
    lbl: 'Turns / conv',
    sub: 'Total turns ÷ conversations',
    num: 'turns',
    den: 'convs',
    fmt: (n) => n.toFixed(1),
  },
  {
    key: 'sched_share',
    lbl: 'Scheduled share',
    sub: 'Scheduled convs ÷ all convs',
    num: 'scheduled_count',
    den: 'convs',
    fmt: (n) => (100 * n).toFixed(1) + '%',
    unavailableFor: ['agent_run', 'agent_chat', 'plain_chat'],
  },
];

export function CostEfficiencyTab({ data, window }: Props) {
  useCurrency();
  const [activeKey, setActiveKey] = useState('cost_per_conv');
  const [cat, setCat] = useState<CatFilter>('all');
  const metric = METRICS.find((m) => m.key === activeKey) || METRICS[0];
  const metricUnavailable = (metric.unavailableFor || []).includes(cat);

  const days = useMemo(() => buildDayRange(window.startDate, window.endDate), [window]);

  // Daily-bucketed metric series: elementwise divide. When the active
  // metric is unavailable for the current cat filter, the series is all
  // zeros (the chart shows a flat line and the KPI shows "—").
  const series = useMemo(() => {
    if (metricUnavailable) return days.map(() => 0);
    const numMap = pickDailyMap(data, cat, metric.num) || {};
    const denMap = pickDailyMap(data, cat, metric.den) || {};
    return days.map((d) => {
      const n = numMap[d] || 0;
      const e = denMap[d] || 0;
      return e ? n / e : 0;
    });
  }, [data, days, metric, cat, metricUnavailable]);
  const movingAvg = useMemo(() => rollingMA(series, 30), [series]);

  // Aggregate-only: outlier stacks + per-stack stats
  const agg = isAggregate(data) ? data : null;
  const cfg = !isAggregate(data) ? data.client_config || null : null;

  // Per-agent table — base rows come from chat.by_agent (snapshot-window),
  // but the cost columns (sched / adhoc / total) are RE-COMPUTED from the
  // per-day per-agent buckets so the dashboard's window picker actually
  // works. Run counts stay snapshot-window since we don't store per-day
  // per-agent run counts (would balloon snapshot size for marginal value).
  const schedCostByAgentInWin = useMemo(
    () => sumByKeyInWindow(data.chat?.daily_scheduled_cost_by_agent, window),
    [data, window]
  );
  const adhocCostByAgentInWin = useMemo(
    () => sumByKeyInWindow(data.chat?.daily_adhoc_cost_by_agent, window),
    [data, window]
  );
  const totalCostByAgentInWin = useMemo(() => sumByKeyInWindow(data.chat?.daily_cost_by_agent, window), [data, window]);
  const perAgent = useMemo(() => {
    const base = data.chat?.by_agent || [];
    const enriched = base.map((a) => {
      const winTotal = totalCostByAgentInWin[a.agent_id];
      const winSched = schedCostByAgentInWin[a.agent_id];
      const winAdhoc = adhocCostByAgentInWin[a.agent_id];
      return {
        ...a,
        // Prefer windowed values when daily buckets are present; fall back
        // to the snapshot-window totals on older snapshots.
        cost: winTotal != null ? winTotal : a.cost,
        scheduled_cost: winSched != null ? winSched : (a.scheduled_cost ?? 0),
        adhoc_cost: winAdhoc != null ? winAdhoc : (a.adhoc_cost ?? 0),
      };
    });
    // Re-sort by windowed cost so the top-30 reflects in-window activity.
    enriched.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    return enriched.slice(0, 30);
  }, [data, schedCostByAgentInWin, adhocCostByAgentInWin, totalCostByAgentInWin]);

  // Window-aware per-category totals from daily_*_by_category buckets.
  // Falls back to snapshot-wide by_category if the daily buckets are
  // missing (older snapshots that pre-date this field).
  const categoriesInWindow = useMemo(() => {
    const out: Record<string, { cost: number; convs: number; user_messages: number; fromDaily: boolean }> = {
      agent_run: { cost: 0, convs: 0, user_messages: 0, fromDaily: false },
      agent_chat: { cost: 0, convs: 0, user_messages: 0, fromDaily: false },
      plain_chat: { cost: 0, convs: 0, user_messages: 0, fromDaily: false },
    };
    const costMap = data.chat?.daily_cost_by_category;
    const msgMap = data.chat?.daily_messages_by_category;
    const convMap = data.chat?.daily_convs_by_category;
    const hasDaily = Boolean(costMap || msgMap || convMap);
    for (const cat of ['agent_run', 'agent_chat', 'plain_chat'] as const) {
      if (hasDaily) {
        out[cat].cost = sumDailyInWindow(costMap?.[cat], window);
        out[cat].user_messages = sumDailyInWindow(msgMap?.[cat], window);
        out[cat].convs = sumDailyInWindow(convMap?.[cat], window);
        out[cat].fromDaily = true;
      } else {
        const snap = data.chat?.by_category?.[cat];
        out[cat].cost = snap?.cost || 0;
        out[cat].user_messages = snap?.user_messages || 0;
        out[cat].convs = snap?.convs || 0;
      }
    }
    return out;
  }, [data, window]);

  const byCategoryTotalCost = useMemo(
    () => categoriesInWindow.agent_run.cost + categoriesInWindow.agent_chat.cost + categoriesInWindow.plain_chat.cost,
    [categoriesInWindow]
  );

  // True if at least one category came from the daily-per-category buckets
  // (so we can label the table "in window" vs "snapshot-window").
  const categoriesAreWindowed = useMemo(
    () =>
      categoriesInWindow.agent_run.fromDaily ||
      categoriesInWindow.agent_chat.fromDaily ||
      categoriesInWindow.plain_chat.fromDaily,
    [categoriesInWindow]
  );

  // Bedrock usage-type breakdown
  const but = data.cost_explorer?.bedrock_usage_type_totals || {};
  const butEntries = Object.entries(but).sort((a, b) => b[1] - a[1]);

  // Tokens
  const totals = data.chat?.totals;
  const tokensRead = totals?.cache_read_tokens || 0;
  const tokensCreation = totals?.cache_creation_tokens || 0;
  const tokensInput = totals?.input_tokens || 0;
  const tokensOutput = totals?.output_tokens || 0;

  const totalCEInWindow = useMemo(
    () => Object.values(filterDailyMap(data.cost_explorer?.totals_by_day, window)).reduce((a, b) => a + b, 0),
    [data, window]
  );

  const inferred = useMemo(() => computeInferredCosts(data, window), [data, window]);

  return (
    <>
      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div>
            <div className="nd-card-title">Inferred vs raw daily cost</div>
            <div className="nd-card-subtitle">
              Inferred (bold) − raw AWS CE (light) gap is what's quota-shared. Same y-axis · sums to{' '}
              {fmtUSD(inferred.totals.inferred)} inferred vs {fmtUSD(inferred.totals.ceTotal)} raw in window
              {inferred.role === 'lender' && ` · ${fmtUSD(inferred.totals.lent)} lent to borrowers`}
              {inferred.role === 'borrower' && ` · ${fmtUSD(inferred.totals.borrowed)} borrowed from pool`}
              {inferred.role === 'mixed' &&
                ` · ${fmtUSD(inferred.totals.lent)} lent · ${fmtUSD(inferred.totals.borrowed)} borrowed`}
            </div>
          </div>
        </div>
        <div className="nd-chart-wrap" style={{ height: 280 }}>
          <Line
            data={{
              labels: days,
              datasets: [
                {
                  label: 'AWS CE total (raw)',
                  data: days.map((d) => (data.cost_explorer?.totals_by_day || {})[d] || 0),
                  borderColor: ND_COLORS.accent,
                  backgroundColor: ND_FILL.accent,
                  borderWidth: 1.5,
                  pointRadius: 1.5,
                  tension: 0.25,
                  fill: true,
                },
                {
                  label: 'Inferred total',
                  data: days.map((d) => inferred.inferredTotalDaily[d] || 0),
                  borderColor: ND_COLORS.accent2,
                  backgroundColor: 'transparent',
                  borderWidth: 2.5,
                  pointRadius: 1.5,
                  tension: 0.25,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: {
                  mode: 'index',
                  intersect: false,
                  callbacks: { label: (c) => `${c.dataset.label}: ${fmtUSD(c.parsed.y as number)}` },
                },
              },
              scales: {
                x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } },
              },
            }}
          />
        </div>
      </div>

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div>
            <div className="nd-card-title">
              Efficiency metrics{' '}
              <span style={{ color: 'var(--nd-text-faint)', fontWeight: 400, fontSize: 12 }}>(chat costs only)</span>
            </div>
            <div className="nd-card-subtitle">
              Click any metric to plot it over time. Filter by category to see chat vs agent vs scheduled costs in
              isolation. Greyed metrics aren't available per-category.
            </div>
          </div>
        </div>
        <div className="nd-subtabs" style={{ marginBottom: 12 }}>
          {CAT_OPTS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`nd-subtab ${cat === opt.key ? 'nd-active' : ''}`}
              onClick={() => setCat(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="nd-eff-grid">
          {METRICS.map((m) => {
            const disabled = (m.unavailableFor || []).includes(cat);
            const n = disabled ? 0 : sumDailyInWindow(pickDailyMap(data, cat, m.num), window);
            const d = disabled ? 0 : sumDailyInWindow(pickDailyMap(data, cat, m.den), window);
            const v = d ? n / d : 0;
            return (
              <div
                key={m.key}
                className={`nd-eff-cell ${activeKey === m.key ? 'nd-eff-active' : ''}`}
                onClick={() => !disabled && setActiveKey(m.key)}
                style={{
                  opacity: disabled ? 0.45 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                <div className="nd-eff-lbl">{m.lbl}</div>
                <div className="nd-eff-val">{disabled ? '—' : m.fmt(v)}</div>
                <div className="nd-eff-sub">{disabled ? 'not split by category' : m.sub}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 18 }}>
          <div className="nd-chart-wrap" style={{ height: 300 }}>
            <Line
              data={{
                labels: days,
                datasets: [
                  {
                    label: `Daily ${metric.lbl}`,
                    data: series,
                    borderColor: ND_FILL.accentStrong,
                    borderWidth: 1.5,
                    pointRadius: 1.5,
                    tension: 0.25,
                  },
                  {
                    label: '30-day moving avg',
                    data: movingAvg as number[],
                    borderColor: ND_COLORS.accent2,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    tension: 0.3,
                  },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'top', align: 'end' },
                  tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: { label: (c) => `${c.dataset.label}: ${metric.fmt(c.parsed.y as number)}` },
                  },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                  y: { beginAtZero: true, ticks: { callback: (v) => metric.fmt(v as number) } },
                },
              }}
            />
          </div>
        </div>
      </div>

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">Cost by category</div>
          <div className="nd-card-subtitle">
            {categoriesAreWindowed
              ? 'In selected window'
              : 'Snapshot-window totals (older snapshot — refresh once rollup runs)'}
            {
              ' · 3-way split: agent runs (scheduled/triggered) vs agent chat (ad-hoc with agent) vs plain chat (no agent)'
            }
          </div>
        </div>
        <table className="nd-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="nd-num">Convs / runs</th>
              <th className="nd-num">User msgs</th>
              <th className="nd-num">Cost</th>
              <th className="nd-num">$/conv</th>
              <th className="nd-num">$/msg</th>
              <th className="nd-num">Share</th>
            </tr>
          </thead>
          <tbody>
            {(['agent_run', 'agent_chat', 'plain_chat'] as const).map((k) => {
              const c = categoriesInWindow[k];
              const label =
                k === 'agent_run'
                  ? 'agent run (sched/trig)'
                  : k === 'agent_chat'
                    ? 'agent chat (ad-hoc)'
                    : 'plain chat';
              const cls = k === 'agent_run' ? 'nd-info-pill' : k === 'agent_chat' ? 'nd-accent-pill' : '';
              // For scheduled agent runs, $/conv ≡ $/msg because each run is
              // one shot (one prompt, one outcome). Show "—" on $/msg to
              // avoid showing two near-identical numbers.
              const showPerMsg = k !== 'agent_run';
              return (
                <tr key={k}>
                  <td>
                    <span className={`nd-pill ${cls}`}>{label}</span>
                  </td>
                  <td className="nd-num">{fmtN(c.convs)}</td>
                  <td className="nd-num">{fmtN(c.user_messages)}</td>
                  <td className="nd-num">{fmtUSD(c.cost)}</td>
                  <td className="nd-num">{c.convs ? fmtUSD(c.cost / c.convs) : '—'}</td>
                  <td className="nd-num">
                    {showPerMsg ? (c.user_messages ? fmtUSDc(c.cost / c.user_messages) : '—') : '—'}
                  </td>
                  <td className="nd-num">{pct(c.cost, byCategoryTotalCost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">Per-agent cost</div>
          <div className="nd-card-subtitle">
            Cost columns filtered to window · top {perAgent.length} by in-window cost · run counts are snapshot-window
          </div>
        </div>
        <table className="nd-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="nd-num">Sched runs</th>
              <th className="nd-num">Sched cost</th>
              <th className="nd-num">$/sched run</th>
              <th className="nd-num">Ad-hoc convs</th>
              <th className="nd-num">Ad-hoc cost</th>
              <th className="nd-num">$/adhoc conv</th>
              <th className="nd-num">Total cost</th>
            </tr>
          </thead>
          <tbody>
            {perAgent.length === 0 ? (
              <tr>
                <td colSpan={8} className="nd-empty">
                  No tagged agent activity
                </td>
              </tr>
            ) : (
              perAgent.map((r) => {
                const sCost = r.scheduled_cost ?? 0;
                const aCost = r.adhoc_cost ?? 0;
                const sRuns = r.scheduled_count || 0;
                const aConvs = r.adhoc_count || 0;
                return (
                  <tr key={r.agent_id}>
                    <td>{r.agent_title || r.agent_id}</td>
                    <td className="nd-num">{sRuns || '—'}</td>
                    <td className="nd-num">{sCost ? fmtUSD(sCost) : '—'}</td>
                    <td className="nd-num">{sRuns ? fmtUSD(sCost / sRuns) : '—'}</td>
                    <td className="nd-num">{aConvs || '—'}</td>
                    <td className="nd-num">{aCost ? fmtUSD(aCost) : '—'}</td>
                    <td className="nd-num">{aConvs ? fmtUSD(aCost / aConvs) : '—'}</td>
                    <td className="nd-num">{fmtUSD(r.cost)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="nd-row-2">
        <div className="nd-card">
          <div className="nd-card-header">
            <div className="nd-card-title">Bedrock usage-type breakdown</div>
            <div className="nd-card-subtitle">
              Inside the "Amazon Bedrock" CE line · total {fmtUSD(totalCEInWindow)} CE in window
            </div>
          </div>
          {cfg && (cfg.bedrock_account || cfg.allow_bedrock_quota_sharing) && (
            <div className="nd-note" style={{ marginBottom: 14 }}>
              <div className="nd-note-title">⚠ Bedrock quota sharing is enabled</div>
              <div className="nd-note-body">
                Chat token costs route to dedicated Bedrock account <b>{cfg.bedrock_account || '?'}</b>. Most chat spend
                will not appear in the breakdown below — only embeddings + parser models stay in this account. Use the{' '}
                <b>Chat trace cost</b> KPI for accurate chat spend.
              </div>
            </div>
          )}
          {butEntries.length === 0 ? (
            <div className="nd-empty">No Bedrock usage in account</div>
          ) : (
            <table className="nd-table">
              <thead>
                <tr>
                  <th>Usage type</th>
                  <th className="nd-num">$</th>
                </tr>
              </thead>
              <tbody>
                {butEntries.map(([ut, v]) => (
                  <tr key={ut}>
                    <td>{ut}</td>
                    <td className="nd-num">{fmtUSDc(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="nd-card">
          <div className="nd-card-header">
            <div className="nd-card-title">Token mix</div>
            <div className="nd-card-subtitle">Snapshot-window totals · where the tokens go</div>
          </div>
          <div className="nd-chart-wrap" style={{ height: 200 }}>
            <Bar
              data={{
                labels: ['Cache reads', 'Cache creation', 'Input (uncached)', 'Output'],
                datasets: [
                  {
                    data: [tokensRead, tokensCreation, tokensInput, tokensOutput],
                    backgroundColor: [ND_COLORS.good, '#facc15', ND_COLORS.accent, ND_COLORS.accent2],
                    borderWidth: 0,
                  },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: (c) => fmtN(c.parsed.x as number) + ' tokens' } },
                },
                scales: {
                  x: {
                    ticks: {
                      callback: (v) =>
                        (v as number) >= 1e6 ? ((v as number) / 1e6).toFixed(1) + 'M' : (v as number).toLocaleString(),
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      </div>

      {agg && agg.outliers && agg.outliers.length > 0 && (
        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">Outlier stacks</div>
            <div className="nd-card-subtitle">z-score &gt; 2 on CE or chat cost (snapshot window)</div>
          </div>
          <table className="nd-table">
            <thead>
              <tr>
                <th>Stack</th>
                <th>Metric</th>
                <th className="nd-num">Value</th>
                <th className="nd-num">Fleet mean</th>
                <th className="nd-num">Z</th>
              </tr>
            </thead>
            <tbody>
              {agg.outliers.map((o, i) => (
                <tr key={`${o.client}-${i}`}>
                  <td>{o.client}</td>
                  <td>
                    <span className="nd-pill nd-warn-pill">{o.metric}</span>
                  </td>
                  <td className="nd-num">{fmtUSD(o.value)}</td>
                  <td className="nd-num">{fmtUSD(o.mean)}</td>
                  <td className="nd-num">{o.z_score.toFixed(2)}σ</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
