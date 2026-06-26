import { useMemo, useState } from 'react';
import { Form, Spinner } from 'react-bootstrap';
import type { SnapshotMetadata } from '@/types/fleetAnalytics';
import { fmtUSD0, isInternalClient, isRandDDevStack } from './shared';
import { useCurrency } from './currencyContext';

interface ClientSidebarProps {
  snapshots: SnapshotMetadata[];
  loading: boolean;
  selectedClientName: string | null;
  onSelect: (clientName: string) => void;
}

/**
 * Left rail listing the available snapshot rows. Three groups:
 *   1. All Stacks (synthetic `_FLEET` — derived in browser)
 *   2. Client Stacks (synthetic `_CLIENTS` — non-dev only)
 *   3. Per-client rows, sorted by CE spend desc, with a DEV badge.
 *
 * The aggregate rows are SYNTHETIC — there's no backing DDB item. The
 * dashboard page renders them by computing aggregateSnapshots() over the
 * loaded per-client snapshots when one of these keys is selected.
 */
export function ClientSidebar({ snapshots, loading, selectedClientName, onSelect }: ClientSidebarProps) {
  useCurrency();
  const [filter, setFilter] = useState('');
  // Dev R&D section is collapsed by default — these are internal demos /
  // engineering stacks, not customer-facing. Operators expand it when they
  // need to inspect them.
  const [devOpen, setDevOpen] = useState(false);

  const perClient = useMemo(
    () =>
      snapshots
        .filter((s) => !s.clientName.startsWith('_'))
        .slice()
        .sort((a, b) => b.ce_total - a.ce_total),
    [snapshots]
  );
  // Three groups: R&D dev (collapsed), Internal (just hq), Customer clients.
  // isRandDDevStack returns false for hq (so it doesn't end up in dev R&D).
  // isInternalClient identifies hq specifically so we can pull it out of the
  // customer Clients list and surface separately.
  const devStacks = useMemo(() => perClient.filter((s) => isRandDDevStack(s.clientName, s.dev_instance)), [perClient]);
  const internalStacks = useMemo(() => perClient.filter((s) => isInternalClient(s.clientName)), [perClient]);
  const clientStacks = useMemo(
    () => perClient.filter((s) => !isRandDDevStack(s.clientName, s.dev_instance) && !isInternalClient(s.clientName)),
    [perClient]
  );
  const allStackCount = perClient.length;
  const clientStackCount = clientStacks.length;
  const nextgenCount = useMemo(() => perClient.filter((s) => s.account_org === 'nextgen').length, [perClient]);
  const standaloneCount = useMemo(() => perClient.filter((s) => s.account_org === 'standalone').length, [perClient]);
  // Arcanum-owned = everything Arcanum pays the AWS bill for (HQ + dev + all
  // NextGen), i.e. not customer-owned standalone accounts.
  const arcanumCount = useMemo(() => perClient.filter((s) => s.account_org !== 'standalone').length, [perClient]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return null;
    const f = filter.trim().toLowerCase();
    return perClient.filter((s) => s.clientName.toLowerCase().includes(f));
  }, [perClient, filter]);

  const formatGenerated = (iso?: string) => {
    if (!iso) return '';
    try {
      const date = new Date(iso);
      const diffMs = Date.now() - date.getTime();
      const mins = Math.floor(diffMs / 60_000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    } catch {
      return '';
    }
  };

  const renderRow = (s: SnapshotMetadata) => {
    const active = s.clientName === selectedClientName;
    // Show DEV badge only on real R&D stacks — hq is dev_instance:true but we
    // treat it as a real client deployment elsewhere, so don't badge it.
    const showDevBadge = isRandDDevStack(s.clientName, s.dev_instance);
    return (
      <button
        key={s.clientName}
        type="button"
        className={
          'nd-sidebar-row text-start px-3 py-2 border-0 bg-transparent w-100 d-flex align-items-start ' +
          (active ? 'nd-sidebar-row-active' : '')
        }
        onClick={() => onSelect(s.clientName)}
      >
        <div className="flex-grow-1 me-2">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-semibold" style={{ fontSize: '0.9rem' }}>
              {s.clientName}
            </span>
            {showDevBadge && (
              <span
                className="badge bg-warning-subtle text-warning"
                style={{ fontSize: '0.65rem', padding: '2px 6px' }}
              >
                DEV
              </span>
            )}
          </div>
          <div className="text-muted" style={{ fontSize: '0.72rem', marginTop: 1 }}>
            {s.ce_total != null && s.ce_total > 0 ? `${fmtUSD0(s.ce_total)} CE` : ''}
            {s.chat_cost != null && s.chat_cost > 0 ? ` · ${fmtUSD0(s.chat_cost)} chat` : ''}
            {s.generated_at ? ` · ${formatGenerated(s.generated_at)}` : ''}
          </div>
        </div>
      </button>
    );
  };

  const renderAggregateRow = (key: string, label: string, stackCount: number) => {
    const active = key === selectedClientName;
    return (
      <button
        key={key}
        type="button"
        className={
          'nd-sidebar-row text-start px-3 py-2 border-0 bg-transparent w-100 d-flex align-items-start ' +
          (active ? 'nd-sidebar-row-active' : '')
        }
        onClick={() => onSelect(key)}
      >
        <div className="flex-grow-1 me-2">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-semibold" style={{ fontSize: '0.9rem' }}>
              {label}
            </span>
            <span className="badge bg-primary-subtle text-primary" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
              {stackCount} stacks
            </span>
          </div>
          <div className="text-muted" style={{ fontSize: '0.72rem', marginTop: 1 }}>
            derived in browser
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="nd-sidebar d-flex flex-column">
      <div className="px-3 py-2 border-bottom">
        <Form.Control
          type="search"
          size="sm"
          placeholder="Filter clients…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="nd-sidebar-section-header">Aggregate</div>
      {renderAggregateRow('_FLEET', 'All Stacks', allStackCount)}
      {renderAggregateRow('_CLIENTS', 'Client Stacks', clientStackCount)}
      {arcanumCount > 0 && renderAggregateRow('_ARCANUM', 'Arcanum Spend', arcanumCount)}
      {nextgenCount > 0 && renderAggregateRow('_NEXTGEN', 'NextGen Clients', nextgenCount)}
      {standaloneCount > 0 && renderAggregateRow('_STANDALONE', 'Standalone Clients', standaloneCount)}

      {/* When the user is filtering, flatten the sections — they want a
          search result, not navigation. Otherwise show the standard split:
          Dev R&D (collapsed by default) above the Clients list. */}
      {filtered !== null ? (
        <>
          <div className="nd-sidebar-section-header mt-2">Matches ({filtered.length})</div>
          {loading && filtered.length === 0 && (
            <div className="text-center py-3">
              <Spinner animation="border" size="sm" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-muted px-3 py-2" style={{ fontSize: '0.8rem' }}>
              No matches.
            </div>
          )}
          {filtered.map((s) => renderRow(s))}
        </>
      ) : (
        <>
          {devStacks.length > 0 && (
            <>
              <button
                type="button"
                className="nd-sidebar-section-header mt-2 d-flex align-items-center justify-content-between border-0 bg-transparent w-100"
                onClick={() => setDevOpen((o) => !o)}
                style={{ cursor: 'pointer' }}
                title="Internal R&D / demo / quota-sharing accounts. Not customer-facing."
              >
                <span>Dev Accounts ({devStacks.length})</span>
                <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{devOpen ? '▼' : '▶'}</span>
              </button>
              {devOpen && devStacks.map((s) => renderRow(s))}
            </>
          )}

          {internalStacks.length > 0 && (
            <>
              <div
                className="nd-sidebar-section-header mt-2"
                title="Arcanum's own Numa deployment (dogfooding). Excluded from the Client Stacks aggregate."
              >
                Internal ({internalStacks.length})
              </div>
              {internalStacks.map((s) => renderRow(s))}
            </>
          )}

          <div className="nd-sidebar-section-header mt-2">
            Clients {clientStacks.length > 0 ? `(${clientStacks.length})` : ''}
          </div>
          {loading && clientStacks.length === 0 && (
            <div className="text-center py-3">
              <Spinner animation="border" size="sm" />
            </div>
          )}
          {!loading && clientStacks.length === 0 && (
            <div className="text-muted px-3 py-2" style={{ fontSize: '0.8rem' }}>
              No client snapshots yet.
            </div>
          )}
          {clientStacks.map((s) => renderRow(s))}
        </>
      )}
    </div>
  );
}
