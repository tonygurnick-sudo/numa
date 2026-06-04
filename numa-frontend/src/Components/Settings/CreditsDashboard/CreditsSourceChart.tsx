import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CreditSlice } from '../../../utils/creditDashboardData';
import { brandColor, colorAt, fmtCredits, sourceLabel } from './helpers';

interface Props {
  slices: CreditSlice[];
}

/** Credit consumption split by invocation source — Chat vs Agent chat vs Scheduled agent.
 *  Deterministic (NOT AI-classified). Real aggregation only — empty when there is nothing to show. */
export const CreditsSourceChart: React.FC<Props> = ({ slices }) => {
  const { t } = useTranslation('settings');
  const total = slices.reduce((a, s) => a + s.credits, 0);
  const data = useMemo(() => slices.map((s) => ({ ...s, label: sourceLabel(s.key, t) })), [slices, t]);

  // Stable colours for the three deterministic sources; chat takes the client's brand colour.
  const sourceColor = useMemo<Record<string, string>>(
    () => ({ chat: brandColor(), agent: '#6366f1', scheduled: '#14b8a6' }),
    []
  );

  return (
    <div className="credits-card credits-card--hover">
      <div className="credits-card__header">
        <i className="bi bi-diagram-3" aria-hidden="true" />
        <span className="credits-card__title">
          {t('creditsDashboard.sourceTitle', { defaultValue: 'Credits by type' })}
        </span>
      </div>
      <div className="credits-card__body">
        {data.length === 0 || total === 0 ? (
          <div className="credits-empty">
            <i className="bi bi-pie-chart credits-empty__icon" aria-hidden="true" />
            <span className="credits-empty__text">
              {t('creditsDashboard.sourceEmpty', { defaultValue: 'No usage recorded yet.' })}
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data}
                dataKey="credits"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={92}
                innerRadius={52}
                paddingAngle={2}
                stroke="#ffffff"
                strokeWidth={2}
              >
                {data.map((s, i) => (
                  <Cell key={s.key} fill={sourceColor[s.key] ?? colorAt(i)} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 10, border: '1px solid #e4e4e7', fontSize: 12 }}
                formatter={(value) => {
                  const v = Number(value);
                  const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                  return t('creditsDashboard.pieTooltip', {
                    defaultValue: '{{credits}} credits ({{pct}}%)',
                    credits: fmtCredits(v),
                    pct,
                  });
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default CreditsSourceChart;
