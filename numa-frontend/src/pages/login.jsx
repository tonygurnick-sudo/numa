import { useEffect, useState, useRef } from 'react';
import { LayoutForm } from '../layouts/LayoutForm';
//import { Preloader } from '../../components/Preloader';
import { Button, Form } from 'react-bootstrap';

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const NumaLogin = () => {
  const status_error = 'error';

  const usernameRef = useRef();
  const passwordRef = useRef();

  const [alertLogin, setAlertLogin] = useState('d-none');
  const [arletLoginContent, setArletLoginContent] = useState('');

  const [client, setClient] = useState(null);


  // Load the config.json file
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('config.json');
        const data = await response.json();
        const { region } = data.cognito;

        console.log('region to use:', region);
        // Create the Cognito Identity Client with the loaded region
        const newClient = new CognitoIdentityProviderClient({
          region,
        });

        // Set the client state variable
        console.log('newClient to use:', newClient);
        setClient(newClient);

        // ... (rest of your code using the client)
      } catch (error) {
        console.error('Error loading config.json:', error);
      }
    };

    loadConfig();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!client) {
      console.error('Client not initialized');
      return;
    }

    const username = usernameRef.current.value;
    const password = passwordRef.current.value;

     // Validate username and password
     if (!username || !password) {
      setAlertLogin('alert alert-secondary');
      setArletLoginContent("Please enter both username and password.");
      return;
    }

    try {
      const command = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
        },
        ClientId: 'afd8mg8oedol3u6n8jj234kmn',
      });
      const response = await client.send(command);

      const tokens = response.AuthenticationResult;
      console.log('Authentication successful:', tokens);

      // Store tokens securely in localStorage
      localStorage.setItem('accessToken', tokens.AccessToken);
      localStorage.setItem('idToken', tokens.IdToken);
      localStorage.setItem('refreshToken', tokens.RefreshToken);

    } catch (error) {
      console.error('Error during authentication:', error);
      setAlertLogin('alert alert-secondary');
      setArletLoginContent(error.message);

    }
  };

  return (
    <>
      <LayoutForm
        FormName={'numalogin'}
        Content={
          <>
            <h1 className="mb-2">Numa Login</h1>
            <p className="mb-4 fs-lg-1">
              Welcome back! Please enter your details.
            </p>
            <br />

            <Form onSubmit={handleSubmit}>
              <label htmlFor="email">Username</label>
              <input
                id="username"
                type="text"
                name="username"
                className="form-control mb-3"
                placeholder="Enter your username"
                ref={usernameRef}
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                className="form-control mb-3"
                ref={passwordRef}
              />

              <div className={alertLogin} role="alert">
                {arletLoginContent}
              </div>

              <Button variant="primary x-5" type="submit">
                Submit Details
              </Button>
            </Form>
          </>
        }
      ></LayoutForm>
    </>
  );
};

export { NumaLogin };
