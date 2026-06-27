import { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Alert } from 'react-bootstrap';
import '../chartSetup';
import {
  buildByClientRowsWindowed,
  buildDayRange,
  emailOrSub,
  fmtN,
  fmtSpan,
  fmtUSD,
  fmtUSDc,
  isAggregate,
  pct,
  poolForAggregate,
  sumByKeyInWindow,
  sumDailyInWindow,
  topConvInWindow,
  topConvSpanSeconds,
} from '../shared';
import { useCurrency } from '../currencyContext';
import { ND_COLORS } from '../theme';
import { RowDownloadMenu } from '../RowDownloadMenu';
import { fetchConversationExport, type ConversationExportFormat } from '@/services/conversationExportService';
import { FileExportService } from '@/utils/fileExport';
import type { WindowState } from '../shared';
import type { ClientAccountRef } from '@/types/clientAccount';
import type { ClientSnapshot, DashboardView, TopConversation } from '@/types/fleetAnalytics';

interface Props {
  data: DashboardView;
  window: WindowState;
  /** Raw per-client snapshots — used for window-aware aggregate views. */
  snapshots: ClientSnapshot[];
}

/**
 * Chat tab — All users (snapshot window) + Top conversations (snapshot
 * window, secondary client-side filter to the picked window) + daily
 * message bar chart (window).
 */
export function ChatTab({ data, window, snapshots }: Props) {
  useCurrency();
  // sub_to_email is a per-client thing — aggregate view doesn't have it.
  // We still try to look up by user_id but fall back to opaque sub display.
  const subToEmail = !isAggregate(data) ? data.users?.sub_to_email : undefined;

  // Per-client account ref for conversation downloads (assume-role into the
  // client account). Aggregate views don't map to one client, so downloads are
  // disabled there — each top-conversation row could belong to a different stack.
  const clientRef: ClientAccountRef | null = useMemo(() => {
    if (isAggregate(data)) return null;
    const accountId = data.client_config?.client_account_id;
    const region = data.client_config?.region;
    if (!accountId || !region) return null;
    return { clientName: data.client, accountId, region };
  }, [data]);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadConversation = async (conv: TopConversation, format: ConversationExportFormat) => {
    if (!clientRef) return;
    const userEmail = conv.user_id ? subToEmail?.[conv.user_id] : undefined;
    const file = await fetchConversationExport(clientRef, conv, format, { userEmail });
    FileExportService.downloadFile(file);
  };

  const days = useMemo(() => buildDayRange(window.startDate, window.endDate), [window]);

  // Window-scoped daily messages (already pre-bucketed by the backend)
  const dailyMsgs = data.chat?.daily_messages || {};
  const dailyMsgsInWin = useMemo(() => sumDailyInWindow(dailyMsgs, window), [dailyMsgs, window]);

  // Per-user table — window-aware via daily_cost_by_user / daily_messages_by_user
  // (backend per-day per-user buckets). Snapshot-window fields like convs,
  // turns, tool_calls, avg conv length still come from chat.by_user since
  // we don't have per-day per-user buckets for those metrics.
  const byUser = data.chat?.by_user || {};
  const costByUserInWin = useMemo(() => sumByKeyInWindow(data.chat?.daily_cost_by_user, window), [data, window]);
  const msgsByUserInWin = useMemo(() => sumByKeyInWindow(data.chat?.daily_messages_by_user, window), [data, window]);
  // Build the merged user list: union of users with cost-in-window or
  // snapshot-window entries. Window-scope cost/msgs win; other fields
  // fall back to snapshot-window from by_user.
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
    rows.sort((a, b) => (b[1]?.cost || 0) - (a[1]?.cost || 0));
    return rows;
  }, [byUser, costByUserInWin, msgsByUserInWin]);
  const totalUserCost = useMemo(() => userRows.reduce((s, [, m]) => s + (m?.cost || 0), 0), [userRows]);

  // Top conversations — pre-computed top 50 by cost. Secondary client-side
  // filter to the picked window (so switching 30d → 60d shows different
  // subsets when they exist).
  const topConvs = useMemo(
    () => (data.chat?.top_conversations || []).filter((c) => topConvInWindow(c, window)),
    [data, window]
  );
  const droppedCount =
    (data.chat?.top_conversations_dropped || 0) +
    Math.max(0, (data.chat?.top_conversations || []).length - topConvs.length);

  // Per-stack breakdown — aggregate-only. Re-derive from raw snapshots so
  // the columns track the active window (matches the Overview > By client
  // table). Pool membership matches the selected aggregate via
  // poolForAggregate (clients excludes dev + hq; arcanum excludes standalone).
  const agg = isAggregate(data) ? data : null;
  const aggSorted = useMemo(() => {
    if (!agg) return [];
    const pool = poolForAggregate(snapshots, agg.aggregate_kind);
    return buildByClientRowsWindowed(pool, window).sort((a, b) => b.chat_cost - a.chat_cost);
  }, [agg, snapshots, window]);
  const aggTotCost = useMemo(() => aggSorted.reduce((s, r) => s + r.chat_cost, 0), [aggSorted]);

  return (
    <>
      {agg ? (
        <div className="nd-card nd-row-1">
          <div className="nd-card-header">
            <div className="nd-card-title">Per-stack breakdown</div>
            <div className="nd-card-subtitle">{agg.stack_count} stacks · in window · sorted by chat cost</div>
          </div>
          <table className="nd-table">
            <thead>
              <tr>
                <th>Client</th>
                <th className="nd-num">Chat cost</th>
                <th className="nd-num">Share</th>
                <th className="nd-num">Convs</th>
                <th className="nd-num">Msgs</th>
                <th className="nd-num">$/conv</th>
                <th className="nd-num">$/msg</th>
                <th className="nd-num">Active users</th>
              </tr>
            </thead>
            <tbody>
              {aggSorted.map((r) => (
                <tr key={r.client}>
                  <td>
                    {r.client}
                    {r.dev_instance && (
                      <span className="nd-pill nd-warn-pill" style={{ marginLeft: 6, fontSize: 10 }}>
                        DEV
                      </span>
                    )}
                  </td>
                  <td className="nd-num">{fmtUSD(r.chat_cost)}</td>
                  <td className="nd-num">{pct(r.chat_cost, aggTotCost)}</td>
                  <td className="nd-num">{r.convs}</td>
                  <td className="nd-num">{r.user_messages}</td>
                  <td className="nd-num">{r.convs ? fmtUSD(r.chat_cost / r.convs) : '—'}</td>
                  <td className="nd-num">{r.user_messages ? fmtUSDc(r.chat_cost / r.user_messages) : '—'}</td>
                  <td className="nd-num">{r.active_users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">All users</div>
          <div className="nd-card-subtitle">
            {userRows.length} users · cost & msgs filtered to window · convs/turns/tools/avg-len are snapshot-window
          </div>
        </div>
        <div className="nd-scroll-tbl">
          <table className="nd-table">
            <thead>
              <tr>
                <th>User</th>
                <th className="nd-num">Cost</th>
                <th className="nd-num">Share</th>
                <th className="nd-num">Convs</th>
                <th className="nd-num">Msgs</th>
                <th className="nd-num">$/conv</th>
                <th className="nd-num">$/msg</th>
                <th className="nd-num">Avg conv length</th>
              </tr>
            </thead>
            <tbody>
              {userRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="nd-empty">
                    No active users
                  </td>
                </tr>
              ) : (
                userRows.map(([u, m]) => {
                  const cpc = m.convs ? m.cost / m.convs : 0;
                  const cpm = m.user_messages ? m.cost / m.user_messages : 0;
                  return (
                    <tr key={u}>
                      <td>
                        {emailOrSub(u, subToEmail)}
                        <div className="nd-sub">{u.slice(0, 16)}…</div>
                      </td>
                      <td className="nd-num">{fmtUSD(m.cost)}</td>
                      <td className="nd-num">{pct(m.cost, totalUserCost)}</td>
                      <td className="nd-num">{m.convs}</td>
                      <td className="nd-num">{m.user_messages}</td>
                      <td className="nd-num">{fmtUSD(cpc)}</td>
                      <td className="nd-num">{fmtUSDc(cpm)}</td>
                      <td className="nd-num">{fmtSpan(m.avg_span_seconds)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">Top conversations</div>
          <div className="nd-card-subtitle">
            Top {data.chat?.top_conversations_kept ?? 50} by cost in last {data.window_days}d
            {droppedCount > 0 ? ` (long tail of ${fmtN(droppedCount)} not shown)` : ''}
            {' · '}
            {topConvs.length} fall in selected window
          </div>
        </div>
        {downloadError && (
          <Alert variant="warning" dismissible onClose={() => setDownloadError(null)} className="mx-3 mt-2 mb-0 py-2">
            {downloadError}
          </Alert>
        )}
        <div className="nd-scroll-tbl">
          <table className="nd-table">
            <thead>
              <tr>
                <th>Started at</th>
                <th>User</th>
                <th>Agent</th>
                <th className="nd-num">Cost</th>
                <th className="nd-num">Turns</th>
                <th className="nd-num">Reqs</th>
                <th className="nd-num">Tools</th>
                <th className="nd-num">$/turn</th>
                <th className="nd-num">Length</th>
                <th className="nd-dl-col" aria-label="Download" />
              </tr>
            </thead>
            <tbody>
              {topConvs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="nd-empty">
                    No top conversations in window
                  </td>
                </tr>
              ) : (
                topConvs.map((c) => {
                  const cpt = c.total_turns ? c.total_cost_usd / c.total_turns : 0;
                  const span = fmtSpan(topConvSpanSeconds(c));
                  const shortModel = (c.model || '').replace(/^us\.anthropic\./, '').replace(/-v\d+:?\d*$/, '');
                  const started = c.started_at ? new Date(c.started_at).toLocaleString() : '—';
                  return (
                    <tr key={c.conversation_id}>
                      <td>
                        {started}
                        <div className="nd-sub">
                          {(c.conversation_id || '').slice(0, 24)}…{c.is_scheduled && ' · 🕐 scheduled'}
                          {shortModel && ` · ${shortModel}`}
                        </div>
                      </td>
                      <td>{emailOrSub(c.user_id, subToEmail)}</td>
                      <td>{c.agent_title || c.agent_id || '—'}</td>
                      <td className="nd-num">{fmtUSD(c.total_cost_usd)}</td>
                      <td className="nd-num">{c.total_turns}</td>
                      <td className="nd-num">{c.request_count}</td>
                      <td className="nd-num">{c.tool_call_count}</td>
                      <td className="nd-num">{fmtUSDc(cpt)}</td>
                      <td className="nd-num">{span}</td>
                      <td className="nd-dl-col">
                        <RowDownloadMenu
                          title="Download conversation"
                          disabledReason={clientRef ? undefined : 'Select a single client to download conversations'}
                          onError={setDownloadError}
                          options={[
                            {
                              key: 'txt',
                              label: 'Clean transcript (.txt)',
                              sublabel: 'Readable user / assistant / tool turns',
                              run: () => downloadConversation(c, 'txt'),
                            },
                            {
                              key: 'jsonl',
                              label: 'Raw trace (.jsonl)',
                              sublabel: 'Full lossless event log — thinking + cost included',
                              run: () => downloadConversation(c, 'jsonl'),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="nd-card nd-row-1">
        <div className="nd-card-header">
          <div className="nd-card-title">User messages per day{agg ? ' (all stacks)' : ''}</div>
          <div className="nd-card-subtitle">Number of user-typed prompts · {fmtN(dailyMsgsInWin)} in window</div>
        </div>
        <div className="nd-chart-wrap">
          <Bar
            data={{
              labels: days,
              datasets: [
                {
                  label: 'user messages',
                  data: days.map((d) => dailyMsgs[d] || 0),
                  backgroundColor: ND_COLORS.accent,
                  borderRadius: 4,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { x: { grid: { display: false } } },
            }}
          />
        </div>
      </div>
    </>
  );
}
