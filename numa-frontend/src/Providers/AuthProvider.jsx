import {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
} from 'react';
import { jwtDecode } from 'jwt-decode';
import { QBusinessClient } from '@aws-sdk/client-qbusiness';
import { QAppsClient } from '@aws-sdk/client-qapps';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import QPolicy from '../Data/QPolicy.json';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const AuthContext = createContext(null);

// Constants
const IDENTITY_POOL_ID = 'us-east-1:facf1439-ef67-48f9-ada4-debb294db187';
const ROLE_ARN =
  'arn:aws:iam::905418183804:role/web-experience-role-numa-arcanum-demo';
const REGION = 'us-east-1';
const API_ENDPOINT = 'https://g59jhyyob7.execute-api.us-east-1.amazonaws.com';
const USER_POOL_ID = 'us-east-1_kVPZjTM6a';
const CLIENT_ID = '48ed21kkeqa0h4jtrs08kbvvvr';

// Add a context for test configuration
const TestConfigContext = createContext(null);

export const AuthProvider = ({ children, refreshHandler, initialTokens }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qBusinessClient, setQBusinessClient] = useState(null);
  const [qAppsClient, setQAppsClient] = useState(null);
  const [tokenValidationComplete, setTokenValidationComplete] = useState(false);

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
    const currentTime = Math.floor(Date.now() / 1000);
    return decodedToken.exp <= currentTime + 300;
  };

  const refreshTokens = async () => {
    try {
      console.log('🔄 Attempting to refresh tokens...');
      const refreshToken =
        initialTokens?.refreshToken || localStorage.getItem('refreshToken');
      const tokens = initialTokens || getUserInfo();

      console.log('tokens', tokens);

      if (!refreshToken || !tokens?.decoded_tokens?.idToken) {
        console.log('❌ No refresh token or ID token available');
        throw new Error('No refresh token or ID token available');
      }

      let result;
      if (refreshHandler) {
        result = await refreshHandler({
          refreshToken,
          username: tokens.decoded_tokens.idToken.sub,
        });
      } else {
        const response = await fetch(`${API_ENDPOINT}/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refreshToken: refreshToken,
            username: tokens.decoded_tokens.idToken.sub,
          }),
        });
        result = await response.json();
      }

      if (!result.AuthenticationResult) {
        console.log('❌ Failed to refresh tokens - No authentication result');
        throw new Error(result.error || 'Failed to refresh tokens');
      }

      const { AccessToken, IdToken } = result.AuthenticationResult;

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

  useEffect(() => {
    loadUserFromTokens();
  }, []);

  const checkAndRefreshTokens = async () => {
    if (!user || !user.decoded_tokens) {
      console.log('No user or decoded tokens available');
      return false;
    }

    const decodedAccessToken = user.decoded_tokens.accessToken;
    if (isTokenExpired(decodedAccessToken)) {
      console.log('🕒 Token check: Token expired, attempting refresh...');
      const refreshed = await refreshTokens();
      if (!refreshed) {
        logout();
        return false;
      }
      return true;
    }

    console.log('🕒 Token check: Token still valid');
    return true;
  };

  // Modify the token refresh interval to be more proactive
  useEffect(() => {
    // Skip refresh interval in test mode
    if (!user || initialTokens) return;

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

  const login = async (username, password) => {
    // Step 1: Create the SRP session
    const srpSession = createSrpSession(
      username,
      password,
      USER_POOL_ID,
      false,
    );

    // Step 2: Send SRP-A to initiate SRP flow
    const initiateAuthRes = await fetch(`${API_ENDPOINT}/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username,
        srpA: srpSession.largeA,
      }),
    });

    const initiateData = await initiateAuthRes.json();
    if (initiateData.error) {
      throw new Error(initiateData.error);
    }

    // Step 3: Sign SRP session
    const signedSrpSession = signSrpSession(srpSession, initiateData);

    // Step 4: Respond to challenge
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
    if (finalResponse.error) {
      throw new Error(finalResponse.error);
    }

    if (finalResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return { requiresNewPassword: true, session: finalResponse.Session };
    }

    await handleLoginSuccess(finalResponse.AuthenticationResult);
    return { success: true };
  };

  const setNewPassword = async (username, oldPassword, newPassword) => {
    const cognitoClient = new CognitoIdentityProviderClient({
      region: REGION,
    });

    const initiateAuthCommand = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: oldPassword,
      },
    });

    const initiateAuthResponse = await cognitoClient.send(initiateAuthCommand);
    if (initiateAuthResponse.ChallengeName !== 'NEW_PASSWORD_REQUIRED') {
      throw new Error('Unexpected authentication response');
    }

    const respondToAuthChallengeCommand = new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: initiateAuthResponse.Session,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: newPassword,
      },
    });

    await cognitoClient.send(respondToAuthChallengeCommand);

    // Login with new password
    return await login(username, newPassword);
  };

  const handleLoginSuccess = async (tokens) => {
    localStorage.setItem('accessToken', tokens.AccessToken);
    localStorage.setItem('refreshToken', tokens.RefreshToken);
    localStorage.setItem('idToken', tokens.IdToken);

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
  };

  // Initialize user state from testConfig if available
  useEffect(() => {
    if (initialTokens) {
      setUser(initialTokens);
    }
  }, [initialTokens]);

  const value = {
    isAuthenticated: !!user,
    user,
    loading,
    tokenValidationComplete,
    login,
    logout,
    setNewPassword,
    refreshTokens,
    getAccessToken,
    getUserInfo,
    checkAndRefreshTokens,
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

// Create a wrapper for testing
export const TestAuthProvider = ({
  children,
  refreshHandler,
  initialTokens,
}) => {
  return (
    <AuthProvider refreshHandler={refreshHandler} initialTokens={initialTokens}>
      {children}
    </AuthProvider>
  );
};
