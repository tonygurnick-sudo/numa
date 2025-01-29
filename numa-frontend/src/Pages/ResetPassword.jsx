import { useState, useEffect, useRef } from 'react';

import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form } from 'react-bootstrap';
import { LayoutForm } from '../Layouts/LayoutForm';
import { useAuth } from '../Providers/AuthProvider';

const ResetPassword = () => {
  const emailRef = useRef();
  const codeRef = useRef();
  const newPasswordRef = useRef();
  const confirmPasswordRef = useRef();

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
      await requestPasswordReset(emailRef.current.value);
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

    const newPassword = newPasswordRef.current.value;
    const confirmPassword = confirmPasswordRef.current.value;

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      await confirmPasswordReset(
        emailRef.current.value,
        codeRef.current.value,
        newPassword,
      );
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
      FormName={'numalogin'}
      Content={
        <>
          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          {!isCodeSent ? (
            <Form onSubmit={handleRequestReset}>
              <h1 className="mb-2">Request Password Reset</h1>
              <p className="mb-4 fs-lg-1">
                Enter your email to receive a password reset code.
              </p>
              <Form.Group className="mb-3">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="Enter your email"
                  ref={emailRef}
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
              <h1 className="mb-2">Reset Your Password</h1>
              <p className="mb-4 fs-lg-1">
                Enter the code you received and your new password.
              </p>

              <Form.Group className="mb-3">
                <Form.Label>Reset Code</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter the code"
                  ref={codeRef}
                  required
                />
              </Form.Group>

              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                placeholder="Enter your email"
                ref={emailRef}
                required
              />

              <Form.Group className="mb-3">
                <Form.Label>New Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Enter your new password"
                  ref={newPasswordRef}
                  required
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Confirm New Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Confirm your new password"
                  ref={confirmPasswordRef}
                  required
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
