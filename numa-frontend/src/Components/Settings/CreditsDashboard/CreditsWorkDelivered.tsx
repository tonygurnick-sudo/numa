import React from 'react';
import { Badge, Card, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { CreditLedgerRow } from '../../../Services/AdminCreditsService';
import { fmtTimestamp, sourceLabel } from './helpers';

const TIER_BADGE: Record<string, string> = {
  low: 'secondary',
  medium: 'info',
  high: 'primary',
  very_high: 'warning',
  unclassified: 'light',
};

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

  // Wall-clock span first→last message (a chat resumed days later shows "days"). Not a price driver.
  const fmtDuration = (first: string | null, last: string | null): string => {
    if (!first || !last) return '—';
    const ms = new Date(last).getTime() - new Date(first).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const min = ms / 60000;
    if (min < 1) return t('credits.durInstant', { defaultValue: '<1 min' });
    if (min < 60) return t('credits.durMin', { defaultValue: '{{n}} min', n: Math.round(min) });
    const hrs = min / 60;
    if (hrs < 24)
      return t('credits.durHrs', { defaultValue: '{{n}} hr', n: hrs < 10 ? hrs.toFixed(1) : String(Math.round(hrs)) });
    const days = hrs / 24;
    return t('credits.durDays', {
      defaultValue: '{{n}} days',
      n: days < 10 ? days.toFixed(1) : String(Math.round(days)),
    });
  };

  return (
    <Card>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">
          <i className="bi bi-receipt me-2" aria-hidden="true" />
          {t('credits.ledgerTitle', { defaultValue: 'This month — work delivered' })}
        </span>
        <Badge bg="light" text="dark" className="border">
          {t('credits.totalThisMonth', { defaultValue: '{{count}} credits', count: totalCredits })}
        </Badge>
      </Card.Header>
      <Card.Body className="p-0">
        {rows.length === 0 ? (
          <div className="text-muted text-center py-4">
            {t('credits.empty', { defaultValue: 'No activity recorded this month yet.' })}
          </div>
        ) : (
          <Table size="sm" hover responsive className="mb-0 align-middle">
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
                      <div>{row.title}</div>
                    ) : (
                      <div className="text-muted fst-italic">
                        {t('credits.summaryPending', { defaultValue: 'Anonymised summary coming overnight' })}
                      </div>
                    )}
                    {row.deliverables && row.deliverables.length > 0 && (
                      <ul className="small text-muted mb-0 ps-3">
                        {row.deliverables.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    )}
                    <div className="small text-muted">
                      {t('credits.rowMeta', {
                        defaultValue: '{{label}} · {{count}} msgs',
                        label: sourceLabel(row.source, t),
                        count: row.msgCount,
                      })}
                    </div>
                  </td>
                  <td className="small">{who(row.userSub)}</td>
                  <td className="small text-muted text-nowrap">{fmtTimestamp(row.lastTs)}</td>
                  <td className="small text-muted">{fmtDuration(row.firstTs, row.lastTs)}</td>
                  <td>
                    <Badge
                      bg={TIER_BADGE[row.dominantTier] ?? 'light'}
                      text={TIER_BADGE[row.dominantTier] === 'light' ? 'dark' : undefined}
                    >
                      {row.dominantTier}
                    </Badge>
                  </td>
                  <td className="text-end font-monospace">{Number(row.creditsCharged).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
};

export default CreditsWorkDelivered;
