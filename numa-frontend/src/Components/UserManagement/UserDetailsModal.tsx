import React, { useState } from 'react';
import { Modal, Button, Alert, Badge, Row, Col, Form } from 'react-bootstrap';

export interface User {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  created: Date;
  groups: string[];
}

interface UserDetailsModalProps {
  show: boolean;
  user: User | null;
  currentUserSub: string | undefined;
  onHide: () => void;
  onPromoteToAdmin: (user: User) => Promise<void>;
  onDemoteFromAdmin: (username: string) => Promise<void>;
  onDeleteUser: (user: User) => Promise<void>;
}

type ModalView = 'details' | 'promote' | 'delete';

export function UserDetailsModal({
  show,
  user,
  currentUserSub,
  onHide,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onDeleteUser,
}: UserDetailsModalProps): React.JSX.Element {
  const [view, setView] = useState<ModalView>('details');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!user) return <></>;

  const isAdmin = user.groups?.includes('admin');
  const isCurrentUser = user.username === currentUserSub;
  const isSystemUser = user.email?.includes('numa-system-user');

  const handleClose = () => {
    if (isProcessing) return;
    setView('details');
    onHide();
  };

  const handleRoleChange = async (newRole: string) => {
    if (isProcessing) return;

    if (newRole === 'admin' && !isAdmin) {
      setView('promote');
    } else if (newRole === 'standard' && isAdmin) {
      setIsProcessing(true);
      try {
        await onDemoteFromAdmin(user.username);
        handleClose();
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const confirmPromotion = async () => {
    setIsProcessing(true);
    try {
      await onPromoteToAdmin(user);
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    setIsProcessing(true);
    try {
      await onDeleteUser(user);
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const renderDetailsView = () => (
    <>
      <Modal.Header closeButton={!isProcessing}>
        <Modal.Title>User Details</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-4">
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              Email
            </Col>
            <Col sm={8}>
              <strong>{user.email}</strong>
              {isSystemUser && <small className="ms-2 text-muted fst-italic">(System)</small>}
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              Status
            </Col>
            <Col sm={8}>
              <Badge bg={user.enabled ? (user.status === 'CONFIRMED' ? 'success' : 'warning') : 'danger'}>
                {user.status}
              </Badge>
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              Account
            </Col>
            <Col sm={8}>
              <Badge bg={user.enabled ? 'success' : 'danger'}>{user.enabled ? 'Enabled' : 'Disabled'}</Badge>
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm={4} className="text-muted">
              Created
            </Col>
            <Col sm={8}>
              {new Date(user.created).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Col>
          </Row>
        </div>

        {!isSystemUser && !isCurrentUser && (
          <>
            <hr />
            <h6 className="mb-3">Permissions</h6>
            <Form.Group className="mb-3">
              <Form.Label>Role</Form.Label>
              <Form.Select
                value={isAdmin ? 'admin' : 'standard'}
                onChange={(e) => handleRoleChange(e.target.value)}
                disabled={isProcessing}
              >
                <option value="standard">Standard</option>
                <option value="admin">Admin</option>
              </Form.Select>
              <Form.Text className="text-muted">
                {isAdmin
                  ? 'Admin users can manage users, upload documents, and configure system settings.'
                  : 'Standard users can use Numa chat and apps but cannot manage the system.'}
              </Form.Text>
            </Form.Group>
          </>
        )}

        {isCurrentUser && (
          <Alert variant="info" className="mb-0">
            This is your account. You cannot modify your own permissions.
          </Alert>
        )}

        {isSystemUser && (
          <Alert variant="secondary" className="mb-0">
            System users cannot be modified.
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        {!isSystemUser && !isCurrentUser && (
          <>
            {isAdmin ? (
              <Button
                variant="secondary"
                onClick={() => {
                  // Show admin deletion warning
                  alert('Administrator accounts cannot be deleted directly. Please demote the user to Standard first.');
                }}
              >
                Delete User
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setView('delete')} disabled={isProcessing}>
                Delete User
              </Button>
            )}
          </>
        )}
        <Button variant="primary" onClick={handleClose} disabled={isProcessing}>
          Close
        </Button>
      </Modal.Footer>
    </>
  );

  const renderPromoteView = () => (
    <>
      <Modal.Header closeButton={!isProcessing}>
        <Modal.Title>Grant Administrator Privileges</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="warning" className="mb-4">
          <Alert.Heading className="h6">Important: Administrator Access</Alert.Heading>
          You are about to grant administrator privileges to <strong>{user.email}</strong>. Please review the
          permissions this will provide before proceeding.
        </Alert>

        <h6 className="mb-3">Administrator privileges include:</h6>
        <Row>
          <Col md={6}>
            <h6 className="text-primary mb-2">User Management</h6>
            <ul className="small mb-3">
              <li>Create new user accounts</li>
              <li>Delete existing users</li>
              <li>Promote/demote other users to admin</li>
              <li>View all user information</li>
            </ul>

            <h6 className="text-primary mb-2">Data Management</h6>
            <ul className="small mb-3">
              <li>Upload company documents</li>
              <li>Delete company files</li>
              <li>Manage data sources</li>
              <li>Configure document indexing</li>
            </ul>
          </Col>
          <Col md={6}>
            <h6 className="text-primary mb-2">System Configuration</h6>
            <ul className="small mb-3">
              <li>Modify system settings</li>
              <li>Configure integrations</li>
              <li>Access administrative tools</li>
              <li>View system logs and metrics</li>
            </ul>
          </Col>
        </Row>

        <Alert variant="info" className="mt-3">
          <strong>Note:</strong> Administrators have significant control over the system and can access all company
          data. Only grant these privileges to trusted team members who need administrative access.
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setView('details')} disabled={isProcessing}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirmPromotion} disabled={isProcessing}>
          {isProcessing ? 'Granting Access...' : 'Yes, Grant Admin Access'}
        </Button>
      </Modal.Footer>
    </>
  );

  const renderDeleteView = () => (
    <>
      <Modal.Header closeButton={!isProcessing}>
        <Modal.Title>Delete User Account</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="danger" className="mb-4">
          <Alert.Heading className="h6">Warning: Permanent Account Deletion</Alert.Heading>
          You are about to permanently delete the user account for <strong>{user.email}</strong>. This action cannot be
          undone.
        </Alert>

        <h6 className="mb-3">What will happen when you delete this user:</h6>
        <Row>
          <Col md={6}>
            <h6 className="text-danger mb-2">Account Access</h6>
            <ul className="small mb-3">
              <li>User will immediately lose access to Numa</li>
              <li>All login credentials will be revoked</li>
              <li>User cannot log in or recover their account</li>
            </ul>

            <h6 className="text-danger mb-2">Data Impact</h6>
            <ul className="small mb-3">
              <li>Chat history will be preserved, but inaccessible to the user</li>
              <li>User activity logs will remain</li>
              <li>Uploaded documents will not be affected</li>
            </ul>
          </Col>
          <Col md={6}>
            <h6 className="text-warning mb-2">Immediate Effects</h6>
            <ul className="small mb-3">
              <li>User removed from all groups</li>
              <li>All active sessions terminated</li>
              <li>Account appears as &quot;deleted&quot; in audit logs</li>
            </ul>

            <h6 className="text-info mb-2">Recovery Options</h6>
            <ul className="small mb-3">
              <li>Account cannot be restored</li>
              <li>Must create a new account with same email</li>
              <li>Previous permissions will not be restored</li>
            </ul>
          </Col>
        </Row>

        <Alert variant="warning" className="mt-3">
          <strong>Before deleting:</strong> Account deletion is permanent and irreversible.
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setView('details')} disabled={isProcessing}>
          Cancel
        </Button>
        <Button variant="danger" onClick={confirmDelete} disabled={isProcessing}>
          {isProcessing ? 'Deleting Account...' : 'Yes, Delete Account'}
        </Button>
      </Modal.Footer>
    </>
  );

  return (
    <Modal show={show} onHide={handleClose} backdrop={isProcessing ? 'static' : true} size="lg">
      {view === 'details' && renderDetailsView()}
      {view === 'promote' && renderPromoteView()}
      {view === 'delete' && renderDeleteView()}
    </Modal>
  );
}
