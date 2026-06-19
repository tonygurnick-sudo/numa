import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronUp, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminCreditsService, type AgentStats } from '../../Services/AdminCreditsService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { TierBadge } from '../Settings/CreditsDashboard/TierBadge';
import { brandColor, fmtCredits } from '../Settings/CreditsDashboard/helpers';
import i18n from '../../i18n';

type Props = {
  agentId: string;
  /** 'public' agents can show the all-users aggregate to a billing admin; 'personal' never does. */
  visibility: 'personal' | 'public';
};

/** Short YYYY-MM -> "Jun" style month label for the chart axis. */
const monthLabel = (month: string): string => {
  // month is "YYYY-MM" — render with day 1 so the locale month name resolves.
  const d = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString(i18n.language, { month: 'short' });
};

/** Per-agent credit analytics (FEAT-246) — a collapsible "Credits" section inside the agent card.
 *  Lazy-loads the data only when expanded (keeps the card list cheap). Shows the caller's OWN usage of
 *  the agent (credits-over-time + value tier); for a billing admin viewing a COMPANY (public) agent it
 *  also renders the all-users aggregate + a small top-users list. Credits + tier only — no cost data. */
export const AgentCreditsSection = ({ agentId, visibility }: Props) => {
  const { t } = useTranslation('agents');
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
  }, [open, agentId, numaGet, stats, loading]);

  // For a public agent seen by a billing admin, prefer the all-users aggregate; otherwise the caller's own.
  const showAll = visibility === 'public' && stats?.scope === 'all' && !!stats.all;
  const agg = showAll ? stats?.all : stats?.own;
  const chartData = useMemo(
    () => (agg?.monthly ?? []).map((m) => ({ label: monthLabel(m.month), credits: m.credits })),
    [agg]
  );
  const hasData = (agg?.runCount ?? 0) > 0;

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
              {/* Scope + value-tier header */}
              <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                <span className="text-muted small">
                  {showAll
                    ? t('card.credits.scopeAll', { defaultValue: 'All users' })
                    : t('card.credits.scopeOwn', { defaultValue: 'Your usage' })}
                </span>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted small">
                    {t('card.credits.total', {
                      defaultValue: '{{credits}} credits',
                      credits: fmtCredits(agg?.totalCredits ?? 0),
                    })}
                  </span>
                  {hasData && <TierBadge tier={agg?.dominantTier ?? 'unclassified'} />}
                </div>
              </div>

              {!hasData ? (
                <div className="text-muted small py-2">
                  {t('card.credits.empty', { defaultValue: 'No credit usage recorded yet.' })}
                </div>
              ) : (
                <>
                  {/* Credits over time */}
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#71717a' }}
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
                        formatter={(v: number) => [
                          fmtCredits(v),
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
