import React from 'react';
import { Button, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { CreditLedgerRow } from '../../../Services/AdminCreditsService';
import { fmtCredits, fmtDuration, fmtTimestamp, shortId } from './helpers';
import { TierBadge } from './TierBadge';

interface Props {
  show: boolean;
  title: string;
  rows: CreditLedgerRow[];
  userMap: Record<string, string>;
  onHide: () => void;
}

/** Drill-in detail for a top-5 run / staff member. Privacy-safe:
 *  shows run IDs, timings, value tier, volume — never the chat/agent name. */
export const CreditsDrillModal: React.FC<Props> = ({ show, title, rows, userMap, onHide }) => {
  const { t } = useTranslation('settings');
  const who = (sub: string | null): string =>
    sub ? (userMap[sub] ?? `${sub.slice(0, 8)}…`) : t('creditsDashboard.unknownUser', { defaultValue: 'Unknown' });
  const copy = (text: string): void => void navigator.clipboard?.writeText(text);
  const totalCredits = rows.reduce((a, r) => a + (Number(r.creditsCharged) || 0), 0);

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="fs-6">{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-0">
        <div className="credits-drill-note">
          <span>
            <i className="bi bi-shield-lock me-1" aria-hidden="true" />
            {t('creditsDashboard.drillPrivacy', {
              defaultValue: 'Run IDs and timings only — chat names and content are never shown.',
            })}
          </span>
          <span className="credits-live-chip">
            {t('creditsDashboard.drillTotal', { defaultValue: '{{n}} credits', n: fmtCredits(totalCredits) })}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="credits-empty">
            <i className="bi bi-inbox credits-empty__icon" aria-hidden="true" />
            <span className="credits-empty__text">
              {t('creditsDashboard.drillEmpty', { defaultValue: 'No runs to show.' })}
            </span>
          </div>
        ) : (
          <div className="credits-table-wrap">
            <table className="credits-table">
              <thead>
                <tr>
                  <th>{t('creditsDashboard.drillRun', { defaultValue: 'Run ID' })}</th>
                  <th>{t('creditsDashboard.drillWho', { defaultValue: 'By' })}</th>
                  <th>{t('creditsDashboard.drillLast', { defaultValue: 'Last run' })}</th>
                  <th>{t('creditsDashboard.drillDuration', { defaultValue: 'Duration' })}</th>
                  <th>{t('creditsDashboard.colTier', { defaultValue: 'Value' })}</th>
                  <th className="text-end">{t('creditsDashboard.colCredits', { defaultValue: 'Credits' })}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.conversationId}>
                    <td className="font-monospace text-nowrap">
                      {shortId(r.conversationId)}
                      <button
                        type="button"
                        className="credits-copy-btn ms-1"
                        onClick={() => copy(r.conversationId)}
                        title={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                        aria-label={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                      >
                        <i className="bi bi-clipboard" aria-hidden="true" />
                      </button>
                    </td>
                    <td className="text-nowrap">{who(r.userSub)}</td>
                    <td className="text-muted text-nowrap">{fmtTimestamp(r.lastTs)}</td>
                    <td className="text-muted text-nowrap">{fmtDuration(r.firstTs, r.lastTs, t)}</td>
                    <td>
                      <TierBadge tier={r.dominantTier} />
                    </td>
                    <td className="text-end credits-table__num">{fmtCredits(r.creditsCharged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('creditsDashboard.close', { defaultValue: 'Close' })}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default CreditsDrillModal;
