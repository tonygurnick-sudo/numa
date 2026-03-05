import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Calendar, momentLocalizer, Views } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useTranslation } from 'react-i18next';
import type { AgentSchedule } from '../../types/agentSchedules';
import { getNextRunTimes, describeCronExpression } from '../../utils/cronUtils';

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

interface CalendarTimelineViewProps {
  schedules: AgentSchedule[];
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slotInfo: { start: Date; end: Date; slots: Date[] }) => void;
  loading?: boolean;
}

interface MonthGrid {
  year: number;
  month: number;
  date: Date;
  events: CalendarEvent[];
}

export const CalendarTimelineView: React.FC<CalendarTimelineViewProps> = ({
  schedules,
  onEventClick,
  onSlotClick,
  loading = false,
}) => {
  const { t } = useTranslation('agents');
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleMonths, setVisibleMonths] = useState<MonthGrid[]>([]);
  const [centerDate] = useState(new Date());

  // Generate initial range of months (6 months before and after current date)
  const generateMonthRange = useCallback((center: Date, range: number = 6): MonthGrid[] => {
    const months: MonthGrid[] = [];

    for (let i = -range; i <= range; i++) {
      const monthDate = moment(center).add(i, 'month').startOf('month').toDate();
      months.push({
        year: monthDate.getFullYear(),
        month: monthDate.getMonth(),
        date: monthDate,
        events: [],
      });
    }

    return months;
  }, []);

  // Transform schedules to calendar events for all visible months
  const calendarEvents = useMemo((): CalendarEvent[] => {
    console.log('CALENDAR_TIMELINE_VIEW DEBUG: === STARTING EVENT GENERATION ===');
    console.log('CALENDAR_TIMELINE_VIEW DEBUG: Input schedules:', {
      totalSchedules: schedules.length,
      visibleMonths: visibleMonths.length,
      scheduleDetails: schedules.map((s) => ({
        id: s.scheduleId,
        status: s.status,
        cronExpression: s.cronExpression,
        agentTitle: s.agentTitle,
        label: s.label,
      })),
    });

    const events: CalendarEvent[] = [];

    if (!visibleMonths.length) {
      console.log('CALENDAR_TIMELINE_VIEW DEBUG: No visible months, returning empty events');
      return events;
    }

    const startDate = visibleMonths[0].date;
    const endDate = moment(visibleMonths[visibleMonths.length - 1].date)
      .endOf('month')
      .toDate();

    console.log('CALENDAR_TIMELINE_VIEW DEBUG: Date range for event generation:', {
      startDate,
      endDate,
      monthsSpan: moment(endDate).diff(moment(startDate), 'months'),
    });

    schedules.forEach((schedule, index) => {
      console.log(`CALENDAR_TIMELINE_VIEW DEBUG: --- Processing schedule ${index + 1}/${schedules.length} ---`);
      console.log('CALENDAR_TIMELINE_VIEW DEBUG: Schedule details:', {
        scheduleId: schedule.scheduleId,
        agentTitle: schedule.agentTitle,
        label: schedule.label,
        status: schedule.status,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone,
        eventType: schedule.eventType,
      });

      try {
        // Skip deleted schedules
        if (schedule.status === 'deleted') {
          console.log('CALENDAR_TIMELINE_VIEW DEBUG: Skipping deleted schedule');
          return;
        }

        // Skip schedules without cron expressions
        if (!schedule.cronExpression) {
          console.log('CALENDAR_TIMELINE_VIEW DEBUG: Skipping schedule - missing cronExpression');
          return;
        }

        console.log('CALENDAR_TIMELINE_VIEW DEBUG: Calling getNextRunTimes for schedule', schedule.scheduleId);

        // Generate events for the visible time range
        const futureRuns = getNextRunTimes(
          schedule.cronExpression,
          schedule.timezone || 'UTC',
          200 // Generate enough events to cover the visible range
        );

        console.log('CALENDAR_TIMELINE_VIEW DEBUG: getNextRunTimes returned:', {
          scheduleId: schedule.scheduleId,
          futureRunsCount: futureRuns.length,
          firstRun: futureRuns.length > 0 ? futureRuns[0] : null,
          lastRun: futureRuns.length > 0 ? futureRuns[futureRuns.length - 1] : null,
        });

        // Filter events to only include those in our visible range
        const filteredRuns = futureRuns.filter((runTime) => {
          const inRange = runTime >= startDate && runTime <= endDate;
          return inRange;
        });

        console.log('CALENDAR_TIMELINE_VIEW DEBUG: After date filtering:', {
          scheduleId: schedule.scheduleId,
          filteredCount: filteredRuns.length,
          totalGenerated: futureRuns.length,
        });

        let eventsCreatedForSchedule = 0;
        filteredRuns.forEach((runTime) => {
          const event = {
            id: `${schedule.scheduleId}-${runTime.getTime()}`,
            title: schedule.label || schedule.agentTitle || t('scheduling.labels.scheduledTask'),
            start: runTime,
            end: new Date(runTime.getTime() + 60 * 60 * 1000), // 1-hour duration
            resource: schedule,
            eventType: schedule.eventType || 'agent',
          };

          events.push(event);
          eventsCreatedForSchedule++;

          if (eventsCreatedForSchedule <= 2) {
            // Log first 2 events per schedule
            console.log(`CALENDAR_TIMELINE_VIEW DEBUG: Created event ${eventsCreatedForSchedule}:`, {
              id: event.id,
              title: event.title,
              start: event.start,
              eventType: event.eventType,
            });
          }
        });

        console.log(
          `CALENDAR_TIMELINE_VIEW DEBUG: Created ${eventsCreatedForSchedule} events for schedule ${schedule.scheduleId}`
        );
      } catch (error) {
        console.error('CALENDAR_TIMELINE_VIEW ERROR: Failed to process schedule:', {
          scheduleId: schedule.scheduleId,
          cronExpression: schedule.cronExpression,
          error,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorStack: error instanceof Error ? error.stack : undefined,
        });
      }
    });

    console.log('CALENDAR_TIMELINE_VIEW DEBUG: === EVENT GENERATION COMPLETE ===');
    console.log('CALENDAR_TIMELINE_VIEW DEBUG: Final results:', {
      totalEventsGenerated: events.length,
      eventsByMonth: visibleMonths.map((month) => {
        const monthStart = moment(month.date).startOf('month').toDate();
        const monthEnd = moment(month.date).endOf('month').toDate();
        const monthEvents = events.filter((event) => event.start >= monthStart && event.start <= monthEnd);
        return {
          month: moment(month.date).format('MMMM YYYY'),
          eventCount: monthEvents.length,
        };
      }),
    });

    return events;
  }, [schedules, visibleMonths, t]);

  // Distribute events to their respective months
  const monthsWithEvents = useMemo((): MonthGrid[] => {
    return visibleMonths.map((month) => {
      const monthStart = moment(month.date).startOf('month').toDate();
      const monthEnd = moment(month.date).endOf('month').toDate();

      const monthEvents = calendarEvents.filter((event) => event.start >= monthStart && event.start <= monthEnd);

      return {
        ...month,
        events: monthEvents,
      };
    });
  }, [visibleMonths, calendarEvents]);

  // Initialize visible months
  useEffect(() => {
    setVisibleMonths(generateMonthRange(centerDate));
  }, [generateMonthRange, centerDate]);

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

  // Custom month header component
  const MonthHeader: React.FC<{ month: MonthGrid }> = ({ month }) => (
    <div className="month-header bg-light border-bottom p-3 mb-3">
      <h4 className="mb-0 text-center">{moment(month.date).format('MMMM YYYY')}</h4>
      <small className="text-muted d-block text-center mt-1">
        {t('scheduling.calendar.eventCount', { count: month.events.length })}
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
    <div
      ref={containerRef}
      className="calendar-timeline-view"
      style={{
        maxHeight: '80vh',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {monthsWithEvents.map((month) => (
        <div key={`${month.year}-${month.month}`} className="month-container mb-4">
          <MonthHeader month={month} />
          <div style={{ height: '600px', marginBottom: '2rem' }}>
            <Calendar
              localizer={localizer}
              events={month.events}
              startAccessor="start"
              endAccessor="end"
              view={Views.MONTH}
              views={[Views.MONTH]}
              date={month.date}
              onNavigate={() => {}} // Disable navigation - we handle it with scrolling
              onView={() => {}} // Lock to month view
              onSelectEvent={handleEventSelect}
              onSelectSlot={handleSlotSelect}
              selectable
              eventPropGetter={eventPropGetter}
              toolbar={false} // Remove toolbar since we have our own header
              style={{
                height: '100%',
                fontFamily:
                  'var(--font-family-base, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
              }}
              formats={{
                monthHeaderFormat: () => '', // Empty since we have custom header
                dayHeaderFormat: 'ddd',
                eventTimeRangeFormat: ({ start, end }) =>
                  `${moment(start).format('h:mm A')} - ${moment(end).format('h:mm A')}`,
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

      {/* Scroll hint */}
      <div className="text-center text-muted py-4">
        <small>
          <i className="bi bi-arrow-down me-1"></i>
          {t('scheduling.calendar.scrollHint')}
        </small>
      </div>
    </div>
  );
};

export default CalendarTimelineView;
