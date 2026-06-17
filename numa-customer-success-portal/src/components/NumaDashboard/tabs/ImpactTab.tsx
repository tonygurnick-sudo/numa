import { useMemo, useState } from 'react';
import { Alert } from 'react-bootstrap';
import { emailOrSub, fmtN, fmtSpan, fmtUSD, isAggregate, sumByKeyInWindow, sumDailyInWindow } from '../shared';
import { useCurrency } from '../currencyContext';
import { RowDownloadMenu } from '../RowDownloadMenu';
import { fetchAgentDefinitionExport, type AgentExportFormat } from '@/services/agentDefinitionService';
import { FileExportService } from '@/utils/fileExport';
import type { WindowState } from '../shared';
import type { ClientAccountRef } from '@/types/clientAccount';
import type { DashboardView } from '@/types/fleetAnalytics';

interface Props {
  data: DashboardView;
  window: WindowState;
}

const DEFAULT_TIME_SAVED = 10; // minutes per run when not set

type SubTab = 'agents' | 'users' | 'by-client';

/**
 * Impact tab — Time saved estimate + per-agent contribution + per-user value.
 *
 * Window scoping:
 *   - "Time saved (Agents)" KPI is pro-rated to the window by the share of
 *     scheduled runs that fell inside it (runs_in_window / total_runs).
 *     Per-agent run counts are snapshot-window (no per-day per-agent buckets
 *     in the snapshot yet — coming with the backend Wave 2 change).
 *   - Per-user table is snapshot-window too — same backend dependency.
 *   - Time saved (Numa Chat) is a coming-soon tile; we don't have a
 *     mechanism to estimate this yet.
 */
export function ImpactTab({ data, window }: Props) {
  useCurrency();
  const [sub, setSub] = useState<SubTab>('agents');
  const agg = isAggregate(data) ? data : null;
  const subToEmail = !agg ? data.users?.sub_to_email : undefined;

  // Per-client account ref for agent-definition downloads (assume-role into the
  // client account). Aggregate views don't map to one client → downloads off.
  const clientRef: ClientAccountRef | null = useMemo(() => {
    if (isAggregate(data)) return null;
    const accountId = data.client_config?.client_account_id;
    const region = data.client_config?.region;
    if (!accountId || !region) return null;
    return { clientName: data.client, accountId, region };
  }, [data]);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadAgent = async (agentId: string, format: AgentExportFormat) => {
    if (!clientRef) return;
    const file = await fetchAgentDefinitionExport(clientRef, agentId, format);
    FileExportService.downloadFile(file);
  };

  // Build agent map from data.agents (workspace + personal) so we know
  // estimated_time_saved_minutes per agent. Aggregate view doesn't include
  // per-stack agent rows, so we fall back to "0 known per-agent metadata"
  // and use DEFAULT_TIME_SAVED for everyone.
  const agentMetaById: Record<string, { title?: string; kind?: string; minutes?: number }> = useMemo(() => {
    const out: Record<string, { title?: string; kind?: string; minutes?: number }> = {};
    for (const a of data.agents?.agents?.rows ?? []) {
      if (a.agent_id) out[a.agent_id] = { title: a.title, kind: 'workspace', minutes: a.estimated_time_saved_minutes };
    }
    for (const a of data.agents?.user_agents?.rows ?? []) {
      if (a.agent_id) out[a.agent_id] = { title: a.title, kind: 'personal', minutes: a.estimated_time_saved_minutes };
    }
    return out;
  }, [data]);

  // Per-agent rows. Run counts are snapshot-window (no per-day per-agent
  // run buckets yet). Cost IS window-aware via daily_cost_by_agent.
  const costByAgentInWin = useMemo(() => sumByKeyInWindow(data.chat?.daily_cost_by_agent, window), [data, window]);
  const perAgent = useMemo(() => {
    const rows = (data.chat?.by_agent || []).map((a) => {
      const meta = agentMetaById[a.agent_id] || {};
      const minutes = meta.minutes && meta.minutes > 0 ? meta.minutes : DEFAULT_TIME_SAVED;
      const minutesDefault = !meta.minutes || meta.minutes <= 0;
      const totalRuns = (a.scheduled_count || 0) + (a.adhoc_count || 0);
      return {
        agent_id: a.agent_id,
        title: a.agent_title || meta.title || a.agent_id,
        kind: meta.kind || 'unknown',
        adhoc: a.adhoc_count,
        scheduled: a.scheduled_count,
        total: totalRuns,
        costInWindow: costByAgentInWin[a.agent_id] ?? 0,
        minutesPerRun: minutes,
        minutesDefault,
        totalMinutes: totalRuns * minutes,
      };
    });
    rows.sort((a, b) => b.totalMinutes - a.totalMinutes || b.total - a.total);
    return rows;
  }, [data, agentMetaById, costByAgentInWin]);

  const totalSavedSnapshot = useMemo(() => perAgent.reduce((s, r) => s + r.totalMinutes, 0), [perAgent]);

  // Pro-rate time-saved to the picked window by the share of runs in window.
  // Exact would require per-day per-agent runs (Wave 2 backend).
  const schRunsInWin = sumDailyInWindow(data.scheduled_runs?.daily_runs, window);
  const totalSnapshotRuns = data.scheduled_runs?.totals?.count || 0;
  const totalSavedInWin = totalSnapshotRuns ? Math.round(totalSavedSnapshot * (schRunsInWin / totalSnapshotRuns)) : 0;

  // Per-user — cost & messages are window-aware via daily_*_by_user;
  // convs/turns/tools/avg-len remain snapshot-window.
  const byUser = data.chat?.by_user || {};
  const costByUserInWin = useMemo(() => sumByKeyInWindow(data.chat?.daily_cost_by_user, window), [data, window]);
  const msgsByUserInWin = useMemo(() => sumByKeyInWindow(data.chat?.daily_messages_by_user, window), [data, window]);
  const userRows = useMemo(() => {
    const allUserIds = new Set([...Object.keys(byUser), ...Object.keys(costByUserInWin)]);
    const rows = Array.from(allUserIds).map((u) => {
      const snap = byUser[u] || {
        cost: 0,
        convs: 0,
        requests: 0,
        turns: 0,
        user_messages: 0,
        tool_calls: 0,
        avg_span_seconds: null,
        first_at: null,
        last_at: null,
      };
      return [
        u,
        {
          ...snap,
          cost: costByUserInWin[u] ?? snap.cost,
          user_messages: msgsByUserInWin[u] ?? snap.user_messages,
        },
      ] as const;
    });
    rows.sort((a, b) => (b[1]?.user_messages || 0) - (a[1]?.user_messages || 0));
    return rows;
  }, [byUser, costByUserInWin, msgsByUserInWin]);

  const totalAgents = (data.agents?.agents?.count || 0) + (data.agents?.user_agents?.count || 0);
  const activeSchedules = data.schedules?.by_derived_status?.active || 0;

  // By-client time-saved table (aggregate only)
  const byClientRows = useMemo(
    () => (agg?.by_client || []).slice().sort((a, b) => b.time_saved_minutes - a.time_saved_minutes),
    [agg]
  );

  const subtabs: Array<{ key: SubTab; label: string; hidden?: boolean }> = [
    { key: 'agents', label: 'Per-agent contribution' },
    { key: 'users', label: 'Per-user value' },
    { key: 'by-client', label: 'By client', hidden: !agg },
  ];

  return (
    <>
      <div className="nd-kpi-grid">
        <Kpi
          label="Time saved (Agents)"
          value={`${Math.floor(totalSavedInWin / 60)}h ${totalSavedInWin % 60}m`}
          sub={`window est · ${fmtN(schRunsInWin)} runs × min/run · default 10m where unset`}
          variant="highlight"
        />
        <Kpi label="Time saved (Numa Chat)" value="—" sub="coming soon · need per-conv outcome data" variant="info" />
        <Kpi label="Schedule runs (window)" value={fmtN(schRunsInWin)} sub="from selected window" />
        <Kpi label="Total agents" value={fmtN(totalAgents)} sub={`${perAgent.length} with activity`} />
        <Kpi label="Active schedules" value={fmtN(activeSchedules)} sub={`${fmtN(data.schedules?.count || 0)} total`} />
      </div>

      <div className="nd-subtabs">
        {subtabs
          .filter((t) => !t.hidden)
          .map((t) => (
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

      {sub === 'agents' && (
        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">Per-agent contribution</div>
            <div className="nd-card-subtitle">
              Cost filtered to window · runs/time-saved are snapshot-window (×10m/run default where unset)
            </div>
          </div>
          {downloadError && (
            <Alert variant="warning" dismissible onClose={() => setDownloadError(null)} className="mx-3 mt-2 mb-0 py-2">
              {downloadError}
            </Alert>
          )}
          <table className="nd-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Type</th>
                <th className="nd-num">Ad-hoc</th>
                <th className="nd-num">Scheduled</th>
                <th className="nd-num">Total runs</th>
                <th className="nd-num">Cost (window)</th>
                <th className="nd-num">Min / run</th>
                <th className="nd-num">Total saved</th>
                <th className="nd-dl-col" aria-label="Download" />
              </tr>
            </thead>
            <tbody>
              {perAgent.length === 0 && (
                <tr>
                  <td colSpan={9} className="nd-empty">
                    No agent activity
                  </td>
                </tr>
              )}
              {perAgent.map((r) => (
                <tr key={r.agent_id}>
                  <td>{r.title}</td>
                  <td>
                    <span className="nd-pill">{r.kind}</span>
                  </td>
                  <td className="nd-num">{r.adhoc || '—'}</td>
                  <td className="nd-num">{r.scheduled || '—'}</td>
                  <td className="nd-num">{r.total || '—'}</td>
                  <td className="nd-num">{r.costInWindow ? fmtUSD(r.costInWindow) : '—'}</td>
                  <td className="nd-num">
                    {r.minutesPerRun}
                    {r.minutesDefault && (
                      <span style={{ color: 'var(--nd-text-faint)', fontSize: 10 }}> (default)</span>
                    )}
                  </td>
                  <td className="nd-num">
                    {r.totalMinutes ? `${Math.floor(r.totalMinutes / 60)}h ${r.totalMinutes % 60}m` : '—'}
                  </td>
                  <td className="nd-dl-col">
                    <RowDownloadMenu
                      title="Download agent definition"
                      disabledReason={clientRef ? undefined : 'Select a single client to download agent definitions'}
                      onError={setDownloadError}
                      options={[
                        {
                          key: 'json',
                          label: 'Definition (.json)',
                          sublabel: 'Full agent record + schedules',
                          run: () => downloadAgent(r.agent_id, 'json'),
                        },
                        {
                          key: 'md',
                          label: 'Readable (.md)',
                          sublabel: 'System prompt, tools, model, schedules',
                          run: () => downloadAgent(r.agent_id, 'md'),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'users' && (
        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">Per-user value</div>
            <div className="nd-card-subtitle">
              Cost & messages filtered to window · convs/turns/tools/avg-len are snapshot-window
            </div>
          </div>
          <table className="nd-table">
            <thead>
              <tr>
                <th>User</th>
                <th className="nd-num">Messages</th>
                <th className="nd-num">Conversations</th>
                <th className="nd-num">Avg conv length</th>
                <th className="nd-num">Tool calls</th>
                <th className="nd-num">Turns</th>
                <th className="nd-num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {userRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="nd-empty">
                    No active users
                  </td>
                </tr>
              )}
              {userRows.map(([u, m]) => (
                <tr key={u}>
                  <td>{emailOrSub(u, subToEmail)}</td>
                  <td className="nd-num">{m.user_messages}</td>
                  <td className="nd-num">{m.convs}</td>
                  <td className="nd-num">{fmtSpan(m.avg_span_seconds)}</td>
                  <td className="nd-num">{m.tool_calls}</td>
                  <td className="nd-num">{m.turns}</td>
                  <td className="nd-num">{fmtUSD(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'by-client' && agg && (
        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">By client</div>
            <div className="nd-card-subtitle">Time saved + counts per stack (snapshot-window)</div>
          </div>
          <table className="nd-table">
            <thead>
              <tr>
                <th>Client</th>
                <th className="nd-num">Time saved</th>
                <th className="nd-num">Schedules</th>
                <th className="nd-num">Agents</th>
              </tr>
            </thead>
            <tbody>
              {byClientRows.map((r) => {
                const m = r.time_saved_minutes || 0;
                return (
                  <tr key={r.client}>
                    <td>{r.client}</td>
                    <td className="nd-num">
                      {Math.floor(m / 60)}h {m % 60}m
                    </td>
                    <td className="nd-num">{r.schedules}</td>
                    <td className="nd-num">{r.agents}</td>
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

interface KpiProps {
  label: string;
  value: string | number;
  sub?: string;
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
