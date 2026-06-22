import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronUp, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import {
  AdminCreditsService,
  type AgentStats,
  type AgentStatRun,
  type RunSource,
} from '../../Services/AdminCreditsService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { TierBadge } from '../Settings/CreditsDashboard/TierBadge';
import { brandColor, fmtCredits, tierLabel } from '../Settings/CreditsDashboard/helpers';
import i18n from '../../i18n';

type Props = {
  agentId: string;
  /** 'public' agents can show the all-users aggregate to a billing admin; 'personal' never does. */
  visibility: 'personal' | 'public';
};

/** Scheduled line uses the brand colour; on-demand a muted teal so the two read apart at a glance. */
const ONDEMAND_COLOR = '#0d9488';

/** ISO timestamp -> "Jun 20, 14:32" — full date+time for the hover tooltip. */
const runTime = (ts: string | null): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Compact x-axis tick: "14:32" for runs today, else "20 Jun". Keeps the axis readable on a narrow card. */
const axisTime = (ts: string | null): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(
    i18n.language,
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }
  );
};

/** Per-agent credit analytics (FEAT-246) — a collapsible "Credits" section inside the agent card.
 *  Lazy-loads the data only when expanded (keeps the card list cheap). Run-first: a two-line chart plots
 *  the caller's OWN last 5 runs per source (scheduled vs on-demand) on a shared credits axis, and the
 *  header reflects the MOST RECENT run's value tier. For a billing admin viewing a COMPANY (public)
 *  agent it shows the all-users runs + a top-users list. Credits + tier only — no cost data. */
export const AgentCreditsSection = ({ agentId, visibility }: Props) => {
  const { t } = useTranslation('agents');
  const { t: tSettings } = useTranslation('settings');
  const tierName = (tier?: string): string => tierLabel(tier ?? 'unclassified', tSettings);
  const { numaGet } = useNumaRequest();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const brand = useMemo(() => brandColor(), []);

  // Fetch once, the first time the section is expanded.
  useEffect(() => {
    if (!open || stats || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const res = await AdminCreditsService.getAgentStats(agentId, 6, numaGet);
        if (cancelled) return;
        setStats(res);
        // Resolve sub -> email for the top-users list (billing-admin scope only). Best-effort.
        if (res.scope === 'all' && (res.byUser?.length ?? 0) > 0) {
          const users = await UsersService.list(numaGet).catch(() => [] as WorkspaceUser[]);
          if (cancelled) return;
          const map: Record<string, string> = {};
          for (const u of users) if (u.sub) map[u.sub] = u.email;
          setUserMap(map);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Depend ONLY on open/agentId/numaGet — NOT stats/loading. Including them made the effect re-run
    // on setLoading(true); React then fired the previous run's cleanup (cancelled=true) on the
    // in-flight fetch, so neither setStats nor setLoading(false) ran → perpetual "Loading…". The
    // in-effect guard (stats || loading) already prevents a duplicate fetch.
  }, [open, agentId, numaGet]);

  // For a public agent seen by a billing admin, prefer the all-users aggregate; otherwise the caller's own.
  const showAll = visibility === 'public' && stats?.scope === 'all' && !!stats.all;
  const agg = showAll ? stats?.all : stats?.own;
  const runs = useMemo(() => agg?.runs ?? [], [agg]);
  const latestRun = runs[0]; // newest overall (runs is newest-first)
  const latestTier = agg?.latestTier ?? 'unclassified';
  const hasData = runs.length > 0;

  // Two lines — scheduled vs on-demand — on a shared credits axis over a real chronological x-axis.
  // Each source contributes its last 5 runs; all runs are merged and sorted by time, so every dot sits
  // at its own real run time (the tick shows that time). A row holds only the source that ran at that
  // instant; the other line bridges the gap via connectNulls. Lines with no runs are simply absent.
  const { chartData, sourcesPresent } = useMemo(() => {
    const take = (s: RunSource): AgentStatRun[] => runs.filter((r) => r.source === s).slice(0, 5);
    const scheduled = take('scheduled');
    const ondemand = take('ondemand');
    const data = [...scheduled, ...ondemand]
      .sort((a, b) => String(a.ts ?? '').localeCompare(String(b.ts ?? ''))) // oldest -> newest
      .map((r) => ({
        label: axisTime(r.ts),
        scheduled: r.source === 'scheduled' ? r.credits : null,
        ondemand: r.source === 'ondemand' ? r.credits : null,
        scheduledRun: r.source === 'scheduled' ? r : undefined,
        ondemandRun: r.source === 'ondemand' ? r : undefined,
      }));
    return {
      chartData: data,
      sourcesPresent: { scheduled: scheduled.length > 0, ondemand: ondemand.length > 0 },
    };
  }, [runs]);

  const userLabel = (sub: string): string => userMap[sub] ?? `${sub.slice(0, 8)}…`;

  // Custom tooltip: per hovered run-slot, show each present source's real time + credits + tier.
  // recharts 3 types the content render-prop awkwardly; we only need active + payload[].payload.
  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { payload?: { scheduledRun?: AgentStatRun; ondemandRun?: AgentStatRun } }[];
  }) => {
    if (!active || !payload?.length) return null;
    const slot = payload[0]?.payload;
    if (!slot) return null;
    const lines: { color: string; label: string; run: AgentStatRun }[] = [];
    if (slot.scheduledRun)
      lines.push({
        color: brand,
        label: t('card.credits.sourceScheduled', { defaultValue: 'Scheduled' }),
        run: slot.scheduledRun,
      });
    if (slot.ondemandRun)
      lines.push({
        color: ONDEMAND_COLOR,
        label: t('card.credits.sourceOnDemand', { defaultValue: 'On-demand' }),
        run: slot.ondemandRun,
      });
    if (!lines.length) return null;
    return (
      <div
        style={{ background: '#fff', borderRadius: 10, border: '1px solid #e4e4e7', fontSize: 12, padding: '8px 10px' }}
      >
        {lines.map(({ color, label, run }) => (
          <div key={label} className="d-flex flex-column mb-1">
            <span className="fw-semibold" style={{ color }}>
              {label}
            </span>
            <span className="text-muted">{runTime(run.ts)}</span>
            <span>
              {t('card.credits.total', { defaultValue: '{{credits}} credits', credits: fmtCredits(run.credits) })} ·{' '}
              {tierName(run.tier)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="border-top pt-3 mb-3" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn btn-link p-0 text-decoration-none d-flex align-items-center gap-2 w-100"
        style={{ color: 'var(--brand-primary, var(--color-primary))' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Coins size={16} />
        <span className="fw-semibold small">{t('card.credits.title', { defaultValue: 'Credits' })}</span>
        <span className="ms-auto">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>

      {open && (
        <div className="mt-3">
          {loading && (
            <div className="text-muted small">{t('card.credits.loading', { defaultValue: 'Loading usage…' })}</div>
          )}
          {!loading && error && (
            <div className="text-muted small">
              {t('card.credits.error', { defaultValue: 'Could not load credit usage.' })}
            </div>
          )}
          {!loading && !error && stats && (
            <>
              {/* Scope + latest-run header: the most recent run's credits + its value tier. */}
              <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                <span className="text-muted small">
                  {showAll
                    ? t('card.credits.scopeAllLatest', { defaultValue: 'Latest run (all users)' })
                    : t('card.credits.scopeOwnLatest', { defaultValue: 'Latest run' })}
                </span>
                <div className="d-flex align-items-center gap-2">
                  {hasData && (
                    <span className="text-muted small">
                      {t('card.credits.total', {
                        defaultValue: '{{credits}} credits',
                        credits: fmtCredits(latestRun?.credits ?? 0),
                      })}
                    </span>
                  )}
                  {hasData && <TierBadge tier={latestTier} />}
                </div>
              </div>

              {!hasData ? (
                <div className="text-muted small py-2">
                  {t('card.credits.empty', { defaultValue: 'No credit usage recorded yet.' })}
                </div>
              ) : (
                <>
                  {/* Credits per run — scheduled vs on-demand, each its own line of last-5 runs.
                      Sequence axis (right = most recent); real run time + tier ride in the tooltip. */}
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f3" />
                      <XAxis
                        dataKey="label"
                        interval="preserveStartEnd"
                        tick={{ fontSize: 10, fill: '#71717a' }}
                        axisLine={{ stroke: '#e4e4e7' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#71717a' }}
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                      />
                      <Tooltip
                        cursor={{ stroke: '#e4e4e7' }}
                        content={renderTooltip as unknown as ComponentProps<typeof Tooltip>['content']}
                        wrapperStyle={{ outline: 'none' }}
                      />
                      <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                      {sourcesPresent.scheduled && (
                        <Line
                          type="monotone"
                          dataKey="scheduled"
                          name={t('card.credits.sourceScheduled', { defaultValue: 'Scheduled' })}
                          stroke={brand}
                          strokeWidth={2}
                          dot={{ r: 3, fill: brand }}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      )}
                      {sourcesPresent.ondemand && (
                        <Line
                          type="monotone"
                          dataKey="ondemand"
                          name={t('card.credits.sourceOnDemand', { defaultValue: 'On-demand' })}
                          stroke={ONDEMAND_COLOR}
                          strokeWidth={2}
                          dot={{ r: 3, fill: ONDEMAND_COLOR }}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>

                  {/* Top users (billing-admin + public agent only) */}
                  {showAll && (stats.byUser?.length ?? 0) > 0 && (
                    <div className="mt-3">
                      <div className="text-muted small fw-semibold mb-1">
                        {t('card.credits.topUsers', { defaultValue: 'Top users' })}
                      </div>
                      <div className="d-flex flex-column gap-1">
                        {stats.byUser!.slice(0, 5).map((u) => (
                          <div key={u.userSub} className="d-flex align-items-center justify-content-between small">
                            <span className="text-truncate text-muted" style={{ maxWidth: '70%' }}>
                              {userLabel(u.userSub)}
                            </span>
                            <span className="text-muted">
                              {t('card.credits.total', {
                                defaultValue: '{{credits}} credits',
                                credits: fmtCredits(u.credits),
                              })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentCreditsSection;
