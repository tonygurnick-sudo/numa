/**
 * Auth context for every request.
 *
 * Identity comes from ONE place: a cryptographically VERIFIED Cognito JWT in
 * the `Authorization` header. Nothing else is trusted — not a free-form
 * `userContext` field, not an unverified decode.
 *
 * Three caller classes, two token types — but ONE rule: a cryptographically
 * verified token is the only identity source.
 *   - Laptop / local dev CLI → CloudFront → API Gateway. Sends a Cognito
 *     **access** token.
 *   - Interactive workspace chat → direct `lambda:InvokeFunction`. Sends the
 *     Cognito **id** token: the same token the frontend used to open the
 *     chat, handed down through the proxy.
 *   - Non-interactive runs (scheduled agents, V2 apps, Nolia) → also direct
 *     invoke, but these have NO user token (they authenticate to the proxy
 *     with a shared secret). For them the proxy mints a short-lived **service
 *     token** — an HS256 JWT signed with a secret only the proxy and this
 *     Lambda hold (never the workspace role / MicroVM). We verify that.
 *
 * Why verify here even though an API-GW authorizer already runs upstream:
 * on a direct Lambda invoke the *caller controls the entire event payload* —
 * there is no AWS-trustworthy "this came through API Gateway" marker a direct
 * caller can't fabricate. The workspace IAM role can invoke this Lambda
 * directly, and that role is fully reachable by the LLM inside the MicroVM
 * (its credentials are ambient via IMDS). If we decoded the JWT without
 * verifying its signature — or trusted a self-asserted `sub` — the LLM could
 * forge any user's identity and impersonate them within the tenant. So we
 * verify the signature and derive identity from verified claims only, and
 * NEVER accept a plaintext sub. The workspace IAM signature is a *second*
 * factor (it proves the call came from a real workspace MicroVM); it is NOT
 * the identity source.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { jwtVerify } from 'jose';

const USER_POOL_ID = process.env['COGNITO_USER_POOL_ID'] ?? '';
const USER_POOL_CLIENT_ID = process.env['COGNITO_USER_POOL_CLIENT_ID'] ?? '';
const ADDITIONAL_CLIENT_IDS = (process.env['ADDITIONAL_COGNITO_CLIENT_IDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Every client ID the frontend may have minted tokens under — must match the
 * set the API-GW authorizer accepts (`api-gateway-authorizer`), otherwise a
 * token valid at the edge would fail here.
 */
const ALL_CLIENT_IDS: string[] = [USER_POOL_CLIENT_ID, ...ADDITIONAL_CLIENT_IDS].filter(Boolean);

/**
 * Tolerate a small expiry overrun. The workspace id token is captured at
 * chat-turn start and lives ~60min (idTokenValidity=60, see
 * core-numa-infra-construct.ts); a single long-running turn could otherwise
 * clip a late CLI call by a few seconds. 120s costs us almost nothing on the
 * replay side — the workspace IAM signature already bounds origin to a real
 * MicroVM, and laptop tokens are refreshed client-side well before expiry.
 */
const GRACE_SECONDS = 120;

/**
 * Service-token (non-interactive) verification config. The proxy mints an
 * HS256 JWT for scheduled/V2/Nolia runs that have no Cognito token, signed
 * with a secret only the proxy and this Lambda hold (the workspace role and
 * the MicroVM never receive it). `iss` routes a token to this path; `aud`
 * pins it to us. If the secret is unset we reject service tokens outright —
 * fail closed, never fall back to trusting unsigned claims.
 */
const SERVICE_TOKEN_ISSUER = 'numa-workspace-proxy';
const SERVICE_TOKEN_AUDIENCE = 'numa-cli-api';
const CLI_IDENTITY_SECRET = process.env['NUMA_CLI_IDENTITY_SECRET'] ?? '';

// Two verifiers: the workspace path presents an id token, the laptop/API-GW
// path an access token. Created at module scope (config only — JWKS is
// fetched lazily on first verify), mirroring `api-gateway-authorizer`.
const idTokenVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',
  clientId: ALL_CLIENT_IDS,
  graceSeconds: GRACE_SECONDS,
});
const accessTokenVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: ALL_CLIENT_IDS,
  graceSeconds: GRACE_SECONDS,
});

export interface JwtClaims {
  sub?: string;
  email?: string;
  name?: string;
  /** Cognito tokens only. Routes to the id vs access verifier. */
  token_use?: string;
  /** Present on our minted service tokens. Routes to the service-token path. */
  iss?: string;
  'cognito:groups'?: string[] | string;
  'cognito:username'?: string;
  [key: string]: unknown;
}

export interface AuthContext {
  sub: string;
  email: string | undefined;
  name: string | undefined;
  groups: string[];
  /**
   * Raw verified bearer token (Bearer prefix stripped). On the laptop path
   * this is the access token; on the workspace path the id token. Forwarded
   * by handlers that need a token credential downstream (e.g. kb_manager's
   * synthetic API-GW event).
   */
  accessToken: string;
}

/**
 * Decode JWT claims WITHOUT verifying — used only to read `token_use` so we
 * route to the right verifier. The verifier then cryptographically checks the
 * whole token (signature, expiry, audience, AND token_use), so a tampered
 * `token_use` simply fails verification. Never derive identity from this.
 */
export const parseJwtClaims = (token: string): JwtClaims => {
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(
      Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    ) as JwtClaims;
  } catch {
    return {};
  }
};

const extractGroups = (claims: Record<string, unknown>): string[] => {
  const direct = claims['cognito:groups'];
  if (Array.isArray(direct)) return direct.filter((g): g is string => typeof g === 'string');
  if (typeof direct === 'string' && direct) {
    // The custom authorizer can flatten the array to a comma-joined string;
    // accept both shapes.
    return direct
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
  }
  // Some pools surface group membership via principal-tag mapping on the id
  // token instead of `cognito:groups` (this is what the frontend reads).
  const tags = claims['https://aws.amazon.com/tags'];
  if (tags && typeof tags === 'object') {
    const principalTags = (tags as Record<string, unknown>)['principal_tags'];
    if (principalTags && typeof principalTags === 'object') {
      const groups = (principalTags as Record<string, unknown>)['Groups'];
      if (Array.isArray(groups)) return groups.filter((g): g is string => typeof g === 'string');
    }
  }
  return [];
};

/**
 * Verify a proxy-minted service token (non-interactive runs). HS256, signed
 * with the shared secret. Fails closed if the secret is unset. Carries only a
 * `sub` — no email/name/groups (empty groups => non-admin, the safe default
 * for unattended runs).
 */
const verifyServiceToken = async (token: string): Promise<AuthContext | null> => {
  if (!CLI_IDENTITY_SECRET) {
    console.error('numa-cli-api: service token presented but NUMA_CLI_IDENTITY_SECRET is unset — rejecting');
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(CLI_IDENTITY_SECRET), {
      issuer: SERVICE_TOKEN_ISSUER,
      audience: SERVICE_TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!sub) return null;
    return { sub, email: undefined, name: undefined, groups: [], accessToken: '' };
  } catch (err) {
    console.error('numa-cli-api: service token verification failed', err instanceof Error ? err.message : err);
    return null;
  }
};

export const resolveAuthContext = async (event: APIGatewayProxyEventV2): Promise<AuthContext | null> => {
  const authHeader = event.headers?.['authorization'] ?? event.headers?.['Authorization'];
  if (!authHeader) return null;

  const token = String(authHeader)
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return null;

  const routeClaims = parseJwtClaims(token);

  // Proxy-minted service token (non-interactive runs with no Cognito token).
  if (routeClaims.iss === SERVICE_TOKEN_ISSUER) {
    return verifyServiceToken(token);
  }

  // Route by the (unverified) token_use claim, then verify with the matching
  // Cognito verifier. Verification is the security boundary — routing is a hint.
  const useIdToken = routeClaims.token_use === 'id';

  let payload: Record<string, unknown>;
  try {
    payload = (useIdToken
      ? await idTokenVerifier.verify(token)
      : await accessTokenVerifier.verify(token)) as unknown as Record<string, unknown>;
  } catch (err) {
    console.error('numa-cli-api: JWT verification failed', err instanceof Error ? err.message : err);
    return null;
  }

  const sub = typeof payload['sub'] === 'string' ? (payload['sub'] as string) : '';
  if (!sub) return null;

  return {
    sub,
    email: typeof payload['email'] === 'string' ? (payload['email'] as string) : undefined,
    name: typeof payload['name'] === 'string' ? (payload['name'] as string) : undefined,
    groups: extractGroups(payload),
    accessToken: token,
  };
};
