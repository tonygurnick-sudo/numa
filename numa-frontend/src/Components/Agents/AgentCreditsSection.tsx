import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronUp, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminCreditsService, type AgentStats } from '../../Services/AdminCreditsService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { TierBadge } from '../Settings/CreditsDashboard/TierBadge';
import { brandColor, fmtCredits, tierLabel } from '../Settings/CreditsDashboard/helpers';
import i18n from '../../i18n';

type Props = {
  agentId: string;
  /** 'public' agents can show the all-users aggregate to a billing admin; 'personal' never does. */
  visibility: 'personal' | 'public';
};

/** ISO timestamp -> "Jun 20, 14:32" style label for a single run on the chart axis. */
const runLabel = (ts: string | null): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Per-agent credit analytics (FEAT-246) — a collapsible "Credits" section inside the agent card.
 *  Lazy-loads the data only when expanded (keeps the card list cheap). Run-first: the chart shows the
 *  caller's OWN last 5 runs (credits per run) and the header reflects the MOST RECENT run's value tier.
 *  For a billing admin viewing a COMPANY (public) agent it shows the all-users runs + a top-users list.
 *  Credits + tier only — no cost data. */
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
  // Run-first: chart shows the last few individual runs (oldest -> newest, left -> right). `runs` comes
  // back newest-first, so reverse it for the chart while keeping runs[0] as the most recent run.
  const runs = useMemo(() => agg?.runs ?? [], [agg]);
  const chartData = useMemo(
    () => runs.map((r) => ({ label: runLabel(r.ts), credits: r.credits, tier: r.tier })).reverse(),
    [runs]
  );
  const latestRun = runs[0];
  const latestTier = agg?.latestTier ?? 'unclassified';
  const hasData = runs.length > 0;

  const userLabel = (sub: string): string => userMap[sub] ?? `${sub.slice(0, 8)}…`;

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
                  {/* Credits per run — up to the last 5 runs, oldest -> newest left -> right. */}
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f3" />
                      <XAxis
                        dataKey="label"
                        interval={0}
                        tick={{ fontSize: 10, fill: '#71717a' }}
                        axisLine={{ stroke: '#e4e4e7' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#71717a' }}
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                        contentStyle={{ borderRadius: 10, border: '1px solid #e4e4e7', fontSize: 12 }}
                        formatter={(v: number, _n, item) => [
                          `${fmtCredits(v)} · ${tierName((item?.payload as { tier?: string })?.tier)}`,
                          t('card.credits.creditsLabel', { defaultValue: 'Credits' }),
                        ]}
                      />
                      <Bar dataKey="credits" fill={brand} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
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
