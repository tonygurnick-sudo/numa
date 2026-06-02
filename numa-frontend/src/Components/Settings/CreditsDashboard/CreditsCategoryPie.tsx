import React from 'react';
import { Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CategorySlice } from '../../../utils/creditDashboardData';
import { colorAt, fmtCredits } from './helpers';

interface Props {
  slices: CategorySlice[];
}

/** Credit consumption split by category (falls back to source for unclassified
 *  rows). Real aggregation only — empty when there is nothing to show. */
export const CreditsCategoryPie: React.FC<Props> = ({ slices }) => {
  const { t } = useTranslation('settings');
  const total = slices.reduce((a, s) => a + s.credits, 0);

  return (
    <Card className="h-100">
      <Card.Header className="fw-semibold">
        <i className="bi bi-pie-chart me-2" aria-hidden="true" />
        {t('creditsDashboard.categoryTitle', { defaultValue: 'Consumption by category' })}
      </Card.Header>
      <Card.Body>
        {slices.length === 0 || total === 0 ? (
          <div className="text-muted text-center py-5">
            {t('creditsDashboard.categoryEmpty', { defaultValue: 'No categorised usage yet.' })}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="credits"
                nameKey="key"
                cx="50%"
                cy="50%"
                outerRadius={92}
                innerRadius={46}
                paddingAngle={2}
              >
                {slices.map((s, i) => (
                  <Cell key={s.key} fill={colorAt(i)} />
                ))}
              </Pie>
              <Tooltip
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
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </Card.Body>
    </Card>
  );
};

export default CreditsCategoryPie;
