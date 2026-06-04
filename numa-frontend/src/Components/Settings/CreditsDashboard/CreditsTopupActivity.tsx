import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CreditTxn } from '../../../Services/AdminCreditsService';
import { fmtTimestamp } from './helpers';

interface Props {
  txns: CreditTxn[];
}

const KIND_LABEL: Record<string, string> = { topup: 'Top-up', settlement: 'Settlement', adjustment: 'Adjustment' };

/**
 * Top-up balance activity — the event log (top-ups + month-close settlements + adjustments) from the
 * client ledger (CLIENT#/TXN#…). The top-up balance tile = Σ of these rows. Money only, no chat
 * content or token/cost internals. Billing-admin-gated by the parent panel.
 */
export const CreditsTopupActivity: React.FC<Props> = ({ txns }) => {
  const { t } = useTranslation('settings');

  return (
    <div className="credits-card">
      <div className="credits-card__header">
        <i className="bi bi-clock-history" aria-hidden="true" />
        <span className="credits-card__title">
          {t('creditsDashboard.topupActivityTitle', { defaultValue: 'Top-up activity' })}
        </span>
      </div>
      <div className="credits-card__body credits-card__body--flush">
        {txns.length === 0 ? (
          <div className="credits-empty">
            <i className="bi bi-inbox credits-empty__icon" aria-hidden="true" />
            <span className="credits-empty__text">
              {t('creditsDashboard.topupActivityEmpty', { defaultValue: 'No top-up activity yet.' })}
            </span>
          </div>
        ) : (
          <div className="credits-table-wrap">
            <table className="credits-table">
              <thead>
                <tr>
                  <th>{t('creditsDashboard.txnDate', { defaultValue: 'Date' })}</th>
                  <th>{t('creditsDashboard.txnType', { defaultValue: 'Type' })}</th>
                  <th className="text-end">{t('creditsDashboard.colCredits', { defaultValue: 'Credits' })}</th>
                  <th>{t('creditsDashboard.txnNote', { defaultValue: 'Note' })}</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((tx, i) => {
                  const label =
                    tx.kind === 'settlement' && tx.month
                      ? `${KIND_LABEL.settlement} (${tx.month})`
                      : (KIND_LABEL[tx.kind] ?? tx.kind);
                  return (
                    <tr key={`${tx.createdAt}-${i}`}>
                      <td className="text-muted text-nowrap">{fmtTimestamp(tx.createdAt)}</td>
                      <td>{label}</td>
                      <td className={`text-end credits-table__num ${tx.credits < 0 ? 'text-danger' : 'text-success'}`}>
                        {tx.credits > 0 ? '+' : ''}
                        {tx.credits.toLocaleString()}
                      </td>
                      <td className="text-muted">{tx.note ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditsTopupActivity;
