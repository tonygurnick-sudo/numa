import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Spinner, Tab, Tabs } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import {
  AdminCreditsService,
  type BillingAdmin,
  type CreditBalance,
  type CreditLedgerRow,
} from '../../../Services/AdminCreditsService';
import { UsersService, type WorkspaceUser } from '../../../Services/UsersService';
import { listAgents } from '../../../Services/AgentsService';
import type { AgentSummary } from '../../../types/agents';
import {
  fetchTrend,
  groupBySource,
  topAgentsByCredits,
  topRowsByCredits,
  topUsersByCredits,
  type TrendPoint,
} from '../../../utils/creditDashboardData';
import { CreditsSummaryCards } from './CreditsSummaryCards';
import { CreditsWorkDelivered } from './CreditsWorkDelivered';
import { CreditsTrendChart } from './CreditsTrendChart';
import { CreditsSourceChart } from './CreditsSourceChart';
import { CreditsValueTierChart } from './CreditsValueTierChart';
import { CreditsTopList, type TopListItem } from './CreditsTopList';
import { CreditsDrillModal } from './CreditsDrillModal';
import { CreditsTopupActivity } from './CreditsTopupActivity';
import { fmtTimestamp, shortId } from './helpers';

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
  const [rows, setRows] = useState<CreditLedgerRow[]>([]);
  const [usedThisMonth, setUsedThisMonth] = useState(0);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [agentMap, setAgentMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ title: string; rows: CreditLedgerRow[] } | null>(null);
  // null = not yet checked. When isBillingAdmin is false we render the lock screen and never fetch
  // the credit data (the API also 403s — defence in depth).
  const [access, setAccess] = useState<{ isBillingAdmin: boolean; admins: BillingAdmin[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const acc = await AdminCreditsService.getBillingAdmins(numaGet);
      setAccess(acc);
      if (!acc.isBillingAdmin) {
        setLoading(false);
        return; // locked — skip the credit-data fetch entirely
      }
      const bal = await AdminCreditsService.getBalance(numaGet);
      const [ledger, users, agents, tr] = await Promise.all([
        AdminCreditsService.getLedger(undefined, numaGet),
        UsersService.list(numaGet).catch(() => [] as WorkspaceUser[]),
        listAgents(numaGet, { scope: 'all' }).catch(() => [] as AgentSummary[]),
        fetchTrend(numaGet, bal, 6),
      ]);
      setBalance(bal);
      setRows(ledger.items);
      setUsedThisMonth(ledger.totalCredits);
      setTrend(tr);
      const map: Record<string, string> = {};
      for (const u of users) if (u.sub) map[u.sub] = u.email;
      setUserMap(map);
      const amap: Record<string, string> = {};
      for (const a of agents) if (a.agentId) amap[a.agentId] = a.title;
      setAgentMap(amap);
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

  // Resolve an agentId to its display name (current title); falls back to a short id for an agent
  // that's been deleted or isn't visible to this admin.
  const agentName = useCallback((id: string): string => agentMap[id] ?? `${id.slice(0, 8)}…`, [agentMap]);

  const runMeta = useCallback(
    (r: CreditLedgerRow): string =>
      t('creditsDashboard.runMeta', {
        defaultValue: '{{time}} · {{who}}',
        time: fmtTimestamp(r.lastTs),
        who: who(r.userSub),
      }),
    [t, who]
  );

  const sourceSlices = useMemo(() => groupBySource(rows), [rows]);

  // A run is identified by its anonymised title (from the nightly summariser) + time + who ran it;
  // the full conversation ID rides a copy button so an admin can dig deeper on a specific user/run.
  const toRunItem = useCallback(
    (r: CreditLedgerRow): TopListItem => ({
      id: r.conversationId,
      primary: r.title?.trim()
        ? r.title
        : t('creditsDashboard.summaryPending', { defaultValue: 'Anonymised summary coming overnight' }),
      copyValue: r.conversationId,
      secondary: runMeta(r),
      value: r.creditsCharged,
      tier: r.dominantTier,
    }),
    [runMeta, t]
  );

  const topChats = useMemo<TopListItem[]>(
    () => topRowsByCredits(rows, 5, (r) => r.source === 'chat').map(toRunItem),
    [rows, toRunItem]
  );
  const topAgents = useMemo<TopListItem[]>(
    () =>
      topAgentsByCredits(rows, 5).map((a) => ({
        id: a.agentId,
        primary: agentName(a.agentId),
        secondary: t('creditsDashboard.runsCount', { defaultValue: '{{n}} runs', n: a.count }),
        value: a.credits,
      })),
    [rows, agentName, t]
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
      <div className="credits-dashboard">
        <div className="credits-empty">
          <Spinner animation="border" size="sm" className="mb-2" />
          <span className="credits-empty__text">
            {t('creditsDashboard.loading', { defaultValue: 'Loading dashboard…' })}
          </span>
        </div>
      </div>
    );
  }

  // Lock screen: an admin who isn't a billing-admin sees the page exists but not the data. Show who
  // to ask so they can request access (a billing-admin promotes them in User Management).
  if (access && !access.isBillingAdmin) {
    const askList = access.admins.map((a) => a.email || `${a.sub.slice(0, 8)}…`).filter(Boolean);
    return (
      <div className="credits-dashboard">
        <div className="credits-empty">
          <i className="bi bi-shield-lock credits-empty__icon" aria-hidden="true" />
          <div className="credits-empty__title">
            {t('creditsDashboard.lockedTitle', { defaultValue: 'Only billing admins can see credit information' })}
          </div>
          <p className="credits-empty__text mb-0">
            {askList.length > 0
              ? t('creditsDashboard.lockedAsk', {
                  defaultValue: 'Ask a billing admin to grant you access: {{who}}',
                  who: askList.join(', '),
                })
              : t('creditsDashboard.lockedNone', {
                  defaultValue: 'No billing admin has been assigned yet — contact Arcanum to set one up.',
                })}
          </p>
        </div>
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
    <div className="credits-dashboard">
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="credits-topbar">
        <span className="credits-privacy-note">
          <i className="bi bi-shield-lock" aria-hidden="true" />
          {t('creditsDashboard.privacyNote', {
            defaultValue:
              'Privacy-safe — chat & agent names and content are never shown. Identify a run by its ID and time.',
          })}
        </span>
        <span className="credits-live-chip">
          <span className="credits-live-chip__dot" aria-hidden="true" />
          {t('creditsDashboard.liveData', { defaultValue: 'Live data' })}
        </span>
      </div>

      <CreditsSummaryCards
        allocated={allocated}
        used={usedThisMonth}
        remaining={remaining}
        topUpBalance={balance?.balance ?? 0}
        monthLabel={monthLabel}
      />

      <Tabs defaultActiveKey="dashboard" className="credits-tabs">
        <Tab eventKey="dashboard" title={t('creditsDashboard.tabDashboard', { defaultValue: 'Dashboard' })}>
          <div className="pt-3">
            <div className="row g-3 mb-3">
              <div className="col-lg-7">
                <CreditsTrendChart data={trend} />
              </div>
              <div className="col-lg-5">
                <CreditsSourceChart slices={sourceSlices} />
              </div>
            </div>

            <div className="row g-3 mb-3">
              <div className="col-12">
                <CreditsValueTierChart rows={rows} />
              </div>
            </div>

            <div className="row g-3">
              <div className="col-xl-4 col-lg-6">
                <CreditsTopList
                  title={t('creditsDashboard.topChats', { defaultValue: 'Top 5 chats' })}
                  icon="bi-chat-dots"
                  items={topChats}
                  emptyText={t('creditsDashboard.noChats', { defaultValue: 'No chat runs recorded yet.' })}
                  onSelect={(id) => openRun(id, 'creditsDashboard.drillChat', 'Chat run {{id}}')}
                />
              </div>
              <div className="col-xl-4 col-lg-6">
                <CreditsTopList
                  title={t('creditsDashboard.topAgents', { defaultValue: 'Top 5 agents' })}
                  icon="bi-robot"
                  items={topAgents}
                  emptyText={t('creditsDashboard.noAgents', {
                    defaultValue: 'No agent runs recorded yet — populates once agents run.',
                  })}
                  onSelect={(id) =>
                    setDrill({
                      title: t('creditsDashboard.drillAgentName', {
                        defaultValue: 'Agent: {{name}}',
                        name: agentName(id),
                      }),
                      rows: rows.filter((r) => r.agentId === id),
                    })
                  }
                />
              </div>
              <div className="col-xl-4 col-lg-6">
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
          </div>
        </Tab>
        <Tab eventKey="work" title={t('creditsDashboard.tabWork', { defaultValue: 'Work delivered' })}>
          <div className="pt-3">
            <CreditsWorkDelivered rows={rows} totalCredits={usedThisMonth} who={who} />
          </div>
        </Tab>
        <Tab eventKey="topups" title={t('creditsDashboard.tabTopups', { defaultValue: 'Top-ups' })}>
          <div className="pt-3">
            <CreditsTopupActivity txns={balance?.txns ?? []} />
          </div>
        </Tab>
      </Tabs>

      <CreditsDrillModal
        show={drill !== null}
        title={drill?.title ?? ''}
        rows={drill?.rows ?? []}
        userMap={userMap}
        onHide={() => setDrill(null)}
      />
    </div>
  );
};

export default CreditsDashboardPanel;
