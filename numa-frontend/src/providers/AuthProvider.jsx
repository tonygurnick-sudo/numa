import { createContext, useState, useContext, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';
import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';

const AuthContext = createContext(null);

// Constants
const AWS_REGION = 'us-east-1';
const COGNITO_CLIENT_ID = '2594236d-712a-4355-8b0e-6a4cef023f75'; // Replace with your actual client ID

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const cognitoClient = new CognitoIdentityProvider({
    region: AWS_REGION,
  });

  const decodeToken = (token) => {
    try {
      return jwtDecode(token);
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  };

  const isTokenExpired = (decodedToken) => {
    if (!decodedToken?.exp) return true;
    // Add 5-minute buffer before expiration
    const currentTime = Math.floor(Date.now() / 1000);
    return decodedToken.exp <= currentTime + 300;
  };

  const refreshTokens = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await cognitoClient.initiateAuth({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      });

      if (!response.AuthenticationResult) {
        throw new Error('Failed to refresh tokens');
      }

      const { AccessToken, IdToken } = response.AuthenticationResult;

      // Update localStorage
      localStorage.setItem('accessToken', AccessToken);
      localStorage.setItem('idToken', IdToken);

      // Update user state
      const decodedAccessToken = decodeToken(AccessToken);
      const decodedIdToken = decodeToken(IdToken);

      setUser({
        tokens: {
          accessToken: AccessToken,
          idToken: IdToken,
          refreshToken, // Keep existing refresh token
        },
        decoded_tokens: {
          accessToken: decodedAccessToken,
          idToken: decodedIdToken,
        },
      });

      return true;
    } catch (error) {
      console.error('Error refreshing tokens:', error);
      // If refresh fails, log out the user
      logout();
      return false;
    }
  };

  useEffect(() => {
    const loadUserFromTokens = async () => {
      const accessToken = localStorage.getItem('accessToken');
      const idToken = localStorage.getItem('idToken');
      const refreshToken = localStorage.getItem('refreshToken');

      if (accessToken && refreshToken && idToken) {
        const decodedAccessToken = decodeToken(accessToken);
        const decodedIdToken = decodeToken(idToken);

        if (decodedAccessToken && decodedIdToken) {
          // Check if access token is expired or about to expire
          if (isTokenExpired(decodedAccessToken)) {
            // Try to refresh tokens
            const refreshed = await refreshTokens();
            if (!refreshed) {
              setLoading(false);
              return;
            }
          } else {
            setUser({
              tokens: {
                accessToken,
                idToken,
                refreshToken,
              },
              decoded_tokens: {
                accessToken: decodedAccessToken,
                idToken: decodedIdToken,
              },
            });
          }
        }
      }
      setLoading(false);
    };

    loadUserFromTokens();
  }, []);

  // Set up a token refresh interval
  useEffect(() => {
    if (!user) return;

    const checkAndRefreshTokens = async () => {
      const decodedAccessToken = user.decoded_tokens.accessToken;
      if (isTokenExpired(decodedAccessToken)) {
        await refreshTokens();
      }
    };

    // Check tokens every 5 minutes
    const intervalId = setInterval(checkAndRefreshTokens, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [user]);

  const getAccessToken = async () => {
    if (!user) return null;

    // Check if token is expired or about to expire
    if (isTokenExpired(user.decoded_tokens.accessToken)) {
      const refreshed = await refreshTokens();
      if (!refreshed) return null;
    }

    return user.tokens.accessToken;
  };

  const getRefreshToken = () => {
    return user ? user.tokens.refreshToken : null;
  };

  const getIdToken = async () => {
    if (!user) return null;

    // Check if token is expired or about to expire
    if (isTokenExpired(user.decoded_tokens.idToken)) {
      const refreshed = await refreshTokens();
      if (!refreshed) return null;
    }

    return user.tokens.idToken;
  };

  const getUserInfo = () => {
    if (!user) return null;
    return {
      tokens: user.tokens,
      decoded_tokens: user.decoded_tokens,
    };
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('idToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        getAccessToken,
        getRefreshToken,
        getIdToken,
        getUserInfo,
        logout,
      }}
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
