import React from 'react';
import { Card, Badge, Button } from 'react-bootstrap';
import { Eye } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import type { User } from './UserDetailsModal';
import { getUserStatusBadgeVariant, getUserStatusLabel } from './userStatusUtils';

interface UserCardProps {
  user: User;
  currentUserSub: string | undefined;
  onViewUser: (user: User) => void;
}

export function UserCard({ user, currentUserSub, onViewUser }: UserCardProps): React.JSX.Element {
  const { t } = useTranslation('userManagement');
  const isAdmin = user.groups?.includes('admin');
  const roleLabel = isAdmin ? t('roles.admin') : t('roles.standard');
  const isCurrentUser = user.username === currentUserSub;
  const isSystemUser = user.email?.includes('numa-system-user');
  const statusLabel = getUserStatusLabel(t, user.status);

  return (
    <Card className={`h-100 shadow-sm ${isSystemUser ? 'opacity-50' : ''}`} style={{ transition: 'box-shadow 0.2s' }}>
      <Card.Body className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div className="text-truncate me-2" style={{ maxWidth: 'calc(100% - 80px)' }}>
            {/* Fall back to username when email is missing (SSO users with no email claim) so the
                card isn't rendered blank. Mirrors the table view. (BUG-382) */}
            <Card.Title className="h6 mb-0 text-truncate" title={user.email || user.username}>
              {user.email || user.username}
            </Card.Title>
            {(isSystemUser || isCurrentUser) && (
              <div className="d-flex flex-wrap gap-2">
                {isSystemUser && <small className="text-muted fst-italic">{t('table.systemBadge')}</small>}
                {isCurrentUser && <small className="text-muted fst-italic">{t('table.youBadge')}</small>}
              </div>
            )}
          </div>
          <span className={isAdmin ? 'badge badge-outline-primary' : 'badge badge-outline'}>{roleLabel}</span>
        </div>

        <div className="d-flex gap-2 mb-3">
          <Badge bg={getUserStatusBadgeVariant(user.enabled, user.status)} className="small">
            {statusLabel}
          </Badge>
          {!user.enabled && (
            <Badge bg="danger" className="small">
              {t('card.disabled')}
            </Badge>
          )}
        </div>

        <div className="mt-auto mb-2">
          <div className="text-muted small">{t('card.role', { role: roleLabel })}</div>
          <div className="text-muted small">
            {t('card.created')}:{' '}
            {new Date(user.created).toLocaleDateString(i18n.language, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </div>
        </div>

        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => onViewUser(user)}
          className="w-100"
          disabled={isSystemUser}
        >
          <Eye size={14} className="me-1" />
          {t('actions.view')}
        </Button>
      </Card.Body>
    </Card>
  );
}
