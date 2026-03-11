/**
 * V2 Apps API Lambda
 *
 * CRUD endpoints for V2 app runs. Tracks run lifecycle in DynamoDB and
 * delegates execution to the workspace agent via the proxy Lambda.
 *
 * Routes:
 *   POST   /api/v2-apps/runs              — Create a new run
 *   GET    /api/v2-apps/runs              — List runs (filterable by appId, userId)
 *   GET    /api/v2-apps/runs/{runId}      — Get a single run (checks S3 for completion)
 *   PUT    /api/v2-apps/runs/{runId}      — Update a run
 *   DELETE /api/v2-apps/runs/{runId}      — Delete a run
 *   POST   /api/v2-apps/runs/{runId}/start — Start execution (invokes workspace proxy)
 *   POST   /api/v2-apps/runs/{runId}/follow-up — Create and start a follow-up run on a completed run
 *   GET    /api/v2-apps/files?prefix=...   — List files at a prefix
 *   POST   /api/v2-apps/files/upload-url   — Get presigned upload URL
 *   DELETE /api/v2-apps/files?key=...      — Delete a file
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { withPRM } from '../../../lib/prm-node/prm';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RUNS_TABLE = process.env.V2_APP_RUNS_TABLE as string;
const SETTINGS_TABLE = process.env.V2_APP_SETTINGS_TABLE as string;
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME as string;
const WORKSPACE_PROXY_FUNCTION = process.env.WORKSPACE_PROXY_FUNCTION_NAME as string;

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambda = new LambdaClient({});
const s3 = withPRM(S3Client, {});

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
};

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) return null;
  const groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return {
    sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    name: typeof claims.name === 'string' ? claims.name : undefined,
    groups,
  };
};

const jsonResponse = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode: number, message: string) => jsonResponse(statusCode, { error: message });

const parseBody = (event: APIGatewayProxyEventV2): Record<string, unknown> => {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('v2-apps-api parseBody failed', {
      isBase64Encoded: event.isBase64Encoded,
      bodyLength: event.body?.length,
      bodyPreview: event.body?.slice(0, 100),
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
};

const buildPathSegments = (event: APIGatewayProxyEventV2): string[] => {
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';
  const trimmed = rawPath.replace(/^\/+/, '');
  const withoutApi = trimmed.startsWith('api/') ? trimmed.slice(4) : trimmed;
  return withoutApi.split('/').filter(Boolean);
};

// ---------------------------------------------------------------------------
// Run record types
// ---------------------------------------------------------------------------

interface RunRecord {
  runId: string;
  appId: string;
  actionId: string;
  userId: string;
  userEmail: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  inputs: {
    prompt: string;
    files: string[];
    options: Record<string, unknown>;
  };
  result?: {
    text: string;
    artifacts: unknown[];
    usage: Record<string, unknown>;
  };
  error?: string;
  s3Prefix: string;
  agentType: string;
  name: string;
  /** Stable conversation ID shared across follow-up runs. Defaults to runId for original runs. */
  conversationId?: string;
  /** If this is a follow-up run, the runId of the parent run. */
  parentRunId?: string;
}

// ---------------------------------------------------------------------------
// S3 result checking
// ---------------------------------------------------------------------------

const checkS3Result = async (
  s3Prefix: string,
  userId: string,
  conversationId: string
): Promise<RunRecord['result'] | null> => {
  if (!OUTPUTS_BUCKET || !s3Prefix) return null;

  // Build the result key following the same pattern as workspace agent's
  // _build_result_key: {s3_prefix}/_result.json
  // The s3_prefix_template uses {user_sub} and {conversation_id} placeholders
  const formattedPrefix = s3Prefix.replace('{user_sub}', userId).replace('{conversation_id}', conversationId);
  const resultKey = `${formattedPrefix}/_result.json`;

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: OUTPUTS_BUCKET,
        Key: resultKey,
      })
    );
    const bodyStr = await response.Body?.transformToString('utf-8');
    if (!bodyStr) return null;
    const parsed = JSON.parse(bodyStr);
    return {
      text: parsed.text || '',
      artifacts: parsed.artifacts || [],
      usage: parsed.usage || {},
    };
  } catch (err: unknown) {
    // NoSuchKey means the run is still in progress
    if (err && typeof err === 'object' && 'name' in err && err.name === 'NoSuchKey') {
      return null;
    }
    console.error('Failed to check S3 result', err);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

/** Fetch run and verify the authenticated user owns it. Returns the run or an error response. */
const getOwnedRun = async (
  runId: string,
  auth: AuthContext
): Promise<RunRecord | { statusCode: number; headers: typeof HEADERS; body: string }> => {
  const result = await dynamo.send(new GetCommand({ TableName: RUNS_TABLE, Key: { runId } }));
  if (!result.Item) return errorResponse(404, 'Run not found');
  const run = result.Item as RunRecord;
  if (run.userId !== auth.sub) {
    console.warn('v2-apps-api authorization denied', runId, auth.sub, run.userId);
    return errorResponse(403, 'Forbidden');
  }
  return run;
};

/** Check if an S3 key/prefix is accessible by the given user. */
const isKeyAccessible = (key: string, userSub: string): boolean => {
  const parts = key.split('/');
  // Must be at least v2-apps/{appId}/{segment}
  if (parts.length < 3 || parts[0] !== 'v2-apps') return false;

  const thirdSegment = parts[2];

  // Company-scoped: v2-apps/{appId}/data/... → shared, allow
  if (thirdSegment === 'data') return true;

  // User-scoped workspace: v2-apps/{appId}/user/{userSub}/data/...
  if (thirdSegment === 'user') return parts.length >= 4 && parts[3] === userSub;

  // Per-run files: v2-apps/{appId}/{userSub}/{runId}/...
  return thirdSegment === userSub;
};

// ---------------------------------------------------------------------------
// Runs handlers
// ---------------------------------------------------------------------------

const handleCreateRun = async (body: Record<string, unknown>, auth: AuthContext) => {
  const appId = body.appId as string;
  const actionId = (body.actionId as string) || 'default';
  const files = (body.files as string[]) || [];
  const options = (body.options as Record<string, unknown>) || {};
  const agentType = (body.agentType as string) || `${appId}-v2`;

  // Prompt is optional when files are provided — default to a file-processing instruction
  const prompt =
    (body.prompt as string) || (files.length > 0 ? `Process the uploaded file(s): ${files.join(', ')}` : '');

  if (!appId || !prompt) {
    const missing = [!appId && 'appId', !prompt && 'prompt'].filter(Boolean).join(', ');
    console.warn('v2-apps-api createRun missing required fields', { appId, hasPrompt: !!prompt });
    return errorResponse(400, `Missing required fields: ${missing}`);
  }

  const runId = typeof body.runId === 'string' && body.runId.length > 0 ? body.runId : randomUUID();
  const now = new Date().toISOString();
  const s3Prefix = `v2-apps/${appId}/{user_sub}/{conversation_id}`;

  const record: RunRecord = {
    runId,
    appId,
    actionId,
    userId: auth.sub,
    userEmail: (body.userEmail as string) || auth.email || 'unknown',
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    inputs: { prompt, files, options },
    s3Prefix,
    agentType,
    name: (body.name as string) || `${appId} - ${new Date().toLocaleDateString()}`,
    conversationId: runId,
  };

  await dynamo.send(
    new PutCommand({
      TableName: RUNS_TABLE,
      Item: record,
    })
  );

  console.info('v2-apps-api run created', runId, appId, agentType, auth.sub);
  return jsonResponse(201, record);
};

const handleListRuns = async (event: APIGatewayProxyEventV2, auth: AuthContext) => {
  const params = event.queryStringParameters || {};
  const appId = params.appId;
  const conversationIdFilter = params.conversationId;
  const limit = Math.min(parseInt(params.limit || '20', 10), 100);
  const nextToken = params.nextToken;

  // Query by userId (default) or appId, optionally filtered by conversationId
  let queryParams;
  if (appId) {
    const filterParts = ['userId = :userId'];
    const exprValues: Record<string, unknown> = { ':appId': appId, ':userId': auth.sub };
    if (conversationIdFilter) {
      filterParts.push('conversationId = :convId');
      exprValues[':convId'] = conversationIdFilter;
    }
    queryParams = {
      TableName: RUNS_TABLE,
      IndexName: 'appId-createdAt-index',
      KeyConditionExpression: 'appId = :appId',
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: exprValues,
      ScanIndexForward: false, // newest first
      Limit: limit,
      ...(nextToken ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, 'base64').toString()) } : {}),
    };
  } else {
    const exprValues: Record<string, unknown> = { ':userId': auth.sub };
    let filterExpression: string | undefined;
    if (conversationIdFilter) {
      filterExpression = 'conversationId = :convId';
      exprValues[':convId'] = conversationIdFilter;
    }
    queryParams = {
      TableName: RUNS_TABLE,
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: exprValues,
      ...(filterExpression ? { FilterExpression: filterExpression } : {}),
      ScanIndexForward: false,
      Limit: limit,
      ...(nextToken ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, 'base64').toString()) } : {}),
    };
  }

  const result = await dynamo.send(new QueryCommand(queryParams));

  const response: Record<string, unknown> = {
    runs: result.Items || [],
    count: result.Count || 0,
  };
  if (result.LastEvaluatedKey) {
    response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return jsonResponse(200, response);
};

const handleGetRun = async (runId: string, auth: AuthContext) => {
  const owned = await getOwnedRun(runId, auth);
  if ('statusCode' in owned) return owned;

  const run = owned;

  // If run is PROCESSING, check S3 for completion or timeout
  if (run.status === 'PROCESSING') {
    // Timeout: if PROCESSING for over 2 hours, mark as FAILED
    const PROCESSING_TIMEOUT_MS = 2 * 60 * 60 * 1000;
    const startedAt = new Date(run.updatedAt).getTime();
    const elapsed = Date.now() - startedAt;

    if (elapsed > PROCESSING_TIMEOUT_MS) {
      const now = new Date().toISOString();
      console.warn('v2-apps-api run timed out after 2 hours', runId, run.appId);

      await dynamo.send(
        new UpdateCommand({
          TableName: RUNS_TABLE,
          Key: { runId },
          UpdateExpression: 'SET #status = :status, #error = :error, updatedAt = :now, completedAt = :now',
          ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
          ExpressionAttributeValues: {
            ':status': 'FAILED',
            ':error': 'Run timed out after 2 hours without producing a result.',
            ':now': now,
          },
        })
      );

      run.status = 'FAILED';
      run.error = 'Run timed out after 2 hours without producing a result.';
      run.updatedAt = now;
      run.completedAt = now;
    } else {
      const s3Result = await checkS3Result(run.s3Prefix, run.userId, run.conversationId || run.runId);
      if (s3Result) {
        const s3Status = s3Result.text ? 'COMPLETED' : 'FAILED';
        const now = new Date().toISOString();
        console.info('v2-apps-api run completed via S3 result', runId, s3Status);

        await dynamo.send(
          new UpdateCommand({
            TableName: RUNS_TABLE,
            Key: { runId },
            UpdateExpression: 'SET #status = :status, #result = :result, updatedAt = :now, completedAt = :now',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#result': 'result',
            },
            ExpressionAttributeValues: {
              ':status': s3Status,
              ':result': s3Result,
              ':now': now,
            },
          })
        );

        run.status = s3Status as RunRecord['status'];
        run.result = s3Result;
        run.updatedAt = now;
        run.completedAt = now;
      }
    }
  }

  return jsonResponse(200, run);
};

const handleUpdateRun = async (runId: string, body: Record<string, unknown>, auth: AuthContext) => {
  const owned = await getOwnedRun(runId, auth);
  if ('statusCode' in owned) return owned;

  const now = new Date().toISOString();
  const updates: string[] = ['updatedAt = :now'];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':now': now, ':expectedUser': auth.sub };

  if (body.status !== undefined) {
    updates.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = body.status;
  }
  if (body.result !== undefined) {
    updates.push('#result = :result');
    names['#result'] = 'result';
    values[':result'] = body.result;
  }
  if (body.error !== undefined) {
    updates.push('#error = :error');
    names['#error'] = 'error';
    values[':error'] = body.error;
  }
  if (body.completedAt !== undefined) {
    updates.push('completedAt = :completedAt');
    values[':completedAt'] = body.completedAt;
  }
  if (body.name !== undefined) {
    updates.push('#name = :name');
    names['#name'] = 'name';
    values[':name'] = body.name;
  }

  const result = await dynamo.send(
    new UpdateCommand({
      TableName: RUNS_TABLE,
      Key: { runId },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ConditionExpression: 'userId = :expectedUser',
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );

  return jsonResponse(200, result.Attributes);
};

const handleDeleteRun = async (runId: string, auth: AuthContext) => {
  const owned = await getOwnedRun(runId, auth);
  if ('statusCode' in owned) return owned;

  await dynamo.send(
    new DeleteCommand({
      TableName: RUNS_TABLE,
      Key: { runId },
      ConditionExpression: 'userId = :expectedUser',
      ExpressionAttributeValues: { ':expectedUser': auth.sub },
    })
  );

  console.info('v2-apps-api run deleted', runId);
  return jsonResponse(200, { deleted: true });
};

const handleStartRun = async (runId: string, auth: AuthContext, event: APIGatewayProxyEventV2) => {
  // Get the run record
  const getResult = await dynamo.send(
    new GetCommand({
      TableName: RUNS_TABLE,
      Key: { runId },
    })
  );

  if (!getResult.Item) {
    return errorResponse(404, 'Run not found');
  }

  const run = getResult.Item as RunRecord;

  if (run.userId !== auth.sub) {
    console.warn('v2-apps-api startRun authorization denied', runId, auth.sub, run.userId);
    return errorResponse(403, 'Forbidden');
  }

  if (run.status !== 'PENDING') {
    console.warn('v2-apps-api startRun called on non-PENDING run', runId, run.status);
    return errorResponse(400, `Run is already ${run.status}`);
  }

  console.info('v2-apps-api starting run', runId, run.appId, run.agentType);

  // Update status to PROCESSING
  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateCommand({
      TableName: RUNS_TABLE,
      Key: { runId },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'PROCESSING', ':now': now },
    })
  );

  // Invoke the workspace proxy Lambda with fire-and-forget payload
  // The proxy Lambda is invoked asynchronously (Event invocation type)
  // so it returns immediately while the workspace agent runs in background.
  //
  // We pass the authorization header through so the proxy can validate
  // the user and route to the correct AgentCore session.
  // Extract workspace settings from the stored run options
  const options = (run.inputs?.options || {}) as Record<string, unknown>;
  const enabledKBs = (options.enabledKBs as Array<{ id: string; name: string }>) || [];
  const enabledKBIds = (options.enabledKBIds as string[]) || [];
  const enabledTools = (options.enabledTools as string[]) || [];
  const enabledConnections = (options.enabledConnections as string[]) || [];
  const contextInstructions = (options.contextInstructions as string) || '';

  // Build availableKBs in {id, name} format expected by workspace agent
  const availableKBs = enabledKBs.length > 0 ? enabledKBs : enabledKBIds.map((id: string) => ({ id, name: id }));

  // Auto-add 'knowledge_base' to enabledTools when KBs are selected
  // (matches chat page behavior in getEnabledTools)
  const finalTools = [...enabledTools];
  if (availableKBs.length > 0 && !finalTools.includes('knowledge_base')) {
    finalTools.push('knowledge_base');
  }

  // Prepend context instructions to prompt (agent doesn't read this field separately)
  const effectivePrompt = contextInstructions
    ? `[Context Instructions]\n${contextInstructions}\n\n[User Request]\n${run.inputs.prompt}`
    : run.inputs.prompt;

  // Build payload in API Gateway V2 / Lambda Function URL format so that
  // the Lambda Web Adapter (LWA) in the proxy recognises it as an HTTP
  // event and forwards it to the FastAPI app at the correct path.
  // Without this format LWA falls back to POST /events → 404.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const requestBody = JSON.stringify({
    action: 'chat',
    conversationId: run.conversationId || runId,
    type: run.agentType,
    responseMode: 'fire-and-forget',
    prompt: effectivePrompt,
    availableKBs,
    enabledTools: finalTools,
    enabledConnections,
    userEmail: run.userEmail || auth.email || '',
    // App workspace file prefixes for the agent to download into /workdir/app-workspace/
    workspacePrefixes: [`v2-apps/${run.appId}/data/`, `v2-apps/${run.appId}/user/${auth.sub}/data/`],
    // Upload file prefixes for the agent to download into /workdir/uploads/
    uploadPrefixes: [`v2-apps/${run.appId}/${auth.sub}/${run.conversationId || runId}/uploads/`],
  });

  const proxyPayload = {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/api/workspace-chat-agent/invocations',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      authorization: authHeader,
    },
    requestContext: {
      http: {
        method: 'POST',
        path: '/api/workspace-chat-agent/invocations',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'v2-apps-api/1.0',
      },
      requestId: runId,
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: requestBody,
    isBase64Encoded: false,
  };

  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: WORKSPACE_PROXY_FUNCTION,
        InvocationType: 'Event', // Async — don't wait for result
        Payload: Buffer.from(JSON.stringify(proxyPayload)),
      })
    );
  } catch (err) {
    console.error('Failed to invoke workspace proxy', err);
    // Revert status
    await dynamo.send(
      new UpdateCommand({
        TableName: RUNS_TABLE,
        Key: { runId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now, #error = :error',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':now': new Date().toISOString(),
          ':error': `Failed to invoke workspace agent: ${err}`,
        },
      })
    );
    return errorResponse(500, 'Failed to start run');
  }

  console.info('v2-apps-api workspace proxy invoked', runId, WORKSPACE_PROXY_FUNCTION);
  return jsonResponse(200, {
    runId,
    status: 'PROCESSING',
    message: 'Run started. Poll GET /api/v2-apps/runs/{runId} for results.',
  });
};

const handleFollowUp = async (
  parentRunId: string,
  body: Record<string, unknown>,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
) => {
  // Verify ownership of parent run
  const parentOwned = await getOwnedRun(parentRunId, auth);
  if ('statusCode' in parentOwned) return parentOwned;
  const parent = parentOwned;

  if (parent.status !== 'COMPLETED') {
    return errorResponse(400, `Cannot follow up on a run with status ${parent.status}`);
  }

  const prompt = body.prompt as string;
  if (!prompt) {
    return errorResponse(400, 'Missing required field: prompt');
  }

  // Create a new run record inheriting from the parent
  const files = (body.files as string[]) || [];
  const runId = typeof body.runId === 'string' && body.runId.length > 0 ? body.runId : randomUUID();
  const now = new Date().toISOString();
  const conversationId = parent.conversationId || parent.runId;

  const record: RunRecord = {
    runId,
    appId: parent.appId,
    actionId: parent.actionId,
    userId: auth.sub,
    userEmail: parent.userEmail || auth.email || 'unknown',
    status: 'PROCESSING',
    createdAt: now,
    updatedAt: now,
    inputs: { prompt, files, options: parent.inputs.options },
    s3Prefix: parent.s3Prefix,
    agentType: parent.agentType,
    name: prompt.slice(0, 60),
    conversationId,
    parentRunId,
  };

  await dynamo.send(new PutCommand({ TableName: RUNS_TABLE, Item: record }));

  console.info('v2-apps-api follow-up run created', runId, 'parent:', parentRunId, 'conversation:', conversationId);

  // Build and invoke workspace proxy — reuse parent's settings
  const options = (parent.inputs?.options || {}) as Record<string, unknown>;
  const enabledKBs = (options.enabledKBs as Array<{ id: string; name: string }>) || [];
  const enabledKBIds = (options.enabledKBIds as string[]) || [];
  const enabledTools = (options.enabledTools as string[]) || [];
  const enabledConnections = (options.enabledConnections as string[]) || [];
  const contextInstructions = (options.contextInstructions as string) || '';

  const availableKBs = enabledKBs.length > 0 ? enabledKBs : enabledKBIds.map((id: string) => ({ id, name: id }));

  const finalTools = [...enabledTools];
  if (availableKBs.length > 0 && !finalTools.includes('knowledge_base')) {
    finalTools.push('knowledge_base');
  }

  const effectivePrompt = contextInstructions
    ? `[Context Instructions]\n${contextInstructions}\n\n[User Request]\n${prompt}`
    : prompt;

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const requestBody = JSON.stringify({
    action: 'chat',
    conversationId,
    type: record.agentType,
    responseMode: 'fire-and-forget',
    prompt: effectivePrompt,
    availableKBs,
    enabledTools: finalTools,
    enabledConnections,
    userEmail: record.userEmail || auth.email || '',
    workspacePrefixes: [`v2-apps/${parent.appId}/data/`, `v2-apps/${parent.appId}/user/${auth.sub}/data/`],
    // Upload file prefixes for the agent to download into /workdir/uploads/
    uploadPrefixes: [`v2-apps/${parent.appId}/${auth.sub}/${conversationId}/uploads/`],
  });

  const proxyPayload = {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/api/workspace-chat-agent/invocations',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      authorization: authHeader,
    },
    requestContext: {
      http: {
        method: 'POST',
        path: '/api/workspace-chat-agent/invocations',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'v2-apps-api/1.0',
      },
      requestId: runId,
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: requestBody,
    isBase64Encoded: false,
  };

  // Delete the previous _result.json so polling doesn't find the stale result
  // from the parent run (they share the same S3 path via conversationId).
  try {
    const resultKey =
      parent.s3Prefix.replace('{user_sub}', auth.sub).replace('{conversation_id}', conversationId) + '/_result.json';
    await s3.send(new DeleteObjectCommand({ Bucket: OUTPUTS_BUCKET, Key: resultKey }));
    console.info('v2-apps-api deleted stale _result.json for follow-up', resultKey);
  } catch (err) {
    // Non-fatal — if it doesn't exist or fails, polling will still work (just might be slower)
    console.warn('v2-apps-api failed to delete stale _result.json', err);
  }

  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: WORKSPACE_PROXY_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(proxyPayload)),
      })
    );
  } catch (err) {
    console.error('Failed to invoke workspace proxy for follow-up', err);
    await dynamo.send(
      new UpdateCommand({
        TableName: RUNS_TABLE,
        Key: { runId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now, #error = :error',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':now': new Date().toISOString(),
          ':error': `Failed to invoke workspace agent: ${err}`,
        },
      })
    );
    return errorResponse(500, 'Failed to start follow-up run');
  }

  console.info('v2-apps-api follow-up proxy invoked', runId, WORKSPACE_PROXY_FUNCTION);
  return jsonResponse(201, record);
};

// ---------------------------------------------------------------------------
// File handlers
// ---------------------------------------------------------------------------

const handleListFiles = async (event: APIGatewayProxyEventV2, auth: AuthContext) => {
  const params = event.queryStringParameters || {};
  const prefix = params.prefix;

  if (!prefix || !prefix.startsWith('v2-apps/')) {
    return errorResponse(400, 'Invalid or missing prefix — must start with v2-apps/');
  }

  if (!isKeyAccessible(prefix, auth.sub)) {
    return errorResponse(403, 'Forbidden');
  }

  const response = await s3.send(new ListObjectsV2Command({ Bucket: OUTPUTS_BUCKET, Prefix: prefix }));

  const files = (response.Contents || [])
    .filter((obj) => obj.Key && obj.Key !== prefix)
    .map((obj) => ({
      key: obj.Key!,
      name: obj.Key!.replace(prefix, ''),
      size: obj.Size || 0,
      lastModified: obj.LastModified?.toISOString() || new Date().toISOString(),
    }));

  return jsonResponse(200, { files });
};

const handleGetUploadUrl = async (body: Record<string, unknown>, auth: AuthContext) => {
  const key = body.key as string;
  const contentType = (body.contentType as string) || 'application/octet-stream';

  if (!key || !key.startsWith('v2-apps/')) {
    return errorResponse(400, 'Invalid or missing key — must start with v2-apps/');
  }

  if (!isKeyAccessible(key, auth.sub)) {
    return errorResponse(403, 'Forbidden');
  }

  const command = new PutObjectCommand({
    Bucket: OUTPUTS_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = await getSignedUrl(s3 as any, command, { expiresIn: 3600 });

  return jsonResponse(200, { url, key });
};

const handleDeleteFile = async (event: APIGatewayProxyEventV2, auth: AuthContext) => {
  const params = event.queryStringParameters || {};
  const key = params.key;

  if (!key || !key.startsWith('v2-apps/')) {
    return errorResponse(400, 'Invalid or missing key — must start with v2-apps/');
  }

  if (!isKeyAccessible(key, auth.sub)) {
    return errorResponse(403, 'Forbidden');
  }

  await s3.send(new DeleteObjectCommand({ Bucket: OUTPUTS_BUCKET, Key: key }));

  return jsonResponse(200, { deleted: true });
};

const handleFiles = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
) => {
  // GET /v2-apps/files — list files at prefix
  if (method === 'GET' && segments.length === 0) {
    return handleListFiles(event, auth);
  }
  // POST /v2-apps/files/upload-url — get presigned upload URL
  if (method === 'POST' && segments.length === 1 && segments[0] === 'upload-url') {
    return handleGetUploadUrl(body, auth);
  }
  // DELETE /v2-apps/files — delete a file by key
  if (method === 'DELETE' && segments.length === 0) {
    return handleDeleteFile(event, auth);
  }
  return errorResponse(404, 'Route not found');
};

// ---------------------------------------------------------------------------
// Settings handlers
// ---------------------------------------------------------------------------

const handleGetSettings = async (event: APIGatewayProxyEventV2, auth: AuthContext) => {
  const params = event.queryStringParameters || {};
  const appId = params.appId;

  if (!appId) {
    return errorResponse(400, 'Missing required query parameter: appId');
  }

  if (!SETTINGS_TABLE) {
    return errorResponse(500, 'Server configuration error: missing SETTINGS_TABLE');
  }

  const result = await dynamo.send(
    new GetCommand({
      TableName: SETTINGS_TABLE,
      Key: { appId, userId: auth.sub },
    })
  );

  if (!result.Item) {
    return jsonResponse(200, { settings: null });
  }

  const { appId: _a, userId: _u, updatedAt, ...settings } = result.Item;
  return jsonResponse(200, { settings, updatedAt });
};

const handlePutSettings = async (body: Record<string, unknown>, auth: AuthContext) => {
  const appId = body.appId as string;
  const settings = body.settings as Record<string, unknown>;

  if (!appId || !settings) {
    return errorResponse(400, 'Missing required fields: appId, settings');
  }

  if (!SETTINGS_TABLE) {
    return errorResponse(500, 'Server configuration error: missing SETTINGS_TABLE');
  }

  const sanitized = {
    enabledKBIds: Array.isArray(settings.enabledKBIds)
      ? settings.enabledKBIds.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    enabledTools: Array.isArray(settings.enabledTools)
      ? settings.enabledTools.filter((t: unknown): t is string => typeof t === 'string')
      : ['web_search'],
    enabledConnections: Array.isArray(settings.enabledConnections)
      ? settings.enabledConnections.filter((c: unknown): c is string => typeof c === 'string')
      : [],
    workspaceAccess: typeof settings.workspaceAccess === 'boolean' ? settings.workspaceAccess : true,
    contextInstructions:
      typeof settings.contextInstructions === 'string' ? (settings.contextInstructions as string).slice(0, 5000) : '',
  };

  const now = new Date().toISOString();

  await dynamo.send(
    new PutCommand({
      TableName: SETTINGS_TABLE,
      Item: {
        appId,
        userId: auth.sub,
        ...sanitized,
        updatedAt: now,
      },
    })
  );

  console.info('v2-apps-api settings saved', appId, auth.sub);
  return jsonResponse(200, { settings: sanitized, updatedAt: now });
};

const handleSettings = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
) => {
  if (method === 'GET' && segments.length === 0) {
    return handleGetSettings(event, auth);
  }
  if (method === 'PUT' && segments.length === 0) {
    return handlePutSettings(body, auth);
  }
  return errorResponse(404, 'Route not found');
};

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

const handleRuns = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
) => {
  // POST /v2-apps/runs — create a new run
  if (method === 'POST' && segments.length === 0) {
    return handleCreateRun(body, auth);
  }

  // GET /v2-apps/runs — list runs
  if (method === 'GET' && segments.length === 0) {
    return handleListRuns(event, auth);
  }

  // GET /v2-apps/runs/{runId} — get a single run
  if (method === 'GET' && segments.length === 1) {
    return handleGetRun(segments[0], auth);
  }

  // PUT /v2-apps/runs/{runId} — update a run
  if (method === 'PUT' && segments.length === 1) {
    return handleUpdateRun(segments[0], body, auth);
  }

  // DELETE /v2-apps/runs/{runId} — delete a run
  if (method === 'DELETE' && segments.length === 1) {
    return handleDeleteRun(segments[0], auth);
  }

  // POST /v2-apps/runs/{runId}/start — start execution
  if (method === 'POST' && segments.length === 2 && segments[1] === 'start') {
    return handleStartRun(segments[0], auth, event);
  }

  // POST /v2-apps/runs/{runId}/follow-up — create and start a follow-up run
  if (method === 'POST' && segments.length === 2 && segments[1] === 'follow-up') {
    return handleFollowUp(segments[0], body, auth, event);
  }

  return errorResponse(404, 'Route not found');
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (event.requestContext.http?.method === 'OPTIONS') {
      return { statusCode: 200, headers: HEADERS, body: '' };
    }

    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Unauthorized');

    if (!RUNS_TABLE) {
      return errorResponse(500, 'Server configuration error: missing RUNS_TABLE');
    }

    const segments = buildPathSegments(event);
    const method = event.requestContext.http?.method ?? 'GET';
    const body = parseBody(event);

    // Expected path: v2-apps/runs/...
    if (segments[0] !== 'v2-apps') {
      return errorResponse(404, 'Not Found');
    }

    const resource = segments[1];
    const rest = segments.slice(2);

    switch (resource) {
      case 'runs':
        return handleRuns(method, rest, body, auth, event);
      case 'files':
        return handleFiles(method, rest, body, auth, event);
      case 'settings':
        return handleSettings(method, rest, body, auth, event);
      default:
        return errorResponse(404, 'Route not found');
    }
  } catch (error) {
    console.error('v2-apps-api unhandled error', error);
    return errorResponse(500, 'Internal Server Error');
  }
};
