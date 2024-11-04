import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import { jwtDecode } from 'jwt-decode';
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
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

  const API_ENDPOINT = 'https://g59jhyyob7.execute-api.us-east-1.amazonaws.com';
  const USER_POOL_ID = 'us-east-1_kVPZjTM6a';

  const clearInputs = () => {
    if (usernameRef.current) usernameRef.current.value = '';
    if (passwordRef.current) passwordRef.current.value = '';
    if (newPasswordRef.current) newPasswordRef.current.value = '';
    if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
  };

  const { setUser } = useAuth();

  const handleSubmit = async (e, providedUsername, providedPassword) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const enteredUsername = providedUsername || usernameRef.current.value;
    const enteredPassword = providedPassword || passwordRef.current.value;

    try {
      // Step 1: Create the SRP session
      const srpSession = createSrpSession(
        enteredUsername,
        enteredPassword,
        USER_POOL_ID,
        false,
      );

      // Step 2: Send SRP-A to the server to initiate the SRP flow
      const initiateAuthRes = await fetch(`${API_ENDPOINT}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: enteredUsername,
          srpA: srpSession.largeA,
        }),
      });

      const initiateData = await initiateAuthRes.json();

      // Add error check after initiate response
      if (initiateData.error) {
        // If there is an error, throw it and set the error message
        setError(initiateData.error);
        throw new Error(initiateData.error);
      }

      // Step 3: Sign SRP session with response from the server
      const signedSrpSession = signSrpSession(srpSession, initiateData);

      // Step 4: Respond to the challenge with signed SRP session
      const respondToAuthChallengeRes = await fetch(`${API_ENDPOINT}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: initiateData.ChallengeParameters.USERNAME,
          challengeResponses: {
            PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
            PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
          },
          timestamp: srpSession.timestamp,
        }),
      });

      const finalResponse = await respondToAuthChallengeRes.json();

      console.log('auth response: ', finalResponse);

      // Look for error in finalResponse and throw it
      if (finalResponse.error) {
        throw new Error(finalResponse.error);
      }

      if (finalResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        setIsSettingNewPassword(true);
        setUsername(enteredUsername);
        setPassword(enteredPassword); // Save password in state only when new password is required
        localStorage.setItem('cognitoAuthSession', finalResponse.Session);
        setSuccess(
          'You need to set a new password. Please enter a new password below.',
        );
        clearInputs();
      } else {
        const tokens = finalResponse.AuthenticationResult;
        localStorage.setItem('accessToken', tokens.AccessToken);
        localStorage.setItem('refreshToken', tokens.RefreshToken);
        localStorage.setItem('idToken', tokens.IdToken);

        // Update the user state in AuthProvider
        const decodedAccessToken = jwtDecode(tokens.AccessToken);
        const decodedIdToken = jwtDecode(tokens.IdToken);
        setUser({
          tokens: {
            accessToken: tokens.AccessToken,
            idToken: tokens.IdToken,
            refreshToken: tokens.RefreshToken,
          },
          decoded_tokens: {
            accessToken: decodedAccessToken,
            idToken: decodedIdToken,
          },
        });

        setSuccess('Login successful.');
        setTimeout(() => {
          navigate('/dash');
          clearInputs();
        }, 1500); // 1.5 seconds delay
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message);
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
      const cognitoClient = new CognitoIdentityProviderClient({
        region: 'us-east-1',
      });

      // Step 1: Initiate auth with Cognito directly
      const initiateAuthCommand = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: '48ed21kkeqa0h4jtrs08kbvvvr',
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password, // Use the password from state
        },
      });

      const initiateAuthResponse =
        await cognitoClient.send(initiateAuthCommand);

      if (initiateAuthResponse.ChallengeName !== 'NEW_PASSWORD_REQUIRED') {
        throw new Error('Unexpected authentication response');
      }

      // Step 2: Respond to the NEW_PASSWORD_REQUIRED challenge
      const respondToAuthChallengeCommand = new RespondToAuthChallengeCommand({
        ClientId: '48ed21kkeqa0h4jtrs08kbvvvr',
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: initiateAuthResponse.Session,
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
      });

      await cognitoClient.send(respondToAuthChallengeCommand);

      // Step 3: Clear password from state and trigger handleSubmit
      setPassword('');
      setSuccess(
        'Password successfully updated. Logging in with new password...',
      );
      setIsSettingNewPassword(false);
      clearInputs();

      // Trigger handleSubmit with username and new password
      await handleSubmit(null, username, newPassword);
    } catch (error) {
      console.error('Error setting new password:', error);
      setError(
        error.message || 'An error occurred while setting the new password',
      );
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
            <Form.Control
              type="text"
              ref={usernameRef}
              placeholder="Enter username"
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

          <Button
            variant="primary"
            type="submit"
            className="mb-3"
            disabled={loading}
          >
            {loading ? 'Setting New Password...' : 'Set New Password'}
          </Button>
        </Form>
      )}
    </>
  );

  return <LayoutForm FormName="numalogin" Content={loginContent} />;
};

export { NumaLogin };
