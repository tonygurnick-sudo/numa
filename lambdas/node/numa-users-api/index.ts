import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { withPRM } from '../../../lib/prm-node/prm';

const REGION = process.env.REGION ?? 'us-east-1';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';

const cognito = withPRM(CognitoIdentityProviderClient, { region: REGION });

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

type WorkspaceUser = {
  email: string;
  name: string;
  enabled: boolean;
};

const getAttr = (attrs: { Name?: string; Value?: string }[] | undefined, name: string): string | undefined =>
  attrs?.find((a) => a.Name === name)?.Value;

/**
 * List all enabled users in the Cognito User Pool.
 * Returns email + display name for each user.
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
      if (!email) continue;

      const name = getAttr(user.Attributes, 'name') || getAttr(user.Attributes, 'given_name') || email.split('@')[0];

      users.push({
        email,
        name,
        enabled: user.Enabled !== false,
      });
    }

    paginationToken = result.PaginationToken;
  } while (paginationToken);

  return users.filter((u) => u.enabled).sort((a, b) => a.name.localeCompare(b.name));
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
