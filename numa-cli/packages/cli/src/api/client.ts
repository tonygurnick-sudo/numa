/**
 * HTTP client for the Numa instance.
 *
 * Two transports, selected at call time by NUMA_AUTH_MODE:
 *
 *   - Default (laptop / unset): HTTPS via CloudFront → API Gateway. The
 *     frontend's API authorizer expects the raw Cognito access token in
 *     the lowercase `authorization` header (no `Bearer` prefix). We mirror
 *     that.
 *   - `workspace-iam` (set inside MicroVMs by sdk_config.py): direct
 *     Lambda invoke against `<client>_numa-cli-api`. AWS SDK signs the
 *     request with the workspace's IAM role (a second factor proving the
 *     call came from a real MicroVM), and we send the verified identity token
 *     (`NUMA_IDENTITY_TOKEN` — a Cognito id token for interactive chat, or a
 *     proxy-minted service token for non-interactive runs) in the
 *     `authorization` header. The Lambda VERIFIES that token and derives
 *     identity from it — the IAM signature is not the identity source, the
 *     verified token is. This avoids API Gateway's 30s timeout (real for
 *     `web search --summarise`) while keeping identity unforgeable: the LLM
 *     can read the token but can't mint one for another user.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export function numaBaseUrl(account: string): string {
  return `https://${account}.numa.arcanum.ai`;
}

/**
 * Cached Lambda client. Lazily created on first workspace-IAM call so
 * laptop-mode callers don't pay the SDK-init cost.
 */
let _lambdaClient: LambdaClient | undefined;
function lambdaClient(): LambdaClient {
  if (!_lambdaClient) {
    _lambdaClient = new LambdaClient({});
  }
  return _lambdaClient;
}

export interface ClientConfig {
  USER_POOL_ID: string;
  CLIENT_ID: string;
  REGION: string;
  CLIENT_NAME: string;
  API_ENDPOINT: string;
  [key: string]: unknown;
}

/** Public, unauthenticated. Returns the same JSON the frontend boot loader fetches. */
export async function fetchClientConfig(account: string): Promise<ClientConfig> {
  const url = `${numaBaseUrl(account)}/config.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetchClientConfig(${account}): HTTP ${res.status}`);
  }
  return (await res.json()) as ClientConfig;
}

interface ApiCallOptions {
  account: string;
  apiEndpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  accessToken: string | undefined;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export async function apiCall<T = unknown>(opts: ApiCallOptions): Promise<T> {
  if (process.env['NUMA_AUTH_MODE'] === 'workspace-iam') {
    return invokeViaLambda<T>(opts);
  }

  const apiPrefix = opts.apiEndpoint ?? '/api';
  const base = `${numaBaseUrl(opts.account)}${apiPrefix}`;
  const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;

  const url = new URL(base + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.accessToken) {
    headers['authorization'] = opts.accessToken;
  }

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, opts.method ?? 'GET', url.toString(), text);
  }

  const text = await res.text();
  if (text.length === 0) return undefined as T;

  // CloudFront serves the SPA's index.html when an /api/* route doesn't exist
  // (route not registered server-side, or Lambda not deployed yet). The
  // status comes back as 200 — the only tell is the body. Detect this so
  // callers see a useful error instead of a parsed-as-string HTML blob.
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html') || /^\s*<!doctype html/i.test(text)) {
    throw new ApiError(
      404,
      opts.method ?? 'GET',
      url.toString(),
      'API Gateway returned the SPA fallback (route not registered or Lambda not deployed)'
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly method: string;
  public readonly url: string;
  public readonly body: string;

  constructor(status: number, method: string, url: string, body: string) {
    super(`HTTP ${status} from ${method} ${url}: ${body}`);
    this.name = 'ApiError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.body = body;
  }
}

/**
 * Workspace-IAM transport — direct Lambda invoke instead of HTTPS.
 *
 * Builds an API-Gateway-v2-shaped event so the numa-cli-api handler can
 * route by `requestContext.http.path` without forking its code paths.
 * Identity rides as a verified token in the `authorization` header;
 * `numa-cli-api/src/shared/auth.ts` verifies it (signature + expiry +
 * audience) and derives the user from the verified claims.
 *
 * Reads from env (set by the workspace-chat-agent at SDK launch — see
 * `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py`):
 *
 *   NUMA_ACCOUNT          — client name; used to derive Lambda function name
 *   NUMA_IDENTITY_TOKEN   — the active identity token: the user's Cognito id
 *                           token (interactive) or a proxy-minted service token
 *                           (non-interactive runs)
 *
 * NUMA_IDENTITY_TOKEN is required — if absent we fail fast (rather than
 * letting the dispatcher 401 with an opaque error). AWS credentials come
 * from the SDK's default chain (workspace IAM role → AssumeRoleWithWebIdentity
 * → task role → instance profile, whichever the MicroVM exposes).
 */
async function invokeViaLambda<T>(opts: ApiCallOptions): Promise<T> {
  const account = process.env['NUMA_ACCOUNT'];
  if (!account) {
    throw new Error('NUMA_AUTH_MODE=workspace-iam but NUMA_ACCOUNT is unset');
  }
  // Identity is a VERIFIED token — NOT a self-asserted sub. numa-cli-api
  // verifies this token's signature and derives the user from its claims, so
  // only the workspace agent (which holds the real token, fresh per turn) can
  // speak for the user. The CLI is agnostic to which token it is: the user's
  // Cognito id token for interactive chat, or a proxy-minted signed service
  // token for non-interactive runs. The LLM can read this env var but can't
  // forge a token for a different user. Injected by sdk_config.py; verified in
  // numa-cli-api/src/shared/auth.ts.
  const identityToken = process.env['NUMA_IDENTITY_TOKEN'];
  if (!identityToken) {
    throw new Error('NUMA_AUTH_MODE=workspace-iam but NUMA_IDENTITY_TOKEN is unset');
  }

  const apiPrefix = opts.apiEndpoint ?? '/api';
  const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
  const fullPath = `${apiPrefix}${path}`;
  const method = opts.method ?? 'GET';

  const queryParams: Record<string, string> = {};
  let rawQueryString = '';
  if (opts.query) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) {
        const sv = String(v);
        queryParams[k] = sv;
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(sv)}`);
      }
    }
    rawQueryString = parts.join('&');
  }

  const event: Record<string, unknown> = {
    version: '2.0',
    rawPath: fullPath,
    rawQueryString,
    headers: {
      'content-type': 'application/json',
      // The token IS the identity. numa-cli-api verifies it; no separate
      // userContext envelope (which would be a forgeable plaintext sub).
      authorization: identityToken,
      ...(opts.headers ?? {}),
    },
    requestContext: {
      http: { method, path: fullPath },
    },
  };
  if (Object.keys(queryParams).length > 0) {
    event['queryStringParameters'] = queryParams;
  }
  if (opts.body !== undefined) {
    event['body'] = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    event['isBase64Encoded'] = false;
  }

  // Lambda function name follows the API-Gateway-fronted convention:
  // `<clientName>_<lambda-name>` (underscore separator — see CLAUDE.md
  // "Deployed Lambda Naming" section).
  const functionName = `${account}_numa-cli-api`;

  let res;
  try {
    res = await lambdaClient().send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(event)),
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, method, `lambda://${functionName}${fullPath}`, `InvokeCommand failed: ${msg}`);
  }

  if (res.FunctionError) {
    const payload = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '';
    throw new ApiError(500, method, `lambda://${functionName}${fullPath}`, `Lambda ${res.FunctionError}: ${payload}`);
  }

  const payloadStr = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '';
  let parsed: { statusCode?: number; body?: string; isBase64Encoded?: boolean };
  try {
    parsed = JSON.parse(payloadStr) as typeof parsed;
  } catch {
    throw new ApiError(
      500,
      method,
      `lambda://${functionName}${fullPath}`,
      `Lambda returned non-JSON payload: ${payloadStr.slice(0, 200)}`
    );
  }

  const status = parsed.statusCode ?? 200;
  const bodyStr =
    parsed.isBase64Encoded && parsed.body ? Buffer.from(parsed.body, 'base64').toString('utf-8') : (parsed.body ?? '');

  if (status < 200 || status >= 300) {
    throw new ApiError(status, method, `lambda://${functionName}${fullPath}`, bodyStr);
  }
  if (bodyStr.length === 0) return undefined as T;
  try {
    return JSON.parse(bodyStr) as T;
  } catch {
    return bodyStr as unknown as T;
  }
}
