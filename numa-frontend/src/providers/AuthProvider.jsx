import { createContext, useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [client, setClient] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

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

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      // Here you might want to validate the token with Cognito
      // For now, we'll just set the user as logged in
      setUser({ token });
    }
  }, []);

  const login = async (username, password) => {
    if (!client) {
      setError('Auth client not initialized. Please try again later.');
      return { error: 'Auth client not initialized' };
    }

    try {
      const command = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
        },
        ClientId: 'afd8mg8oedol3u6n8jj234kmn', // You might want to store this in config
      });
      const response = await client.send(command);

      if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return {
          challengeName: 'NEW_PASSWORD_REQUIRED',
          session: response.Session,
        };
      } else {
        const tokens = response.AuthenticationResult;
        localStorage.setItem('accessToken', tokens.AccessToken);
        localStorage.setItem('refreshToken', tokens.RefreshToken);
        setUser({ token: tokens.AccessToken });
        return { success: true };
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message);
      return { error: error.message };
    }
  };

  const completeNewPasswordChallenge = async (
    username,
    newPassword,
    session
  ) => {
    try {
      const command = new RespondToAuthChallengeCommand({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: 'afd8mg8oedol3u6n8jj234kmn', // You might want to store this in config
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
        Session: session,
      });

      const response = await client.send(command);

      const tokens = response.AuthenticationResult;
      localStorage.setItem('accessToken', tokens.AccessToken);
      localStorage.setItem('refreshToken', tokens.RefreshToken);
      setUser({ token: tokens.AccessToken });
      return { success: true };
    } catch (error) {
      console.error('Error setting new password:', error);
      setError(error.message);
      return { error: error.message };
    }
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider
      value={{ user, login, logout, completeNewPasswordChallenge, error }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
