import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';

const NumaLogin = () => {
  const usernameRef = useRef();
  const passwordRef = useRef();
  const newPasswordRef = useRef();
  const confirmPasswordRef = useRef();
  const navigate = useNavigate();

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const clearInputs = () => {
    if (usernameRef.current) usernameRef.current.value = '';
    if (passwordRef.current) passwordRef.current.value = '';
    if (newPasswordRef.current) newPasswordRef.current.value = '';
    if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
  };

  const { login, setNewPassword } = useAuth();

  const handleSubmit = async (e, providedUsername, providedPassword) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const enteredUsername = (providedUsername || usernameRef.current?.value || '').trim();
    const enteredPassword = (providedPassword || passwordRef.current?.value || '').trim();

    if (!enteredUsername || !enteredPassword) {
      setError('Username and password are required');
      setLoading(false);
      return;
    }

    if (enteredUsername.includes(' ') || enteredPassword.includes(' ')) {
      setError('Username and password cannot contain spaces');
      setLoading(false);
      return;
    }

    try {
      const result = await login(enteredUsername, enteredPassword);

      if (result.requiresNewPassword) {
        setIsSettingNewPassword(true);
        setUsername(enteredUsername);
        setPassword(enteredPassword);
        setSuccess('You need to set a new password. Please enter a new password below.');
        clearInputs();
      } else {
        setSuccess('Login successful.');
        navigate('/dash');
        clearInputs();
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  const handleNewPasswordSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const newPassword = newPasswordRef.current.value;
    const confirmPassword = confirmPasswordRef.current.value;

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      setLoading(false);
      return;
    }

    try {
      await setNewPassword(username, password, newPassword);
      setSuccess('Password successfully updated. Logging in with new password...');
      setIsSettingNewPassword(false);
      clearInputs();
      navigate('/dash');
    } catch (error) {
      console.error('Error setting new password:', error);
      setError(error.message || 'An error occurred while setting the new password');
    } finally {
      setLoading(false);
    }
  };

  const loginContent = (
    <>
      <h2>Numa Login</h2>

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {!isSettingNewPassword ? (
        <Form onSubmit={(e) => handleSubmit(e)}>
          <Form.Group controlId="username">
            <Form.Label>Username</Form.Label>
            <Form.Control type="text" ref={usernameRef} placeholder="Enter username" data-testid="username-input" />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="password">Password</Form.Label>
            <Form.Control
              id="password"
              name="password"
              type="password"
              ref={passwordRef}
              data-testid="password-input"
            />
            <p className="mt-1">
              <a href="/reset-password">Forgot password</a>
            </p>
          </Form.Group>

          <Button variant="primary" type="submit" className="mb-3" data-testid="login-button">
            {loading ? 'Logging In...' : 'Login'}
          </Button>
        </Form>
      ) : (
        <Form onSubmit={handleNewPasswordSubmit}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="newPassword">New Password</Form.Label>
            <Form.Control
              id="newPassword"
              name="newPassword"
              type="password"
              ref={newPasswordRef}
              data-testid="new-password-input"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="confirmPassword">Confirm New Password</Form.Label>
            <Form.Control
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              ref={confirmPasswordRef}
              data-testid="confirm-password-input"
            />
          </Form.Group>

          <Button variant="primary" type="submit" className="mb-3" disabled={loading} data-testid="set-password-button">
            {loading ? 'Setting New Password...' : 'Set New Password'}
          </Button>
        </Form>
      )}
    </>
  );

  return <LayoutForm FormName="numalogin" Content={loginContent} />;
};

export { NumaLogin };
