import { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { jwtDecode } from 'jwt-decode';
import { QBusinessClient } from '@aws-sdk/client-qbusiness';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QAppsClient } from '@aws-sdk/client-qapps';
import { fromTemporaryCredentials, fromWebToken } from '@aws-sdk/credential-providers';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { NumaChatDynamoUtils } from '../utils/DynamoDBUtils';
import { NumaBedrockUtils } from '../utils/NumaBedrockUtils';

const AuthContext = createContext(null);

export const AuthProvider = ({ children, initialTokens }) => {
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

  // Add ref to track ongoing refresh operations
  const refreshInProgressRef = useRef(false);
  const refreshPromiseRef = useRef(null);

  // Decode tokens without triggering re-renders
  const decodeTokens = () => {
    if (!tokensRef.current.idToken) {
      console.log('❌ No ID token found');
      setUser(null);
      return;
    }

    try {
      const { accessToken, idToken } = tokensRef.current;

      // Reset decoded tokens first
      decodedTokensRef.current = { accessToken: null, idToken: null };

      // Only attempt to decode if tokens exist
      if (accessToken) {
        try {
          decodedTokensRef.current.accessToken = jwtDecode(accessToken);
        } catch (e) {
          console.warn('Failed to decode access token:', e);
        }
      }

      if (idToken) {
        try {
          decodedTokensRef.current.idToken = jwtDecode(idToken);
        } catch (e) {
          console.warn('Failed to decode ID token:', e);
        }
      }

      // Replace manual group and feature extraction with utility function
      const { groups, features } = extractGroupsAndFeatures(decodedTokensRef.current.idToken);
      setUser((prev) => ({
        ...prev,
        groups,
        features: features || [],
      }));

      // Log the actual tokens for debugging
      console.debug('Token status:', {
        hasAccessToken: !!accessToken,
        hasIdToken: !!idToken,
        decodedAccess: !!decodedTokensRef.current.accessToken,
        decodedId: !!decodedTokensRef.current.idToken,
      });
    } catch (error) {
      console.error('Error in decodeTokens:', error);
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
  const [bedrockAgentRuntimeClient, setBedrockAgentRuntimeClient] = useState(null);
  const [bedrockAgentClient, setBedrockAgentClient] = useState(null);
  const [numaChatBedrockUtils, setNumaChatBedrockUtils] = useState(null);
  const [dynamoDBClient, setDynamoDBClient] = useState(null);
  const [numaChatDynamoUtils, setNumaChatDynamoUtils] = useState(null);
  const [tokenValidationComplete, setTokenValidationComplete] = useState(false);

  const isTokenExpired = (decodedToken) => {
    if (!decodedToken?.exp) return true;
    const currentTime = Math.floor(Date.now() / 1000);
    return decodedToken.exp <= currentTime + 300;
  };

  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const fetchSecretHash = async (identifier) => {
    const API_ENDPOINT = window.sessionStorage.getItem('API_ENDPOINT');

    // Check that the identifier is all lowercase
    if (identifier !== identifier.toLowerCase()) {
      // Get the call stack but remove the first line (current function)
      const callStack = new Error().stack?.split('\n').slice(1).join('\n');
      console.error('Uppercase email detected:', {
        original: identifier,
        lowercase: identifier.toLowerCase(),
        callStack,
      });
    }

    try {
      // Check if identifier is provided
      if (!identifier) {
        throw new Error('No identifier provided');
      }

      // Determine if identifier is email or userSub
      const isEmail = isValidEmail(identifier);
      const payload = isEmail ? { email: identifier } : { userSub: identifier };

      const secretHashResponse = await fetch(`${API_ENDPOINT}/srp-hasher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!secretHashResponse.ok) {
        throw new Error(`HTTP error! status: ${secretHashResponse.status}`);
      }

      const data = await secretHashResponse.json();

      if (!data.hash) {
        throw new Error('Secret hash not received from server');
      }

      return data.hash;
    } catch (error) {
      console.error('Failed to fetch secret hash:', {
        error: error.message,
        identifierType: isValidEmail(identifier) ? 'email' : 'userSub',
        endpoint: `${API_ENDPOINT}/srp-hasher`,
      });
      throw new Error(`Failed to fetch secret hash: ${error.message}`);
    }
  };

  const refreshTokens = async () => {
    // Prevent concurrent refresh operations
    if (refreshInProgressRef.current) {
      console.log('🔄 Token refresh already in progress, waiting for completion...');
      return refreshPromiseRef.current;
    }

    refreshInProgressRef.current = true;

    const refreshOperation = async () => {
      try {
        console.log('🔄 Attempting to refresh tokens...');
        const refreshToken = tokensRef.current.refreshToken;
        const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');
        const REGION = window.sessionStorage.getItem('REGION');

        if (!refreshToken) {
          console.error('No refresh token available');
          logout();
          return false;
        }

        const idToken = tokensRef.current.idToken;
        const decodedIdToken = jwtDecode(idToken);
        const username = decodedIdToken.sub;
        if (!username) {
          console.error('No username available');
          logout();
          return false;
        }

        const SECRET_HASH = await fetchSecretHash(username);

        const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

        const params = {
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: CLIENT_ID,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
            SECRET_HASH: SECRET_HASH,
          },
        };

        const command = new InitiateAuthCommand(params);
        const response = await cognitoClient.send(command);

        if (!response.AuthenticationResult) throw new Error('Token refresh failed');

        const { AccessToken, IdToken } = response.AuthenticationResult;

        // Update tokensRef directly
        tokensRef.current = {
          ...tokensRef.current,
          accessToken: AccessToken,
          idToken: IdToken,
        };

        // Update localStorage and decode tokens
        updateTokens({
          accessToken: AccessToken,
          idToken: IdToken,
          refreshToken,
        });

        // Decode the new tokens to update the decoded token references
        const newDecodedAccessToken = jwtDecode(AccessToken);
        const newDecodedIdToken = jwtDecode(IdToken);

        // Update the user state object with the refreshed tokens
        // This ensures all AWS clients will be reinitialized with the new tokens
        setUser((prev) => ({
          ...prev,
          tokens: {
            accessToken: AccessToken,
            idToken: IdToken,
            refreshToken,
          },
          decoded_tokens: {
            accessToken: newDecodedAccessToken,
            idToken: newDecodedIdToken,
          },
        }));

        // Use the utility function to extract groups and features
        const { groups, features } = extractGroupsAndFeatures(newDecodedIdToken);
        setUser((prev) => ({
          ...prev,
          groups,
          features: features || [],
        }));

        // Add console log to debug features initialization
        console.log('Decoded groups:', groups);
        console.log('Extracted features:', features);

        console.log('✅ Tokens refreshed successfully');
        return true;
      } catch (error) {
        console.error('❌ Error refreshing tokens:', error);
        logout();
        return false;
      } finally {
        refreshInProgressRef.current = false;
        refreshPromiseRef.current = null;
      }
    };

    refreshPromiseRef.current = refreshOperation();
    return refreshPromiseRef.current;
  };

  // Centralized token validation function
  const ensureValidTokens = async () => {
    const decodedIdToken = decodedTokensRef.current.idToken;
    if (!decodedIdToken || isTokenExpired(decodedIdToken)) {
      console.log('Tokens expired or invalid, refreshing before client initialization...');
      const refreshed = await refreshTokens();
      if (!refreshed) {
        console.error('Failed to refresh tokens for client initialization');
        return false;
      }
    }
    return true;
  };

  const getAccessToken = async () => {
    if (!user) return null;

    // Check if token is expired or about to expire
    if (isTokenExpired(decodedTokensRef.current.accessToken)) {
      const refreshed = await refreshTokens();
      if (!refreshed) return null;
    }

    // Return the current access token from tokensRef instead of user.tokens
    return tokensRef.current.accessToken;
  };

  const initializeQBusinessClient = useCallback(async () => {
    if (!user) return;

    const REGION = window.sessionStorage.getItem('REGION');
    const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS'));
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

    if (!REGION || !GROUPS || !USER_POOL_ID) {
      console.error('Missing required session storage values for QBusinessClient initialization');
      return;
    }

    // Validate that user has decoded tokens
    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    // Get role ARN instead of identity pool ID, defaulting to standard group
    const userGroup =
      (user.decoded_tokens.idToken['cognito:groups'] && user.decoded_tokens.idToken['cognito:groups'][0]) || 'standard';
    const roleArn = GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      console.error('No role ARN found for user group:', userGroup, 'available groups:', Object.keys(GROUPS));
      return;
    }

    try {
      const idToken = tokensRef.current.idToken;
      if (!idToken) {
        console.error('No ID token available for QBusinessClient initialization');
        return;
      }

      const credentials = fromWebToken({
        roleSessionName: 'numa-qbusiness-client',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 3600,
      });

      const newClient = new QBusinessClient({
        region: REGION,
        credentials: await credentials(),
      });

      setQBusinessClient(newClient);
    } catch (error) {
      console.error('Error in QBusinessClient initialization:', error);
      // Don't throw the error, just log it and continue
    }
  }, [user]);

  const initializeBedrockRuntimeClient = useCallback(async () => {
    if (!user) return;

    const REGION = window.sessionStorage.getItem('REGION');
    const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS'));
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
    const BEDROCK_ACCOUNT = window.sessionStorage.getItem('BEDROCK_ACCOUNT');

    if (!REGION || !GROUPS || !USER_POOL_ID) {
      console.error('Missing required session storage values for BedrockRuntimeClient initialization');
      return;
    }

    // Validate that user has decoded tokens
    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    // Get role ARN instead of identity pool ID, defaulting to standard group
    const userGroup =
      (user.decoded_tokens.idToken['cognito:groups'] && user.decoded_tokens.idToken['cognito:groups'][0]) || 'standard';
    const roleArn = GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      console.error('No role ARN found for user group:', userGroup, 'available groups:', Object.keys(GROUPS));
      return;
    }

    try {
      const idToken = tokensRef.current.idToken;
      if (!idToken) {
        console.error('No ID token available for BedrockRuntimeClient initialization');
        return;
      }

      let credentials = await fromWebToken({
        roleSessionName: 'numa-bedrock-client',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 3600,
      })();

      // If BEDROCK_ACCOUNT has been set, we should use another accounts Bedrock, so assume into there.
      if (BEDROCK_ACCOUNT) {
        const bedrockRole = `arn:aws:iam::${BEDROCK_ACCOUNT}:role/bedrock-quota-sharing`;
        credentials = fromTemporaryCredentials({
          masterCredentials: credentials,
          params: {
            RoleArn: bedrockRole,
          },
        });
      }

      const newClient = new BedrockRuntimeClient({
        region: REGION,
        credentials,
      });

      setBedrockRuntimeClient(newClient);
      const utils = new NumaBedrockUtils(newClient);
      setNumaChatBedrockUtils(utils);
    } catch (error) {
      console.error('Error in BedrockRuntimeClient initialization:', error);
      // Don't throw the error, just log it and continue
    }
  }, [user]);

  const initializeBedrockAgentRuntimeClient = useCallback(async () => {
    if (!user) return;

    const REGION = window.sessionStorage.getItem('REGION');
    const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS'));
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

    if (!REGION || !GROUPS || !USER_POOL_ID) {
      console.error('Missing required session storage values for BedrockAgentRuntimeClient initialization');
      return;
    }

    // Validate that user has decoded tokens
    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    // Get role ARN instead of identity pool ID, defaulting to standard group
    const userGroup =
      (user.decoded_tokens.idToken['cognito:groups'] && user.decoded_tokens.idToken['cognito:groups'][0]) || 'standard';
    const roleArn = GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      console.error('No role ARN found for user group:', userGroup, 'available groups:', Object.keys(GROUPS));
      return;
    }

    try {
      const idToken = tokensRef.current.idToken;
      if (!idToken) {
        console.error('No ID token available for BedrockAgentRuntimeClient initialization');
        return;
      }

      const credentials = fromWebToken({
        roleSessionName: 'numa-bedrock-agent-runtime-client',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 3600,
      });

      const newClient = new BedrockAgentRuntimeClient({
        region: REGION,
        credentials: await credentials(),
      });

      setBedrockAgentRuntimeClient(newClient);
    } catch (error) {
      console.error('Error in BedrockAgentRuntimeClient initialization:', error);
    }
  }, [user]);

  const initializeBedrockAgentClient = useCallback(async () => {
    if (!user) return;

    const REGION = window.sessionStorage.getItem('REGION');
    const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS'));
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

    if (!REGION || !GROUPS || !USER_POOL_ID) {
      console.error('Missing required session storage values for BedrockAgentClient initialization');
      return;
    }

    // Validate that user has decoded tokens
    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    // Get role ARN instead of identity pool ID, defaulting to standard group
    const userGroup =
      (user.decoded_tokens.idToken['cognito:groups'] && user.decoded_tokens.idToken['cognito:groups'][0]) || 'standard';
    const roleArn = GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      console.error('No role ARN found for user group:', userGroup, 'available groups:', Object.keys(GROUPS));
      return;
    }

    try {
      const idToken = tokensRef.current.idToken;
      if (!idToken) {
        console.error('No ID token available for BedrockAgentClient initialization');
        return;
      }

      const credentials = fromWebToken({
        roleSessionName: 'numa-bedrock-agent-client',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 3600,
      });

      const newClient = new BedrockAgentClient({
        region: REGION,
        credentials: await credentials(),
      });

      setBedrockAgentClient(newClient);
    } catch (error) {
      console.error('Error in BedrockAgentClient initialization:', error);
    }
  }, [user]);

  const initializeDynamoDBClient = useCallback(async () => {
    if (!user) return;

    // Check if the user has the permissions to Chat
    if (user && user.features && !user.features.includes('chat')) {
      return;
    }

    const REGION = window.sessionStorage.getItem('REGION');
    const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS'));
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

    if (!REGION || !GROUPS || !USER_POOL_ID) {
      console.error('Missing required session storage values for DynamoDBClient initialization');
      return;
    }

    // Validate that user has decoded tokens
    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    // Get role ARN instead of identity pool ID, defaulting to standard group
    const userGroup =
      (user.decoded_tokens.idToken['cognito:groups'] && user.decoded_tokens.idToken['cognito:groups'][0]) || 'standard';
    const roleArn = GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      console.error('No role ARN found for user group:', userGroup, 'available groups:', Object.keys(GROUPS));
      return;
    }

    try {
      const idToken = tokensRef.current.idToken;
      if (!idToken) {
        console.error('No ID token available for DynamoDBClient initialization');
        return;
      }

      const credentials = await fromWebToken({
        roleSessionName: 'numa-dynamo-client',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 3600,
      })();

      const newClient = new DynamoDBClient({
        region: REGION,
        credentials: credentials,
      });

      setDynamoDBClient(newClient);
      const utils = new NumaChatDynamoUtils(newClient);
      setNumaChatDynamoUtils(utils);
    } catch (error) {
      console.error('Error in DynamoDBClient initialization:', error);
      // Don't throw the error, just log it and continue
    }
  }, [user]);

  const initializeQAppsClient = useCallback(async () => {
    if (!user) return;

    const REGION = window.sessionStorage.getItem('REGION');
    const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS'));
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');

    if (!REGION || !GROUPS || !USER_POOL_ID) {
      console.error('Missing required session storage values for QAppsClient initialization');
      return;
    }

    // Validate that user has decoded tokens
    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    // Get role ARN instead of identity pool ID, defaulting to standard group
    const userGroup =
      (user.decoded_tokens.idToken['cognito:groups'] && user.decoded_tokens.idToken['cognito:groups'][0]) || 'standard';
    const roleArn = GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      console.error('No role ARN found for user group:', userGroup, 'available groups:', Object.keys(GROUPS));
      return;
    }

    try {
      const idToken = tokensRef.current.idToken;
      if (!idToken) {
        console.error('No ID token available for QAppsClient initialization');
        return;
      }

      const credentials = await fromWebToken({
        roleSessionName: 'numa-qapps-client',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 3600,
      })();

      const newQAppsClient = new QAppsClient({
        region: REGION,
        credentials: credentials,
      });

      setQAppsClient(newQAppsClient);
    } catch (error) {
      console.error('Error in QAppsClient initialization:', error);
      // Don't throw the error, just log it and continue
    }
  }, [user]);

  useEffect(() => {
    // Only initialize clients after token validation is complete and user is properly loaded
    if (user && tokenValidationComplete && user.decoded_tokens?.idToken && user.features?.length > 0) {
      // Add a small delay to ensure tokens are properly set
      const timer = setTimeout(async () => {
        // Ensure tokens are valid before initializing any clients
        const tokensValid = await ensureValidTokens();
        if (tokensValid) {
          // Initialize all clients after token validation
          initializeQBusinessClient();
          initializeQAppsClient();
          initializeBedrockRuntimeClient();
          initializeBedrockAgentRuntimeClient();
          initializeBedrockAgentClient();
          initializeDynamoDBClient();
        }
      }, 100);

      return () => clearTimeout(timer);
    } else {
      setQBusinessClient(null);
      setQAppsClient(null);
      setBedrockRuntimeClient(null);
      setBedrockAgentRuntimeClient(null);
      setBedrockAgentClient(null);
      setNumaChatBedrockUtils(null);
      setDynamoDBClient(null);
      setNumaChatDynamoUtils(null);
    }
  }, [
    user,
    tokenValidationComplete,
    initializeQBusinessClient,
    initializeQAppsClient,
    initializeBedrockRuntimeClient,
    initializeBedrockAgentRuntimeClient,
    initializeBedrockAgentClient,
    initializeDynamoDBClient,
  ]);

  const checkAndRefreshTokens = async () => {
    const { accessToken } = tokensRef.current;
    if (!accessToken) {
      console.log('No access token available');
      return false;
    }

    try {
      const decodedAccessToken = jwtDecode(accessToken);
      if (isTokenExpired(decodedAccessToken)) {
        console.log('🕒 Token check: Token expired, attempting refresh...');
        const refreshed = await refreshTokens();
        if (!refreshed) {
          logout();
          return false;
        }
        return true;
      }

      return true;
    } catch (error) {
      console.error('Error decoding token during check:', error);
      return false;
    }
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

    // Update tokensRef before decoding
    tokensRef.current = {
      accessToken,
      idToken,
      refreshToken,
    };

    // Decode tokens after updating tokensRef
    decodeTokens();

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

        if (!decodedIdToken) {
          console.log('❌ No decoded ID token found');
          setUser(null);
          return;
        }

        // Use the utility function to extract groups and features
        const { groups, features } = extractGroupsAndFeatures(decodedIdToken);
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
          groups,
          features: features || [],
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

  const performSrpAuthentication = async (username, password) => {
    const REGION = window.sessionStorage.getItem('REGION');
    const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
    const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

    const lowercaseUsername = username.toLowerCase();
    const SECRET_HASH = await fetchSecretHash(lowercaseUsername);

    // Step 1: Create SRP session
    const srpSession = createSrpSession(lowercaseUsername, password, USER_POOL_ID, false);

    // Step 2: Initiate authentication
    const initiateAuthParams = {
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: lowercaseUsername,
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
        USERNAME: lowercaseUsername,
        PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
        PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
        SECRET_HASH: SECRET_HASH,
        TIMESTAMP: signedSrpSession.timestamp,
      },
    };

    const respondToAuthChallengeCommand = new RespondToAuthChallengeCommand(respondToAuthChallengeParams);
    const respondToAuthChallengeResponse = await cognitoClient.send(respondToAuthChallengeCommand);

    return {
      response: respondToAuthChallengeResponse,
      cognitoClient,
      lowercaseUsername,
      SECRET_HASH,
      CLIENT_ID,
    };
  };

  const login = async (username, password) => {
    try {
      const { response } = await performSrpAuthentication(username, password);

      if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return { requiresNewPassword: true, session: response.AuthenticationResult };
      }

      await handleLoginSuccess(response.AuthenticationResult);
      return { success: true };
    } catch (error) {
      console.error('Error during authentication:', error);
      throw error;
    }
  };

  const setNewPassword = async (username, oldPassword, newPassword) => {
    try {
      const { response, cognitoClient, lowercaseUsername, SECRET_HASH, CLIENT_ID } = await performSrpAuthentication(
        username,
        oldPassword,
      );

      if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        // Handle new password challenge
        const newPasswordChallengeParams = {
          ClientId: CLIENT_ID,
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: response.Session,
          ChallengeResponses: {
            USERNAME: lowercaseUsername,
            NEW_PASSWORD: newPassword,
            SECRET_HASH: SECRET_HASH,
          },
        };

        const newPasswordChallengeCommand = new RespondToAuthChallengeCommand(newPasswordChallengeParams);
        await cognitoClient.send(newPasswordChallengeCommand);

        // Login with new password
        return await login(lowercaseUsername, newPassword);
      } else {
        throw new Error('Unexpected authentication response');
      }
    } catch (error) {
      console.error('Error during setNewPassword:', error);
      throw error;
    }
  };

  const handleLoginSuccess = async (tokens) => {
    // Update tokensRef directly
    tokensRef.current = {
      accessToken: tokens.AccessToken,
      idToken: tokens.IdToken,
      refreshToken: tokens.RefreshToken,
    };

    // Update localStorage
    localStorage.setItem('accessToken', tokens.AccessToken);
    localStorage.setItem('refreshToken', tokens.RefreshToken);
    localStorage.setItem('idToken', tokens.IdToken);

    const decodedAccessToken = jwtDecode(tokens.AccessToken);
    const decodedIdToken = jwtDecode(tokens.IdToken);

    // Use the utility function to extract groups and features
    const { groups, features } = extractGroupsAndFeatures(decodedIdToken);
    setUser((prev) => ({
      ...prev,
      tokens: {
        accessToken: tokens.AccessToken,
        idToken: tokens.IdToken,
        refreshToken: tokens.RefreshToken,
      },
      decoded_tokens: {
        accessToken: decodedAccessToken,
        idToken: decodedIdToken,
      },
      groups,
      features: features || [],
    }));
  };

  // Initialize user state from testConfig if available
  useEffect(() => {
    if (initialTokens) {
      setUser(initialTokens);
    }
  }, [initialTokens]);

  const requestPasswordReset = async (email, mode = 'reset') => {
    try {
      const lowercaseEmail = email.toLowerCase();
      const SECRET_HASH = await fetchSecretHash(lowercaseEmail);

      const REGION = window.sessionStorage.getItem('REGION');
      const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');

      // Add mode parameter to distinguish between reset and create password flows
      const command = new ForgotPasswordCommand({
        Username: lowercaseEmail,
        ClientId: CLIENT_ID,
        SecretHash: SECRET_HASH,
        // Custom client metadata can be used to pass additional information
        ClientMetadata: {
          mode: mode, // 'reset' or 'create'
        },
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
      const SECRET_HASH = await fetchSecretHash(email);
      const REGION = window.sessionStorage.getItem('REGION');
      const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');

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

  const getCredentials = async () => {
    const REGION = window.sessionStorage.getItem('REGION');

    if (!user) {
      console.log('No user found');
      return null;
    }

    // Use the same group selection logic as other functions
    const groups = JSON.parse(window.sessionStorage.getItem('GROUPS')) || {};
    const userGroup =
      (user.decoded_tokens.idToken['cognito:groups'] && user.decoded_tokens.idToken['cognito:groups'][0]) || 'standard';
    const roleArn = groups[userGroup]?.roleArn;

    // Check if user has the features
    // If there are no features, block the request since we need to wait until the user has features
    if (user.features.length === 0 || !roleArn) {
      console.log('User features:', user.features);
      console.log('Role ARN:', roleArn);
      console.log('User group:', userGroup);
      console.log('Available groups:', Object.keys(groups));
      console.log('No features found or role ARN not found');
      return null;
    }

    if (!REGION) {
      console.error('No REGION found in session storage');
      return null;
    }

    try {
      // Check if tokens are expired or will expire in the next 20 seconds
      const decodedIdToken = decodedTokensRef.current.idToken;
      const currentTime = Math.floor(Date.now() / 1000);
      const willExpireSoon = decodedIdToken?.exp && decodedIdToken.exp <= currentTime + 20;

      if (!decodedIdToken || willExpireSoon) {
        console.log('Token expired or will expire soon, token time is:', decodedIdToken?.exp);
        console.log('🔄 Refreshing tokens before getting identity pool credentials...');
        const refreshed = await refreshTokens();
        if (!refreshed) {
          console.error('Failed to refresh tokens for identity pool credentials');
          return null;
        }
      }

      const idToken = tokensRef.current.idToken;
      if (!idToken) {
        console.error('No ID token available for identity pool credentials');
        return null;
      }

      const credentials = await fromWebToken({
        roleSessionName: 'numa-frontend',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 3600,
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
    bedrockAgentRuntimeClient,
    bedrockAgentClient,
    numaChatBedrockUtils,
    dynamoDBClient,
    numaChatDynamoUtils,
    requestPasswordReset,
    confirmPasswordReset,
    getCredentials,
  };

  useEffect(() => {
    if (user) {
      // Use the utility function in useEffect
      const { groups, features } = extractGroupsAndFeatures(user.decoded_tokens.idToken);
      setUser((prev) => ({
        ...prev,
        groups,
        features: features || [],
      }));
    }
  }, [loading]);

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

const extractGroupsAndFeatures = (decodedIdToken) => {
  // Ensure GROUPS is fetched from window.sessionStorage before use
  const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS')) || {};

  // Extract groups and features from the decoded token
  // const groups = ['standard', ...(decodedIdToken['cognito:groups'] || [])];
  let groups = [...(decodedIdToken['cognito:groups'] || [])];

  if (!groups || groups.length === 0) {
    // If the user is not in any groups, use the default standard group and the features for that group
    groups = ['standard'];
  }

  const features = groups.reduce((acc, group) => {
    const groupFeatures = GROUPS[group]?.features || [];
    return [...acc, ...groupFeatures];
  }, []);

  return { groups, features };
};
