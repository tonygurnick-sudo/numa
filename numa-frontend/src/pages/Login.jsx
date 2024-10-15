import { useEffect, useState, useRef } from 'react';
import { LayoutForm } from '../layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';

import { useNavigate } from 'react-router-dom';

const NumaLogin = () => {
  const usernameRef = useRef();
  const passwordRef = useRef();
  const newPasswordRef = useRef();
  const confirmPasswordRef = useRef();

  const navigate = useNavigate();

  const [client, setClient] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(false);
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState('');

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('config.json');
        const data = await response.json();
        const { region } = data.cognito;

        const newClient = new CognitoIdentityProviderClient({ region });
        setClient(newClient);
      } catch (error) {
        console.error('Error loading config.json:', error);
        setError(
          'Failed to initialize the auth client. Please try again later.'
        );
      }
    };

    loadConfig();
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
        ClientId: '6ptqdb1o3b3e50dmf23950k679',
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
        console.log('Authentication successful:', tokens);

        localStorage.setItem('accessToken', tokens.AccessToken);
        localStorage.setItem('refreshToken', tokens.RefreshToken);

        setSuccess('Login successful. Redirecting...');
        clearInputs(); // Clear inputs after successful login

        navigate('/chat');
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message);
    }
  };

  const handleNewPasswordSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const newPassword = newPasswordRef.current.value;
    const confirmPassword = confirmPasswordRef.current.value;

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      const command = new RespondToAuthChallengeCommand({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: 'afd8mg8oedol3u6n8jj234kmn',
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
        Session: session,
      });

      const response = await client.send(command);

      const tokens = response.AuthenticationResult;
      console.log('New password set successfully:', tokens);

      localStorage.setItem('accessToken', tokens.AccessToken);
      localStorage.setItem('refreshToken', tokens.RefreshToken);

      setIsSettingNewPassword(false);
      setSuccess('New password set successfully. You are now logged in.');
      clearInputs(); // Clear inputs after successful password change

      // Redirect to protected content or perform other actions
      // setTimeout(() => { window.location.href = '/dashboard'; }, 2000);
    } catch (error) {
      console.error('Error setting new password:', error);
      setError(error.message);
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
              </Form.Group>

              <Button variant="primary" type="submit" className="mb-3">
                Login
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
