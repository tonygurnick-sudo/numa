import { useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { Check, Users } from 'lucide-react';
import type { TFunction } from 'i18next';

type UserChoiceCardProps = {
  /** Currently in user-choice mode (preferred_method === null). */
  isActive: boolean;
  t: TFunction;
  /** Toggle into / out of user-choice mode. Called with the new desired
   *  state. Should optimistically update local state before awaiting the
   *  network call so the card responds in the same React tick. */
  onToggle: (next: boolean) => Promise<void> | void;
};

/**
 * Third option in the Manage modal's Connection method section. When active,
 * neither Pipedream nor native is forced as the default — users see both
 * options when they connect. Visually matches `ManageMethodCard` so all three
 * options sit naturally in the same column.
 */
export const UserChoiceCard = ({ isActive, t, onToggle }: UserChoiceCardProps) => {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await onToggle(!isActive);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`border rounded-3 p-3 ${isActive ? 'border-primary bg-primary bg-opacity-10' : 'bg-white'}`}>
      <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
        <div className="d-flex align-items-center gap-2">
          <span
            className="badge bg-info-subtle text-info-emphasis border border-info-subtle d-inline-flex align-items-center"
            style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              gap: '0.3rem',
              fontWeight: 500,
              letterSpacing: '0.01em',
              lineHeight: 1.2,
              verticalAlign: 'middle',
            }}
          >
            <Users size={11} strokeWidth={2.25} aria-hidden style={{ flexShrink: 0 }} />
            {t('manage.method.userChoiceBadge', { defaultValue: 'User choice' })}
          </span>
          <strong>{t('manage.method.userChoiceHeading', { defaultValue: 'Let users pick' })}</strong>
          {isActive && (
            <span className="text-primary small d-inline-flex align-items-center gap-1 ms-1">
              <Check size={14} />
              {t('manage.method.active', { defaultValue: 'Active' })}
            </span>
          )}
        </div>
      </div>
      <p className="small text-muted mb-2">
        {t('manage.method.userChoiceBody', {
          defaultValue:
            'Users see both connection options at connect time and pick the one that fits them. No method is forced as the default.',
        })}
      </p>

      <div className="d-flex gap-2">
        {!isActive && (
          <Button variant="primary" size="sm" onClick={() => void handleClick()} disabled={busy}>
            {busy ? <Spinner size="sm" /> : t('manage.method.useThis', { defaultValue: 'Use this method' })}
          </Button>
        )}
      </div>
    </div>
  );
};
