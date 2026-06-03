import React, { useMemo } from 'react';
import { Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CreditSlice } from '../../../utils/creditDashboardData';
import { colorAt, fmtCredits, sourceLabel } from './helpers';

interface Props {
  slices: CreditSlice[];
}

/** Stable colours for the three deterministic sources (extra keys fall back to the palette). */
const SOURCE_COLOR: Record<string, string> = {
  chat: '#0d6efd',
  agent: '#6f42c1',
  scheduled: '#198754',
};

/** Credit consumption split by invocation source — Chat vs Agent chat vs Scheduled agent.
 *  Deterministic (NOT AI-classified). Real aggregation only — empty when there is nothing to show. */
export const CreditsSourceChart: React.FC<Props> = ({ slices }) => {
  const { t } = useTranslation('settings');
  const total = slices.reduce((a, s) => a + s.credits, 0);
  const data = useMemo(() => slices.map((s) => ({ ...s, label: sourceLabel(s.key, t) })), [slices, t]);

  return (
    <Card className="h-100">
      <Card.Header className="fw-semibold">
        <i className="bi bi-diagram-3 me-2" aria-hidden="true" />
        {t('creditsDashboard.sourceTitle', { defaultValue: 'Credits by type' })}
      </Card.Header>
      <Card.Body>
        {data.length === 0 || total === 0 ? (
          <div className="text-muted text-center py-5">
            {t('creditsDashboard.sourceEmpty', { defaultValue: 'No usage recorded yet.' })}
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
                innerRadius={46}
                paddingAngle={2}
              >
                {data.map((s, i) => (
                  <Cell key={s.key} fill={SOURCE_COLOR[s.key] ?? colorAt(i)} />
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

export default CreditsSourceChart;
