/**
 * Focused tests for admin-connector-access — the admin auth gate, the vault →
 * row projection (classifySecretKey / scope parsing / active filtering), and
 * the revoke mutation. AWS clients are constructed at module load via withPRM
 * (a plain `new Ctor(config)`), so mocking the SDK modules with fake command
 * classes + shared send spies keeps this hermetic — no network, no creds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const smSend = vi.fn();
const cognitoSend = vi.fn();

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

process.env.CLIENT_NAME = 'testclient';
process.env.USER_POOL_ID = 'pool-1';

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

let handler: (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
beforeEach(async () => {
  smSend.mockReset();
  cognitoSend.mockReset();
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
    cognitoSend.mockResolvedValueOnce({
      Users: [
        {
          Attributes: [
            { Name: 'sub', Value: 'u1' },
            { Name: 'email', Value: 'u1@x.com' },
          ],
        },
      ],
      PaginationToken: undefined,
    });
    smSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        secrets: {
          // Active OAuth connector → one row, scopes split.
          'oauth-googledrive': {
            fields: { access_token: 'tok', scope: 'drive.readonly drive.file', connected_at: '2026-01-01T00:00:00Z' },
          },
          // Active PAT connector → one row.
          'connector-synergy': { fields: { api_key: 'k' } },
          // Revoked (no token) → skipped.
          'oauth-dropbox': { fields: { access_token: '' } },
          // Company OAuth client creds → never a user authorization.
          'oauth-client-google': { fields: { client_id: 'cid' } },
        },
      }),
    });

    const res = await handler(event('GET', '/settings/connector-access', { token: adminToken }));
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.pipedreamDeferred).toBe(true);
    const rows = parsed.authorizations as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const drive = rows.find((r) => r.connector === 'googledrive');
    expect(drive?.method).toBe('oauth');
    expect(drive?.scopes).toEqual(['drive.readonly', 'drive.file']);
    expect(drive?.id).toBe('u1::oauth-googledrive');
    expect(rows.find((r) => r.connector === 'synergy')?.method).toBe('pat');
  });
});

describe('POST revoke', () => {
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

  it('defers pipedream revoke with 400', async () => {
    const res = await handler(
      event('POST', '/settings/connector-access/revoke', {
        token: adminToken,
        body: { userSub: 'u1', secretKey: 'oauth-gmail', source: 'pipedream' },
      })
    );
    expect(res.statusCode).toBe(400);
  });
});
