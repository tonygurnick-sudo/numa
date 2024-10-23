import { useState, useRef } from 'react';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';

const NumaLogin = () => {
  const usernameRef = useRef();
  const passwordRef = useRef();
  const newPasswordRef = useRef();
  const confirmPasswordRef = useRef();

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const API_ENDPOINT = 'https://g59jhyyob7.execute-api.us-east-1.amazonaws.com';
  const USER_POOL_ID = 'us-east-1_kVPZjTM6a';

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
    setLoading(true);

    const enteredUsername = usernameRef.current.value;
    const password = passwordRef.current.value;

    try {
      // Step 1: Create the SRP session
      const srpSession = createSrpSession(
        enteredUsername,
        password,
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

      if (finalResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        setIsSettingNewPassword(true);
        setSuccess(
          'You need to set a new password. Please enter a new password below.',
        );
        clearInputs();
      } else {
        const tokens = finalResponse.AuthenticationResult;
        localStorage.setItem('accessToken', tokens.AccessToken);
        localStorage.setItem('refreshToken', tokens.RefreshToken);
        localStorage.setItem('idToken', tokens.IdToken);

        setSuccess('Login successful.');
        clearInputs();
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
      const response = await fetch(`${API_ENDPOINT}/new-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({
          newPassword: newPassword,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(
          'Password successfully updated. You can now log in with your new password.',
        );
        setIsSettingNewPassword(false);
        clearInputs();
      } else {
        setError(data.message || 'Failed to set new password');
      }
    } catch (error) {
      console.error('Error setting new password:', error);
      setError('An error occurred while setting the new password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LayoutForm>
      <h1>Numa Login</h1>

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {!isSettingNewPassword ? (
        <Form onSubmit={handleSubmit}>
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
    </LayoutForm>
  );
};

export { NumaLogin };
