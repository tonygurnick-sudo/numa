import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateTicketModal } from './Modals/CreateTicketModal';
import { TicketSuccessModal } from './Modals/TicketSuccessModal';
import { TicketDetailModal } from './Modals/TicketDetailModal';
import type { Ticket } from '../../types/ops';
import './BoardView/kanban.css';

/**
 * Floating Action Button for quick ticket creation on the Ops page.
 * Shows a small popup menu with action options (currently "New Ticket").
 * Provides quick access when scrolled down or on mobile.
 */
const OpsFab = () => {
  const { t } = useTranslation('ops');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [showTicketSuccess, setShowTicketSuccess] = useState(false);
  const [showTicketDetail, setShowTicketDetail] = useState(false);
  const [successTicket, setSuccessTicket] = useState<Ticket | null>(null);
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
  const fabRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen, closeMenu]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [menuOpen, closeMenu]);

  return (
    <>
      <div ref={fabRef}>
        {/* Popup menu */}
        {menuOpen && (
          <div className="ops-fab-menu" role="menu">
            <button
              type="button"
              className="ops-fab-menu-item"
              role="menuitem"
              onClick={() => {
                closeMenu();
                setShowCreateTicket(true);
              }}
            >
              <i className="bi bi-ticket-perforated" />
              {t('tickets.newTicket')}
            </button>
          </div>
        )}

        {/* FAB button */}
        <button
          type="button"
          className="ops-fab"
          onClick={() => setMenuOpen((prev) => !prev)}
          title={t('fab.quickCreate')}
          aria-label={t('fab.quickCreate')}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <i className={`bi ${menuOpen ? 'bi-x-lg' : 'bi-plus-lg'}`} />
        </button>
      </div>

      {/* Modals */}
      <CreateTicketModal
        show={showCreateTicket}
        onHide={() => setShowCreateTicket(false)}
        onSuccess={(ticket) => {
          setShowCreateTicket(false);
          setSuccessTicket(ticket);
          setShowTicketSuccess(true);
        }}
      />
      <TicketSuccessModal
        show={showTicketSuccess}
        ticket={successTicket}
        onHide={() => setShowTicketSuccess(false)}
        onViewOnBoard={() => setShowTicketSuccess(false)}
        onOpenTicket={() => {
          setShowTicketSuccess(false);
          if (successTicket) {
            setDetailTicketId(successTicket.id);
            setShowTicketDetail(true);
          }
        }}
        onCreateAnother={() => {
          setShowTicketSuccess(false);
          setShowCreateTicket(true);
        }}
      />
      <TicketDetailModal
        show={showTicketDetail}
        ticketId={detailTicketId}
        onHide={() => {
          setShowTicketDetail(false);
          setDetailTicketId(null);
        }}
      />
    </>
  );
};

export default OpsFab;
