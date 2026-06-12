/**
 * numa-cli-api — entry point.
 *
 * Thin HTTP router. Each route delegates to a handler module under `src/`.
 * Keep this file small on purpose: the goal is that the route table reads
 * like a sitemap — a new route should mean a single new branch here plus a
 * new module under `src/<area>/`.
 *
 * Routes:
 *   POST/GET /api/cli/bootstrap     — canonical "what does this user have
 *                                     access to" lookup. The CLI consumes
 *                                     this via `numa bootstrap`; long-term
 *                                     the workspace chat agent consumes it
 *                                     at chat-start instead of having the
 *                                     frontend assemble piecemeal context.
 *                                     See `src/bootstrap/`.
 *   POST     /api/cli/tools/invoke  — dispatch a tool call to
 *                                     `workspace-chat-tools`. Drop-in
 *                                     replacement for what the workspace
 *                                     MCP layer does so the CLI can drive
 *                                     the same actions Numa-the-LLM drives.
 *                                     See `src/tools/`.
 *
 * Auth: identity is established in `src/shared/auth.ts` by cryptographically
 * VERIFYING the Cognito JWT in the Authorization header (id token from the
 * workspace MicroVM, access token from the laptop CLI). We verify in-Lambda
 * rather than trust the upstream API-GW authorizer because a direct
 * `lambda:Invoke` (which the workspace IAM role can do) controls the entire
 * event payload — there's no trustworthy "came via API Gateway" signal. See
 * the header comment in `src/shared/auth.ts` for the full threat model.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { handleBootstrap } from './src/bootstrap/index.js';
import { handleIntegrationDocs } from './src/integrations/docs.js';
import { resolveAuthContext } from './src/shared/auth.js';
import { errorResponse, HEADERS } from './src/shared/response.js';
import { handleToolInvoke, type ToolInvokeRequest } from './src/tools/index.js';

const readJsonBody = (event: APIGatewayProxyEventV2): unknown => {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http?.method ?? 'GET';
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  const auth = await resolveAuthContext(event);
  if (!auth) {
    return errorResponse(401, 'Missing or invalid authorization token');
  }

  // /api/cli/bootstrap — accept POST (matches the spec) and GET (no body,
  // easier for ad-hoc curl testing). Same handler either way.
  if (/\/api\/cli\/bootstrap\/?$/.test(rawPath) && (method === 'POST' || method === 'GET')) {
    return handleBootstrap(auth);
  }

  // /api/cli/tools/invoke — generic tool dispatcher.
  if (/\/api\/cli\/tools\/invoke\/?$/.test(rawPath) && method === 'POST') {
    const body = readJsonBody(event);
    if (body === null || typeof body !== 'object') {
      return errorResponse(400, 'Body must be a JSON object');
    }
    return handleToolInvoke(auth, body as ToolInvokeRequest);
  }

  // /api/cli/integrations/<slug>/docs?method=pipedream|native — fetch the
  // integration's reference docs. Pipedream gets an action index; native
  // gets the markdown bundle. CLI caches the response locally and prefers
  // /workdir/{tools/integrations|api-docs}/<slug>/ when running inside a
  // workspace (skipping this endpoint entirely).
  const docsMatch = /\/api\/cli\/integrations\/([a-z0-9_-]+)\/docs\/?$/i.exec(rawPath);
  if (docsMatch && method === 'GET') {
    const slug = docsMatch[1]!;
    const methodParam = event.queryStringParameters?.['method'];
    if (methodParam !== 'pipedream' && methodParam !== 'native') {
      return errorResponse(400, "Query param 'method' must be 'pipedream' or 'native'");
    }
    return handleIntegrationDocs(auth, slug, methodParam);
  }

  return errorResponse(404, `numa-cli-api: no route for ${method} ${rawPath}`);
};
