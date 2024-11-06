import {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
} from 'react';
import { jwtDecode } from 'jwt-decode';
import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';
import { QBusinessClient } from '@aws-sdk/client-qbusiness';
import { QAppsClient } from '@aws-sdk/client-qapps';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import QPolicy from '../Data/QPolicy.json';

const AuthContext = createContext(null);

// Constants
const AWS_REGION = 'us-east-1';
const COGNITO_CLIENT_ID = '4gg2u42194gstu0ai6ab4b7179'; // Replace with your actual client ID
const IDENTITY_POOL_ID = 'us-east-1:facf1439-ef67-48f9-ada4-debb294db187';
const ROLE_ARN =
  'arn:aws:iam::905418183804:role/web-experience-role-numa-arcanum-demo';
const REGION = 'us-east-1';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qBusinessClient, setQBusinessClient] = useState(null);
  const [qAppsClient, setQAppsClient] = useState(null);
  const [tokenValidationComplete, setTokenValidationComplete] = useState(false);

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
      console.log('🔄 Attempting to refresh tokens...');
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        console.log('❌ No refresh token available');
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
        console.log('❌ Failed to refresh tokens - No authentication result');
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
          refreshToken: refreshToken,
        },
        decoded_tokens: {
          accessToken: decodedAccessToken,
          idToken: decodedIdToken,
        },
      });

      console.log('✅ Successfully refreshed tokens');
      return true;
    } catch (error) {
      console.error('❌ Error refreshing tokens:', error);
      logout();
      return false;
    }
  };

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

  const initializeQBusinessClient = useCallback(async () => {
    if (!user) return;

    const cognitoIdentity = new CognitoIdentityClient({ region: REGION });

    try {
      const idToken = user.tokens.idToken;
      const credentials = fromWebToken({
        client: cognitoIdentity,
        identityPoolId: IDENTITY_POOL_ID,
        roleSessionName: 'numa-frontend-chat',
        roleArn: ROLE_ARN,
        policy: JSON.stringify(QPolicy),
        durationSeconds: 3600,
        webIdentityToken: idToken,
      });

      const newClient = new QBusinessClient({
        region: REGION,
        credentials: await credentials(),
      });

      setQBusinessClient(newClient);
    } catch (error) {
      console.error('Error in QBusinessClient initialization:', error);
    }
  }, [user]);

  const initializeQAppsClient = useCallback(async () => {
    if (!user) return;

    const cognitoIdentity = new CognitoIdentityClient({ region: REGION });

    try {
      const idToken = user.tokens.idToken;
      const credentials = fromWebToken({
        client: cognitoIdentity,
        identityPoolId: IDENTITY_POOL_ID, // Assuming the same identity pool for both clients
        roleSessionName: 'numa-frontend-qapps', // Optional, you can use a different role name for QAppsClient
        roleArn: ROLE_ARN,
        policy: JSON.stringify(QPolicy), // Assuming the policy allows access to Q Apps API
        durationSeconds: 3600,
        webIdentityToken: idToken,
      });

      const newQAppsClient = new QAppsClient({
        region: REGION,
        credentials: await credentials(),
      });

      setQAppsClient(newQAppsClient);
    } catch (error) {
      console.error('Error in QAppsClient initialization:', error);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      initializeQBusinessClient();
      initializeQAppsClient();
    } else {
      setQBusinessClient(null);
      setQAppsClient(null);
    }
  }, [user, initializeQBusinessClient, initializeQAppsClient]);

  useEffect(() => {
    const loadUserFromTokens = async () => {
      console.log('🔍 Checking token status...');
      const accessToken = localStorage.getItem('accessToken');
      const idToken = localStorage.getItem('idToken');
      const refreshToken = localStorage.getItem('refreshToken');

      if (refreshToken) {
        if (
          !accessToken ||
          !idToken ||
          isTokenExpired(decodeToken(accessToken)) ||
          isTokenExpired(decodeToken(idToken))
        ) {
          console.log('⚠️ Tokens expired or missing, attempting refresh...');
          const refreshed = await refreshTokens();
          if (!refreshed) {
            console.log('❌ Token refresh failed, logging out');
            setUser(null);
          }
        } else {
          console.log('✅ Tokens are valid');
          const decodedAccessToken = decodeToken(accessToken);
          const decodedIdToken = decodeToken(idToken);

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
      } else {
        console.log('❌ No refresh token found');
        setUser(null);
      }
      setLoading(false);
      setTokenValidationComplete(true);
    };

    loadUserFromTokens();
  }, []);

  // Modify the token refresh interval to be more proactive
  useEffect(() => {
    if (!user) return;

    const checkAndRefreshTokens = async () => {
      const decodedAccessToken = user.decoded_tokens.accessToken;
      if (isTokenExpired(decodedAccessToken)) {
        console.log('🕒 Token check: Token expired, attempting refresh...');
        const refreshed = await refreshTokens();
        if (!refreshed) {
          logout();
        }
      } else {
        console.log('🕒 Token check: Token still valid');
      }
    };

    // Check tokens every 10 seconds
    const intervalId = setInterval(checkAndRefreshTokens, 10 * 1000);

    // Also check immediately when this effect runs
    checkAndRefreshTokens();

    return () => clearInterval(intervalId);
  }, [user]);

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

  const value = {
    user,
    loading,
    tokenValidationComplete,
    getAccessToken,
    getRefreshToken,
    getIdToken,
    getUserInfo,
    logout,
    qBusinessClient,
    qAppsClient,
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
