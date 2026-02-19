import React, { useState } from 'react';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import * as OpsService from '../../../Services/OpsService';
import type { TicketLink, TicketLinkType } from '../../../types/ops';

interface LinkedTicketsSectionProps {
  ticketId: string;
  links: TicketLink[];
  onRefresh: () => void;
}

const LINK_TYPES: TicketLinkType[] = ['blocks', 'depends_on', 'related_to'];

/**
 * Displays grouped ticket links (blocks, depends on, related to) with the ability
 * to add new links by display ID and remove existing links.
 * Links are grouped by type with translated section headers.
 */
export function LinkedTicketsSection({ ticketId, links, onRefresh }: LinkedTicketsSectionProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost, numaDelete } = useNumaRequest();

  const [showAddForm, setShowAddForm] = useState(false);
  const [addLinkType, setAddLinkType] = useState<TicketLinkType>('related_to');
  const [addDisplayId, setAddDisplayId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // Group links by type
  const groupedLinks: Record<TicketLinkType, TicketLink[]> = {
    blocks: [],
    depends_on: [],
    related_to: [],
  };
  for (const link of links) {
    if (groupedLinks[link.linkType]) {
      groupedLinks[link.linkType].push(link);
    }
  }

  const handleAdd = async () => {
    const trimmed = addDisplayId.trim();
    if (!trimmed) return;

    setAddLoading(true);
    setAddError(null);

    try {
      // Look up the ticket by display ID to get the internal ID
      const ticketResponse = await OpsService.getTicketByDisplayId(numaGet, trimmed);
      if (!ticketResponse?.ticket?.id) {
        setAddError(t('linkedTickets.notFound'));
        setAddLoading(false);
        return;
      }

      await OpsService.createLink(numaPost, ticketId, {
        linkedTicketId: ticketResponse.ticket.id,
        linkedTicketDisplayId: ticketResponse.ticket.displayId,
        linkedTicketTitle: ticketResponse.ticket.title,
        linkType: addLinkType,
      });

      setAddDisplayId('');
      setShowAddForm(false);
      setAddError(null);
      onRefresh();
    } catch (err) {
      console.error('[LinkedTicketsSection] Failed to add link', err);
      setAddError(t('linkedTickets.lookupFailed'));
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemove = async (linkType: TicketLinkType, linkedTicketId: string) => {
    try {
      await OpsService.deleteLink(numaDelete, ticketId, linkType, linkedTicketId);
      onRefresh();
    } catch (err) {
      console.error('[LinkedTicketsSection] Failed to remove link', err);
    }
  };

  const hasLinks = links.length > 0;

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <span className="fw-semibold small">{t('tickets.links')}</span>
        <Button variant="outline-primary" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? t('common.cancel') : t('linkedTickets.addLink')}
        </Button>
      </div>

      {/* Add link form */}
      {showAddForm && (
        <div className="border rounded p-2 mb-3 bg-light">
          <div className="d-flex gap-2 align-items-end flex-wrap">
            <Form.Group style={{ minWidth: 140 }}>
              <Form.Label className="small mb-1">{t('linkedTickets.linkType')}</Form.Label>
              <Form.Select
                size="sm"
                value={addLinkType}
                onChange={(e) => setAddLinkType(e.target.value as TicketLinkType)}
              >
                {LINK_TYPES.map((lt) => (
                  <option key={lt} value={lt}>
                    {t(`linkTypes.${lt}`)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group className="flex-grow-1">
              <Form.Label className="small mb-1">{t('linkedTickets.ticketDisplayId')}</Form.Label>
              <Form.Control
                size="sm"
                type="text"
                placeholder={t('linkedTickets.ticketDisplayIdPlaceholder')}
                value={addDisplayId}
                onChange={(e) => {
                  setAddDisplayId(e.target.value);
                  setAddError(null);
                }}
              />
            </Form.Group>

            <Button
              size="sm"
              variant="primary"
              disabled={!addDisplayId.trim() || addLoading}
              onClick={() => void handleAdd()}
              className="align-self-end"
            >
              {addLoading ? <Spinner animation="border" size="sm" /> : t('common.add')}
            </Button>
          </div>
          {addError && <div className="text-danger small mt-1">{addError}</div>}
        </div>
      )}

      {/* Links grouped by type */}
      {!hasLinks ? (
        <p className="text-muted small">{t('empty.noLinks')}</p>
      ) : (
        <div>
          {LINK_TYPES.map((linkType) => {
            const typeLinks = groupedLinks[linkType];
            if (typeLinks.length === 0) return null;

            return (
              <div key={linkType} className="mb-2">
                <div className="text-muted small fw-semibold mb-1">{t(`linkTypes.${linkType}`)}</div>
                {typeLinks.map((link) => (
                  <div
                    key={`${link.linkType}-${link.linkedTicketId}`}
                    className="d-flex align-items-center gap-2 mb-1 ps-2"
                  >
                    <Badge bg="light" text="dark" className="border" style={{ fontFamily: 'monospace', flexShrink: 0 }}>
                      {link.linkedTicketDisplayId}
                    </Badge>
                    {link.linkedTicketTitle && (
                      <span className="text-truncate" style={{ fontSize: '0.8rem' }} title={link.linkedTicketTitle}>
                        {link.linkedTicketTitle}
                      </span>
                    )}
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 ms-auto text-muted"
                      onClick={() => void handleRemove(link.linkType, link.linkedTicketId)}
                      title={t('common.remove')}
                    >
                      <i className="bi bi-x-lg" style={{ fontSize: '0.75rem' }} />
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
