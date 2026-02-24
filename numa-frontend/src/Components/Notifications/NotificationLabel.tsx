import React, { useEffect } from 'react';
import { Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNotificationStream } from '../../hooks/useNotificationStream';
import { useNumaRequest } from '../../Providers/NumaRequestContext';

export const NotificationLabel: React.FC = () => {
  const { numaGet } = useNumaRequest();
  const { unreadCount, refreshUnreadCount } = useNotificationStream();
  const { t } = useTranslation('common');

  // Load initial unread count
  useEffect(() => {
    refreshUnreadCount(numaGet);
  }, [refreshUnreadCount, numaGet]);

  return (
    <span className="d-inline-flex align-items-center notification-nav-label">
      {t('notifications.title')}
      {unreadCount > 0 && (
        <Badge bg="danger" pill className="ms-2 notification-nav-badge">
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </span>
  );
};
