import { useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form } from 'react-bootstrap';
import { LayoutForm } from '../Layouts/LayoutForm';
import { useAuth } from '../Providers/AuthProvider';

const ResetPassword = () => {
  const [email, setEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const navigate = useNavigate();

  const [isCodeSent, setIsCodeSent] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  const { requestPasswordReset, confirmPasswordReset } = useAuth();

  const handleRequestReset = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      await requestPasswordReset(email);
      setIsCodeSent(true);
      setSuccess('Password reset code sent. Please check your email.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      await confirmPasswordReset(email, resetCode, newPassword);
      setSuccess('Password reset successfully. Redirecting to login...');
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LayoutForm
      FormName={'numa-reset-password'}
      Content={
        <>
          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          {!isCodeSent ? (
            <Form onSubmit={handleRequestReset}>
              <h2 className="mb-2">Password Reset</h2>
              <p className="mb-4">Enter your email to receive a password reset code.</p>
              <Form.Group className="mb-3">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Form.Group>
              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? 'Requesting...' : 'Request Password Reset'}
              </Button>
              <p className="mt-1">
                <a href="/login">Back to login</a>
              </p>
            </Form>
          ) : (
            <Form onSubmit={handleResetPassword}>
              <h2 className="mb-2">Reset Your Password</h2>
              <p className="mb-4">Enter the code you received and your new password.</p>

              <Form.Group className="mb-3">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  readOnly
                  required
                  disabled
                  autoComplete="email"
                />

                <Form.Label>Reset Code</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter the code"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  required
                  name="reset-code"
                  autoComplete="off"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>New Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Enter your new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  name="new-password"
                  autoComplete="new-password"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Confirm New Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Confirm your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  name="confirm-new-password"
                  autoComplete="new-password"
                />
              </Form.Group>

              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </Form>
          )}
        </>
      }
    />
  );
};

export { ResetPassword };
