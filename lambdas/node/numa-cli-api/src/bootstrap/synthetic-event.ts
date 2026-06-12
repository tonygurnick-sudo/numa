/**
 * Synthetic API Gateway v2 event builder + invoke helper, used by bootstrap
 * to call the same downstream lambdas that normally sit behind CloudFront →
 * API Gateway. The downstream handlers (`agents`, `admin-integration-
 * settings-get`, `chat-settings-get`, `kb_manager`, etc.) all read the JWT
 * straight off the `authorization` header — so forwarding the caller's
 * access token gives them the same view they'd have on a real CloudFront-
 * routed call.
 */

import { InvokeCommand } from '@aws-sdk/client-lambda';

import { lambdaClient } from '../shared/aws.js';

export const buildSyntheticEvent = (
  method: string,
  path: string,
  authorization: string,
  query?: Record<string, string>,
  extraHeaders?: Record<string, string>
): unknown => ({
  version: '2.0',
  rawPath: path,
  rawQueryString: query
    ? Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '',
  headers: {
    authorization,
    'content-type': 'application/json',
    ...(extraHeaders ?? {}),
  },
  requestContext: {
    // `sourceIp` is required by `mangum` (the ASGI adapter used by kb_manager
    // and other FastAPI-based lambdas). Other downstream lambdas just ignore
    // it. 127.0.0.1 signals "synthetic / loopback" — these calls are never
    // user-IP-attributable since they come from one Lambda calling another.
    http: { method, path, sourceIp: '127.0.0.1' },
  },
  queryStringParameters: query ?? {},
  isBase64Encoded: false,
});

/**
 * Invoke a downstream Lambda with a synthetic API Gateway event and parse
 * the JSON body it returns. Throws on any non-2xx so callers in strict-mode
 * (bootstrap's Promise.allSettled fan-out) see a loud failure.
 */
export const invokeAndParse = async (functionName: string, syntheticEvent: unknown): Promise<unknown> => {
  const res = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(syntheticEvent)),
      InvocationType: 'RequestResponse',
    })
  );
  if (res.FunctionError) {
    const payload = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '<empty>';
    throw new Error(`${functionName}: ${res.FunctionError} — ${payload}`);
  }
  if (!res.Payload) {
    throw new Error(`${functionName}: empty payload`);
  }
  const raw = Buffer.from(res.Payload).toString('utf-8');
  let parsed: { statusCode?: number; body?: string };
  try {
    parsed = JSON.parse(raw) as { statusCode?: number; body?: string };
  } catch {
    throw new Error(`${functionName}: returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (typeof parsed.statusCode === 'number' && (parsed.statusCode < 200 || parsed.statusCode >= 300)) {
    throw new Error(`${functionName}: HTTP ${parsed.statusCode} — ${(parsed.body ?? '').slice(0, 200)}`);
  }
  if (typeof parsed.body !== 'string') {
    // Some Lambdas return the body as an object directly (not API Gateway-
    // shaped). Treat the whole payload as the result in that case.
    return parsed;
  }
  try {
    return JSON.parse(parsed.body);
  } catch {
    return parsed.body;
  }
};
