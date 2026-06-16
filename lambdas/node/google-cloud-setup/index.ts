import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withPRM } from '../../../lib/prm-node/prm';

const CLIENT_NAME = process.env.CLIENT_NAME as string;
const WEBHOOK_URL = process.env.WEBHOOK_URL as string;
const DATA_CONNECTORS_SETTINGS_TABLE_NAME = process.env.DATA_CONNECTORS_SETTINGS_TABLE_NAME as string;
const VAULT_SECRETS_PREFIX = process.env.VAULT_SECRETS_PREFIX || `${CLIENT_NAME}/vault`;
// Optional: the gmail-watch-manager function, invoked by configure-triggers to
// register watches for already-connected mailboxes. New connects self-register.
const WATCH_MANAGER_FUNCTION_NAME = process.env.WATCH_MANAGER_FUNCTION_NAME as string | undefined;

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));
const secretsManager = withPRM(SecretsManagerClient, {});
const lambdaClient = withPRM(LambdaClient, {});

// Gmail's well-known push service account — must be granted Pub/Sub Publisher on
// the customer's topic so users.watch() can publish. Same for every project.
const GMAIL_PUBLISHER_SERVICE_ACCOUNT = 'gmail-api-push@system.gserviceaccount.com';
const DEFAULT_TOPIC_NAME = 'numa-connector-events';
const DEFAULT_SUBSCRIPTION_NAME = 'numa-connector-events-push';
// Light validation so user input can't inject into the GCP resource path.
const GCP_PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const GCP_RESOURCE_NAME_RE = /^[A-Za-z][A-Za-z0-9._~%+-]{2,254}$/;

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

// ---------------------------------------------------------------------------
// Consolidated vault helpers
// ---------------------------------------------------------------------------

interface VaultEntry {
  id?: string;
  name?: string;
  fields: Record<string, string>;
  metadata?: Record<string, string>;
}

interface VaultData {
  secrets?: Record<string, VaultEntry>;
  _compressed?: boolean;
  _data?: string;
}

async function getConsolidatedVault(): Promise<VaultData | null> {
  const vaultSecretName = `${VAULT_SECRETS_PREFIX}/company`;
  try {
    const result = await secretsManager.send(new GetSecretValueCommand({ SecretId: vaultSecretName }));
    if (!result.SecretString) return null;

    let vaultData = JSON.parse(result.SecretString) as VaultData;

    if (vaultData._compressed && vaultData._data) {
      const { gunzipSync } = await import('zlib');
      const decompressed = gunzipSync(Buffer.from(vaultData._data, 'base64')).toString('utf-8');
      vaultData = JSON.parse(decompressed) as VaultData;
    }

    return vaultData;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ResourceNotFoundException') {
      return null;
    }
    console.error('Failed to read consolidated vault:', err);
    return null;
  }
}

async function putConsolidatedVault(vaultData: VaultData): Promise<boolean> {
  const vaultSecretName = `${VAULT_SECRETS_PREFIX}/company`;
  try {
    await secretsManager.send(
      new PutSecretValueCommand({
        SecretId: vaultSecretName,
        SecretString: JSON.stringify(vaultData),
      })
    );
    return true;
  } catch (err) {
    console.error('Failed to write consolidated vault:', err);
    return false;
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

/**
 * Parse a Google API error response body into a structured object.
 * Returns a user-friendly errorCode so the frontend can show targeted guidance.
 */
function parseGoogleError(status: number, body: string): { message: string; errorCode: string; details?: string } {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
    };
    const msg = parsed.error?.message || body;
    const reason = parsed.error?.errors?.[0]?.reason || '';

    if (msg.includes('has not been used in project') || msg.includes('is disabled')) {
      // Extract the API name from the message if possible
      const apiMatch = msg.match(/(\S+\.googleapis\.com)/);
      return {
        errorCode: 'API_NOT_ENABLED',
        message: apiMatch
          ? `The ${apiMatch[1]} API is not enabled in your Google Cloud project.`
          : 'A required API is not enabled in your Google Cloud project.',
        details: msg,
      };
    }

    if (
      status === 403 &&
      (reason === 'forbidden' || reason === 'insufficientPermissions' || msg.includes('does not have'))
    ) {
      return {
        errorCode: 'PERMISSION_DENIED',
        message: 'Your Google account does not have permission to perform this action.',
        details: msg,
      };
    }

    if (status === 401 || msg.includes('Invalid Credentials') || msg.includes('token')) {
      return {
        errorCode: 'AUTH_EXPIRED',
        message: 'Your Google sign-in has expired.',
        details: msg,
      };
    }

    return { errorCode: 'UNKNOWN', message: msg, details: body };
  } catch {
    return { errorCode: 'UNKNOWN', message: body, details: body };
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/admin/google-cloud/list-projects
// ---------------------------------------------------------------------------

async function listProjects(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const googleToken = body.googleToken as string;

  if (!googleToken) {
    return fail(400, 'googleToken is required');
  }

  try {
    const res = await googleFetch(
      'https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=100',
      googleToken
    );

    if (!res.ok) {
      const errorBody = await res.text();
      console.error('list-projects error', res.status, errorBody);
      const parsed = parseGoogleError(res.status, errorBody);
      return {
        statusCode: res.status,
        headers: HEADERS,
        body: JSON.stringify({ error: parsed.message, errorCode: parsed.errorCode, details: parsed.details }),
      };
    }

    const data = (await res.json()) as { projects?: Array<Record<string, unknown>> };
    const projects = (data.projects || []).map((p) => ({
      projectId: p.projectId,
      name: p.name,
      projectNumber: p.projectNumber,
    }));

    return ok({ projects });
  } catch (err) {
    console.error('list-projects exception', err);
    return fail(500, 'Failed to list GCP projects');
  }
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
        const parsed = parseGoogleError(res.status, errorBody);
        results.push({
          api,
          status: 'error',
          error: parsed.message,
          errorCode: parsed.errorCode,
        } as (typeof results)[number]);
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

  // Step 3: Store credentials in the consolidated company vault
  const vault = (await getConsolidatedVault()) || { secrets: {} };
  if (!vault.secrets) vault.secrets = {};

  const now = new Date().toISOString();
  vault.secrets['oauth-client-google'] = {
    id: vault.secrets['oauth-client-google']?.id || crypto.randomUUID(),
    name: 'Google',
    fields: {
      client_id: clientId,
      client_secret: clientSecret,
      project_id: projectId,
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_url: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly',
      extra_auth_params: '{"access_type":"offline","prompt":"consent"}',
    },
    metadata: {
      category: 'OAuth Credentials',
      type: 'oauth_client',
      description: 'Google OAuth client for Gmail and Drive connectors',
      created_at: vault.secrets['oauth-client-google']?.metadata?.created_at || now,
      updated_at: now,
    },
  };

  const stored = await putConsolidatedVault(vault);
  if (!stored) {
    return fail(500, 'Failed to store OAuth credentials in vault');
  }

  // Step 4: Update connector status in DynamoDB (global settings table)
  if (DATA_CONNECTORS_SETTINGS_TABLE_NAME) {
    try {
      await ddbDoc.send(
        new UpdateCommand({
          TableName: DATA_CONNECTORS_SETTINGS_TABLE_NAME,
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
    const parsed = parseGoogleError(topicRes.status, errorBody);
    return {
      statusCode: topicRes.status,
      headers: HEADERS,
      body: JSON.stringify({ error: parsed.message, errorCode: parsed.errorCode, details: parsed.details }),
    };
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
    const parsed = parseGoogleError(subRes.status, errorBody);
    return {
      statusCode: subRes.status,
      headers: HEADERS,
      body: JSON.stringify({ error: parsed.message, errorCode: parsed.errorCode, details: parsed.details }),
    };
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

  // Step 4: Update connector status in DynamoDB (global settings table)
  if (DATA_CONNECTORS_SETTINGS_TABLE_NAME) {
    try {
      await ddbDoc.send(
        new UpdateCommand({
          TableName: DATA_CONNECTORS_SETTINGS_TABLE_NAME,
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

  // Check OAuth client configuration (check consolidated vault)
  let oauthConfigured = false;
  try {
    const vault = await getConsolidatedVault();
    oauthConfigured = !!vault?.secrets?.['oauth-client-google']?.fields?.client_id;
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
// Route: GET /api/admin/google-cloud/client-id
// ---------------------------------------------------------------------------

async function getClientId() {
  try {
    const vault = await getConsolidatedVault();
    const entry = vault?.secrets?.['oauth-client-google'];
    const clientId = entry?.fields?.client_id || null;
    return ok({ clientId });
  } catch (err) {
    console.error('get-client-id error', err);
    return fail(500, 'Failed to read OAuth client configuration');
  }
}

// ---------------------------------------------------------------------------
// Route: GET /api/admin/google-cloud/trigger-info
// ---------------------------------------------------------------------------
//
// Token-free. Returns the environment-specific values an admin needs to wire up
// Gmail event triggers in their OWN Google Cloud project (push endpoint, Gmail
// publisher service account, default resource names) plus the current config
// status read straight from the connector-settings row. The admin performs the
// GCP steps themselves — unlike setup-pubsub, this never touches their cloud.

async function getTriggerInfo() {
  let configured = false;
  let pubsubTopic: string | null = null;
  let pubsubSubscription: string | null = null;
  try {
    const res = await ddbDoc.send(
      new GetCommand({
        TableName: DATA_CONNECTORS_SETTINGS_TABLE_NAME,
        Key: { connector: 'google-cloud' },
      })
    );
    pubsubTopic = (res.Item?.pubsubTopic as string | undefined) ?? null;
    pubsubSubscription = (res.Item?.pubsubSubscription as string | undefined) ?? null;
    configured = !!res.Item?.pubsubConfigured && !!pubsubTopic;
  } catch (err) {
    console.error('trigger-info settings lookup failed:', err);
  }

  return ok({
    webhookUrl: WEBHOOK_URL,
    publisherServiceAccount: GMAIL_PUBLISHER_SERVICE_ACCOUNT,
    defaultTopicName: DEFAULT_TOPIC_NAME,
    defaultSubscriptionName: DEFAULT_SUBSCRIPTION_NAME,
    configured,
    pubsubTopic,
    pubsubSubscription,
  });
}

// ---------------------------------------------------------------------------
// Route: POST /api/admin/google-cloud/configure-triggers
// ---------------------------------------------------------------------------
//
// Token-free. The admin has already created the Pub/Sub topic + push
// subscription in their own GCP project (following the trigger-info
// instructions). Here we only do the two Numa-side steps:
//   1. Persist the topic/subscription on the connector-settings row so the
//      watch lambdas know where to publish.
//   2. Register Gmail watches for already-connected mailboxes by invoking
//      gmail-watch-manager (new connections self-register on connect).

async function configureTriggers(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const projectId = String(body.projectId || '').trim();
  const topicName = String(body.topicName || DEFAULT_TOPIC_NAME).trim();
  const subscriptionName = String(body.subscriptionName || DEFAULT_SUBSCRIPTION_NAME).trim();

  if (!projectId) return fail(400, 'projectId is required');
  if (!GCP_PROJECT_RE.test(projectId)) return fail(400, 'projectId is not a valid Google Cloud project ID');
  if (!GCP_RESOURCE_NAME_RE.test(topicName)) return fail(400, 'topicName is not a valid Pub/Sub topic name');
  if (!GCP_RESOURCE_NAME_RE.test(subscriptionName)) {
    return fail(400, 'subscriptionName is not a valid Pub/Sub subscription name');
  }

  const pubsubTopic = `projects/${projectId}/topics/${topicName}`;
  const pubsubSubscription = `projects/${projectId}/subscriptions/${subscriptionName}`;

  // 1. Persist on the connector-settings row (watch lambdas read pubsubTopic from here).
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: DATA_CONNECTORS_SETTINGS_TABLE_NAME,
        Key: { connector: 'google-cloud' },
        UpdateExpression: 'SET pubsubConfigured = :v, pubsubTopic = :t, pubsubSubscription = :s, updatedAt = :ts',
        ExpressionAttributeValues: {
          ':v': true,
          ':t': pubsubTopic,
          ':s': pubsubSubscription,
          ':ts': new Date().toISOString(),
        },
      })
    );
  } catch (err) {
    console.error('configure-triggers settings write failed:', err);
    return fail(500, 'Failed to save trigger configuration');
  }

  // 2. Register watches for already-connected mailboxes (best-effort — a failure
  //    here doesn't undo the config; users can reconnect Gmail to self-register).
  let watchesRegistered = 0;
  let watchesFailed = 0;
  let watchError: string | undefined;
  if (WATCH_MANAGER_FUNCTION_NAME) {
    try {
      const invokeRes = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: WATCH_MANAGER_FUNCTION_NAME,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from('{}'),
        })
      );
      const payloadStr = invokeRes.Payload ? Buffer.from(invokeRes.Payload).toString('utf-8') : '{}';
      const result = JSON.parse(payloadStr) as { renewed?: number; failed?: number };
      watchesRegistered = result.renewed ?? 0;
      watchesFailed = result.failed ?? 0;
    } catch (err) {
      console.error('configure-triggers watch-manager invoke failed:', err);
      watchError =
        'Configuration saved, but registering existing mailbox watches failed. Users can reconnect Gmail to register.';
    }
  }

  return ok({
    pubsubConfigured: true,
    pubsubTopic,
    pubsubSubscription,
    watchesRegistered,
    watchesFailed,
    ...(watchError ? { watchError } : {}),
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

    // POST /api/admin/google-cloud/list-projects
    if (method === 'POST' && /\/google-cloud\/list-projects\/?$/.test(path)) {
      return listProjects(event);
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

    // GET /api/admin/google-cloud/client-id
    if (method === 'GET' && /\/google-cloud\/client-id\/?$/.test(path)) {
      return getClientId();
    }

    // GET /api/admin/google-cloud/status
    if (method === 'GET' && /\/google-cloud\/status\/?$/.test(path)) {
      return getStatus(event);
    }

    // GET /api/admin/google-cloud/trigger-info (token-free)
    if (method === 'GET' && /\/google-cloud\/trigger-info\/?$/.test(path)) {
      return getTriggerInfo();
    }

    // POST /api/admin/google-cloud/configure-triggers (token-free)
    if (method === 'POST' && /\/google-cloud\/configure-triggers\/?$/.test(path)) {
      return configureTriggers(event);
    }

    return fail(404, 'Not found');
  } catch (err) {
    console.error('google-cloud-setup error', err);
    return fail(500, 'Internal Server Error');
  }
};
