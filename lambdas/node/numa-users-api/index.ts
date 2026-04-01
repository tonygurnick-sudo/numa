import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withPRM } from '../../../lib/prm-node/prm';

const REGION = process.env.REGION ?? 'us-east-1';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const CHAT_SETTINGS_TABLE = process.env.CHAT_SETTINGS_TABLE_NAME ?? '';

const cognito = withPRM(CognitoIdentityProviderClient, { region: REGION });
const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = withPRM(S3Client, {});

const AVATAR_URL_EXPIRY = 12 * 60 * 60; // 12 hours

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

interface ChatUserProfile {
  name?: string;
  jobTitle?: string;
  profileImage?: { s3Bucket: string; s3Key: string } | null;
}

type WorkspaceUser = {
  sub: string;
  email: string;
  name: string;
  displayName?: string;
  jobTitle?: string;
  profileImage?: { s3Bucket: string; s3Key: string } | null;
  avatarUrl?: string;
  enabled: boolean;
};

const getAttr = (attrs: { Name?: string; Value?: string }[] | undefined, name: string): string | undefined =>
  attrs?.find((a) => a.Name === name)?.Value;

/**
 * Batch-read user profiles from the chat-settings DynamoDB table.
 */
const batchGetUserProfiles = async (userIds: string[]): Promise<Map<string, ChatUserProfile>> => {
  const result = new Map<string, ChatUserProfile>();
  if (!CHAT_SETTINGS_TABLE || userIds.length === 0) return result;

  const BATCH_SIZE = 100;
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const chunk = userIds.slice(i, i + BATCH_SIZE);
    const keys = chunk.map((id) => ({ user_id: id }));

    try {
      const response = await dynamo.send(
        new BatchGetCommand({
          RequestItems: {
            [CHAT_SETTINGS_TABLE]: {
              Keys: keys,
              ProjectionExpression: 'user_id, userProfile',
            },
          },
        })
      );

      const items = response.Responses?.[CHAT_SETTINGS_TABLE] ?? [];
      for (const item of items) {
        const userId = item.user_id as string;
        const profile = item.userProfile as ChatUserProfile | undefined;
        if (profile) {
          result.set(userId, profile);
        }
      }
    } catch (err) {
      console.error('[numa-users-api] Failed to batch-read profiles:', err);
    }
  }

  return result;
};

/**
 * Generate presigned S3 URLs for profile images.
 */
const addAvatarPresignedUrls = async (users: WorkspaceUser[]): Promise<void> => {
  await Promise.all(
    users.map(async (user) => {
      if (!user.profileImage?.s3Bucket || !user.profileImage?.s3Key) return;
      try {
        user.avatarUrl = await getSignedUrl(
          s3 as any,
          new GetObjectCommand({
            Bucket: user.profileImage.s3Bucket,
            Key: user.profileImage.s3Key,
          }),
          { expiresIn: AVATAR_URL_EXPIRY }
        );
      } catch {
        // If signing fails, frontend shows initials
      }
    })
  );
};

/**
 * List all enabled users in the Cognito User Pool, enriched with profile data.
 */
const listUsers = async (): Promise<WorkspaceUser[]> => {
  const users: WorkspaceUser[] = [];
  let paginationToken: string | undefined;

  do {
    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    for (const user of result.Users ?? []) {
      const email = getAttr(user.Attributes, 'email');
      const sub = getAttr(user.Attributes, 'sub');
      if (!email || !sub) continue;

      const name = getAttr(user.Attributes, 'name') || getAttr(user.Attributes, 'given_name') || email.split('@')[0];

      users.push({
        sub,
        email,
        name,
        enabled: user.Enabled !== false,
      });
    }

    paginationToken = result.PaginationToken;
  } while (paginationToken);

  const enabledUsers = users.filter((u) => u.enabled);

  // Enrich with profile data from chat-settings table
  if (CHAT_SETTINGS_TABLE) {
    const subs = enabledUsers.map((u) => u.sub);
    const profiles = await batchGetUserProfiles(subs);

    for (const user of enabledUsers) {
      const profile = profiles.get(user.sub);
      if (profile) {
        user.displayName = profile.name || undefined;
        user.jobTitle = profile.jobTitle || undefined;
        user.profileImage = profile.profileImage || undefined;
      }
    }

    // Generate presigned URLs for avatars
    await addAvatarPresignedUrls(enabledUsers);
  }

  return enabledUsers.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext?.http?.method;

  if (method === 'OPTIONS') return respond(200, null);

  if (!USER_POOL_ID) {
    return respond(500, { error: 'User pool not configured' });
  }

  try {
    if (method === 'GET') {
      const users = await listUsers();
      return respond(200, { users });
    }

    return respond(404, { error: 'Not found' });
  } catch (err) {
    console.error('[numa-users-api] Error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};
