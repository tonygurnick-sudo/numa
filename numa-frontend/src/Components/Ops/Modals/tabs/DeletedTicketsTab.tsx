import { useState, useEffect, useCallback } from 'react';
import { Spinner, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../../Providers/NumaRequestContext';
import { useOps } from '../../OpsContext';
import * as OpsService from '../../../../Services/OpsService';
import { getTicketTypeIconClass } from '../../../../constants/opsConstants';
import { formatRelativeDate } from '../../Shared/ticketUtils';
import type { Ticket } from '../../../../types/ops';

interface DeletedTicketsTabProps {
  boardId: string;
}

/**
 * Trash for a board (BUG-369). Lists soft-deleted tickets and restores them.
 * Lives in Board Settings, which is already admin/owner-gated; the backend also
 * only returns deleted tickets to an admin/owner (includeDeleted).
 */
export function DeletedTicketsTab({ boardId }: DeletedTicketsTabProps) {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost } = useNumaRequest();
  const { config, refreshTickets } = useOps();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await OpsService.listTickets(numaGet, { boardId, includeDeleted: true, statusType: 'deleted' });
      setTickets(res.tickets);
    } catch (err) {
      console.error('[DeletedTicketsTab] load failed', err);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [boardId, numaGet]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = useCallback(
    async (ticket: Ticket) => {
      setRestoringId(ticket.id);
      try {
        await OpsService.restoreTicket(numaPost, ticket.id, boardId);
        setTickets((prev) => prev.filter((tk) => tk.id !== ticket.id));
        void refreshTickets();
      } catch (err) {
        console.error('[DeletedTicketsTab] restore failed', err);
      } finally {
        setRestoringId(null);
      }
    },
    [numaPost, boardId, refreshTickets]
  );

  const staffName = (sub?: string | null): string | null =>
    sub ? ((config?.staff ?? []).find((m) => m.id === sub)?.name ?? null) : null;

  const typeIcon = (ticketTypeId: string): { icon: string; color?: string } => {
    const tt = (config?.ticketTypes ?? []).find((x) => x.id === ticketTypeId);
    return { icon: tt?.icon ?? 'bi-card-text', color: tt?.color };
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center py-5">
        <Spinner animation="border" size="sm" className="me-2" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="text-center text-muted py-5">
        <i className="bi bi-trash d-block mb-2" style={{ fontSize: '1.5rem', opacity: 0.5 }} />
        {t('deletedTab.empty')}
      </div>
    );
  }

  return (
    <div>
      <p className="text-muted small mb-3">{t('deletedTab.description')}</p>
      <div className="d-flex flex-column gap-2">
        {tickets.map((tk) => {
          const who = staffName(tk.deletedBy);
          const { icon, color } = typeIcon(tk.ticketTypeId);
          return (
            <div key={tk.id} className="d-flex align-items-center gap-3 p-2 border rounded">
              <i className={getTicketTypeIconClass(icon)} style={{ color: color ?? '#6c757d' }} />
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted small flex-shrink-0">{tk.displayId}</span>
                  <span className="text-truncate">{tk.title}</span>
                </div>
                {tk.deletedAt && (
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {t('deletedTab.deletedMeta', {
                      when: formatRelativeDate(tk.deletedAt),
                      who: who ?? t('deletedTab.someone'),
                    })}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline-secondary"
                className="flex-shrink-0"
                disabled={restoringId === tk.id}
                onClick={() => void handleRestore(tk)}
              >
                <i className="bi bi-arrow-counterclockwise me-1" />
                {t('deleted.restore')}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
