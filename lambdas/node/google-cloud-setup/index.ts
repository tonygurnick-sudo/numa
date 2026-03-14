import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  SecretsManagerClient,
  PutSecretValueCommand,
  CreateSecretCommand,
  DescribeSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { withPRM } from '../../../lib/prm-node/prm';

const CLIENT_NAME = process.env.CLIENT_NAME as string;
const WEBHOOK_URL = process.env.WEBHOOK_URL as string;
const DATA_CONNECTORS_TABLE_NAME = process.env.DATA_CONNECTORS_TABLE_NAME as string;

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));
const secretsManager = withPRM(SecretsManagerClient, {});

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

const GOOGLE_APIS_TO_ENABLE = ['gmail.googleapis.com', 'drive.googleapis.com', 'pubsub.googleapis.com'];

// ---------------------------------------------------------------------------
// JWT / Auth helpers
// ---------------------------------------------------------------------------

function parseJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function isAdmin(event: APIGatewayProxyEventV2): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token) || {};
  const groups = (claims['cognito:groups'] as string[]) || [];
  return groups.includes('admin');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(body: unknown) {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(body) };
}

function fail(statusCode: number, error: string) {
  return { statusCode, headers: HEADERS, body: JSON.stringify({ error }) };
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
}

async function googleFetch(url: string, googleToken: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${googleToken}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Route: POST /api/admin/google-cloud/validate-project
// ---------------------------------------------------------------------------

async function validateProject(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const googleToken = body.googleToken as string;
  const projectId = body.projectId as string;

  if (!googleToken || !projectId) {
    return fail(400, 'googleToken and projectId are required');
  }

  const res = await googleFetch(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`,
    googleToken
  );

  if (!res.ok) {
    const errorBody = await res.text();
    console.error('validate-project error', res.status, errorBody);
    return fail(res.status, `Failed to validate project: ${errorBody}`);
  }

  const project = (await res.json()) as Record<string, unknown>;
  return ok({
    projectId: project.projectId,
    name: project.name,
    projectNumber: project.projectNumber,
    lifecycleState: project.lifecycleState,
  });
}

// ---------------------------------------------------------------------------
// Route: POST /api/admin/google-cloud/enable-apis
// ---------------------------------------------------------------------------

async function enableApis(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const googleToken = body.googleToken as string;
  const projectId = body.projectId as string;

  if (!googleToken || !projectId) {
    return fail(400, 'googleToken and projectId are required');
  }

  const results: Array<{ api: string; status: string; error?: string }> = [];

  for (const api of GOOGLE_APIS_TO_ENABLE) {
    try {
      const res = await googleFetch(
        `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services/${api}:enable`,
        googleToken,
        { method: 'POST' }
      );

      if (res.ok) {
        results.push({ api, status: 'enabled' });
      } else {
        const errorBody = await res.text();
        console.error(`enable-api ${api} error`, res.status, errorBody);
        results.push({ api, status: 'error', error: errorBody });
      }
    } catch (err) {
      console.error(`enable-api ${api} exception`, err);
      results.push({ api, status: 'error', error: String(err) });
    }
  }

  return ok({ results });
}

// ---------------------------------------------------------------------------
// Route: POST /api/admin/google-cloud/create-oauth-client
// ---------------------------------------------------------------------------

async function createOAuthClient(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const googleToken = body.googleToken as string;
  const projectId = body.projectId as string;
  const redirectUri = (body.redirectUri as string) || '';

  if (!googleToken || !projectId) {
    return fail(400, 'googleToken and projectId are required');
  }

  // Step 1: Configure or update the OAuth consent screen (branding)
  const consentPayload = {
    application_title: `Numa - ${CLIENT_NAME}`,
    support_email: 'support@arcanum.ai',
  };

  const consentRes = await googleFetch(
    `https://oauth2.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/brands`,
    googleToken,
    { method: 'POST', body: JSON.stringify(consentPayload) }
  );

  // Consent screen may already exist (409) - that is fine
  if (!consentRes.ok && consentRes.status !== 409) {
    const errorBody = await consentRes.text();
    console.warn('consent-screen warning', consentRes.status, errorBody);
    // Continue anyway - consent screen may have been set up manually
  }

  // Step 2: Create OAuth 2.0 client
  const clientPayload: Record<string, unknown> = {
    display_name: `numa-connector-${CLIENT_NAME}`,
    allowed_grant_types: ['authorization_code', 'refresh_token'],
  };

  if (redirectUri) {
    clientPayload.redirect_uris = [redirectUri];
  }

  const clientRes = await googleFetch(
    `https://oauth2.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/oauthClients`,
    googleToken,
    { method: 'POST', body: JSON.stringify(clientPayload) }
  );

  if (!clientRes.ok) {
    const errorBody = await clientRes.text();
    console.error('create-oauth-client error', clientRes.status, errorBody);
    return fail(clientRes.status, `Failed to create OAuth client: ${errorBody}`);
  }

  const oauthClient = (await clientRes.json()) as Record<string, unknown>;
  const clientId = (oauthClient.client_id as string) || (oauthClient.name as string);
  const clientSecret = (oauthClient.client_secret as string) || '';

  // Step 3: Store credentials in Secrets Manager
  const secretName = `${CLIENT_NAME}/oauth-client/google`;
  const secretValue = JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    project_id: projectId,
    created_at: new Date().toISOString(),
  });

  try {
    // Try to update existing secret first
    await secretsManager.send(new DescribeSecretCommand({ SecretId: secretName }));
    await secretsManager.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretValue,
      })
    );
  } catch {
    // Secret doesn't exist yet, create it
    try {
      await secretsManager.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: secretValue,
          Description: `Google OAuth client credentials for ${CLIENT_NAME}`,
        })
      );
    } catch (createErr) {
      console.error('secrets-manager create error', createErr);
      return fail(500, 'Failed to store OAuth credentials in Secrets Manager');
    }
  }

  // Step 4: Update connector status in DynamoDB
  if (DATA_CONNECTORS_TABLE_NAME) {
    try {
      await ddbDoc.send(
        new UpdateCommand({
          TableName: DATA_CONNECTORS_TABLE_NAME,
          Key: { connector: 'google-cloud' },
          UpdateExpression: 'SET oauthConfigured = :v, updatedAt = :t',
          ExpressionAttributeValues: {
            ':v': true,
            ':t': new Date().toISOString(),
          },
        })
      );
    } catch (err) {
      console.warn('dynamo update warning', err);
    }
  }

  return ok({
    clientId,
    projectId,
    stored: true,
  });
}

// ---------------------------------------------------------------------------
// Route: POST /api/admin/google-cloud/setup-pubsub
// ---------------------------------------------------------------------------

async function setupPubSub(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const googleToken = body.googleToken as string;
  const projectId = body.projectId as string;

  if (!googleToken || !projectId) {
    return fail(400, 'googleToken and projectId are required');
  }

  const topicName = `projects/${projectId}/topics/numa-connector-events`;
  const subscriptionName = `projects/${projectId}/subscriptions/numa-connector-events-push`;

  // Step 1: Create topic (idempotent - 409 means already exists)
  const topicRes = await googleFetch(`https://pubsub.googleapis.com/v1/${topicName}`, googleToken, {
    method: 'PUT',
    body: JSON.stringify({}),
  });

  if (!topicRes.ok && topicRes.status !== 409) {
    const errorBody = await topicRes.text();
    console.error('create-topic error', topicRes.status, errorBody);
    return fail(topicRes.status, `Failed to create Pub/Sub topic: ${errorBody}`);
  }

  // Step 2: Create push subscription pointing to the webhook URL
  const subscriptionPayload = {
    topic: topicName,
    pushConfig: {
      pushEndpoint: WEBHOOK_URL,
    },
    ackDeadlineSeconds: 30,
    messageRetentionDuration: '604800s', // 7 days
    retryPolicy: {
      minimumBackoff: '10s',
      maximumBackoff: '600s',
    },
  };

  const subRes = await googleFetch(`https://pubsub.googleapis.com/v1/${subscriptionName}`, googleToken, {
    method: 'PUT',
    body: JSON.stringify(subscriptionPayload),
  });

  if (!subRes.ok && subRes.status !== 409) {
    const errorBody = await subRes.text();
    console.error('create-subscription error', subRes.status, errorBody);
    return fail(subRes.status, `Failed to create Pub/Sub subscription: ${errorBody}`);
  }

  // Step 3: Grant Gmail permission to publish to the topic
  // Gmail service account: gmail-api-push@system.gserviceaccount.com
  const iamPayload = {
    policy: {
      bindings: [
        {
          role: 'roles/pubsub.publisher',
          members: ['serviceAccount:gmail-api-push@system.gserviceaccount.com'],
        },
      ],
    },
  };

  const iamRes = await googleFetch(`https://pubsub.googleapis.com/v1/${topicName}:setIamPolicy`, googleToken, {
    method: 'POST',
    body: JSON.stringify(iamPayload),
  });

  if (!iamRes.ok) {
    const errorBody = await iamRes.text();
    console.warn('set-iam-policy warning', iamRes.status, errorBody);
    // Non-fatal - topic and subscription are created, IAM can be retried
  }

  // Step 4: Update connector status in DynamoDB
  if (DATA_CONNECTORS_TABLE_NAME) {
    try {
      await ddbDoc.send(
        new UpdateCommand({
          TableName: DATA_CONNECTORS_TABLE_NAME,
          Key: { connector: 'google-cloud' },
          UpdateExpression: 'SET pubsubConfigured = :v, pubsubTopic = :t, pubsubSubscription = :s, updatedAt = :ts',
          ExpressionAttributeValues: {
            ':v': true,
            ':t': topicName,
            ':s': subscriptionName,
            ':ts': new Date().toISOString(),
          },
        })
      );
    } catch (err) {
      console.warn('dynamo update warning', err);
    }
  }

  return ok({
    topic: topicName,
    subscription: subscriptionName,
    webhookUrl: WEBHOOK_URL,
    iamConfigured: iamRes.ok,
  });
}

// ---------------------------------------------------------------------------
// Route: GET /api/admin/google-cloud/status
// ---------------------------------------------------------------------------

async function getStatus(event: APIGatewayProxyEventV2) {
  const googleToken = event.queryStringParameters?.googleToken;

  if (!googleToken) {
    return fail(400, 'googleToken query parameter is required');
  }

  // We need a projectId to check status - read from query params or Secrets Manager
  const projectId = event.queryStringParameters?.projectId;
  if (!projectId) {
    return fail(400, 'projectId query parameter is required');
  }

  // Check API enablement status
  const apisEnabled: Array<{ api: string; enabled: boolean }> = [];
  for (const api of GOOGLE_APIS_TO_ENABLE) {
    try {
      const res = await googleFetch(
        `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services/${api}`,
        googleToken
      );

      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        apisEnabled.push({ api, enabled: data.state === 'ENABLED' });
      } else {
        apisEnabled.push({ api, enabled: false });
      }
    } catch {
      apisEnabled.push({ api, enabled: false });
    }
  }

  // Check OAuth client configuration (check Secrets Manager)
  let oauthConfigured = false;
  try {
    const secretName = `${CLIENT_NAME}/oauth-client/google`;
    await secretsManager.send(new DescribeSecretCommand({ SecretId: secretName }));
    oauthConfigured = true;
  } catch {
    oauthConfigured = false;
  }

  // Check Pub/Sub configuration
  let pubsubConfigured = false;
  try {
    const topicName = `projects/${projectId}/topics/numa-connector-events`;
    const topicRes = await googleFetch(`https://pubsub.googleapis.com/v1/${topicName}`, googleToken);
    pubsubConfigured = topicRes.ok;
  } catch {
    pubsubConfigured = false;
  }

  return ok({
    apisEnabled,
    oauthConfigured,
    pubsubConfigured,
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    if (!CLIENT_NAME) {
      return fail(500, 'Server configuration error: CLIENT_NAME not set');
    }

    // All routes require admin
    if (!isAdmin(event)) {
      return fail(403, 'Forbidden: admin access required');
    }

    // POST /api/admin/google-cloud/validate-project
    if (method === 'POST' && /\/google-cloud\/validate-project\/?$/.test(path)) {
      return validateProject(event);
    }

    // POST /api/admin/google-cloud/enable-apis
    if (method === 'POST' && /\/google-cloud\/enable-apis\/?$/.test(path)) {
      return enableApis(event);
    }

    // POST /api/admin/google-cloud/create-oauth-client
    if (method === 'POST' && /\/google-cloud\/create-oauth-client\/?$/.test(path)) {
      return createOAuthClient(event);
    }

    // POST /api/admin/google-cloud/setup-pubsub
    if (method === 'POST' && /\/google-cloud\/setup-pubsub\/?$/.test(path)) {
      return setupPubSub(event);
    }

    // GET /api/admin/google-cloud/status
    if (method === 'GET' && /\/google-cloud\/status\/?$/.test(path)) {
      return getStatus(event);
    }

    return fail(404, 'Not found');
  } catch (err) {
    console.error('google-cloud-setup error', err);
    return fail(500, 'Internal Server Error');
  }
};
