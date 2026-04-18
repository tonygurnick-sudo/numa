import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createHmac, timingSafeEqual } from 'crypto';

const USER_POOL_ID = process.env.USER_POOL_ID as string;
const SCIM_TOKEN_TABLE = process.env.SCIM_TOKEN_TABLE as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) cognitoClient = new CognitoIdentityProviderClient({});
  return cognitoClient;
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const HEADERS = {
  'Content-Type': 'application/scim+json',
  'X-Content-Type-Options': 'nosniff',
} as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Auth (Fix #1: per-deployment salt from DynamoDB, not hardcoded) ---

function hashToken(token: string, salt: string): string {
  return createHmac('sha256', salt).update(token).digest('hex');
}

async function validateBearerToken(event: { headers?: Record<string, string | undefined> }): Promise<boolean> {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth)
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return false;

  try {
    const res = await ddb.send(new GetCommand({ TableName: SCIM_TOKEN_TABLE, Key: { setting: 'scim-token' } }));
    const stored = res.Item;
    if (!stored?.tokenHash || !stored?.salt || stored.revoked) return false;

    const incomingHash = hashToken(token, stored.salt as string);
    const storedHash = stored.tokenHash as string;

    const a = Buffer.from(incomingHash, 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch (err) {
    console.error(JSON.stringify({ _name: 'SCIM_AUTH_ERROR', error: (err as Error).message, clientName: CLIENT_NAME }));
    return false;
  }
}

// --- SCIM helpers ---

interface SCIMUser {
  schemas: string[];
  id: string;
  userName: string;
  name?: { givenName?: string; familyName?: string };
  emails?: Array<{ value: string; primary?: boolean }>;
  active: boolean;
  meta?: { resourceType: string; created?: string; lastModified?: string };
}

function cognitoUserToSCIM(user: any): SCIMUser {
  const attrs = (user.Attributes || user.UserAttributes || []) as Array<{ Name?: string; Value?: string }>;
  const get = (name: string) => attrs.find((a) => a.Name === name)?.Value || '';

  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: get('sub'),
    userName: get('email'),
    name: { givenName: get('given_name'), familyName: get('family_name') },
    emails: [{ value: get('email'), primary: true }],
    active: user.Enabled !== false && user.UserStatus !== 'DISABLED',
    meta: {
      resourceType: 'User',
      created: user.UserCreateDate?.toISOString(),
      lastModified: user.UserLastModifiedDate?.toISOString(),
    },
  };
}

function scimError(status: number, detail: string): { statusCode: number; headers: typeof HEADERS; body: string } {
  return {
    statusCode: status,
    headers: HEADERS,
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail,
      status,
    }),
  };
}

// --- Handlers ---

// Fix #19: proper pagination using Cognito's PaginationToken
async function handleListUsers(_event: {
  queryStringParameters?: Record<string, string | undefined> | null;
}): Promise<{ statusCode: number; body: string }> {
  const startIndex = parseInt(_event.queryStringParameters?.startIndex || '1', 10);
  const count = Math.min(parseInt(_event.queryStringParameters?.count || '100', 10), 100);
  const filter = _event.queryStringParameters?.filter;

  let cognitoFilter: string | undefined;
  if (filter) {
    const match = filter.match(/userName\s+eq\s+"([^"]+)"/i);
    if (match) {
      cognitoFilter = `email = "${match[1]}"`;
    }
  }

  // Collect all users (Cognito paginates at 60 max)
  const allUsers: SCIMUser[] = [];
  let paginationToken: string | undefined;
  do {
    const res = await getCognito().send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        Filter: cognitoFilter,
        PaginationToken: paginationToken,
      })
    );
    allUsers.push(...(res.Users || []).map(cognitoUserToSCIM));
    paginationToken = res.PaginationToken;
  } while (paginationToken);

  // Apply SCIM pagination (1-based startIndex)
  const sliceStart = Math.max(0, startIndex - 1);
  const paginatedUsers = allUsers.slice(sliceStart, sliceStart + count);

  return {
    statusCode: 200,
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: allUsers.length,
      startIndex,
      itemsPerPage: paginatedUsers.length,
      Resources: paginatedUsers,
    }),
  };
}

async function handleGetUser(userId: string): Promise<{ statusCode: number; body: string }> {
  const res = await getCognito().send(
    new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${userId}"`, Limit: 1 })
  );
  const user = res.Users?.[0];
  if (!user) return scimError(404, 'User not found');
  return { statusCode: 200, body: JSON.stringify(cognitoUserToSCIM(user)) };
}

async function handleCreateUser(body: string): Promise<{ statusCode: number; body: string }> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return scimError(400, 'Invalid JSON');
  }

  const email = (parsed.userName as string) || (parsed.emails as Array<{ value: string }>)?.[0]?.value;

  if (!email) {
    return scimError(400, 'userName or emails[0].value is required');
  }

  // Fix #3: validate email format
  if (!EMAIL_REGEX.test(email)) {
    return scimError(400, 'Invalid email format');
  }

  const name = parsed.name as { givenName?: string; familyName?: string } | undefined;

  const userAttributes = [
    { Name: 'email', Value: email },
    { Name: 'email_verified', Value: 'true' },
  ];
  if (name?.givenName) userAttributes.push({ Name: 'given_name', Value: name.givenName });
  if (name?.familyName) userAttributes.push({ Name: 'family_name', Value: name.familyName });

  try {
    const createRes = await getCognito().send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: userAttributes,
        MessageAction: 'SUPPRESS',
      })
    );

    try {
      await getCognito().send(
        new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: email, GroupName: 'standard' })
      );
    } catch (err) {
      console.warn(`SCIM: failed to add ${email} to standard group:`, err);
    }

    // Fix #20: structured log
    console.log(JSON.stringify({ _name: 'SCIM_CREATE', email, clientName: CLIENT_NAME }));

    return { statusCode: 201, body: JSON.stringify(cognitoUserToSCIM(createRes.User!)) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UsernameExistsException')) {
      return scimError(409, 'User already exists');
    }
    console.error(JSON.stringify({ _name: 'SCIM_CREATE_ERROR', email, error: msg, clientName: CLIENT_NAME }));
    return scimError(500, `Failed to create user: ${msg}`);
  }
}

async function handleUpdateUser(userId: string, body: string): Promise<{ statusCode: number; body: string }> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return scimError(400, 'Invalid JSON');
  }

  const listRes = await getCognito().send(
    new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${userId}"`, Limit: 1 })
  );
  const user = listRes.Users?.[0];
  if (!user) return scimError(404, 'User not found');

  const username = user.Username!;
  const email = user.Attributes?.find((a) => a.Name === 'email')?.Value;
  const name = parsed.name as { givenName?: string; familyName?: string } | undefined;
  const active = parsed.active;

  const updateAttrs: Array<{ Name: string; Value: string }> = [];
  if (name?.givenName) updateAttrs.push({ Name: 'given_name', Value: name.givenName });
  if (name?.familyName) updateAttrs.push({ Name: 'family_name', Value: name.familyName });

  if (updateAttrs.length > 0) {
    await getCognito().send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: updateAttrs,
      })
    );
  }

  // Fix #4: handle both disable AND re-enable
  if (active === false) {
    await getCognito().send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    console.log(JSON.stringify({ _name: 'SCIM_DISABLE', sub: userId, email, clientName: CLIENT_NAME }));
  } else if (active === true) {
    await getCognito().send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    console.log(JSON.stringify({ _name: 'SCIM_ENABLE', sub: userId, email, clientName: CLIENT_NAME }));
  }

  const updated = await getCognito().send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  return { statusCode: 200, body: JSON.stringify(cognitoUserToSCIM(updated)) };
}

async function handleDeleteUser(userId: string): Promise<{ statusCode: number; body: string }> {
  const listRes = await getCognito().send(
    new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${userId}"`, Limit: 1 })
  );
  const user = listRes.Users?.[0];
  if (!user) return scimError(404, 'User not found');

  const email = user.Attributes?.find((a) => a.Name === 'email')?.Value;

  await getCognito().send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: user.Username! }));

  console.log(JSON.stringify({ _name: 'SCIM_DELETE', sub: userId, email, clientName: CLIENT_NAME }));

  return { statusCode: 204, body: '' };
}

function handleServiceProviderConfig(): { statusCode: number; body: string } {
  return {
    statusCode: 200,
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'Authentication scheme using the OAuth Bearer Token Standard',
        },
      ],
    }),
  };
}

function handleSchemas(): { statusCode: number; body: string } {
  return {
    statusCode: 200,
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
          id: 'urn:ietf:params:scim:schemas:core:2.0:User',
          name: 'User',
          description: 'User Account',
          attributes: [
            { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite' },
            {
              name: 'name',
              type: 'complex',
              multiValued: false,
              required: false,
              mutability: 'readWrite',
              subAttributes: [
                { name: 'givenName', type: 'string', mutability: 'readWrite' },
                { name: 'familyName', type: 'string', mutability: 'readWrite' },
              ],
            },
            { name: 'emails', type: 'complex', multiValued: true, required: true, mutability: 'readWrite' },
            { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite' },
          ],
        },
      ],
    }),
  };
}

// --- Main handler ---

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  // SCIM discovery endpoints — no auth required
  if (method === 'GET' && /\/scim\/ServiceProviderConfig\/?$/i.test(path)) {
    return { ...handleServiceProviderConfig(), headers: HEADERS };
  }
  if (method === 'GET' && /\/scim\/Schemas\/?$/i.test(path)) {
    return { ...handleSchemas(), headers: HEADERS };
  }

  // All other SCIM endpoints require bearer token auth
  if (!(await validateBearerToken(event))) {
    // Fix #20: structured auth failure log
    console.warn(JSON.stringify({ _name: 'SCIM_AUTH_FAILURE', method, path, clientName: CLIENT_NAME }));
    return { ...scimError(401, 'Invalid or missing bearer token'), headers: HEADERS };
  }

  try {
    // GET /scim/Users — list users
    if (method === 'GET' && /\/scim\/Users\/?$/.test(path)) {
      const result = await handleListUsers(event);
      return { ...result, headers: HEADERS };
    }

    // GET /scim/Users/{id} — get user
    const getUserMatch = path.match(/\/scim\/Users\/([^/]+)\/?$/);
    if (method === 'GET' && getUserMatch) {
      const result = await handleGetUser(getUserMatch[1]);
      return { ...result, headers: HEADERS };
    }

    // POST /scim/Users — create user
    if (method === 'POST' && /\/scim\/Users\/?$/.test(path)) {
      const result = await handleCreateUser(event.body || '{}');
      return { ...result, headers: HEADERS };
    }

    // PATCH or PUT /scim/Users/{id} — update user
    const updateMatch = path.match(/\/scim\/Users\/([^/]+)\/?$/);
    if ((method === 'PATCH' || method === 'PUT') && updateMatch) {
      const result = await handleUpdateUser(updateMatch[1], event.body || '{}');
      return { ...result, headers: HEADERS };
    }

    // DELETE /scim/Users/{id} — delete user
    const deleteMatch = path.match(/\/scim\/Users\/([^/]+)\/?$/);
    if (method === 'DELETE' && deleteMatch) {
      const result = await handleDeleteUser(deleteMatch[1]);
      return { ...result, headers: HEADERS };
    }

    return { ...scimError(404, 'Endpoint not found'), headers: HEADERS };
  } catch (error) {
    console.error(
      JSON.stringify({ _name: 'SCIM_ERROR', method, path, error: (error as Error).message, clientName: CLIENT_NAME })
    );
    return { ...scimError(500, 'Internal server error'), headers: HEADERS };
  }
};
