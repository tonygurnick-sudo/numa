import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPoint } from '../../../utils/creditDashboardData';
import { brandColor } from './helpers';

interface Props {
  data: TrendPoint[];
}

/** Monthly credits-used trend (bars) vs the monthly allocation (reference line).
 *  Only months that actually have records show non-zero — no synthetic history. */
export const CreditsTrendChart: React.FC<Props> = ({ data }) => {
  const { t } = useTranslation('settings');
  const hasData = data.some((d) => d.used > 0 || d.allocated > 0);
  const brand = useMemo(() => brandColor(), []);

  return (
    <div className="credits-card credits-card--hover">
      <div className="credits-card__header">
        <i className="bi bi-graph-up-arrow" aria-hidden="true" />
        <span className="credits-card__title">
          {t('creditsDashboard.trendTitle', { defaultValue: 'Credits used — monthly trend' })}
        </span>
      </div>
      <div className="credits-card__body">
        {!hasData ? (
          <div className="credits-empty">
            <i className="bi bi-bar-chart-line credits-empty__icon" aria-hidden="true" />
            <span className="credits-empty__text">
              {t('creditsDashboard.trendEmpty', { defaultValue: 'No monthly usage recorded yet.' })}
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: '#71717a' }}
                axisLine={{ stroke: '#e4e4e7' }}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 12, fill: '#71717a' }} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                contentStyle={{ borderRadius: 10, border: '1px solid #e4e4e7', fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="used"
                name={t('creditsDashboard.usedLegend', { defaultValue: 'Used' })}
                fill={brand}
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
              <Line
                dataKey="allocated"
                name={t('creditsDashboard.allocatedLegend', { defaultValue: 'Allocated' })}
                stroke="#a1a1aa"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default CreditsTrendChart;
