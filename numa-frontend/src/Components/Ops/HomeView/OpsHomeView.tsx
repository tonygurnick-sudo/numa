import { useState, useEffect, useMemo } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Customer, MetricsResponse, StatusType, Supplier } from '../../../types/ops';
import { getCached, setCache } from '../../../utils/opsCache';

// ─── Props ──────────────────────────────────────────────────────────────────

interface OpsHomeViewProps {
  onCreateBoard: () => void;
  onCreateCustomer: () => void;
  onCreateSupplier: () => void;
  onOpenGlobalSettings: (defaultTab?: string) => void;
  onOpenBoardSettings: (boardId: string) => void;
  onNavigateToBoard: (boardId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const OPEN_STATUSES: StatusType[] = ['backlog', 'scoped', 'queued', 'active'];
const CLOSED_STATUSES: StatusType[] = ['completed', 'ended'];

function sumCounts(counts: Record<StatusType, number>, statuses: StatusType[]): number {
  return statuses.reduce((acc, s) => acc + (counts[s] ?? 0), 0);
}

// ─── Configuration card definitions ─────────────────────────────────────────

const CONFIG_CARDS: { key: string; icon: string; labelKey: string }[] = [
  { key: 'ticketTypes', icon: 'bi-tag', labelKey: 'home.ticketTypes' },
  { key: 'projects', icon: 'bi-folder', labelKey: 'home.projects' },
  { key: 'staff', icon: 'bi-person-badge', labelKey: 'home.staff' },
  { key: 'fields', icon: 'bi-input-cursor', labelKey: 'home.fields' },
  { key: 'crmConfig', icon: 'bi-diagram-3', labelKey: 'home.crmConfig' },
  { key: 'supplierConfig', icon: 'bi-truck', labelKey: 'home.supplierConfig' },
  { key: 'linkConfig', icon: 'bi-link-45deg', labelKey: 'home.linkConfig' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export const OpsHomeView = ({
  onCreateBoard,
  onCreateCustomer,
  onCreateSupplier,
  onOpenGlobalSettings,
  onOpenBoardSettings,
  onNavigateToBoard,
}: OpsHomeViewProps) => {
  const { t } = useTranslation('ops');
  const { numaGet } = useNumaRequest();
  const { teams } = useOps();

  // ── Local data (initialized from cache for instant render) ─────────────
  const [metrics, setMetrics] = useState<MetricsResponse | null>(() => getCached('metrics'));
  const [customerCount, setCustomerCount] = useState<number>(() => getCached<Customer[]>('customers')?.length ?? 0);
  const [supplierCount, setSupplierCount] = useState<number>(() => getCached<Supplier[]>('suppliers')?.length ?? 0);
  const [loading, setLoading] = useState(
    () => !getCached('metrics') && !getCached('customers') && !getCached('suppliers')
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [metricsData, customerList, supplierList] = await Promise.all([
          OpsService.getMetrics(numaGet).catch(() => null),
          OpsService.listCustomers(numaGet).catch(() => []),
          OpsService.listSuppliers(numaGet).catch(() => []),
        ]);
        if (!cancelled) {
          setMetrics(metricsData);
          if (metricsData) setCache('metrics', metricsData);
          setCustomerCount(customerList.length);
          if (customerList.length > 0) setCache('customers', customerList);
          setSupplierCount(supplierList.length);
          if (supplierList.length > 0) setCache('suppliers', supplierList);
        }
      } catch (err) {
        console.error('[OpsHomeView] Failed to load dashboard data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  // ── Derived data ────────────────────────────────────────────────────────
  const teamMetricsMap = useMemo(() => {
    const map = new Map<string, { open: number; closed: number }>();
    if (metrics?.teams) {
      for (const tm of metrics.teams) {
        map.set(tm.teamId, {
          open: sumCounts(tm.counts, OPEN_STATUSES),
          closed: sumCounts(tm.counts, CLOSED_STATUSES),
        });
      }
    }
    return map;
  }, [metrics]);

  // ── Loading state ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center py-5">
        <Spinner animation="border" />
        <p className="mt-3 text-muted">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="p-4" style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* ── Hero Section ──────────────────────────────────────────────── */}
      <div className="text-center mb-4">
        <div
          className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
          style={{ width: 56, height: 56, backgroundColor: '#eef2ff' }}
        >
          <i className="bi bi-grid-3x3-gap fs-3" style={{ color: '#6366f1' }} />
        </div>
        <h4 className="fw-bold mb-1">{t('home.headline')}</h4>
        <p className="text-muted mb-0" style={{ maxWidth: 480, margin: '0 auto' }}>
          {t('home.subtitle')}
        </p>
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────── */}
      <h6
        className="text-muted text-uppercase fw-semibold mb-3"
        style={{ fontSize: '0.75rem', letterSpacing: '0.5px' }}
      >
        {t('home.quickActions')}
      </h6>
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <QuickActionCard
            icon="bi-people"
            iconColor="#6366f1"
            title={t('home.createBoard')}
            description={t('home.createBoardDesc')}
            onClick={onCreateBoard}
          />
        </div>
        <div className="col-md-4">
          <QuickActionCard
            icon="bi-person-lines-fill"
            iconColor="#0d9488"
            title={t('home.createCustomer')}
            description={t('home.createCustomerDesc')}
            onClick={onCreateCustomer}
          />
        </div>
        <div className="col-md-4">
          <QuickActionCard
            icon="bi-truck"
            iconColor="#d97706"
            title={t('home.createSupplier')}
            description={t('home.createSupplierDesc')}
            onClick={onCreateSupplier}
          />
        </div>
      </div>

      {/* ── Overview Stats ────────────────────────────────────────────── */}
      <h6
        className="text-muted text-uppercase fw-semibold mb-3"
        style={{ fontSize: '0.75rem', letterSpacing: '0.5px' }}
      >
        {t('home.overview')}
      </h6>
      <div className="d-flex gap-3 flex-wrap mb-4">
        <StatCard label={t('home.boardsCount')} value={teams.length} color="#6366f1" />
        <StatCard label={t('home.openTickets')} value={metrics?.totals?.open ?? 0} color="#f59e0b" />
        <StatCard label={t('home.closedTickets')} value={metrics?.totals?.closed ?? 0} color="#10b981" />
        <StatCard label={t('home.customersCount')} value={customerCount} color="#0d9488" />
        <StatCard label={t('home.suppliersCount')} value={supplierCount} color="#d97706" />
      </div>

      {/* ── Teams Section ─────────────────────────────────────────────── */}
      <h6
        className="text-muted text-uppercase fw-semibold mb-3"
        style={{ fontSize: '0.75rem', letterSpacing: '0.5px' }}
      >
        {t('home.yourBoards')}
      </h6>
      {teams.length === 0 ? (
        <div className="border rounded p-4 text-center text-muted mb-4">
          <i className="bi bi-kanban fs-3 d-block mb-2" />
          <span>{t('home.noBoardsYet')}</span>
        </div>
      ) : (
        <div className="row g-3 mb-4">
          {teams.map((team) => {
            const stats = teamMetricsMap.get(team.id);
            return (
              <div key={team.id} className="col-md-4">
                <div
                  className="border rounded p-3 h-100 d-flex flex-column"
                  style={{ borderTop: `3px solid ${team.color || '#6c757d'}` }}
                >
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span
                      className="d-inline-block rounded-circle flex-shrink-0"
                      style={{ width: 10, height: 10, backgroundColor: team.color || '#6c757d' }}
                    />
                    <span className="fw-semibold">{team.name}</span>
                  </div>

                  {stats ? (
                    <div className="d-flex gap-3 mb-3 small">
                      <span className="text-warning fw-medium">{t('home.open', { count: stats.open })}</span>
                      <span className="text-success fw-medium">{t('home.closed', { count: stats.closed })}</span>
                    </div>
                  ) : (
                    <div className="text-muted small mb-3">&mdash;</div>
                  )}

                  <div className="d-flex gap-2 mt-auto">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary flex-grow-1"
                      onClick={() => onOpenBoardSettings(team.id)}
                    >
                      <i className="bi bi-sliders me-1" />
                      {t('boards.settings')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary flex-grow-1"
                      onClick={() => onNavigateToBoard(team.id)}
                    >
                      <i className="bi bi-arrow-right me-1" />
                      {t('home.viewBoard')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Configuration Section ─────────────────────────────────────── */}
      <h6
        className="text-muted text-uppercase fw-semibold mb-3"
        style={{ fontSize: '0.75rem', letterSpacing: '0.5px' }}
      >
        {t('home.configuration')}
      </h6>
      <div className="d-flex flex-wrap gap-2 mb-4">
        {CONFIG_CARDS.map(({ key, icon, labelKey }) => (
          <button
            key={key}
            type="button"
            className="btn btn-outline-secondary d-flex align-items-center gap-2 px-3 py-2"
            style={{ fontSize: '0.85rem' }}
            onClick={() => onOpenGlobalSettings(key)}
          >
            <i className={`bi ${icon}`} />
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

interface QuickActionCardProps {
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  onClick: () => void;
}

const QuickActionCard = ({ icon, iconColor, title, description, onClick }: QuickActionCardProps) => (
  <div
    className="border rounded p-3 text-center h-100"
    style={{ cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s' }}
    onClick={onClick}
    onMouseEnter={(e) => {
      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
      e.currentTarget.style.borderColor = '#adb5bd';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.boxShadow = 'none';
      e.currentTarget.style.borderColor = '';
    }}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <div
      className="d-inline-flex align-items-center justify-content-center rounded-circle mb-2"
      style={{ width: 40, height: 40, backgroundColor: `${iconColor}15` }}
    >
      <i className={`bi ${icon}`} style={{ fontSize: '1.1rem', color: iconColor }} />
    </div>
    <div className="fw-semibold mb-1" style={{ fontSize: '0.9rem' }}>
      {title}
    </div>
    <div className="text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.4 }}>
      {description}
    </div>
  </div>
);

interface StatCardProps {
  label: string;
  value: number;
  color: string;
}

const StatCard = ({ label, value, color }: StatCardProps) => (
  <div
    className="border rounded p-3 text-center flex-grow-1"
    style={{ minWidth: 100, borderTop: `3px solid ${color}` }}
  >
    <div className="fw-bold fs-4" style={{ color }}>
      {value}
    </div>
    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
      {label}
    </div>
  </div>
);
