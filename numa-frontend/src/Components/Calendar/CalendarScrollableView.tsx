import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Calendar, momentLocalizer, Views, View } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useTranslation } from 'react-i18next';
import type { AgentSchedule } from '../../types/agentSchedules';
import { getCalendarRunTimes, describeCronExpression } from '../../utils/cronUtils';

// Configure the localizer for react-big-calendar
const localizer = momentLocalizer(moment);

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: AgentSchedule;
  eventType: 'agent' | 'application' | 'data_sync';
}

interface CalendarScrollableViewProps {
  schedules: AgentSchedule[];
  currentView: View;
  currentDate?: Date;
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slotInfo: { start: Date; end: Date; slots: Date[] }) => void;
  loading?: boolean;
}

interface PeriodGrid {
  date: Date;
  events: CalendarEvent[];
  viewType: View;
}

export const CalendarScrollableView: React.FC<CalendarScrollableViewProps> = ({
  schedules,
  currentView,
  currentDate = new Date(),
  onEventClick,
  onSlotClick,
  loading = false,
}) => {
  const { t } = useTranslation('agents');
  const containerRef = useRef<HTMLDivElement>(null);
  const [visiblePeriods, setVisiblePeriods] = useState<PeriodGrid[]>([]);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

  // Generate periods around a center date
  const generatePeriodsAroundCenter = useCallback(
    (center: Date, view: View, beforeCount: number = 10, afterCount: number = 10): PeriodGrid[] => {
      const periods: PeriodGrid[] = [];

      // Generate periods before center
      for (let i = beforeCount; i >= 1; i--) {
        const periodDate = new Date(center);

        switch (view) {
          case Views.DAY:
            periodDate.setDate(periodDate.getDate() - i);
            break;
          case Views.WEEK:
            periodDate.setDate(periodDate.getDate() - i * 7);
            break;
          case Views.MONTH:
          case Views.AGENDA:
            periodDate.setMonth(periodDate.getMonth() - i);
            break;
        }

        periods.push({
          date: periodDate,
          events: [],
          viewType: view,
        });
      }

      // Add center period
      periods.push({
        date: new Date(center),
        events: [],
        viewType: view,
      });

      // Generate periods after center
      for (let i = 1; i <= afterCount; i++) {
        const periodDate = new Date(center);

        switch (view) {
          case Views.DAY:
            periodDate.setDate(periodDate.getDate() + i);
            break;
          case Views.WEEK:
            periodDate.setDate(periodDate.getDate() + i * 7);
            break;
          case Views.MONTH:
          case Views.AGENDA:
            periodDate.setMonth(periodDate.getMonth() + i);
            break;
        }

        periods.push({
          date: periodDate,
          events: [],
          viewType: view,
        });
      }

      return periods;
    },
    []
  );

  // Initialize periods with current date centered
  useEffect(() => {
    const periods = generatePeriodsAroundCenter(currentDate, currentView);
    setVisiblePeriods(periods);
  }, [currentView, generatePeriodsAroundCenter, currentDate]);

  // Scroll to center period on view change
  const scrollToCenter = useCallback(() => {
    if (visiblePeriods.length === 0) return;

    // Find center period (index 10 in our 21-period array)
    const centerIndex = 10;
    const centerPeriod = visiblePeriods[centerIndex];

    if (centerPeriod) {
      const periodElement = document.querySelector(`[data-period="${centerPeriod.date.getTime()}"]`);
      if (periodElement) {
        periodElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [visiblePeriods]);

  // Scroll to center when periods change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(scrollToCenter);
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [scrollToCenter]);

  // Handle infinite scrolling
  const handleScroll = useCallback(() => {
    if (isScrolling || visiblePeriods.length === 0) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;

    if (scrollHeight <= clientHeight) return; // No scrolling needed

    const scrollPercentage = scrollTop / (scrollHeight - clientHeight);

    // Add periods to top when scrolling near beginning
    if (scrollPercentage < 0.2) {
      setIsScrolling(true);

      const firstPeriod = visiblePeriods[0];
      const newPeriods: PeriodGrid[] = [];

      // Generate 5 periods before the first period
      for (let i = 5; i >= 1; i--) {
        const periodDate = new Date(firstPeriod.date);

        switch (currentView) {
          case Views.DAY:
            periodDate.setDate(periodDate.getDate() - i);
            break;
          case Views.WEEK:
            periodDate.setDate(periodDate.getDate() - i * 7);
            break;
          case Views.MONTH:
          case Views.AGENDA:
            periodDate.setMonth(periodDate.getMonth() - i);
            break;
        }

        newPeriods.push({
          date: periodDate,
          events: [],
          viewType: currentView,
        });
      }

      // Store current scroll position
      const currentScrollTop = scrollTop;

      setVisiblePeriods((prev) => {
        const updated = [...newPeriods, ...prev];
        // Limit total periods to prevent memory issues
        return updated.length > 50 ? updated.slice(0, 50) : updated;
      });

      // Adjust scroll position to maintain visual continuity
      setTimeout(() => {
        // Calculate actual height of added periods
        const firstNewPeriod = document.querySelector(`[data-period="${newPeriods[0].date.getTime()}"]`);
        const actualHeight = firstNewPeriod
          ? firstNewPeriod.getBoundingClientRect().height * newPeriods.length
          : newPeriods.length * 800;
        const newScrollTop = currentScrollTop + actualHeight;
        window.scrollTo(0, newScrollTop);
        setIsScrolling(false);
      }, 100);
    }

    // Add periods to bottom when scrolling near end
    else if (scrollPercentage > 0.8) {
      setIsScrolling(true);

      const lastPeriod = visiblePeriods[visiblePeriods.length - 1];
      const newPeriods: PeriodGrid[] = [];

      // Generate 5 periods after the last period
      for (let i = 1; i <= 5; i++) {
        const periodDate = new Date(lastPeriod.date);

        switch (currentView) {
          case Views.DAY:
            periodDate.setDate(periodDate.getDate() + i);
            break;
          case Views.WEEK:
            periodDate.setDate(periodDate.getDate() + i * 7);
            break;
          case Views.MONTH:
          case Views.AGENDA:
            periodDate.setMonth(periodDate.getMonth() + i);
            break;
        }

        newPeriods.push({
          date: periodDate,
          events: [],
          viewType: currentView,
        });
      }

      setVisiblePeriods((prev) => {
        const updated = [...prev, ...newPeriods];
        // Limit total periods and remove from beginning if needed
        return updated.length > 50 ? updated.slice(-50) : updated;
      });

      setTimeout(() => setIsScrolling(false), 100);
    }
  }, [currentView, visiblePeriods, isScrolling]);

  // Debounced scroll handler
  useEffect(() => {
    const debouncedScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(handleScroll, 100);
    };

    window.addEventListener('scroll', debouncedScroll);
    return () => {
      window.removeEventListener('scroll', debouncedScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  // Transform schedules to calendar events for all visible periods
  const calendarEvents = useMemo((): CalendarEvent[] => {
    const events: CalendarEvent[] = [];

    if (!visiblePeriods.length) {
      return events;
    }

    schedules.forEach((schedule) => {
      try {
        // Skip deleted schedules
        if (schedule.status === 'deleted') {
          return;
        }

        // Generate run times for this schedule across all visible periods
        const earliestPeriod = visiblePeriods[0];
        const latestPeriod = visiblePeriods[visiblePeriods.length - 1];

        let startDate: Date;
        let endDate: Date;

        switch (currentView) {
          case Views.MONTH:
            startDate = moment(earliestPeriod.date).startOf('month').toDate();
            endDate = moment(latestPeriod.date).endOf('month').toDate();
            break;
          case Views.WEEK:
            startDate = moment(earliestPeriod.date).startOf('isoWeek').toDate();
            endDate = moment(latestPeriod.date).endOf('isoWeek').toDate();
            break;
          case Views.DAY:
            startDate = moment(earliestPeriod.date).startOf('day').toDate();
            endDate = moment(latestPeriod.date).endOf('day').toDate();
            break;
          case Views.AGENDA:
            startDate = moment(earliestPeriod.date).startOf('month').toDate();
            endDate = moment(latestPeriod.date).endOf('month').toDate();
            break;
          default:
            startDate = moment(earliestPeriod.date).startOf('month').toDate();
            endDate = moment(latestPeriod.date).endOf('month').toDate();
        }

        const runTimes = getCalendarRunTimes(schedule.cronExpression, startDate, endDate, schedule.timezone);

        runTimes.forEach((runTime, runIndex) => {
          const eventId = `${schedule.scheduleId}-${runIndex}`;
          const eventStart = new Date(runTime);
          const eventEnd = new Date(runTime);
          eventEnd.setMinutes(eventEnd.getMinutes() + 30); // 30-minute duration

          events.push({
            id: eventId,
            title: schedule.agentTitle || schedule.agentId || t('scheduling.labels.scheduledAgent'),
            start: eventStart,
            end: eventEnd,
            resource: schedule,
            eventType: 'agent',
          });
        });
      } catch (error) {
        console.error(`Error processing schedule ${schedule.scheduleId}:`, error);
      }
    });

    return events;
  }, [schedules, visiblePeriods, currentView, t]);

  // Distribute events to their respective periods
  const periodsWithEvents = useMemo((): PeriodGrid[] => {
    return visiblePeriods.map((period) => {
      let periodStart: Date;
      let periodEnd: Date;

      switch (currentView) {
        case Views.MONTH:
          periodStart = moment(period.date).startOf('month').toDate();
          periodEnd = moment(period.date).endOf('month').toDate();
          break;
        case Views.WEEK:
          periodStart = moment(period.date).startOf('isoWeek').toDate();
          periodEnd = moment(period.date).endOf('isoWeek').toDate();
          break;
        case Views.DAY:
          periodStart = moment(period.date).startOf('day').toDate();
          periodEnd = moment(period.date).endOf('day').toDate();
          break;
        case Views.AGENDA:
          periodStart = moment(period.date).startOf('month').toDate();
          periodEnd = moment(period.date).endOf('month').toDate();
          break;
        default:
          periodStart = moment(period.date).startOf('month').toDate();
          periodEnd = moment(period.date).endOf('month').toDate();
      }

      const periodEvents = calendarEvents.filter((event) => {
        const eventStart = new Date(event.start);
        return eventStart >= periodStart && eventStart <= periodEnd;
      });

      return {
        ...period,
        events: periodEvents,
      };
    });
  }, [visiblePeriods, calendarEvents, currentView]);

  // Handle event selection
  const handleEventSelect = useCallback(
    (event: CalendarEvent) => {
      if (onEventClick) {
        onEventClick(event);
      }
    },
    [onEventClick]
  );

  // Handle slot selection
  const handleSlotSelect = useCallback(
    (slotInfo: { start: Date; end: Date; slots: Date[] }) => {
      if (onSlotClick) {
        onSlotClick(slotInfo);
      }
    },
    [onSlotClick]
  );

  // Custom event styling
  const eventPropGetter = useCallback((event: CalendarEvent) => {
    let style: React.CSSProperties = {};

    switch (event.eventType) {
      case 'agent':
        style.backgroundColor = 'var(--brand-primary, #007bff)';
        style.borderColor = 'var(--brand-primary-hover, #0056b3)';
        break;
      case 'application':
        style.backgroundColor = '#28a745';
        style.borderColor = '#1e7e34';
        break;
      case 'data_sync':
        style.backgroundColor = '#6c757d';
        style.borderColor = '#495057';
        break;
    }

    return {
      style: {
        ...style,
        color: 'white',
        border: '1px solid',
        borderRadius: '4px',
        fontSize: '0.875rem',
        padding: '2px 4px',
      },
    };
  }, []);

  // Get period header format based on view
  const getPeriodHeaderFormat = (view: View): string => {
    switch (view) {
      case Views.MONTH:
        return 'MMMM YYYY';
      case Views.WEEK:
        return `[${t('scheduling.calendar.periodHeader.weekOf')}] MMM DD, YYYY`;
      case Views.DAY:
        return 'dddd, MMMM DD, YYYY';
      case Views.AGENDA:
        return 'MMMM YYYY';
      default:
        return 'MMMM YYYY';
    }
  };

  // Get calendar height based on view - fully expanded to avoid internal scrolling
  const getCalendarHeight = (view: View): string => {
    switch (view) {
      case Views.MONTH:
        return '700px';
      case Views.WEEK:
        return '1400px';
      case Views.DAY:
        return '1800px';
      case Views.AGENDA:
        return '60px';
      default:
        return '700px';
    }
  };

  // Custom period header component
  const PeriodHeader: React.FC<{ period: PeriodGrid }> = ({ period }) => (
    <div className="period-header bg-light border-bottom p-3 mb-3">
      <h4 className="mb-0 text-center">{moment(period.date).format(getPeriodHeaderFormat(currentView))}</h4>
      <small className="text-muted d-block text-center mt-1">
        {t('scheduling.calendar.eventCount', { count: period.events.length })}
      </small>
    </div>
  );

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
        <div className="spinner-border" role="status">
          <span className="visually-hidden">{t('scheduling.calendar.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="calendar-scrollable-view">
      {periodsWithEvents.map((period) => (
        <div
          key={`${currentView}-${period.date.getTime()}`}
          className="period-container mb-4"
          data-period={period.date.getTime()}
        >
          <PeriodHeader period={period} />
          <div style={{ height: getCalendarHeight(currentView), marginBottom: '2rem' }}>
            <Calendar
              localizer={localizer}
              events={period.events}
              startAccessor="start"
              endAccessor="end"
              view={currentView}
              views={[currentView]}
              date={currentView === Views.AGENDA && period.events.length > 0 ? period.events[0].start : period.date}
              onNavigate={() => {}}
              onView={() => {}}
              onSelectEvent={handleEventSelect}
              onSelectSlot={handleSlotSelect}
              selectable
              eventPropGetter={eventPropGetter}
              toolbar={false}
              style={{
                height: '100%',
                fontFamily:
                  'var(--font-family-base, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
              }}
              formats={{
                monthHeaderFormat: () => '',
                dayHeaderFormat: currentView === Views.WEEK ? 'ddd DD' : 'dddd',
                weekdayFormat: 'ddd',
                timeGutterFormat: 'h A',
                eventTimeRangeFormat: ({ start, end }) =>
                  `${moment(start).format('h:mm A')} - ${moment(end).format('h:mm A')}`,
                agendaTimeRangeFormat: ({ start, end }) =>
                  `${moment(start).format('h:mm A')} - ${moment(end).format('h:mm A')}`,
                agendaDateFormat: 'ddd MMM DD',
              }}
              popup
              tooltipAccessor={(event: CalendarEvent) =>
                t('scheduling.calendar.tooltipShort', {
                  title: event.title,
                  status: t(`scheduling.status.${event.resource.status}`, event.resource.status),
                  schedule: describeCronExpression(event.resource.cronExpression),
                })
              }
            />
          </div>
        </div>
      ))}

      <div className="text-center text-muted py-4">
        <small>
          <i className="bi bi-arrow-down me-1"></i>
          {t('scheduling.calendar.scrollMore', {
            unit:
              currentView === Views.MONTH
                ? t('scheduling.calendar.units.months')
                : currentView === Views.WEEK
                  ? t('scheduling.calendar.units.weeks')
                  : currentView === Views.DAY
                    ? t('scheduling.calendar.units.days')
                    : t('scheduling.calendar.units.periods'),
          })}
        </small>
      </div>
    </div>
  );
};

export default CalendarScrollableView;
