import { createContext, useState, useContext, useRef, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import { clearAllSwrCaches } from '../utils/swrCache';
import { QBusinessClient } from '@aws-sdk/client-qbusiness';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { QAppsClient } from '@aws-sdk/client-qapps';
import { fromWebToken } from '@aws-sdk/credential-providers';
import {
  createSrpSession,
  signSrpSession,
  createDeviceVerifier,
  signSrpSessionWithDevice,
  wrapAuthChallenge,
} from 'cognito-srp-helper';
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GetUserCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  ConfirmDeviceCommand,
  UpdateDeviceStatusCommand,
  ListDevicesCommand,
  ForgetDeviceCommand,
  SetUserMFAPreferenceCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { NumaChatDynamoUtils } from '../utils/DynamoDBUtils';
import { NumaBedrockUtils } from '../utils/NumaBedrockUtils';
import Notification from '../Components/Notification';
import { withPRM } from '../utils/prmUtils';
import { useTranslation } from 'react-i18next';
import { hasConfigInSession, fetchConfigAddtoSession } from '../Components/ConfigSetup';
import { AdminMfaSettingsService } from '../Services/AdminMfaSettingsService';
import { getFlag } from '../utils/featureFlags';

const AuthContext = createContext(null);

// MFA type definitions
export interface MfaSetupRequired {
  requiresMfaSetup: true;
  session: string;
  username: string;
  secretCode: string;
  otpauthUrl: string;
  isReEnrollment?: boolean;
  // When true, verification must use the AccessToken-based flow (completeReEnrollMfa +
  // finalizeLogin) instead of the session-based flow (completeMfaSetup). This is set
  // when Cognito returned tokens directly but the app detected MFA enrollment is needed.
  pendingLogin?: boolean;
}

export interface MfaCodeRequired {
  requiresMfaCode: true;
  session: string;
  username: string;
}

export type LoginResult =
  | { success: true; features: string[] }
  | { requiresNewPassword: true; session: unknown }
  | MfaSetupRequired
  | MfaCodeRequired;

// Device trust localStorage helpers — stores only Cognito SRP credentials.
// The trust timestamp and expiry check are server-side (DynamoDB + Lambda)
// so that users cannot tamper with them via DevTools.
const DEVICE_KEY_STORAGE = 'numa_device_key';
const DEVICE_GROUP_KEY_STORAGE = 'numa_device_group_key';
const DEVICE_RANDOM_PASSWORD_STORAGE = 'numa_device_random_password';

const getStoredDeviceKey = (): string | null => localStorage.getItem(DEVICE_KEY_STORAGE);
const getStoredDeviceGroupKey = (): string | null => localStorage.getItem(DEVICE_GROUP_KEY_STORAGE);
const getStoredDeviceRandomPassword = (): string | null => localStorage.getItem(DEVICE_RANDOM_PASSWORD_STORAGE);
const storeDeviceTrust = (deviceKey: string, groupKey: string, randomPassword: string): void => {
  localStorage.setItem(DEVICE_KEY_STORAGE, deviceKey);
  localStorage.setItem(DEVICE_GROUP_KEY_STORAGE, groupKey);
  localStorage.setItem(DEVICE_RANDOM_PASSWORD_STORAGE, randomPassword);
};

const clearDeviceTrust = (): void => {
  localStorage.removeItem(DEVICE_KEY_STORAGE);
  localStorage.removeItem(DEVICE_GROUP_KEY_STORAGE);
  localStorage.removeItem(DEVICE_RANDOM_PASSWORD_STORAGE);
};

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
    }
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

  // Session policy refs (fetched from admin settings on login)
  const sessionIdleTimeoutRef = useRef<number>(0); // minutes, 0 = disabled
  const maxSessionDurationRef = useRef<number>(0); // hours, 0 = disabled
  const lastActivityRef = useRef<number>(Date.now());
  const sessionStartRef = useRef<number>(0); // epoch ms, set on login

  // MFA state exposed via context so the Login page can display setup/code forms
  const [mfaSetupData, setMfaSetupData] = useState<MfaSetupRequired | null>(null);
  const [mfaCodeData, setMfaCodeData] = useState<MfaCodeRequired | null>(null);

  // Wait for config.json values (CLIENT_ID, REGION, etc.) to be in sessionStorage.
  // Prevents race condition where AuthProvider tries to refresh tokens before config is loaded.
  const ensureConfigLoaded = async (): Promise<boolean> => {
    if (hasConfigInSession()) return true;

    try {
      await Promise.race([
        fetchConfigAddtoSession(true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Config load timeout')), 5000)),
      ]);
    } catch (error) {
      console.warn('⚠️ Config load failed or timed out:', error);
    }

    return hasConfigInSession();
  };

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
  const [lambdaClient, setLambdaClient] = useState(null);
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
        error.name
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
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('idToken');
    localStorage.removeItem('lastTokenValidation');
    sessionStorage.removeItem('numaSessionStart');
    sessionStartRef.current = 0;

    // Clear chat state so re-login starts a fresh conversation
    localStorage.removeItem('numa_chat_lastInteraction-v2');
    sessionStorage.removeItem('currentConversationId-v2');
    sessionStorage.removeItem('isWorkspaceConversation-v2');
    sessionStorage.removeItem('numa-chat-draft');

    clearAllSwrCaches();
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
    setLambdaClient(null);
    setNumaChatDynamoUtils(null);

    setUser(null);
    setAuthError(null);
    setLoading(false);
  }, [clearScheduledRefresh]);

  const refreshTokens = useCallback(async () => {
    // During MFA enrollment, tokens are stored in refs by storeTokensWithoutLogin
    // but the refresh token may be revoked (admin called GlobalSignOut). Skip
    // background refresh entirely — the enrollment flow has its own valid tokens.
    if (mfaEnrollmentInProgressRef.current) {
      return false;
    }

    // Prevent concurrent refresh operations
    if (refreshInProgressRef.current) {
      return refreshPromiseRef.current;
    }

    refreshInProgressRef.current = true;

    const refreshOperation = async () => {
      const MAX_RETRIES = 3;
      const BASE_DELAY_MS = 1000;

      try {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const refreshToken = tokensRef.current.refreshToken;
            const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');
            const REGION = window.sessionStorage.getItem('REGION');

            if (!CLIENT_ID || !REGION) {
              const err = new Error('Config not loaded: CLIENT_ID or REGION missing from sessionStorage');
              (err as Record<string, unknown>).isTransient = true;
              throw err;
            }

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

            const authParameters: Record<string, string> = {
              REFRESH_TOKEN: refreshToken,
              SECRET_HASH: SECRET_HASH,
            };

            // When device tracking is enabled, Cognito requires DEVICE_KEY
            // in REFRESH_TOKEN_AUTH requests — without it the refresh token
            // is rejected with "Invalid Refresh Token".
            const deviceKey = getStoredDeviceKey();
            if (deviceKey) {
              authParameters.DEVICE_KEY = deviceKey;
            }

            const params = {
              AuthFlow: 'REFRESH_TOKEN_AUTH',
              ClientId: CLIENT_ID,
              AuthParameters: authParameters,
            };

            const command = new InitiateAuthCommand(params);
            const response = await cognitoClient.send(command);

            if (!response.AuthenticationResult) {
              // Cognito responded but without tokens — this is a permanent auth failure, not a network issue
              const err = new Error('Token refresh failed - no AuthenticationResult in response');
              err.name = 'TokenRefreshException';
              throw err;
            }

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

            // Check server-side MFA claims from the token-adjuster Lambda.
            // Only mfa_setup_required forces re-login (no MFA, no grace period).
            // mfa_reset_pending is allowed — the user is in a grace period after
            // an admin reset and can continue using the app until they re-enroll.
            const refreshedIdPayload = newDecodedIdToken as Record<string, unknown>;
            if (refreshedIdPayload['custom:mfa_setup_required'] === 'true') {
              console.warn('⚠️ Refreshed token has MFA setup required claim — forcing re-login');
              logout();
              return false;
            }

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
                  console.warn('User promoted to admin, refreshing tokens for new permissions');
                  await refreshTokens();
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

            setUser((prevUser) => {
              if (!prevUser) return { ...prevUser, ...userUpdate };

              const groupsMatch = JSON.stringify(prevUser.groups?.slice().sort()) === JSON.stringify(groups.sort());
              const featuresMatch =
                JSON.stringify(prevUser.features?.slice().sort()) === JSON.stringify(features.sort());

              // Only trigger re-render when identity attributes change.
              // Tokens are already fresh in tokensRef, decodedTokensRef,
              // and localStorage — consumers use getAccessToken()/getIdToken().
              if (groupsMatch && featuresMatch) return prevUser;

              return { ...prevUser, ...userUpdate };
            });

            lastRefreshTimeRef.current = Date.now();
            scheduleRefreshBeforeExpiry();
            return true;
          } catch (error) {
            const isLastAttempt = attempt === MAX_RETRIES;

            if (isTransientError(error) && !isLastAttempt) {
              const delay = BASE_DELAY_MS * Math.pow(2, attempt);
              console.warn(
                `⚠️ Transient error during token refresh (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
                  `retrying in ${delay}ms:`,
                (error as Error).message
              );

              // If offline, wait for the network to come back (with a timeout)
              if (typeof navigator !== 'undefined' && !navigator.onLine) {
                await new Promise<void>((resolve) => {
                  const onOnline = () => {
                    window.removeEventListener('online', onOnline);
                    resolve();
                  };
                  window.addEventListener('online', onOnline);
                  setTimeout(() => {
                    window.removeEventListener('online', onOnline);
                    resolve();
                  }, delay * 2);
                });
              }

              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }

            // If retries exhausted but the error is still transient (e.g. browser
            // waking from sleep, network not yet available), don't log the user out.
            // Schedule another refresh attempt instead of destroying the session.
            if (isLastAttempt && isTransientError(error)) {
              console.warn(
                '⚠️ Token refresh retries exhausted (transient error) — will retry in 30s:',
                (error as Error).message
              );
              setTimeout(() => {
                refreshInProgressRef.current = false;
                refreshPromiseRef.current = null;
                refreshTokens();
              }, 30_000);
              return false;
            }

            // Permanent error — Cognito explicitly rejected the token
            console.error('❌ Token refresh failed permanently:', error);
            showTokenRevocationNotification('expired');
            logout();
            return false;
          }
        }

        // Should not reach here, but safety net
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
    if (!tokensRef.current.accessToken) return null;

    // Check if token is expired or about to expire
    if (isTokenExpired(decodedTokensRef.current.accessToken)) {
      const refreshed = await refreshTokens();
      if (!refreshed) return null;
    }

    // Return the current access token from tokensRef instead of user.tokens
    return tokensRef.current.accessToken;
  }, [refreshTokens]);

  const getIdToken = useCallback(async () => {
    if (!tokensRef.current.idToken) return null;

    if (isTokenExpired(decodedTokensRef.current.idToken)) {
      const refreshed = await refreshTokens();
      if (!refreshed) return null;
    }

    return tokensRef.current.idToken;
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
      if (!tokensRef.current.idToken) {
        console.error('No ID token available for QBusinessClient initialization');
        return;
      }

      const credentialProvider = () =>
        fromWebToken({
          roleSessionName: 'numa-qbusiness-client',
          roleArn: roleArn,
          webIdentityToken: tokensRef.current.idToken,
          durationSeconds: 900,
        })();

      const newClient = withPRM(QBusinessClient, {
        region: REGION,
        credentials: credentialProvider,
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
      if (!tokensRef.current.idToken) {
        console.error('No ID token available for BedrockRuntimeClient initialization');
        return;
      }

      // Frontend uses direct Bedrock access within client account
      // Cross-account quota sharing is backend-only
      const credentialProvider = () =>
        fromWebToken({
          roleSessionName: 'numa-bedrock-client',
          roleArn: roleArn,
          webIdentityToken: tokensRef.current.idToken,
          durationSeconds: 1800, // Reduced from 1 hour to 30 minutes for better security
        })();

      const newClient = withPRM(BedrockRuntimeClient, {
        region: REGION,
        credentials: credentialProvider,
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
      if (!tokensRef.current.idToken) {
        console.error('No ID token available for BedrockAgentRuntimeClient initialization');
        return;
      }

      const credentialProvider = () =>
        fromWebToken({
          roleSessionName: 'numa-bedrock-agent-runtime-client',
          roleArn: roleArn,
          webIdentityToken: tokensRef.current.idToken,
          durationSeconds: 1800, // Reduced from 1 hour to 30 minutes for better security
        })();

      const newClient = withPRM(BedrockAgentRuntimeClient, {
        region: REGION,
        credentials: credentialProvider,
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
      if (!tokensRef.current.idToken) {
        console.error('No ID token available for BedrockAgentClient initialization');
        return;
      }

      const credentialProvider = () =>
        fromWebToken({
          roleSessionName: 'numa-bedrock-agent-client',
          roleArn: roleArn,
          webIdentityToken: tokensRef.current.idToken,
          durationSeconds: 1800, // Reduced from 1 hour to 30 minutes for better security
        })();

      const newClient = withPRM(BedrockAgentClient, {
        region: REGION,
        credentials: credentialProvider,
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
      if (!tokensRef.current.idToken) {
        console.error('No ID token available for DynamoDBClient initialization');
        return;
      }

      const credentialProvider = () =>
        fromWebToken({
          roleSessionName: 'numa-dynamo-client',
          roleArn: roleArn,
          webIdentityToken: tokensRef.current.idToken,
          durationSeconds: 900,
        })();

      const newClient = withPRM(DynamoDBClient, {
        region: REGION,
        credentials: credentialProvider,
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
      if (!tokensRef.current.idToken) {
        console.error('No ID token available for QAppsClient initialization');
        return;
      }

      const credentialProvider = () =>
        fromWebToken({
          roleSessionName: 'numa-qapps-client',
          roleArn: roleArn,
          webIdentityToken: tokensRef.current.idToken,
          durationSeconds: 900,
        })();

      const newQAppsClient = withPRM(QAppsClient, {
        region: REGION,
        credentials: credentialProvider,
      });

      setQAppsClient(newQAppsClient);
    } catch (error) {
      console.error('Error in QAppsClient initialization:', error);
      // Don't throw the error, just log it and continue
    }
  }, [user]);

  const initializeLambdaClient = useCallback(async () => {
    if (!user) return;

    const REGION = window.sessionStorage.getItem('REGION');
    const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS'));

    if (!REGION || !GROUPS) {
      console.error('Missing required session storage values for LambdaClient initialization');
      return;
    }

    if (!user.decoded_tokens?.idToken) {
      console.error('User does not have valid decoded tokens');
      return;
    }

    const userGroups = getGroupsFromToken(user.decoded_tokens.idToken);
    if (!userGroups || userGroups.length === 0) {
      console.error('No groups found for user - cannot initialize LambdaClient');
      return;
    }

    const userGroup = userGroups[0];
    const roleArn = GROUPS[userGroup]?.roleArn;

    if (!roleArn) {
      console.error('No role ARN found for user group:', userGroup, 'available groups:', Object.keys(GROUPS));
      return;
    }

    try {
      if (!tokensRef.current.idToken) {
        console.error('No ID token available for LambdaClient initialization');
        return;
      }

      const credentialProvider = () =>
        fromWebToken({
          roleSessionName: 'numa-lambda-client',
          roleArn: roleArn,
          webIdentityToken: tokensRef.current.idToken,
          durationSeconds: 900,
        })();

      const newClient = withPRM(LambdaClient, {
        region: REGION,
        credentials: credentialProvider,
      });

      setLambdaClient(newClient);
    } catch (error) {
      console.error('Error in LambdaClient initialization:', error);
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
          initializeLambdaClient();
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
      setLambdaClient(null);
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
    initializeLambdaClient,
  ]);
  const checkAndRefreshTokens = useCallback(async () => {
    const { accessToken, idToken, refreshToken } = tokensRef.current;
    if (!accessToken || !idToken || !refreshToken) {
      return false;
    }

    try {
      const now = Date.now();

      // Enforce idle timeout (client-side — only the browser knows about user activity)
      if (sessionIdleTimeoutRef.current > 0) {
        const idleMs = now - lastActivityRef.current;
        const limitMs = sessionIdleTimeoutRef.current * 60 * 1000;
        if (idleMs > limitMs) {
          console.warn(
            `Session idle timeout: ${Math.round(idleMs / 60000)}min idle > ${sessionIdleTimeoutRef.current}min limit`
          );
          showTokenRevocationNotification('idle');
          logout();
          return false;
        }
      }

      // Enforce max session duration (client-side check — server-side also enforced in token-adjuster)
      if (maxSessionDurationRef.current > 0 && sessionStartRef.current > 0) {
        const sessionMs = now - sessionStartRef.current;
        const limitMs = maxSessionDurationRef.current * 3600 * 1000;
        if (sessionMs > limitMs) {
          console.warn(
            `Session duration exceeded: ${Math.round(sessionMs / 3600000)}h > ${maxSessionDurationRef.current}h limit`
          );
          showTokenRevocationNotification('expired');
          logout();
          return false;
        }
      }

      const isAccessTokenExpired = isTokenExpired(decodedTokensRef.current.accessToken);
      const isIdTokenExpired = isTokenExpired(decodedTokensRef.current.idToken);

      // Always refresh first if tokens are expired/near expiry
      if (isAccessTokenExpired || isIdTokenExpired) {
        const refreshed = await refreshTokens();
        if (refreshed) {
          lastRefreshTimeRef.current = now;
          return true;
        }
        // refreshTokens() already handles logout on permanent failure
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
            // refreshTokens() already handles logout on permanent failure
            return false;
          } else {
            // Genuine revocation — this is a permanent auth failure, logout immediately
            console.error('Token has been revoked during periodic check, forcing logout');
            showTokenRevocationNotification('revocation');
            logout();
            return false;
          }
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

        localStorage.setItem('lastGroupCheck', now.toString());
        const refreshed = await refreshTokens();
        if (refreshed) {
          lastRefreshTimeRef.current = now;
          return true;
        }
        // refreshTokens() already handles logout on permanent failure
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
    let visibilityTimer: ReturnType<typeof setTimeout> | null = null;

    const handleVisibilityChange = () => {
      // Debounce: clear any pending timer from rapid tab switches
      if (visibilityTimer) {
        clearTimeout(visibilityTimer);
        visibilityTimer = null;
      }

      if (document.visibilityState === 'visible') {
        // Delay to allow network stack to re-establish after laptop wake.
        // Combined with retry logic in refreshTokens(), this prevents false logouts
        // from transient network errors during wake-up.
        visibilityTimer = setTimeout(() => {
          visibilityTimer = null;
          if (navigator.onLine) {
            checkAndRefreshTokens();
          } else {
            // Wait for network to come back, then check
            const onOnline = () => {
              window.removeEventListener('online', onOnline);
              checkAndRefreshTokens();
            };
            window.addEventListener('online', onOnline);
          }
        }, 2000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityTimer) {
        clearTimeout(visibilityTimer);
      }
    };
  }, [checkAndRefreshTokens]);

  // Track user activity for idle timeout enforcement
  useEffect(() => {
    if (!user) return;

    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // Passive listeners — no performance impact
    window.addEventListener('mousemove', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('touchstart', updateActivity, { passive: true });
    window.addEventListener('scroll', updateActivity, { passive: true });

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      window.removeEventListener('scroll', updateActivity);
    };
  }, [user]);

  // Fetch session policy from admin settings and set session start time
  useEffect(() => {
    if (!user) return;

    // Set session start time if not already set (persisted in sessionStorage across refreshes)
    const storedStart = sessionStorage.getItem('numaSessionStart');
    if (storedStart) {
      sessionStartRef.current = parseInt(storedStart);
    } else {
      const now = Date.now();
      sessionStartRef.current = now;
      sessionStorage.setItem('numaSessionStart', now.toString());
    }

    // Fetch admin session policy (unauthenticated endpoint, same as MFA settings)
    const fetchSessionPolicy = async () => {
      try {
        const settings = await AdminMfaSettingsService.get();
        sessionIdleTimeoutRef.current = settings.sessionIdleTimeoutMinutes;
        maxSessionDurationRef.current = settings.maxSessionDurationHours;
      } catch (err) {
        console.warn('Failed to fetch session policy:', err);
      }
    };
    fetchSessionPolicy();
  }, [user]);

  useEffect(() => {
    return () => {
      clearScheduledRefresh();
    };
  }, [clearScheduledRefresh]);

  const loadUserFromTokens = async () => {
    // Ensure config (CLIENT_ID, REGION, API_ENDPOINT) is in sessionStorage before
    // attempting any token operations that depend on it.
    const configReady = await ensureConfigLoaded();
    if (!configReady) {
      console.warn('⚠️ Config not available after waiting, cannot initialize auth');
      setLoading(false);
      setTokenValidationComplete(true);
      return;
    }

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
        console.warn('Tokens expired, attempting refresh...');
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

        // Check server-side MFA claims injected by the token-adjuster Lambda.
        // These are in the Cognito-signed ID token and cannot be tampered with.
        // Only mfa_setup_required forces re-login — it means the user has no MFA
        // and no grace period. mfa_reset_pending is allowed: it means an admin
        // reset MFA and the user is in a grace period (handled at login time).
        const idTokenPayload = decodedIdToken as Record<string, unknown>;
        if (idTokenPayload['custom:mfa_setup_required'] === 'true') {
          console.warn('⚠️ ID token has MFA setup required claim — clearing session, user must re-login');
          localStorage.removeItem('accessToken');
          localStorage.removeItem('idToken');
          localStorage.removeItem('refreshToken');
          tokensRef.current = { accessToken: null, idToken: null, refreshToken: null };
          setUser(null);
          setLoading(false);
          setTokenValidationComplete(true);
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

    // Step 2: Validate device trust server-side before including DEVICE_KEY.
    // The server holds the rememberedAt timestamp and checks it against the admin-configured
    // duration — the client has no control over the expiry window (tamper-proof).
    //
    // IMPORTANT: Only send DEVICE_KEY to Cognito during login when trust is valid.
    // If we send DEVICE_KEY with invalid trust, Cognito issues DEVICE_SRP_AUTH which
    // we can't complete, breaking the auth flow. Without DEVICE_KEY, Cognito falls
    // back to SOFTWARE_TOKEN_MFA normally.
    //
    // Device credentials are KEPT in localStorage regardless — they are needed for
    // REFRESH_TOKEN_AUTH (Cognito binds refresh tokens to confirmed devices) and for
    // ListDevicesCommand to identify the current device.
    const storedDeviceKey = getStoredDeviceKey();
    let deviceTrustValid = false;
    if (storedDeviceKey) {
      try {
        deviceTrustValid = await AdminMfaSettingsService.validateDevice(storedDeviceKey);
      } catch {
        // If we can't reach the server, fail closed (require MFA)
        deviceTrustValid = false;
      }
    }

    // Only include DEVICE_KEY when trust is valid — this tells Cognito to skip MFA
    // via DEVICE_SRP_AUTH. When trust is invalid/expired, omit DEVICE_KEY so Cognito
    // issues SOFTWARE_TOKEN_MFA instead.
    const authParameters: Record<string, string> = {
      USERNAME: lowercaseUsername,
      SRP_A: srpSession.largeA,
      SECRET_HASH: SECRET_HASH,
    };

    if (storedDeviceKey && deviceTrustValid) {
      authParameters.DEVICE_KEY = storedDeviceKey;
    }

    const initiateAuthParams = {
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: authParameters,
    };

    const initiateAuthCommand = new InitiateAuthCommand(initiateAuthParams);
    const initiateAuthResponse = await cognitoClient.send(initiateAuthCommand);

    if (!initiateAuthResponse.ChallengeParameters) {
      throw new Error('Missing ChallengeParameters in InitiateAuthResponse');
    }

    // Step 3: Sign SRP session
    const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);

    // Step 4: Respond to the password verifier challenge
    const challengeResponses: Record<string, string> = {
      USERNAME: lowercaseUsername,
      PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
      PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
      SECRET_HASH: SECRET_HASH,
      TIMESTAMP: signedSrpSession.timestamp,
    };

    if (storedDeviceKey && deviceTrustValid) {
      challengeResponses.DEVICE_KEY = storedDeviceKey;
    }

    const respondToAuthChallengeParams = {
      ChallengeName: 'PASSWORD_VERIFIER',
      ClientId: CLIENT_ID,
      ChallengeResponses: challengeResponses,
    };

    const respondToAuthChallengeCommand = new RespondToAuthChallengeCommand(respondToAuthChallengeParams);
    let respondToAuthChallengeResponse = await cognitoClient.send(respondToAuthChallengeCommand);

    // Handle DEVICE_SRP_AUTH → DEVICE_PASSWORD_VERIFIER challenge chain.
    // Since we only send DEVICE_KEY when deviceTrustValid is true, if Cognito
    // returns DEVICE_SRP_AUTH, we know trust is valid and should complete the
    // device SRP handshake to skip MFA.
    if (respondToAuthChallengeResponse.ChallengeName === 'DEVICE_SRP_AUTH') {
      const deviceGroupKey = getStoredDeviceGroupKey();
      const deviceRandomPassword = getStoredDeviceRandomPassword();

      if (!storedDeviceKey || !deviceGroupKey || !deviceRandomPassword) {
        // Device credentials are incomplete — this shouldn't happen since we only
        // send DEVICE_KEY when we have it, but handle gracefully. Clear trust so
        // next login omits DEVICE_KEY and Cognito falls back to MFA.
        console.warn('DEVICE_SRP_AUTH received but device credentials are incomplete');
        clearDeviceTrust();
      } else {
        try {
          // Step 1: Respond to DEVICE_SRP_AUTH — sends SRP_A for device key exchange
          const deviceSrpResponse = await cognitoClient.send(
            new RespondToAuthChallengeCommand(
              wrapAuthChallenge(signedSrpSession, {
                ClientId: CLIENT_ID,
                ChallengeName: 'DEVICE_SRP_AUTH',
                ChallengeResponses: {
                  SECRET_HASH: SECRET_HASH,
                  USERNAME: lowercaseUsername,
                  DEVICE_KEY: storedDeviceKey,
                },
                Session: respondToAuthChallengeResponse.Session,
              })
            )
          );

          // Step 2: Sign the device SRP session using the stored random password
          const signedDeviceSession = signSrpSessionWithDevice(
            srpSession,
            deviceSrpResponse,
            deviceGroupKey,
            deviceRandomPassword
          );

          // Step 3: Respond to DEVICE_PASSWORD_VERIFIER — proves we know the device password
          respondToAuthChallengeResponse = await cognitoClient.send(
            new RespondToAuthChallengeCommand(
              wrapAuthChallenge(signedDeviceSession, {
                ClientId: CLIENT_ID,
                ChallengeName: 'DEVICE_PASSWORD_VERIFIER',
                ChallengeResponses: {
                  SECRET_HASH: SECRET_HASH,
                  USERNAME: lowercaseUsername,
                  DEVICE_KEY: storedDeviceKey,
                },
                Session: deviceSrpResponse.Session,
              })
            )
          );
        } catch (deviceErr) {
          // Device SRP failed — clear device trust so next login omits DEVICE_KEY
          // and Cognito falls back to MFA instead.
          console.warn('Device SRP authentication failed, clearing device trust:', deviceErr);
          clearDeviceTrust();
        }
      }
    }

    return {
      response: respondToAuthChallengeResponse,
      cognitoClient,
      lowercaseUsername,
      SECRET_HASH,
      CLIENT_ID,
    };
  };

  // Stores auth tokens in refs and sessionStorage WITHOUT setting user state.
  // Used when MFA enrollment is required — tokens must be available for API calls
  // (e.g. AssociateSoftwareToken) but user must NOT be set in React state
  // (which would trigger route redirect away from /login).
  //
  // SECURITY: Tokens are stored in sessionStorage (not localStorage) so they are
  // automatically cleared when the browser/tab is closed. If the user abandons MFA
  // enrollment mid-flow, stale tokens won't persist across sessions. Once MFA
  // enrollment succeeds, finalizeLogin() promotes tokens to localStorage.
  const pendingAuthTokensRef = useRef<{
    AccessToken: string;
    IdToken: string;
    RefreshToken: string;
    NewDeviceMetadata?: { DeviceKey?: string; DeviceGroupKey?: string };
  } | null>(null);
  const pendingRememberDeviceRef = useRef(false);
  const mfaEnrollmentInProgressRef = useRef(false);

  const storeTokensWithoutLogin = (authResult: {
    AccessToken: string;
    IdToken: string;
    RefreshToken: string;
    NewDeviceMetadata?: { DeviceKey?: string; DeviceGroupKey?: string };
  }) => {
    // Store in refs so getAccessToken()/getIdToken() work for MFA setup API calls
    tokensRef.current = {
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      refreshToken: authResult.RefreshToken,
    };
    decodedTokensRef.current = {
      accessToken: jwtDecode(authResult.AccessToken),
      idToken: jwtDecode(authResult.IdToken),
    };
    // Store in sessionStorage (tab-scoped, auto-cleared on close) — NOT localStorage.
    // This prevents stale pre-MFA tokens from persisting if the user abandons enrollment.
    sessionStorage.setItem('pendingMfaAccessToken', authResult.AccessToken);
    sessionStorage.setItem('pendingMfaRefreshToken', authResult.RefreshToken);
    sessionStorage.setItem('pendingMfaIdToken', authResult.IdToken);
    // Save full auth result so finalizeLogin can complete the flow
    pendingAuthTokensRef.current = authResult;
  };

  // Called when Cognito returned tokens but MFA enrollment is required.
  // Stores tokens (for API calls) and initiates MFA setup without setting user state.
  // isAdminReset: true when triggered by admin MFA reset (shows "reset by admin" message),
  //              false for first-time enrollment (shows normal setup message).
  const handleMfaEnrollmentRequired = async (
    authResult: { AccessToken: string; IdToken: string; RefreshToken: string },
    username: string,
    isAdminReset = false
  ): Promise<MfaSetupRequired> => {
    mfaEnrollmentInProgressRef.current = true;
    storeTokensWithoutLogin(authResult);

    // Initiate MFA enrollment using the stored access token
    const REGION = window.sessionStorage.getItem('REGION');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });
    const associateResponse = await cognitoClient.send(
      new AssociateSoftwareTokenCommand({ AccessToken: authResult.AccessToken })
    );

    if (!associateResponse.SecretCode) {
      throw new Error('Failed to get MFA secret code from Cognito');
    }

    const decodedId = decodedTokensRef.current.idToken as Record<string, unknown>;
    const email = (decodedId?.email as string) || username;
    const issuer = 'Numa';
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${associateResponse.SecretCode}&issuer=${encodeURIComponent(issuer)}`;

    const setupData: MfaSetupRequired = {
      requiresMfaSetup: true,
      session: associateResponse.Session || '',
      username: email,
      secretCode: associateResponse.SecretCode,
      otpauthUrl,
      isReEnrollment: isAdminReset,
      pendingLogin: true,
    };
    setMfaSetupData(setupData);
    setMfaCodeData(null);
    return setupData;
  };

  // Completes login after MFA enrollment. Promotes pending tokens from
  // sessionStorage to localStorage, then calls handleLoginSuccess to set
  // user state and trigger route navigation.
  const finalizeLogin = useCallback(async (): Promise<{ features: string[] }> => {
    const pending = pendingAuthTokensRef.current;
    if (!pending) {
      throw new Error('No pending authentication to finalize');
    }
    // Clean up temporary sessionStorage keys used during MFA enrollment
    sessionStorage.removeItem('pendingMfaAccessToken');
    sessionStorage.removeItem('pendingMfaRefreshToken');
    sessionStorage.removeItem('pendingMfaIdToken');
    const result = await handleLoginSuccessRef.current(pending);
    // Confirm and optionally remember device after login
    const rememberDevice = pendingRememberDeviceRef.current;
    pendingRememberDeviceRef.current = false;
    const REGION = window.sessionStorage.getItem('REGION');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });
    await confirmAndRememberDevice(pending, cognitoClient, pending.AccessToken, rememberDevice);
    pendingAuthTokensRef.current = null;
    mfaEnrollmentInProgressRef.current = false;
    return result;
  }, []);

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
        setMfaSetupData(mfaSetupResult);
        setMfaCodeData(null);
        return mfaSetupResult;
      }

      // Handle SOFTWARE_TOKEN_MFA challenge - user needs to enter TOTP code
      if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        // Store session and username for later use in submitMfaCode
        mfaSessionRef.current = response.Session;
        mfaUsernameRef.current = lowercaseUsername;
        const mfaCodeResult: MfaCodeRequired = {
          requiresMfaCode: true,
          session: response.Session,
          username: lowercaseUsername,
        };
        setMfaCodeData(mfaCodeResult);
        setMfaSetupData(null);
        return mfaCodeResult;
      }

      if (!response.AuthenticationResult) {
        // Device SRP returned an unexpected state (e.g. stale device credentials).
        // Stale trust was already cleared by performSrpAuthentication — retry once.
        const retry = await performSrpAuthentication(username, password);
        if (!retry.response.AuthenticationResult) {
          throw new Error('Authentication failed — no tokens received. Please try again.');
        }
        const { features } = await handleLoginSuccess(retry.response.AuthenticationResult);
        return { success: true, features };
      }

      // Cognito returned tokens directly — no MFA challenge was issued.
      // With OPTIONAL MFA, this happens when the user has no TOTP configured.
      // We MUST check if MFA enrollment is required BEFORE setting user state,
      // because setUser() triggers a route redirect away from /login which would
      // prevent MFA enforcement from running.
      const authResult = response.AuthenticationResult;
      if (authResult?.IdToken) {
        const idPayload = jwtDecode(authResult.IdToken) as Record<string, unknown>;
        const needsMfa =
          idPayload['custom:mfa_setup_required'] === 'true' || idPayload['custom:mfa_reset_pending'] === 'true';

        if (!needsMfa) {
          // DEFENSE-IN-DEPTH ONLY (Layer 2): Client-side fallback that checks Cognito
          // directly for MFA status. This is NOT a primary security control — it depends
          // on the client-side MFA_ENABLED flag which is read from config.json and could
          // be tampered with. Layer 1 (token-adjuster server-side claims) is the
          // authoritative enforcement. This layer exists solely to catch the case where
          // token-adjuster hasn't been deployed yet to a client environment.
          try {
            const REGION = window.sessionStorage.getItem('REGION');
            const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });
            const userInfo = await cognitoClient.send(new GetUserCommand({ AccessToken: authResult.AccessToken }));
            const mfaMethods = userInfo.UserMFASettingList ?? [];
            if (mfaMethods.length === 0 && getFlag('MFA_ENABLED')) {
              console.warn('MFA enforcement (Layer 2): user has no MFA configured, requiring enrollment');
              return await handleMfaEnrollmentRequired(authResult, lowercaseUsername, false);
            }
          } catch (err) {
            console.error('MFA status check failed (non-fatal):', err);
          }
        }

        if (needsMfa) {
          const isAdminReset = idPayload['custom:mfa_reset_pending'] === 'true';
          console.warn(
            `MFA enforcement (Layer 1): token-adjuster flagged MFA required (${isAdminReset ? 'admin reset' : 'setup required'})`
          );
          return await handleMfaEnrollmentRequired(authResult, lowercaseUsername, isAdminReset);
        }
      }

      // MFA is verified or not required — safe to set user state
      const { features } = await handleLoginSuccess(authResult);
      return { success: true, features };
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

  // Confirm and optionally remember a new device after successful MFA authentication.
  // Uses createDeviceVerifier() from cognito-srp-helper to compute the SRP salt and
  // password verifier that Cognito needs to register the device. The DeviceRandomPassword
  // is stored in localStorage so we can complete DEVICE_PASSWORD_VERIFIER challenges
  // on subsequent logins (which skips MFA for the remembered device).
  const confirmAndRememberDevice = async (
    authResult: { NewDeviceMetadata?: { DeviceKey?: string; DeviceGroupKey?: string } },
    cognitoClient: CognitoIdentityProviderClient,
    accessToken: string,
    rememberDevice: boolean
  ): Promise<void> => {
    const newDeviceMetadata = authResult.NewDeviceMetadata;
    if (!newDeviceMetadata?.DeviceKey || !newDeviceMetadata?.DeviceGroupKey) {
      console.debug('confirmAndRememberDevice: no NewDeviceMetadata in auth result (device already known)');
      return;
    }
    console.debug('confirmAndRememberDevice: confirming new device', newDeviceMetadata.DeviceKey);

    try {
      // Generate the SRP verifier for this device (salt + password verifier)
      const { DeviceSecretVerifierConfig, DeviceRandomPassword } = createDeviceVerifier(
        newDeviceMetadata.DeviceKey,
        newDeviceMetadata.DeviceGroupKey
      );

      // Confirm the device with Cognito, including the SRP verifier
      await cognitoClient.send(
        new ConfirmDeviceCommand({
          AccessToken: accessToken,
          DeviceKey: newDeviceMetadata.DeviceKey,
          DeviceName: navigator.userAgent,
          DeviceSecretVerifierConfig,
        })
      );

      // Always store device credentials after ConfirmDeviceCommand. Cognito
      // binds the refresh token to the confirmed device, so DEVICE_KEY must
      // be included in all subsequent REFRESH_TOKEN_AUTH requests — without
      // it Cognito rejects with "Invalid Refresh Token". On next login, if
      // the device was not "remembered", validateDevice() will fail
      // server-side and clearDeviceTrust() will remove these credentials.
      storeDeviceTrust(newDeviceMetadata.DeviceKey, newDeviceMetadata.DeviceGroupKey, DeviceRandomPassword);
      console.debug('confirmAndRememberDevice: device confirmed and credentials stored');

      if (rememberDevice) {
        // Tell Cognito to remember this device (suppresses future MFA on next login)
        await cognitoClient.send(
          new UpdateDeviceStatusCommand({
            AccessToken: accessToken,
            DeviceKey: newDeviceMetadata.DeviceKey,
            DeviceRememberedStatus: 'remembered',
          })
        );
        // Record trust timestamp server-side (non-blocking). The server stores the
        // rememberedAt time so the client cannot tamper with expiry via DevTools.
        try {
          await AdminMfaSettingsService.recordDeviceTrust(newDeviceMetadata.DeviceKey, accessToken);
        } catch (trustErr) {
          console.warn('Failed to record device trust server-side (non-blocking):', trustErr);
        }
      }
    } catch (err) {
      // Device confirmation failure should not block login
      console.warn('Device confirmation failed (non-blocking):', err);
    }
  };

  // Complete MFA setup by verifying the TOTP code and enabling MFA
  const completeMfaSetup = useCallback(async (code: string, rememberDevice?: boolean): Promise<LoginResult> => {
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
      Session: verifyResponse.Session || session,
      ChallengeResponses: {
        USERNAME: username,
        SECRET_HASH: SECRET_HASH,
        ANSWER: 'SOFTWARE_TOKEN_MFA',
      },
    });

    const authResponse = await cognitoClient.send(respondCommand);

    // Clear MFA session refs and shared state
    mfaSessionRef.current = null;
    mfaUsernameRef.current = null;
    setMfaSetupData(null);
    setMfaCodeData(null);

    if (authResponse.AuthenticationResult) {
      // Set TOTP as the preferred MFA method so Cognito challenges on future logins.
      // Without this, MFA stays "verified but not preferred" and Cognito won't
      // issue SOFTWARE_TOKEN_MFA challenges (pool is OPTIONAL), causing an
      // infinite re-enrollment loop.
      try {
        await cognitoClient.send(
          new SetUserMFAPreferenceCommand({
            AccessToken: authResponse.AuthenticationResult.AccessToken,
            SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
          })
        );
      } catch (err) {
        console.error('Failed to set MFA preference after setup (non-fatal):', err);
      }

      // Stash auth result without setting user state — this allows the caller
      // (Login.tsx) to show recovery codes before triggering the route guard
      // redirect. Call finalizeLogin() when ready to complete the login.
      storeTokensWithoutLogin(authResponse.AuthenticationResult);
      pendingRememberDeviceRef.current = rememberDevice ?? false;

      // Decode features from the token so the caller knows where to navigate
      const idToken = jwtDecode<Record<string, unknown>>(authResponse.AuthenticationResult.IdToken);
      const features = ((idToken['custom:features'] as string) || '').split(',').filter(Boolean);
      return { success: true, features };
    }

    throw new Error('MFA setup completed but authentication failed');
  }, []);

  // Submit MFA code for SOFTWARE_TOKEN_MFA challenge (subsequent logins)
  const submitMfaCode = useCallback(async (code: string, rememberDevice?: boolean): Promise<LoginResult> => {
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

    // Clear MFA session refs and shared state
    mfaSessionRef.current = null;
    mfaUsernameRef.current = null;
    setMfaSetupData(null);
    setMfaCodeData(null);

    if (authResponse.AuthenticationResult) {
      const { features } = await handleLoginSuccess(authResponse.AuthenticationResult);
      // Confirm and optionally remember device after successful auth
      await confirmAndRememberDevice(
        authResponse.AuthenticationResult,
        cognitoClient,
        authResponse.AuthenticationResult.AccessToken,
        rememberDevice ?? false
      );
      return { success: true, features };
    }

    throw new Error('MFA verification failed');
  }, []);

  const setNewPassword = useCallback(
    async (username, oldPassword, newPassword): Promise<LoginResult> => {
      try {
        const { response, cognitoClient, lowercaseUsername, SECRET_HASH, CLIENT_ID } = await performSrpAuthentication(
          username,
          oldPassword
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
    [login]
  );

  // Ref to handleLoginSuccess — allows useCallback hooks (e.g. finalizeLogin)
  // to call the latest version without adding it to their dependency arrays.
  const handleLoginSuccessRef = useRef<(tokens: Record<string, string>) => Promise<{ features: string[] }>>(null!);

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

    return { features: features || [] };
  };
  handleLoginSuccessRef.current = handleLoginSuccess;

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
          domain: window.location.hostname,
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
      const lowercaseEmail = email.toLowerCase();
      const SECRET_HASH = await fetchSecretHash(lowercaseEmail);
      const REGION = window.sessionStorage.getItem('REGION');
      const CLIENT_ID = window.sessionStorage.getItem('CLIENT_ID');

      const command = new ConfirmForgotPasswordCommand({
        Username: lowercaseEmail,
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
      return null;
    }

    // Get user's actual Cognito group - no defaulting to 'standard'
    const groups = JSON.parse(window.sessionStorage.getItem('GROUPS')) || {};
    const cognitoGroups = getGroupsFromToken(user.decoded_tokens.idToken);

    // Check if user has the features and proper cognito groups
    // If there are no features or groups, block the request since we need to wait until the user has features
    if (user.features.length === 0 || !cognitoGroups || cognitoGroups.length === 0) {
      return null;
    }

    const userGroup = cognitoGroups[0];
    const roleArn = groups[userGroup]?.roleArn;

    if (!roleArn) {
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

      const makeCredentials = (token: string) =>
        fromWebToken({
          roleSessionName: 'numa-frontend',
          roleArn: roleArn,
          webIdentityToken: token,
          durationSeconds: 1800,
        })();

      try {
        return await makeCredentials(idToken);
      } catch (stsError) {
        // STS rejected the token — refresh and retry once before giving up
        console.warn('STS rejected token, refreshing and retrying…', stsError);
        const retryRefreshed = await refreshTokens();
        if (retryRefreshed && tokensRef.current.idToken) {
          return await makeCredentials(tokensRef.current.idToken);
        }
        throw stsError;
      }
    } catch (error) {
      console.error('Error getting credentials:', error);
      throw error;
    }
  }, [user, refreshTokens]);

  // List trusted devices for the current user. Fetches all confirmed devices from
  // Cognito, then filters to only those with a valid (non-expired) server-side trust
  // record. Devices where the user never checked "remember" or whose trust has expired
  // are excluded.
  const listDevices = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.debug('listDevices: no access token available');
      return [];
    }
    const REGION = window.sessionStorage.getItem('REGION');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });
    try {
      const response = await cognitoClient.send(new ListDevicesCommand({ AccessToken: accessToken, Limit: 60 }));
      const allDevices = response.Devices || [];
      if (allDevices.length === 0) return [];

      // Batch-validate which devices have valid trust records within admin timeframe
      const deviceKeys = allDevices.map((d) => d.DeviceKey).filter((k): k is string => !!k);
      const validSet = await AdminMfaSettingsService.validateDevices(deviceKeys, accessToken);

      const currentDeviceKey = getStoredDeviceKey();
      const devices = allDevices
        .filter((d) => d.DeviceKey && validSet.has(d.DeviceKey))
        .map((d) => ({
          deviceKey: d.DeviceKey || '',
          deviceName: d.DeviceAttributes?.find((a) => a.Name === 'device_name')?.Value || '',
          lastAuthDate: d.DeviceLastAuthenticatedDate ? new Date(d.DeviceLastAuthenticatedDate) : null,
          remembered: true,
          isCurrent: d.DeviceKey === currentDeviceKey,
        }));
      console.debug(`listDevices: ${allDevices.length} device(s) in Cognito, ${devices.length} with valid trust`);
      return devices;
    } catch (err) {
      console.error('listDevices: failed:', err);
      return [];
    }
  }, [getAccessToken]);

  // Forget (revoke trust for) a specific device
  const forgetDevice = useCallback(
    async (deviceKey: string) => {
      const accessToken = await getAccessToken();
      if (!accessToken) return;
      const REGION = window.sessionStorage.getItem('REGION');
      const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });
      await cognitoClient.send(new ForgetDeviceCommand({ AccessToken: accessToken, DeviceKey: deviceKey }));
      // Revoke server-side trust record (non-blocking)
      try {
        await AdminMfaSettingsService.revokeDeviceTrust(deviceKey, accessToken);
      } catch (revokeErr) {
        console.warn('Failed to revoke device trust server-side (non-blocking):', revokeErr);
      }
      // If forgetting the current device, clear local trust
      if (deviceKey === getStoredDeviceKey()) {
        clearDeviceTrust();
      }
    },
    [getAccessToken]
  );

  // Initiate MFA re-enrollment for an already-authenticated user (e.g. during MFA reset grace period).
  // Uses AccessToken instead of Session token since the user is already logged in.
  const initiateReEnrollMfa = useCallback(async (): Promise<MfaSetupRequired> => {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error('Not authenticated');

    const REGION = window.sessionStorage.getItem('REGION');
    const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

    const associateResponse = await cognitoClient.send(new AssociateSoftwareTokenCommand({ AccessToken: accessToken }));

    if (!associateResponse.SecretCode) {
      throw new Error('Failed to get MFA secret code from Cognito');
    }

    const email = user?.decoded_tokens?.idToken?.email || 'user';
    const issuer = 'Numa';
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${associateResponse.SecretCode}&issuer=${encodeURIComponent(issuer)}`;

    return {
      requiresMfaSetup: true,
      session: associateResponse.Session || '',
      username: email,
      secretCode: associateResponse.SecretCode,
      otpauthUrl,
    };
  }, [getAccessToken, user]);

  // Complete MFA re-enrollment for an already-authenticated user.
  // Verifies the TOTP code using AccessToken, then re-enables MFA preference.
  const completeReEnrollMfa = useCallback(
    async (code: string): Promise<void> => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const REGION = window.sessionStorage.getItem('REGION');
      const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

      const verifyResponse = await cognitoClient.send(
        new VerifySoftwareTokenCommand({ AccessToken: accessToken, UserCode: code })
      );

      if (verifyResponse.Status !== 'SUCCESS') {
        throw new Error('Invalid verification code');
      }

      // Re-enable TOTP MFA preference
      await cognitoClient.send(
        new SetUserMFAPreferenceCommand({
          AccessToken: accessToken,
          SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
        })
      );

      // Clear the grace period record in DynamoDB so the next token refresh
      // gets a clean token without the mfa_reset_pending claim.
      try {
        const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
        const resetRes = await fetch(`${API_ENDPOINT}/settings/mfa/complete-reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        });
        if (!resetRes.ok) {
          console.warn(`complete-reset returned ${resetRes.status} — grace period may persist until expiry`);
        }
      } catch (err) {
        console.warn('Failed to clear MFA reset record — grace period may persist until expiry:', err);
      }
    },
    [getAccessToken]
  );

  // Verify the user's password without running the full login flow.
  // Used to gate sensitive operations like MFA re-enrollment.
  //
  // NOTE: This runs a full SRP auth exchange with Cognito. The response is
  // discarded (we only care that it didn't throw). Cognito may return an MFA
  // challenge or tokens — neither is used. This does NOT create a new session
  // because we don't call RespondToAuthChallenge or handleLoginSuccess with
  // the result. The only side-effect is Cognito recording an auth attempt.
  const verifyPassword = useCallback(
    async (password: string): Promise<void> => {
      const email = (user?.decoded_tokens?.idToken as Record<string, unknown>)?.email as string;
      if (!email) throw new Error('Unable to determine current user email');
      await performSrpAuthentication(email, password);
    },
    [user]
  );

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
      getIdToken,
      getUserInfo,
      checkAndRefreshTokens,
      forceTokenValidation,
      completeMfaSetup,
      submitMfaCode,
      mfaSetupData,
      mfaCodeData,
      qBusinessClient,
      qAppsClient,
      bedrockRuntimeClient,
      bedrockAgentRuntimeClient,
      bedrockAgentClient,
      numaChatBedrockUtils,
      dynamoDBClient,
      lambdaClient,
      numaChatDynamoUtils,
      requestPasswordReset,
      confirmPasswordReset,
      getCredentials,
      listDevices,
      forgetDevice,
      initiateReEnrollMfa,
      completeReEnrollMfa,
      finalizeLogin,
      verifyPassword,
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
    getIdToken,
    getUserInfo,
    checkAndRefreshTokens,
    forceTokenValidation,
    completeMfaSetup,
    submitMfaCode,
    mfaSetupData,
    mfaCodeData,
    qBusinessClient,
    qAppsClient,
    bedrockRuntimeClient,
    bedrockAgentRuntimeClient,
    bedrockAgentClient,
    numaChatBedrockUtils,
    dynamoDBClient,
    lambdaClient,
    numaChatDynamoUtils,
    requestPasswordReset,
    confirmPasswordReset,
    getCredentials,
    listDevices,
    forgetDevice,
    initiateReEnrollMfa,
    completeReEnrollMfa,
    finalizeLogin,
    verifyPassword,
  ]);

  // Token revocation notification component
  const TokenRevocationNotificationComponent = () => {
    const { t } = useTranslation('auth');
    if (!tokenRevocationState.show) return null;

    const reason = tokenRevocationState.reason;
    const title =
      reason === 'idle'
        ? t('session.idleTitle')
        : reason === 'revocation'
          ? t('session.endedTitle')
          : t('session.expiredTitle');
    const message =
      reason === 'idle'
        ? t('session.idleMessage')
        : reason === 'revocation'
          ? t('session.endedMessage')
          : t('session.expiredMessage');

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

/** Safe variant of useAuth that returns null outside AuthProvider (e.g. public demo page). */
// eslint-disable-next-line react-refresh/only-export-components
export const useAuthOptional = () => {
  return useContext(AuthContext);
};

// Create a wrapper for testing
export const TestAuthProvider = ({ children, refreshHandler, initialTokens }) => {
  return (
    <AuthProvider refreshHandler={refreshHandler} initialTokens={initialTokens}>
      {children}
    </AuthProvider>
  );
};

// Classify whether an error from refreshTokens() is transient (retry-able) or permanent (logout).
// Transient: network hiccups, DNS failures, fetch timeouts, config not loaded yet.
// Permanent: Cognito explicitly rejected the token (revoked, user deleted, etc.).
const isTransientError = (error: unknown): boolean => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;

  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;

    // Explicitly marked as transient (e.g., config not loaded yet)
    if (err.isTransient === true) return true;

    // Cognito permanent errors — these should NOT retry
    const permanentNames = ['NotAuthorizedException', 'UserNotFoundException', 'TokenRefreshException'];
    if (typeof err.name === 'string' && permanentNames.includes(err.name)) return false;

    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';

    // TypeError from fetch() rejection — message varies by browser:
    // Chrome: "Failed to fetch", Safari: "Load failed", Firefox: "NetworkError"
    if (error instanceof TypeError) {
      return ['failed to fetch', 'load failed', 'network', 'abort'].some((kw) => msg.includes(kw));
    }

    // Other errors with network-related messages (includes re-wrapped fetch errors
    // where the original TypeError is caught and re-thrown as a plain Error).
    // Use word-boundary-safe checks to avoid false positives like "Failed to fetch secret hash".
    if (
      ['network', 'timeout', 'abort', 'dns', 'econnrefused', 'enotfound', 'load failed'].some((kw) =>
        msg.includes(kw)
      ) ||
      msg === 'failed to fetch'
    ) {
      return true;
    }
  }

  // Default: treat unknown errors as permanent to avoid silent retry loops
  return false;
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

  if (!groups || groups.length === 0) {
    // If the user is not in any groups, they should have no access - don't default to standard
    console.error('🚫 No groups found for user - access denied');
    console.error('🔍 Full decoded ID token:', decodedIdToken);

    return { groups: [], features: [] };
  }

  const features = groups.reduce((acc, group) => {
    const groupFeatures = GROUPS[group]?.features || [];
    return [...acc, ...groupFeatures];
  }, []);

  return { groups, features };
};
