import React, { useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { Preloader } from '../Preloader';

interface CreateUserModalProps {
  show: boolean;
  onHide: () => void;
  onCreateUser: (email: string) => Promise<void>;
}

export function CreateUserModal({ show, onHide, onCreateUser }: CreateUserModalProps): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdEmail, setCreatedEmail] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedInstructions, setCopiedInstructions] = useState(false);

  const handleClose = () => {
    if (loading) return;
    setEmail('');
    setError(null);
    setSuccess(false);
    setCreatedEmail('');
    onHide();
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(createdEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch (err) {
      console.error('Failed to copy email:', err);
    }
  };

  const handleCopyInstructions = async () => {
    try {
      const instructions = `Welcome to Numa!\n\nYour account has been created with the following email address: ${createdEmail}\n\nTo set up your password and access the system, please:\n1. Go to ${window.location.origin}/create-password\n2. Enter your email address: ${createdEmail}\n3. Follow the instructions to create your password\n\nIf you have any questions, please contact your administrator.`;
      await navigator.clipboard.writeText(instructions);
      setCopiedInstructions(true);
      setTimeout(() => setCopiedInstructions(false), 2000);
    } catch (err) {
      console.error('Failed to copy instructions:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      await onCreateUser(email);
      setCreatedEmail(email);
      setSuccess(true);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop={loading ? 'static' : true} size="lg">
      <Modal.Header closeButton={!loading}>
        <Modal.Title>Create New User</Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit}>
        <Modal.Body className="position-relative">
          {loading && <Preloader smallscreen overlayParent />}

          {error && (
            <Alert variant="danger" className="mb-3" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {!success ? (
            <>
              <p className="text-muted mb-3">Create a new user account by entering their email address:</p>
              <ul className="text-muted mb-4">
                <li>The user will need to visit {window.location.origin}/create-password to set their password</li>
                <li>You&apos;ll receive instructions to share with the user after creation</li>
                <li>Access to Numa will be based on their assigned permissions</li>
              </ul>

              <Form.Group className="mb-3" controlId="createUserEmail">
                <Form.Label>
                  Email address <span className="text-danger">*</span>
                </Form.Label>
                <Form.Control
                  type="email"
                  placeholder="Enter email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  aria-required="true"
                />
                <Form.Text className="text-muted">This email will be their username for logging in.</Form.Text>
              </Form.Group>
            </>
          ) : (
            <Alert variant="success" className="mb-0">
              <h5 className="alert-heading">User created successfully!</h5>
              <hr />
              <div className="mb-3">
                <strong className="d-block mb-2">User Instructions</strong>
                <div className="bg-light p-3 rounded">
                  <div className="user-select-all">
                    <p className="mb-2">Welcome to Numa!</p>
                    <p className="mb-2">
                      Your account has been created with the following email address: <strong>{createdEmail}</strong>
                    </p>
                    <p className="mb-2">To set up your password and access the system, please:</p>
                    <ol className="ps-4 mb-2">
                      <li>Go to {window.location.origin}/create-password</li>
                      <li>Enter your email address: {createdEmail}</li>
                      <li>Follow the instructions to create your password</li>
                    </ol>
                    <p className="mb-0">If you have any questions, please contact your administrator.</p>
                  </div>
                  <div className="d-flex justify-content-end mt-3">
                    <Button variant="secondary" size="sm" className="me-2" onClick={handleCopyEmail}>
                      {copiedEmail ? 'Copied!' : 'Copy Address'}
                    </Button>
                    <Button variant="outline-primary" size="sm" onClick={handleCopyInstructions}>
                      {copiedInstructions ? 'Copied!' : 'Copy User Instructions'}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <strong className="d-block mb-2">Next Steps</strong>
                <ol className="mb-0 ps-3">
                  <li className="mb-1">Share these instructions with the user securely</li>
                  <li className="mb-1">They will need to visit {window.location.origin}/create-password</li>
                  <li>They will be able to set their password there for the first time</li>
                </ol>
              </div>
            </Alert>
          )}
        </Modal.Body>

        <Modal.Footer>
          {!success ? (
            <>
              <Button variant="secondary" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create User'}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={handleClose}>
              Done
            </Button>
          )}
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
