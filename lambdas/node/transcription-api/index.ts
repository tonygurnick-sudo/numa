import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { withPRM } from '../../../lib/prm-node/prm';

const REGION = process.env.REGION ?? 'us-east-1';
const TABLE_NAME = process.env.TRANSCRIPTIONS_TABLE_NAME as string;
const QUEUE_URL = process.env.JOB_QUEUE_URL as string;
const DATA_BUCKET = process.env.DATA_BUCKET_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const ddbClient = withPRM(DynamoDBClient, { region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const sqs = withPRM(SQSClient, { region: REGION });
const s3 = withPRM(S3Client, { region: REGION });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

// ─── Supported format extensions ───
const SUPPORTED_EXTENSIONS = new Set([
  // Text
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.py',
  '.sql',
  '.sh',
  '.bash',
  '.log',
  '.cfg',
  '.conf',
  '.ini',
  '.tex',
  '.less',
  '.scss',
  '.markdown',
  '.adoc',
  '.bib',
  '.rst',
  '.org',
  '.typ',
  // Documents
  '.pdf',
  '.docx',
  '.xlsx',
  '.msg',
  '.eml',
  '.doc',
  '.xls',
  '.pptx',
  '.ppt',
  '.rtf',
  '.odt',
  '.ods',
  '.odp',
  '.pages',
  '.key',
  '.numbers',
  // Calendar/contacts
  '.ics',
  '.vcf',
  // Notebooks
  '.ipynb',
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.tiff',
  '.tif',
  '.webp',
  '.gif',
  '.bmp',
  '.heic',
  '.heif',
  '.svg',
  // Audio/video
  '.mp3',
  '.mp4',
  '.wav',
  '.flac',
  '.ogg',
  '.amr',
  '.webm',
  '.m4a',
  '.mov',
  '.avi',
  '.mkv',
  '.aac',
  '.wma',
  // Archives (Fargate)
  '.zip',
  '.tar',
  '.tgz',
  '.tar.gz',
  '.gz',
  // Special (Fargate)
  '.epub',
  '.djvu',
  '.parquet',
  '.sqlite',
  '.db',
]);

// File size limits in bytes per category
const SIZE_LIMITS: Record<string, number> = {
  text: 100 * 1024 * 1024, // 100MB
  document: 200 * 1024 * 1024, // 200MB
  pdf: 500 * 1024 * 1024, // 500MB
  image: 50 * 1024 * 1024, // 50MB
  audio_video: 2 * 1024 * 1024 * 1024, // 2GB
  email: 200 * 1024 * 1024, // 200MB
  archive: 1024 * 1024 * 1024, // 1GB
  database: 1024 * 1024 * 1024, // 1GB
};

type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';

interface TranscriptionJob {
  userSub: string;
  jobId: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  fileExtension: string;
  status: JobStatus;
  clientName: string;
  dataBucket: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  errorMessage?: string;
  outputKey?: string;
  progress?: number;
  fileHash?: string;
  pipelineId?: string;
}

// ─── Helpers ───

const respond = (statusCode: number, body: unknown): { statusCode: number; headers: typeof HEADERS; body: string } => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return {};
  }
};

interface AuthContext {
  sub: string;
  email?: string;
  groups: string[];
}

const resolveAuth = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;

  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);

  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) return null;

  const groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];

  return { sub, email: typeof claims.email === 'string' ? claims.email : undefined, groups };
};

const isAdmin = (auth: AuthContext): boolean => auth.groups.includes('admin');

const getExtension = (fileName: string): string => {
  const lower = fileName.toLowerCase();
  // Handle compound extensions
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  const idx = lower.lastIndexOf('.');
  return idx >= 0 ? lower.slice(idx) : '';
};

const getSizeCategory = (ext: string): string => {
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.webp', '.gif', '.bmp', '.heic', '.heif', '.svg'].includes(ext))
    return 'image';
  if (
    ['.mp3', '.mp4', '.wav', '.flac', '.ogg', '.amr', '.webm', '.m4a', '.mov', '.avi', '.mkv', '.aac', '.wma'].includes(
      ext
    )
  )
    return 'audio_video';
  if (
    [
      '.docx',
      '.xlsx',
      '.pptx',
      '.ppt',
      '.doc',
      '.xls',
      '.rtf',
      '.odt',
      '.ods',
      '.odp',
      '.pages',
      '.key',
      '.numbers',
    ].includes(ext)
  )
    return 'document';
  if (['.msg', '.eml'].includes(ext)) return 'email';
  if (['.zip', '.tar', '.tgz', '.tar.gz', '.gz'].includes(ext)) return 'archive';
  if (['.sqlite', '.db', '.parquet'].includes(ext)) return 'database';
  return 'text';
};

const generateJobId = (): string => {
  const now = new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 10);
  return `JOB#${now}#${rand}`;
};

// ─── Route handlers ───

const submitJob = async (auth: AuthContext, event: APIGatewayProxyEventV2): Promise<ReturnType<typeof respond>> => {
  const body = JSON.parse(event.body || '{}');
  const { fileName, fileKey, sourceBucket, pipelineId } = body as {
    fileName?: string;
    fileKey?: string;
    sourceBucket?: string;
    pipelineId?: string;
  };

  if (!fileName || !fileKey) {
    return respond(400, { error: 'fileName and fileKey are required' });
  }

  const bucket = sourceBucket || DATA_BUCKET;

  const ext = getExtension(fileName);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return respond(400, { error: `Unsupported file format: ${ext}` });
  }

  // Verify file exists and check size
  let fileSize = 0;
  let fileETag = '';
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: fileKey }));
    fileSize = head.ContentLength ?? 0;
    fileETag = head.ETag ?? '';
  } catch {
    return respond(404, { error: 'File not found in data bucket' });
  }

  const category = getSizeCategory(ext);
  const maxSize = SIZE_LIMITS[category] ?? SIZE_LIMITS.text;
  if (fileSize > maxSize) {
    return respond(400, {
      error: `File exceeds size limit of ${Math.round(maxSize / 1024 / 1024)}MB for ${category} files`,
    });
  }

  // Compute a content fingerprint from ETag + size for dedup
  const fileHash = createHash('sha256').update(`${fileETag}:${fileSize}`).digest('hex');

  // Check for duplicate: query user's jobs for matching hash
  const dupeCheck = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userSub = :userSub',
      FilterExpression: 'fileHash = :hash AND #s <> :failed AND #s <> :cancelled',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':userSub': auth.sub,
        ':hash': fileHash,
        ':failed': 'FAILED',
        ':cancelled': 'CANCELLED',
      },
      Limit: 1,
    })
  );

  if (dupeCheck.Items && dupeCheck.Items.length > 0) {
    const existing = dupeCheck.Items[0];
    return respond(200, {
      jobId: existing.jobId,
      status: existing.status,
      duplicate: true,
      message: 'File has already been transcribed',
    });
  }

  const now = Date.now();
  const jobId = generateJobId();
  const ttlDays = 90;
  const expiresAt = Math.floor(now / 1000) + ttlDays * 24 * 60 * 60;

  const job: TranscriptionJob = {
    userSub: auth.sub,
    jobId,
    fileName,
    fileKey,
    fileSize,
    fileExtension: ext,
    status: 'QUEUED',
    clientName: CLIENT_NAME,
    dataBucket: bucket,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    fileHash,
    pipelineId,
  };

  // Write DynamoDB record
  await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: job }));

  // Send to SQS
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        jobId,
        userSub: auth.sub,
        fileName,
        fileKey,
        fileExtension: ext,
        fileSize,
        dataBucket: bucket,
        clientName: CLIENT_NAME,
        fileHash,
        pipelineId, // CHOSE HEAD: pipelineId preserved for traceability; 3af3ef8e removed it.
      }),
    })
  );

  return respond(202, { jobId, status: 'QUEUED' });
};

const listJobs = async (auth: AuthContext, event: APIGatewayProxyEventV2): Promise<ReturnType<typeof respond>> => {
  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || '50'), 100);
  const statusFilter = params.status;
  const exclusiveStartKey = params.nextToken
    ? JSON.parse(Buffer.from(params.nextToken, 'base64').toString())
    : undefined;

  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userSub = :userSub',
      ExpressionAttributeValues: {
        ':userSub': auth.sub,
        ...(statusFilter ? { ':status': statusFilter } : {}),
      },
      ...(statusFilter ? { FilterExpression: '#s = :status', ExpressionAttributeNames: { '#s': 'status' } } : {}),
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    })
  );

  const nextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return respond(200, { jobs: result.Items || [], nextToken, count: result.Items?.length || 0 });
};

const getJob = async (auth: AuthContext, jobId: string): Promise<ReturnType<typeof respond>> => {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE_NAME, Key: { userSub: auth.sub, jobId } }));

  if (!result.Item) {
    return respond(404, { error: 'Job not found' });
  }

  return respond(200, result.Item);
};

/** Best-effort S3 cleanup: delete uploaded file + output folder. */
const cleanupS3Artifacts = async (job: TranscriptionJob): Promise<void> => {
  try {
    // Delete the uploaded file
    if (job.fileKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: DATA_BUCKET, Key: job.fileKey }));
    }

    // Delete all objects under the output folder: transcriptions/{userSub}/{jobId}/
    const outputPrefix = `transcriptions/${job.userSub}/${job.jobId}/`;
    const listResult = await s3.send(new ListObjectsV2Command({ Bucket: DATA_BUCKET, Prefix: outputPrefix }));
    if (listResult.Contents && listResult.Contents.length > 0) {
      await Promise.all(
        listResult.Contents.map((obj) =>
          obj.Key ? s3.send(new DeleteObjectCommand({ Bucket: DATA_BUCKET, Key: obj.Key })) : Promise.resolve()
        )
      );
    }

    console.log(`S3 cleanup complete for job ${job.jobId}`, {
      fileKey: job.fileKey,
      outputPrefix,
      objectsDeleted: (listResult.Contents?.length ?? 0) + 1,
    });
  } catch (error) {
    // Best-effort — don't block the DDB delete
    console.error(`S3 cleanup failed for job ${job.jobId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const deleteJob = async (
  auth: AuthContext,
  jobId: string,
  event: APIGatewayProxyEventV2
): Promise<ReturnType<typeof respond>> => {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE_NAME, Key: { userSub: auth.sub, jobId } }));

  if (!result.Item) {
    return respond(404, { error: 'Job not found' });
  }

  const job = result.Item as TranscriptionJob;

  // If still active, mark as cancel requested
  if (job.status === 'QUEUED' || job.status === 'PROCESSING') {
    await dynamo.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userSub: auth.sub, jobId },
        UpdateExpression: 'SET #s = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'CANCEL_REQUESTED', ':now': Date.now() },
      })
    );
    return respond(200, { jobId, status: 'CANCEL_REQUESTED' });
  }

  // Admin purge: delete S3 content + DynamoDB record (requires ?purge=true)
  const purge = (event.queryStringParameters || {}).purge === 'true';
  if (purge && isAdmin(auth)) {
    await cleanupS3Artifacts(job);
    await dynamo.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { userSub: auth.sub, jobId } }));
    return respond(200, { jobId, deleted: true, purged: true });
  }

  // Soft delete: mark as DELETED in DynamoDB, preserve S3 content
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { userSub: auth.sub, jobId },
      UpdateExpression: 'SET #s = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': 'DELETED', ':now': Date.now() },
    })
  );
  return respond(200, { jobId, status: 'DELETED' });
};

const retryJob = async (auth: AuthContext, jobId: string): Promise<ReturnType<typeof respond>> => {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE_NAME, Key: { userSub: auth.sub, jobId } }));

  if (!result.Item) {
    return respond(404, { error: 'Job not found' });
  }

  const job = result.Item as TranscriptionJob;
  if (job.status !== 'FAILED' && job.status !== 'CANCELLED' && job.status !== 'CANCEL_REQUESTED') {
    return respond(400, { error: 'Only failed or cancelled jobs can be retried' });
  }

  const now = Date.now();
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { userSub: auth.sub, jobId },
      UpdateExpression: 'SET #s = :status, updatedAt = :now REMOVE errorMessage',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': 'QUEUED', ':now': now },
    })
  );

  // Re-queue
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        jobId,
        userSub: auth.sub,
        fileName: job.fileName,
        fileKey: job.fileKey,
        fileExtension: job.fileExtension,
        fileSize: job.fileSize,
        dataBucket: job.dataBucket || DATA_BUCKET,
        clientName: CLIENT_NAME,
        fileHash: job.fileHash,
        pipelineId: job.pipelineId, // CHOSE HEAD: pipelineId preserved for traceability.
      }),
    })
  );

  return respond(200, { jobId, status: 'QUEUED' });
};

const listAllJobs = async (auth: AuthContext, event: APIGatewayProxyEventV2): Promise<ReturnType<typeof respond>> => {
  if (!isAdmin(auth)) {
    return respond(403, { error: 'Forbidden: Admin access required' });
  }

  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || '50'), 100);
  const statusFilter = params.status;
  const exclusiveStartKey = params.nextToken
    ? JSON.parse(Buffer.from(params.nextToken, 'base64').toString())
    : undefined;

  let result;
  if (statusFilter) {
    result = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#s = :status',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': statusFilter },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
  } else {
    result = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'AdminIndex',
        KeyConditionExpression: 'clientName = :clientName',
        ExpressionAttributeValues: { ':clientName': CLIENT_NAME },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );
  }

  const nextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return respond(200, { jobs: result.Items || [], nextToken, count: result.Items?.length || 0 });
};

// ─── Lookup handlers ─── CHOSE HEAD: new feature added after original rebuild commit.
// To revert: remove lookupByHash and lookupByPath functions and their route entries in the handler below.

const lookupByHash = async (_auth: AuthContext, hash: string): Promise<ReturnType<typeof respond>> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'HashIndex',
      KeyConditionExpression: 'fileHash = :hash',
      ExpressionAttributeValues: { ':hash': hash },
      ScanIndexForward: false,
    })
  );
  return respond(200, { jobs: result.Items || [], count: result.Items?.length || 0 });
};

const lookupByPath = async (_auth: AuthContext, fileKey: string): Promise<ReturnType<typeof respond>> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'FileKeyIndex',
      KeyConditionExpression: 'fileKey = :fileKey',
      ExpressionAttributeValues: { ':fileKey': fileKey },
      ScanIndexForward: false,
    })
  );
  return respond(200, { jobs: result.Items || [], count: result.Items?.length || 0 });
};


// ─── Rebuild from S3 ───

interface StatusFile {
  version: number;
  status: string;
  input_key: string;
  output_key: string;
  file_name: string;
  started_at: number;
  updated_at: number;
  duration_ms: number;
  // CHOSE HEAD: enriched fields written by the transcription worker after the original commit.
  // These allow better data recovery when rebuilding from S3.
  // To revert to ec7ae674: remove all optional fields below.
  file_size?: number;
  file_extension?: string;
  file_hash?: string;
  client_name?: string;
  data_bucket?: string;
  pipeline_id?: string; // CHOSE HEAD: kept for traceability; 3af3ef8e removed it.
  costs?: Record<string, unknown>;
  error_message?: string;
}

const getS3Json = async (key: string): Promise<Record<string, unknown> | null> => {
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: DATA_BUCKET, Key: key }));
    const body = await resp.Body?.transformToString('utf-8');
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
};

const rebuildFromS3 = async (auth: AuthContext): Promise<ReturnType<typeof respond>> => {
  if (!isAdmin(auth)) {
    return respond(403, { error: 'Forbidden: Admin access required' });
  }

  // Collect all existing jobIds to skip
  const existingIds = new Set<string>();
  let lastKey: Record<string, unknown> | undefined;
  do {
    const scan = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'AdminIndex',
        KeyConditionExpression: 'clientName = :c',
        ExpressionAttributeValues: { ':c': CLIENT_NAME },
        ProjectionExpression: 'jobId',
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of scan.Items ?? []) {
      existingIds.add(item.jobId as string);
    }
    lastKey = scan.LastEvaluatedKey;
  } while (lastKey);

  // Scan S3 for output.status.json files
  let continuationToken: string | undefined;
  let created = 0;
  let skipped = 0;
  let failed = 0;

  do {
    const listResult = await s3.send(
      new ListObjectsV2Command({
        Bucket: DATA_BUCKET,
        Prefix: 'transcriptions/',
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of listResult.Contents ?? []) {
      if (!obj.Key?.endsWith('/output.status.json')) continue;

      // Parse: transcriptions/{userSub}/{jobId}/output.status.json
      const parts = obj.Key.split('/');
      if (parts.length < 4) continue;
      const userSub = parts[1];
      const jobId = parts[2];

      // Skip "uploads" folder and already-existing records
      if (userSub === 'uploads') continue;
      if (existingIds.has(jobId)) {
        skipped++;
        continue;
      }

      const statusData = (await getS3Json(obj.Key)) as unknown as StatusFile | null;
      // CHOSE HEAD: double-cast avoids TS error when getS3Json returns Record<string,unknown>.
      if (!statusData) {
        failed++;
        continue;
      }

      const fileName = statusData.file_name || 'unknown';
      // CHOSE HEAD: prefer enriched file_extension from status file, fall back to path.extname.
      // To revert: use `getExtension(fileName)` only.
      const ext = statusData.file_extension || getExtension(fileName);
      const outputKey = obj.Key.replace('/output.status.json', '/output.json');
      const dbStatus =
        statusData.status === 'SUCCEEDED' ? 'COMPLETED' : statusData.status === 'FAILED' ? 'FAILED' : 'COMPLETED';

      // CHOSE HEAD: prefer enriched file_size from status file, only HeadObject if missing.
      // To revert: initialise fileSize = 0 and always attempt HeadObject when input_key present.
      let fileSize = statusData.file_size ?? 0;
      if (!fileSize && statusData.input_key) {
        try {
          const head = await s3.send(new HeadObjectCommand({ Bucket: DATA_BUCKET, Key: statusData.input_key }));
          fileSize = head.ContentLength ?? 0;
        } catch {
          // Upload may have been cleaned up
        }
      }

      const now = Date.now();
      const expiresAt = Math.floor(now / 1000) + 90 * 24 * 60 * 60;

      const job: TranscriptionJob = {
        userSub,
        jobId,
        fileName,
        fileKey: statusData.input_key || '',
        fileSize,
        fileExtension: ext,
        status: dbStatus as JobStatus,
        // CHOSE HEAD: honour enriched client_name/data_bucket so cross-client data is recovered correctly.
        // To revert: use CLIENT_NAME and DATA_BUCKET constants directly.
        clientName: statusData.client_name || CLIENT_NAME,
        dataBucket: statusData.data_bucket || DATA_BUCKET,
        createdAt: (statusData.started_at || 0) * 1000,
        updatedAt: (statusData.updated_at || 0) * 1000,
        expiresAt,
        outputKey,
        progress: 100,
        // CHOSE HEAD: preserve fileHash (dedup key) and pipelineId for traceability.
        // To revert: remove these two fields.
        fileHash: statusData.file_hash || undefined,
        pipelineId: statusData.pipeline_id || undefined,
      };

      try {
        await dynamo.send(
          new PutCommand({
            TableName: TABLE_NAME,
            // CHOSE HEAD: include costs and errorMessage when present for complete data preservation.
            // To revert: use `Item: { ...job, processingTimeMs: statusData.duration_ms || 0 }`.
            Item: {
              ...job,
              processingTimeMs: statusData.duration_ms || 0,
              ...(statusData.costs ? { costs: statusData.costs } : {}),
              ...(statusData.error_message ? { errorMessage: statusData.error_message } : {}),
            },
            ConditionExpression: 'attribute_not_exists(userSub)',
          })
        );
        created++;
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          skipped++;
        } else {
          failed++;
        }
      }
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  return respond(200, { created, skipped, failed, total: created + skipped + failed });
};

// ─── Main handler ───

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, null);
  }

  const auth = resolveAuth(event);
  if (!auth) {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const method = event.requestContext.http?.method ?? 'GET';
    const path = event.requestContext.http?.path ?? '';

    // POST /api/transcriptions — submit new job
    if (method === 'POST' && /\/transcriptions\/?$/.test(path)) {
      return await submitJob(auth, event);
    }

    // POST /api/transcriptions/admin/rebuild — rebuild DynamoDB from S3
    if (method === 'POST' && /\/transcriptions\/admin\/rebuild\/?$/.test(path)) {
      return await rebuildFromS3(auth);
    }

    // GET /api/transcriptions/admin/all — admin list all
    if (method === 'GET' && /\/transcriptions\/admin\/all\/?$/.test(path)) {
      return await listAllJobs(auth, event);
    }

    // GET /api/transcriptions/lookup/hash/{hash} — lookup by file hash
    const hashLookupMatch = path.match(/\/transcriptions\/lookup\/hash\/([^/]+)\/?$/);
    if (method === 'GET' && hashLookupMatch) {
      return await lookupByHash(auth, decodeURIComponent(hashLookupMatch[1]));
    }

    // GET /api/transcriptions/lookup/path?fileKey=... — lookup by file path
    if (method === 'GET' && /\/transcriptions\/lookup\/path\/?$/.test(path)) {
      const fileKey = (event.queryStringParameters || {}).fileKey;
      if (!fileKey) {
        return respond(400, { error: 'fileKey query parameter is required' });
      }
      return await lookupByPath(auth, fileKey);
    }

    // POST /api/transcriptions/{jobId}/retry — retry failed job
    const retryMatch = path.match(/\/transcriptions\/([^/]+)\/retry\/?$/);
    if (method === 'POST' && retryMatch) {
      return await retryJob(auth, decodeURIComponent(retryMatch[1]));
    }

    // GET /api/transcriptions/{jobId} — single job
    const jobMatch = path.match(/\/transcriptions\/([^/]+)\/?$/);
    if (method === 'GET' && jobMatch && jobMatch[1] !== 'admin' && jobMatch[1] !== 'lookup') {
      return await getJob(auth, decodeURIComponent(jobMatch[1]));
    }

    // DELETE /api/transcriptions/{jobId} — cancel or soft-delete (admin ?purge=true for hard delete)
    if (method === 'DELETE' && jobMatch) {
      return await deleteJob(auth, decodeURIComponent(jobMatch[1]), event);
    }

    // GET /api/transcriptions — list user's jobs
    if (method === 'GET' && /\/transcriptions\/?$/.test(path)) {
      return await listJobs(auth, event);
    }

    return respond(404, { error: 'Route not found' });
  } catch (error) {
    console.error('transcription-api error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: event.requestContext.http?.path,
      method: event.requestContext.http?.method,
    });
    return respond(500, { error: 'Internal server error' });
  }
};
