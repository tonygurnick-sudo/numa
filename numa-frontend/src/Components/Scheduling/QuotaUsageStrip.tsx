import { useEffect, useState } from 'react';
import { ScheduleService, type QuotaSummary } from '../../Services/ScheduleService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { getFlag } from '../../utils/featureFlags';

/**
 * Compact quota strip rendered above the automations dashboard. Shows ONLY
 * the current user's caps:
 *   - Schedule runs / month (cron projection)
 *   - Trigger runs / month (event actuals)
 *   - Concurrent active automations (cron + triggers)
 *
 * Always rendered so the user knows where they stand. Variant goes amber
 * at 80%+ and red at 100%+ to signal pressure without nagging.
 */
type Bar = {
  label: string;
  current: number;
  cap: number;
  unit?: string;
};

export const QuotaUsageStrip: React.FC = () => {
  const { numaGet } = useNumaRequest();
  const [summary, setSummary] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ScheduleService.quotaSummary(numaGet);
        if (!cancelled) setSummary(res);
      } catch (err) {
        // Non-fatal — just hide the strip.
        console.warn('QuotaUsageStrip load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  // Hide the strip if the response is malformed (missing the parent
  // `user`/`quotas` objects). Without this guard, accessing
  // `summary.user.runsPerMonth` throws, the ErrorBoundary catches it and
  // remounts the component, useEffect re-fires, → infinite re-fetch loop.
  // Field-level `?? 0` below isn't enough — the parents must exist first.
  if (loading || !summary || !summary.user || !summary.quotas) return null;

  // Sub-flag of SCHEDULING — when off, the trigger-fires bar is dropped and
  // the active-automations unit label loses the "+ triggers" suffix.
  const triggersEnabled = getFlag('EVENT_TRIGGERS');
  const bars: Bar[] = [
    {
      label: 'Schedule runs / month',
      current: summary.user.runsPerMonth ?? 0,
      cap: summary.quotas.maxRunsPerUserPerMonth ?? 0,
      unit: 'projected',
    },
    ...(triggersEnabled
      ? [
          {
            label: 'Trigger fires / month',
            current: summary.user.triggerRunsThisMonth ?? 0,
            cap: summary.quotas.maxTriggerRunsPerUserPerMonth ?? 0,
            unit: 'actual',
          } as Bar,
        ]
      : []),
    {
      label: 'Active automations',
      current: summary.user.activeAutomationCount ?? summary.user.activeScheduleCount ?? 0,
      cap: summary.quotas.maxConcurrentActiveSchedulesPerUser ?? 0,
      unit: triggersEnabled ? 'cron + triggers' : 'cron',
    },
  ];

  const pct = (b: Bar): number => (b.cap > 0 ? Math.min(100, (b.current / b.cap) * 100) : 0);
  // Map the variant to an explicit fill colour. We bypass `<ProgressBar>` (and
  // its Bootstrap `.progress` / `.progress-bar` classes) because a global rule
  // in `_components.scss` forces `.progress-bar { height: 16px }`, which
  // overflows our intended 8-px-tall track and clips rounded corners. Using
  // a plain div with inline styles avoids the cascade fight entirely.
  const fillColor = (p: number): string => (p >= 100 ? '#dc3545' : p >= 80 ? '#f59e0b' : '#10b981');

  // Rendered as a thin footer strip at the bottom of the dashboard — no
  // card chrome, no header, just three labelled progress lines. Visually
  // recedes when usage is low; pulls focus when bars amber/red.
  //
  // Bar is a plain styled div (track) wrapping a fill div, NOT React-
  // Bootstrap's <ProgressBar>. The global `.progress-bar { height: 16px }`
  // rule in _components.scss conflicts with custom track heights and
  // breaks the rounded corners on thin bars.
  const BAR_HEIGHT = 8;
  const radius = BAR_HEIGHT / 2;
  return (
    <div className="quota-usage-footer mt-4 pt-3 pb-2 border-top">
      <div className="d-flex flex-wrap gap-4">
        {bars.map((b) => {
          const p = pct(b);
          return (
            <div key={b.label} className="flex-grow-1" style={{ minWidth: 220 }}>
              <div className="d-flex justify-content-between small mb-1">
                <span className="text-muted">{b.label}</span>
                <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {(b.current ?? 0).toLocaleString()} / {(b.cap ?? 0).toLocaleString()}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={Math.round(p)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={b.label}
                style={{
                  position: 'relative',
                  width: '100%',
                  height: BAR_HEIGHT,
                  borderRadius: radius,
                  backgroundColor: 'rgba(0, 0, 0, 0.08)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${p}%`,
                    height: '100%',
                    backgroundColor: fillColor(p),
                    borderRadius: radius,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
