/**
 * Dispatch a tool call to `kb_manager`. Synthetic API Gateway v2 event with
 * the right method + path; kb_manager parses it through mangum exactly like
 * a real CloudFront-routed request.
 *
 * Path templates use `{placeholder}` substitution from params. Substituted
 * keys are removed from the params object before being sent as the request
 * body, so a tool that takes `kb_id` for the URL doesn't also send it as a
 * body field.
 *
 * Caller forwards the user's access token + the CloudFront shared secret —
 * kb_manager runs its standard auth on both.
 */

import { InvokeCommand } from '@aws-sdk/client-lambda';

import { lambdaClient } from '../shared/aws.js';

export interface KbManagerDispatchInput {
  clientName: string;
  cloudfrontSecret: string;
  accessToken: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pathTemplate: string;
  params: Record<string, unknown>;
}

export interface KbManagerDispatchOutput {
  statusCode: number;
  body: unknown;
}

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

/**
 * Thrown when a path-template placeholder can't be filled from request
 * params. The dispatcher maps this to HTTP 400 (client bug) rather than
 * the generic 500 it would default to.
 */
export class MissingPathParamError extends Error {
  readonly name = 'MissingPathParamError';
}

/**
 * Substitute `{placeholder}` segments in the path with the matching value
 * from params. Returns the substituted path and the params with those keys
 * removed (so they don't appear in the request body).
 */
const substitutePathTemplate = (
  template: string,
  params: Record<string, unknown>
): { path: string; remainingParams: Record<string, unknown> } => {
  const consumed = new Set<string>();
  const path = template.replace(PLACEHOLDER_RE, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) {
      throw new MissingPathParamError(`Path template '${template}' requires param '${name}' but it was missing`);
    }
    consumed.add(name);
    return encodeURIComponent(String(value));
  });

  const remainingParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!consumed.has(k)) remainingParams[k] = v;
  }
  return { path, remainingParams };
};

/**
 * API Gateway v2 typing says `queryStringParameters` is `Record<string, string>`,
 * and mangum's URL builder assumes that. Coerce — primitives stringify
 * sensibly, objects/arrays don't and would silently produce `[object Object]`,
 * so we reject them instead of producing garbage URL strings.
 */
const coerceQuery = (params: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    else throw new MissingPathParamError(`GET query param '${k}' is ${typeof v} — only string|number|boolean allowed`);
  }
  return out;
};

export const invokeKbManager = async (input: KbManagerDispatchInput): Promise<KbManagerDispatchOutput> => {
  const { path, remainingParams } = substitutePathTemplate(input.pathTemplate, input.params);
  const hasBody = input.method !== 'GET' && Object.keys(remainingParams).length > 0;

  const event = {
    version: '2.0',
    rawPath: path,
    rawQueryString: '',
    headers: {
      // Include the `Bearer ` prefix for cross-Lambda hygiene. kb_manager
      // strips it before verification (`verify_jwt_token`) and other
      // downstream lambdas behave the same, but the standard auth-header
      // convention has the prefix.
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
      // kb_manager sits behind a CloudFront-fronted Function URL and gates
      // on this header. The same secret the bootstrap aggregator forwards
      // when it reads /api/kb to populate the knowledge_bases field.
      'x-arcanum-cloudfront-secret': input.cloudfrontSecret,
    },
    requestContext: {
      // sourceIp is required by mangum (kb_manager's ASGI adapter).
      http: { method: input.method, path, sourceIp: '127.0.0.1' },
    },
    queryStringParameters: input.method === 'GET' ? coerceQuery(remainingParams) : {},
    body: hasBody ? JSON.stringify(remainingParams) : undefined,
    isBase64Encoded: false,
  };

  const functionName = `${input.clientName}_kb_manager`;
  const res = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(event)),
      InvocationType: 'RequestResponse',
    })
  );

  if (res.FunctionError) {
    const payload = res.Payload ? Buffer.from(res.Payload).toString('utf-8') : '<empty>';
    throw new Error(`${functionName}: ${res.FunctionError} — ${payload.slice(0, 500)}`);
  }
  if (!res.Payload) throw new Error(`${functionName}: empty payload`);

  const raw = Buffer.from(res.Payload).toString('utf-8');
  const parsed = JSON.parse(raw) as { statusCode?: number; body?: string };
  const statusCode = typeof parsed.statusCode === 'number' ? parsed.statusCode : 500;

  let body: unknown;
  if (typeof parsed.body === 'string') {
    try {
      body = JSON.parse(parsed.body);
    } catch {
      body = parsed.body;
    }
  } else {
    body = parsed;
  }
  return { statusCode, body };
};
