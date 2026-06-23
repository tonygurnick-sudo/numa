/**
 * Focused tests for admin-connector-access — the admin auth gate, the vault →
 * row projection (classifySecretKey / scope parsing / active filtering), the
 * native + pipedream revoke mutations, the bulk revoke path, and last_used_at
 * hydration. AWS clients are constructed at module load via withPRM (a plain
 * `new Ctor(config)`), so mocking the SDK modules with fake command classes +
 * shared send spies keeps this hermetic — no network, no creds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const smSend = vi.fn();
const cognitoSend = vi.fn();
const lambdaSend = vi.fn();
const ddbSend = vi.fn();

type FakeCommandCtor = new (input: unknown) => { __name: string; input: unknown };
function mkCommand(name: string): FakeCommandCtor {
  return class {
    __name = name;
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  };
}

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = smSend;
  },
  GetSecretValueCommand: mkCommand('GetSecretValue'),
  PutSecretValueCommand: mkCommand('PutSecretValue'),
  ResourceNotFoundException: class extends Error {},
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {
    send = cognitoSend;
  },
  ListUsersCommand: mkCommand('ListUsers'),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = lambdaSend;
  },
  InvokeCommand: mkCommand('Invoke'),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {
    send = ddbSend;
  },
}));

// DynamoDBDocumentClient.from(client) must surface the same shared send spy so
// GetCommand reads are observable without a real document marshaller.
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: (): { send: typeof ddbSend } => ({ send: ddbSend }),
  },
  GetCommand: mkCommand('Get'),
}));

process.env.CLIENT_NAME = 'testclient';
process.env.USER_POOL_ID = 'pool-1';
process.env.PIPEDREAM_RELAY_LAMBDA_ARN = 'arn:aws:lambda:us-east-1:111111111111:function:testclient-pipedream-relay';
process.env.CONNECTOR_USAGE_TABLE = 'testclient-connector-usage';

// b64url JWT (header.payload.sig) — only the payload is decoded by the handler.
function makeToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

function event(method: string, path: string, opts: { token?: string; body?: unknown } = {}): APIGatewayProxyEventV2 {
  return {
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2;
}

const adminToken = makeToken({ sub: 'admin-sub', 'cognito:groups': ['admin'] });
const userToken = makeToken({ sub: 'user-sub', 'cognito:groups': [] });

/** Wrap a proxy `data` payload the way the relay does: { statusCode, body }. */
function relayResponse(data: unknown): { Payload: Uint8Array } {
  return {
    Payload: Buffer.from(JSON.stringify({ statusCode: 200, body: { success: true, data } })),
  };
}

/** A single Cognito user with a sub + email. */
function oneUser(sub: string, email: string): { Users: unknown[]; PaginationToken: undefined } {
  return {
    Users: [
      {
        Attributes: [
          { Name: 'sub', Value: sub },
          { Name: 'email', Value: email },
        ],
      },
    ],
    PaginationToken: undefined,
  };
}

let handler: (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
beforeEach(async () => {
  smSend.mockReset();
  cognitoSend.mockReset();
  lambdaSend.mockReset();
  ddbSend.mockReset();
  // Default: no usage rows, no pipedream connections — individual tests override.
  ddbSend.mockResolvedValue({});
  lambdaSend.mockResolvedValue(relayResponse({ connections: [] }));
  vi.resetModules();
  ({ handler } = await import('./index'));
});

describe('auth gate', () => {
  it('rejects non-admin with 403', async () => {
    const res = await handler(event('GET', '/settings/connector-access', { token: userToken }));
    expect(res.statusCode).toBe(403);
  });

  it('rejects missing token with 403', async () => {
    const res = await handler(event('GET', '/settings/connector-access'));
    expect(res.statusCode).toBe(403);
  });
});

describe('GET list', () => {
  it('projects active native authorizations and skips cleared/company entries', async () => {
    cognitoSend.mockResolvedValueOnce(oneUser('u1', 'u1@x.com'));
    smSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        secrets: {
          'oauth-googledrive': {
            fields: { access_token: 'tok', scope: 'drive.readonly drive.file', connected_at: '2026-01-01T00:00:00Z' },
          },
          'connector-synergy': { fields: { api_key: 'k' } },
          'oauth-dropbox': { fields: { access_token: '' } },
          'oauth-client-google': { fields: { client_id: 'cid' } },
        },
      }),
    });

    const res = await handler(event('GET', '/settings/connector-access', { token: adminToken }));
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.pipedreamErrors).toBe(0);
    const rows = parsed.authorizations as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const drive = rows.find((r) => r.connector === 'googledrive');
    expect(drive?.method).toBe('oauth');
    expect(drive?.scopes).toEqual(['drive.readonly', 'drive.file']);
    expect(drive?.id).toBe('u1::oauth-googledrive');
    expect(drive?.source).toBe('native');
    expect(rows.find((r) => r.connector === 'synergy')?.method).toBe('pat');
  });

  it('fans out to the relay and adds one pipedream row per connected account', async () => {
    cognitoSend.mockResolvedValueOnce(oneUser('u1', 'u1@x.com'));
    smSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ secrets: {} }) });
    lambdaSend.mockResolvedValueOnce(
      relayResponse({
        connections: [
          {
            app_name: 'slack',
            status: 'connected',
            accounts: [
              { account_id: 'apn_slack_1', name: 'a@x.com', connected_at: '2026-02-01T00:00:00Z', healthy: true },
            ],
          },
          {
            app_name: 'gmail',
            status: 'not_connected',
            accounts: [],
          },
        ],
      })
    );

    const res = await handler(event('GET', '/settings/connector-access', { token: adminToken }));
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body as string);
    const rows = parsed.authorizations as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const slack = rows[0];
    expect(slack.source).toBe('pipedream');
    expect(slack.connector).toBe('slack');
    expect(slack.accountId).toBe('apn_slack_1');
    expect(slack.scopes).toBeNull();
    expect(typeof slack.note).toBe('string');
    expect(slack.connectedAt).toBe('2026-02-01T00:00:00Z');
    // Relay was invoked with the derived external_user_id.
    const invoke = lambdaSend.mock.calls.find((c) => c[0].__name === 'Invoke');
    const payload = JSON.parse(Buffer.from(invoke![0].input.Payload).toString());
    expect(payload.operation).toBe('get_integration_status');
    expect(payload.external_user_id).toBe('testclient_u1');
  });

  it('isolates a single user relay failure and reports pipedreamErrors', async () => {
    cognitoSend.mockResolvedValueOnce({
      Users: [
        {
          Attributes: [
            { Name: 'sub', Value: 'u1' },
            { Name: 'email', Value: 'u1@x.com' },
          ],
        },
        {
          Attributes: [
            { Name: 'sub', Value: 'u2' },
            { Name: 'email', Value: 'u2@x.com' },
          ],
        },
      ],
      PaginationToken: undefined,
    });
    // Two native vault reads (one per user) — both empty.
    smSend.mockResolvedValue({ SecretString: JSON.stringify({ secrets: {} }) });
    // First user's relay call fails; second succeeds with one account.
    lambdaSend.mockResolvedValueOnce({ Payload: undefined, FunctionError: 'Unhandled' }).mockResolvedValueOnce(
      relayResponse({
        connections: [
          { app_name: 'slack', status: 'connected', accounts: [{ account_id: 'apn_2', connected_at: null }] },
        ],
      })
    );

    const res = await handler(event('GET', '/settings/connector-access', { token: adminToken }));
    const parsed = JSON.parse(res.body as string);
    expect(parsed.pipedreamErrors).toBe(1);
    const rows = parsed.authorizations as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].userSub).toBe('u2');
  });

  it('hydrates lastUsedAt from the usage table when a row exists', async () => {
    cognitoSend.mockResolvedValueOnce(oneUser('u1', 'u1@x.com'));
    smSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        secrets: { 'oauth-googledrive': { fields: { access_token: 'tok' } } },
      }),
    });
    // No pipedream connections.
    lambdaSend.mockResolvedValueOnce(relayResponse({ connections: [] }));
    // Usage read returns a lastUsedAt for the drive row.
    ddbSend.mockResolvedValue({ Item: { lastUsedAt: '2026-03-01T12:00:00Z' } });

    const res = await handler(event('GET', '/settings/connector-access', { token: adminToken }));
    const parsed = JSON.parse(res.body as string);
    const drive = (parsed.authorizations as Array<Record<string, unknown>>).find((r) => r.connector === 'googledrive');
    expect(drive?.lastUsedAt).toBe('2026-03-01T12:00:00Z');
    const getCall = ddbSend.mock.calls.find((c) => c[0].__name === 'Get');
    expect(getCall![0].input.Key).toEqual({ pk: 'USER#u1', sk: 'CONN#oauth#googledrive' });
  });

  it('leaves lastUsedAt null and never throws when the usage read errors', async () => {
    cognitoSend.mockResolvedValueOnce(oneUser('u1', 'u1@x.com'));
    smSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ secrets: { 'oauth-googledrive': { fields: { access_token: 'tok' } } } }),
    });
    lambdaSend.mockResolvedValueOnce(relayResponse({ connections: [] }));
    ddbSend.mockRejectedValue(new Error('ddb down'));

    const res = await handler(event('GET', '/settings/connector-access', { token: adminToken }));
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body as string);
    const drive = (parsed.authorizations as Array<Record<string, unknown>>)[0];
    expect(drive.lastUsedAt).toBeNull();
  });
});

describe('POST revoke (native)', () => {
  it('clears the vault entry in place and returns revoked:true', async () => {
    smSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        secrets: { 'oauth-googledrive': { fields: { access_token: 'tok', scope: 'drive' } } },
      }),
    });
    smSend.mockResolvedValueOnce({}); // PutSecretValue

    const res = await handler(
      event('POST', '/settings/connector-access/revoke', {
        token: adminToken,
        body: { userSub: 'u1', secretKey: 'oauth-googledrive' },
      })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toMatchObject({ ok: true, revoked: true });

    const putCall = smSend.mock.calls.find((c) => c[0].__name === 'PutSecretValue');
    expect(putCall).toBeDefined();
    const written = JSON.parse(putCall![0].input.SecretString);
    expect(written.secrets['oauth-googledrive'].fields.access_token).toBe('');
  });

  it('rejects a non-connector secretKey with 400', async () => {
    const res = await handler(
      event('POST', '/settings/connector-access/revoke', {
        token: adminToken,
        body: { userSub: 'u1', secretKey: 'not-a-connector' },
      })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('POST revoke (pipedream)', () => {
  it('disconnects the account via the relay and returns revoked:true', async () => {
    lambdaSend.mockResolvedValueOnce(relayResponse({ disconnected: true, deleted_account_ids: ['apn_slack_1'] }));

    const res = await handler(
      event('POST', '/settings/connector-access/revoke', {
        token: adminToken,
        body: { source: 'pipedream', userSub: 'u1', accountId: 'apn_slack_1', connector: 'slack' },
      })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toMatchObject({ ok: true, revoked: true });

    const invoke = lambdaSend.mock.calls.find((c) => c[0].__name === 'Invoke');
    const payload = JSON.parse(Buffer.from(invoke![0].input.Payload).toString());
    expect(payload.operation).toBe('disconnect_integration');
    expect(payload.external_user_id).toBe('testclient_u1');
    expect(payload.parameters.account_id).toBe('apn_slack_1');
  });

  it('requires accountId for a pipedream revoke', async () => {
    const res = await handler(
      event('POST', '/settings/connector-access/revoke', {
        token: adminToken,
        body: { source: 'pipedream', userSub: 'u1' },
      })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('POST revoke-bulk', () => {
  it('batches native revokes per user into a single vault write and fans pipedream concurrently', async () => {
    // One vault read for u1 holding two connectors, then one write.
    smSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        secrets: {
          'oauth-googledrive': { fields: { access_token: 'tok1' } },
          'connector-synergy': { fields: { api_key: 'k' } },
        },
      }),
    });
    smSend.mockResolvedValueOnce({}); // single PutSecretValue for u1
    // Pipedream disconnect for u2.
    lambdaSend.mockResolvedValueOnce(relayResponse({ disconnected: true, deleted_account_ids: ['apn_x'] }));

    const res = await handler(
      event('POST', '/settings/connector-access/revoke-bulk', {
        token: adminToken,
        body: {
          rows: [
            { source: 'native', userSub: 'u1', secretKey: 'oauth-googledrive' },
            { source: 'native', userSub: 'u1', secretKey: 'connector-synergy' },
            { source: 'pipedream', userSub: 'u2', accountId: 'apn_x', connector: 'slack' },
          ],
        },
      })
    );
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.revoked).toHaveLength(3);
    expect(parsed.failed).toHaveLength(0);

    // Exactly ONE PutSecretValue for u1's two native revokes.
    const puts = smSend.mock.calls.filter((c) => c[0].__name === 'PutSecretValue');
    expect(puts).toHaveLength(1);
    const written = JSON.parse(puts[0][0].input.SecretString);
    expect(written.secrets['oauth-googledrive'].fields.access_token).toBe('');
    expect(written.secrets['connector-synergy'].fields.api_key).toBe('');
  });

  it('records per-row failures without aborting the batch', async () => {
    // u1 vault read + write succeed for the valid native row.
    smSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ secrets: { 'oauth-googledrive': { fields: { access_token: 'tok' } } } }),
    });
    smSend.mockResolvedValueOnce({});
    // Pipedream disconnect for u2 throws (relay error) → that row fails.
    lambdaSend.mockResolvedValueOnce({ Payload: undefined, FunctionError: 'Unhandled' });

    const res = await handler(
      event('POST', '/settings/connector-access/revoke-bulk', {
        token: adminToken,
        body: {
          rows: [
            { source: 'native', userSub: 'u1', secretKey: 'oauth-googledrive' },
            { source: 'native', userSub: 'u1', secretKey: 'not-a-connector' },
            { source: 'pipedream', userSub: 'u2', accountId: 'apn_bad', connector: 'slack' },
          ],
        },
      })
    );
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.revoked).toHaveLength(1);
    expect(parsed.failed).toHaveLength(2);
    const reasons = (parsed.failed as Array<Record<string, unknown>>).map((f) => f.reason);
    expect(reasons).toContain('not_a_connector');
  });

  it('rejects an empty rows[] with 400', async () => {
    const res = await handler(
      event('POST', '/settings/connector-access/revoke-bulk', { token: adminToken, body: { rows: [] } })
    );
    expect(res.statusCode).toBe(400);
  });
});
