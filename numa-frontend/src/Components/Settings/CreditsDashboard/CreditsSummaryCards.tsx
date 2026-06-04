import React from 'react';
import { useTranslation } from 'react-i18next';
import { fmtCredits } from './helpers';

interface Props {
  allocated: number;
  used: number;
  remaining: number;
  topUpBalance: number;
  monthLabel: string;
}

/** Hero allocation meter + supporting stats: the headline of the Credits tab.
 *  The big number is the monthly remaining (use-it-or-lose-it); the meter fills as the
 *  allocation is consumed (green → amber → red). Top-up is the separate persistent pool.
 *  Pure presentation — every number comes from real balance + ledger totals. */
export const CreditsSummaryCards: React.FC<Props> = ({ allocated, used, remaining, topUpBalance, monthLabel }) => {
  const { t } = useTranslation('settings');
  const pct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
  const fillMod = pct < 75 ? 'ok' : pct < 90 ? 'warn' : 'crit';

  return (
    <div className="credits-hero">
      <div className="credits-hero__head">
        <span className="credits-hero__month">
          {t('creditsDashboard.heroMonth', { defaultValue: '{{month}} · monthly allocation', month: monthLabel })}
        </span>
      </div>

      <div className="credits-hero__remaining">
        <span className="credits-hero__remaining-value">{fmtCredits(remaining)}</span>
        <span className="credits-hero__remaining-label">
          {t('creditsDashboard.remaining', { defaultValue: 'Credits remaining' })}
        </span>
      </div>

      <div className="credits-hero__meter">
        <div
          className="credits-hero__meter-track"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`credits-hero__meter-fill credits-hero__meter-fill--${fillMod}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="credits-hero__meter-caption">
          {t('creditsDashboard.usedOfAllocated', {
            defaultValue: '{{used}} of {{allocated}} credits used · {{pct}}%',
            used: fmtCredits(used),
            allocated: fmtCredits(allocated),
            pct,
          })}
        </div>
      </div>

      <div className="credits-hero__stats">
        <div className="credits-stat">
          <div className="credits-stat__label">{t('creditsDashboard.used', { defaultValue: 'Used this month' })}</div>
          <div className="credits-stat__value">{fmtCredits(used)}</div>
          <div className="credits-stat__sub">
            {t('creditsDashboard.usedSub', { defaultValue: '{{pct}}% of allocation', pct })}
          </div>
        </div>
        <div className="credits-stat">
          <div className="credits-stat__label">{t('creditsDashboard.allocated', { defaultValue: 'Allocated' })}</div>
          <div className="credits-stat__value">{fmtCredits(allocated)}</div>
          <div className="credits-stat__sub">{t('creditsDashboard.allocatedSub', { defaultValue: 'This month' })}</div>
        </div>
        <div className="credits-stat">
          <div className="credits-stat__label">
            {t('creditsDashboard.topUpBalance', { defaultValue: 'Top-up balance' })}
          </div>
          <div className={`credits-stat__value ${topUpBalance < 0 ? 'credits-stat__value--danger' : ''}`}>
            {fmtCredits(topUpBalance)}
          </div>
          <div className="credits-stat__sub">
            {t('creditsDashboard.topUpBalanceSub', { defaultValue: 'Persistent pool' })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreditsSummaryCards;
