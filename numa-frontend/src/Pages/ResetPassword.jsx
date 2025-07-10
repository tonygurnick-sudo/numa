import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Alert, Button, Form, OverlayTrigger, Popover } from 'react-bootstrap';
import { LayoutForm } from '../Layouts/LayoutForm';
import { useAuth } from '../Providers/AuthProvider';

const ResetPassword = () => {
  const [email, setEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const navigate = useNavigate();
  const location = useLocation();

  // Check if we're in create password mode
  const isCreateMode = location.pathname === '/create-password';

  // Check for email and code in URL parameters
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const emailFromUrl = searchParams.get('email');
    const codeFromUrl = searchParams.get('code');

    if (codeFromUrl && emailFromUrl) {
      setEmail(emailFromUrl);
      setResetCode(codeFromUrl);
      setIsCodeSent(true); // Auto-advance to the second step
    }
  }, [location.search]);

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
      // Pass 'create' as mode for create password flow, or 'reset' for reset password flow
      await requestPasswordReset(email, isCreateMode ? 'create' : 'reset');
      setIsCodeSent(true);
      setSuccess(
        isCreateMode
          ? 'Activation code sent. Please check your email.'
          : 'Password reset code sent. Please check your email.',
      );
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
      setSuccess(
        isCreateMode
          ? 'Password created successfully. Redirecting to login...'
          : 'Password reset successfully. Redirecting to login...',
      );
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNewPasswordOnChange = async (password) => {
    setNewPassword(password);
    setSuccess(null);
    const errors = [
      { message: 'at least eight characters', pattern: /.{8,}/ },
      { message: 'at least one lowercase character', pattern: /[a-z]/ },
      { message: 'at least one uppercase character', pattern: /[A-Z]/ },
      { message: 'at least one symbol', pattern: /[\^$*.[\]{}()?"!@#%&\\/\\,><':;|_~`=+-]/ }, // Symbols based on https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html
      { message: 'at least one number', pattern: /[0-9]/ },
    ]
      .map((requirement) => {
        if (!password.match(requirement.pattern)) {
          return (
            <div key={requirement.message}>
              Password must contain {requirement.message}.<br />
            </div>
          );
        }
      })
      .filter((error) => error);
    setError(errors.length > 0 ? errors : null);
  };

  const getFormTitle = () => (isCreateMode ? 'Create Your Password' : 'Password Reset');
  const getRequestButtonText = () => (isCreateMode ? 'Request Activation Code' : 'Request Password Reset');
  const getCodeLabel = () => (isCreateMode ? 'Activation Code' : 'Reset Code');
  const getSubmitButtonText = () => (isCreateMode ? 'Create Password' : 'Reset Password');
  const getPromptText = () =>
    isCreateMode
      ? 'Enter your email to receive an activation code.'
      : 'Enter your email to receive a password reset code.';
  const getCodeInstructionText = () =>
    isCreateMode
      ? 'Enter the activation code you received and choose a new password.'
      : 'Enter the code you received and your new password.';

  return (
    <LayoutForm
      FormName="numalogin"
      Content={
        <>
          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          {!isCodeSent ? (
            <Form onSubmit={handleRequestReset}>
              <h2 className="mb-2">{getFormTitle()}</h2>
              <p className="mb-4">{getPromptText()}</p>
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
                {loading ? 'Requesting...' : getRequestButtonText()}
              </Button>
              {!isCreateMode && (
                <p className="mt-1">
                  <a href="/login">Back to login</a>
                </p>
              )}
            </Form>
          ) : (
            <Form onSubmit={handleResetPassword}>
              <h2 className="mb-2">{getFormTitle()}</h2>
              <p className="mb-4">{getCodeInstructionText()}</p>

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

                <Form.Label>{getCodeLabel()}</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter the code"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  required
                  // Disable the code if it's in the url and populated
                  disabled={location.search.includes('code') && resetCode}
                  name="reset-code"
                  autoComplete="off"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>New Password</Form.Label>
                <OverlayTrigger
                  placement="right"
                  overlay={
                    <Popover>
                      <Popover.Header>Password requirements</Popover.Header>
                      <Popover.Body>
                        <ul>
                          <li>At least 1 uppercase character.</li>
                          <li>At least 1 lowercase character.</li>
                          <li>At least 1 symbol.</li>
                          <li>At least 1 number.</li>
                          <li>At least 8 characters.</li>
                          <li>Cannot have been used before.</li>
                        </ul>
                      </Popover.Body>
                    </Popover>
                  }
                >
                  <Form.Control
                    type="password"
                    placeholder="Enter your new password"
                    value={newPassword}
                    onChange={(e) => handleNewPasswordOnChange(e.target.value)}
                    required
                    name="new-password"
                    autoComplete="new-password"
                  />
                </OverlayTrigger>
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
                {loading ? (isCreateMode ? 'Creating...' : 'Resetting...') : getSubmitButtonText()}
              </Button>
            </Form>
          )}
        </>
      }
    />
  );
};

export { ResetPassword };
