import { useState, useRef } from 'react';
import { Button, Form, Alert } from 'react-bootstrap';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper'; // Use named imports

const NumaLogin = () => {
  const usernameRef = useRef();
  const passwordRef = useRef();
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const API_ENDPOINT = 'https://g59jhyyob7.execute-api.us-east-1.amazonaws.com'; // Replace with your actual backend API
  const USER_POOL_ID = 'us-east-1_kVPZjTM6a';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const enteredUsername = usernameRef.current.value;
    const password = passwordRef.current.value;

    try {
      // Step 1: Create the SRP session
      const srpSession = createSrpSession(
        enteredUsername,
        password,
        USER_POOL_ID,
        false
      );

      console.log('srpSession', srpSession);

      // Step 2: Send SRP-A to the server to initiate the SRP flow
      const initiateAuthRes = await fetch(`${API_ENDPOINT}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: enteredUsername,
          srpA: srpSession.largeA, // Use `largeA` from srpSession
        }),
      });

      const initiateData = await initiateAuthRes.json();

      console.log('initiateData', initiateData);

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

      if (!respondToAuthChallengeRes.ok) {
        throw new Error(finalResponse.error || 'Authentication failed');
      }

      console.log('finalResponse', finalResponse);

      // Handle the authentication success and tokens
      const tokens = finalResponse.AuthenticationResult;
      localStorage.setItem('accessToken', tokens.AccessToken);
      localStorage.setItem('refreshToken', tokens.RefreshToken);
      localStorage.setItem('idToken', tokens.IdToken);

      setSuccess('Login successful.');
      window.location.href = '/chat'; // Redirect to dashboard
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message);
    }
  };

  return (
    <div>
      <h1>Numa Login</h1>

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Form onSubmit={handleSubmit}>
        <Form.Group controlId="username">
          <Form.Label>Username</Form.Label>
          <Form.Control
            type="text"
            ref={usernameRef}
            placeholder="Enter username"
          />
        </Form.Group>

        <Form.Group controlId="password">
          <Form.Label>Password</Form.Label>
          <Form.Control
            type="password"
            ref={passwordRef}
            placeholder="Enter password"
          />
        </Form.Group>

        <Button type="submit">Login</Button>
      </Form>
    </div>
  );
};

export { NumaLogin };
