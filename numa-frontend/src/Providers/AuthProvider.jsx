import {
  createContext,
  useState,
  useContext,
  useRef,
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
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const AuthContext = createContext(null);

const IDENTITY_POOL_ID = window.sessionStorage.getItem('IDENTITY_POOL_ID');
const IDENTITY_POOL_ROLE_ARN = window.sessionStorage.getItem('IDENTITY_POOL_ROLE_ARN');
const ROLE_ARN = window.sessionStorage.getItem('ROLE_ARN');
const REGION = window.sessionStorage.getItem('REGION');
const API_ENDPOINT = window.sessionStorage.getItem('API_ENDPOINT');
const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');

export const AuthProvider = ({ children, refreshHandler, initialTokens }) => {
  const [user, setUser] = useState(null);
  const tokensRef = useRef(initialTokens || {
    accessToken: localStorage.getItem('accessToken'),
    idToken: localStorage.getItem('idToken'),
    refreshToken: localStorage.getItem('refreshToken'),
  });

  // Separate ref for decoded tokens to avoid re-renders
  const decodedTokensRef = useRef({
    accessToken: null,
    idToken: null
  });

  // Decode tokens without triggering re-renders
  const decodeTokens = () => {
    try {
      if (tokensRef.current.accessToken) {
        decodedTokensRef.current.accessToken = jwtDecode(tokensRef.current.accessToken);
      }
      if (tokensRef.current.idToken) {
        decodedTokensRef.current.idToken = jwtDecode(tokensRef.current.idToken);
      }
    } catch (error) {
      console.error('Error decoding tokens:', error);
      decodedTokensRef.current = { accessToken: null, idToken: null };
    }
  };

  // Update tokens without triggering re-renders
  const updateTokens = (newTokens) => {
    if (newTokens.accessToken) {
      tokensRef.current.accessToken = newTokens.accessToken;
      localStorage.setItem('accessToken', newTokens.accessToken);
    }
    if (newTokens.idToken) {
      tokensRef.current.idToken = newTokens.idToken;
      localStorage.setItem('idToken', newTokens.idToken);
    }
    if (newTokens.refreshToken) {
      tokensRef.current.refreshToken = newTokens.refreshToken;
      localStorage.setItem('refreshToken', newTokens.refreshToken);
    }
    // Update decoded tokens after updating the tokens
    decodeTokens();
  };

  const [loading, setLoading] = useState(true);
  const [qBusinessClient, setQBusinessClient] = useState(null);
  const [qAppsClient, setQAppsClient] = useState(null);
  const [tokenValidationComplete, setTokenValidationComplete] = useState(false);

  const isTokenExpired = (decodedToken) => {
    if (!decodedToken?.exp) return true;
    const currentTime = Math.floor(Date.now() / 1000);
    return decodedToken.exp <= currentTime + 300;
  };

  const refreshTokens = async () => {
    try {
      console.log('🔄 Attempting to refresh tokens...');
      const refreshToken = tokensRef.current.refreshToken;
      const tokens = initialTokens || getUserInfo();

      if (!refreshToken) {
        console.error('No refresh token available');
        logout();
        return false;
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

      if (!result.AuthenticationResult) throw new Error('Token refresh failed');

      const { AccessToken, IdToken } = result.AuthenticationResult;

      // Update localStorage and tokensRef
      localStorage.setItem('accessToken', AccessToken);
      localStorage.setItem('idToken', IdToken);

      updateTokens({
        accessToken: AccessToken,
        idToken: IdToken,
        refreshToken,
      });

      console.log('✅ Tokens refreshed successfully');
      return true;
    } catch (error) {
      console.error('❌ Error refreshing tokens:', error);
      logout();
      return false;
    }
  };

  const getIdentityPoolCredentials = async () => {
    if (!user) return null;

    const cognitoIdentity = new CognitoIdentityClient({
      region: REGION,
    });

    return fromWebToken({
      client: cognitoIdentity,
      identityPoolId: IDENTITY_POOL_ID,
      roleSessionName: 'numa-frontend-qapps',
      roleArn: IDENTITY_POOL_ROLE_ARN,
      policy: JSON.stringify(QPolicy),
      durationSeconds: 3600,
      webIdentityToken: user.tokens.idToken,
    });
  };

  const getAccessToken = async () => {
    if (!user) return null;

    // Check if token is expired or about to expire
    if (isTokenExpired(decodedTokensRef.current.accessToken)) {
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
        identityPoolId: IDENTITY_POOL_ID,
        roleSessionName: 'numa-frontend-qapps',
        roleArn: ROLE_ARN,
        policy: JSON.stringify(QPolicy),
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

  const checkAndRefreshTokens = async () => {
    // Ensure tokens are decoded
    decodeTokens();

    if (!decodedTokensRef.current.accessToken) {
      console.log('No decoded tokens available');
      return false;
    }

    if (isTokenExpired(decodedTokensRef.current.accessToken)) {
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

  useEffect(() => {
    // Skip refresh interval in test mode
    if (!user || initialTokens) return;

    // Check tokens every 10 seconds
    const intervalId = setInterval(checkAndRefreshTokens, 10 * 1000);

    // Also check immediately when this effect runs
    checkAndRefreshTokens();

    return () => clearInterval(intervalId);
  }, [user]);

  const loadUserFromTokens = async () => {
    console.log('🔍 Checking token status...');
    const accessToken = localStorage.getItem('accessToken');
    const idToken = localStorage.getItem('idToken');
    const refreshToken = localStorage.getItem('refreshToken');

    if (refreshToken) {
      if (
        !accessToken ||
        !idToken ||
        isTokenExpired(decodedTokensRef.current.accessToken) ||
        isTokenExpired(decodedTokensRef.current.idToken)
      ) {
        console.log('⚠️ Tokens expired or missing, attempting refresh...');
        const refreshed = await refreshTokens();
        if (!refreshed) {
          console.log('❌ Token refresh failed, logging out');
          setUser(null);
        }
      } else {
        console.log('✅ Tokens are valid');
        const decodedAccessToken = decodedTokensRef.current.accessToken;
        const decodedIdToken = decodedTokensRef.current.idToken;

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
    decodeTokens();
    loadUserFromTokens();
  }, []);

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

  const requestPasswordReset = async (email) => {
    try {
      const command = new ForgotPasswordCommand({
        Username: email,
        ClientId: CLIENT_ID,
      });

      const cognitoClient = new CognitoIdentityProviderClient({
        region: REGION,
      });
      await cognitoClient.send(command);
      return { success: true };
    } catch (error) {
      throw new Error(`Error requesting password reset: ${error.message}`);
    }
  };

  const confirmPasswordReset = async (email, code, newPassword) => {
    try {
      const command = new ConfirmForgotPasswordCommand({
        Username: email,
        ClientId: CLIENT_ID,
        ConfirmationCode: code,
        Password: newPassword,
      });

      const cognitoClient = new CognitoIdentityProviderClient({
        region: REGION,
      });
      await cognitoClient.send(command);
      return { success: true };
    } catch (error) {
      throw new Error(`Error resetting password: ${error.message}`);
    }
  };

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
    qBusinessClient,
    qAppsClient,
    requestPasswordReset,
    confirmPasswordReset,
    getIdentityPoolCredentials
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
