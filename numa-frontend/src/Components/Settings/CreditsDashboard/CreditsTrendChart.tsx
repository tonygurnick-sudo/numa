import React from 'react';
import { Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPoint } from '../../../utils/creditDashboardData';

interface Props {
  data: TrendPoint[];
}

/** Monthly credits-used trend (bars) vs the monthly allocation (line).
 *  Only months that actually have records show non-zero — no synthetic history. */
export const CreditsTrendChart: React.FC<Props> = ({ data }) => {
  const { t } = useTranslation('settings');
  const hasData = data.some((d) => d.used > 0 || d.allocated > 0);

  return (
    <Card className="h-100">
      <Card.Header className="fw-semibold">
        <i className="bi bi-graph-up-arrow me-2" aria-hidden="true" />
        {t('creditsDashboard.trendTitle', { defaultValue: 'Credits used — monthly trend' })}
      </Card.Header>
      <Card.Body>
        {!hasData ? (
          <div className="text-muted text-center py-5">
            {t('creditsDashboard.trendEmpty', { defaultValue: 'No monthly usage recorded yet.' })}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="used"
                name={t('creditsDashboard.usedLegend', { defaultValue: 'Used' })}
                fill="#0d6efd"
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
              <Line
                dataKey="allocated"
                name={t('creditsDashboard.allocatedLegend', { defaultValue: 'Allocated' })}
                stroke="#198754"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card.Body>
    </Card>
  );
};

export default CreditsTrendChart;
