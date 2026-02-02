import React, { useState, useEffect, useMemo } from 'react';
import { Container, Row, Col, Card, Button, Badge, Alert, Spinner, Tabs, Tab } from 'react-bootstrap';
import { PageHeader } from '../Components/PageHeader';
import { NotificationService } from '../Services/NotificationService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useNotificationStream } from '../hooks/useNotificationStream';
import type { EventNotification } from '../types/notifications';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const formatTimestamp = (
  timestamp: number,
  labels: {
    justNow: string;
    minutesAgo: (count: number) => string;
    hoursAgo: (count: number) => string;
    daysAgo: (count: number) => string;
  },
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
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warning';
    default:
      return 'secondary';
  }
};

const getEventTypeIcon = (eventType: string): string => {
  switch (eventType) {
    case 'started':
      return 'bi-play-circle';
    case 'completed':
      return 'bi-check-circle';
    case 'failed':
      return 'bi-x-circle';
    case 'cancelled':
      return 'bi-stop-circle';
    default:
      return 'bi-info-circle';
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
            : n,
        ),
      );
      refreshUnreadCount(numaGet);
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const dismissNotification = async (notificationId: string) => {
    try {
      const updated = await NotificationService.dismiss(numaPut, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.notification_id === notificationId ? { ...n, status: updated.status ?? 'dismissed' } : n)),
      );
      refreshUnreadCount(numaGet);
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
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

  const filteredNotifications = useMemo(() => {
    const filtered = notifications.filter((notification) => {
      if (activeTab === 'unread') return notification.status === 'unread';
      if (activeTab === 'read') return notification.status !== 'unread';
      return true;
    });

    return filtered.sort((a, b) => b.created_at - a.created_at);
  }, [notifications, activeTab]);

  return (
    <Container fluid className="py-4">
      <PageHeader title={t('notifications.title')} />

      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5>
              {t('notifications.title')}
              {unreadCount > 0 && (
                <Badge bg="danger" className="ms-2">
                  {t('notifications.unreadCount', { count: unreadCount })}
                </Badge>
              )}
            </h5>
            {unreadCount > 0 && (
              <Button variant="outline-primary" size="sm" onClick={markAllAsRead}>
                {t('notifications.actions.markAllRead')}
              </Button>
            )}
          </div>
          <Tabs
            activeKey={activeTab}
            onSelect={(key) => key && setActiveTab(key as 'unread' | 'read' | 'all')}
            className="mb-3"
          >
            <Tab eventKey="unread" title={t('notifications.tabs.unread', { count: unreadCount })} />
            <Tab eventKey="read" title={t('notifications.tabs.read', { count: readCount })} />
            <Tab eventKey="all" title={t('notifications.tabs.all', { count: notifications.length })} />
          </Tabs>

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
              <i className="bi bi-info-circle me-2" />
              {t('notifications.empty')}
            </Alert>
          )}

          {!loading && !error && notifications.length > 0 && filteredNotifications.length === 0 && (
            <Alert variant="light">
              <i className="bi bi-inbox me-2" />
              {t('notifications.emptyFiltered')}
            </Alert>
          )}

          {!loading && !error && filteredNotifications.length > 0 && (
            <div className="notification-list">
              {filteredNotifications.map((notification) => (
                <Card
                  key={notification.notification_id}
                  className={`mb-3 ${notification.status === 'unread' ? 'border-primary' : ''}`}
                >
                  <Card.Body>
                    <div className="d-flex justify-content-between align-items-start">
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center mb-2">
                          <i
                            className={`${getEventTypeIcon(notification.event_type)} text-${getEventTypeColor(notification.event_type)} me-2`}
                          />
                          <strong>{notification.title}</strong>
                          {notification.status === 'unread' && (
                            <Badge bg="primary" className="ms-2">
                              {t('notifications.labels.new')}
                            </Badge>
                          )}
                        </div>
                        <p className="mb-2">{notification.message}</p>
                        <small className="text-muted">
                          <i className="bi bi-clock me-1" />
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
                      <div className="d-flex flex-column gap-1">
                        {notification.schedule_id && (
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={async () => {
                              if (notification.status === 'unread') {
                                await markAsRead(notification.notification_id);
                              }
                              navigate(`/scheduling/${encodeURIComponent(notification.schedule_id)}`);
                            }}
                          >
                            {t('notifications.actions.viewSchedule')}
                          </Button>
                        )}
                        {notification.status === 'unread' && (
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => markAsRead(notification.notification_id)}
                          >
                            {t('notifications.actions.markRead')}
                          </Button>
                        )}
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => dismissNotification(notification.notification_id)}
                        >
                          {t('notifications.actions.dismiss')}
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => deleteNotification(notification.notification_id)}
                        >
                          {t('notifications.actions.delete')}
                        </Button>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              ))}
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
};
