import React from 'react';
import { Table, Badge, Button } from 'react-bootstrap';
import { ChevronDown, ChevronRight, Eye } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';
import type { User } from './UserDetailsModal';
import i18n from '../../i18n';

interface UserTableViewProps {
  adminUsers: User[];
  standardUsers: User[];
  currentUserSub: string | undefined;
  onViewUser: (user: User) => void;
  sectionsExpanded: { admin: boolean; standard: boolean };
  onToggleSection: (section: 'admin' | 'standard') => void;
  visibleSections?: Array<'admin' | 'standard'>;
}

export function UserTableView({
  adminUsers,
  standardUsers,
  currentUserSub,
  onViewUser,
  sectionsExpanded,
  onToggleSection,
  visibleSections,
}: UserTableViewProps): React.JSX.Element {
  const { t } = useTranslation('userManagement');
  const showAdminSection = visibleSections ? visibleSections.includes('admin') : true;
  const showStandardSection = visibleSections ? visibleSections.includes('standard') : true;

  const renderUserRow = (user: User) => {
    const isSystemUser = user.email?.includes('numa-system-user');
    const isAdmin = user.groups?.includes('admin');
    const isCurrentUser = user.username === currentUserSub;

    return (
      <tr
        key={user.username}
        className={isSystemUser ? 'text-muted opacity-50' : ''}
        title={isSystemUser ? t('table.systemUserTitle') : ''}
      >
        <td style={{ width: '40%' }}>
          {user.email}
          {isSystemUser && <small className="ms-2 fst-italic">{t('table.systemBadge')}</small>}
          {isCurrentUser && <small className="ms-2 fst-italic">{t('table.youBadge')}</small>}
        </td>
        <td style={{ width: '15%' }}>
          <Badge bg={isAdmin ? 'primary' : 'secondary'}>{isAdmin ? t('roles.admin') : t('roles.standard')}</Badge>
        </td>
        <td style={{ width: '15%' }}>
          <Badge
            bg={user.enabled ? (user.status === 'CONFIRMED' ? 'success' : 'warning') : 'danger'}
            className={isSystemUser ? 'opacity-50' : ''}
          >
            {user.status}
          </Badge>
        </td>
        <td style={{ width: '15%' }}>
          {new Date(user.created).toLocaleDateString(i18n.language, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </td>
        <td style={{ width: '15%' }}>
          <Button variant="outline-primary" size="sm" onClick={() => onViewUser(user)} disabled={isSystemUser}>
            <Eye size={14} className="me-1" />
            {t('actions.view')}
          </Button>
        </td>
      </tr>
    );
  };

  const renderSectionHeader = (
    title: string,
    count: number,
    expanded: boolean,
    section: 'admin' | 'standard',
    variant: 'primary' | 'secondary',
  ) => (
    <tr className="section-header" style={{ cursor: 'pointer' }} onClick={() => onToggleSection(section)}>
      <td colSpan={5} className="py-2" style={{ backgroundColor: 'var(--color-bg-light, #f8f9fa)' }}>
        <div className="d-flex align-items-center">
          {expanded ? <ChevronDown size={16} className="me-2" /> : <ChevronRight size={16} className="me-2" />}
          <span className="me-2 fw-semibold">{title}</span>
          <span className={variant === 'primary' ? 'badge badge-outline-primary' : 'badge badge-outline'}>{count}</span>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="table-responsive">
      <Table hover className="align-middle mb-0 user-table">
        <thead>
          <tr
            style={{
              backgroundColor: 'var(--brand-primary, var(--color-primary))',
              color: 'var(--brand-primaryContrast, white)',
            }}
          >
            <th style={{ width: '40%' }}>{t('table.headers.email')}</th>
            <th style={{ width: '15%' }}>{t('table.headers.role')}</th>
            <th style={{ width: '15%' }}>{t('table.headers.status')}</th>
            <th style={{ width: '15%' }}>{t('table.headers.created')}</th>
            <th style={{ width: '15%' }}>{t('table.headers.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {showAdminSection && (
            <>
              {renderSectionHeader(t('sections.admins'), adminUsers.length, sectionsExpanded.admin, 'admin', 'primary')}
              {sectionsExpanded.admin && adminUsers.length > 0 && adminUsers.map(renderUserRow)}
              {sectionsExpanded.admin && adminUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-3">
                    {t('table.empty.admins')}
                  </td>
                </tr>
              )}
            </>
          )}

          {showStandardSection && (
            <>
              {renderSectionHeader(
                t('sections.standardUsers'),
                standardUsers.length,
                sectionsExpanded.standard,
                'standard',
                'secondary',
              )}
              {sectionsExpanded.standard && standardUsers.length > 0 && standardUsers.map(renderUserRow)}
              {sectionsExpanded.standard && standardUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-3">
                    {t('table.empty.standard')}
                  </td>
                </tr>
              )}
            </>
          )}

          {!showAdminSection && !showStandardSection && (
            <tr>
              <td colSpan={5} className="text-center text-muted py-3">
                {t('table.empty.none')}
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
