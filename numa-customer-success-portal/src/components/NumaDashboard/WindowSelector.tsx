import { useMemo } from 'react';
import { discoverDataMonths, setLastNDays, setMonth } from './shared';
import type { WindowState } from './shared';
import type { FleetAnalyticsSnapshot } from '@/types/fleetAnalytics';

interface WindowSelectorProps {
  data: FleetAnalyticsSnapshot;
  value: WindowState;
  onChange: (next: WindowState) => void;
}

const DAY_PRESETS = [7, 14, 30, 60, 90];

/**
 * Two-row window picker: rolling-window day buttons on top, by-month buttons
 * below (dynamically derived from whatever months are present in the data).
 */
export function WindowSelector({ data, value, onChange }: WindowSelectorProps) {
  const months = useMemo(() => discoverDataMonths(data), [data]);

  const matchesDays = (n: number): boolean => value.label === `Last ${n} days`;
  const matchesMonth = (y: number, m: number): boolean => {
    const start = new Date(Date.UTC(y, m, 1));
    return value.startDate === start.toISOString().slice(0, 10);
  };

  return (
    <div className="nd-window-control">
      <div className="nd-window-row">
        <span className="nd-lbl">Rolling window</span>
        {DAY_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            className={`nd-window-btn ${matchesDays(n) ? 'nd-active' : ''}`}
            onClick={() => onChange(setLastNDays(n))}
          >
            Last {n} days
          </button>
        ))}
      </div>
      {months.length > 0 && (
        <div className="nd-window-row">
          <span className="nd-lbl">By month</span>
          {months.map((ym) => {
            const [y, m] = ym.split('-').map(Number);
            const date = new Date(Date.UTC(y, m - 1, 1));
            const label = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
            const currentYear = new Date().getUTCFullYear();
            const display = y !== currentYear ? `${label} ${y}` : label;
            const active = matchesMonth(y, m - 1);
            return (
              <button
                key={ym}
                type="button"
                className={`nd-window-btn ${active ? 'nd-active' : ''}`}
                onClick={() => onChange(setMonth(y, m - 1))}
              >
                {display}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
