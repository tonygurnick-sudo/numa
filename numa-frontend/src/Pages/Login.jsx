import { useEffect, useState, useRef } from 'react';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';
import {
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getCognitoClientId, loadCognitoClient } from '../common';
import { saveTokens } from '../auth';



const NumaLogin = () => {
  const usernameRef = useRef();
  const passwordRef = useRef();
  const newPasswordRef = useRef();
  const confirmPasswordRef = useRef();

  const [client, setClient] = useState(null);
  const [clientId, setClientId] = useState(null);

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(false);
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchClientId = async () => {
      try {
        const id = await getCognitoClientId();
        setClientId(id);
      } catch (error) {
        console.error('Failed to fetch client ID:', error);
      }
    };
    fetchClientId();

    loadCognitoClient(setClient, setError);
  }, []);


  const clearInputs = () => {
    if (usernameRef.current) usernameRef.current.value = '';
    if (passwordRef.current) passwordRef.current.value = '';
    if (newPasswordRef.current) newPasswordRef.current.value = '';
    if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true)

    if (!client) {
      setError('Auth client not initialized. Please try again later.');
      return;
    }

    const enteredUsername = usernameRef.current.value;
    const password = passwordRef.current.value;

    setUsername(enteredUsername);

    try {
      const command = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: {
          USERNAME: enteredUsername,
          PASSWORD: password,
        },
        ClientId: clientId,
      });
      const response = await client.send(command);

      if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        setSession(response.Session);
        setIsSettingNewPassword(true);
        setSuccess(
          'You need to set a new password. Please enter a new password below.'
        );
        clearInputs(); // Clear inputs after successful initial auth
      } else {
        const tokens = response.AuthenticationResult;
        saveTokens(tokens)

        setSuccess('Login successful. Redirecting...');
        clearInputs(); // Clear inputs after successful login

        setTimeout(() => { window.location.href = '/dash'; }, 700);
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message);
      setLoading(false)
    }
  };

  const handleNewPasswordSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true)

    const newPassword = newPasswordRef.current.value;
    const confirmPassword = confirmPasswordRef.current.value;

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      const command = new RespondToAuthChallengeCommand({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: '48ed21kkeqa0h4jtrs08kbvvvr',
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
        Session: session,
      });

      const response = await client.send(command);

      const tokens = response.AuthenticationResult;
      saveTokens(tokens)

      setIsSettingNewPassword(false);
      setSuccess('New password set successfully. You are now logged in.');
      clearInputs(); // Clear inputs after successful password change

       setTimeout(() => { window.location.href = '/dash'; }, 700);
    } catch (error) {
      console.error('Error setting new password:', error);
      setError(error.message);
      setLoading(false)
    }
  };

  return (
    <LayoutForm
      FormName={'numalogin'}
      Content={
        <>
          <h1 className="mb-2">Numa Login</h1>
          <p className="mb-4 fs-lg-1">
            Welcome back! Please enter your details.
          </p>
          <br />

          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          {!isSettingNewPassword ? (
            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="username">Username</Form.Label>
                <Form.Control
                  id="username"
                  type="text"
                  name="username"
                  placeholder="Enter your username"
                  ref={usernameRef}
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label htmlFor="password">Password</Form.Label>
                <Form.Control
                  id="password"
                  name="password"
                  type="password"
                  ref={passwordRef}
                />
                <p className="mt-1">
                  <a href="/reset-password">Forgot password</a>
                </p>
              </Form.Group>

              <Button variant="primary" type="submit" className="mb-3">
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
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label htmlFor="confirmPassword">
                  Confirm New Password
                </Form.Label>
                <Form.Control
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  ref={confirmPasswordRef}
                />
              </Form.Group>

              <Button variant="primary" type="submit" className="mb-3">
                Set New Password
              </Button>
            </Form>
          )}
        </>
      }
    />
  );
};

export { NumaLogin };
