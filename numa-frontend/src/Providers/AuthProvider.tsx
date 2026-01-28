import { createContext, useState, useContext, useRef, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import { QBusinessClient } from '@aws-sdk/client-qbusiness';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QAppsClient } from '@aws-sdk/client-qapps';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GetUserCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { NumaChatDynamoUtils } from '../utils/DynamoDBUtils';
import { NumaBedrockUtils } from '../utils/NumaBedrockUtils';
import Notification from '../Components/Notification';
import { withPRM } from '../utils/prmUtils';
import { useTranslation } from 'react-i18next';

const AuthContext = createContext(null);

// MFA type definitions
export interface MfaSetupRequired {
  requiresMfaSetup: true;
  session: string;
  username: string;
  secretCode: string;
  otpauthUrl: string;
}

export interface MfaCodeRequired {
  requiresMfaCode: true;
  session: string;
  username: string;
}

export type LoginResult =
  | { success: true }
  | { requiresNewPassword: true; session: unknown }
  | MfaSetupRequired
  | MfaCodeRequired;

const MINUTE = 1000 * 60;

// Base interval to sanity-check tokens; expiry-based scheduling will run sooner when needed
const REFRESH_PERIOD = 10 * MINUTE;

export const AuthProvider = ({ children, initialTokens }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Token revocation notification state
  const [tokenRevocationState, setTokenRevocationState] = useState({
    show: false,
    timer: null,
    reason: 'revocation',
  });

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
  const tokenCheckRef = useRef(null);

  const lastRefreshTimeRef = useRef(0);
  const refreshTimeoutRef = useRef(null);

  // MFA session tracking refs
  const mfaSessionRef = useRef<string | null>(null);
  const mfaUsernameRef = useRef<string | null>(null);

  const clearScheduledRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const scheduleRefreshBeforeExpiry = useCallback(() => {
    clearScheduledRefresh();

    const accessExp = decodedTokensRef.current.accessToken?.exp;
    if (!accessExp) return;

    const now = Date.now();
    const targetTime = accessExp * 1000 - 10 * MINUTE;
    const minDelay = 3 * MINUTE;
    const delay = Math.max(minDelay, targetTime - now);

    const timeoutDelay = delay > 0 ? delay : 1000;
    const tokenCheckFn = tokenCheckRef.current || checkAndRefreshTokens;
    if (!tokenCheckFn) return;

    refreshTimeoutRef.current = setTimeout(() => {
      tokenCheckRef.current?.() ?? tokenCheckFn();
    }, timeoutDelay);
  }, [clearScheduledRefresh]);

  // Decode tokens without triggering re-renders
  const decodeTokens = async () => {
    if (!tokensRef.current.idToken) {
      console.error('❌ No ID token found');
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
    } catch (error) {
      console.error('Error in decodeTokens:', error);
      decodedTokensRef.current = { accessToken: null, idToken: null };
    }
  };

  // Update tokens without triggering re-renders
  const updateTokens = async (newTokens) => {
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
    await decodeTokens();
  };

  const [qAppsClient, setQAppsClient] = useState(null);
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

  // Check if token is revoked by validating with Cognito
  const validateTokenWithCognito = async (accessToken) => {
    if (!accessToken) {
      console.error('🚫 validateTokenWithCognito: No access token provided');
      return { valid: false, reason: 'missing' };
    }

    try {
      const REGION = window.sessionStorage.getItem('REGION');
      if (!REGION) {
        console.error('🚫 validateTokenWithCognito: No REGION in session storage');
        return { valid: false, reason: 'missing-region' };
      }

      const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

      // Use GetUser to validate the token - this will fail if token is revoked
      const getUserCommand = new GetUserCommand({
        AccessToken: accessToken,
      });

      await cognitoClient.send(getUserCommand);
      return { valid: true };
    } catch (error) {
      console.warn(
        '🚫 validateTokenWithCognito: Token validation failed with Cognito:',
        error.message,
        'Error name:',
        error.name,
      );

      const message = error.message?.toLowerCase() || '';
      const isExpired = message.includes('expired');
      const isNotAuthorized = error.name === 'NotAuthorizedException';
      const isUserMissing = error.name === 'UserNotFoundException';
      const isRefreshException = error.name === 'TokenRefreshException';

      if (isExpired && isNotAuthorized) {
        return { valid: false, reason: 'expired' };
      }

      if (isNotAuthorized || isUserMissing || isRefreshException) {
        console.error('🚫 validateTokenWithCognito: Token is invalid/revoked, returning false');
        return { valid: false, reason: 'revoked' };
      }

      // For other errors, assume token is still valid to avoid false positives
      console.warn('⚠️ validateTokenWithCognito: Unknown error, assuming token is still valid');
      return { valid: true };
    }
  };

  // Token revocation notification functions
  const showTokenRevocationNotification = useCallback((reason = 'revocation') => {
    setTokenRevocationState({
      show: true,
      timer: null,
      reason,
    });

    // Auto-dismiss after 5 seconds
    const timer = setTimeout(() => {
      setTokenRevocationState((prev) => ({ ...prev, show: false }));
    }, 5000);

    setTokenRevocationState((prev) => ({ ...prev, timer }));
  }, []);

  const dismissTokenRevocationNotification = useCallback(() => {
    if (tokenRevocationState.timer) {
      clearTimeout(tokenRevocationState.timer);
    }
    setTokenRevocationState({
      show: false,
      timer: null,
      reason: 'revocation',
    });
  }, [tokenRevocationState.timer]);

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

  const logout = useCallback(() => {
    console.log('🚪 logout: Starting logout process');

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('idToken');
    localStorage.removeItem('lastTokenValidation');
    tokensRef.current = { accessToken: null, idToken: null, refreshToken: null };
    decodedTokensRef.current = { accessToken: null, idToken: null };
    clearScheduledRefresh();

    // Clear all AWS clients to force re-authentication
    setQBusinessClient(null);
    setQAppsClient(null);
    setBedrockRuntimeClient(null);
    setBedrockAgentRuntimeClient(null);
    setBedrockAgentClient(null);
    setNumaChatBedrockUtils(null);
    setDynamoDBClient(null);
    setNumaChatDynamoUtils(null);

    setUser(null);
    setAuthError(null);
    setLoading(false);
  }, [clearScheduledRefresh]);

  const refreshTokens = useCallback(async () => {
    // Prevent concurrent refresh operations
    if (refreshInProgressRef.current) {
      return refreshPromiseRef.current;
    }

    refreshInProgressRef.current = true;

    const refreshOperation = async () => {
      try {
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

        const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

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
        await updateTokens({
          accessToken: AccessToken,
          idToken: IdToken,
          refreshToken,
        });

        // Decode the new tokens to update the decoded token references
        const newDecodedAccessToken = jwtDecode(AccessToken);
        const newDecodedIdToken = jwtDecode(IdToken);

        const { groups, features } = extractGroupsAndFeatures(newDecodedIdToken, setAuthError);

        // Save old tokens before comparison to prevent race condition
        const oldGroups = user?.groups || [];

        // Check if groups actually changed, not just tokens refreshed
        const groupsChanged = JSON.stringify(oldGroups.sort()) !== JSON.stringify(groups.sort());

        // Handle group changes (admin promotion/demotion)
        if (groupsChanged && user) {
          const hasAdmin = groups.includes('admin');
          const hadAdmin = oldGroups.includes('admin');

          if (hasAdmin !== hadAdmin) {
            if (!hasAdmin && hadAdmin) {
              // Demoted from admin - logout immediately
              showTokenRevocationNotification('revocation');
              logout();
              return false;
            } else if (hasAdmin && !hadAdmin) {
              // Promoted - refresh tokens to get new permissions immediately
              console.log('🔄 User promoted to admin, refreshing tokens for new permissions');
              console.log('Previous groups:', oldGroups);
              console.log('Current groups from token:', groups);
              await refreshTokens();

              // Log the user state after refresh to verify the promotion took effect
              setTimeout(() => {
                console.log('📊 User state after promotion refresh:', {
                  userGroups: user?.groups,
                  userFeatures: user?.features,
                  hasAdminGroup: user?.groups?.includes('admin'),
                  totalFeatures: user?.features?.length,
                });
              }, 100);
            }
          }
        }

        // Update user state with fresh tokens and groups/features
        const userUpdate = {
          tokens: {
            accessToken: AccessToken,
            idToken: IdToken,
            refreshToken,
          },
          decoded_tokens: {
            accessToken: newDecodedAccessToken,
            idToken: newDecodedIdToken,
          },
          groups,
          features,
        };

        // Update decoded tokens ref for future comparisons
        decodedTokensRef.current = {
          accessToken: newDecodedAccessToken,
          idToken: newDecodedIdToken,
        };

        setUser((prevUser) => ({
          ...prevUser,
          ...userUpdate,
        }));

        lastRefreshTimeRef.current = Date.now();
        scheduleRefreshBeforeExpiry();
        return true;
      } catch (error) {
        console.error('❌ Error refreshing tokens:', error);
        showTokenRevocationNotification('expired');
        logout();
        return false;
      } finally {
        refreshInProgressRef.current = false;
        refreshPromiseRef.current = null;
      }
    };

    refreshPromiseRef.current = refreshOperation();
    return refreshPromiseRef.current;
  }, [logout, scheduleRefreshBeforeExpiry, showTokenRevocationNotification]);

  // Centralized token validation function
  const ensureValidTokens = async () => {
    const decodedIdToken = decodedTokensRef.current.idToken;
    const accessToken = tokensRef.current.accessToken;

    // Check expiration first (quick local check)
    if (!decodedIdToken || isTokenExpired(decodedIdToken)) {
      const refreshed = await refreshTokens();
      if (!refreshed) {
        console.error('Failed to refresh tokens for client initialization');
        return false;
      }
    }

    // Periodically validate against Cognito (check revocation)
    // Only do this every 30 seconds to avoid excessive API calls
    const now = Date.now();
    const lastValidation = localStorage.getItem('lastTokenValidation');
    const parsedLastValidation = lastValidation ? parseInt(lastValidation) : null;
    const shouldValidate = parsedLastValidation ? now - parsedLastValidation > 30000 : false;

    // If we've never validated before, seed the timestamp and skip the initial remote check
    if (!parsedLastValidation) {
      localStorage.setItem('lastTokenValidation', now.toString());
      return true;
    }

    if (shouldValidate && accessToken) {
      const validation = await validateTokenWithCognito(accessToken);

      if (!validation.valid) {
        if (validation.reason === 'expired') {
          const refreshed = await refreshTokens();
          if (refreshed) {
            return true;
          }
          showTokenRevocationNotification('expired');
        } else {
          console.error('Token has been revoked, forcing logout');
          showTokenRevocationNotification('revocation');
        }
        logout();
        return false;
      }
      localStorage.setItem('lastTokenValidation', now.toString());
    }

    return true;
  };

  // Force immediate token validation (bypasses cache)
  const forceTokenValidation = useCallback(async () => {
    // Use tokensRef instead of user to avoid stale closures
    const accessToken = tokensRef.current.accessToken;
    const idToken = tokensRef.current.idToken;
    if (!accessToken || !idToken) {
      console.error('🚫 forceTokenValidation: No access token or ID token available, returning false');
      return false;
    }

    const validation = await validateTokenWithCognito(accessToken);

    if (!validation.valid) {
      if (validation.reason === 'expired') {
        const refreshed = await refreshTokens();
        if (refreshed) {
          return true;
        }
        showTokenRevocationNotification('expired');
      } else {
        console.error('Token has been revoked during forced validation, forcing logout');
        showTokenRevocationNotification('revocation');
      }
      logout();
      return false;
    }

    // Update validation timestamp
    localStorage.setItem('lastTokenValidation', Date.now().toString());
    return true;
  }, [showTokenRevocationNotification, logout]);

  const getAccessToken = useCallback(async () => {
    if (!user) return null;

    // Check if token is expired or about to expire
    if (isTokenExpired(decodedTokensRef.current.accessToken)) {
      const refreshed = await refreshTokens();
      if (!refreshed) return null;
    }

    // Return the current access token from tokensRef instead of user.tokens
    return tokensRef.current.accessToken;
  }, [refreshTokens]);

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

    // Get user's actual groups from principal tags
    const userGroups = getGroupsFromToken(user.decoded_tokens.idToken);
    if (!userGroups || userGroups.length === 0) {
      console.error('No groups found for user - cannot initialize QBusinessClient');
      return;
    }

    const userGroup = userGroups[0];
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
        durationSeconds: 900,
      });

      const newClient = withPRM(QBusinessClient, {
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

    if (!REGION || !GROUPS || !USER_POOL_ID) {
      console.error('Missing required session storage values for BedrockRuntimeClient initialization');
      return;
    }

    // Validate that user has decoded tokens
    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    // Get user's actual groups from principal tags
    const userGroups = getGroupsFromToken(user.decoded_tokens.idToken);
    if (!userGroups || userGroups.length === 0) {
      console.error('No groups found for user - cannot initialize BedrockRuntimeClient');
      return;
    }

    const userGroup = userGroups[0];
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

      // Frontend uses direct Bedrock access within client account
      // Cross-account quota sharing is backend-only
      const credentials = await fromWebToken({
        roleSessionName: 'numa-bedrock-client',
        roleArn: roleArn,
        webIdentityToken: idToken,
        durationSeconds: 1800, // Reduced from 1 hour to 30 minutes for better security
      })();

      const newClient = withPRM(BedrockRuntimeClient, {
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

    // Get user's actual groups from principal tags
    const userGroups = getGroupsFromToken(user.decoded_tokens.idToken);
    if (!userGroups || userGroups.length === 0) {
      console.error('No groups found for user - cannot initialize BedrockAgentRuntimeClient');
      return;
    }

    const userGroup = userGroups[0];
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
        durationSeconds: 1800, // Reduced from 1 hour to 30 minutes for better security
      });

      const newClient = withPRM(BedrockAgentRuntimeClient, {
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

    // Get user's actual groups from principal tags
    const userGroups = getGroupsFromToken(user.decoded_tokens.idToken);
    if (!userGroups || userGroups.length === 0) {
      console.error('No groups found for user - cannot initialize BedrockAgentClient');
      return;
    }

    const userGroup = userGroups[0];
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
        durationSeconds: 1800, // Reduced from 1 hour to 30 minutes for better security
      });

      const newClient = withPRM(BedrockAgentClient, {
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

    // Get user's actual groups from principal tags
    const userGroups = getGroupsFromToken(user.decoded_tokens.idToken);
    if (!userGroups || userGroups.length === 0) {
      console.error('No cognito groups found for user - cannot initialize DynamoDBClient');
      return;
    }

    const userGroup = userGroups[0];
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
        durationSeconds: 900,
      })();

      const newClient = withPRM(DynamoDBClient, {
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

    // Get user's actual groups from principal tags
    const userGroups = getGroupsFromToken(user.decoded_tokens.idToken);
    if (!userGroups || userGroups.length === 0) {
      console.error('No groups found for user - cannot initialize QAppsClient');
      return;
    }

    const userGroup = userGroups[0];
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
        durationSeconds: 900,
      })();

      const newQAppsClient = withPRM(QAppsClient, {
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
  const checkAndRefreshTokens = useCallback(async () => {
    const { accessToken, idToken, refreshToken } = tokensRef.current;
    if (!accessToken || !idToken || !refreshToken) {
      console.debug('No access token, ID token, or refresh token available');
      return false;
    }

    try {
      const now = Date.now();

      const isAccessTokenExpired = isTokenExpired(decodedTokensRef.current.accessToken);
      const isIdTokenExpired = isTokenExpired(decodedTokensRef.current.idToken);

      // Always refresh first if tokens are expired/near expiry
      if (isAccessTokenExpired || isIdTokenExpired) {
        console.debug('🔄 Token refresh: Tokens expired or near expiry');
        const refreshed = await refreshTokens();
        if (refreshed) {
          lastRefreshTimeRef.current = now;
          return true;
        }
        showTokenRevocationNotification('expired');
        logout();
        return false;
      }

      // Check token revocation periodically (every 2 minutes during regular checks)
      const lastValidation = localStorage.getItem('lastTokenValidation');
      const shouldValidateRevocation = !lastValidation || now - parseInt(lastValidation) > 120000;

      if (shouldValidateRevocation) {
        const validation = await validateTokenWithCognito(accessToken);
        if (!validation.valid) {
          if (validation.reason === 'expired') {
            const refreshed = await refreshTokens();
            if (refreshed) {
              lastRefreshTimeRef.current = now;
              return true;
            }
            showTokenRevocationNotification('expired');
          } else {
            console.error('Token has been revoked during periodic check, forcing logout');
            showTokenRevocationNotification('revocation');
          }
          logout();
          return false;
        }
        localStorage.setItem('lastTokenValidation', now.toString());
      }

      // Check for group changes every 30 seconds by refreshing tokens
      const lastGroupCheck = localStorage.getItem('lastGroupCheck');
      const shouldCheckGroups = !lastGroupCheck || now - parseInt(lastGroupCheck) > 30000;

      if (shouldCheckGroups) {
        // Skip the first group check to avoid unnecessary refresh when tokens are already valid
        if (!lastGroupCheck) {
          localStorage.setItem('lastGroupCheck', now.toString());
          lastRefreshTimeRef.current = now;
          return true;
        }

        console.log('🔄 Periodic group check: Refreshing tokens to check for group changes');
        console.log('Current user groups before check:', user?.groups);
        localStorage.setItem('lastGroupCheck', now.toString());
        const refreshed = await refreshTokens();
        if (refreshed) {
          lastRefreshTimeRef.current = now;
          return true;
        }
        logout();
        return false;
      }

      // Update last check time when nothing else was needed
      lastRefreshTimeRef.current = now;
      return true;
    } catch (error) {
      console.error('Error decoding token during check:', error);
      return false;
    }
  }, [refreshTokens, showTokenRevocationNotification, logout]);

  useEffect(() => {
    tokenCheckRef.current = checkAndRefreshTokens;
  }, [checkAndRefreshTokens]);

  useEffect(() => {
    if (!user || initialTokens) return;

    // Check tokens every REFRESH_PERIOD
    const intervalId = setInterval(checkAndRefreshTokens, REFRESH_PERIOD);

    return () => clearInterval(intervalId);
  }, [user, checkAndRefreshTokens]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAndRefreshTokens();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkAndRefreshTokens]);

  useEffect(() => {
    return () => {
      clearScheduledRefresh();
    };
  }, [clearScheduledRefresh]);

  const loadUserFromTokens = async () => {
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
    await decodeTokens();

    if (refreshToken) {
      if (
        !accessToken ||
        !idToken ||
        isTokenExpired(decodedTokensRef.current.accessToken) ||
        isTokenExpired(decodedTokensRef.current.idToken)
      ) {
        console.debug('⚠️ Tokens expired, attempting refresh...');
        const refreshed = await refreshTokens();
        if (!refreshed) {
          console.error('❌ Token refresh failed, logging out');
          setUser(null);
        }
      } else {
        const decodedAccessToken = decodedTokensRef.current.accessToken;
        const decodedIdToken = decodedTokensRef.current.idToken;

        if (!decodedIdToken) {
          console.error('❌ No decoded ID token found');
          setUser(null);
          return;
        }

        // Use the utility function to extract groups and features
        const { groups, features } = extractGroupsAndFeatures(decodedIdToken, setAuthError);
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

        // Seed validation/group check timestamps so we don't immediately refresh valid tokens
        const now = Date.now().toString();
        localStorage.setItem('lastTokenValidation', now);
        localStorage.setItem('lastGroupCheck', now);
      }
      scheduleRefreshBeforeExpiry();
    } else {
      console.error('❌ No refresh token found');
      setUser(null);
    }
    setLoading(false);
    setTokenValidationComplete(true);
  };

  useEffect(() => {
    // Skip loading from localStorage if initialTokens are provided (e.g., in tests)
    if (!initialTokens) {
      loadUserFromTokens();
    }
  }, [initialTokens]);

  const getUserInfo = useCallback(() => {
    if (!user) return null;
    return {
      tokens: user.tokens,
      decoded_tokens: user.decoded_tokens,
    };
  }, [user]);

  const performSrpAuthentication = async (username, password) => {
    const REGION = window.sessionStorage.getItem('REGION');
    const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');
    const USER_POOL_ID = window.sessionStorage.getItem('USER_POOL_ID');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

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

  const login = useCallback(async (username, password): Promise<LoginResult> => {
    try {
      // Clear any previous auth errors when attempting login
      setAuthError(null);

      const { response, lowercaseUsername } = await performSrpAuthentication(username, password);

      if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return { requiresNewPassword: true, session: response.AuthenticationResult };
      }

      // Handle MFA_SETUP challenge - user needs to enroll in TOTP MFA
      if (response.ChallengeName === 'MFA_SETUP') {
        const mfaSetupResult = await buildMfaSetupRequired(response.Session, lowercaseUsername);
        return mfaSetupResult;
      }

      // Handle SOFTWARE_TOKEN_MFA challenge - user needs to enter TOTP code
      if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        // Store session and username for later use in submitMfaCode
        mfaSessionRef.current = response.Session;
        mfaUsernameRef.current = lowercaseUsername;
        return {
          requiresMfaCode: true,
          session: response.Session,
          username: lowercaseUsername,
        };
      }

      await handleLoginSuccess(response.AuthenticationResult);
      return { success: true };
    } catch (error) {
      console.error('Error during authentication:', error);
      throw error;
    }
  }, []);

  // Build MFA setup data after receiving MFA_SETUP challenge
  // Calls AssociateSoftwareTokenCommand to get the secret code for the authenticator app
  const buildMfaSetupRequired = async (session: string, username: string): Promise<MfaSetupRequired> => {
    const REGION = window.sessionStorage.getItem('REGION');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

    // Get the secret code from Cognito for TOTP setup
    const associateCommand = new AssociateSoftwareTokenCommand({
      Session: session,
    });

    const associateResponse = await cognitoClient.send(associateCommand);

    if (!associateResponse.SecretCode || !associateResponse.Session) {
      throw new Error('Failed to get MFA secret code from Cognito');
    }

    // Store session and username for later use in completeMfaSetup
    mfaSessionRef.current = associateResponse.Session;
    mfaUsernameRef.current = username;

    // Build the otpauth URL for authenticator apps
    // Format: otpauth://totp/ISSUER:ACCOUNT?secret=SECRET&issuer=ISSUER
    const issuer = 'Numa';
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${associateResponse.SecretCode}&issuer=${encodeURIComponent(issuer)}`;

    return {
      requiresMfaSetup: true,
      session: associateResponse.Session,
      username,
      secretCode: associateResponse.SecretCode,
      otpauthUrl,
    };
  };

  // Complete MFA setup by verifying the TOTP code and enabling MFA
  const completeMfaSetup = useCallback(async (code: string): Promise<LoginResult> => {
    const REGION = window.sessionStorage.getItem('REGION');
    const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

    const session = mfaSessionRef.current;
    const username = mfaUsernameRef.current;

    if (!session || !username) {
      throw new Error('MFA session expired. Please log in again.');
    }

    // Verify the TOTP code
    const verifyCommand = new VerifySoftwareTokenCommand({
      Session: session,
      UserCode: code,
    });

    const verifyResponse = await cognitoClient.send(verifyCommand);

    if (verifyResponse.Status !== 'SUCCESS') {
      throw new Error('Invalid verification code');
    }

    // After verification, we need to respond to the MFA_SETUP challenge to complete authentication
    const SECRET_HASH = await fetchSecretHash(username);

    const respondCommand = new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: 'MFA_SETUP',
      Session: verifyResponse.Session,
      ChallengeResponses: {
        USERNAME: username,
        SECRET_HASH: SECRET_HASH,
      },
    });

    const authResponse = await cognitoClient.send(respondCommand);

    // Clear MFA session refs
    mfaSessionRef.current = null;
    mfaUsernameRef.current = null;

    if (authResponse.AuthenticationResult) {
      await handleLoginSuccess(authResponse.AuthenticationResult);
      return { success: true };
    }

    throw new Error('MFA setup completed but authentication failed');
  }, []);

  // Submit MFA code for SOFTWARE_TOKEN_MFA challenge (subsequent logins)
  const submitMfaCode = useCallback(async (code: string): Promise<LoginResult> => {
    const REGION = window.sessionStorage.getItem('REGION');
    const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

    const session = mfaSessionRef.current;
    const username = mfaUsernameRef.current;

    if (!session || !username) {
      throw new Error('MFA session expired. Please log in again.');
    }

    const SECRET_HASH = await fetchSecretHash(username);

    // Respond to the SOFTWARE_TOKEN_MFA challenge
    const respondCommand = new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        SOFTWARE_TOKEN_MFA_CODE: code,
        SECRET_HASH: SECRET_HASH,
      },
    });

    const authResponse = await cognitoClient.send(respondCommand);

    // Clear MFA session refs
    mfaSessionRef.current = null;
    mfaUsernameRef.current = null;

    if (authResponse.AuthenticationResult) {
      await handleLoginSuccess(authResponse.AuthenticationResult);
      return { success: true };
    }

    throw new Error('MFA verification failed');
  }, []);

  const setNewPassword = useCallback(
    async (username, oldPassword, newPassword): Promise<LoginResult> => {
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
    },
    [login],
  );

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

    // Update decodedTokensRef to prevent unnecessary refresh in ensureValidTokens
    decodedTokensRef.current = {
      accessToken: decodedAccessToken,
      idToken: decodedIdToken,
    };

    // Debug: Log token contents to understand what claims are available
    console.log('🔍 Login Success - Token debugging:', {
      decodedAccessTokenKeys: Object.keys(decodedAccessToken),
      decodedIdTokenKeys: Object.keys(decodedIdToken),
      accessTokenGroups: decodedAccessToken['cognito:groups'],
      idTokenGroups: decodedIdToken['cognito:groups'],
      accessTokenUsername: decodedAccessToken['username'],
      idTokenUsername: decodedIdToken['cognito:username'] || decodedIdToken['username'],
      accessTokenSub: decodedAccessToken['sub'],
      idTokenSub: decodedIdToken['sub'],
    });

    // Use the utility function to extract groups and features
    const { groups, features } = extractGroupsAndFeatures(decodedIdToken, setAuthError);

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

    // Seed validation/group check timestamps so we don't immediately refresh valid tokens
    const now = Date.now().toString();
    localStorage.setItem('lastTokenValidation', now);
    localStorage.setItem('lastGroupCheck', now);
  };

  // Initialize user state from testConfig if available
  useEffect(() => {
    if (initialTokens) {
      // Update refs to match the provided tokens
      tokensRef.current = initialTokens.tokens;
      decodedTokensRef.current = initialTokens.decoded_tokens;
      setUser(initialTokens);
      setLoading(false);
      setTokenValidationComplete(true);
    }
  }, [initialTokens]);

  const requestPasswordReset = useCallback(async (email, mode = 'reset') => {
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

      const cognitoClient = withPRM(CognitoIdentityProviderClient, {
        region: REGION,
      });
      await cognitoClient.send(command);
      return { success: true };
    } catch (error) {
      throw new Error(`Error requesting password reset: ${error.message}`);
    }
  }, []);

  const confirmPasswordReset = useCallback(async (email, code, newPassword) => {
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

      const cognitoClient = withPRM(CognitoIdentityProviderClient, {
        region: REGION,
      });
      await cognitoClient.send(command);
      return { success: true };
    } catch (error) {
      throw new Error(`Error resetting password: ${error.message}`);
    }
  }, []);

  const getCredentials = useCallback(async () => {
    const REGION = window.sessionStorage.getItem('REGION');

    if (!user) {
      console.debug('No user found');
      return null;
    }

    // Get user's actual Cognito group - no defaulting to 'standard'
    const groups = JSON.parse(window.sessionStorage.getItem('GROUPS')) || {};
    const cognitoGroups = getGroupsFromToken(user.decoded_tokens.idToken);

    // Check if user has the features and proper cognito groups
    // If there are no features or groups, block the request since we need to wait until the user has features
    if (user.features.length === 0 || !cognitoGroups || cognitoGroups.length === 0) {
      console.debug('No features or cognito groups found:', { features: user.features, cognitoGroups });
      return null;
    }

    const userGroup = cognitoGroups[0];
    const roleArn = groups[userGroup]?.roleArn;

    if (!roleArn) {
      console.debug('No role ARN found for user group:', { userGroup, availableGroups: Object.keys(groups) });
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
        console.debug('Refreshing tokens before getting credentials');
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
        durationSeconds: 1800, // Reduced from 1 hour to 30 minutes for better security
      })();

      return credentials;
    } catch (error) {
      console.error('Error getting credentials:', error);
      throw error;
    }
  }, [user, refreshTokens]);

  const value = useMemo(() => {
    return {
      isAuthenticated: !!user,
      user,
      loading,
      authError,
      tokenValidationComplete,
      login,
      logout,
      setNewPassword,
      refreshTokens,
      getAccessToken,
      getUserInfo,
      checkAndRefreshTokens,
      forceTokenValidation,
      completeMfaSetup,
      submitMfaCode,
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
  }, [
    loading,
    authError,
    tokenValidationComplete,
    login,
    logout,
    setNewPassword,
    refreshTokens,
    getAccessToken,
    getUserInfo,
    checkAndRefreshTokens,
    forceTokenValidation,
    completeMfaSetup,
    submitMfaCode,
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
    numaChatDynamoUtils, // Include numaChatDynamoUtils so conversation manager gets notified when it becomes available
  ]);

  // Token revocation notification component
  const TokenRevocationNotificationComponent = () => {
    const { t } = useTranslation('auth');
    if (!tokenRevocationState.show) return null;

    const isRevocation = tokenRevocationState.reason === 'revocation';
    const title = isRevocation ? t('session.endedTitle') : t('session.expiredTitle');
    const message = isRevocation ? t('session.endedMessage') : t('session.expiredMessage');

    return (
      <Notification
        show={tokenRevocationState.show}
        variant="warning"
        title={title}
        message={message}
        onDismiss={dismissTokenRevocationNotification}
        autoDismiss={true}
        autoDismissDelay={5000}
      />
    );
  };

  return (
    <AuthContext.Provider value={value}>
      <TokenRevocationNotificationComponent />
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    console.error('useAuth called outside AuthProvider. Stack trace:', new Error().stack);
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

// Helper function to extract groups from principal tags
const getGroupsFromToken = (decodedIdToken) => {
  const awsTags = decodedIdToken?.['https://aws.amazon.com/tags'];
  return awsTags?.principal_tags?.Groups || [];
};

const extractGroupsAndFeatures = (decodedIdToken) => {
  // Ensure GROUPS is fetched from window.sessionStorage before use
  const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS')) || {};

  // Extract groups from AWS Tags principal_tags.Groups
  const groups = getGroupsFromToken(decodedIdToken);

  console.log('🔍 extractGroupsAndFeatures called with:', {
    decodedIdToken: decodedIdToken,
    principalTagGroups: groups,
    availableGroupsConfig: Object.keys(GROUPS),
    allTokenClaims: Object.keys(decodedIdToken),
  });

  if (!groups || groups.length === 0) {
    // If the user is not in any groups, they should have no access - don't default to standard
    console.error('🚫 No groups found for user - access denied');
    console.error('🔍 Full decoded ID token:', decodedIdToken);

    return { groups: [], features: [] };
  }

  const features = groups.reduce((acc, group) => {
    const groupFeatures = GROUPS[group]?.features || [];
    console.log(`🔍 Group "${group}" features:`, groupFeatures);
    return [...acc, ...groupFeatures];
  }, []);

  console.log('✅ Groups and features extracted successfully:', { groups, features });

  return { groups, features };
};
