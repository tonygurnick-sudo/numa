import React, { useEffect } from 'react';
import { Button, Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNotificationStream } from '../../hooks/useNotificationStream';
import { useNumaRequest } from '../../Providers/NumaRequestContext';

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { numaGet } = useNumaRequest();
  const { unreadCount, isConnected, refreshUnreadCount } = useNotificationStream();
  const { t } = useTranslation('common');

  // Load initial unread count
  useEffect(() => {
    refreshUnreadCount(numaGet);
  }, [refreshUnreadCount, numaGet]);

  const handleClick = () => {
    navigate('/notifications');
  };

  return (
    <Button
      variant="outline-secondary"
      className="position-relative me-2"
      onClick={handleClick}
      title={t('notifications.unreadCountTitle', { count: unreadCount })}
    >
      <i className="bi bi-bell" />
      {unreadCount > 0 && (
        <Badge
          bg="danger"
          pill
          className="position-absolute top-0 start-100 translate-middle"
          style={{ fontSize: '0.7rem' }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
      {!isConnected && (
        <i
          className="bi bi-exclamation-triangle text-warning position-absolute"
          style={{ fontSize: '0.6rem', top: '-2px', right: '-2px' }}
          title={t('notifications.streamDisconnected')}
        />
      )}
    </Button>
  );
};
