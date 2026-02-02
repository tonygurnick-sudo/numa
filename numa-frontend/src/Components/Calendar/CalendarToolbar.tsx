import React, { useMemo } from 'react';
import { Row, Col, Button, ButtonGroup } from 'react-bootstrap';
import { View } from 'react-big-calendar';
import moment from 'moment';
import { useTranslation } from 'react-i18next';

export type EventTypeFilter = 'agent' | 'application' | 'data_sync';

interface CalendarToolbarProps {
  currentView: View | 'timeline';
  currentDate: Date;
  onViewChange: (view: View | 'timeline') => void;
  selectedEventTypes: EventTypeFilter[];
  onEventTypeChange: (eventTypes: EventTypeFilter[]) => void;
  onTodayClick: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onRefresh: () => void;
  loading?: boolean;
  eventCounts?: {
    agent: number;
    application: number;
    data_sync: number;
  };
}

export const CalendarToolbar: React.FC<CalendarToolbarProps> = ({
  currentView,
  currentDate,
  onViewChange,
  selectedEventTypes: _selectedEventTypes,
  onEventTypeChange: _onEventTypeChange,
  onTodayClick,
  onNavigate,
  onRefresh: _onRefresh,
  loading: _loading = false,
  eventCounts: _eventCounts = { agent: 0, application: 0, data_sync: 0 },
}) => {
  const { t } = useTranslation('agents');
  const viewConfig = useMemo(
    () => ({
      month: { label: t('scheduling.calendar.views.month'), icon: 'bi bi-calendar' },
      week: { label: t('scheduling.calendar.views.week'), icon: 'bi bi-calendar-week' },
      day: { label: t('scheduling.calendar.views.day'), icon: 'bi bi-calendar-date' },
      agenda: { label: t('scheduling.calendar.views.agenda'), icon: 'bi bi-list-ul' },
    }),
    [t],
  );
  const rangeLabel = useMemo(() => {
    if (currentView === 'month') {
      return moment(currentDate).format('MMMM YYYY');
    }
    if (currentView === 'day') {
      return moment(currentDate).format('dddd, MMM D');
    }
    const start = moment(currentDate).startOf('week');
    const end = moment(currentDate).endOf('week');
    return `${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`;
  }, [currentDate, currentView]);
  return (
    <div className="calendar-toolbar border-bottom pb-3 mb-3 sticky-top bg-white" style={{ zIndex: 1020 }}>
      <Row className="align-items-center">
        {/* View Controls and Action Buttons */}
        <Col>
          <div className="d-flex align-items-center gap-3">
            <ButtonGroup size="sm">
              {Object.entries(viewConfig).map(([viewKey, config]) => (
                <Button
                  key={viewKey}
                  variant={currentView === viewKey ? 'primary' : 'outline-primary'}
                  onClick={() => onViewChange(viewKey as View | 'timeline')}
                  title={config.label}
                >
                  <i className={`${config.icon} me-1`}></i>
                  {config.label}
                </Button>
              ))}
            </ButtonGroup>

            <ButtonGroup size="sm">
              <Button
                variant="outline-secondary"
                onClick={() => onNavigate('prev')}
                title={t('scheduling.calendar.navigation.previous')}
              >
                <i className="bi bi-chevron-left"></i>
              </Button>
              <Button
                variant="outline-secondary"
                onClick={onTodayClick}
                title={t('scheduling.calendar.navigation.today')}
              >
                <i className="bi bi-calendar-check me-1"></i>
                {t('scheduling.calendar.navigation.today')}
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => onNavigate('next')}
                title={t('scheduling.calendar.navigation.next')}
              >
                <i className="bi bi-chevron-right"></i>
              </Button>
            </ButtonGroup>

            <div className="text-muted small fw-semibold">{rangeLabel}</div>
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default CalendarToolbar;
