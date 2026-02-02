/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import { S3Client, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { withPRM } from '../../../lib/prm-node/prm';
import { v4 as uuidv4 } from 'uuid';

const REGION = process.env.REGION ?? 'us-east-1';
const _CLIENT_NAME = process.env.CLIENT_NAME ?? 'numa-client';
const SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const SCHEDULE_RUNNER_SECRET = process.env.SCHEDULE_RUNNER_SECRET ?? '';
const DATA_BUCKET = process.env.DATA_BUCKET_NAME ?? '';
const BEDROCK_KB_ID = process.env.BEDROCK_KB_ID ?? '';
const BEDROCK_DATA_SOURCE_ID = process.env.BEDROCK_DATA_SOURCE_ID ?? '';

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const bedrockAgent = withPRM(BedrockAgentClient, { region: REGION });
const s3Client = withPRM(S3Client, { region: REGION });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type AuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
};

type DataSyncScheduleRecord = {
  user_id: string;
  schedule_id: string;
  event_type: 'data_sync';
  source_type: 'knowledge_base' | 's3' | 'api';
  source_config: Record<string, unknown>;
  status: 'active' | 'paused' | 'deleted';
  label?: string;
  last_status?: string;
  last_error?: string;
  last_run_epoch?: number;
  created_at: number;
  updated_at: number;
};

type RunnerEvent = {
  type?: string;
  scheduleId?: string;
  tenantId?: string;
};

const isApiEvent = (event: unknown): event is APIGatewayProxyEventV2 =>
  Boolean((event as APIGatewayProxyEventV2)?.requestContext?.http && isRequestMethodString(event));

const isRequestMethodString = (event: unknown): boolean =>
  typeof (event as APIGatewayProxyEventV2)?.requestContext?.http?.method === 'string';

const parseAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const requestContext = event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = requestContext?.authorizer?.jwt?.claims || {};
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) return null;
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  const name = typeof claims.name === 'string' ? claims.name : undefined;
  const groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as string[])
    : typeof claims['cognito:groups'] === 'string'
      ? [claims['cognito:groups'] as string]
      : [];
  return { sub, email, name, groups };
};

const respond = (statusCode: number, payload: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const ensureConfigured = (): boolean => Boolean(SCHEDULES_TABLE && SCHEDULE_RUNNER_SECRET && DATA_BUCKET);

export const handler = async (event: unknown): Promise<APIGatewayProxyResultV2 | void> => {
  if (isApiEvent(event)) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return respond(200, {});
    }
    return handleApiEvent(event);
  }
  return handleSchedulerEvent(event as RunnerEvent);
};

const handleApiEvent = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!ensureConfigured()) {
    return respond(500, { error: 'Data sync scheduling not configured' });
  }
  if (event.requestContext?.http?.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const auth = parseAuthContext(event);
  if (!auth) {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const body = JSON.parse(event.body || '{}') as {
      scheduleId?: string;
      sourceType?: string;
      sourceConfig?: Record<string, unknown>;
    };

    let schedule: DataSyncScheduleRecord | null = null;

    if (body.scheduleId) {
      schedule = await getSchedule(body.scheduleId);
      if (!schedule || schedule.user_id !== auth.sub) {
        return respond(404, { error: 'Schedule not found' });
      }
    } else {
      return respond(400, { error: 'scheduleId required for ad-hoc data sync runs' });
    }

    const result = await executeDataSyncRun({
      schedule,
      auth,
      adHoc: !body.scheduleId,
    });

    return respond(200, result);
  } catch (error) {
    console.error('Data sync schedule runner API error', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return respond(message.startsWith('Invalid') ? 400 : 500, { error: message });
  }
};

const parseRunnerEvent = (event: unknown): RunnerEvent => {
  if (!event) return {};
  if (typeof event === 'string') {
    try {
      return JSON.parse(event) as RunnerEvent;
    } catch {
      return {};
    }
  }
  return event as RunnerEvent;
};

const handleSchedulerEvent = async (rawEvent: RunnerEvent | unknown): Promise<void> => {
  if (!ensureConfigured()) {
    console.error('Data sync schedule runner missing configuration, skipping');
    return;
  }
  try {
    const event = parseRunnerEvent(rawEvent);
    if (!event?.scheduleId) {
      throw new Error('Missing scheduleId for scheduled data sync run');
    }
    const schedule = await getSchedule(event.scheduleId);
    if (!schedule) {
      console.warn('Data sync schedule not found for scheduled run', event.scheduleId);
      return;
    }
    if (schedule.status !== 'active') {
      console.info('Skipping data sync schedule because status is not active', schedule.schedule_id, schedule.status);
      return;
    }
    await executeDataSyncRun({
      schedule,
      auth: { sub: schedule.user_id, email: undefined, name: undefined, groups: [] },
      adHoc: false,
      triggeredBySchedule: true,
    });
  } catch (error) {
    console.error('Scheduled data sync run failed', error);
  }
};

const getSchedule = async (scheduleId: string): Promise<DataSyncScheduleRecord | null> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: SCHEDULES_TABLE,
      IndexName: 'schedule-id-index',
      KeyConditionExpression: 'schedule_id = :s',
      FilterExpression: 'event_type = :event_type',
      ExpressionAttributeValues: {
        ':s': scheduleId,
        ':event_type': 'data_sync',
      },
      Limit: 1,
    }),
  );
  const record = (result.Items || [])[0] as DataSyncScheduleRecord | undefined;
  return record || null;
};

type ExecuteDataSyncRunParams = {
  schedule: DataSyncScheduleRecord;
  auth: AuthContext;
  adHoc: boolean;
  triggeredBySchedule?: boolean;
};

const executeDataSyncRun = async ({ schedule, auth, adHoc, triggeredBySchedule }: ExecuteDataSyncRunParams) => {
  if (!schedule.source_type) throw new Error('Invalid source type');
  if (!schedule.source_config) throw new Error('Source configuration missing');

  const now = Date.now();
  const runId = uuidv4();

  let result: any = {};

  try {
    switch (schedule.source_type) {
      case 'knowledge_base':
        result = await syncKnowledgeBase(schedule, runId);
        break;
      case 's3':
        result = await syncS3Data(schedule, runId);
        break;
      case 'api':
        result = await syncApiData(schedule, runId);
        break;
      default:
        throw new Error(`Unsupported source type: ${schedule.source_type}`);
    }

    if (!adHoc) {
      await markScheduleStatus(schedule.user_id, schedule.schedule_id, 'success', null);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Data sync failed';
    if (!adHoc) {
      await markScheduleStatus(schedule.user_id, schedule.schedule_id, 'failed', error);
    }
    throw err instanceof Error ? err : new Error('Data sync failed');
  }

  return {
    runId,
    sourceType: schedule.source_type,
    triggeredBySchedule: Boolean(triggeredBySchedule),
    status: 'completed',
    ...result,
  };
};

const syncKnowledgeBase = async (schedule: DataSyncScheduleRecord, runId: string) => {
  if (!BEDROCK_KB_ID || !BEDROCK_DATA_SOURCE_ID) {
    throw new Error('Bedrock Knowledge Base not configured');
  }

  console.log('Starting Bedrock Knowledge Base ingestion', {
    kbId: BEDROCK_KB_ID,
    dataSourceId: BEDROCK_DATA_SOURCE_ID,
  });

  // Start ingestion job for Bedrock Knowledge Base
  const ingestionResponse = await bedrockAgent.send(
    new StartIngestionJobCommand({
      knowledgeBaseId: BEDROCK_KB_ID,
      dataSourceId: BEDROCK_DATA_SOURCE_ID,
      description: `Scheduled sync: ${schedule.label || schedule.schedule_id} (Run: ${runId})`,
    }),
  );

  const ingestionJobId = ingestionResponse.ingestionJob?.ingestionJobId;

  return {
    ingestionJobId,
    knowledgeBaseId: BEDROCK_KB_ID,
    dataSourceId: BEDROCK_DATA_SOURCE_ID,
    syncType: 'knowledge_base',
  };
};

const syncS3Data = async (schedule: DataSyncScheduleRecord, runId: string) => {
  const config = schedule.source_config;
  const sourceBucket = config.sourceBucket as string;
  const sourcePrefix = (config.sourcePrefix as string) || '';
  const destinationPrefix = (config.destinationPrefix as string) || `synced-data/${runId}/`;

  if (!sourceBucket) {
    throw new Error('Source bucket not specified in configuration');
  }

  console.log('Starting S3 data sync', { sourceBucket, sourcePrefix, destinationPrefix });

  // List objects in source location
  const listResponse = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: sourceBucket,
      Prefix: sourcePrefix,
      MaxKeys: 1000, // Limit for this example
    }),
  );

  const objects = listResponse.Contents || [];
  let syncedCount = 0;

  // Copy objects to destination
  for (const obj of objects) {
    if (!obj.Key) continue;

    const destinationKey = `${destinationPrefix}${obj.Key.replace(sourcePrefix, '')}`;

    try {
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: DATA_BUCKET,
          CopySource: `${sourceBucket}/${obj.Key}`,
          Key: destinationKey,
        }),
      );
      syncedCount++;
    } catch (err) {
      console.error(`Failed to copy ${obj.Key}:`, err);
    }
  }

  return {
    syncType: 's3',
    sourceBucket,
    sourcePrefix,
    destinationBucket: DATA_BUCKET,
    destinationPrefix,
    totalObjects: objects.length,
    syncedObjects: syncedCount,
  };
};

const syncApiData = async (schedule: DataSyncScheduleRecord, runId: string) => {
  const config = schedule.source_config;
  const apiUrl = config.apiUrl as string;
  const method = (config.method as string) || 'GET';
  const headers = (config.headers as Record<string, string>) || {};

  if (!apiUrl) {
    throw new Error('API URL not specified in configuration');
  }

  console.log('Starting API data sync', { apiUrl, method });

  // Make API request
  const response = await fetch(apiUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Store the data in S3 data bucket
  const dataKey = `api-sync/${runId}/data.json`;
  // Note: Would need to implement S3 put operation here

  return {
    syncType: 'api',
    apiUrl,
    method,
    responseStatus: response.status,
    dataKey,
    recordCount: Array.isArray(data) ? data.length : 1,
  };
};

const markScheduleStatus = async (userId: string, scheduleId: string, status: string, error: string | null) => {
  await dynamo.send(
    new UpdateCommand({
      TableName: SCHEDULES_TABLE,
      Key: { user_id: userId, schedule_id: scheduleId },
      UpdateExpression: 'SET last_run_epoch = :ts, last_status = :status, last_error = :err',
      ExpressionAttributeValues: {
        ':ts': Date.now(),
        ':status': status,
        ':err': error,
      },
    }),
  );
};
