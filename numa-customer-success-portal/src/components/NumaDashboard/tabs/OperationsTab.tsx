import { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import '../chartSetup';
import { buildDayRange, fmtN, isAggregate, sumDailyInWindow } from '../shared';
import { ND_COLORS } from '../theme';
import type { WindowState } from '../shared';
import type { DashboardView } from '@/types/fleetAnalytics';

interface Props {
  data: DashboardView;
  window: WindowState;
}

type SubTab = 'schedules' | 'agents' | 'kbs' | 'integrations';

export function OperationsTab({ data, window }: Props) {
  const [sub, setSub] = useState<SubTab>('schedules');

  const subtabs: Array<{ key: SubTab; label: string }> = [
    { key: 'schedules', label: 'Schedules' },
    { key: 'agents', label: 'Agents' },
    { key: 'kbs', label: 'Knowledge Bases' },
    { key: 'integrations', label: 'Integrations' },
  ];

  return (
    <>
      <div className="nd-subtabs">
        {subtabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`nd-subtab ${sub === t.key ? 'nd-active' : ''}`}
            onClick={() => setSub(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'schedules' && <SchedulesSub data={data} window={window} />}
      {sub === 'agents' && <AgentsSub data={data} />}
      {sub === 'kbs' && <KBsSub data={data} />}
      {sub === 'integrations' && <IntegrationsSub data={data} />}
    </>
  );
}

// ─── SCHEDULES ───────────────────────────────────────────────────────────

function SchedulesSub({ data, window }: { data: DashboardView; window: WindowState }) {
  const [hideDeleted, setHideDeleted] = useState(true);
  const sched = data.schedules;
  const derived = sched?.by_derived_status || sched?.by_status || {};

  const days = useMemo(() => buildDayRange(window.startDate, window.endDate), [window]);
  const dailyRuns = data.scheduled_runs?.daily_runs || {};
  const runsInWin = sumDailyInWindow(dailyRuns, window);

  const totalAllRuns = data.scheduled_runs?.totals?.count || 0;
  const totalFailed = (data.scheduled_runs?.by_status || {}).failed || 0;
  const failRate = totalAllRuns ? totalFailed / totalAllRuns : 0;

  let rows = (sched?.rows || []).slice();
  if (hideDeleted) rows = rows.filter((r) => (r.derived_status || r.status) !== 'deleted');
  const order: Record<string, number> = { active: 0, scheduled: 1, completed: 2, paused: 3, deleted: 4 };
  rows.sort((a, b) => {
    const sa = a.derived_status || a.status;
    const sb = b.derived_status || b.status;
    if ((order[sa] ?? 9) !== (order[sb] ?? 9)) return (order[sa] ?? 9) - (order[sb] ?? 9);
    return (b.total_runs || 0) - (a.total_runs || 0);
  });

  // For aggregate views, the per-schedule table is mixed across stacks but
  // mostly useful as fleet-wide counts. Keep the same table — schedule_id is
  // still unique enough that nothing collides.
  return (
    <>
      <div className="nd-kpi-grid">
        <Kpi
          label="Schedules total"
          value={fmtN(sched?.count)}
          sub={`${derived.active || 0} active · ${derived.completed || 0} completed · ${derived.scheduled || 0} upcoming · ${derived.deleted || 0} deleted`}
        />
        <Kpi label="With errors" value={fmtN(sched?.schedules_with_errors)} sub="last_error present" variant="warn" />
        <Kpi
          label="Projected runs / month"
          value={fmtN(sched?.projected_runs_per_month_total)}
          sub="sum across active schedules"
          variant="info"
        />
        <Kpi
          label="Runs in window"
          value={fmtN(runsInWin)}
          sub={`${(100 * failRate).toFixed(1)}% failure rate (snapshot total)`}
        />
      </div>

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div>
            <div className="nd-card-title">Scheduled runs over time</div>
            <div className="nd-card-subtitle">
              All runs per day{' '}
              <span style={{ color: 'var(--nd-text-faint)' }}>· {totalFailed} failed total in snapshot</span>
            </div>
          </div>
        </div>
        <div className="nd-chart-wrap">
          <Bar
            data={{
              labels: days,
              datasets: [
                {
                  label: 'scheduled runs',
                  data: days.map((d) => dailyRuns[d] || 0),
                  backgroundColor: ND_COLORS.accent2,
                  borderRadius: 4,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { precision: 0 } },
              },
            }}
          />
        </div>
      </div>

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div>
            <div className="nd-card-title">Schedules</div>
            <div className="nd-card-subtitle">
              {isAggregate(data) ? `${rows.length} schedules across the fleet` : 'All schedules across the client'}
            </div>
          </div>
          <label className="nd-filter-pill">
            <input type="checkbox" checked={hideDeleted} onChange={(e) => setHideDeleted(e.target.checked)} />
            Hide deleted
          </label>
        </div>
        <table className="nd-table">
          <thead>
            <tr>
              <th>Agent / Label</th>
              <th>Status</th>
              <th>Cadence</th>
              <th className="nd-num">Runs</th>
              <th className="nd-num">Proj./mo</th>
              <th>Last run</th>
              <th>Last status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="nd-empty">
                  No schedules
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const ds = s.derived_status || s.status;
              const statusCls =
                ds === 'active'
                  ? 'nd-active-pill'
                  : ds === 'deleted'
                    ? 'nd-deleted-pill'
                    : ds === 'completed'
                      ? 'nd-info-pill'
                      : ds === 'scheduled'
                        ? 'nd-accent-pill'
                        : '';
              // last_run_epoch is written by the schedule runner as Date.now() (ms).
              // Auto-detect just in case anything historic was stored in seconds:
              // values < 1e12 are too small to be valid ms after 2001, so assume seconds.
              const lastRun = s.last_run_epoch
                ? new Date(s.last_run_epoch < 1e12 ? s.last_run_epoch * 1000 : s.last_run_epoch).toLocaleString()
                : '—';
              const isRecurring = s.cron_kind === 'recurring';
              // privacy: don't show s.label (free-text schedule label) — use agent_title or schedule_id
              return (
                <tr key={s.schedule_id}>
                  <td>
                    {s.agent_title || '?'}
                    <div className="nd-sub">{(s.schedule_id || '').slice(0, 30)}</div>
                  </td>
                  <td>
                    <span className={`nd-pill ${statusCls}`}>{ds}</span>
                  </td>
                  <td>
                    {isRecurring ? (
                      <>
                        <span className="nd-pill">recurring</span>
                        {s.cron_expression && <div className="nd-sub">{s.cron_expression}</div>}
                      </>
                    ) : (
                      <>
                        <span className="nd-pill nd-accent-pill">one-off</span>
                        {s.cron_expression && <div className="nd-sub">{s.cron_expression}</div>}
                      </>
                    )}
                  </td>
                  <td className="nd-num">{s.total_runs}</td>
                  <td className="nd-num">{s.projected_runs_per_month || '—'}</td>
                  <td>{lastRun}</td>
                  <td>
                    {s.last_error_present ? (
                      <span className="nd-pill nd-warn-pill">{s.last_status || 'error'}</span>
                    ) : s.last_status ? (
                      <span className="nd-pill nd-info-pill">{s.last_status}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── AGENTS ──────────────────────────────────────────────────────────────

function AgentsSub({ data }: { data: DashboardView }) {
  const agg = isAggregate(data) ? data : null;

  // Per-agent runs from chat.by_agent (works for both views)
  const byAgent = data.chat?.by_agent || [];
  const totalRuns = byAgent.reduce((s, a) => s + a.scheduled_count + a.adhoc_count, 0);
  const adhocRuns = byAgent.reduce((s, a) => s + a.adhoc_count, 0);
  const schedRuns = byAgent.reduce((s, a) => s + a.scheduled_count, 0);

  const workspaceCount = data.agents?.agents?.count || 0;
  const personalCount = data.agents?.user_agents?.count || 0;

  // Agent rows from data.agents (workspace + personal). For aggregate views,
  // we only have a count, not the rows.
  const agentRows = useMemo(
    () => [
      ...(data.agents?.agents?.rows || []).map((a) => ({ ...a, kind: 'workspace' as const })),
      ...(data.agents?.user_agents?.rows || []).map((a) => ({ ...a, kind: 'personal' as const })),
    ],
    [data]
  );

  // Lookup table for "runs per agent" using chat.by_agent
  const runsByAgentId = useMemo(() => {
    const out: Record<string, { adhoc: number; scheduled: number; total: number }> = {};
    for (const r of byAgent) {
      out[r.agent_id] = {
        adhoc: r.adhoc_count,
        scheduled: r.scheduled_count,
        total: r.scheduled_count + r.adhoc_count,
      };
    }
    return out;
  }, [byAgent]);

  return (
    <>
      <div className="nd-kpi-grid">
        <Kpi label="Agents (workspace)" value={fmtN(workspaceCount)} sub="" />
        <Kpi label="Agents (personal)" value={fmtN(personalCount)} sub="" />
        <Kpi
          label="Total agent runs"
          value={fmtN(totalRuns)}
          sub={`${adhocRuns} ad-hoc · ${schedRuns} scheduled · snapshot window`}
          variant="info"
        />
        <Kpi
          label="Active schedules"
          value={fmtN(data.schedules?.by_derived_status?.active || 0)}
          sub={`${fmtN(data.schedules?.count || 0)} total`}
        />
      </div>

      {agg ? (
        <div className="nd-empty">Open a specific stack to see its per-agent details.</div>
      ) : (
        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">Agents</div>
            <div className="nd-card-subtitle">Workspace + personal · runs counted from per-agent activity</div>
          </div>
          <table className="nd-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Type</th>
                <th className="nd-num">Time saved / run</th>
                <th className="nd-num">Ad-hoc runs</th>
                <th className="nd-num">Scheduled runs</th>
                <th className="nd-num">Total runs</th>
              </tr>
            </thead>
            <tbody>
              {agentRows.map((a) => {
                const b = runsByAgentId[a.agent_id || ''] || { adhoc: 0, scheduled: 0, total: 0 };
                return (
                  <tr key={a.agent_id}>
                    <td>{a.title || '?'}</td>
                    <td>
                      <span className="nd-pill">{a.kind}</span>
                    </td>
                    <td className="nd-num">
                      {a.estimated_time_saved_minutes ? (
                        `${a.estimated_time_saved_minutes} min`
                      ) : (
                        <span className="nd-pill nd-warn-pill" style={{ fontSize: 10 }}>
                          not set · default 10m
                        </span>
                      )}
                    </td>
                    <td className="nd-num">{b.adhoc || '—'}</td>
                    <td className="nd-num">{b.scheduled || '—'}</td>
                    <td className="nd-num">{b.total || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── KBs ─────────────────────────────────────────────────────────────────

function KBsSub({ data }: { data: DashboardView }) {
  const agg = isAggregate(data) ? data : null;
  if (agg) {
    return (
      <>
        <div className="nd-kpi-grid">
          <Kpi
            label="Knowledge bases (fleet)"
            value={fmtN(data.integrations?.knowledge_bases?.count)}
            sub="across all stacks"
          />
          <Kpi label="" value="" sub="" />
          <Kpi label="" value="" sub="" />
          <Kpi label="" value="" sub="" />
        </div>
        <div className="nd-empty">Open a specific stack to see its KBs.</div>
      </>
    );
  }
  const kbRows = data.integrations?.knowledge_bases?.rows || [];
  return (
    <>
      <div className="nd-kpi-grid">
        <Kpi label="Knowledge bases" value={fmtN(data.integrations?.knowledge_bases?.count)} sub="" />
        <Kpi label="Data connectors" value={fmtN(data.integrations?.data_connectors?.count)} sub="" />
        <Kpi
          label="Cognito users"
          value={fmtN(data.users?.provisioned_users)}
          sub={data.users?.user_pool_id ? `pool: ${(data.users.user_pool_id || '').slice(-10)}` : ''}
        />
        <Kpi label="Active in 30d (Cognito)" value={fmtN(data.users?.modified_in_last_30d)} sub="" variant="info" />
      </div>
      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">Knowledge bases</div>
          <div className="nd-card-subtitle">Configured KBs in this client</div>
        </div>
        <table className="nd-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
            </tr>
          </thead>
          <tbody>
            {kbRows.length === 0 && (
              <tr>
                <td colSpan={2} className="nd-empty">
                  No KBs
                </td>
              </tr>
            )}
            {kbRows.map((k) => (
              <tr key={k.kb_id || k.name}>
                <td>{k.name || '?'}</td>
                <td>
                  <span className="nd-pill">{k.kind || 'unknown'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── INTEGRATIONS ────────────────────────────────────────────────────────

function IntegrationsSub({ data }: { data: DashboardView }) {
  // Aggregate view now merges per-stack by_app_active across all stacks
  // (see aggregateSnapshots in shared.ts). user_subs are stack-scoped so
  // summing user_count across stacks gives the true fleet-wide
  // user-app-link total.
  const agg = isAggregate(data) ? data : null;
  const pd = data.pipedream;
  const apps = pd?.by_app_active || [];
  const subToEmail = !agg ? data.users?.sub_to_email : undefined;

  if (agg) {
    return (
      <>
        <div className="nd-kpi-grid">
          <Kpi
            label="Distinct apps (fleet)"
            value={fmtN(pd?.distinct_active_apps || 0)}
            sub="apps with ≥ 1 connection on any stack"
          />
          <Kpi
            label="User × integration links"
            value={fmtN(pd?.active_connections || 0)}
            sub={`across ${fmtN(agg.stack_count)} stacks`}
          />
          <Kpi
            label="Users with integrations"
            value={fmtN(pd?.users_with_data || 0)}
            sub={`${fmtN(pd?.users_queried || 0)} queried${pd?.users_with_errors ? ` · ${fmtN(pd.users_with_errors)} errors` : ''}`}
          />
          <Kpi label="Native data connectors" value="Coming soon" sub="SharePoint / Drive / etc" />
        </div>

        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">Pipedream integrations by user count (fleet)</div>
            <div className="nd-card-subtitle">
              Distinct user × integration links across all stacks · stack column shows how many stacks have each app
            </div>
          </div>
          {apps.length === 0 ? (
            <div className="nd-empty">No Pipedream integrations connected across the fleet</div>
          ) : (
            <div className="nd-chart-wrap" style={{ height: Math.max(220, apps.length * 22 + 40) }}>
              <Bar
                data={{
                  labels: apps.map((a) => a.app_name),
                  datasets: [
                    {
                      data: apps.map((a) => a.user_count),
                      backgroundColor: ND_COLORS.accent,
                      borderRadius: 4,
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
                        label: (c) =>
                          `${c.label}: ${c.parsed.x} user${c.parsed.x === 1 ? '' : 's'} · ${apps[c.dataIndex].stack_count ?? 0} stacks`,
                      },
                    },
                  },
                  scales: { x: { grid: { display: false }, ticks: { precision: 0 } } },
                }}
              />
            </div>
          )}
        </div>

        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">Pipedream integrations — fleet detail</div>
            <div className="nd-card-subtitle">Per-integration · users + stacks across the fleet</div>
          </div>
          {apps.length === 0 ? (
            <div className="nd-empty">No Pipedream integrations connected across the fleet</div>
          ) : (
            <table className="nd-table">
              <thead>
                <tr>
                  <th>Integration</th>
                  <th className="nd-num">Users connected</th>
                  <th className="nd-num">Stacks with app</th>
                  <th className="nd-num">Users / stack avg</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.app_name}>
                    <td>{a.app_name}</td>
                    <td className="nd-num">{fmtN(a.user_count)}</td>
                    <td className="nd-num">{fmtN(a.stack_count ?? 0)}</td>
                    <td className="nd-num">{a.stack_count ? (a.user_count / a.stack_count).toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="nd-kpi-grid">
        <Kpi
          label="Integrations active (Pipedream)"
          value={fmtN(apps.length)}
          sub="distinct apps with ≥ 1 connection"
        />
        <Kpi
          label="User × integration links"
          value={fmtN(apps.reduce((s, a) => s + a.user_count, 0))}
          sub="total connected_apps across users"
        />
        <Kpi
          label="Users queried"
          value={fmtN(pd?.users_with_data)}
          sub={`${pd?.users_queried || 0} queried${pd?.users_with_errors ? ` · ${pd?.users_with_errors} errors` : ''}`}
        />
        <Kpi label="Native data connectors" value="Coming soon" sub="SharePoint / Synergy / Drive (TBD)" />
      </div>
      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">Pipedream integrations by user count</div>
          <div className="nd-card-subtitle">Apps currently connected for ≥ 1 user (live from pipedream-relay)</div>
        </div>
        {apps.length === 0 ? (
          <div className="nd-empty">No Pipedream integrations connected</div>
        ) : (
          <div className="nd-chart-wrap" style={{ height: Math.max(200, apps.length * 22 + 40) }}>
            <Bar
              data={{
                labels: apps.map((a) => a.app_name),
                datasets: [{ data: apps.map((a) => a.user_count), backgroundColor: ND_COLORS.accent, borderRadius: 4 }],
              }}
              options={{
                indexAxis: 'y',
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: { label: (c) => `${c.label}: ${c.parsed.x} user${c.parsed.x === 1 ? '' : 's'}` },
                  },
                },
                scales: { x: { grid: { display: false }, ticks: { precision: 0 } } },
              }}
            />
          </div>
        )}
      </div>
      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">Pipedream integrations — detail</div>
          <div className="nd-card-subtitle">Per-integration breakdown</div>
        </div>
        <table className="nd-table">
          <thead>
            <tr>
              <th>Integration</th>
              <th className="nd-num">Users connected</th>
              <th>Connected users</th>
            </tr>
          </thead>
          <tbody>
            {apps.length === 0 && (
              <tr>
                <td colSpan={3} className="nd-empty">
                  No active Pipedream connections
                </td>
              </tr>
            )}
            {apps.map((a) => (
              <tr key={a.app_name}>
                <td>
                  {a.app_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  <div className="nd-sub">{a.app_name}</div>
                </td>
                <td className="nd-num">{a.user_count}</td>
                <td>
                  {(a.user_subs || [])
                    .map((s) => {
                      const email = subToEmail?.[s];
                      return email || `${s.slice(0, 8)}…`;
                    })
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── reusable KPI ────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: string | number;
  sub?: string;
  variant?: 'highlight' | 'warn' | 'good' | 'info';
}

function Kpi({ label, value, sub, variant }: KpiProps) {
  if (!label && !String(value)) return <div />;
  const cls = `nd-kpi${variant ? ` nd-kpi-${variant}` : ''}`;
  return (
    <div className={cls}>
      <div className="nd-kpi-label">{label}</div>
      <div className="nd-kpi-value">{value}</div>
      {sub && <div className="nd-kpi-sub">{sub}</div>}
    </div>
  );
}
