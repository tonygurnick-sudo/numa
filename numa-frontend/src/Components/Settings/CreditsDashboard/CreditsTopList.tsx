import React from 'react';
import { useTranslation } from 'react-i18next';
import { fmtCredits } from './helpers';
import { TierBadge } from './TierBadge';

export interface TopListItem {
  /** stable key + the value passed to onSelect (conversationId / category / userSub). */
  id: string;
  /** main label — an anonymised run title or an email. NEVER a raw chat/agent name. */
  primary: string;
  /** sub label — timestamp · who / run count. */
  secondary?: string;
  /** credits consumed (drives ranking + the mini bar). */
  value: number;
  /** optional value-tier → renders a tonal {@link TierBadge}. */
  tier?: string;
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
    <div className="credits-card credits-card--hover">
      <div className="credits-card__header">
        <i className={`bi ${icon}`} aria-hidden="true" />
        <span className="credits-card__title">{title}</span>
      </div>
      <div className="credits-card__body credits-card__body--flush">
        {items.length === 0 ? (
          <div className="credits-empty">
            <span className="credits-empty__text">{emptyText}</span>
          </div>
        ) : (
          <div className="credits-toplist">
            {items.map((item, idx) => {
              const select = onSelect ? () => onSelect(item.id) : undefined;
              return (
                <div
                  key={item.id}
                  className={`credits-toplist__item ${onSelect ? 'credits-toplist__item--action' : ''}`}
                  role={onSelect ? 'button' : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                  onClick={select}
                  onKeyDown={
                    select
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            select();
                          }
                        }
                      : undefined
                  }
                >
                  <span className="credits-toplist__rank">{idx + 1}</span>
                  <div className="credits-toplist__main">
                    <div className="credits-toplist__primary-row">
                      <span className="credits-toplist__primary">{item.primary}</span>
                      {item.copyValue ? (
                        <button
                          type="button"
                          className="credits-copy-btn"
                          onClick={(e) => copy(e, item.copyValue as string)}
                          title={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                          aria-label={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                        >
                          <i className="bi bi-clipboard" aria-hidden="true" />
                        </button>
                      ) : null}
                      {item.tier ? <TierBadge tier={item.tier} /> : null}
                    </div>
                    {item.secondary ? <div className="credits-toplist__secondary">{item.secondary}</div> : null}
                    <div className="credits-toplist__bar">
                      <div
                        className="credits-toplist__bar-fill"
                        style={{ width: `${max > 0 ? Math.round((item.value / max) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="credits-toplist__value">
                    <div className="credits-toplist__value-num">{fmtCredits(item.value)}</div>
                    <div className="credits-toplist__value-unit">
                      {t('creditsDashboard.creditsUnit', { defaultValue: 'credits' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditsTopList;
