import React from 'react';
import { Modal, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '../../../types/ops';

// ─── Props ──────────────────────────────────────────────────────────────────

interface TicketSuccessModalProps {
  show: boolean;
  ticket: Ticket | null;
  onHide: () => void;
  onViewOnBoard: () => void;
  onOpenTicket: () => void;
  onCreateAnother: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * TicketSuccessModal is displayed after a ticket has been successfully created.
 * It shows a green checkmark, the ticket display ID (e.g. "BUG-001"), the
 * ticket title, and three action buttons so the user can navigate to the
 * board, open the new ticket, or immediately create another ticket.
 */
export function TicketSuccessModal({
  show,
  ticket,
  onHide,
  onViewOnBoard,
  onOpenTicket,
  onCreateAnother,
}: TicketSuccessModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  return (
    <Modal show={show} onHide={onHide} centered size="sm">
      <Modal.Header closeButton>
        <Modal.Title>{t('success.ticketCreated')}</Modal.Title>
      </Modal.Header>

      <Modal.Body className="text-center py-4">
        {/* Green checkmark icon */}
        <div className="mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="#198754" viewBox="0 0 16 16">
            <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z" />
          </svg>
        </div>

        {/* Ticket display ID in monospace */}
        {ticket && (
          <>
            <div className="mb-2">
              <code className="fs-5">{ticket.displayId}</code>
            </div>
            <div className="text-muted">{ticket.title}</div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer className="d-flex justify-content-center gap-2 flex-wrap">
        <Button variant="outline-primary" size="sm" onClick={onViewOnBoard}>
          {t('common.viewOnBoard')}
        </Button>
        <Button variant="outline-primary" size="sm" onClick={onOpenTicket}>
          {t('common.openTicket')}
        </Button>
        <Button variant="primary" size="sm" onClick={onCreateAnother}>
          {t('common.createAnother')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
