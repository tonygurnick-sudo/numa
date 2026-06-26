import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import '../chartSetup';
import {
  KNOWN_ACCOUNTS,
  PAL,
  buildDayRange,
  buildByClientRowsWindowed,
  ceForSnapshot,
  filterDailyMap,
  fmtN,
  fmtSpan,
  fmtUSD,
  fmtUSDc,
  friendlyAccountName,
  isAggregate,
  pct,
  poolForAggregate,
  siblingStacksFor,
  sumDailyInWindow,
} from '../shared';
import { ND_COLORS, ND_FILL } from '../theme';
import type { WindowState } from '../shared';
import { buildInferredServiceMix, computeInferredCosts } from '../inferredCosts';
import { useCurrency } from '../currencyContext';
import type { ByClientRow, ClientSnapshot, DashboardView } from '@/types/fleetAnalytics';

interface OverviewTabProps {
  data: DashboardView;
  window: WindowState;
  /** Raw per-client snapshots — used for window-aware aggregate views. */
  snapshots: ClientSnapshot[];
}

/**
 * Overview tab. Per-client + aggregate views share most of the layout —
 * KPIs and the daily-cost chart read from daily buckets (sliced by window
 * client-side), the service mix donut reads from `totals_by_service` for
 * aggregates and slices `by_service_daily` for per-client views.
 */
export function OverviewTab({ data, window, snapshots }: OverviewTabProps) {
  // Subscribe to currency changes — fmtUSD reads module state but re-renders
  // only happen when subscribed components see a context value change.
  useCurrency();
  const ceDays = useMemo(() => filterDailyMap(data.cost_explorer?.totals_by_day, window), [data, window]);

  // Window-scoped chat KPIs come from daily buckets — no per-conv iteration
  const chatCost = useMemo(() => sumDailyInWindow(data.chat?.daily_cost, window), [data, window]);
  const chatConvs = useMemo(() => sumDailyInWindow(data.chat?.daily_convs, window), [data, window]);
  const chatTurns = useMemo(() => sumDailyInWindow(data.chat?.daily_turns, window), [data, window]);
  const chatUserMsgs = useMemo(() => sumDailyInWindow(data.chat?.daily_messages, window), [data, window]);
  const chatToolCalls = useMemo(() => sumDailyInWindow(data.chat?.daily_tool_calls, window), [data, window]);
  const schedRuns = useMemo(() => sumDailyInWindow(data.scheduled_runs?.daily_runs, window), [data, window]);
  const schedCost = useMemo(() => sumDailyInWindow(data.scheduled_runs?.daily_cost, window), [data, window]);

  // Quota-sharing-aware inferred view. Swaps Claude CE lines for token-priced
  // chat cost so borrowers see their real spend and lenders aren't charged
  // for borrowers' usage. See inferredCosts.ts for the math.
  const inferred = useMemo(() => computeInferredCosts(data, window), [data, window]);

  // Service mix sliced by window — Claude lines collapsed into one
  // "Numa LLM (inferred)" slice. Falls back to the snapshot-wide totals only
  // when the per-service daily breakdown is missing (very old snapshots).
  const svcMix = useMemo(() => {
    if (data.cost_explorer?.by_service_daily) {
      return buildInferredServiceMix(data, window);
    }
    const out: Record<string, number> = {};
    for (const [svc, v] of Object.entries(data.cost_explorer?.totals_by_service || {})) {
      if (v > 0) out[svc] = v;
    }
    return out;
  }, [data, window]);

  const svcEntries = useMemo(() => Object.entries(svcMix).sort((a, b) => b[1] - a[1]), [svcMix]);

  // Donut data
  const topN = 8;
  const topServices = svcEntries.slice(0, topN);
  const otherSum = svcEntries.slice(topN).reduce((s, [, v]) => s + v, 0);
  const mixLabels = topServices.map((e) => e[0]).concat(otherSum > 0 ? ['Other'] : []);
  const mixValues = topServices.map((e) => e[1]).concat(otherSum > 0 ? [otherSum] : []);

  const days = useMemo(() => buildDayRange(window.startDate, window.endDate), [window]);

  // Window-scoped scheduled vs ad-hoc counts (from daily_scheduled_count /
  // daily_adhoc_count buckets). The snapshot-wide scheduled_vs_adhoc block
  // is whole-snapshot only, so we sum from daily buckets to match the picker.
  const chatScheduledConvs = useMemo(() => sumDailyInWindow(data.chat?.daily_scheduled_count, window), [data, window]);
  const chatAdhocConvs = useMemo(() => sumDailyInWindow(data.chat?.daily_adhoc_count, window), [data, window]);

  // $/user msg — overall + per-category. Per-category uses the per-day
  // per-category buckets so the splits respect the window picker too.
  const costPerMsg = chatUserMsgs ? chatCost / chatUserMsgs : 0;
  const perCategoryUnitCost = useMemo(() => {
    const out: Record<string, { cost: number; msgs: number; convs: number }> = {
      agent_run: { cost: 0, msgs: 0, convs: 0 },
      agent_chat: { cost: 0, msgs: 0, convs: 0 },
      plain_chat: { cost: 0, msgs: 0, convs: 0 },
    };
    const costMap = data.chat?.daily_cost_by_category;
    const msgMap = data.chat?.daily_messages_by_category;
    const convMap = data.chat?.daily_convs_by_category;
    for (const cat of ['agent_run', 'agent_chat', 'plain_chat'] as const) {
      out[cat].cost = sumDailyInWindow(costMap?.[cat], window);
      out[cat].msgs = sumDailyInWindow(msgMap?.[cat], window);
      out[cat].convs = sumDailyInWindow(convMap?.[cat], window);
      if (out[cat].cost === 0) {
        // Fallback for older snapshots without daily-per-category data.
        const snap = data.chat?.by_category?.[cat];
        out[cat].cost = snap?.cost || 0;
        out[cat].msgs = snap?.user_messages || 0;
        out[cat].convs = snap?.convs || 0;
      }
    }
    return out;
  }, [data, window]);

  // Avg conversation length — best proxy we have without per-day per-conv
  // span data. by_user.avg_span_seconds is per-user-conv-mean (snapshot
  // window). Weight by conv count to get a fleet/client average.
  const avgConvSpanSec = useMemo(() => {
    const users = Object.values(data.chat?.by_user || {});
    if (!users.length) return null;
    let sumSpan = 0;
    let sumConvs = 0;
    for (const u of users) {
      if (u?.avg_span_seconds == null || u.convs == null) continue;
      sumSpan += (u.avg_span_seconds || 0) * u.convs;
      sumConvs += u.convs;
    }
    return sumConvs ? sumSpan / sumConvs : null;
  }, [data]);

  // Tokens (window-scoped — sum from chat.totals as fallback; for window-scope
  // we don't have token daily buckets, so just show snapshot-totals)
  const tot = data.chat?.totals || ({} as never);
  const totalInTok = (tot.input_tokens || 0) + (tot.cache_read_tokens || 0) + (tot.cache_creation_tokens || 0);
  const cacheHit = totalInTok ? ((100 * (tot.cache_read_tokens || 0)) / totalInTok).toFixed(1) + '%' : '—';

  const agg = isAggregate(data) ? data : null;
  const perClient = !isAggregate(data) ? data : null;
  const cfg = perClient?.client_config || {};
  const isDev = Boolean(cfg.dev_instance);
  // Non-Numa AWS spend filtered out (standalone customer accounts only).
  // Surfaced as a small "$X filtered" badge next to the Cost composition donut
  // so operators see at a glance how much customer-owned workload was excluded.
  const nonNumaFiltered = data.cost_explorer?.non_numa_filtered_total || 0;

  // Per-stack view only: sibling stacks sharing this AWS account. Drives the
  // "shared account" banner. CE numbers on this page are account-wide when
  // siblings exist — the banner points operators at the account-group view
  // in the sidebar for the correct (deduped) figure.
  const siblings = useMemo(() => (perClient ? siblingStacksFor(perClient, snapshots) : []), [perClient, snapshots]);

  return (
    <>
      {isDev && (
        <div className="nd-note">
          <div className="nd-note-title">⚠ Dev stack — AWS costs are account-wide, not client-isolated</div>
          <div className="nd-note-body">
            This is a dev stack sharing AWS account <b>{cfg.client_account_id}</b> with other dev environments. The Cost
            Explorer numbers reflect every dev stack in that account, not just <b>{data.client}</b>.{' '}
            <b>Chat trace cost</b> (computed from per-conversation trace.jsonl) is the only cost line that's truly
            isolated to this client.
          </div>
        </div>
      )}

      {siblings.length > 0 && (
        <div className="nd-note">
          <div className="nd-note-title">
            ⚠ AWS account shared with {siblings.length} other {siblings.length === 1 ? 'stack' : 'stacks'}
          </div>
          <div className="nd-note-body">
            Every CE figure on this page reflects the entire account (<b>{cfg.client_account_id}</b>) — AgentCore,
            Bedrock model lines, Lambda, etc. are <b>not</b> attributable to <b>{data.client}</b> alone. Other stacks in
            this account:{' '}
            {siblings
              .map<ReactNode>((s) => (
                <code key={s.client} style={{ background: 'rgba(0,0,0,0.05)', padding: '0 4px', borderRadius: 3 }}>
                  {s.client}
                </code>
              ))
              .reduce<ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}
            .
            <br />
            For the correctly-deduped account total, pick the account group in the sidebar (under{' '}
            <b>Dev Accounts (Grouped by Account ID)</b>).
          </div>
        </div>
      )}

      {agg && (
        <div className="nd-note">
          <div className="nd-note-title">
            {agg.stack_count} stacks · {agg.unique_account_count} unique AWS accounts
          </div>
          <div className="nd-note-body">
            Fleet KPIs above use <b>inferred CE</b>: Claude/Bedrock line items are swapped for token-priced chat trace
            cost (correctly attributes quota-shared LLM usage to the borrower stack, not the lender). Cost Explorer
            totals are then <b>deduplicated by AWS account ID</b> so {agg.stack_count - agg.unique_account_count} stacks
            that share accounts (the Q-demo dev herd, the HQ org, etc.) don't double-count their account-wide spend.
            Chat / users / agents / schedules are summed per-stack. The per-stack Inferred CE in the By-client view
            still reflects each snapshot's account-wide spend — don't naively sum it across stacks that share an
            account; use the Dev Account groups in the sidebar for those.
          </div>
        </div>
      )}

      <QuotaSharingNotice inferred={inferred} isAggregate={Boolean(agg)} />

      {/* ─── Section 1 · Spend ─────────────────────────────────────── */}
      <SectionHeader title="Spend" sub="in selected window" />
      <div className="nd-kpi-grid">
        <Kpi
          label="Total spend (inferred)"
          value={fmtUSD(inferred.totals.inferred)}
          sub={
            <>
              Raw CE {fmtUSD(inferred.totals.ceTotal)}
              {inferred.role === 'borrower' && ` · ${fmtUSD(inferred.totals.borrowed)} borrowed from quota pool`}
              {inferred.role === 'lender' && ` · ${fmtUSD(inferred.totals.lent)} lent to borrowers`}
              {inferred.role === 'mixed' &&
                ` · ${fmtUSD(inferred.totals.lent)} lent · ${fmtUSD(inferred.totals.borrowed)} borrowed`}
              {inferred.role === 'standalone' && ' · inferred ≈ raw CE'}
            </>
          }
          variant="highlight"
        />
        <Kpi
          label="Chat/Agent LLM spend"
          value={fmtUSD(chatCost)}
          sub={`${pct(chatCost, inferred.totals.inferred)} of inferred · token-priced`}
          variant="highlight"
        />
        <Kpi
          label="Avg cost per conversation"
          value={chatConvs ? fmtUSD(chatCost / chatConvs) : '—'}
          sub={`overall · ${fmtN(chatConvs)} convs · ${fmtUSDc(costPerMsg)}/msg`}
        />
        <Kpi label="Scheduled runs" value={fmtN(schedRuns)} sub={`${fmtUSD(schedCost)} in window`} />
      </div>

      {/* ─── Section 2 · Unit economics by category ────────────────── */}
      <SectionHeader title="Unit economics by category" sub="cost per message + per conversation, in window" />
      <div className="nd-kpi-grid">
        <Kpi
          label="Numa Chat (plain)"
          value={
            perCategoryUnitCost.plain_chat.msgs
              ? fmtUSDc(perCategoryUnitCost.plain_chat.cost / perCategoryUnitCost.plain_chat.msgs)
              : '—'
          }
          sub={
            perCategoryUnitCost.plain_chat.convs
              ? `per msg · ${fmtUSD(perCategoryUnitCost.plain_chat.cost / perCategoryUnitCost.plain_chat.convs)} per conv`
              : 'per msg · no plain chat in window'
          }
        />
        <Kpi
          label="Agent Chat (ad-hoc)"
          value={
            perCategoryUnitCost.agent_chat.msgs
              ? fmtUSDc(perCategoryUnitCost.agent_chat.cost / perCategoryUnitCost.agent_chat.msgs)
              : '—'
          }
          sub={
            perCategoryUnitCost.agent_chat.convs
              ? `per msg · ${fmtUSD(perCategoryUnitCost.agent_chat.cost / perCategoryUnitCost.agent_chat.convs)} per conv`
              : 'per msg · no agent chat in window'
          }
        />
        <Kpi
          label="Agent Run (sched/trig)"
          value={
            perCategoryUnitCost.agent_run.convs
              ? fmtUSD(perCategoryUnitCost.agent_run.cost / perCategoryUnitCost.agent_run.convs)
              : '—'
          }
          sub={
            perCategoryUnitCost.agent_run.convs
              ? `per run · ${fmtN(perCategoryUnitCost.agent_run.convs)} runs · 1-shot so msg ≡ conv ≡ run`
              : 'per run · no agent runs in window'
          }
        />
        <Kpi
          label="Cost per user message"
          value={costPerMsg ? fmtUSDc(costPerMsg) : '—'}
          sub={`overall · ${fmtN(chatUserMsgs)} msgs in window`}
        />
      </div>

      {/* ─── Section 3 · Volume ────────────────────────────────────── */}
      <SectionHeader title="Volume" sub="in window unless noted" />
      <div className="nd-kpi-grid">
        <Kpi
          label="Conversations"
          value={fmtN(chatConvs)}
          sub={`${fmtN(chatAdhocConvs)} ad-hoc · ${fmtN(chatScheduledConvs)} scheduled · ${fmtN(chatUserMsgs)} msgs`}
        />
        <Kpi
          label="Tool calls"
          value={fmtN(chatToolCalls)}
          sub={`${(chatToolCalls / Math.max(chatConvs, 1)).toFixed(1)} avg / conv`}
        />
        <Kpi
          label="Agentic turns"
          value={fmtN(chatTurns)}
          sub={`${(chatTurns / Math.max(chatConvs, 1)).toFixed(1)} avg / conv`}
        />
        <Kpi
          label="Avg conversation length"
          value={fmtSpan(avgConvSpanSec)}
          sub="first → last request (snapshot window)"
        />
      </div>

      {/* ─── Section 4 · Users & operations ─────────────────────────── */}
      <SectionHeader title="Users & operations" />
      <div className="nd-kpi-grid">
        <Kpi
          label={agg ? 'Provisioned users' : 'Active users'}
          value={fmtN(agg ? data.users?.provisioned_users || 0 : tot.users)}
          sub={
            agg
              ? `${fmtN(data.users?.modified_in_last_30d || 0)} active in last 30d`
              : `${data.users?.provisioned_users ?? 0} provisioned`
          }
        />
        <Kpi label="Cache hit ratio" value={cacheHit} sub="cache reads ÷ all input (snapshot window)" variant="good" />
        <Kpi label="Errors" value={fmtN(tot.errors)} sub={`${pct(tot.errors, tot.requests)} of requests (snapshot)`} />
        {agg ? (
          <Kpi
            label="Time saved"
            value={`${Math.floor((data.impact?.total_time_saved_minutes || 0) / 60)}h`}
            sub={`${fmtN(data.impact?.total_schedule_runs || 0)} runs total`}
            variant="good"
          />
        ) : (
          <Kpi
            label="Active schedules"
            value={fmtN(data.schedules?.by_derived_status?.active || 0)}
            sub={`${fmtN(data.schedules?.count || 0)} total`}
          />
        )}
      </div>

      <div className="nd-row-3">
        <div className="nd-card">
          <div className="nd-card-header">
            <div>
              <div className="nd-card-title">Daily cost trend{agg ? ' (all stacks)' : ''}</div>
              <div className="nd-card-subtitle">
                Inferred total (bold) vs raw AWS CE (light) — gap = quota-shared LLM cost · same y-axis
              </div>
            </div>
          </div>
          <div className="nd-chart-wrap nd-chart-large">
            <Line
              data={{
                labels: days,
                datasets: [
                  {
                    label: 'AWS CE total (raw)',
                    data: days.map((d) => ceDays[d] || 0),
                    borderColor: ND_COLORS.accent,
                    backgroundColor: ND_FILL.accent,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 2,
                  },
                  {
                    label: 'Inferred total',
                    data: days.map((d) => inferred.inferredTotalDaily[d] || 0),
                    borderColor: ND_COLORS.accent2,
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    borderWidth: 2.5,
                    pointRadius: 2,
                  },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'top', align: 'end' },
                  tooltip: { mode: 'index', intersect: false },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                  y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } },
                },
              }}
            />
          </div>
        </div>

        <div className="nd-card">
          <div className="nd-card-header">
            <div className="nd-card-title">Cost composition</div>
            <div className="nd-card-subtitle">
              Numa-attributable AWS services (inferred){agg ? ' across all stacks' : ''}
              {nonNumaFiltered > 0 && (
                <>
                  {' · '}
                  <span title="Non-Numa AWS spend in standalone customer accounts (RDS, OpenSearch, QuickSight, etc.) that are filtered out of this view. Total is for the snapshot window (90d).">
                    {fmtUSD(nonNumaFiltered)} non-Numa filtered
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="nd-chart-wrap nd-chart-large">
            <Doughnut
              data={{
                labels: mixLabels,
                datasets: [{ data: mixValues, backgroundColor: PAL, borderWidth: 2, borderColor: ND_COLORS.panel }],
              }}
              options={{
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                  legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
                  tooltip: {
                    callbacks: {
                      label: (c) =>
                        `${c.label}: ${fmtUSD(c.parsed as number)} (${pct(c.parsed as number, inferred.totals.inferred)})`,
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      </div>

      {agg ? (
        <ByClientTable agg={agg} snapshots={snapshots} window={window} />
      ) : (
        <ServiceDetailTable entries={svcEntries} total={inferred.totals.inferred} />
      )}
    </>
  );
}

interface QuotaSharingNoticeProps {
  inferred: ReturnType<typeof computeInferredCosts>;
  isAggregate: boolean;
}

/**
 * Surface the quota-sharing context above the SPEND row so users know why
 * the inferred total differs from raw CE. Suppressed for standalone clients
 * where the gap is just noise / billing lag.
 */
function QuotaSharingNotice({ inferred, isAggregate }: QuotaSharingNoticeProps) {
  if (inferred.role === 'standalone') return null;
  const { lent, borrowed } = inferred.totals;
  let title = '';
  let body: ReactNode = null;
  if (isAggregate) {
    title = `Fleet-wide quota sharing — ${fmtUSD(lent)} lent · ${fmtUSD(borrowed)} borrowed in window`;
    body = (
      <>
        Aggregated across all included stacks. Net lent (Arcanum subsidy paid by HQ + pool accounts){' '}
        <b>{fmtUSD(Math.max(0, lent - borrowed))}</b>. Per-client roles vary — drill in to individual stacks for
        attribution.
      </>
    );
  } else if (inferred.role === 'borrower') {
    title = `🔄 Quota-sharing borrower — ${fmtUSD(borrowed)} of LLM cost shifted off this account`;
    body = (
      <>
        AWS Cost Explorer under-reports this client's spend because Claude usage is billed to a quota-sharing pool.
        Inferred total fills in the gap from token-priced chat cost.
      </>
    );
  } else if (inferred.role === 'lender') {
    title = `🔄 Quota-sharing lender — ${fmtUSD(lent)} paid for borrowers' Claude usage`;
    body = (
      <>
        AWS Cost Explorer over-reports this client because it absorbs other accounts' Claude bills. Inferred total
        subtracts the absorbed amount so this number reflects what the client alone consumed.
      </>
    );
  } else {
    title = `🔄 Quota sharing changed during window — ${fmtUSD(lent)} lent · ${fmtUSD(borrowed)} borrowed`;
    body = (
      <>
        Both signals are large in this window, suggesting quota-sharing was toggled on or off. Per-day reconciliation
        handles each day independently.
      </>
    );
  }
  return (
    <div className="nd-note">
      <div className="nd-note-title">{title}</div>
      <div className="nd-note-body">{body}</div>
    </div>
  );
}

function ServiceDetailTable({ entries, total }: { entries: [string, number][]; total: number }) {
  return (
    <div className="nd-row-1">
      <div className="nd-card">
        <div className="nd-card-header">
          <div className="nd-card-title">Cost composition — detail</div>
          <div className="nd-card-subtitle">
            All services in window · Claude lines collapsed into Numa LLM (inferred)
          </div>
        </div>
        <table className="nd-table">
          <thead>
            <tr>
              <th>Service</th>
              <th className="nd-num">Total ($)</th>
              <th className="nd-num">Share</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([svc, v]) => (
              <tr key={svc}>
                <td>{svc}</td>
                <td className="nd-num">{fmtUSD(v)}</td>
                <td className="nd-num">{pct(v, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type SortKey =
  | 'client'
  | 'ce_total'
  | 'chat_cost'
  | 'convs'
  | 'active_users'
  | 'schedules'
  | 'agents'
  | 'time_saved_minutes';

interface ExtendedRow extends ByClientRow {
  inferred_ce: number;
  /** Set on synthetic rows that collapse 2+ stacks sharing one AWS account. */
  group_member_names?: string[];
}

type ByClientSubTab = 'table' | 'chart';

function ByClientTable({
  agg,
  snapshots,
  window,
}: {
  agg: Extract<DashboardView, { is_aggregate: true }>;
  snapshots: ClientSnapshot[];
  window: WindowState;
}) {
  useCurrency();

  const [activeSub, setActiveSub] = useState<ByClientSubTab>('table');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'ce_total',
    dir: 'desc',
  });

  // Re-derive rows from the raw snapshots so columns track the current window.
  // Pool selection mirrors aggregateSnapshots() in NumaDashboard.tsx so KPIs
  // above and rows below match.
  //
  // Then post-process: stacks sharing one AWS account are collapsed into a
  // single synthetic row (e.g. all 7 Q-demo dev stacks → one "Q-demo" row).
  // CE is the deduped account total (it's the same across all stacks in a
  // shared account); chat trace cost / convs / users / schedules / agents /
  // time_saved are summed across the group's stacks. Inferred CE for the
  // group is recomputed as (account_ce − account_claude_ce + summed_chat).
  const rows: ExtendedRow[] = useMemo(() => {
    const pool = poolForAggregate(snapshots, agg.aggregate_kind);
    const base = buildByClientRowsWindowed(pool, window);
    const byName: Record<string, ClientSnapshot> = {};
    for (const s of pool) byName[s.client] = s;
    const enriched: ExtendedRow[] = base.map((r) => {
      const snap = byName[r.client];
      if (!snap) return { ...r, inferred_ce: r.ce_total };
      const { ce: filteredCe } = ceForSnapshot(snap);
      const filteredSnap: ClientSnapshot = { ...snap, cost_explorer: filteredCe };
      const inferred = computeInferredCosts(filteredSnap, window).totals.inferred;
      return { ...r, inferred_ce: inferred, ce_total: inferred };
    });

    // Identify accounts with 2+ stacks in this pool — collapse them.
    const byAccount: Record<string, ExtendedRow[]> = {};
    for (const r of enriched) {
      if (r.client_account_id) (byAccount[r.client_account_id] ||= []).push(r);
    }

    const out: ExtendedRow[] = [];
    const consumed = new Set<string>();
    for (const r of enriched) {
      const acct = r.client_account_id;
      if (!acct) {
        out.push(r);
        continue;
      }
      if (consumed.has(acct)) continue;
      const group = byAccount[acct];
      // Only collapse the three known-shared dev accounts (Q-demo, HQ + Trial,
      // Quota sharing). Other accounts with 2+ stacks are config errors
      // (NextGen one-stack-per-account invariant violations) — leave them as
      // individual rows so the issue is visible rather than papered over.
      if (group.length < 2 || !KNOWN_ACCOUNTS[acct]) {
        out.push(r);
        consumed.add(acct);
        continue;
      }
      consumed.add(acct);
      // Build the synthetic row. Account CE is the same across stacks in a
      // shared account; per-stack inferred = account_ce - account_claude_ce +
      // per_stack_chat, so (inferred - chat) is constant across the group.
      // We pull the constant from any stack and re-add the SUMMED chat for the
      // group → correct account-level inferred CE.
      const ref = group[0];
      const constantBase = ref.inferred_ce - ref.chat_cost;
      const groupChat = group.reduce((s, g) => s + (g.chat_cost || 0), 0);
      const groupInferred = constantBase + groupChat;
      out.push({
        ...ref,
        client: friendlyAccountName(acct),
        dev_instance: group.every((g) => g.dev_instance),
        chat_cost: groupChat,
        convs: group.reduce((s, g) => s + (g.convs || 0), 0),
        active_users: group.reduce((s, g) => s + (g.active_users || 0), 0),
        provisioned_users: group.reduce((s, g) => s + (g.provisioned_users || 0), 0),
        schedules: group.reduce((s, g) => s + (g.schedules || 0), 0),
        active_schedules: group.reduce((s, g) => s + (g.active_schedules || 0), 0),
        scheduled_runs: group.reduce((s, g) => s + (g.scheduled_runs || 0), 0),
        agents: group.reduce((s, g) => s + (g.agents || 0), 0),
        kbs: group.reduce((s, g) => s + (g.kbs || 0), 0),
        integrations: group.reduce((s, g) => s + (g.integrations || 0), 0),
        time_saved_minutes: group.reduce((s, g) => s + (g.time_saved_minutes || 0), 0),
        inferred_ce: groupInferred,
        ce_total: groupInferred,
        group_member_names: group.map((g) => g.client).sort(),
      });
    }
    return out;
  }, [agg.aggregate_kind, snapshots, window]);

  const sortedRows = useMemo(() => {
    const get = (r: ExtendedRow, k: SortKey): number | string => {
      if (k === 'client') return r.client;
      return (r[k] as number) || 0;
    };
    return [...rows].sort((a, b) => {
      const av = get(a, sort.key);
      const bv = get(b, sort.key);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = (av as number) || 0;
      const bn = (bv as number) || 0;
      return sort.dir === 'desc' ? bn - an : an - bn;
    });
  }, [rows, sort]);

  const setSortKey = (k: SortKey) => {
    setSort((prev) => ({
      key: k,
      dir: prev.key === k && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const SortHeader = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => {
    const active = sort.key === k;
    return (
      <th
        className={num ? 'nd-num' : ''}
        onClick={() => setSortKey(k)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        title="Click to sort"
      >
        {label}
        {active ? <span style={{ marginLeft: 4, opacity: 0.6 }}>{sort.dir === 'desc' ? '▼' : '▲'}</span> : ''}
      </th>
    );
  };

  // Count of shared-account groups in the current view — drives the note.
  const groupedCount = sortedRows.filter((r) => r.group_member_names).length;
  const groupedStacks = sortedRows
    .filter((r) => r.group_member_names)
    .reduce((s, r) => s + (r.group_member_names?.length || 0), 0);

  return (
    <div className="nd-row-1">
      <div className="nd-card">
        <div className="nd-card-header">
          <div className="nd-card-title">By client</div>
          <div className="nd-card-subtitle">Per-stack breakdown in window — Inferred CE is quota-aware</div>
        </div>

        {groupedCount > 0 && (
          <div
            className="nd-note"
            style={{ marginTop: 8, marginBottom: 4, fontSize: '0.8rem' }}
            title={`${groupedStacks} dev stacks rolled up into ${groupedCount} account rows`}
          >
            <b>Note:</b> {groupedCount} AWS {groupedCount === 1 ? 'account hosts' : 'accounts host'} multiple dev stacks
            (Q-demo, HQ + Trial, Quota sharing). Their {groupedStacks} stacks are collapsed into single rows because the
            AWS Cost Explorer bill is per-account — each stack would otherwise repeat the same figure. Chat trace cost,
            conversations, and per-stack columns are summed across the grouped stacks. Drill into individual stacks via
            the sidebar.
          </div>
        )}

        <div className="nd-tabs" style={{ marginTop: 4, marginBottom: 8 }}>
          <button
            type="button"
            className={`nd-tab ${activeSub === 'table' ? 'nd-active' : ''}`}
            onClick={() => setActiveSub('table')}
          >
            Table
          </button>
          <button
            type="button"
            className={`nd-tab ${activeSub === 'chart' ? 'nd-active' : ''}`}
            onClick={() => setActiveSub('chart')}
          >
            Chart
          </button>
        </div>

        {activeSub === 'table' ? (
          <table className="nd-table">
            <thead>
              <tr>
                <SortHeader k="client" label="Client" />
                <th></th>
                <SortHeader k="ce_total" label="Inferred CE" num />
                <SortHeader k="chat_cost" label="Chat cost" num />
                <SortHeader k="convs" label="Convs" num />
                <SortHeader k="active_users" label="Users" num />
                <SortHeader k="schedules" label="Schedules" num />
                <SortHeader k="agents" label="Agents" num />
                <SortHeader k="time_saved_minutes" label="Time saved" num />
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="nd-empty">
                    No client snapshots yet
                  </td>
                </tr>
              ) : (
                sortedRows.map((r) => {
                  const ts = r.time_saved_minutes || 0;
                  const isGroup = !!r.group_member_names;
                  return (
                    <tr key={r.client}>
                      <td>
                        {r.client}
                        {isGroup && (
                          <span
                            className="text-muted"
                            style={{ fontSize: '0.72rem', marginLeft: 6 }}
                            title={`Stacks in this account: ${r.group_member_names!.join(', ')}`}
                          >
                            ({r.group_member_names!.length} stacks)
                          </span>
                        )}
                      </td>
                      <td>
                        {isGroup ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <span
                              className="nd-pill"
                              style={{
                                fontSize: 10,
                                background: 'rgba(31,75,94,0.10)',
                                color: '#1F4B5E',
                                border: '1px solid rgba(31,75,94,0.20)',
                                fontFamily: 'monospace',
                              }}
                              title={`AWS account ${r.client_account_id}`}
                            >
                              …{r.client_account_id?.slice(-4)}
                            </span>
                          </span>
                        ) : (
                          r.dev_instance && (
                            <span className="nd-pill nd-warn-pill" style={{ fontSize: 10 }}>
                              DEV
                            </span>
                          )
                        )}
                      </td>
                      <td className="nd-num">{fmtUSD(r.inferred_ce)}</td>
                      <td className="nd-num">{fmtUSD(r.chat_cost)}</td>
                      <td className="nd-num">{r.convs}</td>
                      <td className="nd-num">{r.active_users}</td>
                      <td className="nd-num">{r.schedules}</td>
                      <td className="nd-num">{r.agents}</td>
                      <td className="nd-num">{ts ? `${Math.floor(ts / 60)}h` : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          <ByClientCostBarChart rows={rows} />
        )}
      </div>
    </div>
  );
}

// Horizontal bar chart of inferred cost per stack, descending. Renders every
// stack — the chart height scales with the number of clients so the user can
// see the full distribution.
function ByClientCostBarChart({ rows }: { rows: ExtendedRow[] }) {
  useCurrency();
  const sorted = useMemo(() => [...rows].sort((a, b) => b.inferred_ce - a.inferred_ce), [rows]);
  // Group-row labels carry "(N stacks)" inline so the chart reads honestly
  // without a separate legend lookup.
  const labels = sorted.map((r) =>
    r.group_member_names ? `${r.client} (${r.group_member_names.length} stacks)` : r.client
  );
  const values = sorted.map((r) => r.inferred_ce);
  // Three colours: grouped dev account, dev stack (rare, only when not grouped),
  // and regular client. Lets the eye instantly separate them.
  const colors = sorted.map((r) =>
    r.group_member_names ? '#1F4B5E' : r.dev_instance ? ND_COLORS.textDim : ND_COLORS.accent
  );

  return (
    <div className="nd-chart-wrap" style={{ height: Math.max(360, sorted.length * 22 + 60) }}>
      <Bar
        data={{
          labels,
          datasets: [
            {
              label: 'Inferred CE',
              data: values,
              backgroundColor: colors,
              borderWidth: 0,
            },
          ],
        }}
        options={{
          indexAxis: 'y',
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c) => {
                  const r = sorted[c.dataIndex];
                  if (r?.group_member_names) {
                    return [`${fmtUSD(c.parsed.x as number)}`, `Stacks: ${r.group_member_names.join(', ')}`];
                  }
                  return `${fmtUSD(c.parsed.x as number)}`;
                },
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { callback: (v) => fmtUSD(v as number) },
            },
            y: { ticks: { autoSkip: false, font: { size: 11 } } },
          },
        }}
      />
    </div>
  );
}

interface KpiProps {
  label: string;
  value: string | number;
  sub?: ReactNode;
  variant?: 'highlight' | 'warn' | 'good' | 'info';
}

function Kpi({ label, value, sub, variant }: KpiProps) {
  const cls = `nd-kpi${variant ? ` nd-kpi-${variant}` : ''}`;
  return (
    <div className={cls}>
      <div className="nd-kpi-label">{label}</div>
      <div className="nd-kpi-value">{value}</div>
      {sub && <div className="nd-kpi-sub">{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="nd-section-header">
      <span className="nd-section-title">{title}</span>
      {sub && <span className="nd-section-sub">{sub}</span>}
    </div>
  );
}
