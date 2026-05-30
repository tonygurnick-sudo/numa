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
  ListQueuesCommand,
  UpdateQueueOutboundCallerConfigCommand,
} from '@aws-sdk/client-connect';
import { SupportClient, CreateCaseCommand } from '@aws-sdk/client-support';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * numa-voice-admin — admin API for the Numa Voice / Amazon Connect surface.
 *
 * Backs the Voice Admin panel: phone numbers (list/claim/release + caller-id),
 * agent + Approved Origins, instance status, and an outbound-country enablement
 * request (the one thing with no Connect API — files an AWS Support case if the
 * account has a Business+ plan, else returns a pre-filled console link).
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

const connect = withPRM(ConnectClient, { region: CONNECT_REGION });
const support = withPRM(SupportClient, { region: 'us-east-1' }); // Support API is us-east-1 only
const sts = withPRM(STSClient, { region: CONNECT_REGION });

const INSTANCE_ALIAS = `numa-${CLIENT_NAME}${ENV_SUFFIX}`;

type JwtClaims = { [key: string]: unknown; 'cognito:groups'?: string[] };

function parseJwt(token: string): JwtClaims {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {} as JwtClaims;
  }
}

function isAdmin(event: APIGatewayProxyEventV2): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const claims = parseJwt(String(auth).replace(/^Bearer\s+/i, ''));
  return ((claims['cognito:groups'] as string[]) || []).includes('admin');
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

/** Resolve this tenant's Connect instance id+arn by its deterministic alias. */
async function resolveInstance(): Promise<{ id: string; arn: string } | null> {
  const res = await connect.send(new ListInstancesCommand({}));
  const inst = res.InstanceSummaryList?.find((i) => i.InstanceAlias === INSTANCE_ALIAS);
  return inst?.Id && inst.Arn ? { id: inst.Id, arn: inst.Arn } : null;
}

async function getStatus(): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(200, { configured: false, instanceAlias: INSTANCE_ALIAS });
  const [numbers, origins, users, queues] = await Promise.all([
    connect.send(new ListPhoneNumbersV2Command({ TargetArn: instance.arn })),
    connect.send(new ListApprovedOriginsCommand({ InstanceId: instance.id })),
    connect.send(new ListUsersCommand({ InstanceId: instance.id })),
    connect.send(new ListQueuesCommand({ InstanceId: instance.id, QueueTypes: ['STANDARD'] })),
  ]);
  return json(200, {
    configured: true,
    instanceId: instance.id,
    instanceAlias: INSTANCE_ALIAS,
    phoneNumbers: (numbers.ListPhoneNumbersSummaryList ?? []).map((n) => ({
      id: n.PhoneNumberId,
      number: n.PhoneNumber,
      countryCode: n.PhoneNumberCountryCode,
      type: n.PhoneNumberType,
    })),
    approvedOrigins: origins.Origins ?? [],
    numaOriginPresent: (origins.Origins ?? []).includes(APPROVED_ORIGIN),
    agents: (users.UserSummaryList ?? []).map((u) => ({ id: u.Id, username: u.Username })),
    queues: (queues.QueueSummaryList ?? []).map((q) => ({ id: q.Id, name: q.Name })),
  });
}

async function claimNumber(body: { country?: string; type?: string }): Promise<APIGatewayProxyStructuredResultV2> {
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
  return json(200, { claimed: number, id: claim.PhoneNumberId });
}

async function releaseNumber(phoneNumberId: string): Promise<APIGatewayProxyStructuredResultV2> {
  await connect.send(new ReleasePhoneNumberCommand({ PhoneNumberId: phoneNumberId }));
  return json(200, { released: phoneNumberId });
}

async function setCallerId(phoneNumberId: string): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  const queues = await connect.send(new ListQueuesCommand({ InstanceId: instance.id, QueueTypes: ['STANDARD'] }));
  const queue = queues.QueueSummaryList?.find((q) => (q.Name ?? '').includes('Basic')) ?? queues.QueueSummaryList?.[0];
  if (!queue?.Id) return json(404, { error: 'No queue found' });
  await connect.send(
    new UpdateQueueOutboundCallerConfigCommand({
      InstanceId: instance.id,
      QueueId: queue.Id,
      OutboundCallerConfig: { OutboundCallerIdNumberId: phoneNumberId },
    })
  );
  return json(200, { queueId: queue.Id, outboundCallerIdNumberId: phoneNumberId });
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

async function requestOutboundCountry(country: string): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  const subject = `Enable Amazon Connect outbound calling to ${country}`;
  const communicationBody = [
    `Please enable outbound voice calling to ${country} for Amazon Connect instance`,
    ` "${INSTANCE_ALIAS}" (${instance?.id ?? 'unknown'}) in ${CONNECT_REGION}.`,
    ' Use case: outbound SDR calling via Numa Voice.',
  ].join('');
  try {
    const res = await support.send(
      new CreateCaseCommand({
        subject,
        serviceCode: 'amazon-connect',
        categoryCode: 'other',
        severityCode: 'low',
        communicationBody,
        issueType: 'technical',
      })
    );
    return json(200, { filed: true, caseId: res.caseId });
  } catch (err: unknown) {
    // No Business/Enterprise support plan (SubscriptionRequiredException) or other
    // failure -> hand back a pre-filled console link instead of failing.
    const consoleUrl = `https://${CONNECT_REGION}.console.aws.amazon.com/connect/home`;
    return json(200, {
      filed: false,
      reason: String((err as { name?: string })?.name ?? err),
      manual: {
        subject,
        communicationBody,
        supportConsole: 'https://console.aws.amazon.com/support/home#/case/create',
        connectConsole: consoleUrl,
      },
    });
  }
}

async function getFederationToken(): Promise<APIGatewayProxyStructuredResultV2> {
  const instance = await resolveInstance();
  if (!instance) return json(409, { error: 'No Connect instance for this workspace' });
  if (!FEDERATION_ROLE_ARN) return json(500, { error: 'FEDERATION_ROLE_ARN not configured' });
  // Passwordless softphone login via AWS console federation:
  //   assume the federation role (RoleSessionName = the Connect username) -> get
  //   temp creds -> exchange them for a console SigninToken -> build a console
  //   login URL whose Destination is the Connect /connect/federate endpoint.
  // When the softphone login popup loads that URL, AWS federates a console session
  // and hands it to connect/federate, which establishes the agent's CCP session and
  // redirects to /ccp-v2 — no password. (The bare GetFederationToken SignInUrl does
  // NOT work: on a SAML instance it returns /auth/sign-in which 404s.)
  const assumed = await sts.send(
    new AssumeRoleCommand({ RoleArn: FEDERATION_ROLE_ARN, RoleSessionName: AGENT_USERNAME, DurationSeconds: 3600 })
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
  return json(200, { signInUrl, userId: AGENT_USERNAME });
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
    if (method === 'GET' && /\/voice\/admin\/status\/?$/.test(path)) return await getStatus();
    // Federation token = password-free softphone login; any authenticated user.
    if (method === 'GET' && /\/voice\/federation-token\/?$/.test(path)) return await getFederationToken();

    // ── Mutations (admin only) ──────────────────────────────────────────────
    const phoneIdMatch = path.match(/\/voice\/phone-numbers\/([^/]+?)(\/caller-id)?\/?$/);

    if (method === 'POST' && /\/voice\/phone-numbers\/?$/.test(path)) {
      return requireAdmin() ?? (await claimNumber(body as { country?: string; type?: string }));
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
    if (method === 'POST' && /\/voice\/outbound-country-request\/?$/.test(path)) {
      return requireAdmin() ?? (await requestOutboundCountry(String(body.country ?? 'New Zealand')));
    }

    return json(404, { error: 'Not found', method, path });
  } catch (err: unknown) {
    console.error('voice-admin error', { method, path, error: String(err) });
    return json(500, { error: 'Internal error', detail: String((err as { name?: string })?.name ?? err) });
  }
};
