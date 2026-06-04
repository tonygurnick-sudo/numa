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
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
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
// FEAT-169 config write-back (STS-proof relay -> deployer numa-client-config).
const VOICE_CONFIG_WRITER_LAMBDA_ARN = process.env.VOICE_CONFIG_WRITER_LAMBDA_ARN || '';
const RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET || '';
const CONNECT_INSTANCE_URL = process.env.CONNECT_INSTANCE_URL || '';

const connect = withPRM(ConnectClient, { region: CONNECT_REGION });
const support = withPRM(SupportClient, { region: 'us-east-1' }); // Support API is us-east-1 only
const sts = withPRM(STSClient, { region: CONNECT_REGION });
// The config-writer lives in the deployer account in us-east-1.
const lambda = withPRM(LambdaClient, { region: 'us-east-1' });

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
  await persistVoiceConfig(); // FEAT-169: DID set changed — write it back to tenant config.
  return json(200, { claimed: number, id: claim.PhoneNumberId });
}

async function releaseNumber(phoneNumberId: string): Promise<APIGatewayProxyStructuredResultV2> {
  await connect.send(new ReleasePhoneNumberCommand({ PhoneNumberId: phoneNumberId }));
  await persistVoiceConfig(); // FEAT-169: DID set changed — write it back to tenant config.
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
  await persistVoiceConfig(); // FEAT-169: caller-id/DID config changed — write it back.
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
