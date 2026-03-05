import React, { useMemo, useCallback } from 'react';
import { Calendar, momentLocalizer, View, Views } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useTranslation } from 'react-i18next';
import type { AgentSchedule } from '../../types/agentSchedules';
import { describeCronExpression, getRunTimesInRange } from '../../utils/cronUtils';

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

interface CalendarScheduleViewProps {
  schedules: AgentSchedule[];
  currentView: View;
  currentDate: Date;
  onViewChange: (view: View) => void;
  onDateChange: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (slotInfo: { start: Date; end: Date; slots: Date[] }) => void;
  loading?: boolean;
}

export const CalendarScheduleView: React.FC<CalendarScheduleViewProps> = ({
  schedules,
  currentView,
  currentDate,
  onViewChange,
  onDateChange,
  onEventClick,
  onSlotClick,
  loading = false,
}) => {
  const { t } = useTranslation('agents');
  const getRangeForView = useCallback(() => {
    switch (currentView) {
      case Views.MONTH:
        return {
          start: moment(currentDate).startOf('month').toDate(),
          end: moment(currentDate).endOf('month').toDate(),
        };
      case Views.WEEK:
        return {
          start: moment(currentDate).startOf('week').toDate(),
          end: moment(currentDate).endOf('week').toDate(),
        };
      case Views.DAY:
        return {
          start: moment(currentDate).startOf('day').toDate(),
          end: moment(currentDate).endOf('day').toDate(),
        };
      case Views.AGENDA:
        return {
          start: moment(currentDate).startOf('week').toDate(),
          end: moment(currentDate).endOf('week').toDate(),
        };
      default:
        return {
          start: moment(currentDate).startOf('month').toDate(),
          end: moment(currentDate).endOf('month').toDate(),
        };
    }
  }, [currentDate, currentView]);

  // Transform schedules to calendar events
  const calendarEvents = useMemo((): CalendarEvent[] => {
    const events: CalendarEvent[] = [];
    const { start, end } = getRangeForView();

    schedules.forEach((schedule) => {
      try {
        // Skip deleted schedules
        if (schedule.status === 'deleted') return;

        const runTimes = getRunTimesInRange(schedule.cronExpression, start, end, schedule.timezone || 'UTC');

        runTimes.forEach((runTime, index) => {
          events.push({
            id: `${schedule.scheduleId}-${index}`,
            title: schedule.label || schedule.agentTitle || t('scheduling.labels.scheduledTask'),
            start: runTime,
            end: new Date(runTime.getTime() + 30 * 60 * 1000),
            resource: schedule,
            eventType: schedule.eventType || 'agent',
          });
        });
      } catch (error) {
        console.warn('Error processing schedule:', schedule.scheduleId, error);
      }
    });

    return events;
  }, [getRangeForView, schedules, t]);

  // Handle event selection
  const handleEventSelect = useCallback(
    (event: CalendarEvent) => {
      if (onEventClick) {
        onEventClick(event);
      }
    },
    [onEventClick]
  );

  // Handle slot selection (empty space clicks)
  const handleSlotSelect = useCallback(
    (slotInfo: { start: Date; end: Date; slots: Date[] }) => {
      if (onSlotClick) {
        onSlotClick(slotInfo);
      }
    },
    [onSlotClick]
  );

  // Custom event component styling based on event type
  const eventPropGetter = useCallback((event: CalendarEvent) => {
    let className = 'calendar-event';

    switch (event.eventType) {
      case 'agent':
        className += ' calendar-event-agent';
        break;
      case 'application':
        className += ' calendar-event-application';
        break;
      case 'data_sync':
        className += ' calendar-event-data-sync';
        break;
    }

    return {
      className,
      style: {},
    };
  }, []);

  const CustomToolbar = () => <div className="rbc-toolbar" style={{ display: 'none' }} />;

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
      className="calendar-schedule-view calendar-schedule-view--neutral"
      style={{
        height: '600px',
        position: 'relative',
      }}
    >
      <Calendar
        localizer={localizer}
        events={calendarEvents}
        startAccessor="start"
        endAccessor="end"
        view={currentView}
        views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
        date={currentDate}
        onView={onViewChange}
        onNavigate={onDateChange}
        onSelectEvent={handleEventSelect}
        onSelectSlot={handleSlotSelect}
        selectable
        eventPropGetter={eventPropGetter}
        components={{
          toolbar: CustomToolbar,
        }}
        style={{
          height: '100%',
          fontFamily: 'var(--font-family-base, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
        }}
        formats={{
          monthHeaderFormat: 'MMMM YYYY',
          dayHeaderFormat: 'dddd, MMMM Do',
          dayRangeHeaderFormat: ({ start, end }) =>
            `${moment(start).format('MMM DD')} - ${moment(end).format('MMM DD, YYYY')}`,
          agendaHeaderFormat: ({ start, end }) =>
            `${moment(start).format('MMM DD')} - ${moment(end).format('MMM DD, YYYY')}`,
          eventTimeRangeFormat: ({ start, end }) =>
            `${moment(start).format('h:mm A')} - ${moment(end).format('h:mm A')}`,
        }}
        popup
        tooltipAccessor={(event: CalendarEvent) =>
          t('scheduling.calendar.tooltip', {
            title: event.title,
            status: t(`scheduling.status.${event.resource.status}`, event.resource.status),
            schedule: describeCronExpression(event.resource.cronExpression),
          })
        }
      />
    </div>
  );
};

export default CalendarScheduleView;
