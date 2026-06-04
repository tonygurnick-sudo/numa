import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditLedgerRow } from '../../../Services/AdminCreditsService';
import { fmtCredits, fmtDuration, fmtTimestamp, sourceLabel } from './helpers';
import { TierBadge } from './TierBadge';

interface Props {
  rows: CreditLedgerRow[];
  totalCredits: number;
  who: (sub: string | null) => string;
}

/**
 * "This month — work delivered": the anonymised value receipt (title · who · when · duration · value ·
 * credits). Title + deliverables are filled by the nightly summariser; until then a placeholder shows
 * alongside the live tier/credits/duration. Deliberately shows NO cost or chat content (privacy).
 */
export const CreditsWorkDelivered: React.FC<Props> = ({ rows, totalCredits, who }) => {
  const { t } = useTranslation('settings');

  return (
    <div className="credits-card">
      <div className="credits-card__header">
        <i className="bi bi-receipt" aria-hidden="true" />
        <span className="credits-card__title">
          {t('credits.ledgerTitle', { defaultValue: 'This month — work delivered' })}
        </span>
        <span className="credits-card__header-end">
          <span className="credits-live-chip">
            {t('credits.totalThisMonthFmt', { defaultValue: '{{total}} credits', total: fmtCredits(totalCredits) })}
          </span>
        </span>
      </div>
      <div className="credits-card__body credits-card__body--flush">
        {rows.length === 0 ? (
          <div className="credits-empty">
            <i className="bi bi-inbox credits-empty__icon" aria-hidden="true" />
            <span className="credits-empty__text">
              {t('credits.empty', { defaultValue: 'No activity recorded this month yet.' })}
            </span>
          </div>
        ) : (
          <div className="credits-table-wrap">
            <table className="credits-table">
              <thead>
                <tr>
                  <th>{t('credits.colTitle', { defaultValue: 'What was done' })}</th>
                  <th>{t('credits.colBy', { defaultValue: 'By' })}</th>
                  <th>{t('credits.colWhen', { defaultValue: 'When' })}</th>
                  <th>{t('credits.colDuration', { defaultValue: 'Duration' })}</th>
                  <th>{t('credits.colTier', { defaultValue: 'Value' })}</th>
                  <th className="text-end">{t('credits.colCredits', { defaultValue: 'Credits' })}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.conversationId}>
                    <td>
                      {row.title ? (
                        <div className="credits-table__title">{row.title}</div>
                      ) : (
                        <div className="text-muted fst-italic">
                          {t('credits.summaryPending', { defaultValue: 'Anonymised summary coming overnight' })}
                        </div>
                      )}
                      {row.deliverables && row.deliverables.length > 0 && (
                        <ul className="credits-table__deliverables">
                          {row.deliverables.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      )}
                      <div className="credits-table__meta">{sourceLabel(row.source, t)}</div>
                    </td>
                    <td className="text-nowrap">{who(row.userSub)}</td>
                    <td className="text-muted text-nowrap">{fmtTimestamp(row.lastTs)}</td>
                    <td className="text-muted text-nowrap">{fmtDuration(row.firstTs, row.lastTs, t)}</td>
                    <td>
                      <TierBadge tier={row.dominantTier} />
                    </td>
                    <td className="text-end credits-table__num">{fmtCredits(row.creditsCharged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditsWorkDelivered;
