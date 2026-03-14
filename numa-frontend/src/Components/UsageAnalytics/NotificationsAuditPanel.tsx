import { useState, useEffect, useCallback } from 'react';
import { Table, Form, Button, Spinner, Badge, Row, Col, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { NotificationService } from '../../Services/NotificationService';
import type { EventNotification } from '../../types/notifications';

/**
 * Audit panel for viewing all notifications across the system.
 * Displays event notifications with type/status filters, detail modal, and mark-as-read actions.
 */
export default function NotificationsAuditPanel() {
  const { t } = useTranslation('settings');
  const { numaGet, numaPut } = useNumaRequest();

  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<EventNotification[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedNotification, setSelectedNotification] = useState<EventNotification | null>(null);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const all = await NotificationService.list(numaGet);
      setNotifications(all);
    } catch (e) {
      console.error('Failed to load notifications', e);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const filtered = notifications.filter((n) => {
    if (typeFilter && n.schedule_type !== typeFilter) return false;
    if (statusFilter && n.status !== statusFilter) return false;
    return true;
  });

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await NotificationService.markAsRead(numaPut, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.notification_id === notificationId ? { ...n, status: 'read' as const } : n))
      );
    } catch (e) {
      console.error('Failed to mark notification as read', e);
    }
  };

  const handleDismiss = async (notificationId: string) => {
    try {
      await NotificationService.dismiss(numaPut, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.notification_id === notificationId ? { ...n, status: 'dismissed' as const } : n))
      );
    } catch (e) {
      console.error('Failed to dismiss notification', e);
    }
  };

  const eventBadge = (eventType: string) => {
    const variant: Record<string, string> = {
      started: 'info',
      completed: 'success',
      partial: 'warning',
      failed: 'danger',
      cancelled: 'secondary',
    };
    return (
      <Badge bg={variant[eventType] || 'secondary'}>
        {t(`notificationAudit.eventTypes.${eventType}`, { defaultValue: eventType })}
      </Badge>
    );
  };

  const readStatusBadge = (status: string) => {
    const variant: Record<string, string> = {
      unread: 'primary',
      read: 'light',
      dismissed: 'secondary',
    };
    return (
      <Badge bg={variant[status] || 'secondary'} text={status === 'read' ? 'dark' : undefined}>
        {t(`notificationAudit.statuses.${status}`, { defaultValue: status })}
      </Badge>
    );
  };

  const copyToClipboard = () => {
    if (selectedNotification) {
      navigator.clipboard.writeText(JSON.stringify(selectedNotification, null, 2));
    }
  };

  return (
    <>
      <Row className="mb-3">
        <Col md={3}>
          <Form.Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label={t('notificationAudit.filters.typeFilter')}
          >
            <option value="">{t('notificationAudit.filters.allTypes')}</option>
            <option value="agent">{t('notificationAudit.types.agent')}</option>
            <option value="application">{t('notificationAudit.types.application')}</option>
            <option value="data_sync">{t('notificationAudit.types.data_sync')}</option>
            <option value="transcription">{t('notificationAudit.types.transcription')}</option>
          </Form.Select>
        </Col>
        <Col md={3}>
          <Form.Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t('notificationAudit.filters.statusFilter')}
          >
            <option value="">{t('notificationAudit.filters.allStatuses')}</option>
            <option value="unread">{t('notificationAudit.statuses.unread')}</option>
            <option value="read">{t('notificationAudit.statuses.read')}</option>
            <option value="dismissed">{t('notificationAudit.statuses.dismissed')}</option>
          </Form.Select>
        </Col>
        <Col md={6} className="d-flex justify-content-end">
          <Button variant="outline-primary" size="sm" onClick={loadNotifications} disabled={loading}>
            <i className="bi bi-arrow-clockwise me-1"></i>
            {t('common:refresh', { defaultValue: 'Refresh' })}
          </Button>
        </Col>
      </Row>

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <Table striped bordered hover>
              <thead>
                <tr>
                  <th>{t('notificationAudit.table.timestamp')}</th>
                  <th>{t('notificationAudit.table.title')}</th>
                  <th>{t('notificationAudit.table.message')}</th>
                  <th>{t('notificationAudit.table.type')}</th>
                  <th>{t('notificationAudit.table.eventType')}</th>
                  <th>{t('notificationAudit.table.readStatus')}</th>
                  <th>{t('notificationAudit.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">
                      {t('notificationAudit.table.noNotifications')}
                    </td>
                  </tr>
                ) : (
                  filtered.map((n) => (
                    <tr key={n.notification_id}>
                      <td>
                        {new Date(n.created_at).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td>{n.title}</td>
                      <td className="text-truncate" style={{ maxWidth: '300px' }}>
                        {n.message}
                      </td>
                      <td>
                        <Badge bg="outline-secondary" text="dark" className="border">
                          {t(`notificationAudit.types.${n.schedule_type}`, { defaultValue: n.schedule_type })}
                        </Badge>
                      </td>
                      <td>{eventBadge(n.event_type)}</td>
                      <td>{readStatusBadge(n.status)}</td>
                      <td>
                        <div className="d-flex gap-1">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => setSelectedNotification(n)}
                            title={t('notificationAudit.detailModal.title')}
                          >
                            <i className="bi bi-eye"></i>
                          </Button>
                          {n.status === 'unread' && (
                            <Button
                              size="sm"
                              variant="outline-success"
                              onClick={() => handleMarkAsRead(n.notification_id)}
                              title={t('notificationAudit.statuses.read')}
                            >
                              <i className="bi bi-check"></i>
                            </Button>
                          )}
                          {n.status !== 'dismissed' && (
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => handleDismiss(n.notification_id)}
                              title={t('notificationAudit.statuses.dismissed')}
                            >
                              <i className="bi bi-x"></i>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>

          <span className="text-muted small">{t('notificationAudit.table.showing', { count: filtered.length })}</span>
        </>
      )}

      <Modal show={!!selectedNotification} onHide={() => setSelectedNotification(null)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{t('notificationAudit.detailModal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedNotification && (
            <>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">{selectedNotification.title}</h6>
                <Button variant="outline-secondary" size="sm" onClick={copyToClipboard}>
                  <i className="bi bi-clipboard me-1"></i>
                  {t('common:copy', { defaultValue: 'Copy' })}
                </Button>
              </div>
              <pre
                className="bg-light p-3 rounded"
                style={{ maxHeight: '500px', overflow: 'auto', fontSize: '0.875rem' }}
              >
                {JSON.stringify(selectedNotification, null, 2)}
              </pre>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelectedNotification(null)}>
            {t('common:close', { defaultValue: 'Close' })}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
