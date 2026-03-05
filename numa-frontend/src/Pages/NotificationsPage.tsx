import React, { useState, useEffect, useMemo } from 'react';
import { Container, Card, Button, Badge, Alert, Spinner } from 'react-bootstrap';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Eye,
  Info,
  PlayCircle,
  RefreshCw,
  StopCircle,
  Trash2,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '../Components/PageHeader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { NotificationService } from '../Services/NotificationService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useNotificationStream } from '../hooks/useNotificationStream';
import type { EventNotification } from '../types/notifications';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';

const formatTimestamp = (
  timestamp: number,
  labels: {
    justNow: string;
    minutesAgo: (count: number) => string;
    hoursAgo: (count: number) => string;
    daysAgo: (count: number) => string;
  }
): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return labels.justNow;
  if (diffMins < 60) return labels.minutesAgo(diffMins);
  if (diffHours < 24) return labels.hoursAgo(diffHours);
  if (diffDays < 7) return labels.daysAgo(diffDays);
  return date.toLocaleDateString();
};

const getEventTypeColor = (eventType: string): string => {
  switch (eventType) {
    case 'started':
      return 'primary';
    case 'completed':
      return 'success';
    case 'partial':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warning';
    default:
      return 'secondary';
  }
};

const getEventTypeIcon = (eventType: string) => {
  switch (eventType) {
    case 'started':
      return PlayCircle;
    case 'completed':
      return CheckCircle2;
    case 'partial':
      return AlertTriangle;
    case 'failed':
      return XCircle;
    case 'cancelled':
      return StopCircle;
    default:
      return Info;
  }
};

export const NotificationsPage: React.FC = () => {
  const { numaGet, numaPut, numaDelete } = useNumaRequest();
  const { refreshUnreadCount } = useNotificationStream();
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const [notifications, setNotifications] = useState<EventNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'unread' | 'read' | 'all'>('unread');
  const formatRelativeTime = (timestamp: number) =>
    formatTimestamp(timestamp, {
      justNow: t('notifications.time.justNow'),
      minutesAgo: (count) => t('notifications.time.minutesAgo', { count }),
      hoursAgo: (count) => t('notifications.time.hoursAgo', { count }),
      daysAgo: (count) => t('notifications.time.daysAgo', { count }),
    });
  const getEventTypeLabel = (eventType: string) => t(`notifications.eventTypes.${eventType}`, eventType);
  const getScheduleTypeLabel = (scheduleType: string) => t(`notifications.scheduleTypes.${scheduleType}`, scheduleType);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await NotificationService.list(numaGet);
      setNotifications(data);
      refreshUnreadCount(numaGet);
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setError(t('notifications.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const updated = await NotificationService.markAsRead(numaPut, notificationId);
      setNotifications((prev) =>
        prev.map((n) =>
          n.notification_id === notificationId
            ? { ...n, status: updated.status ?? 'read', read_at: updated.read_at ?? Date.now() }
            : n
        )
      );
      refreshUnreadCount(numaGet);
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      await NotificationService.delete(numaDelete, notificationId);
      setNotifications((prev) => prev.filter((n) => n.notification_id !== notificationId));
      refreshUnreadCount(numaGet);
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  };

  const markAllAsRead = async () => {
    const unreadNotifications = notifications.filter((n) => n.status === 'unread');
    await Promise.all(unreadNotifications.map((n) => markAsRead(n.notification_id)));
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;
  const readCount = notifications.filter((n) => n.status !== 'unread').length;
  const notificationTabs = useMemo(
    () => [
      { key: 'unread', label: t('notifications.tabs.unread', { count: unreadCount }) },
      { key: 'read', label: t('notifications.tabs.read', { count: readCount }) },
      { key: 'all', label: t('notifications.tabs.all', { count: notifications.length }) },
    ],
    [notifications.length, readCount, t, unreadCount]
  );

  const filteredNotifications = useMemo(() => {
    const filtered = notifications.filter((notification) => {
      if (activeTab === 'unread') return notification.status === 'unread';
      if (activeTab === 'read') return notification.status !== 'unread';
      return true;
    });

    return filtered.sort((a, b) => b.created_at - a.created_at);
  }, [notifications, activeTab]);

  return (
    <div className="dashboard">
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          <>
            <Button variant="secondary" className="standard-refresh-btn" onClick={loadNotifications} disabled={loading}>
              {loading ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  <span className="standard-refresh-btn__label">{t('notifications.actions.refresh')}</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} className="standard-refresh-btn__icon" aria-hidden="true" />
                  <span className="standard-refresh-btn__label">{t('notifications.actions.refresh')}</span>
                </>
              )}
            </Button>
            {unreadCount > 0 && (
              <Button variant="secondary" className="standard-refresh-btn" onClick={markAllAsRead}>
                <CheckCheck size={16} className="standard-refresh-btn__icon" aria-hidden="true" />
                <span className="standard-refresh-btn__label">{t('notifications.actions.markAllRead')}</span>
              </Button>
            )}
          </>
        }
      />
      <SubHeaderTabBar
        items={notificationTabs}
        activeKey={activeTab}
        onSelect={(key) => setActiveTab((key as 'unread' | 'read' | 'all') || 'unread')}
        ariaLabel={t('notifications.title')}
      />
      <LayoutDashboard>
        <Container fluid className="notifications-page-content px-0">
          {loading && (
            <div className="text-center py-4">
              <Spinner animation="border" />
              <div className="mt-2">{t('notifications.loading')}</div>
            </div>
          )}

          {error && (
            <Alert variant="danger">
              {error}
              <Button variant="link" className="p-0 ms-2" onClick={loadNotifications}>
                {t('notifications.actions.tryAgain')}
              </Button>
            </Alert>
          )}

          {!loading && !error && notifications.length === 0 && (
            <Alert variant="info">
              <Info size={16} className="me-2" aria-hidden="true" />
              {t('notifications.empty')}
            </Alert>
          )}

          {!loading && !error && notifications.length > 0 && filteredNotifications.length === 0 && (
            <Alert variant="light">
              <Info size={16} className="me-2" aria-hidden="true" />
              {t('notifications.emptyFiltered')}
            </Alert>
          )}

          {!loading && !error && filteredNotifications.length > 0 && (
            <div className="notification-list">
              {filteredNotifications.map((notification) => (
                <Card
                  key={notification.notification_id}
                  className={`mb-3 notifications-card ${notification.status === 'unread' ? 'is-unread' : ''}`}
                >
                  <Card.Body>
                    <div className="notifications-card-main">
                      <div className="flex-grow-1">
                        <div className="notifications-event-title mb-2">
                          {(() => {
                            const EventIcon = getEventTypeIcon(notification.event_type);
                            return (
                              <EventIcon
                                size={16}
                                className={`notifications-event-icon text-${getEventTypeColor(notification.event_type)}`}
                                aria-hidden="true"
                              />
                            );
                          })()}
                          <strong>{notification.title}</strong>
                          {notification.status === 'unread' && (
                            <Badge bg="primary" className="ms-2">
                              {t('notifications.labels.new')}
                            </Badge>
                          )}
                        </div>
                        <p className="mb-2">{notification.message}</p>
                        {/* Result preview for completed / partial runs */}
                        {(notification.event_type === 'completed' || notification.event_type === 'partial') &&
                          notification.metadata?.result && (
                            <div className="notifications-result-preview mb-2">
                              {notification.event_type === 'partial' ? (
                                <AlertTriangle
                                  size={13}
                                  className="notifications-result-preview__icon text-warning"
                                  aria-hidden="true"
                                />
                              ) : (
                                <CheckCircle2
                                  size={13}
                                  className="notifications-result-preview__icon text-success"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="notifications-result-preview__text">
                                {String(notification.metadata.result).substring(0, 200)}
                                {String(notification.metadata.result).length > 200 ? '…' : ''}
                              </span>
                            </div>
                          )}
                        {/* Error detail for failed runs */}
                        {notification.event_type === 'failed' && notification.metadata?.error && (
                          <div className="notifications-error-preview mb-2">
                            <AlertTriangle size={13} className="notifications-error-preview__icon" aria-hidden="true" />
                            <span className="notifications-error-preview__text">
                              {String(notification.metadata.error).substring(0, 200)}
                              {String(notification.metadata.error).length > 200 ? '…' : ''}
                            </span>
                          </div>
                        )}
                        <small className="text-muted notifications-meta">
                          <Clock3 size={14} aria-hidden="true" />
                          {formatRelativeTime(notification.created_at)}
                          <span className="mx-2">•</span>
                          <Badge bg="secondary" className="me-2">
                            {getScheduleTypeLabel(notification.schedule_type)}
                          </Badge>
                          <Badge bg={getEventTypeColor(notification.event_type)}>
                            {getEventTypeLabel(notification.event_type)}
                          </Badge>
                        </small>
                      </div>
                      <div className="notifications-card-actions">
                        {notification.schedule_id && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="notifications-action-btn"
                            onClick={async () => {
                              if (notification.status === 'unread') {
                                await markAsRead(notification.notification_id);
                              }
                              const runId = notification.metadata?.runId as string | undefined;
                              const path = `/scheduling/${encodeURIComponent(notification.schedule_id)}`;
                              navigate(runId ? `${path}?run=${encodeURIComponent(runId)}` : path);
                            }}
                          >
                            <Eye size={14} aria-hidden="true" />
                            {t('notifications.actions.viewSchedule')}
                          </Button>
                        )}
                        {notification.status === 'unread' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="notifications-action-btn"
                            onClick={() => markAsRead(notification.notification_id)}
                          >
                            <Check size={14} aria-hidden="true" />
                            {t('notifications.actions.markRead')}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          className="notifications-action-btn notifications-action-btn--danger"
                          onClick={() => deleteNotification(notification.notification_id)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {t('notifications.actions.delete')}
                        </Button>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              ))}
            </div>
          )}
        </Container>
      </LayoutDashboard>
    </div>
  );
};
