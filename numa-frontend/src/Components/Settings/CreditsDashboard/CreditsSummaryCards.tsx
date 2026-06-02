import React from 'react';
import { Card, ProgressBar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { fmtCredits } from './helpers';

interface Props {
  allocated: number;
  used: number;
  remaining: number;
  monthLabel: string;
}

/** Top-of-dashboard stat tiles: remaining / allocated / used, plus a usage bar.
 *  Pure presentation — all numbers come from real balance + ledger totals. */
export const CreditsSummaryCards: React.FC<Props> = ({ allocated, used, remaining, monthLabel }) => {
  const { t } = useTranslation('settings');
  const pct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
  const barVariant = pct < 75 ? 'success' : pct < 90 ? 'warning' : 'danger';

  const Tile: React.FC<{ label: string; value: string; sub?: string; accent?: string }> = ({
    label,
    value,
    sub,
    accent,
  }) => (
    <Card className="h-100">
      <Card.Body>
        <div className="text-uppercase small text-muted fw-semibold">{label}</div>
        <div className={`display-6 fw-semibold ${accent ?? ''}`}>{value}</div>
        {sub ? <div className="small text-muted">{sub}</div> : null}
      </Card.Body>
    </Card>
  );

  return (
    <div className="mb-3">
      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <Tile
            label={t('creditsDashboard.remaining', { defaultValue: 'Credits remaining' })}
            value={fmtCredits(remaining)}
            sub={t('creditsDashboard.remainingSub', {
              defaultValue: '{{month}} · use it or lose it',
              month: monthLabel,
            })}
            accent="text-success"
          />
        </div>
        <div className="col-md-4">
          <Tile
            label={t('creditsDashboard.allocated', { defaultValue: 'Allocated' })}
            value={fmtCredits(allocated)}
            sub={t('creditsDashboard.allocatedSub', { defaultValue: 'This month' })}
          />
        </div>
        <div className="col-md-4">
          <Tile
            label={t('creditsDashboard.used', { defaultValue: 'Used this month' })}
            value={fmtCredits(used)}
            sub={t('creditsDashboard.usedSub', { defaultValue: '{{pct}}% of allocation', pct })}
            accent="text-primary"
          />
        </div>
      </div>
      <ProgressBar
        now={pct}
        label={t('creditsDashboard.pct', { defaultValue: '{{pct}}%', pct })}
        variant={barVariant}
        className="mb-1"
      />
      <div className="small text-muted">
        {t('creditsDashboard.usedOfAllocated', {
          defaultValue: '{{used}} of {{allocated}} credits used',
          used: fmtCredits(used),
          allocated: fmtCredits(allocated),
        })}
      </div>
    </div>
  );
};

export default CreditsSummaryCards;
