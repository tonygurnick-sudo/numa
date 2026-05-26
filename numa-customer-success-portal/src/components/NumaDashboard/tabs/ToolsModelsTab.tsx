import { Bar } from 'react-chartjs-2';
import '../chartSetup';
import { fmtN, fmtUSD, pct } from '../shared';
import { useCurrency } from '../currencyContext';
import { ND_COLORS } from '../theme';
import type { WindowState } from '../shared';
import type { DashboardView } from '@/types/fleetAnalytics';

interface Props {
  data: DashboardView;
  window: WindowState;
}

/**
 * Tools & Models tab. Reads `chat.tool_totals` and `chat.model_totals`
 * directly from the snapshot (snapshot window). No window-filtering of
 * per-conv data here — these aggregates are pre-computed.
 */
export function ToolsModelsTab({ data }: Props) {
  useCurrency();
  const toolEntries = Object.entries(data.chat?.tool_totals || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  const modelEntries = Object.entries(data.chat?.model_totals || {}).sort((a, b) => b[1].cost - a[1].cost);
  const totalCost = data.chat?.totals?.cost || 0;

  return (
    <div className="nd-row-2">
      <div className="nd-card">
        <div className="nd-card-header">
          <div className="nd-card-title">Top tools used</div>
          <div className="nd-card-subtitle">
            Counted from assistant tool_use blocks · snapshot-window totals (window picker doesn't re-filter)
          </div>
        </div>
        <div className="nd-chart-wrap" style={{ height: 420 }}>
          <Bar
            data={{
              labels: toolEntries.map((e) => e[0].replace(/^mcp__/, '')),
              datasets: [{ data: toolEntries.map((e) => e[1]), backgroundColor: ND_COLORS.accent2, borderRadius: 4 }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtN(c.parsed.x as number)} calls` } },
              },
              scales: { x: { grid: { display: false } } },
            }}
          />
        </div>
      </div>
      <div className="nd-card">
        <div className="nd-card-header">
          <div className="nd-card-title">Models in use</div>
          <div className="nd-card-subtitle">
            Cost + conversation count per model · snapshot-window (window picker doesn't re-filter)
          </div>
        </div>
        <table className="nd-table">
          <thead>
            <tr>
              <th>Model</th>
              <th className="nd-num">Cost</th>
              <th className="nd-num">Share</th>
              <th className="nd-num">Convs</th>
            </tr>
          </thead>
          <tbody>
            {modelEntries.length === 0 && (
              <tr>
                <td colSpan={4} className="nd-empty">
                  No model data
                </td>
              </tr>
            )}
            {modelEntries.map(([m, v]) => {
              const shortName = m
                .replace(/^us\.anthropic\./, '')
                .replace(/^amazon\./, '')
                .replace(/-v\d+:?\d*$/, '');
              return (
                <tr key={m}>
                  <td>
                    {shortName}
                    <div className="nd-sub">{m}</div>
                  </td>
                  <td className="nd-num">{fmtUSD(v.cost)}</td>
                  <td className="nd-num">{pct(v.cost, totalCost)}</td>
                  <td className="nd-num">{v.convs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
