/**
 * Tests for the numa-voice-admin handler — auth surface, routing, and the
 * Connect-backed reads (status/live-transcript/usage) with a mocked SDK.
 *
 * The AWS clients are constructed at module load (withPRM does a plain
 * `new Ctor(config)`), so mocking the @aws-sdk/client-connect module with fake
 * command classes + a shared send() spy is sufficient — no network, no creds.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const sendMock = vi.fn();

type FakeCommandCtor = new (input: unknown) => { __name: string; input: unknown };

/** Fake command factory: instances carry their input + a __name discriminator. */
function mkCommand(name: string): FakeCommandCtor {
  return class {
    __name = name;
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  };
}

vi.mock('@aws-sdk/client-connect', () => ({
  ConnectClient: class {
    send = sendMock;
  },
  ListInstancesCommand: mkCommand('ListInstances'),
  ListPhoneNumbersV2Command: mkCommand('ListPhoneNumbersV2'),
  SearchAvailablePhoneNumbersCommand: mkCommand('SearchAvailablePhoneNumbers'),
  ClaimPhoneNumberCommand: mkCommand('ClaimPhoneNumber'),
  ReleasePhoneNumberCommand: mkCommand('ReleasePhoneNumber'),
  ListApprovedOriginsCommand: mkCommand('ListApprovedOrigins'),
  AssociateApprovedOriginCommand: mkCommand('AssociateApprovedOrigin'),
  DisassociateApprovedOriginCommand: mkCommand('DisassociateApprovedOrigin'),
  ListUsersCommand: mkCommand('ListUsers'),
  CreateUserCommand: mkCommand('CreateUser'),
  ListRoutingProfilesCommand: mkCommand('ListRoutingProfiles'),
  ListSecurityProfilesCommand: mkCommand('ListSecurityProfiles'),
  ListQueuesCommand: mkCommand('ListQueues'),
  DescribeQueueCommand: mkCommand('DescribeQueue'),
  DescribeRoutingProfileCommand: mkCommand('DescribeRoutingProfile'),
  UpdateQueueOutboundCallerConfigCommand: mkCommand('UpdateQueueOutboundCallerConfig'),
  DescribePhoneNumberCommand: mkCommand('DescribePhoneNumber'),
  TagResourceCommand: mkCommand('TagResource'),
  UntagResourceCommand: mkCommand('UntagResource'),
  ListTagsForResourceCommand: mkCommand('ListTagsForResource'),
  ListContactFlowsCommand: mkCommand('ListContactFlows'),
  AssociatePhoneNumberContactFlowCommand: mkCommand('AssociatePhoneNumberContactFlow'),
  GetMetricDataV2Command: mkCommand('GetMetricDataV2'),
  ListRealtimeContactAnalysisSegmentsV2Command: mkCommand('ListRealtimeContactAnalysisSegmentsV2'),
}));

// Contact Lens real-time VOICE analysis is a separate client/package; route it through
// the same shared send() spy so routeSend() handles it like the Connect commands.
vi.mock('@aws-sdk/client-connect-contact-lens', () => ({
  ConnectContactLensClient: class {
    send = sendMock;
  },
  ListRealtimeContactAnalysisSegmentsCommand: mkCommand('ListRealtimeContactAnalysisSegments'),
}));

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class {
    send = vi.fn();
  },
  AssumeRoleCommand: mkCommand('AssumeRole'),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = vi.fn();
  },
  InvokeCommand: mkCommand('Invoke'),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {
    send = vi.fn();
  },
  AdminGetUserCommand: mkCommand('AdminGetUser'),
}));

process.env.CLIENT_NAME = 'testclient';
process.env.CONNECT_REGION = 'ap-southeast-2';
process.env.FEDERATION_ROLE_ARN = 'arn:aws:iam::1:role/fed';

type Handler = (
  event: APIGatewayProxyEventV2,
  ctx?: unknown,
  cb?: unknown
) => Promise<APIGatewayProxyStructuredResultV2>;
let handler: Handler;
beforeAll(async () => {
  ({ handler } = (await import('./index')) as unknown as { handler: Handler });
});

/** Unsigned JWT with the given payload — parseJwt only base64-decodes. */
function jwt(payload: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString('base64')}.s`;
}

const ADMIN_AUTH = `Bearer ${jwt({ 'cognito:groups': ['admin'], email: 'admin@x.nz', sub: 'sub-admin' })}`;
const USER_AUTH = `Bearer ${jwt({ 'cognito:groups': [], email: 'sdr@x.nz', sub: 'sub-user' })}`;

function event(method: string, path: string, opts: { auth?: string; body?: unknown } = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method, path } },
    headers: opts.auth ? { authorization: opts.auth } : {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  } as unknown as APIGatewayProxyEventV2;
}

const body = (res: APIGatewayProxyStructuredResultV2): Record<string, unknown> =>
  JSON.parse(res.body ?? '{}') as Record<string, unknown>;

/** Route the shared send() spy by fake-command discriminator. */
function routeSend(routes: Record<string, unknown | ((input: unknown) => unknown)>): void {
  sendMock.mockImplementation((cmd: { __name: string; input: unknown }) => {
    const route = routes[cmd.__name];
    if (route === undefined) return Promise.resolve({});
    return Promise.resolve(typeof route === 'function' ? (route as (i: unknown) => unknown)(cmd.input) : route);
  });
}

const INSTANCE = {
  InstanceSummaryList: [
    { Id: 'inst-1', Arn: 'arn:aws:connect:ap-southeast-2:1:instance/inst-1', InstanceAlias: 'numa-testclient' },
  ],
};

beforeEach(() => {
  sendMock.mockReset();
});

describe('router basics', () => {
  it('answers OPTIONS without touching Connect', async () => {
    const res = await handler(event('OPTIONS', '/api/voice/admin/status'));
    expect(res.statusCode).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON bodies with 400', async () => {
    const res = await handler({
      ...event('POST', '/api/voice/mode', { auth: ADMIN_AUTH }),
      body: '{not json',
    } as APIGatewayProxyEventV2);
    expect(res.statusCode).toBe(400);
  });

  it('404s unknown routes', async () => {
    const res = await handler(event('GET', '/api/voice/nope', { auth: USER_AUTH }));
    expect(res.statusCode).toBe(404);
  });
});

describe('admin gating — mutations deny non-admins before any Connect call', () => {
  const cases: [string, string, unknown][] = [
    ['POST', '/api/voice/phone-numbers', { country: 'NZ' }],
    ['POST', '/api/voice/phone-numbers/pn-1/caller-id', {}],
    ['DELETE', '/api/voice/phone-numbers/pn-1', undefined],
    ['POST', '/api/voice/mode', { mode: 'personal' }],
    ['POST', '/api/voice/approved-origins', { origin: 'https://x' }],
    ['DELETE', '/api/voice/approved-origins', undefined],
  ];
  for (const [method, path, payload] of cases) {
    it(`${method} ${path} → 403 for a non-admin`, async () => {
      const res = await handler(event(method, path, { auth: USER_AUTH, body: payload }));
      expect(res.statusCode).toBe(403);
      expect(sendMock).not.toHaveBeenCalled();
    });
  }

  it('admin passes the gate (gets a non-403 answer)', async () => {
    routeSend({ ListInstances: { InstanceSummaryList: [] } });
    const res = await handler(event('POST', '/api/voice/mode', { auth: ADMIN_AUTH, body: { mode: 'personal' } }));
    expect(res.statusCode).not.toBe(403);
  });
});

describe('GET /voice/contacts/{id}/live-transcript (FEAT-168)', () => {
  it('rejects malformed contact ids with 400', async () => {
    const res = await handler(event('GET', '/api/voice/contacts/bad%20id%24/live-transcript', { auth: USER_AUTH }));
    expect(res.statusCode).toBe(400);
  });

  it('returns mapped CUSTOMER/AGENT segments from the real-time VOICE Contact Lens API', async () => {
    routeSend({
      ListInstances: INSTANCE,
      // The VOICE API (ListRealtimeContactAnalysisSegments) — returns Transcript items
      // (mapped to {participant,text}) and Category-only segments (skipped).
      ListRealtimeContactAnalysisSegments: {
        Segments: [
          { Transcript: { ParticipantRole: 'CUSTOMER', Content: "it's too expensive", Sentiment: 'NEGATIVE' } },
          { Transcript: { ParticipantRole: 'AGENT', Content: 'let me show the ROI' } },
          { Categories: { MatchedCategories: ['Pricing'] } },
        ],
        // No NextToken → analysis complete, single page.
      },
    });
    const res = await handler(event('GET', '/api/voice/contacts/c-123/live-transcript', { auth: USER_AUTH }));
    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({
      enabled: true,
      segments: [
        { participant: 'CUSTOMER', text: "it's too expensive" },
        { participant: 'AGENT', text: 'let me show the ROI' },
      ],
    });
    expect(
      sendMock.mock.calls.some((c) => (c[0] as { __name: string }).__name === 'ListRealtimeContactAnalysisSegments')
    ).toBe(true);
  });

  it('degrades to enabled:false (not an error) when no real-time analysis exists for the contact', async () => {
    // CL not enabled on the flow, or call ended >24h → the API throws; the sidebar must
    // fall back to its playbook, never error.
    routeSend({
      ListInstances: INSTANCE,
      ListRealtimeContactAnalysisSegments: () => {
        const err = new Error('Real-time contact analysis not found.');
        err.name = 'ResourceNotFoundException';
        throw err;
      },
    });
    const res = await handler(event('GET', '/api/voice/contacts/c-404/live-transcript', { auth: USER_AUTH }));
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({ enabled: false, segments: [] });
  });
});

describe('GET /voice/usage (FEAT-170)', () => {
  it('denies a non-admin (usage discloses every agent owner + minutes)', async () => {
    const res = await handler(event('GET', '/api/voice/usage', { auth: USER_AUTH }));
    expect(res.statusCode).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('attributes per-agent minutes to the DID each agent owns and surfaces the rest as unattributed', async () => {
    routeSend({
      ListInstances: INSTANCE,
      ListRoutingProfiles: { RoutingProfileSummaryList: [{ Id: 'rp-1', Name: 'numa-voice-routing' }] },
      GetMetricDataV2: {
        MetricResults: [
          {
            Dimensions: { AGENT: 'agent-1' },
            Collections: [
              { Metric: { Name: 'CONTACTS_HANDLED' }, Value: 4 },
              { Metric: { Name: 'SUM_CONTACT_TIME_AGENT' }, Value: 600 }, // 10 min
            ],
          },
          {
            Dimensions: { AGENT: 'agent-2' },
            Collections: [
              { Metric: { Name: 'CONTACTS_HANDLED' }, Value: 1 },
              { Metric: { Name: 'SUM_CONTACT_TIME_AGENT' }, Value: 120 }, // 2 min, owns no DID
            ],
          },
        ],
      },
      ListUsers: {
        UserSummaryList: [
          { Id: 'agent-1', Username: 'alice' },
          { Id: 'agent-2', Username: 'bob' },
        ],
      },
      ListPhoneNumbersV2: {
        ListPhoneNumbersSummaryList: [{ PhoneNumberId: 'pn-1', PhoneNumber: '+6421000001' }],
      },
      // describeNumber resolves the owner from tags via DescribePhoneNumber.
      DescribePhoneNumber: { ClaimedPhoneNumberSummary: { Tags: { 'numa-owner': 'alice' } } },
    });
    const res = await handler(event('GET', '/api/voice/usage', { auth: ADMIN_AUTH }));
    expect(res.statusCode).toBe(200);
    const usage = body(res) as {
      numbers: { number: string; owner?: string; minutes: number; contacts: number }[];
      unattributed: { minutes: number; contacts: number };
      totalMinutes: number;
    };
    expect(usage.numbers).toHaveLength(1);
    expect(usage.numbers[0]).toMatchObject({ number: '+6421000001', owner: 'alice', minutes: 10, contacts: 4 });
    expect(usage.unattributed).toMatchObject({ minutes: 2, contacts: 1 });
    expect(usage.totalMinutes).toBe(12);
  });

  it('does not double-count an agent who owns multiple DIDs (sum of rows ≤ total)', async () => {
    routeSend({
      ListInstances: INSTANCE,
      ListRoutingProfiles: { RoutingProfileSummaryList: [{ Id: 'rp-1', Name: 'numa-voice-routing' }] },
      GetMetricDataV2: {
        MetricResults: [
          {
            Dimensions: { AGENT: 'agent-1' },
            Collections: [
              { Metric: { Name: 'CONTACTS_HANDLED' }, Value: 5 },
              { Metric: { Name: 'SUM_CONTACT_TIME_AGENT' }, Value: 600 }, // 10 min
            ],
          },
        ],
      },
      ListUsers: { UserSummaryList: [{ Id: 'agent-1', Username: 'alice' }] },
      ListPhoneNumbersV2: {
        ListPhoneNumbersSummaryList: [
          { PhoneNumberId: 'pn-1', PhoneNumber: '+6421000001' },
          { PhoneNumberId: 'pn-2', PhoneNumber: '+6421000002' },
        ],
      },
      DescribePhoneNumber: { ClaimedPhoneNumberSummary: { Tags: { 'numa-owner': 'alice' } } },
    });
    const res = await handler(event('GET', '/api/voice/usage', { auth: ADMIN_AUTH }));
    const usage = body(res) as {
      numbers: { minutes: number }[];
      totalMinutes: number;
      unattributed: { minutes: number };
    };
    const rowSum = usage.numbers.reduce((s, n) => s + n.minutes, 0);
    // alice's 10 min lands on exactly ONE of her two DIDs, not both.
    expect(rowSum).toBe(10);
    expect(usage.totalMinutes).toBe(10);
    expect(usage.unattributed.minutes).toBe(0);
  });

  it('reports unconfigured tenants without erroring', async () => {
    routeSend({ ListInstances: { InstanceSummaryList: [] } });
    const res = await handler(event('GET', '/api/voice/usage', { auth: ADMIN_AUTH }));
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({ configured: false, totalMinutes: 0 });
  });

  it('returns an empty payload (no GetMetricDataV2 call) when the voice routing profile is missing', async () => {
    routeSend({ ListInstances: INSTANCE, ListRoutingProfiles: { RoutingProfileSummaryList: [] } });
    const res = await handler(event('GET', '/api/voice/usage', { auth: ADMIN_AUTH }));
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({ configured: true, totalMinutes: 0 });
    // The invalid CHANNEL-only metric query must NOT be attempted.
    expect(sendMock.mock.calls.some((c) => (c[0] as { __name: string }).__name === 'GetMetricDataV2')).toBe(false);
  });
});

describe('POST /voice/phone-numbers/{id}/owner — ownership guard', () => {
  it('lets a non-admin self-claim an AVAILABLE (unowned) DID', async () => {
    routeSend({
      ListInstances: INSTANCE,
      DescribePhoneNumber: { ClaimedPhoneNumberSummary: { PhoneNumberArn: 'arn:pn-1', Tags: {} } },
    });
    const res = await handler(event('POST', '/api/voice/phone-numbers/pn-1/owner', { auth: USER_AUTH }));
    expect(res.statusCode).toBe(200);
    expect(sendMock.mock.calls.some((c) => (c[0] as { __name: string }).__name === 'TagResource')).toBe(true);
  });

  it('blocks a non-admin from taking over a DID already owned by someone else (409, no tag write)', async () => {
    routeSend({
      ListInstances: INSTANCE,
      DescribePhoneNumber: {
        ClaimedPhoneNumberSummary: { PhoneNumberArn: 'arn:pn-1', Tags: { 'numa-owner': 'someoneelse' } },
      },
    });
    const res = await handler(event('POST', '/api/voice/phone-numbers/pn-1/owner', { auth: USER_AUTH }));
    expect(res.statusCode).toBe(409);
    expect(sendMock.mock.calls.some((c) => (c[0] as { __name: string }).__name === 'TagResource')).toBe(false);
  });

  it('lets an admin reassign an already-owned DID to another agent', async () => {
    routeSend({
      ListInstances: INSTANCE,
      DescribePhoneNumber: {
        ClaimedPhoneNumberSummary: { PhoneNumberArn: 'arn:pn-1', Tags: { 'numa-owner': 'someoneelse' } },
      },
    });
    const res = await handler(
      event('POST', '/api/voice/phone-numbers/pn-1/owner', { auth: ADMIN_AUTH, body: { owner: 'newowner' } })
    );
    expect(res.statusCode).toBe(200);
    expect(sendMock.mock.calls.some((c) => (c[0] as { __name: string }).__name === 'TagResource')).toBe(true);
  });
});

describe('GET /voice/federation-token — per-user agent provisioning (CreateUser IdentityInfo)', () => {
  // Routes that let ensureConnectUser reach CreateUser: user not found, routing +
  // security profiles resolvable. AssumeRole is on the (separate) STS mock and
  // returns nothing, so the endpoint 500s AFTER CreateUser — irrelevant here, we
  // only assert the CreateUser input shape.
  const provisioningRoutes = (identityManagementType?: string): Record<string, unknown> => ({
    ListInstances: {
      InstanceSummaryList: [
        {
          Id: 'inst-1',
          Arn: 'arn:aws:connect:ap-southeast-2:1:instance/inst-1',
          InstanceAlias: 'numa-testclient',
          ...(identityManagementType ? { IdentityManagementType: identityManagementType } : {}),
        },
      ],
    },
    ListUsers: { UserSummaryList: [] },
    ListRoutingProfiles: { RoutingProfileSummaryList: [{ Name: 'numa-voice-routing', Id: 'rp-1' }] },
    ListSecurityProfiles: { SecurityProfileSummaryList: [{ Name: 'Agent', Id: 'sp-1' }] },
    CreateUser: {},
  });

  const createUserInput = (): { IdentityInfo?: { Email?: string; FirstName?: string; LastName?: string } } => {
    const call = sendMock.mock.calls.find((c) => (c[0] as { __name: string }).__name === 'CreateUser');
    expect(call, 'expected CreateUser to be called').toBeDefined();
    return (call![0] as { input: { IdentityInfo?: { Email?: string; FirstName?: string; LastName?: string } } }).input;
  };

  it('OMITS Email from IdentityInfo on a SAML instance (Connect rejects email for SAML directories)', async () => {
    routeSend(provisioningRoutes('SAML'));
    await handler(event('GET', '/api/voice/federation-token', { auth: USER_AUTH }));
    const input = createUserInput();
    expect(input.IdentityInfo?.Email).toBeUndefined();
    // FirstName/LastName are still sent (accepted on SAML directories).
    expect(input.IdentityInfo?.FirstName).toBeTruthy();
    expect(input.IdentityInfo?.LastName).toBeTruthy();
  });

  it('INCLUDES Email in IdentityInfo on a non-SAML (Connect-managed) instance', async () => {
    routeSend(provisioningRoutes('CONNECT_MANAGED'));
    await handler(event('GET', '/api/voice/federation-token', { auth: USER_AUTH }));
    expect(createUserInput().IdentityInfo?.Email).toBe('sdr@x.nz');
  });
});
