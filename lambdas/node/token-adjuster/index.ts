import { PreTokenGenerationV2TriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const MFA_SETTINGS_TABLE_NAME = process.env.MFA_SETTINGS_TABLE_NAME;

// Lazy-init DynamoDB client — only created when session enforcement is configured
let ddb: DynamoDBDocumentClient | null = null;
const getDdb = (): DynamoDBDocumentClient => {
  if (!ddb) {
    ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return ddb;
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
      }),
    );

    const maxHours = res.Item?.maxSessionDurationHours as number | undefined;
    if (!maxHours || maxHours <= 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const sessionAgeSec = nowSec - authTime;
    const maxSec = maxHours * 3600;

    if (sessionAgeSec > maxSec) {
      console.warn(
        `Session exceeded max duration: ${Math.round(sessionAgeSec / 60)}min > ${maxHours}h limit. ` +
          `auth_time=${authTime}, now=${nowSec}`,
      );
      throw new Error('Session duration exceeded');
    }
  } catch (err) {
    // Re-throw session exceeded errors — they must reach Cognito to reject the token
    if ((err as Error).message === 'Session duration exceeded') throw err;
    // Swallow DynamoDB errors so a table misconfiguration doesn't break all logins
    console.error('enforceMaxSessionDuration: non-fatal error', err);
  }
};

export const handler: PreTokenGenerationV2TriggerHandler = async function (event) {
  console.log(event);

  // Enforce max session duration (server-side, tamper-proof).
  // Cognito's pre-token-generation event includes userAttributes with auth_time
  // (the epoch second when the user originally authenticated). This stays constant
  // across token refreshes, making it ideal for enforcing max session duration.
  const attrs = event.request.userAttributes as Record<string, string>;
  const authTime = Number(attrs['auth_time']) || Number(attrs['custom:auth_time']) || undefined;
  await enforceMaxSessionDuration(authTime);

  const { groupsToOverride } = event.request.groupConfiguration;

  const email = event.request.userAttributes.email;
  const groups = groupsToOverride && groupsToOverride.length > 0 ? groupsToOverride : ['standard'];

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          // @ts-expect-error: Library has incorrect typing.
          'https://aws.amazon.com/tags': {
            principal_tags: {
              Email: [email],
              username: [event.request.userAttributes.sub],
              aud: [event.callerContext.clientId],
              Groups: groups,
            },
          },
        },
      },
    },
  };
  console.log(JSON.stringify(event));
  return event;
};
