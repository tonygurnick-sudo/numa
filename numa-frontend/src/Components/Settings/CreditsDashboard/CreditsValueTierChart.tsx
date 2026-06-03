import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CreditLedgerRow } from '../../../Services/AdminCreditsService';

const TIERS = ['low', 'medium', 'high', 'very_high'] as const;
const TIER_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', very_high: 'Very high' };
// Escalating brand-purple scale, low (muted) -> very_high (deep), so heavier tiers read as "more".
const TIER_COLOR: Record<string, string> = { low: '#cbd5e1', medium: '#a78bfa', high: '#8b5cf6', very_high: '#6d28d9' };

// Maps to the deterministic `source` split. 'all' = no filter.
type SourceFilter = 'all' | 'chat' | 'agent' | 'scheduled';

interface Props {
  rows: CreditLedgerRow[];
}

/**
 * Runs grouped by value tier (Low → Very high), filterable by invocation source
 * (All / Chats / Agent chats / Scheduled agents). Count of runs per tier — a quick read of how the
 * tenant's work skews across the value tiers. Real aggregation only; empty when nothing matches.
 */
export const CreditsValueTierChart: React.FC<Props> = ({ rows }) => {
  const { t } = useTranslation('settings');
  const [filter, setFilter] = useState<SourceFilter>('all');

  const data = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, very_high: 0 };
    for (const r of rows) {
      if (filter !== 'all' && r.source !== filter) continue;
      if ((TIERS as readonly string[]).includes(r.dominantTier)) counts[r.dominantTier] += 1;
    }
    return TIERS.map((tier) => ({ tier, label: TIER_LABEL[tier], count: counts[tier] }));
  }, [rows, filter]);

  const total = data.reduce((a, d) => a + d.count, 0);

  const FILTERS: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: t('creditsDashboard.filterAll', { defaultValue: 'All' }) },
    { key: 'chat', label: t('creditsDashboard.filterChat', { defaultValue: 'Chats' }) },
    { key: 'agent', label: t('creditsDashboard.filterAgent', { defaultValue: 'Agent chats' }) },
    { key: 'scheduled', label: t('creditsDashboard.filterScheduled', { defaultValue: 'Scheduled' }) },
  ];

  return (
    <div className="credits-card credits-card--hover">
      <div className="credits-card__header">
        <i className="bi bi-bar-chart-line" aria-hidden="true" />
        <span className="credits-card__title">
          {t('creditsDashboard.valueTierTitle', { defaultValue: 'Runs by value tier' })}
        </span>
        <span className="credits-card__header-end">
          <div
            className="btn-group btn-group-sm"
            role="group"
            aria-label={t('creditsDashboard.valueTierFilterAria', { defaultValue: 'Filter by source' })}
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`btn ${filter === f.key ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </span>
      </div>
      <div className="credits-card__body">
        {total === 0 ? (
          <div className="credits-empty">
            <i className="bi bi-bar-chart credits-empty__icon" aria-hidden="true" />
            <span className="credits-empty__text">
              {t('creditsDashboard.valueTierEmpty', { defaultValue: 'No runs to show for this filter.' })}
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f3" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                contentStyle={{ borderRadius: 10, border: '1px solid #e4e4e7', fontSize: 12 }}
                formatter={(v: number) => [v, t('creditsDashboard.valueTierRuns', { defaultValue: 'Runs' })]}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={88}>
                {data.map((d) => (
                  <Cell key={d.tier} fill={TIER_COLOR[d.tier]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default CreditsValueTierChart;
