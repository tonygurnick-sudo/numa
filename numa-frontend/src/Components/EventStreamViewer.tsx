import type React from 'react';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { Card, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { JobEvent } from '../types/apps';
import '../assets/styles/components/EventStreamViewer.scss';
import i18n from '../i18n';

interface EventStreamViewerProps {
  events: JobEvent[];
  isRunning: boolean;
  appName?: string;
  typicalDurationMinutes?: number;
  jobStatus?: string;
}

/**
 * Gets the Bootstrap badge variant based on job status
 */
const getStatusBadgeVariant = (status?: string): string => {
  if (!status) return 'secondary';

  const upperStatus = status.toUpperCase();

  if (upperStatus.includes('SUCCESS') || upperStatus.includes('COMPLETED')) {
    return 'success';
  }
  if (upperStatus.includes('PROCESSING') || upperStatus.includes('RUNNING') || upperStatus.includes('IN-PROGRESS')) {
    return 'primary';
  }
  if (upperStatus.includes('FAILURE') || upperStatus.includes('FAILED') || upperStatus.includes('ERROR')) {
    return 'danger';
  }

  return 'secondary';
};

/**
 * Formats job status for display
 */
const formatJobStatus = (status?: string): string => {
  if (!status) return '';

  // Capitalize and clean up status
  return status
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Formats a timestamp to a human-readable relative time or short format
 */
const formatTimestamp = (timestamp: string, t: TFunction): string => {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    // Less than 60 seconds: show "Xs ago"
    if (diffSecs < 60) {
      return t('eventStream.secondsAgo', { count: diffSecs });
    }

    // Less than 60 minutes: show "Xm ago"
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) {
      return t('eventStream.minutesAgo', { count: diffMins });
    }

    // Otherwise, show formatted time
    return date.toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    });
  } catch {
    return timestamp;
  }
};

const EventStreamViewer: React.FC<EventStreamViewerProps> = ({
  events,
  isRunning,
  appName,
  typicalDurationMinutes,
  jobStatus,
}) => {
  const { t } = useTranslation('common');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(isRunning);
  const [latestEventIndex, setLatestEventIndex] = useState<number>(-1);
  const [prevIsRunning, setPrevIsRunning] = useState<boolean>(isRunning);

  // Auto-expand when isRunning becomes true, auto-collapse when it becomes false
  useEffect(() => {
    if (isRunning && !isExpanded) {
      setIsExpanded(true);
    } else if (!isRunning && prevIsRunning) {
      // Auto-collapse when job completes
      setIsExpanded(false);
    }
    setPrevIsRunning(isRunning);
  }, [isRunning, prevIsRunning]);

  // Auto-scroll to bottom when new events arrive with smooth animation
  useEffect(() => {
    if (scrollContainerRef.current && events.length > 0) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });

      // Update latest event index for highlight animation
      setLatestEventIndex(events.length - 1);

      // Clear highlight after animation duration
      const timer = setTimeout(() => {
        setLatestEventIndex(-1);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [events]);

  const toggleExpanded = () => {
    setIsExpanded((prev) => !prev);
  };

  // Only show when app is running or has completed (has events)
  if (!isRunning && (!events || events.length === 0)) {
    return null;
  }

  const hasEvents = events && events.length > 0;
  const displayTitle = appName ? t('eventStream.appActivityLog', { appName }) : t('eventStream.activityLog');

  return (
    <Card className="event-stream-viewer mb-3">
      <Card.Header className={`event-stream-header ${isRunning ? 'pulsing' : ''}`}>
        <div className="event-stream-title">
          <svg
            className="event-stream-logo"
            width="20"
            height="20"
            viewBox="0 0 34 33"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="15.3877" width="3.2252" height="23.456" fill="currentColor" />
            <path d="M18.6123 0H21.8375V3.0786L20.6647 6.15719H18.6123V0Z" fill="currentColor" />
            <rect
              x="18.6123"
              y="32.252"
              width="3.2252"
              height="23.456"
              transform="rotate(-180 18.6123 32.252)"
              fill="currentColor"
            />
            <path
              d="M15.3877 32.252L12.1625 32.252L12.1625 29.1734L13.3353 26.0948L15.3877 26.0948L15.3877 32.252Z"
              fill="currentColor"
            />
            <rect
              x="33.126"
              y="14.5134"
              width="3.2252"
              height="23.456"
              transform="rotate(90 33.126 14.5134)"
              fill="currentColor"
            />
            <path
              d="M33.126 17.7386L33.126 20.9638L30.0474 20.9638L26.9688 19.791L26.9688 17.7386L33.126 17.7386Z"
              fill="currentColor"
            />
            <rect
              x="0.874023"
              y="17.7386"
              width="3.2252"
              height="23.456"
              transform="rotate(-90 0.874023 17.7386)"
              fill="currentColor"
            />
            <path
              d="M0.874023 14.5134L0.874024 11.2882L3.95262 11.2882L7.03122 12.461L7.03122 14.5134L0.874023 14.5134Z"
              fill="currentColor"
            />
          </svg>
          <strong>{displayTitle}</strong>
          {!isExpanded && hasEvents && <Badge bg="secondary">{events.length}</Badge>}
          {typicalDurationMinutes && (
            <span className="duration-text-header">
              {t('eventStream.typicalDuration', { count: typicalDurationMinutes })}
            </span>
          )}
        </div>
        <div className="event-stream-header-right">
          {jobStatus && (
            <Badge bg={getStatusBadgeVariant(jobStatus)} className="me-2">
              {formatJobStatus(jobStatus)}
            </Badge>
          )}
          <button
            type="button"
            className="event-stream-toggle btn btn-link p-0 text-decoration-none"
            onClick={toggleExpanded}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t('eventStream.collapse') : t('eventStream.expand')}
          >
            <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
          </button>
        </div>
      </Card.Header>

      {isExpanded && (
        <Card.Body className="p-0">
          <div ref={scrollContainerRef} className="event-stream-content">
            {hasEvents ? (
              events.map((event, index) => (
                <div
                  key={`${event.timestamp}-${index}`}
                  className={`event-stream-item ${index === latestEventIndex ? 'event-item-latest' : ''}`}
                >
                  <span className="event-timestamp">{formatTimestamp(event.timestamp, t)}</span>
                  <span className="event-message">{event.message}</span>
                </div>
              ))
            ) : (
              <div className="event-stream-empty">
                <i className="bi bi-hourglass-split text-muted"></i>
                <span className="text-muted">{t('eventStream.waiting')}</span>
              </div>
            )}
          </div>
        </Card.Body>
      )}
    </Card>
  );
};

export default EventStreamViewer;
