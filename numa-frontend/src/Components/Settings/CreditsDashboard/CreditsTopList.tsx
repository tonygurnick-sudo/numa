import React from 'react';
import { Badge, Button, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { fmtCredits } from './helpers';

export interface TopListItem {
  /** stable key + the value passed to onSelect (conversationId / category / userSub). */
  id: string;
  /** main label — a UUID (short), email, or category. NEVER a chat/agent name. */
  primary: string;
  /** sub label — timestamp / run count / owner. */
  secondary?: string;
  /** credits consumed (drives ranking + the mini bar). */
  value: number;
  /** optional complexity badge. */
  badge?: { text: string; bg: string };
  /** full value behind a copy button (e.g. the full UUID). */
  copyValue?: string;
}

interface Props {
  title: string;
  icon: string;
  items: TopListItem[];
  emptyText: string;
  onSelect?: (id: string) => void;
}

/** Reusable ranked "Top 5" card. Privacy-safe: it only renders what the caller
 *  passes in (UUIDs/emails/categories), never chat or agent names. */
export const CreditsTopList: React.FC<Props> = ({ title, icon, items, emptyText, onSelect }) => {
  const { t } = useTranslation('settings');
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);

  const copy = (e: React.MouseEvent, text: string): void => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text);
  };

  return (
    <Card className="h-100">
      <Card.Header className="fw-semibold">
        <i className={`bi ${icon} me-2`} aria-hidden="true" />
        {title}
      </Card.Header>
      <Card.Body className="p-0">
        {items.length === 0 ? (
          <div className="text-muted text-center py-4">{emptyText}</div>
        ) : (
          <div className="list-group list-group-flush">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className={`list-group-item ${onSelect ? 'list-group-item-action' : ''}`}
                role={onSelect ? 'button' : undefined}
                onClick={onSelect ? () => onSelect(item.id) : undefined}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="badge bg-light text-dark border flex-shrink-0">{idx + 1}</span>
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center gap-2">
                      <span className="fw-semibold text-truncate font-monospace">{item.primary}</span>
                      {item.copyValue ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 lh-1 text-muted flex-shrink-0"
                          onClick={(e) => copy(e, item.copyValue as string)}
                          title={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                          aria-label={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                        >
                          <i className="bi bi-clipboard" aria-hidden="true" />
                        </Button>
                      ) : null}
                      {item.badge ? <Badge bg={item.badge.bg}>{item.badge.text}</Badge> : null}
                    </div>
                    {item.secondary ? <div className="small text-muted text-truncate">{item.secondary}</div> : null}
                    <div className="progress mt-1" style={{ height: 4 }}>
                      <div
                        className="progress-bar"
                        role="progressbar"
                        aria-valuenow={item.value}
                        style={{ width: `${max > 0 ? Math.round((item.value / max) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-end flex-shrink-0">
                    <div className="fw-semibold font-monospace">{fmtCredits(item.value)}</div>
                    <div className="small text-muted">
                      {t('creditsDashboard.creditsUnit', { defaultValue: 'credits' })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default CreditsTopList;
