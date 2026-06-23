import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// BUG-172: the sharing mutation handlers must emit structured `_name` audit logs
// (AGENT_SHARE_GRANTED / UPDATED / REVOKED) carrying agentId, principalId, role and
// sharedBy. These tests drive the exported handler end-to-end with a mocked DynamoDB
// document client and assert on the emitted structured log line.

const sendMock = vi.fn();

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: (): { send: typeof sendMock } => ({ send: sendMock }),
    },
  };
});

const setupEnvAndImport = async (): Promise<typeof import('../index')> => {
  process.env.CLIENT_NAME = 'tenant-test';
  process.env.WORKSPACE_AGENTS_TABLE = 'workspace-table';
  process.env.USER_AGENTS_TABLE = 'user-table';
  process.env.OUTPUTS_BUCKET_NAME = 'outputs-bucket';
  process.env.AGENT_SHARING_TABLE = 'sharing-table';
  return await import('../index');
};

// Build an (unsigned) JWT whose payload parseJwt can base64-decode.
const makeJwt = (payload: Record<string, unknown>): string => {
  const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64');
  return `${b64({ alg: 'none' })}.${b64(payload)}.`;
};

type SharingEvent = {
  method: string;
  path: string;
  body?: string;
};

const buildEvent = ({ method, path, body }: SharingEvent): Record<string, unknown> => ({
  requestContext: { http: { method, path } },
  rawPath: path,
  headers: { authorization: `Bearer ${makeJwt({ sub: 'admin-sub-1', email: 'admin@example.com' })}` },
  body,
});

const findLog = (logSpy: ReturnType<typeof vi.spyOn>, name: string): Record<string, unknown> | undefined => {
  for (const call of logSpy.mock.calls) {
    const arg = call[0];
    if (typeof arg !== 'string') continue;
    try {
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      if (parsed._name === name) return parsed;
    } catch {
      // non-JSON log line; ignore
    }
  }
  return undefined;
};

describe('agent sharing audit logging (BUG-172)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('emits AGENT_SHARE_GRANTED on share create', async () => {
    const module = await setupEnvAndImport();
    // settings 'policy' read (full mode) then the PutCommand for the share
    sendMock.mockResolvedValueOnce({ Item: { mode: 'full' } });
    sendMock.mockResolvedValueOnce({});

    const res = await module.handler(
      buildEvent({
        method: 'POST',
        path: '/agents/agent-1/sharing',
        body: JSON.stringify({ principalId: 'user-9', principalType: 'user', role: 'editor' }),
      }) as never,
      {} as never,
      {} as never
    );

    expect((res as { statusCode: number }).statusCode).toBe(201);
    const log = findLog(logSpy, 'AGENT_SHARE_GRANTED');
    expect(log).toMatchObject({
      _name: 'AGENT_SHARE_GRANTED',
      agentId: 'agent-1',
      principalId: 'user-9',
      role: 'editor',
      sharedBy: 'admin-sub-1',
      clientName: 'tenant-test',
    });
  });

  it('emits AGENT_SHARE_REVOKED on share delete', async () => {
    const module = await setupEnvAndImport();
    sendMock.mockResolvedValueOnce({ Item: { mode: 'full' } });
    sendMock.mockResolvedValueOnce({});

    const res = await module.handler(
      buildEvent({ method: 'DELETE', path: '/agents/agent-1/sharing/user-9' }) as never,
      {} as never,
      {} as never
    );

    expect((res as { statusCode: number }).statusCode).toBe(200);
    const log = findLog(logSpy, 'AGENT_SHARE_REVOKED');
    expect(log).toMatchObject({
      _name: 'AGENT_SHARE_REVOKED',
      agentId: 'agent-1',
      principalId: 'user-9',
      sharedBy: 'admin-sub-1',
      clientName: 'tenant-test',
    });
  });
});
