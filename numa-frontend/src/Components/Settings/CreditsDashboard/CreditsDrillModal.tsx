import React from 'react';
import { Badge, Button, Modal, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { CreditLedgerFullRow } from '../../../Services/AdminCreditsService';
import { fmtCredits, fmtDuration, fmtTimestamp, shortId, TIER_BADGE } from './helpers';

interface Props {
  show: boolean;
  title: string;
  rows: CreditLedgerFullRow[];
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
        <div className="px-3 py-2 small text-muted border-bottom d-flex justify-content-between align-items-center">
          <span>
            <i className="bi bi-shield-lock me-1" aria-hidden="true" />
            {t('creditsDashboard.drillPrivacy', {
              defaultValue: 'Run IDs and timings only — chat names and content are never shown.',
            })}
          </span>
          <Badge bg="light" text="dark" className="border">
            {t('creditsDashboard.drillTotal', { defaultValue: '{{n}} credits', n: fmtCredits(totalCredits) })}
          </Badge>
        </div>
        {rows.length === 0 ? (
          <div className="text-muted text-center py-4">
            {t('creditsDashboard.drillEmpty', { defaultValue: 'No runs to show.' })}
          </div>
        ) : (
          <Table size="sm" responsive hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th>{t('creditsDashboard.drillRun', { defaultValue: 'Run ID' })}</th>
                <th>{t('creditsDashboard.drillWho', { defaultValue: 'By' })}</th>
                <th>{t('creditsDashboard.drillLast', { defaultValue: 'Last run' })}</th>
                <th>{t('creditsDashboard.drillDuration', { defaultValue: 'Duration' })}</th>
                <th>{t('creditsDashboard.colTier', { defaultValue: 'Value' })}</th>
                <th className="text-end">{t('creditsDashboard.drillMsgs', { defaultValue: 'Msgs' })}</th>
                <th className="text-end">{t('creditsDashboard.drillTokens', { defaultValue: 'Tokens' })}</th>
                <th className="text-end">{t('creditsDashboard.colCredits', { defaultValue: 'Credits' })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.conversationId}>
                  <td className="font-monospace small text-nowrap">
                    {shortId(r.conversationId)}
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 ms-1 lh-1 text-muted"
                      onClick={() => copy(r.conversationId)}
                      title={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                      aria-label={t('creditsDashboard.copyId', { defaultValue: 'Copy full ID' })}
                    >
                      <i className="bi bi-clipboard" aria-hidden="true" />
                    </Button>
                  </td>
                  <td className="small">{who(r.userSub)}</td>
                  <td className="small text-muted text-nowrap">{fmtTimestamp(r.lastTs)}</td>
                  <td className="small text-muted text-nowrap">{fmtDuration(r.firstTs, r.lastTs, t)}</td>
                  <td>
                    <Badge
                      bg={TIER_BADGE[r.dominantTier] ?? 'light'}
                      text={TIER_BADGE[r.dominantTier] === 'light' ? 'dark' : undefined}
                    >
                      {r.dominantTier}
                    </Badge>
                  </td>
                  <td className="text-end font-monospace small">{r.msgCount}</td>
                  <td className="text-end font-monospace small">
                    {r.totalTokens ? r.totalTokens.toLocaleString() : '—'}
                  </td>
                  <td className="text-end font-monospace">{fmtCredits(r.creditsCharged)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
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
