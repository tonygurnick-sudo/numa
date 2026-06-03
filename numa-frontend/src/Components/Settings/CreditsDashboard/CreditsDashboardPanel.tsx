import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import {
  AdminCreditsService,
  type CreditBalance,
  type CreditLedgerFullRow,
} from '../../../Services/AdminCreditsService';
import { UsersService, type WorkspaceUser } from '../../../Services/UsersService';
import {
  fetchTrend,
  groupByCategory,
  rowsForCategory,
  topRowsByCredits,
  topUsersByCredits,
  type TrendPoint,
} from '../../../utils/creditDashboardData';
import { CreditsSummaryCards } from './CreditsSummaryCards';
import { CreditsTrendChart } from './CreditsTrendChart';
import { CreditsCategoryPie } from './CreditsCategoryPie';
import { CreditsTopList, type TopListItem } from './CreditsTopList';
import { CreditsDrillModal } from './CreditsDrillModal';
import { fmtTimestamp, shortId, TIER_BADGE } from './helpers';

/**
 * CreditsDashboardPanel — the headline admin Credits view (Settings → Admin → Credits Dashboard).
 *
 * 100% live aggregation of real CreditLedger data: summary + monthly trend +
 * consumption-by-category pie + Top-5 (chats / agents / categories / staff) with
 * drill-in. Privacy-safe — chat/agent NAMES and content are never shown; a run is
 * identified by its UUID + timestamp. No mock data anywhere: empty dimensions
 * render honest empty states and fill in automatically as records accrue.
 */
export const CreditsDashboardPanel: React.FC = () => {
  const { t } = useTranslation('settings');
  const { numaGet } = useNumaRequest();

  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [rows, setRows] = useState<CreditLedgerFullRow[]>([]);
  const [usedThisMonth, setUsedThisMonth] = useState(0);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ title: string; rows: CreditLedgerFullRow[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bal = await AdminCreditsService.getBalance(numaGet);
      const [ledger, users, tr] = await Promise.all([
        AdminCreditsService.getLedgerFull(undefined, numaGet),
        UsersService.list(numaGet).catch(() => [] as WorkspaceUser[]),
        fetchTrend(numaGet, bal, 6),
      ]);
      setBalance(bal);
      setRows(ledger.items);
      setUsedThisMonth(ledger.totalCredits);
      setTrend(tr);
      const map: Record<string, string> = {};
      for (const u of users) if (u.sub) map[u.sub] = u.email;
      setUserMap(map);
    } catch (err) {
      console.error('[CreditsDashboard] load failed', err);
      setError(t('creditsDashboard.loadError', { defaultValue: 'Could not load credit data.' }));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const who = useCallback(
    (sub: string | null): string =>
      sub ? (userMap[sub] ?? `${sub.slice(0, 8)}…`) : t('creditsDashboard.unknownUser', { defaultValue: 'Unknown' }),
    [userMap, t]
  );

  const runMeta = useCallback(
    (r: CreditLedgerFullRow): string =>
      t('creditsDashboard.runMeta', {
        defaultValue: '{{time}} · {{who}}',
        time: fmtTimestamp(r.lastTs),
        who: who(r.userSub),
      }),
    [t, who]
  );

  const categorySlices = useMemo(() => groupByCategory(rows), [rows]);

  const toRunItem = useCallback(
    (r: CreditLedgerFullRow): TopListItem => ({
      id: r.conversationId,
      primary: shortId(r.conversationId),
      copyValue: r.conversationId,
      secondary: runMeta(r),
      value: r.creditsCharged,
      badge: { text: r.dominantTier, bg: TIER_BADGE[r.dominantTier] ?? 'light' },
    }),
    [runMeta]
  );

  const topChats = useMemo<TopListItem[]>(
    () => topRowsByCredits(rows, 5, (r) => r.source === 'chat').map(toRunItem),
    [rows, toRunItem]
  );
  const topAgents = useMemo<TopListItem[]>(
    () => topRowsByCredits(rows, 5, (r) => r.source === 'agent').map(toRunItem),
    [rows, toRunItem]
  );
  const topCategories = useMemo<TopListItem[]>(
    () =>
      categorySlices.slice(0, 5).map((c) => ({
        id: c.key,
        primary: c.key,
        secondary: t('creditsDashboard.runsCount', { defaultValue: '{{n}} runs', n: c.count }),
        value: c.credits,
      })),
    [categorySlices, t]
  );
  const topStaff = useMemo<TopListItem[]>(
    () =>
      topUsersByCredits(rows, 5).map((u) => ({
        id: u.userSub,
        primary: who(u.userSub),
        secondary: t('creditsDashboard.runsCount', { defaultValue: '{{n}} runs', n: u.count }),
        value: u.credits,
      })),
    [rows, who, t]
  );

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2 py-5 text-muted">
        <Spinner animation="border" size="sm" />
        <span>{t('creditsDashboard.loading', { defaultValue: 'Loading dashboard…' })}</span>
      </div>
    );
  }

  // Allocation picture = this month's monthly allocation (use-it-or-lose-it), NOT the top-up balance
  // (which is the separate persistent pool the overflow draws from).
  const allocated = balance?.monthly?.allocation ?? 0;
  const remaining = balance?.monthly?.remaining ?? allocated - usedThisMonth;
  const monthLabel = (() => {
    const m = balance?.monthly?.month;
    const d = m ? new Date(`${m}-01T00:00:00`) : new Date();
    return Number.isNaN(d.getTime())
      ? new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' })
      : d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  })();

  const openRun = (id: string, titleKey: string, defaultTitle: string): void => {
    const r = rows.find((x) => x.conversationId === id);
    if (r) setDrill({ title: t(titleKey, { defaultValue: defaultTitle, id: shortId(id) }), rows: [r] });
  };

  return (
    <>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div className="text-muted small">
          <i className="bi bi-shield-lock me-1" aria-hidden="true" />
          {t('creditsDashboard.privacyNote', {
            defaultValue:
              'Privacy-safe — chat & agent names and content are never shown. Identify a run by its ID and time.',
          })}
        </div>
        <Badge bg="light" text="dark" className="border">
          <i className="bi bi-broadcast me-1" aria-hidden="true" />
          {t('creditsDashboard.liveData', { defaultValue: 'Live data' })}
        </Badge>
      </div>

      <CreditsSummaryCards allocated={allocated} used={usedThisMonth} remaining={remaining} monthLabel={monthLabel} />

      <div className="row g-3 mb-3">
        <div className="col-lg-7">
          <CreditsTrendChart data={trend} />
        </div>
        <div className="col-lg-5">
          <CreditsCategoryPie slices={categorySlices} />
        </div>
      </div>

      <div className="row g-3">
        <div className="col-xl-6">
          <CreditsTopList
            title={t('creditsDashboard.topChats', { defaultValue: 'Top 5 chats' })}
            icon="bi-chat-dots"
            items={topChats}
            emptyText={t('creditsDashboard.noChats', { defaultValue: 'No chat runs recorded yet.' })}
            onSelect={(id) => openRun(id, 'creditsDashboard.drillChat', 'Chat run {{id}}')}
          />
        </div>
        <div className="col-xl-6">
          <CreditsTopList
            title={t('creditsDashboard.topAgents', { defaultValue: 'Top 5 agents' })}
            icon="bi-robot"
            items={topAgents}
            emptyText={t('creditsDashboard.noAgents', {
              defaultValue: 'No agent runs recorded yet — populates once agent metering is on.',
            })}
            onSelect={(id) => openRun(id, 'creditsDashboard.drillAgent', 'Agent run {{id}}')}
          />
        </div>
        <div className="col-xl-6">
          <CreditsTopList
            title={t('creditsDashboard.topCategories', { defaultValue: 'Top 5 categories' })}
            icon="bi-tags"
            items={topCategories}
            emptyText={t('creditsDashboard.noCategories', { defaultValue: 'No categorised usage yet.' })}
            onSelect={(id) =>
              setDrill({
                title: t('creditsDashboard.drillCategory', { defaultValue: 'Category: {{id}}', id }),
                rows: rowsForCategory(rows, id),
              })
            }
          />
        </div>
        <div className="col-xl-6">
          <CreditsTopList
            title={t('creditsDashboard.topStaff', { defaultValue: 'Top 5 staff' })}
            icon="bi-people"
            items={topStaff}
            emptyText={t('creditsDashboard.noStaff', { defaultValue: 'No usage attributed to staff yet.' })}
            onSelect={(id) =>
              setDrill({
                title: t('creditsDashboard.drillStaff', { defaultValue: 'Staff: {{name}}', name: who(id) }),
                rows: rows.filter((r) => r.userSub === id),
              })
            }
          />
        </div>
      </div>

      <CreditsDrillModal
        show={drill !== null}
        title={drill?.title ?? ''}
        rows={drill?.rows ?? []}
        userMap={userMap}
        onHide={() => setDrill(null)}
      />
    </>
  );
};

export default CreditsDashboardPanel;
