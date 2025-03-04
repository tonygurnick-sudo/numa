import { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { jwtDecode } from 'jwt-decode';
import { QBusinessClient } from '@aws-sdk/client-qbusiness';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QAppsClient } from '@aws-sdk/client-qapps';
import { fromWebToken, fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { generatePolicy } from '../Modules/QPolicyGenerator';
import { generateBedrockPolicy } from '../Modules/BedrockPolicyGenerator';
import { generateDynamoDBPolicy } from '../Modules/DynamoDBPolicyGenerator';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { fetchConfigAddtoSession } from '../Components/ConfigSetup';
import { NumaChatDynamoUtils } from '../utils/DynamoDBUtils';
import { NumaBedrockUtils } from '../utils/NumaBedrockUtils';

const AuthContext = createContext(null);

const IDENTITY_POOL_ID = window.sessionStorage.getItem('IDENTITY_POOL_ID');
const ROLE_ARN = window.sessionStorage.getItem('ROLE_ARN');
const REGION = window.sessionStorage.getItem('REGION');
const API_ENDPOINT = window.sessionStorage.getItem('API_ENDPOINT');
const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');
const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
const client = window.sessionStorage.getItem('CLIENT_NAME'); // e.g. "arcanum-demo"
const environment = window.sessionStorage.getItem('ENVIRONMENT_NAME') || 'prod'; // default to "prod" if not set
const NUMA_CHAT_HISTORY_TABLE_NAME = `numa-${client}${environment !== 'prod' ? `-${environment}` : ''}-chat-history`;

export const AuthProvider = ({ children, refreshHandler, initialTokens }) => {
  const [user, setUser] = useState(null);
  const tokensRef = useRef(
    initialTokens || {
      accessToken: localStorage.getItem('accessToken'),
      idToken: localStorage.getItem('idToken'),
      refreshToken: localStorage.getItem('refreshToken'),
    },
  );

  // Separate ref for decoded tokens to avoid re-renders
  const decodedTokensRef = useRef({
    accessToken: null,
    idToken: null,
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

  const [qAppsClient, setQAppsClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qBusinessClient, setQBusinessClient] = useState(null);
  const [bedrockRuntimeClient, setBedrockRuntimeClient] = useState(null);
  const [numaChatBedrockUtils, setNumaChatBedrockUtils] = useState(null);
  const [dynamoDBClient, setDynamoDBClient] = useState(null);
  const [numaChatDynamoUtils, setNumaChatDynamoUtils] = useState(null);
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

      if (!refreshToken) {
        console.error('No refresh token available');
        logout();
        return false;
      }

      const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

      const params = {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      };

      const command = new InitiateAuthCommand(params);
      const response = await cognitoClient.send(command);

      if (!response.AuthenticationResult) throw new Error('Token refresh failed');

      const { AccessToken, IdToken } = response.AuthenticationResult;

      // Update localStorage and tokensRef
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

      const accountId = ROLE_ARN.split(':')[4];
      const policy = generatePolicy({
        Region: REGION,
        AccountId: accountId,
        ApplicationId: Q_APPLICATION_ID,
      });

      const credentials = fromWebToken({
        client: cognitoIdentity,
        identityPoolId: IDENTITY_POOL_ID,
        roleSessionName: 'numa-frontend-chat',
        roleArn: ROLE_ARN,
        policy: JSON.stringify(policy),
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

  const initializeBedrockRuntimeClient = useCallback(async () => {
    if (!user) return;

    const cognitoIdentity = new CognitoIdentityClient({ region: REGION });

    try {
      const idToken = user.tokens.idToken;

      const accountId = ROLE_ARN.split(':')[4];
      const policy = generateBedrockPolicy({
        Region: REGION,
        AccountId: accountId,
      });

      const credentials = fromWebToken({
        client: cognitoIdentity,
        identityPoolId: IDENTITY_POOL_ID,
        roleSessionName: 'numa-frontend-bedrock',
        roleArn: ROLE_ARN,
        policy: JSON.stringify(policy),
        durationSeconds: 3600,
        webIdentityToken: idToken,
      });

      const newClient = new BedrockRuntimeClient({
        region: REGION,
        credentials: await credentials(),
      });

      setBedrockRuntimeClient(newClient);
      const utils = new NumaBedrockUtils(newClient);
      setNumaChatBedrockUtils(utils);
    } catch (error) {
      console.error('Error in BedrockRuntimeClient initialization:', error);
    }
  }, [user]);

  const initializeDynamoDBClient = useCallback(async () => {
    if (!user) return;

    const cognitoIdentity = new CognitoIdentityClient({ region: REGION });

    try {
      const idToken = user.tokens.idToken;

      const accountId = ROLE_ARN.split(':')[4];
      const policy = generateDynamoDBPolicy({
        Region: REGION,
        AccountId: accountId,
        NumaChatHistoryTableName: NUMA_CHAT_HISTORY_TABLE_NAME,
      });

      const credentials = fromWebToken({
        client: cognitoIdentity,
        identityPoolId: IDENTITY_POOL_ID,
        roleSessionName: 'numa-frontend-chat',
        roleArn: ROLE_ARN,
        policy: JSON.stringify(policy),
        durationSeconds: 3600,
        webIdentityToken: idToken,
      });

      const newClient = new DynamoDBClient({
        region: REGION,
        credentials: await credentials(),
      });
      setDynamoDBClient(newClient);
      const utils = new NumaChatDynamoUtils(newClient);
      setNumaChatDynamoUtils(utils);
    } catch (error) {
      console.error('Error in DynamoDBClient initialization:', error);
    }
  }, [user]);

  const initializeQAppsClient = useCallback(async () => {
    if (!user) return;

    const cognitoIdentity = new CognitoIdentityClient({ region: REGION });

    const accountId = ROLE_ARN.split(':')[4];
    const policy = generatePolicy({
      Region: REGION,
      AccountId: accountId,
      ApplicationId: Q_APPLICATION_ID,
    });

    try {
      const idToken = user.tokens.idToken;
      const credentials = fromWebToken({
        client: cognitoIdentity,
        identityPoolId: IDENTITY_POOL_ID,
        roleSessionName: 'numa-frontend-qapps',
        roleArn: ROLE_ARN,
        policy: JSON.stringify(policy),
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
      initializeBedrockRuntimeClient();
      initializeDynamoDBClient();
    } else {
      setQBusinessClient(null);
      setQAppsClient(null);
      setBedrockRuntimeClient(null);
      setNumaChatBedrockUtils(null);
      setDynamoDBClient(null);
      setNumaChatDynamoUtils(null);
    }
  }, [
    user,
    initializeQBusinessClient,
    initializeQAppsClient,
    initializeBedrockRuntimeClient,
    initializeDynamoDBClient,
  ]);

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
    try {
      const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

      // Fetch the secret hash from your backend
      const secretHashResponse = await fetch(`${API_ENDPOINT}/srp-hasher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username }),
      });

      const { hash: SECRET_HASH } = await secretHashResponse.json();

      // Step 1: Create SRP session
      const srpSession = createSrpSession(username, password, USER_POOL_ID, false); // false for not hashed already

      // Step 2: Initiate authentication
      const initiateAuthParams = {
        AuthFlow: 'USER_SRP_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: username,
          SRP_A: srpSession.largeA,
          SECRET_HASH: SECRET_HASH,
        },
      };

      const initiateAuthCommand = new InitiateAuthCommand(initiateAuthParams);
      const initiateAuthResponse = await cognitoClient.send(initiateAuthCommand);

      if (!initiateAuthResponse.ChallengeParameters) {
        throw new Error('Missing ChallengeParameters in InitiateAuthResponse');
      }
      // Step 3: Sign SRP session
      const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);

      // Step 4: Respond to the password verifier challenge
      const respondToAuthChallengeParams = {
        ChallengeName: 'PASSWORD_VERIFIER',
        ClientId: CLIENT_ID,
        ChallengeResponses: {
          USERNAME: username,
          PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
          PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
          SECRET_HASH: SECRET_HASH,
          TIMESTAMP: signedSrpSession.timestamp,
        },
      };

      const respondToAuthChallengeCommand = new RespondToAuthChallengeCommand(respondToAuthChallengeParams);
      const respondToAuthChallengeResponse = await cognitoClient.send(respondToAuthChallengeCommand);

      if (respondToAuthChallengeResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return { requiresNewPassword: true, session: respondToAuthChallengeResponse.AuthenticationResult };
      }

      await handleLoginSuccess(respondToAuthChallengeResponse.AuthenticationResult);
      return { success: true };
    } catch (error) {
      console.error('Error during authentication:', error);
      throw error;
    }
  };

  const setNewPassword = async (username, oldPassword, newPassword) => {
    try {
      const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

      // Fetch the secret hash from your backend
      const secretHashResponse = await fetch(`${API_ENDPOINT}/srp-hasher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username }),
      });

      const { hash: SECRET_HASH } = await secretHashResponse.json();

      // Step 1: Create SRP session for old password
      const srpSession = createSrpSession(username, oldPassword, USER_POOL_ID, false);

      // Step 2: Initiate authentication with SRP
      const initiateAuthParams = {
        AuthFlow: 'USER_SRP_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: username,
          SRP_A: srpSession.largeA,
          SECRET_HASH: SECRET_HASH,
        },
      };

      const initiateAuthCommand = new InitiateAuthCommand(initiateAuthParams);
      const initiateAuthResponse = await cognitoClient.send(initiateAuthCommand);

      if (initiateAuthResponse.ChallengeName === 'PASSWORD_VERIFIER') {
        // Step 3: Sign SRP session
        const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);

        // Step 4: Respond to the password verifier challenge
        const respondToAuthChallengeParams = {
          ChallengeName: 'PASSWORD_VERIFIER',
          ClientId: CLIENT_ID,
          Session: initiateAuthResponse.Session,
          ChallengeResponses: {
            USERNAME: username,
            PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
            PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
            SECRET_HASH: SECRET_HASH,
            TIMESTAMP: signedSrpSession.timestamp,
          },
        };

        const respondToAuthChallengeCommand = new RespondToAuthChallengeCommand(respondToAuthChallengeParams);
        const respondToAuthChallengeResponse = await cognitoClient.send(respondToAuthChallengeCommand);

        if (respondToAuthChallengeResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
          // Step 5: Respond to the new password required challenge
          const newPasswordChallengeParams = {
            ClientId: CLIENT_ID,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: respondToAuthChallengeResponse.Session,
            ChallengeResponses: {
              USERNAME: username,
              NEW_PASSWORD: newPassword,
              SECRET_HASH: SECRET_HASH,
            },
          };

          const newPasswordChallengeCommand = new RespondToAuthChallengeCommand(newPasswordChallengeParams);
          await cognitoClient.send(newPasswordChallengeCommand);

          // Login with new password
          return await login(username, newPassword);
        } else {
          throw new Error('Unexpected authentication response');
        }
      } else {
        throw new Error('Unexpected authentication response');
      }
    } catch (error) {
      console.error('Error during setNewPassword:', error);
      throw error;
    }
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
      // Fetch the secret hash from your backend
      const secretHashResponse = await fetch(`${API_ENDPOINT}/srp-hasher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });

      const { hash: SECRET_HASH } = await secretHashResponse.json();

      const command = new ForgotPasswordCommand({
        Username: email,
        ClientId: CLIENT_ID,
        SecretHash: SECRET_HASH,
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
      // Fetch the secret hash from your backend
      const secretHashResponse = await fetch(`${API_ENDPOINT}/srp-hasher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });

      const { hash: SECRET_HASH } = await secretHashResponse.json();

      const command = new ConfirmForgotPasswordCommand({
        Username: email,
        ClientId: CLIENT_ID,
        ConfirmationCode: code,
        Password: newPassword,
        SecretHash: SECRET_HASH,
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

  const getWebTokenCredentials = async () => {
    const cognitoIdentity = new CognitoIdentityClient({ region: REGION });

    const accountId = ROLE_ARN.split(':')[4];

    const idToken = user.tokens.idToken;

    const policy = generatePolicy({
      Region: REGION,
      AccountId: accountId,
      ApplicationId: Q_APPLICATION_ID,
    });

    const credentials = await fromWebToken({
      client: cognitoIdentity,
      identityPoolId: IDENTITY_POOL_ID,
      roleSessionName: 'numa-frontend-chat',
      roleArn: ROLE_ARN,
      policy: JSON.stringify(policy),
      durationSeconds: 3600,
      webIdentityToken: idToken,
    });

    return credentials;
  };

  const getIdentityPoolCredentials = async () => {
    if (!user) return null;

    try {
      const cognitoIdentity = new CognitoIdentityClient({
        region: REGION,
      });

      const credentials = await fromCognitoIdentityPool({
        client: cognitoIdentity,
        identityPoolId: IDENTITY_POOL_ID,
        roleSessionName: 'numa-frontend-file-uploader',
        logins: {
          [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: user.tokens.idToken,
        },
      })();

      return credentials;
    } catch (error) {
      console.error('Error getting credentials:', error);
      throw error;
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
    bedrockRuntimeClient,
    numaChatBedrockUtils,
    dynamoDBClient,
    numaChatDynamoUtils,
    requestPasswordReset,
    confirmPasswordReset,
    getIdentityPoolCredentials,
    getWebTokenCredentials,
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
export const TestAuthProvider = ({ children, refreshHandler, initialTokens }) => {
  return (
    <AuthProvider refreshHandler={refreshHandler} initialTokens={initialTokens}>
      {children}
    </AuthProvider>
  );
};
