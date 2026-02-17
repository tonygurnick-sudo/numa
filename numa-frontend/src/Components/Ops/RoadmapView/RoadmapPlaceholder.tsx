import React from 'react';
import { Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const QUARTERS = [
  { label: 'Q1', months: MONTHS.slice(0, 3) },
  { label: 'Q2', months: MONTHS.slice(3, 6) },
  { label: 'Q3', months: MONTHS.slice(6, 9) },
  { label: 'Q4', months: MONTHS.slice(9, 12) },
];

/**
 * Decorative initiative bars that simulate a roadmap timeline.
 * Each bar has a color, a start month index (0-based), and an end month index (inclusive).
 */
const SAMPLE_INITIATIVES = [
  { color: '#dc3545', startMonth: 0, endMonth: 2 }, // Critical: Jan-Mar (red)
  { color: '#fd7e14', startMonth: 1, endMonth: 4 }, // High: Feb-May (orange)
  { color: '#ffc107', startMonth: 3, endMonth: 6 }, // Medium: Apr-Jul (yellow)
  { color: '#0d6efd', startMonth: 5, endMonth: 8 }, // Low: Jun-Sep (blue)
  { color: '#198754', startMonth: 7, endMonth: 11 }, // On-track: Aug-Dec (green)
];

const LEGEND_ITEMS = [
  { color: '#dc3545', labelKey: 'priority.highest' },
  { color: '#fd7e14', labelKey: 'priority.high' },
  { color: '#ffc107', labelKey: 'priority.medium' },
  { color: '#0d6efd', labelKey: 'priority.low' },
];

const TOTAL_MONTHS = 12;

/**
 * A decorative "Coming Soon" placeholder that previews what the
 * roadmap view will look like. The entire timeline is rendered
 * under a semi-transparent overlay with a prominent "Coming Soon"
 * message.
 */
export function RoadmapPlaceholder(): React.JSX.Element {
  const { t } = useTranslation('ops');

  return (
    <div className="position-relative h-100 p-4">
      {/* Decorative timeline underneath the overlay */}
      <div style={{ opacity: 0.3, pointerEvents: 'none' as const }}>
        {/* Title row */}
        <div className="d-flex align-items-center justify-content-between mb-4">
          <h4 className="mb-0 fw-semibold">{t('roadmap.title', { year: new Date().getFullYear() })}</h4>
          <Button variant="outline-primary" size="sm" disabled>
            <i className="bi bi-plus-lg me-1" />
            {'+ New Initiative'}
          </Button>
        </div>

        {/* Quarter / month header */}
        <div className="border rounded overflow-hidden">
          {/* Quarter labels */}
          <div className="d-flex border-bottom bg-light">
            {QUARTERS.map((q) => (
              <div key={q.label} className="text-center fw-semibold py-2 border-end" style={{ flex: 1 }}>
                {q.label}
              </div>
            ))}
          </div>

          {/* Month labels */}
          <div className="d-flex border-bottom">
            {MONTHS.map((m) => (
              <div key={m} className="text-center small text-muted py-1 border-end" style={{ flex: 1 }}>
                {m}
              </div>
            ))}
          </div>

          {/* Initiative bars */}
          <div className="position-relative" style={{ minHeight: 220 }}>
            {/* Vertical month gridlines */}
            <div className="position-absolute top-0 start-0 w-100 h-100 d-flex">
              {MONTHS.map((m) => (
                <div key={`grid-${m}`} className="border-end" style={{ flex: 1 }} />
              ))}
            </div>

            {/* Bars */}
            <div className="position-relative" style={{ padding: '16px 0' }}>
              {SAMPLE_INITIATIVES.map((init, idx) => {
                const leftPct = (init.startMonth / TOTAL_MONTHS) * 100;
                const widthPct = ((init.endMonth - init.startMonth + 1) / TOTAL_MONTHS) * 100;

                return (
                  <div
                    key={idx}
                    className="position-relative"
                    style={{
                      marginLeft: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: 28,
                      marginBottom: 10,
                      backgroundColor: init.color,
                      borderRadius: 6,
                      opacity: 0.85,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Priority legend */}
        <div className="d-flex align-items-center gap-4 mt-3">
          {LEGEND_ITEMS.map((item) => (
            <span key={item.labelKey} className="d-inline-flex align-items-center gap-1 small text-muted">
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  backgroundColor: item.color,
                  flexShrink: 0,
                }}
              />
              {t(item.labelKey)}
            </span>
          ))}
        </div>
      </div>

      {/* Overlay */}
      <div
        className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center"
        style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}
      >
        <i className="bi bi-calendar3 display-1 text-muted mb-3" />
        <h2 className="text-muted">{t('roadmap.comingSoon')}</h2>
        <p className="text-muted">{t('roadmap.description')}</p>
      </div>
    </div>
  );
}
