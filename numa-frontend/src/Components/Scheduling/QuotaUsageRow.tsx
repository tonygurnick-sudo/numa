/* eslint-disable i18next/no-literal-string -- admin-only scheduling UI; translations deferred to round-2 */
import React from 'react';

/**
 * One-line quota usage display: label on top, then a progress bar with
 * `actual / cap (pct)`. If `projected` is supplied, it stacks on top of
 * the actual fill in muted grey to show "where the 30-day projection lands".
 *
 * Bar variant follows traffic-light thresholds:
 *   < 80%  → green
 *   80–99% → yellow
 *   ≥ 100% → red
 *
 * Used in the audit panel (top tenant-usage card) and in the admin form
 * (in place of the static Company quotas table) so both surfaces share
 * the same visual language for "how much head-room is left".
 *
 * Implementation note: bypasses React-Bootstrap's `<ProgressBar>` because
 * the global `.progress-bar { height: 16px }` rule in `_components.scss`
 * forces the inner element taller than custom heights and breaks rounded
 * corners. Plain styled divs give us full control over height + radius
 * with no cascade conflicts.
 */

const BAR_HEIGHT = 10;
const BAR_RADIUS = BAR_HEIGHT / 2;

const fillColor = (pct: number): string => (pct >= 100 ? '#dc3545' : pct >= 80 ? '#f59e0b' : '#10b981');
const PROJECTION_COLOR = '#adb5bd'; // Bootstrap "secondary" mid-grey
const TRACK_COLOR = 'rgba(0, 0, 0, 0.08)';

export const QuotaUsageRow: React.FC<{
  label: string;
  current: number;
  cap: number;
  /** Optional — adds a faded extension showing 30-day projected. */
  projected?: number;
  unit?: string;
}> = ({ label, current, cap, projected, unit }) => {
  if (cap <= 0) {
    return (
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-baseline">
          <span className="small fw-semibold">{label}</span>
          <span className="small text-muted">no cap configured</span>
        </div>
      </div>
    );
  }
  const actualPct = Math.min(100, Math.round((current / cap) * 100));
  const projectedPct = projected != null ? Math.min(100, Math.round((projected / cap) * 100)) : actualPct;
  const projectionDelta = Math.max(0, projectedPct - actualPct);
  const ariaValue = projected != null ? projectedPct : actualPct;
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between align-items-baseline mb-1">
        <span className="small fw-semibold">{label}</span>
        <span className="small text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {current.toLocaleString()}
          {projected != null && projected !== current && <> · {projected.toLocaleString()} projected</>}
          {' / '}
          {cap.toLocaleString()} cap ({actualPct}%)
          {unit && <> · {unit}</>}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={ariaValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        style={{
          position: 'relative',
          height: BAR_HEIGHT,
          borderRadius: BAR_RADIUS,
          backgroundColor: TRACK_COLOR,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {/* Actual fill — anchored to the left edge, width = actualPct%. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${actualPct}%`,
            height: '100%',
            backgroundColor: fillColor(actualPct),
            borderRadius: BAR_RADIUS,
            transition: 'width 0.3s ease',
          }}
        />
        {/* Projection extension — sits to the right of the actual fill, in
            muted grey. Width = projectionDelta%, left = actualPct%. */}
        {projectionDelta > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${actualPct}%`,
              width: `${projectionDelta}%`,
              height: '100%',
              backgroundColor: PROJECTION_COLOR,
              borderRadius: BAR_RADIUS,
              transition: 'left 0.3s ease, width 0.3s ease',
            }}
          />
        )}
      </div>
    </div>
  );
};
