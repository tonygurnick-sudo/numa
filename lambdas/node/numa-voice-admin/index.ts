import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  ConnectClient,
  ListInstancesCommand,
  ListPhoneNumbersV2Command,
  SearchAvailablePhoneNumbersCommand,
  ClaimPhoneNumberCommand,
  ReleasePhoneNumberCommand,
  ListApprovedOriginsCommand,
  AssociateApprovedOriginCommand,
  DisassociateApprovedOriginCommand,
  ListUsersCommand,
  CreateUserCommand,
  DescribeUserCommand,
  UpdateUserIdentityInfoCommand,
  ListRoutingProfilesCommand,
  ListSecurityProfilesCommand,
  ListQueuesCommand,
  DescribeQueueCommand,
  DescribeRoutingProfileCommand,
  UpdateQueueOutboundCallerConfigCommand,
  DescribePhoneNumberCommand,
  TagResourceCommand,
  UntagResourceCommand,
  ListTagsForResourceCommand,
  ListContactFlowsCommand,
  AssociatePhoneNumberContactFlowCommand,
} from '@aws-sdk/client-connect';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand as CognitoListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createHash } from 'node:crypto';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * numa-voice-admin — admin API for the Numa Voice / Amazon Connect surface.
 *
 * Backs the Voice Admin panel: phone numbers (list/claim/release + caller-id),
 * agent + Approved Origins, and instance status.
 *
 * Runs in the CLIENT region (API Gateway), talks to Connect in CONNECT_REGION.
 * Reads are open to authenticated users; mutations require the admin group.
 */

const CONNECT_REGION = process.env.CONNECT_REGION || 'ap-southeast-2';
const CLIENT_NAME = process.env.CLIENT_NAME || '';
const ENV_SUFFIX = process.env.ENV_SUFFIX || '';
const APPROVED_ORIGIN = process.env.APPROVED_ORIGIN || '';
const FEDERATION_ROLE_ARN = process.env.FEDERATION_ROLE_ARN || '';
const AGENT_USERNAME = process.env.AGENT_USERNAME || 'numa-voice-agent';
// Shared routing profile every Numa Voice agent (shared or per-user) sits on; its
// default outbound queue carries the caller-ID DID. The stable anchor for queue
// resolution — there's no single shared agent to look up under per-user federation.
const VOICE_ROUTING_PROFILE = 'numa-voice-routing';
// Per-DID ownership + tenant inbound mode (see numa-voice-router). A DID tagged with an
// owner rings only that agent in `personal` mode; otherwise calls go to the team queue.
const OWNER_TAG = 'numa-owner';
const MODE_TAG = 'numa-voice-mode';
const INBOUND_FLOW_NAME = 'numa-voice-inbound';
type VoiceMode = 'personal' | 'shared';
// FEAT-169 config write-back (STS-proof relay -> deployer numa-client-config).
const VOICE_CONFIG_WRITER_LAMBDA_ARN = process.env.VOICE_CONFIG_WRITER_LAMBDA_ARN || '';
const RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET || '';
const CONNECT_INSTANCE_URL = process.env.CONNECT_INSTANCE_URL || '';
// Cognito pool (CLIENT region = this Lambda's region) — used to resolve a Connect
// agent username (which is the user's Cognito `sub`) back to a real email/name. The
// Connect username is a sub because the FE sends the access token (no `email` claim),
// so Connect IdentityInfo alone is junk; Cognito is the only source of real identity.
const USER_POOL_ID = process.env.USER_POOL_ID || '';

const connect = withPRM(ConnectClient, { region: CONNECT_REGION });
const sts = withPRM(STSClient, { region: CONNECT_REGION });
// The config-writer lives in the deployer account in us-east-1.
const lambda = withPRM(LambdaClient, { region: 'us-east-1' });
// Cognito runs in the CLIENT region (this Lambda's default region == the pool region).
const cognito = USER_POOL_ID ? withPRM(CognitoIdentityProviderClient, {}) : undefined;

const INSTANCE_ALIAS = `numa-${CLIENT_NAME}${ENV_SUFFIX}`;

type JwtClaims = { [key: string]: unknown; 'cognito:groups'?: string[] };

function parseJwt(token: string): JwtClaims {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {} as JwtClaims;
  }
}

/** Decode the caller's Cognito JWT claims from the Authorization header. */
function callerClaims(event: APIGatewayProxyEventV2): JwtClaims {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return {} as JwtClaims;
  return parseJwt(String(auth).replace(/^Bearer\s+/i, ''));
}

function isAdmin(event: APIGatewayProxyEventV2): boolean {
  return ((callerClaims(event)['cognito:groups'] as string[]) || []).includes('admin');
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

// ── Identity resolution (Connect username → human email/name) ────────────────
// A Connect agent's Username is the user's Cognito `sub` (a UUID) — see the header
// note on USER_POOL_ID. To render anything human in the admin panel we map the sub
// back to its Cognito user. Cached per warm container (identities rarely change) so
// the per-load lookups don't hammer Cognito.
type Identity = { email?: string; displayName: string };
const IDENTITY_TTL_MS = 10 * 60 * 1000;
const identityCache = new Map<string, { v: Identity; at: number }>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turn an email local-part into a best-effort display name ("tony.gurnick" → "Tony Gurnick"). */
function deriveName(email: string): string {
  const local = email
    .split('@')[0]
    .replace(/[^A-Za-z0-9._-]/g, ' ')
    .trim();
  const parts = local.split(/[._-]+/).filter(Boolean);
  const cap = (w: string): string => (w ? w[0].toUpperCase() + w.slice(1) : w);
  return parts.map(cap).join(' ') || email;
}

/** Resolve one Connect username to {email, displayName}. Email-shaped usernames need
 *  no lookup; UUID (sub) usernames are looked up in Cognito by the `sub` attribute.
 *  Falls back to the raw username if Cognito is unconfigured or the user is gone. */
async function resolveIdentity(username: string): Promise<Identity> {
  if (!username) return { displayName: username };
  if (username.includes('@')) return { email: username, displayName: deriveName(username) };
  const cached = identityCache.get(username);
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.v;
  let v: Identity = { displayName: username };
  if (cognito && USER_POOL_ID && UUID_RE.test(username)) {
    try {
      const res = await cognito.send(
        new CognitoListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${username}"`, Limit: 1 })
      );
      const attrs = res.Users?.[0]?.Attributes ?? [];
      const get = (n: string): string | undefined => attrs.find((a) => a.Name === n)?.Value;
      const email = get('email');
      const fullName =
        get('name') ||
        [get('given_name'), get('family_name')].filter(Boolean).join(' ') ||
        (email ? deriveName(email) : undefined);
      if (email || fullName) v = { email, displayName: fullName || email || username };
    } catch (err: unknown) {
      console.warn('cognito identity resolve failed', username, String(err));
    }
  }
  identityCache.set(username, { v, at: Date.now() });
  return v;
}

/** Resolve many usernames at once → Map<username, Identity> (de-duped, parallel). */
async function resolveIdentities(usernames: Array<string | undefined>): Promise<Map<string, Identity>> {
  const uniq = [...new Set(usernames.filter((u): u is string => !!u))];
  const entries = await Promise.all(uniq.map(async (u) => [u, await resolveIdentity(u)] as const));
  return new Map(entries);
}

/** Resolve this tenant's Connect instance id+arn by its deterministic alias. */
async function resolveInstance(): Promise<{ id: string; arn: string } | null> {
  const res = await connect.send(new ListInstancesCommand({}));
  const inst = res.InstanceSummaryList?.find((i) => i.InstanceAlias === INSTANCE_ALIAS);
  return inst?.Id && inst.Arn ? { id: inst.Id, arn: inst.Arn } : null;
}

/**
 * Generate an STS presigned GetCallerIdentity URL — cross-account identity proof
 * for the deployer-side config writer. Same pattern as agent-schedule-runner's
 * email-sender call: the URL is fetched server-side by the writer to prove which
 * account/role is calling (it cannot be forged without our credentials).
 */
async function generateStsProofUrl(expiresIn = 60): Promise<string> {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  const { Sha256 } = await import('@aws-crypto/sha256-js');
  const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
  const { HttpRequest } = await import('@smithy/protocol-http');

  const signer = new SignatureV4({
    service: 'sts',
    region: 'us-east-1',
    credentials: defaultProvider(),
    sha256: Sha256,
  });
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: 'sts.us-east-1.amazonaws.com',
    path: '/',
    query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
    headers: { host: 'sts.us-east-1.amazonaws.com' },
  });
  const signed = await signer.presign(request, { expiresIn });
  const queryString = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `https://${signed.hostname}${signed.path}?${queryString}`;
}

/**
 * FEAT-169 write-back: persist recordingsBucket + the live DID list (+ the Connect
 * instance URL when known) into the deployer-account `numa-client-config` table via
 * the STS-proof relay (numa-voice-config-writer). Fire-and-forget and FULLY
 * non-blocking — a write-back failure must never break the admin action that
 * triggered it. The deployer side derives the clientName from our caller account,
 * so this can only ever write our OWN tenant record.
 */
async function persistVoiceConfig(): Promise<void> {
  if (!VOICE_CONFIG_WRITER_LAMBDA_ARN) return;
  try {
    let didNumbers: string[] = [];
    const instance = await resolveInstance();
    if (instance) {
      const numbers = await connect.send(new ListPhoneNumbersV2Command({ TargetArn: instance.arn }));
      didNumbers = (numbers.ListPhoneNumbersSummaryList ?? [])
        .map((n) => n.PhoneNumber)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
    }
    const stsProofUrl = await generateStsProofUrl();
    await lambda.send(
      new InvokeCommand({
        FunctionName: VOICE_CONFIG_WRITER_LAMBDA_ARN,
        InvocationType: 'Event', // async — never block the admin response
        Payload: new TextEncoder().encode(
          JSON.stringify({
            sts_proof_url: stsProofUrl,
            client_name: CLIENT_NAME,
            did_numbers: didNumbers,
            ...(RECORDINGS_BUCKET ? { recordings_bucket: RECORDINGS_BUCKET } : {}),
            ...(CONNECT_INSTANCE_URL ? { connect_instance_url: CONNECT_INSTANCE_URL } : {}),
          })
        ),
      })
    );
  } catch (err: unknown) {
    console.error('voice config write-back failed (non-blocking)', String(err));
  }
}

async function getStatus(claims: JwtClaims): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(200, { configured: false, instanceAlias: INSTANCE_ALIAS });
  // The caller's own Connect username, so we can flag THEIR lines server-side (the owner
  // tag is the hashed/sanitised username — the frontend can't reliably recompute it).
  const callerUsername = connectUsernameFor(claims);
  const [numbers, origins, users, queues] = await Promise.all([
    connect.send(new ListPhoneNumbersV2Command({ TargetArn: instance.arn })),
    connect.send(new ListApprovedOriginsCommand({ InstanceId: instance.id })),
    connect.send(new ListUsersCommand({ InstanceId: instance.id })),
    connect.send(new ListQueuesCommand({ InstanceId: instance.id, QueueTypes: ['STANDARD'] })),
  ]);
  // Resolve the agent's real outbound queue + its current caller-ID so the panel can
  // SHOW which number is active (and flag when none is set — the cause of the
  // "outbound queue is misconfigured" dial failure). Best-effort: never fail status on it.
  let outboundCallerIdNumberId: string | undefined;
  try {
    const queueId = await resolveOutboundQueueId(instance.id);
    if (queueId) {
      const q = await connect.send(new DescribeQueueCommand({ InstanceId: instance.id, QueueId: queueId }));
      outboundCallerIdNumberId = q.Queue?.OutboundCallerConfig?.OutboundCallerIdNumberId;
    }
  } catch (err: unknown) {
    console.warn('could not resolve outbound caller-id', String(err));
  }
  // Per-DID owner (from its numa-owner tag) + tenant inbound mode, so the panel can show
  // personal vs shared lines. DescribePhoneNumber per number — fine for the handful of DIDs.
  const [mode, inboundFlowId, rawNumbers] = await Promise.all([
    getMode(instance.arn),
    findContactFlowId(instance.id, INBOUND_FLOW_NAME).catch(() => undefined),
    Promise.all(
      (numbers.ListPhoneNumbersSummaryList ?? []).map(async (n) => {
        const owner = n.PhoneNumberId
          ? await describeNumber(n.PhoneNumberId)
              .then((d) => d.owner)
              .catch(() => undefined)
          : undefined;
        return {
          id: n.PhoneNumberId,
          number: n.PhoneNumber,
          countryCode: n.PhoneNumberCountryCode,
          type: n.PhoneNumberType,
          owner,
          mine: !!owner && !!callerUsername && owner === callerUsername,
        };
      })
    ),
  ]);

  // Resolve every agent username AND every DID owner (both are Cognito subs) to a real
  // email/name in ONE batched pass, so the panel never shows a raw UUID.
  const agentUsers = users.UserSummaryList ?? [];
  const idMap = await resolveIdentities([...agentUsers.map((u) => u.Username), ...rawNumbers.map((n) => n.owner)]);

  // Attach the resolved owner identity to each number (for the "unassigned" view).
  const phoneNumbers = rawNumbers.map((n) => {
    const id = n.owner ? idMap.get(n.owner) : undefined;
    return { ...n, ownerEmail: id?.email, ownerDisplayName: id?.displayName };
  });

  // Agent-centric view: each Connect user joined to the DID they own (owner === username),
  // with a human label resolved from Cognito. This is what the redesigned panel renders.
  const numberByOwner = new Map(phoneNumbers.filter((n) => n.owner).map((n) => [n.owner as string, n]));
  const agents = agentUsers.map((u) => {
    const username = u.Username ?? '';
    const id = idMap.get(username);
    const owned = numberByOwner.get(username);
    return {
      id: u.Id,
      username,
      email: id?.email,
      displayName: id?.displayName ?? username,
      isSelf: !!callerUsername && username === callerUsername,
      isBot: username === AGENT_USERNAME,
      phoneNumberId: owned?.id,
      phoneNumber: owned?.number,
      countryCode: owned?.countryCode,
      type: owned?.type,
      isCallerId: !!owned?.id && owned.id === outboundCallerIdNumberId,
    };
  });

  return json(200, {
    configured: true,
    instanceId: instance.id,
    instanceAlias: INSTANCE_ALIAS,
    mode,
    inboundReady: !!inboundFlowId,
    phoneNumbers,
    approvedOrigins: origins.Origins ?? [],
    numaOriginPresent: (origins.Origins ?? []).includes(APPROVED_ORIGIN),
    agents,
    queues: (queues.QueueSummaryList ?? []).map((q) => ({ id: q.Id, name: q.Name })),
    outboundCallerIdNumberId,
  });
}

async function claimNumber(
  body: { country?: string; type?: string },
  ownerUsername?: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  const country = (body.country || 'US').toUpperCase();
  const type = (body.type || 'DID').toUpperCase();
  const avail = await connect.send(
    new SearchAvailablePhoneNumbersCommand({
      TargetArn: instance.arn,
      PhoneNumberCountryCode: country as never,
      PhoneNumberType: type as never,
      MaxResults: 1,
    })
  );
  const number = avail.AvailableNumbersList?.[0]?.PhoneNumber;
  if (!number) return json(404, { error: `No available ${country} ${type} numbers` });
  const claim = await connect.send(new ClaimPhoneNumberCommand({ TargetArn: instance.arn, PhoneNumber: number }));
  const phoneNumberId = claim.PhoneNumberId;
  if (phoneNumberId) {
    await associateInboundFlow(instance.id, phoneNumberId); // wire it to receive inbound
    // Self-claim: tag the claimer as owner so it's THEIR personal line (in personal mode).
    if (ownerUsername && claim.PhoneNumberArn) {
      try {
        await connect.send(
          new TagResourceCommand({ resourceArn: claim.PhoneNumberArn, tags: { [OWNER_TAG]: ownerUsername } })
        );
      } catch (err: unknown) {
        console.warn('owner tag on claim failed', String(err));
      }
    }
  }
  await persistVoiceConfig(); // FEAT-169: DID set changed — write it back to tenant config.
  return json(200, { claimed: number, id: phoneNumberId, owner: ownerUsername ?? null });
}

/** Find a contact flow id by name (paginated). */
async function findContactFlowId(instanceId: string, name: string): Promise<string | undefined> {
  let token: string | undefined;
  do {
    const res = await connect.send(new ListContactFlowsCommand({ InstanceId: instanceId, NextToken: token }));
    const match = res.ContactFlowSummaryList?.find((f) => f.Name === name);
    if (match?.Id) return match.Id;
    token = res.NextToken;
  } while (token);
  return undefined;
}

/** Describe a claimed DID → its ARN + current owner tag. */
async function describeNumber(phoneNumberId: string): Promise<{ arn?: string; owner?: string }> {
  const res = await connect.send(new DescribePhoneNumberCommand({ PhoneNumberId: phoneNumberId }));
  const s = res.ClaimedPhoneNumberSummary;
  return { arn: s?.PhoneNumberArn, owner: s?.Tags?.[OWNER_TAG] };
}

/** Wire a DID to the inbound flow so it can RECEIVE calls. Best-effort: outbound still
 *  works if the inbound flow isn't deployed yet. */
async function associateInboundFlow(instanceId: string, phoneNumberId: string): Promise<void> {
  const flowId = await findContactFlowId(instanceId, INBOUND_FLOW_NAME);
  if (!flowId) return;
  try {
    await connect.send(
      new AssociatePhoneNumberContactFlowCommand({
        InstanceId: instanceId,
        PhoneNumberId: phoneNumberId,
        ContactFlowId: flowId,
      })
    );
  } catch (err: unknown) {
    console.warn('could not associate DID with inbound flow', String(err));
  }
}

/** Tag a DID with its owner + ensure it's wired for inbound. */
async function assignOwner(
  instanceId: string,
  phoneNumberId: string,
  owner: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const { arn } = await describeNumber(phoneNumberId);
  if (!arn) return json(404, { error: 'Phone number not found' });
  await connect.send(new TagResourceCommand({ resourceArn: arn, tags: { [OWNER_TAG]: owner } }));
  await associateInboundFlow(instanceId, phoneNumberId);
  await persistVoiceConfig();
  return json(200, { id: phoneNumberId, owner });
}

/** Clear a DID's owner tag (it then routes to the shared team queue). */
async function unassignOwner(phoneNumberId: string): Promise<APIGatewayProxyStructuredResultV2> {
  const { arn } = await describeNumber(phoneNumberId);
  if (!arn) return json(404, { error: 'Phone number not found' });
  await connect.send(new UntagResourceCommand({ resourceArn: arn, tagKeys: [OWNER_TAG] }));
  await persistVoiceConfig();
  return json(200, { id: phoneNumberId, owner: null });
}

/** Tenant inbound mode (default shared). */
async function getMode(instanceArn: string): Promise<VoiceMode> {
  try {
    const res = await connect.send(new ListTagsForResourceCommand({ resourceArn: instanceArn }));
    return res.tags?.[MODE_TAG] === 'personal' ? 'personal' : 'shared';
  } catch {
    return 'shared';
  }
}

async function setMode(instanceArn: string, mode: VoiceMode): Promise<APIGatewayProxyStructuredResultV2> {
  await connect.send(new TagResourceCommand({ resourceArn: instanceArn, tags: { [MODE_TAG]: mode } }));
  return json(200, { mode });
}

async function releaseNumber(phoneNumberId: string): Promise<APIGatewayProxyStructuredResultV2> {
  await connect.send(new ReleasePhoneNumberCommand({ PhoneNumberId: phoneNumberId }));
  await persistVoiceConfig(); // FEAT-169: DID set changed — write it back to tenant config.
  return json(200, { released: phoneNumberId });
}

/**
 * The queue Connect actually dials from is the voice agent's routing-profile
 * DEFAULT OUTBOUND QUEUE — not "the queue whose name contains Basic". Setting the
 * caller-ID on the wrong queue is why dials failed with
 * "InvalidConfigurationException: the outbound queue is misconfigured": the agent's
 * real queue (numa-voice-outbound) had no OutboundCallerIdNumberId.
 */

/** List ALL Connect users across pages. ListUsers returns ~100 per page; a single-
 *  page read silently misses users on instances with >100 agents — which would break
 *  per-user provisioning idempotency (false "not found" → CreateUser → Duplicate). */
async function listAllUsers(instanceId: string): Promise<Array<{ Id?: string; Username?: string }>> {
  const out: Array<{ Id?: string; Username?: string }> = [];
  let token: string | undefined;
  do {
    const res = await connect.send(new ListUsersCommand({ InstanceId: instanceId, NextToken: token }));
    out.push(...(res.UserSummaryList ?? []));
    token = res.NextToken;
  } while (token);
  return out;
}

/** Find a routing profile id by name, paginating across all pages. */
async function findRoutingProfileId(instanceId: string, name: string): Promise<string | undefined> {
  let token: string | undefined;
  do {
    const res = await connect.send(new ListRoutingProfilesCommand({ InstanceId: instanceId, NextToken: token }));
    const match = res.RoutingProfileSummaryList?.find((r) => r.Name === name);
    if (match?.Id) return match.Id;
    token = res.NextToken;
  } while (token);
  return undefined;
}

/** Find a security profile id by name, paginating across all pages. */
async function findSecurityProfileId(instanceId: string, name: string): Promise<string | undefined> {
  let token: string | undefined;
  do {
    const res = await connect.send(new ListSecurityProfilesCommand({ InstanceId: instanceId, NextToken: token }));
    const match = res.SecurityProfileSummaryList?.find((s) => s.Name === name);
    if (match?.Id) return match.Id;
    token = res.NextToken;
  } while (token);
  return undefined;
}

/** Resolve the outbound queue from the numa-voice-routing profile DIRECTLY, not via a
 *  specific agent: under per-user federation there is no single shared agent to look
 *  up, but every per-user agent shares this routing profile, so it's the stable anchor.
 *  Cached per warm container — the profile→queue mapping is IaC-fixed, so repeat
 *  setCallerId/getStatus calls skip the two lookups (ListRoutingProfiles + Describe). */
const OUTBOUND_QUEUE_CACHE_TTL_MS = 5 * 60 * 1000; // bound staleness if the profile is re-pointed
let cachedOutboundQueue: { instanceId: string; queueId: string; at: number } | undefined;
async function resolveOutboundQueueId(instanceId: string): Promise<string | undefined> {
  if (
    cachedOutboundQueue?.instanceId === instanceId &&
    Date.now() - cachedOutboundQueue.at < OUTBOUND_QUEUE_CACHE_TTL_MS
  ) {
    return cachedOutboundQueue.queueId;
  }
  const routingProfileId = await findRoutingProfileId(instanceId, VOICE_ROUTING_PROFILE);
  if (!routingProfileId) return undefined;
  const rp = await connect.send(
    new DescribeRoutingProfileCommand({ InstanceId: instanceId, RoutingProfileId: routingProfileId })
  );
  const queueId = rp.RoutingProfile?.DefaultOutboundQueueId;
  if (queueId) cachedOutboundQueue = { instanceId, queueId, at: Date.now() };
  return queueId;
}

async function setCallerId(phoneNumberId: string): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  const queueId = await resolveOutboundQueueId(instance.id);
  if (!queueId) {
    return json(404, { error: 'No default outbound queue on the voice agent routing profile' });
  }
  // UpdateQueueOutboundCallerConfig REPLACES the whole config — re-send the existing
  // OutboundFlowId / caller-ID name, or the outbound whisper flow is wiped and dials break.
  const existing =
    (await connect.send(new DescribeQueueCommand({ InstanceId: instance.id, QueueId: queueId }))).Queue
      ?.OutboundCallerConfig ?? {};
  await connect.send(
    new UpdateQueueOutboundCallerConfigCommand({
      InstanceId: instance.id,
      QueueId: queueId,
      OutboundCallerConfig: {
        OutboundCallerIdNumberId: phoneNumberId,
        ...(existing.OutboundFlowId ? { OutboundFlowId: existing.OutboundFlowId } : {}),
        ...(existing.OutboundCallerIdName ? { OutboundCallerIdName: existing.OutboundCallerIdName } : {}),
      },
    })
  );
  await persistVoiceConfig(); // FEAT-169: caller-id/DID config changed — write it back.
  return json(200, { queueId, outboundCallerIdNumberId: phoneNumberId });
}

async function addOrigin(origin: string): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  try {
    await connect.send(new AssociateApprovedOriginCommand({ InstanceId: instance.id, Origin: origin }));
  } catch (err: unknown) {
    const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : '';
    if (name !== 'DuplicateResourceException') throw err;
  }
  return json(200, { origin, added: true });
}

async function removeOrigin(origin: string): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  await connect.send(new DisassociateApprovedOriginCommand({ InstanceId: instance.id, Origin: origin }));
  return json(200, { origin, removed: true });
}

async function getFederationToken(claims: JwtClaims): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  if (!FEDERATION_ROLE_ARN) return json(500, { error: 'FEDERATION_ROLE_ARN not configured' });
  // PER-USER AGENT: each Numa user federates as their OWN Connect agent so calls,
  // recordings and post-call attribution are isolated per person. A shared agent
  // meant two people on different machines were the SAME Connect agent — Connect
  // routes contacts per-agent, so one person's call surfaced on another's softphone.
  const perUser = connectUsernameFor(claims);
  if (!perUser) {
    // No usable email/sub on the token — fall back to the shared agent so login still
    // works, but warn: this caller is NOT isolated (shouldn't happen for a real session).
    console.warn('voice federation: no per-user identity on token; using shared agent (no call isolation)');
  }
  const username = perUser ?? AGENT_USERNAME;
  try {
    await ensureConnectUser(instance.id, username, claims);
  } catch (err: unknown) {
    console.error('voice agent provisioning failed', String(err));
    return json(500, {
      error: 'Could not provision your voice agent',
      detail: String((err as { name?: string })?.name ?? err),
    });
  }
  // Passwordless softphone login via AWS console federation:
  //   assume the federation role (RoleSessionName = the Connect username) -> get
  //   temp creds -> exchange them for a console SigninToken -> build a console
  //   login URL whose Destination is the Connect /connect/federate endpoint.
  // When the softphone login popup loads that URL, AWS federates a console session
  // and hands it to connect/federate, which establishes the agent's CCP session and
  // redirects to /ccp-v2 — no password. (The bare GetFederationToken SignInUrl does
  // NOT work: on a SAML instance it returns /auth/sign-in which 404s.)
  const assumed = await sts.send(
    new AssumeRoleCommand({ RoleArn: FEDERATION_ROLE_ARN, RoleSessionName: username, DurationSeconds: 3600 })
  );
  const c = assumed.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    return json(500, { error: 'Federation assume-role failed' });
  }
  const session = JSON.stringify({
    sessionId: c.AccessKeyId,
    sessionKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  });
  const tokenRes = await fetch(
    `https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${encodeURIComponent(session)}`
  );
  if (!tokenRes.ok) return json(502, { error: 'getSigninToken failed', status: tokenRes.status });
  const { SigninToken } = (await tokenRes.json()) as { SigninToken: string };
  const destination = `https://${CONNECT_REGION}.console.aws.amazon.com/connect/federate/${instance.id}?destination=${encodeURIComponent('/ccp-v2')}&new_domain=true`;
  const signInUrl =
    `https://signin.aws.amazon.com/federation?Action=login` +
    `&Issuer=${encodeURIComponent(APPROVED_ORIGIN || 'https://numa.arcanum.ai')}` +
    `&Destination=${encodeURIComponent(destination)}` +
    `&SigninToken=${SigninToken}`;
  return json(200, { signInUrl, userId: username });
}

/** Derive a stable, Connect-valid agent username from the Numa user's identity.
 *  Prefer email (how SAML maps subjects); fall back to sub. Connect usernames and
 *  STS RoleSessionName both allow [A-Za-z0-9_.@-]; RoleSessionName caps at 64. */
function connectUsernameFor(claims: JwtClaims): string | undefined {
  const email = typeof claims.email === 'string' ? claims.email.trim() : '';
  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  const raw = email || sub;
  if (raw.length < 2) return undefined;
  // Connect usernames + STS RoleSessionName allow [A-Za-z0-9_.@-]; RoleSessionName caps at 64.
  const sanitized = raw.replace(/[^A-Za-z0-9_.@-]/g, '');
  // If sanitising changed the value (plus-addressing "a+b@x"→"ab@x", unicode, etc.)
  // two distinct identities could collapse to the SAME username — and federation would
  // log one person in as another's agent. Append a short stable hash of the ORIGINAL
  // identity so usernames stay 1:1. Clean emails (the common case) are untouched/readable.
  if (sanitized === raw) return sanitized.slice(0, 64);
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 10);
  const prefix = (sanitized || 'user').slice(0, 50).replace(/^[.@-]+/, '') || 'user';
  return `${prefix}-${hash}`.slice(0, 64);
}

/** Ensure a per-user Connect agent exists (idempotent). Each Numa user gets their
 *  own agent on the shared numa-voice-routing profile, so the outbound queue's
 *  caller-ID DID is reused but call/recording state is isolated per person. */
async function ensureConnectUser(instanceId: string, username: string, claims: JwtClaims): Promise<void> {
  // Paginated existence check — a single-page ListUsers would miss an existing user
  // beyond page 1 and wrongly try to recreate them.
  const users = await listAllUsers(instanceId);
  if (users.some((u) => u.Username === username)) return;
  const [routingProfileId, agentSecurityProfileId] = await Promise.all([
    findRoutingProfileId(instanceId, VOICE_ROUTING_PROFILE),
    findSecurityProfileId(instanceId, 'Agent'),
  ]);
  if (!routingProfileId || !agentSecurityProfileId) {
    throw new Error('Missing numa-voice-routing routing profile or Agent security profile');
  }
  // Always give the agent a COMPLETE identity in the Connect console (a half-populated
  // IdentityInfo reads as a broken/anonymous agent). claims.email is absent on the
  // access-token path (the root cause of UUID agents), so fall back to Cognito — the
  // username IS the user's sub — to still record a real email + name. Derive first/last
  // from the resolved name or the email local-part when the IdP gave no given/family name.
  const claimEmail = typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim() : undefined;
  const resolved = claimEmail ? undefined : await resolveIdentity(username);
  const email = claimEmail ?? resolved?.email;
  const nameSource =
    resolved?.displayName && resolved.displayName !== username ? resolved.displayName : (email ?? username);
  const localPart = nameSource
    .split('@')[0]
    .replace(/[^A-Za-z0-9._-]/g, ' ')
    .trim();
  const [derivedFirst, ...derivedRest] = localPart.split(/[._\s-]+/).filter(Boolean);
  const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const firstName = (typeof claims.given_name === 'string' && claims.given_name.trim()) || cap(derivedFirst) || 'Numa';
  const lastName =
    (typeof claims.family_name === 'string' && claims.family_name.trim()) || cap(derivedRest.join(' ')) || 'Voice';
  const identityInfo = {
    ...(email ? { Email: email } : {}),
    FirstName: firstName.slice(0, 100),
    LastName: lastName.slice(0, 100),
  };
  try {
    await connect.send(
      new CreateUserCommand({
        InstanceId: instanceId,
        Username: username,
        RoutingProfileId: routingProfileId,
        SecurityProfileIds: [agentSecurityProfileId],
        PhoneConfig: { PhoneType: 'SOFT_PHONE', AutoAccept: false, AfterContactWorkTimeLimit: 0 },
        IdentityInfo: identityInfo,
      })
    );
  } catch (err: unknown) {
    // Lost a create race / user already exists (e.g. beyond the ListUsers page) — fine.
    if ((err as { name?: string })?.name !== 'DuplicateResourceException') throw err;
  }
}

/** Backfill IdentityInfo (Email + name) on EXISTING Connect agents from Cognito.
 *  Agents created before the forward fix have a UUID-derived junk identity and no
 *  email; this repairs the Connect console / CCP display for them. Idempotent: skips
 *  the bot, users with no resolvable email, and users already carrying the right email.
 *  The panel resolves names live regardless — this only fixes Connect's own records. */
async function syncAgentIdentities(): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  const users = await listAllUsers(instance.id);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const u of users) {
    if (!u.Id || !u.Username || u.Username === AGENT_USERNAME) {
      skipped++;
      continue;
    }
    const ident = await resolveIdentity(u.Username);
    if (!ident.email) {
      skipped++; // nothing better to write than the UUID we already have
      continue;
    }
    try {
      const cur = (await connect.send(new DescribeUserCommand({ InstanceId: instance.id, UserId: u.Id }))).User
        ?.IdentityInfo;
      if (cur?.Email === ident.email) {
        skipped++; // already correct
        continue;
      }
      const [first, ...rest] = ident.displayName.split(/[._\s-]+/).filter(Boolean);
      const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
      await connect.send(
        new UpdateUserIdentityInfoCommand({
          InstanceId: instance.id,
          UserId: u.Id,
          IdentityInfo: {
            Email: ident.email,
            FirstName: (cap(first) || 'Numa').slice(0, 100),
            LastName: (rest.map(cap).join(' ') || 'Voice').slice(0, 100),
          },
        })
      );
      updated++;
    } catch (err: unknown) {
      console.warn('identity backfill failed', u.Username, String(err));
      failed++;
    }
  }
  return json(200, { updated, skipped, failed, total: users.length });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const requireAdmin = (): APIGatewayProxyStructuredResultV2 | null =>
    isAdmin(event) ? null : json(403, { error: 'Forbidden — admin only' });

  let body: Record<string, unknown> = {};
  try {
    body = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  try {
    // ── Reads (any authenticated user) ──────────────────────────────────────
    if (method === 'GET' && /\/voice\/admin\/status\/?$/.test(path)) return await getStatus(callerClaims(event));
    // Federation token = password-free softphone login; any authenticated user.
    if (method === 'GET' && /\/voice\/federation-token\/?$/.test(path))
      return await getFederationToken(callerClaims(event));

    // ── Mutations ───────────────────────────────────────────────────────────
    const callerUser = connectUsernameFor(callerClaims(event));
    const phoneOwnerMatch = path.match(/\/voice\/phone-numbers\/([^/]+?)\/owner\/?$/);
    const phoneIdMatch = path.match(/\/voice\/phone-numbers\/([^/]+?)(\/caller-id)?\/?$/);

    // Claim a NEW DID — ADMIN ONLY (each claim costs money). Optional { owner } assigns
    // it to a specific agent on claim (the per-agent "Claim" flow); without it the DID
    // lands UNOWNED in the pool for later assignment via POST .../{id}/owner.
    if (method === 'POST' && /\/voice\/phone-numbers\/?$/.test(path)) {
      const denied = requireAdmin();
      if (denied) return denied;
      const owner = typeof body.owner === 'string' && body.owner ? body.owner : undefined;
      return await claimNumber(body as { country?: string; type?: string }, owner);
    }
    // Backfill existing agents' Connect IdentityInfo (Email/name) from Cognito — admin only.
    if (method === 'POST' && /\/voice\/agents\/sync-identities\/?$/.test(path)) {
      return requireAdmin() ?? (await syncAgentIdentities());
    }
    // Assign/reassign a DID's owner. Admins → anyone; a non-admin may only claim it for SELF.
    if (method === 'POST' && phoneOwnerMatch) {
      const instance = await resolveInstance();
      if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
      const id = decodeURIComponent(phoneOwnerMatch[1]);
      const owner = isAdmin(event) ? (typeof body.owner === 'string' ? body.owner : callerUser) : callerUser;
      if (!owner) return json(400, { error: 'No owner to assign (admin must pass { owner })' });
      return await assignOwner(instance.id, id, owner);
    }
    // Unassign a DID's owner — admin, or the current owner releasing their own line.
    if (method === 'DELETE' && phoneOwnerMatch) {
      const id = decodeURIComponent(phoneOwnerMatch[1]);
      if (!isAdmin(event)) {
        const { owner } = await describeNumber(id);
        if (!owner || owner !== callerUser) return json(403, { error: 'Forbidden — not your number' });
      }
      return await unassignOwner(id);
    }
    // Inbound mode (personal | shared) — admin only.
    if (method === 'POST' && /\/voice\/mode\/?$/.test(path)) {
      const denied = requireAdmin();
      if (denied) return denied;
      const instance = await resolveInstance();
      if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
      return await setMode(instance.arn, body.mode === 'personal' ? 'personal' : 'shared');
    }
    if (method === 'POST' && phoneIdMatch?.[2]) {
      return requireAdmin() ?? (await setCallerId(decodeURIComponent(phoneIdMatch[1])));
    }
    if (method === 'DELETE' && phoneIdMatch) {
      return requireAdmin() ?? (await releaseNumber(decodeURIComponent(phoneIdMatch[1])));
    }
    if (method === 'POST' && /\/voice\/approved-origins\/?$/.test(path)) {
      return requireAdmin() ?? (await addOrigin(String(body.origin ?? APPROVED_ORIGIN)));
    }
    if (method === 'DELETE' && /\/voice\/approved-origins\/?$/.test(path)) {
      // DELETE carries no body via the FE client — read origin from the query string.
      const origin = String(event.queryStringParameters?.origin ?? body.origin ?? '');
      return requireAdmin() ?? (await removeOrigin(origin));
    }

    return json(404, { error: 'Not found', method, path });
  } catch (err: unknown) {
    console.error('voice-admin error', { method, path, error: String(err) });
    return json(500, { error: 'Internal error', detail: String((err as { name?: string })?.name ?? err) });
  }
};
