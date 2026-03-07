import { useEffect, useState } from 'react';
import { Spinner, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminUsageAnalyticsService, type HeatmapEntry } from '../../Services/AdminUsageAnalyticsService';

const CELL_SIZE = 13;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const LABEL_WIDTH = 160;
const WEEKS = 52;
const HEATMAP_COLOR = '99, 102, 241';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Legend sample opacities: empty → low → mid → high → full
const LEGEND_STEPS = [0.06, 0.25, 0.45, 0.7, 1.0];

interface Week {
  key: string;
  days: string[];
  month: number;
  year: number;
}

interface MonthSpan {
  label: string;
  spanKey: string;
  weekCount: number;
}

const buildWeeks = (count: number): Week[] => {
  const today = new Date();
  const dow = today.getDay();
  const daysToMon = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysToMon);

  return Array.from({ length: count }, (_, i) => {
    const weekStart = new Date(thisMonday);
    weekStart.setDate(thisMonday.getDate() - (count - 1 - i) * 7);
    const days = Array.from({ length: 7 }, (_, d) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      return day.toISOString().slice(0, 10);
    });
    return { key: days[0], days, month: weekStart.getMonth(), year: weekStart.getFullYear() };
  });
};

const shortDate = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
};

const cellOpacity = (total: number, maxTotal: number): number => {
  if (maxTotal === 0 || total === 0) return 0.06;
  return 0.12 + 0.88 * Math.sqrt(total / maxTotal);
};

export default function LoginHeatmap() {
  const { t } = useTranslation('settings');
  const { numaGet } = useNumaRequest();

  const [entries, setEntries] = useState<HeatmapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AdminUsageAnalyticsService.getLoginHeatmap(numaGet)
      .then((data) => {
        if (!cancelled) {
          setEntries(data ?? []);
          setError(null);
        }
      })
      .catch((e) => {
        console.error('Failed to load heatmap:', e);
        if (!cancelled) {
          setEntries([]);
          setError(t('usageAnalytics.heatmap.loadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [numaGet, t]);

  // ── Card shell is always rendered so the section has consistent height ──
  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body p-4">
        {/* Header */}
        <div className="d-flex align-items-start justify-content-between mb-4">
          <div>
            <h6 className="fw-semibold mb-1" style={{ color: '#212529' }}>
              {t('usageAnalytics.heatmap.title')}
            </h6>
            <p className="mb-0 small text-muted">{t('usageAnalytics.heatmap.subtitle')}</p>
          </div>

          {/* Legend */}
          <div className="d-flex align-items-center gap-1" style={{ flexShrink: 0 }}>
            <span className="small text-muted me-1">{t('usageAnalytics.heatmap.legendLess')}</span>
            {LEGEND_STEPS.map((op) => (
              <div
                key={op}
                style={{
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                  borderRadius: 2,
                  backgroundColor: `rgba(${HEATMAP_COLOR}, ${op})`,
                  border: op === 0.06 ? '1px solid rgba(0,0,0,0.08)' : undefined,
                }}
              />
            ))}
            <span className="small text-muted ms-1">{t('usageAnalytics.heatmap.legendMore')}</span>
          </div>
        </div>

        {/* Body */}
        {loading && (
          <div className="d-flex justify-content-center py-5">
            <Spinner animation="border" variant="primary" />
          </div>
        )}

        {!loading && error && <div className="text-danger small py-2">{error}</div>}

        {!loading && !error && entries.length === 0 && (
          <div className="text-muted small py-2">{t('usageAnalytics.heatmap.noData')}</div>
        )}

        {!loading && !error && entries.length > 0 && <HeatmapGrid entries={entries} t={t} />}
      </div>
    </div>
  );
}

// ── Grid extracted so the card shell renders unconditionally ──────────────
function HeatmapGrid({
  entries,
  t,
}: {
  entries: HeatmapEntry[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const weeks = buildWeeks(WEEKS);

  const dateToWeek = new Map<string, string>();
  weeks.forEach((w) => w.days.forEach((d) => dateToWeek.set(d, w.key)));

  const byUserWeek = new Map<string, Map<string, number>>();
  const userNames = new Map<string, string>();
  for (const entry of entries) {
    if (entry.userName && !userNames.has(entry.userId)) {
      userNames.set(entry.userId, entry.userName);
    }
    const wk = dateToWeek.get(entry.date);
    if (!wk) continue;
    if (!byUserWeek.has(entry.userId)) byUserWeek.set(entry.userId, new Map());
    const u = byUserWeek.get(entry.userId)!;
    u.set(wk, (u.get(wk) ?? 0) + entry.total);
  }

  const allWeekTotals = Array.from(byUserWeek.values()).flatMap((m) => Array.from(m.values()));
  const maxWeekTotal = Math.max(...allWeekTotals, 1);

  const monthSpans = weeks.reduce<MonthSpan[]>((acc, week) => {
    const spanKey = `${week.year}-${week.month}`;
    const last = acc[acc.length - 1];
    if (last?.spanKey === spanKey) {
      last.weekCount++;
    } else acc.push({ label: MONTH_NAMES[week.month], spanKey, weekCount: 1 });
    return acc;
  }, []);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: LABEL_WIDTH + weeks.length * CELL_STEP, paddingBottom: 4 }}>
        {/* Month labels */}
        <div style={{ display: 'flex', paddingLeft: LABEL_WIDTH, marginBottom: 8 }}>
          {monthSpans.map((span) => (
            <div
              key={span.spanKey}
              style={{
                width: span.weekCount * CELL_STEP - CELL_GAP,
                marginRight: CELL_GAP,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.03em',
                color: '#6c757d',
                borderLeft: '2px solid #e9ecef',
                paddingLeft: 5,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                textTransform: 'uppercase',
              }}
            >
              {span.label}
            </div>
          ))}
        </div>

        {/* User rows */}
        {[...byUserWeek.entries()].map(([userId, weekMap]) => (
          <div key={userId} style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
            {/* Name / email */}
            <div
              style={{
                width: LABEL_WIDTH,
                paddingRight: 12,
                fontSize: 12,
                fontWeight: 500,
                color: '#495057',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={userId}
            >
              {userNames.get(userId) ?? userId}
            </div>

            {/* Week cells */}
            {weeks.map((week) => {
              const total = weekMap.get(week.key) ?? 0;
              const opacity = cellOpacity(total, maxWeekTotal);

              return (
                <OverlayTrigger
                  key={week.key}
                  placement="top"
                  overlay={
                    <Tooltip>
                      <div style={{ textAlign: 'left', lineHeight: 1.6 }}>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>
                          {t('usageAnalytics.heatmap.tooltipWeek', {
                            start: shortDate(week.days[0]),
                            end: shortDate(week.days[6]),
                          })}
                        </div>
                        <div style={{ fontWeight: 600 }}>
                          {t('usageAnalytics.heatmap.tooltipLogins', { count: total })}
                        </div>
                      </div>
                    </Tooltip>
                  }
                >
                  <div
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      marginRight: CELL_GAP,
                      borderRadius: 2,
                      backgroundColor: `rgba(${HEATMAP_COLOR}, ${opacity})`,
                      cursor: total > 0 ? 'pointer' : 'default',
                      flexShrink: 0,
                      transition: 'opacity 0.1s',
                    }}
                  />
                </OverlayTrigger>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
