import React from 'react';
import { Table, Badge, Button } from 'react-bootstrap';
import { ChevronDown, ChevronRight, Eye } from 'react-bootstrap-icons';
import type { User } from './UserDetailsModal';

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
        title={isSystemUser ? 'System user - not editable' : ''}
      >
        <td style={{ width: '40%' }}>
          {user.email}
          {isSystemUser && <small className="ms-2 fst-italic">(System)</small>}
          {isCurrentUser && <small className="ms-2 fst-italic">(You)</small>}
        </td>
        <td style={{ width: '15%' }}>
          <Badge bg={isAdmin ? 'primary' : 'secondary'}>{isAdmin ? 'Admin' : 'Standard'}</Badge>
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
          {new Date(user.created).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </td>
        <td style={{ width: '15%' }}>
          <Button variant="outline-primary" size="sm" onClick={() => onViewUser(user)} disabled={isSystemUser}>
            <Eye size={14} className="me-1" />
            View
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
            <th style={{ width: '40%' }}>Email</th>
            <th style={{ width: '15%' }}>Role</th>
            <th style={{ width: '15%' }}>Status</th>
            <th style={{ width: '15%' }}>Created</th>
            <th style={{ width: '15%' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {showAdminSection && (
            <>
              {renderSectionHeader('Administrators', adminUsers.length, sectionsExpanded.admin, 'admin', 'primary')}
              {sectionsExpanded.admin && adminUsers.length > 0 && adminUsers.map(renderUserRow)}
              {sectionsExpanded.admin && adminUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-3">
                    No administrators
                  </td>
                </tr>
              )}
            </>
          )}

          {showStandardSection && (
            <>
              {renderSectionHeader(
                'Standard Users',
                standardUsers.length,
                sectionsExpanded.standard,
                'standard',
                'secondary',
              )}
              {sectionsExpanded.standard && standardUsers.length > 0 && standardUsers.map(renderUserRow)}
              {sectionsExpanded.standard && standardUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-3">
                    No standard users
                  </td>
                </tr>
              )}
            </>
          )}

          {!showAdminSection && !showStandardSection && (
            <tr>
              <td colSpan={5} className="text-center text-muted py-3">
                No users
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
