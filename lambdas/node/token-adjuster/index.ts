import { PreTokenGenerationV2TriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const MFA_SETTINGS_TABLE_NAME = process.env.MFA_SETTINGS_TABLE_NAME;

// Lazy-init clients — only created when needed
let ddb: DynamoDBDocumentClient | null = null;
const getDdb = (): DynamoDBDocumentClient => {
  if (!ddb) {
    ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return ddb;
};

let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
};

// Cached per cold start — only calls DescribeUserPool once per Lambda instance
let cachedMfaConfig: string | null = null;

/**
 * Checks the user pool's MFA configuration by calling DescribeUserPool.
 * Cached per Lambda cold start so it only makes one API call per instance.
 * No env var needed — reads directly from the pool that invoked this trigger.
 */
const getPoolMfaConfig = async (userPoolId: string): Promise<string> => {
  if (cachedMfaConfig !== null) return cachedMfaConfig;

  try {
    const res = await getCognito().send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }));
    cachedMfaConfig = res.UserPool?.MfaConfiguration ?? 'OFF';
  } catch (err) {
    // Fail closed — assume OPTIONAL so MFA enforcement still runs. If the pool
    // is actually OFF, the worst case is users without MFA see a setup prompt
    // (which resolves on next cold start). The alternative (assuming OFF) would
    // silently disable all MFA enforcement during a Cognito API outage.
    console.error('getPoolMfaConfig: failed to describe user pool, defaulting to OPTIONAL (fail closed)', err);
    cachedMfaConfig = 'OPTIONAL';
  }

  console.log(`User pool MFA configuration: ${cachedMfaConfig}`);
  return cachedMfaConfig;
};

/**
 * Checks the admin-configured max session duration. If the user's session
 * (measured from Cognito's auth_time claim) exceeds the limit, throws an error
 * which causes Cognito to reject the token refresh — forcing re-login.
 */
const enforceMaxSessionDuration = async (authTime: number | undefined): Promise<void> => {
  if (!MFA_SETTINGS_TABLE_NAME || !authTime) return;

  try {
    const res = await getDdb().send(
      new GetCommand({
        TableName: MFA_SETTINGS_TABLE_NAME,
        Key: { setting: 'session-config' },
      })
    );

    const maxHours = res.Item?.maxSessionDurationHours as number | undefined;
    if (!maxHours || maxHours <= 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const sessionAgeSec = nowSec - authTime;
    const maxSec = maxHours * 3600;

    if (sessionAgeSec > maxSec) {
      console.warn(
        `Session exceeded max duration: ${Math.round(sessionAgeSec / 60)}min > ${maxHours}h limit. ` +
          `auth_time=${authTime}, now=${nowSec}`
      );
      throw new Error('Session duration exceeded');
    }
  } catch (err) {
    if ((err as Error).message === 'Session duration exceeded') throw err;
    console.error('enforceMaxSessionDuration: non-fatal error', err);
  }
};

/**
 * Checks whether the user has an active MFA reset grace period.
 * Returns the grace period expiry ISO string if active, or null if not.
 */
const checkMfaResetGracePeriod = async (userSub: string): Promise<string | null> => {
  if (!MFA_SETTINGS_TABLE_NAME) return null;

  try {
    const res = await getDdb().send(
      new GetCommand({
        TableName: MFA_SETTINGS_TABLE_NAME,
        Key: { setting: `mfa-reset#${userSub}` },
      })
    );

    if (!res.Item) return null;

    const status = res.Item.status as string | undefined;
    if (status === 'completed') return null;

    const expiresAt = res.Item.expiresAt as number | undefined;
    if (expiresAt && Math.floor(Date.now() / 1000) > expiresAt) return null;

    const expiresAtIso = expiresAt ? new Date(expiresAt * 1000).toISOString() : null;
    console.log(`MFA reset grace period active for user ${userSub}, expires ${expiresAtIso}`);
    return expiresAtIso;
  } catch (err) {
    console.error('checkMfaResetGracePeriod: non-fatal error', err);
    return null;
  }
};

/**
 * Checks whether the user has MFA (TOTP) configured in Cognito.
 * Uses AdminGetUser with the userPoolId from the event — no env var needed.
 */
const isUserMfaConfigured = async (userPoolId: string, username: string): Promise<boolean> => {
  try {
    const res = await getCognito().send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      })
    );

    const mfaSettings = res.UserMFASettingList ?? [];
    return mfaSettings.length > 0;
  } catch (err) {
    // Fail closed — if we can't determine MFA status, assume unconfigured so
    // enforcement runs. The worst case is a false MFA setup prompt that resolves
    // on retry. Failing open would silently skip MFA enforcement during a
    // Cognito API outage or throttling event.
    console.error('isUserMfaConfigured: failed to check MFA status, failing closed (assume unconfigured)', err);
    return false;
  }
};

export const handler: PreTokenGenerationV2TriggerHandler = async function (event) {
  // Log trigger source and user sub only — full event contains sensitive attributes
  console.log(`token-adjuster: triggerSource=${event.triggerSource}, sub=${event.request.userAttributes.sub}`);

  // Enforce max session duration (server-side, tamper-proof).
  const attrs = event.request.userAttributes as Record<string, string>;
  const authTime = Number(attrs['auth_time']) || Number(attrs['custom:auth_time']) || undefined;
  await enforceMaxSessionDuration(authTime);

  const { groupsToOverride } = event.request.groupConfiguration;

  const email = event.request.userAttributes.email;
  const userSub = event.request.userAttributes.sub;
  const groups = groupsToOverride && groupsToOverride.length > 0 ? groupsToOverride : ['standard'];

  // Check for MFA reset grace period
  const graceExpiresAt = await checkMfaResetGracePeriod(userSub);

  // MFA enforcement — only on initial authentication, not token refresh.
  // Checks the ACTUAL user pool MFA config via DescribeUserPool (cached per
  // cold start). No env vars, no feature flags — if the pool is OPTIONAL,
  // we enforce. If it's OFF, we don't. Self-contained.
  let mfaSetupRequired = false;
  if (
    event.triggerSource === 'TokenGeneration_Authentication' ||
    event.triggerSource === 'TokenGeneration_HostedAuth' ||
    event.triggerSource === 'TokenGeneration_RefreshTokens'
  ) {
    const poolMfaConfig = await getPoolMfaConfig(event.userPoolId);

    if (poolMfaConfig === 'OPTIONAL' && !graceExpiresAt) {
      const hasMfa = await isUserMfaConfigured(event.userPoolId, event.userName);

      if (!hasMfa) {
        console.warn(
          `MFA enforcement: user ${userSub} (${email}) has no MFA configured. Injecting mfa_setup_required claim.`
        );
        mfaSetupRequired = true;
      }
    }
  }

  // Build claims
  const claimsToAdd: Record<string, unknown> = {
    'https://aws.amazon.com/tags': {
      principal_tags: {
        Email: [email],
        username: [userSub],
        aud: [event.callerContext.clientId],
        Groups: groups,
      },
    },
  };

  if (graceExpiresAt) {
    claimsToAdd['custom:mfa_reset_pending'] = 'true';
    claimsToAdd['custom:mfa_reset_expires'] = graceExpiresAt;
  }

  if (mfaSetupRequired) {
    claimsToAdd['custom:mfa_setup_required'] = 'true';
  }

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: claimsToAdd as Record<string, string>,
      },
    },
  };
  console.log(`token-adjuster: response claims=${JSON.stringify(Object.keys(claimsToAdd))}`);
  return event;
};
