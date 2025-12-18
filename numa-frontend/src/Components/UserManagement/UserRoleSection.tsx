import React from 'react';
import { Badge, Collapse, Table, Row, Col, Button } from 'react-bootstrap';
import { ChevronDown, ChevronRight, Eye } from 'react-bootstrap-icons';
import { UserCard } from './UserCard';
import type { User } from './UserDetailsModal';
import type { ViewMode } from './UserActionsBar';

interface UserRoleSectionProps {
  title: string;
  users: User[];
  expanded: boolean;
  onToggle: () => void;
  viewMode: ViewMode;
  currentUserSub: string | undefined;
  onViewUser: (user: User) => void;
  variant?: 'primary' | 'secondary';
}

export function UserRoleSection({
  title,
  users,
  expanded,
  onToggle,
  viewMode,
  currentUserSub,
  onViewUser,
  variant = 'secondary',
}: UserRoleSectionProps): React.JSX.Element {
  return (
    <div className="mb-4">
      <div
        className="d-flex align-items-center p-2 rounded cursor-pointer"
        style={{
          backgroundColor: 'var(--color-bg-light, #f8f9fa)',
          cursor: 'pointer',
        }}
        onClick={onToggle}
        role="button"
        aria-expanded={expanded}
        aria-controls={`section-${title.toLowerCase().replace(/\s/g, '-')}`}
      >
        {expanded ? <ChevronDown size={16} className="me-2" /> : <ChevronRight size={16} className="me-2" />}
        <span className="mb-0 me-2 fw-semibold">{title}</span>
        <span className={variant === 'primary' ? 'badge badge-outline-primary' : 'badge badge-outline'}>
          {users.length}
        </span>
      </div>

      <Collapse in={expanded}>
        <div id={`section-${title.toLowerCase().replace(/\s/g, '-')}`} className="mt-3">
          {users.length === 0 ? (
            <p className="text-muted text-center py-3">No {title.toLowerCase()} users</p>
          ) : viewMode === 'card' ? (
            <Row xs={1} md={2} lg={3} className="g-3">
              {users.map((user) => (
                <Col key={user.username}>
                  <UserCard user={user} currentUserSub={currentUserSub} onViewUser={onViewUser} />
                </Col>
              ))}
            </Row>
          ) : (
            <div className="table-responsive">
              <Table hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSystemUser = user.email?.includes('numa-system-user');
                    const isCurrentUser = user.username === currentUserSub;

                    return (
                      <tr
                        key={user.username}
                        className={isSystemUser ? 'text-muted opacity-50' : ''}
                        title={isSystemUser ? 'System user - not editable' : ''}
                      >
                        <td>
                          {user.email}
                          {isSystemUser && <small className="ms-2 fst-italic">(System)</small>}
                          {isCurrentUser && <small className="ms-2 fst-italic">(You)</small>}
                        </td>
                        <td>
                          <Badge
                            bg={user.enabled ? (user.status === 'CONFIRMED' ? 'success' : 'warning') : 'danger'}
                            className={isSystemUser ? 'opacity-50' : ''}
                          >
                            {user.status}
                          </Badge>
                        </td>
                        <td>
                          {new Date(user.created).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => onViewUser(user)}
                            disabled={isSystemUser}
                          >
                            <Eye size={14} className="me-1" />
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
