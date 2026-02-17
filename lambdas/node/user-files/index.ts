/**
 * User Files API — per-user virtual file system with three access scopes:
 *
 * - My Files:  USER#{user_id}  — private to the user
 * - Company:   COMPANY         — all tenant users
 * - Projects:  PROJECT#{id}    — explicit membership with roles
 *
 * Routes:
 *   ANY /api/files
 *   ANY /api/files/{proxy+}
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'crypto';
import { withPRM } from '../../../lib/prm-node/prm';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const ddbClient = withPRM(DynamoDBClient, {});
const dynamo = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});
const s3 = withPRM(S3Client, {});
const lambda = withPRM(LambdaClient, {});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const FILES_TABLE = process.env.FILES_TABLE_NAME;
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME;
const EXTRACTION_LAMBDA_ARN = process.env.EXTRACTION_LAMBDA_ARN;
const MAX_CONCURRENT_EXTRACTIONS = parseInt(process.env.MAX_CONCURRENT_EXTRACTIONS || '5', 10);

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type AuthContext = { sub: string; email?: string; name?: string; groups: string[] };
type ProjectRole = 'owner' | 'editor' | 'viewer';

const EXTRACTABLE_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.msg',
  '.png',
  '.jpg',
  '.jpeg',
  '.mp3',
  '.mp4',
  '.wav',
  '.flac',
  '.ogg',
  '.amr',
  '.webm',
  '.m4a',
  '.html',
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.xml',
  '.yaml',
  '.yml',
  '.py',
  '.js',
  '.ts',
  '.css',
  '.scss',
  '.sql',
  '.sh',
  '.bash',
  '.cfg',
  '.conf',
  '.ini',
  '.log',
  '.less',
  '.tex',
]);

const SOURCE_TYPE_MAP: Record<string, string> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.mp3': 'audio',
  '.mp4': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  '.amr': 'audio',
  '.webm': 'audio',
  '.m4a': 'audio',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const jsonResponse = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode: number, message: string) => jsonResponse(statusCode, { error: message });

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const payload = parseJwt(token);
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!sub) return null;
  const groups = Array.isArray(payload['cognito:groups'])
    ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    groups,
  };
};

const buildPathSegments = (event: APIGatewayProxyEventV2): string[] => {
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';
  const trimmed = rawPath.replace(/^\/+/, '');
  const withoutApi = trimmed.startsWith('api/') ? trimmed.slice(4) : trimmed;
  return withoutApi.split('/').filter(Boolean);
};

const parseJsonBody = <T>(body: string | undefined): T | null => {
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
};

const getExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

const getSourceType = (name: string): string => {
  const ext = getExtension(name);
  return SOURCE_TYPE_MAP[ext] || (EXTRACTABLE_EXTENSIONS.has(ext) ? 'text' : 'unknown');
};

const isExtractable = (name: string): boolean => EXTRACTABLE_EXTENSIONS.has(getExtension(name));

const normalizePath = (p: string | undefined): string => {
  if (!p || p === '/') return '/';
  let normalized = p.startsWith('/') ? p : `/${p}`;
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
};

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

type ScopeInfo = {
  scopeKey: string;
  s3Prefix: string;
  scopeType: 'my' | 'company' | 'project';
  projectId?: string;
};

/**
 * Resolve scope from URL segments. Returns null if invalid.
 *
 * Patterns:
 *   /api/files/my/...                → USER#{sub}
 *   /api/files/company/...           → COMPANY
 *   /api/files/project/{id}/...      → PROJECT#{id}  (requires membership check)
 */
const resolveScope = (segments: string[], auth: AuthContext): ScopeInfo | null => {
  // segments[0] = "files", segments[1] = scope
  const scope = segments[1];
  if (!scope) return null;

  if (scope === 'my') {
    return {
      scopeKey: `USER#${auth.sub}`,
      s3Prefix: `files/user/${auth.sub}`,
      scopeType: 'my',
    };
  }
  if (scope === 'company') {
    return {
      scopeKey: 'COMPANY',
      s3Prefix: 'files/company',
      scopeType: 'company',
    };
  }
  if (scope === 'project' && segments[2]) {
    const projectId = segments[2];
    return {
      scopeKey: `PROJECT#${projectId}`,
      s3Prefix: `files/project/${projectId}`,
      scopeType: 'project',
      projectId,
    };
  }
  return null;
};

/**
 * Check if user has access to a project scope. Returns role or null.
 */
const checkProjectAccess = async (userId: string, projectId: string): Promise<ProjectRole | null> => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: `MEMBER#${userId}`, sk: `PROJECT#${projectId}` },
    }),
  );
  if (!result.Item) return null;
  return (result.Item.role as ProjectRole) || null;
};

const requireProjectAccess = async (
  auth: AuthContext,
  projectId: string,
  minRole: ProjectRole = 'viewer',
): Promise<ProjectRole> => {
  const role = await checkProjectAccess(auth.sub, projectId);
  if (!role) throw new AccessDeniedError('Not a member of this project');
  const hierarchy: ProjectRole[] = ['viewer', 'editor', 'owner'];
  if (hierarchy.indexOf(role) < hierarchy.indexOf(minRole)) {
    throw new AccessDeniedError(`Requires ${minRole} role, you have ${role}`);
  }
  return role;
};

class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

const listFolder = async (scopeKey: string, path: string) => {
  const normalizedPath = normalizePath(path);

  // Query files in this folder
  const [filesResult, foldersResult] = await Promise.all([
    dynamo.send(
      new QueryCommand({
        TableName: FILES_TABLE,
        KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':sk': scopeKey, ':prefix': `FILE#${normalizedPath}#` },
      }),
    ),
    dynamo.send(
      new QueryCommand({
        TableName: FILES_TABLE,
        KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':sk': scopeKey, ':prefix': `FOLDER#${normalizedPath}` },
      }),
    ),
  ]);

  // Filter folders to only direct children (not nested)
  const folders = (foldersResult.Items || []).filter((item) => {
    const folderPath = (item.sk as string).replace('FOLDER#', '');
    if (folderPath === normalizedPath) return false; // Skip self
    // Direct child: remove parent prefix, remainder has no more slashes (except trailing)
    const remainder = folderPath.slice(normalizedPath.length);
    const segments = remainder.split('/').filter(Boolean);
    return segments.length === 1;
  });

  const files = (filesResult.Items || []) as Record<string, unknown>[];

  return {
    path: normalizedPath,
    folders: folders.map((f) => ({
      name: f.name,
      path: (f.sk as string).replace('FOLDER#', ''),
      created_at: f.created_at,
      updated_at: f.updated_at,
      created_by: f.created_by,
      item_type: 'folder',
    })),
    files: files.map((f) => ({
      file_id: f.file_id,
      name: f.name,
      parent_path: f.parent_path,
      size_bytes: f.size_bytes,
      content_type: f.content_type,
      source_type: f.source_type,
      extraction_status: f.extraction_status,
      extracted_words: f.extracted_words,
      extracted_pages: f.extracted_pages,
      created_at: f.created_at,
      updated_at: f.updated_at,
      created_by: f.created_by,
      item_type: 'file',
    })),
  };
};

const createFolder = async (scopeKey: string, parentPath: string, name: string, userId: string) => {
  const normalizedParent = normalizePath(parentPath);
  const folderPath = `${normalizedParent}${name}/`;
  const sk = `FOLDER#${folderPath}`;
  const now = new Date().toISOString();

  // Check if folder already exists
  const existing = await dynamo.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: scopeKey, sk },
    }),
  );
  if (existing.Item) {
    return { error: 'Folder already exists', path: folderPath };
  }

  await dynamo.send(
    new PutCommand({
      TableName: FILES_TABLE,
      Item: {
        scope_key: scopeKey,
        sk,
        name,
        created_at: now,
        updated_at: now,
        created_by: userId,
        item_type: 'folder',
      },
    }),
  );

  return { path: folderPath, name, created_at: now };
};

const registerFile = async (
  scopeKey: string,
  s3Prefix: string,
  fileId: string,
  name: string,
  parentPath: string,
  contentType: string,
  sizeBytes: number,
  userId: string,
) => {
  const normalizedParent = normalizePath(parentPath);
  const now = new Date().toISOString();
  const sourceType = getSourceType(name);
  const extractable = isExtractable(name);

  // Determine extraction status
  let extractionStatus = extractable ? 'queued' : 'not_applicable';

  // Check concurrency limit for extraction
  if (extractable) {
    const processingCount = await countProcessingFiles(scopeKey);
    if (processingCount < MAX_CONCURRENT_EXTRACTIONS) {
      extractionStatus = 'processing';
    }
  }

  const item = {
    scope_key: scopeKey,
    sk: `FILE#${normalizedParent}#${fileId}`,
    file_id: fileId,
    name,
    parent_path: normalizedParent,
    size_bytes: sizeBytes,
    content_type: contentType,
    source_type: sourceType,
    extraction_status: extractionStatus,
    created_at: now,
    updated_at: now,
    created_by: userId,
    item_type: 'file',
  };

  await dynamo.send(new PutCommand({ TableName: FILES_TABLE, Item: item }));

  // Write filemeta.json to S3
  const filemeta = {
    file_id: fileId,
    name,
    original_name: name,
    content_type: contentType,
    size_bytes: sizeBytes,
    source_type: sourceType,
    created_at: now,
    created_by: userId,
    extraction_status: extractionStatus,
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: OUTPUTS_BUCKET,
      Key: `${s3Prefix}/${fileId}/filemeta.json`,
      Body: JSON.stringify(filemeta, null, 2),
      ContentType: 'application/json',
    }),
  );

  // Trigger extraction if within concurrency limit
  if (extractionStatus === 'processing') {
    await triggerExtraction(s3Prefix, fileId, name);
  }

  return { ...item, scope_key: undefined, sk: undefined };
};

const countProcessingFiles = async (scopeKey: string): Promise<number> => {
  // Query all files and filter to processing status
  // Note: In production, consider a GSI on extraction_status for efficiency
  const result = await dynamo.send(
    new QueryCommand({
      TableName: FILES_TABLE,
      KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
      FilterExpression: 'extraction_status = :status',
      ExpressionAttributeValues: {
        ':sk': scopeKey,
        ':prefix': 'FILE#',
        ':status': 'processing',
      },
      Select: 'COUNT',
    }),
  );
  return result.Count || 0;
};

const triggerExtraction = async (s3Prefix: string, fileId: string, fileName: string) => {
  if (!EXTRACTION_LAMBDA_ARN) {
    console.warn('EXTRACTION_LAMBDA_ARN not set, skipping extraction');
    return;
  }

  const inputKey = `${s3Prefix}/${fileId}/original/${fileName}`;
  const outputKey = `${s3Prefix}/${fileId}/extracted.json`;

  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: EXTRACTION_LAMBDA_ARN,
        InvocationType: 'Event', // Fire-and-forget
        Payload: Buffer.from(
          JSON.stringify({
            input_bucket: OUTPUTS_BUCKET,
            input_key: inputKey,
            output_bucket: OUTPUTS_BUCKET,
            output_key: outputKey,
          }),
        ),
      }),
    );
    console.log(`Extraction triggered for ${inputKey}`);
  } catch (err) {
    console.error('Failed to trigger extraction:', err);
  }
};

const checkExtractionStatus = async (
  scopeKey: string,
  s3Prefix: string,
  fileId: string,
  parentPath: string,
): Promise<{ updated: boolean; status: string }> => {
  const statusKey = `${s3Prefix}/${fileId}/extracted.status.json`;

  try {
    const statusObj = await s3.send(
      new GetObjectCommand({
        Bucket: OUTPUTS_BUCKET,
        Key: statusKey,
      }),
    );
    const statusBody = await statusObj.Body?.transformToString();
    if (!statusBody) return { updated: false, status: 'processing' };

    const statusData = JSON.parse(statusBody) as { status: string; error_message?: string };

    if (statusData.status === 'SUCCEEDED') {
      // Read extraction result for metadata
      let extractedWords = 0;
      let extractedPages = 0;
      try {
        const extractedObj = await s3.send(
          new GetObjectCommand({
            Bucket: OUTPUTS_BUCKET,
            Key: `${s3Prefix}/${fileId}/extracted.json`,
          }),
        );
        const extractedBody = await extractedObj.Body?.transformToString();
        if (extractedBody) {
          const data = JSON.parse(extractedBody) as { total_num_words?: number; num_pages?: number };
          extractedWords = data.total_num_words || 0;
          extractedPages = data.num_pages || 0;
        }
      } catch {
        /* extraction metadata read failed, continue */
      }

      await dynamo.send(
        new UpdateCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: scopeKey, sk: `FILE#${parentPath}#${fileId}` },
          UpdateExpression: 'SET extraction_status = :s, extracted_words = :w, extracted_pages = :p, updated_at = :u',
          ExpressionAttributeValues: {
            ':s': 'ready',
            ':w': extractedWords,
            ':p': extractedPages,
            ':u': new Date().toISOString(),
          },
        }),
      );

      // Update filemeta.json
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: OUTPUTS_BUCKET,
            Key: `${s3Prefix}/${fileId}/filemeta.json`,
            Body: JSON.stringify({
              extraction_status: 'ready',
              extracted_words: extractedWords,
              extracted_pages: extractedPages,
            }),
            ContentType: 'application/json',
          }),
        );
      } catch {
        /* filemeta update failed, non-critical */
      }

      return { updated: true, status: 'ready' };
    }

    if (statusData.status === 'FAILED') {
      await dynamo.send(
        new UpdateCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: scopeKey, sk: `FILE#${parentPath}#${fileId}` },
          UpdateExpression: 'SET extraction_status = :s, updated_at = :u',
          ExpressionAttributeValues: { ':s': 'error', ':u': new Date().toISOString() },
        }),
      );
      return { updated: true, status: 'error' };
    }

    return { updated: false, status: 'processing' };
  } catch (err: unknown) {
    // Status file doesn't exist yet — still processing
    const code = (err as { name?: string })?.name;
    if (code === 'NoSuchKey') return { updated: false, status: 'processing' };
    console.error('Error checking extraction status:', err);
    return { updated: false, status: 'processing' };
  }
};

const promoteQueuedFiles = async (scopeKey: string, s3Prefix: string) => {
  const processingCount = await countProcessingFiles(scopeKey);
  if (processingCount >= MAX_CONCURRENT_EXTRACTIONS) return;

  const slotsAvailable = MAX_CONCURRENT_EXTRACTIONS - processingCount;

  // Find queued files, oldest first
  const result = await dynamo.send(
    new QueryCommand({
      TableName: FILES_TABLE,
      KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
      FilterExpression: 'extraction_status = :status',
      ExpressionAttributeValues: {
        ':sk': scopeKey,
        ':prefix': 'FILE#',
        ':status': 'queued',
      },
    }),
  );

  const queued = (result.Items || []).sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || '')),
  );

  for (let i = 0; i < Math.min(slotsAvailable, queued.length); i++) {
    const file = queued[i];
    const fileId = file.file_id as string;
    const fileName = file.name as string;
    const parentPath = file.parent_path as string;

    await dynamo.send(
      new UpdateCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: `FILE#${parentPath}#${fileId}` },
        UpdateExpression: 'SET extraction_status = :s, updated_at = :u',
        ExpressionAttributeValues: { ':s': 'processing', ':u': new Date().toISOString() },
      }),
    );

    await triggerExtraction(s3Prefix, fileId, fileName);
  }
};

const getFile = async (scopeKey: string, s3Prefix: string, fileId: string) => {
  // We need to find the file — query for it since we don't know the parent_path
  const result = await dynamo.send(
    new QueryCommand({
      TableName: FILES_TABLE,
      KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
      FilterExpression: 'file_id = :fid',
      ExpressionAttributeValues: {
        ':sk': scopeKey,
        ':prefix': 'FILE#',
        ':fid': fileId,
      },
    }),
  );

  const item = result.Items?.[0];
  if (!item) return null;

  // Check extraction status if processing
  if (item.extraction_status === 'processing') {
    const status = await checkExtractionStatus(scopeKey, s3Prefix, fileId, item.parent_path as string);
    if (status.updated) {
      item.extraction_status = status.status;
    }
  }

  return {
    file_id: item.file_id,
    name: item.name,
    parent_path: item.parent_path,
    size_bytes: item.size_bytes,
    content_type: item.content_type,
    source_type: item.source_type,
    extraction_status: item.extraction_status,
    extracted_words: item.extracted_words,
    extracted_pages: item.extracted_pages,
    created_at: item.created_at,
    updated_at: item.updated_at,
    created_by: item.created_by,
  };
};

const getDownloadUrl = async (s3Prefix: string, fileId: string, fileName: string) => {
  const key = `${s3Prefix}/${fileId}/original/${fileName}`;
  const command = new GetObjectCommand({ Bucket: OUTPUTS_BUCKET, Key: key });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = await getSignedUrl(s3 as any, command, { expiresIn: 3600 });
  return { url, key };
};

const renameFile = async (scopeKey: string, fileId: string, newName?: string, newParentPath?: string) => {
  // Find the file first
  const file = await findFileById(scopeKey, fileId);
  if (!file) return null;

  const currentParent = file.parent_path as string;
  const currentSk = file.sk as string;

  if (newParentPath && normalizePath(newParentPath) !== currentParent) {
    // Move: delete old + create new SK
    const normalizedNew = normalizePath(newParentPath);
    const newSk = `FILE#${normalizedNew}#${fileId}`;

    await dynamo.send(
      new DeleteCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: currentSk },
      }),
    );

    const updated = {
      ...file,
      sk: newSk,
      parent_path: normalizedNew,
      name: newName || file.name,
      updated_at: new Date().toISOString(),
    };

    await dynamo.send(new PutCommand({ TableName: FILES_TABLE, Item: updated }));
    return updated;
  }

  if (newName) {
    // Rename only
    await dynamo.send(
      new UpdateCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: currentSk },
        UpdateExpression: 'SET #n = :name, updated_at = :u',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':name': newName, ':u': new Date().toISOString() },
      }),
    );
    return { ...file, name: newName };
  }

  return file;
};

const deleteFile = async (scopeKey: string, s3Prefix: string, fileId: string) => {
  const file = await findFileById(scopeKey, fileId);
  if (!file) return false;

  // Delete from DynamoDB
  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: scopeKey, sk: file.sk as string },
    }),
  );

  // Delete all S3 objects under the file's folder
  const prefix = `${s3Prefix}/${fileId}/`;
  try {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: OUTPUTS_BUCKET,
        Prefix: prefix,
      }),
    );

    if (listed.Contents && listed.Contents.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: OUTPUTS_BUCKET,
          Delete: {
            Objects: listed.Contents.map((obj) => ({ Key: obj.Key })),
          },
        }),
      );
    }
  } catch (err) {
    console.error('Error deleting S3 objects:', err);
  }

  return true;
};

const copyFile = async (
  scopeKey: string,
  s3Prefix: string,
  sourceFileId: string,
  targetParentPath?: string,
  targetName?: string,
) => {
  const source = await findFileById(scopeKey, sourceFileId);
  if (!source) return null;

  const newFileId = randomUUID();
  const newParent = targetParentPath ? normalizePath(targetParentPath) : (source.parent_path as string);
  const newName = targetName || `${source.name as string}`;
  const now = new Date().toISOString();

  // Copy the original file in S3
  const sourceKey = `${s3Prefix}/${sourceFileId}/original/${source.name as string}`;
  const destKey = `${s3Prefix}/${newFileId}/original/${newName}`;

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: OUTPUTS_BUCKET,
        CopySource: `${OUTPUTS_BUCKET}/${sourceKey}`,
        Key: destKey,
      }),
    );
  } catch (err) {
    console.error('S3 copy failed:', err);
    return null;
  }

  // Create new DynamoDB item
  const item = {
    scope_key: scopeKey,
    sk: `FILE#${newParent}#${newFileId}`,
    file_id: newFileId,
    name: newName,
    parent_path: newParent,
    size_bytes: source.size_bytes,
    content_type: source.content_type,
    source_type: source.source_type,
    extraction_status: source.extraction_status === 'ready' ? 'ready' : 'not_applicable',
    extracted_words: source.extraction_status === 'ready' ? source.extracted_words : undefined,
    extracted_pages: source.extraction_status === 'ready' ? source.extracted_pages : undefined,
    created_at: now,
    updated_at: now,
    created_by: source.created_by,
    item_type: 'file',
  };

  await dynamo.send(new PutCommand({ TableName: FILES_TABLE, Item: item }));

  // Copy extracted.json if it exists
  if (source.extraction_status === 'ready') {
    try {
      await s3.send(
        new CopyObjectCommand({
          Bucket: OUTPUTS_BUCKET,
          CopySource: `${OUTPUTS_BUCKET}/${s3Prefix}/${sourceFileId}/extracted.json`,
          Key: `${s3Prefix}/${newFileId}/extracted.json`,
        }),
      );
    } catch {
      /* extracted file copy failed, non-critical */
    }
  }

  // Write filemeta.json for the copy
  await s3.send(
    new PutObjectCommand({
      Bucket: OUTPUTS_BUCKET,
      Key: `${s3Prefix}/${newFileId}/filemeta.json`,
      Body: JSON.stringify({ ...item, scope_key: undefined, sk: undefined }, null, 2),
      ContentType: 'application/json',
    }),
  );

  return { ...item, scope_key: undefined, sk: undefined };
};

const deleteFolder = async (scopeKey: string, path: string) => {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/') return { error: 'Cannot delete root folder' };

  // Check if folder is empty
  const contents = await listFolder(scopeKey, normalizedPath);
  if (contents.files.length > 0 || contents.folders.length > 0) {
    return { error: 'Folder is not empty' };
  }

  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: scopeKey, sk: `FOLDER#${normalizedPath}` },
    }),
  );

  return { deleted: true, path: normalizedPath };
};

const renameFolder = async (scopeKey: string, path: string, newName?: string, newParent?: string) => {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/') return { error: 'Cannot rename root folder' };

  const existing = await dynamo.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: scopeKey, sk: `FOLDER#${normalizedPath}` },
    }),
  );
  if (!existing.Item) return null;

  const now = new Date().toISOString();

  // --- Move folder to a new parent (with recursive descendant updates) ---
  if (newParent) {
    const normalizedNewParent = normalizePath(newParent);
    const folderName = newName || (existing.Item.name as string);
    const newPath = `${normalizedNewParent}${folderName}/`;

    // Prevent circular move: target cannot be inside source
    if (newPath.startsWith(normalizedPath)) {
      return { error: 'Cannot move a folder into itself or a descendant' };
    }

    // Check target doesn't already exist
    const targetCheck = await dynamo.send(
      new GetCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: `FOLDER#${newPath}` },
      }),
    );
    if (targetCheck.Item) return { error: 'A folder with this name already exists at the target' };

    // Query all descendant folders and files under the source path
    const [descendantFolders, descendantFiles] = await Promise.all([
      dynamo.send(
        new QueryCommand({
          TableName: FILES_TABLE,
          KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':sk': scopeKey, ':prefix': `FOLDER#${normalizedPath}` },
        }),
      ),
      dynamo.send(
        new QueryCommand({
          TableName: FILES_TABLE,
          KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':sk': scopeKey, ':prefix': `FILE#${normalizedPath}` },
        }),
      ),
    ]);

    // Move descendant folders: swap the path prefix from old to new
    const folderOps = (descendantFolders.Items || []).map(async (item) => {
      const oldSk = item.sk as string;
      const oldFolderPath = oldSk.replace('FOLDER#', '');
      const newFolderPath = oldFolderPath.replace(normalizedPath, newPath);
      const itemName = oldFolderPath === normalizedPath ? folderName : item.name;

      await dynamo.send(
        new DeleteCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: scopeKey, sk: oldSk },
        }),
      );
      await dynamo.send(
        new PutCommand({
          TableName: FILES_TABLE,
          Item: { ...item, sk: `FOLDER#${newFolderPath}`, name: itemName, updated_at: now },
        }),
      );
    });

    // Move descendant files: swap the parent_path prefix
    const fileOps = (descendantFiles.Items || []).map(async (item) => {
      const oldSk = item.sk as string;
      const oldParentPath = item.parent_path as string;
      const newParentPath = oldParentPath.replace(normalizedPath, newPath);
      const fileId = item.file_id as string;
      const newSk = `FILE#${newParentPath}#${fileId}`;

      await dynamo.send(
        new DeleteCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: scopeKey, sk: oldSk },
        }),
      );
      await dynamo.send(
        new PutCommand({
          TableName: FILES_TABLE,
          Item: { ...item, sk: newSk, parent_path: newParentPath, updated_at: now },
        }),
      );
    });

    await Promise.all([...folderOps, ...fileOps]);

    return { path: newPath, name: folderName };
  }

  // --- Rename only (no parent change) ---
  if (newName) {
    const parts = normalizedPath.split('/').filter(Boolean);
    parts[parts.length - 1] = newName;
    const newPath = `/${parts.join('/')}/`;

    await dynamo.send(
      new DeleteCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: `FOLDER#${normalizedPath}` },
      }),
    );

    await dynamo.send(
      new PutCommand({
        TableName: FILES_TABLE,
        Item: {
          ...existing.Item,
          sk: `FOLDER#${newPath}`,
          name: newName,
          updated_at: now,
        },
      }),
    );

    return { path: newPath, name: newName };
  }

  return existing.Item;
};

const findFileById = async (scopeKey: string, fileId: string) => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: FILES_TABLE,
      KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
      FilterExpression: 'file_id = :fid',
      ExpressionAttributeValues: {
        ':sk': scopeKey,
        ':prefix': 'FILE#',
        ':fid': fileId,
      },
    }),
  );
  return result.Items?.[0] || null;
};

// ---------------------------------------------------------------------------
// Project operations
// ---------------------------------------------------------------------------

const listProjects = async (userId: string) => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: FILES_TABLE,
      KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':sk': `MEMBER#${userId}`,
        ':prefix': 'PROJECT#',
      },
    }),
  );

  return (result.Items || []).map((item) => ({
    project_id: item.project_id,
    project_name: item.project_name,
    role: item.role,
    joined_at: item.joined_at,
  }));
};

const createProject = async (name: string, userId: string) => {
  const projectId = randomUUID();
  const now = new Date().toISOString();

  // Create project item
  await dynamo.send(
    new PutCommand({
      TableName: FILES_TABLE,
      Item: {
        scope_key: 'PROJECTS',
        sk: `PROJECT#${projectId}`,
        project_id: projectId,
        name,
        created_at: now,
        created_by: userId,
        members: [userId],
        item_type: 'project',
      },
    }),
  );

  // Create membership item for creator
  await dynamo.send(
    new PutCommand({
      TableName: FILES_TABLE,
      Item: {
        scope_key: `MEMBER#${userId}`,
        sk: `PROJECT#${projectId}`,
        project_id: projectId,
        project_name: name,
        role: 'owner',
        joined_at: now,
        item_type: 'membership',
      },
    }),
  );

  // Create root folder for the project
  await dynamo.send(
    new PutCommand({
      TableName: FILES_TABLE,
      Item: {
        scope_key: `PROJECT#${projectId}`,
        sk: 'FOLDER#/',
        name: '/',
        created_at: now,
        updated_at: now,
        created_by: userId,
        item_type: 'folder',
      },
    }),
  );

  return { project_id: projectId, name, created_at: now, role: 'owner' };
};

const getProject = async (projectId: string) => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
    }),
  );
  return result.Item || null;
};

const addProjectMember = async (projectId: string, userId: string, role: ProjectRole) => {
  const now = new Date().toISOString();

  // Get project to update members set
  const project = await getProject(projectId);
  if (!project) return null;

  const projectName = project.name as string;

  // Add membership
  await dynamo.send(
    new PutCommand({
      TableName: FILES_TABLE,
      Item: {
        scope_key: `MEMBER#${userId}`,
        sk: `PROJECT#${projectId}`,
        project_id: projectId,
        project_name: projectName,
        role,
        joined_at: now,
        item_type: 'membership',
      },
    }),
  );

  // Update project members list
  const members = new Set((project.members as string[]) || []);
  members.add(userId);
  await dynamo.send(
    new UpdateCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
      UpdateExpression: 'SET members = :m',
      ExpressionAttributeValues: { ':m': Array.from(members) },
    }),
  );

  return { user_id: userId, role, joined_at: now };
};

const removeProjectMember = async (projectId: string, userId: string) => {
  // Delete membership
  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: `MEMBER#${userId}`, sk: `PROJECT#${projectId}` },
    }),
  );

  // Update project members list
  const project = await getProject(projectId);
  if (project) {
    const members = new Set((project.members as string[]) || []);
    members.delete(userId);
    await dynamo.send(
      new UpdateCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
        UpdateExpression: 'SET members = :m',
        ExpressionAttributeValues: { ':m': Array.from(members) },
      }),
    );
  }

  return true;
};

const deleteProject = async (projectId: string) => {
  // Check project is empty
  const contents = await listFolder(`PROJECT#${projectId}`, '/');
  if (contents.files.length > 0 || contents.folders.length > 0) {
    return { error: 'Project has files or folders. Delete them first.' };
  }

  // Get all members
  const project = await getProject(projectId);
  if (!project) return { error: 'Project not found' };

  const members = (project.members as string[]) || [];

  // Delete all membership items
  await Promise.all(
    members.map((uid) =>
      dynamo.send(
        new DeleteCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: `MEMBER#${uid}`, sk: `PROJECT#${projectId}` },
        }),
      ),
    ),
  );

  // Delete root folder
  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: `PROJECT#${projectId}`, sk: 'FOLDER#/' },
    }),
  );

  // Delete project item
  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
    }),
  );

  return { deleted: true };
};

// ---------------------------------------------------------------------------
// Orphan scanning — finds S3 objects owned by the user that aren't registered
// in the files table (chat uploads, agent artifacts, app outputs, etc.)
// ---------------------------------------------------------------------------

/** Known prefixes where user artifacts live (outside files/user/). */
const KNOWN_USER_PREFIXES = (userId: string) => [
  `numa-chat/uploads/${userId}/`,
  `numa-chat/agents/${userId}/`,
  `numa-chat/workspace/${userId}/`,
  `numa-workspace/${userId}/`,
];

/** Prefixes to skip during top-level discovery (not app outputs). */
const SKIP_PREFIXES = new Set([
  'files/',
  'numa-chat/',
  'numa-workspace/',
  'cdk.tf/',
  '.well-known/',
  'artifacts/',
  'shared/',
]);

/** UUID pattern used to detect user-specific S3 keys (keys containing a Cognito sub). */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const isUserSpecificKey = (key: string): boolean => UUID_PATTERN.test(key);

/**
 * Discover top-level S3 prefixes that might contain user artifacts.
 * Returns prefixes like "document-summariser/", "policy-builder/", etc.
 */
const discoverAppPrefixes = async (userId: string): Promise<string[]> => {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: OUTPUTS_BUCKET,
      Delimiter: '/',
      MaxKeys: 200,
    }),
  );

  const topPrefixes = (result.CommonPrefixes || []).map((p) => p.Prefix!).filter((p) => !SKIP_PREFIXES.has(p));

  // Check which top-level prefixes have a sub-folder for this user
  const checks = await Promise.all(
    topPrefixes.map(async (prefix) => {
      const check = await s3.send(
        new ListObjectsV2Command({
          Bucket: OUTPUTS_BUCKET,
          Prefix: `${prefix}${userId}/`,
          MaxKeys: 1,
        }),
      );
      return (check.KeyCount ?? 0) > 0 ? `${prefix}${userId}/` : null;
    }),
  );

  return checks.filter((p): p is string => p !== null);
};

/**
 * Classify an S3 key into a source category.
 */
const classifyOrphanSource = (key: string): string => {
  if (key.startsWith('numa-chat/uploads/')) return 'chat-upload';
  if (key.startsWith('numa-chat/agents/')) return 'agent-artifact';
  if (key.startsWith('numa-chat/workspace/')) return 'workspace';
  if (key.startsWith('numa-workspace/')) return 'workspace';
  const firstSlash = key.indexOf('/');
  return firstSlash > 0 ? key.slice(0, firstSlash) : 'unknown';
};

/**
 * Extract a human-readable filename from an S3 key.
 */
const extractFileName = (key: string): string => {
  const parts = key.split('/');
  return parts[parts.length - 1] || key;
};

interface OrphanItem {
  key: string;
  name: string;
  size: number;
  last_modified: string;
  source: string;
}

/**
 * List orphaned S3 objects that belong to the user but aren't registered
 * in the files DynamoDB table. Scans known prefixes + dynamically
 * discovered app prefixes.
 */
const listOrphans = async (
  userId: string,
  cursor?: string,
  limit = 50,
): Promise<{ orphans: OrphanItem[]; next_cursor?: string; total_scanned: number }> => {
  // 1. Get all registered file IDs so we can exclude them
  const registeredIds = new Set<string>();
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: FILES_TABLE,
        KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':sk': `USER#${userId}`, ':prefix': 'FILE#' },
        ProjectionExpression: 'file_id',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    for (const item of result.Items || []) {
      if (item.file_id) registeredIds.add(item.file_id as string);
    }
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  // Build a set of registered S3 key prefixes to filter out
  const registeredPrefixes = new Set([...registeredIds].map((fid) => `files/user/${userId}/${fid}/`));

  // 2. Collect all prefixes to scan
  const knownPrefixes = KNOWN_USER_PREFIXES(userId);
  const appPrefixes = await discoverAppPrefixes(userId);
  const allPrefixes = [...knownPrefixes, ...appPrefixes];

  // 3. Decode cursor: {prefixIndex}:{continuationToken}
  let startPrefixIndex = 0;
  let continuationToken: string | undefined;
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      startPrefixIndex = parseInt(decoded.slice(0, colonIdx), 10);
      const tokenPart = decoded.slice(colonIdx + 1);
      continuationToken = tokenPart || undefined;
    } catch {
      // Invalid cursor — start from beginning
    }
  }

  // 4. Scan prefixes, collecting orphans up to limit
  const orphans: OrphanItem[] = [];
  let totalScanned = 0;
  let nextCursor: string | undefined;

  for (let i = startPrefixIndex; i < allPrefixes.length && orphans.length < limit; i++) {
    const prefix = allPrefixes[i];
    let token = i === startPrefixIndex ? continuationToken : undefined;

    do {
      const result = await s3.send(
        new ListObjectsV2Command({
          Bucket: OUTPUTS_BUCKET,
          Prefix: prefix,
          MaxKeys: Math.min(200, (limit - orphans.length) * 3), // Over-fetch to account for filtering
          ContinuationToken: token,
        }),
      );

      for (const obj of result.Contents || []) {
        if (!obj.Key || !obj.Size) continue;
        totalScanned++;

        // Skip metadata/status/sidecar files
        const name = extractFileName(obj.Key);
        if (name === 'filemeta.json' || name === 'extracted.json' || name === 'extracted.status.json') continue;
        if (name.endsWith('.metadata.json') || name.endsWith('.status.json')) continue;
        // Skip .json sidecar files that accompany an actual file (e.g. "file.pdf.json" is extraction data for "file.pdf")
        if (name.includes('.') && name.endsWith('.json') && name.split('.').length > 2) continue;

        // Skip registered files
        const isRegistered = [...registeredPrefixes].some((rp) => obj.Key!.startsWith(rp));
        if (isRegistered) continue;

        orphans.push({
          key: obj.Key,
          name,
          size: obj.Size,
          last_modified: obj.LastModified?.toISOString() || '',
          source: classifyOrphanSource(obj.Key),
        });

        if (orphans.length >= limit) {
          // Encode cursor for resumption
          if (result.IsTruncated || i < allPrefixes.length - 1) {
            const cursorPayload = result.NextContinuationToken ? `${i}:${result.NextContinuationToken}` : `${i + 1}:`;
            nextCursor = Buffer.from(cursorPayload).toString('base64url');
          }
          break;
        }
      }

      token = result.IsTruncated ? result.NextContinuationToken : undefined;

      // If we filled the page mid-prefix, save cursor and break
      if (orphans.length >= limit) break;
    } while (token);

    // If we exhausted this prefix and still have room, move to next prefix
    // If we didn't fill the page yet and there's a next prefix, continue
  }

  return { orphans, next_cursor: nextCursor, total_scanned: totalScanned };
};

/**
 * Generate a pre-signed download URL for an orphan S3 object.
 * Validates that the key belongs to the requesting user.
 */
const getOrphanDownloadUrl = async (
  userId: string,
  encodedKey: string,
): Promise<{ url: string; key: string; name: string } | null> => {
  const key = Buffer.from(encodedKey, 'base64url').toString('utf8');

  // Security: verify the key contains the user's ID
  if (!key.includes(`/${userId}/`)) return null;

  const name = extractFileName(key);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const url = await getSignedUrl(
    s3 as any,
    new GetObjectCommand({
      Bucket: OUTPUTS_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(name)}"`,
    }),
    { expiresIn: 3600 },
    /* eslint-enable @typescript-eslint/no-explicit-any */
  );

  return { url, key, name };
};

/**
 * Adopt an orphan: copy it into the registered files area and register
 * it in DynamoDB so it appears in My Files.
 */
const adoptOrphan = async (
  userId: string,
  sourceKey: string,
  customName?: string,
  parentPath?: string,
): Promise<Record<string, unknown> | null> => {
  // Security: verify the key contains the user's ID
  if (!sourceKey.includes(`/${userId}/`)) return null;

  const name = customName || extractFileName(sourceKey);
  const fileId = randomUUID();
  const targetKey = `files/user/${userId}/${fileId}/original/${name}`;
  const scopeKey = `USER#${userId}`;
  const s3Prefix = `files/user/${userId}`;

  // Copy the object to the registered files area
  await s3.send(
    new CopyObjectCommand({
      Bucket: OUTPUTS_BUCKET,
      CopySource: `${OUTPUTS_BUCKET}/${sourceKey}`,
      Key: targetKey,
    }),
  );

  // Get size from the copied object
  const headResult = await s3.send(
    new ListObjectsV2Command({
      Bucket: OUTPUTS_BUCKET,
      Prefix: targetKey,
      MaxKeys: 1,
    }),
  );
  const sizeBytes = headResult.Contents?.[0]?.Size || 0;

  // Infer content type from extension
  const ext = getExtension(name);
  const contentTypeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.msg': 'application/vnd.ms-outlook',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.xml': 'application/xml',
  };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';

  // Register the file using the existing function
  const result = await registerFile(
    scopeKey,
    s3Prefix,
    fileId,
    name,
    parentPath || '/',
    contentType,
    sizeBytes,
    userId,
  );

  return result;
};

// ---------------------------------------------------------------------------
// Company orphan scanning — finds S3 objects that are company-level
// (no user UUID in path) and aren't registered in the COMPANY scope.
// ---------------------------------------------------------------------------

/**
 * List company-level orphaned S3 objects — files that exist in the bucket
 * without a user UUID in their key, and aren't registered under COMPANY scope.
 */
const listCompanyOrphans = async (
  cursor?: string,
  limit = 50,
): Promise<{ orphans: OrphanItem[]; next_cursor?: string; total_scanned: number }> => {
  // 1. Get all registered company file IDs
  const registeredIds = new Set<string>();
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: FILES_TABLE,
        KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':sk': 'COMPANY', ':prefix': 'FILE#' },
        ProjectionExpression: 'file_id',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    for (const item of result.Items || []) {
      if (item.file_id) registeredIds.add(item.file_id as string);
    }
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  const registeredPrefixes = new Set([...registeredIds].map((fid) => `files/company/${fid}/`));

  // 2. Discover top-level prefixes (excluding skip set)
  const topResult = await s3.send(
    new ListObjectsV2Command({
      Bucket: OUTPUTS_BUCKET,
      Delimiter: '/',
      MaxKeys: 200,
    }),
  );

  const topPrefixes = (topResult.CommonPrefixes || []).map((p) => p.Prefix!).filter((p) => !SKIP_PREFIXES.has(p));

  // 3. Decode cursor
  let startPrefixIndex = 0;
  let continuationToken: string | undefined;
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      startPrefixIndex = parseInt(decoded.slice(0, colonIdx), 10);
      const tokenPart = decoded.slice(colonIdx + 1);
      continuationToken = tokenPart || undefined;
    } catch {
      /* invalid cursor */
    }
  }

  // 4. Scan prefixes, collecting company orphans (non-user objects)
  const orphans: OrphanItem[] = [];
  let totalScanned = 0;
  let nextCursor: string | undefined;

  for (let i = startPrefixIndex; i < topPrefixes.length && orphans.length < limit; i++) {
    const prefix = topPrefixes[i];
    let token = i === startPrefixIndex ? continuationToken : undefined;

    do {
      const listResult = await s3.send(
        new ListObjectsV2Command({
          Bucket: OUTPUTS_BUCKET,
          Prefix: prefix,
          MaxKeys: Math.min(200, (limit - orphans.length) * 3),
          ContinuationToken: token,
        }),
      );

      for (const obj of listResult.Contents || []) {
        if (!obj.Key || !obj.Size) continue;
        totalScanned++;

        // Only include non-user files (no UUID in path = company-level)
        if (isUserSpecificKey(obj.Key)) continue;

        // Skip metadata/sidecar files
        const name = extractFileName(obj.Key);
        if (name === 'filemeta.json' || name === 'extracted.json' || name === 'extracted.status.json') continue;
        if (name.endsWith('.metadata.json') || name.endsWith('.status.json')) continue;
        if (name.includes('.') && name.endsWith('.json') && name.split('.').length > 2) continue;

        // Skip registered company files
        const isRegistered = [...registeredPrefixes].some((rp) => obj.Key!.startsWith(rp));
        if (isRegistered) continue;

        orphans.push({
          key: obj.Key,
          name,
          size: obj.Size,
          last_modified: obj.LastModified?.toISOString() || '',
          source: classifyOrphanSource(obj.Key),
        });

        if (orphans.length >= limit) {
          if (listResult.IsTruncated || i < topPrefixes.length - 1) {
            const cursorPayload = listResult.NextContinuationToken
              ? `${i}:${listResult.NextContinuationToken}`
              : `${i + 1}:`;
            nextCursor = Buffer.from(cursorPayload).toString('base64url');
          }
          break;
        }
      }

      token = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
      if (orphans.length >= limit) break;
    } while (token);
  }

  return { orphans, next_cursor: nextCursor, total_scanned: totalScanned };
};

/**
 * Generate a pre-signed download URL for a company-level orphan.
 * Validates the key does NOT contain a user UUID (company files only).
 */
const getCompanyOrphanDownloadUrl = async (
  encodedKey: string,
): Promise<{ url: string; key: string; name: string } | null> => {
  const key = Buffer.from(encodedKey, 'base64url').toString('utf8');

  // Security: only allow non-user-specific files
  if (isUserSpecificKey(key)) return null;

  const name = extractFileName(key);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const url = await getSignedUrl(
    s3 as any,
    new GetObjectCommand({
      Bucket: OUTPUTS_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(name)}"`,
    }),
    { expiresIn: 3600 },
    /* eslint-enable @typescript-eslint/no-explicit-any */
  );

  return { url, key, name };
};

/**
 * Adopt a company orphan: copy it to files/company/ and register
 * under the COMPANY scope in DynamoDB.
 */
const adoptCompanyOrphan = async (
  userId: string,
  sourceKey: string,
  customName?: string,
  parentPath?: string,
): Promise<Record<string, unknown> | null> => {
  // Security: only allow non-user-specific files
  if (isUserSpecificKey(sourceKey)) return null;

  const name = customName || extractFileName(sourceKey);
  const fileId = randomUUID();
  const targetKey = `files/company/${fileId}/original/${name}`;
  const scopeKey = 'COMPANY';
  const s3Prefix = 'files/company';

  await s3.send(
    new CopyObjectCommand({
      Bucket: OUTPUTS_BUCKET,
      CopySource: `${OUTPUTS_BUCKET}/${sourceKey}`,
      Key: targetKey,
    }),
  );

  const headResult = await s3.send(
    new ListObjectsV2Command({
      Bucket: OUTPUTS_BUCKET,
      Prefix: targetKey,
      MaxKeys: 1,
    }),
  );
  const sizeBytes = headResult.Contents?.[0]?.Size || 0;

  const ext = getExtension(name);
  const contentTypeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.msg': 'application/vnd.ms-outlook',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.xml': 'application/xml',
  };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';

  const result = await registerFile(
    scopeKey,
    s3Prefix,
    fileId,
    name,
    parentPath || '/',
    contentType,
    sizeBytes,
    userId,
  );

  return result;
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (event.requestContext.http.method === 'OPTIONS') {
      return { statusCode: 200, headers: HEADERS, body: '' };
    }

    if (!FILES_TABLE || !OUTPUTS_BUCKET) {
      return errorResponse(500, 'Missing required environment variables');
    }

    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Unauthorized');

    const segments = buildPathSegments(event);
    const method = event.requestContext.http.method.toUpperCase();

    // segments[0] should be "files"
    if (segments[0] !== 'files') return errorResponse(404, 'Route not found');

    // --- Project management routes: /api/files/projects/... ---
    if (segments[1] === 'projects') {
      return await handleProjectRoutes(method, segments, auth, event);
    }

    // --- File/folder routes: /api/files/{scope}/... ---
    const scope = resolveScope(segments, auth);
    if (!scope) return errorResponse(400, 'Invalid scope. Use: my, company, or project/{id}');

    // Project access check
    if (scope.scopeType === 'project' && scope.projectId) {
      try {
        const role = await requireProjectAccess(auth, scope.projectId);
        // For write operations, require editor or owner
        if (['POST', 'PUT', 'DELETE'].includes(method) && role === 'viewer') {
          return errorResponse(403, 'Viewer role cannot modify files');
        }
      } catch (err) {
        if (err instanceof AccessDeniedError) return errorResponse(403, err.message);
        throw err;
      }
    }

    // Determine the action segments after scope
    // /api/files/my/...           → actionSegments = [...]
    // /api/files/project/{id}/... → actionSegments = [...]
    const scopeOffset = scope.scopeType === 'project' ? 3 : 2; // "files" + "project" + {id} or "files" + "my"/"company"
    const actionSegments = segments.slice(scopeOffset);

    return await handleFileRoutes(method, actionSegments, scope, auth, event);
  } catch (error) {
    console.error('User Files API error:', error);
    return errorResponse(500, 'Internal Server Error');
  }
};

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const handleProjectRoutes = async (
  method: string,
  segments: string[],
  auth: AuthContext,
  event: APIGatewayProxyEventV2,
) => {
  const projectSegments = segments.slice(2); // After "files" and "projects"

  switch (method) {
    case 'GET': {
      if (projectSegments.length === 0) {
        // List user's projects
        const projects = await listProjects(auth.sub);
        return jsonResponse(200, { projects });
      }
      if (projectSegments.length === 1) {
        // Get project details
        const projectId = projectSegments[0];
        await requireProjectAccess(auth, projectId);
        const project = await getProject(projectId);
        if (!project) return errorResponse(404, 'Project not found');
        return jsonResponse(200, project);
      }
      break;
    }
    case 'POST': {
      if (projectSegments.length === 0) {
        // Create project
        const body = parseJsonBody<{ name: string }>(event.body);
        if (!body?.name) return errorResponse(400, 'name is required');
        const result = await createProject(body.name, auth.sub);
        return jsonResponse(201, result);
      }
      if (projectSegments.length === 2 && projectSegments[1] === 'members') {
        // Add member
        const projectId = projectSegments[0];
        await requireProjectAccess(auth, projectId, 'owner');
        const body = parseJsonBody<{ user_id: string; role: ProjectRole }>(event.body);
        if (!body?.user_id || !body?.role) return errorResponse(400, 'user_id and role are required');
        const result = await addProjectMember(projectId, body.user_id, body.role);
        if (!result) return errorResponse(404, 'Project not found');
        return jsonResponse(201, result);
      }
      break;
    }
    case 'PUT': {
      if (projectSegments.length === 1) {
        // Rename project
        const projectId = projectSegments[0];
        await requireProjectAccess(auth, projectId, 'owner');
        const body = parseJsonBody<{ name?: string }>(event.body);
        if (!body?.name) return errorResponse(400, 'name is required');
        await dynamo.send(
          new UpdateCommand({
            TableName: FILES_TABLE,
            Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
            UpdateExpression: 'SET #n = :name',
            ExpressionAttributeNames: { '#n': 'name' },
            ExpressionAttributeValues: { ':name': body.name },
          }),
        );
        return jsonResponse(200, { project_id: projectId, name: body.name });
      }
      break;
    }
    case 'DELETE': {
      if (projectSegments.length === 1) {
        // Delete project
        const projectId = projectSegments[0];
        await requireProjectAccess(auth, projectId, 'owner');
        const result = await deleteProject(projectId);
        if ('error' in result) return errorResponse(400, result.error);
        return jsonResponse(200, result);
      }
      if (projectSegments.length === 3 && projectSegments[1] === 'members') {
        // Remove member
        const projectId = projectSegments[0];
        await requireProjectAccess(auth, projectId, 'owner');
        const memberId = projectSegments[2];
        await removeProjectMember(projectId, memberId);
        return jsonResponse(200, { removed: true });
      }
      break;
    }
  }

  return errorResponse(404, 'Route not found');
};

const handleOrphanRoutes = async (
  method: string,
  segments: string[], // segments after "orphans"
  auth: AuthContext,
  event: APIGatewayProxyEventV2,
  scopeType: 'my' | 'company',
) => {
  const isCompany = scopeType === 'company';

  switch (method) {
    case 'GET': {
      if (segments.length === 0) {
        const cursor = event.queryStringParameters?.cursor;
        const limit = parseInt(event.queryStringParameters?.limit || '50', 10);
        const result = isCompany
          ? await listCompanyOrphans(cursor, Math.min(limit, 200))
          : await listOrphans(auth.sub, cursor, Math.min(limit, 200));
        return jsonResponse(200, result);
      }
      if (segments.length === 2 && segments[1] === 'download') {
        const result = isCompany
          ? await getCompanyOrphanDownloadUrl(segments[0])
          : await getOrphanDownloadUrl(auth.sub, segments[0]);
        if (!result) return errorResponse(403, 'Access denied or key not found');
        return jsonResponse(200, result);
      }
      break;
    }
    case 'POST': {
      if (segments.length === 1 && segments[0] === 'adopt') {
        const body = parseJsonBody<{ key: string; name?: string; parent_path?: string }>(event.body);
        if (!body?.key) return errorResponse(400, 'key is required');
        const result = isCompany
          ? await adoptCompanyOrphan(auth.sub, body.key, body.name, body.parent_path)
          : await adoptOrphan(auth.sub, body.key, body.name, body.parent_path);
        if (!result) return errorResponse(403, 'Access denied or key not found');
        return jsonResponse(201, result);
      }
      break;
    }
  }
  return errorResponse(404, 'Orphan route not found');
};

const handleFileRoutes = async (
  method: string,
  actionSegments: string[],
  scope: ScopeInfo,
  auth: AuthContext,
  event: APIGatewayProxyEventV2,
) => {
  // --- Orphan routes: /api/files/{my|company}/orphans/... ---
  if (actionSegments[0] === 'orphans' && (scope.scopeType === 'my' || scope.scopeType === 'company')) {
    return await handleOrphanRoutes(method, actionSegments.slice(1), auth, event, scope.scopeType);
  }

  switch (method) {
    case 'GET': {
      if (actionSegments.length === 0) {
        // List folder
        const path = event.queryStringParameters?.path || '/';
        const result = await listFolder(scope.scopeKey, path);

        // Check extraction status for processing files and promote queued
        const processingFiles = result.files.filter((f) => f.extraction_status === 'processing');
        for (const file of processingFiles) {
          const status = await checkExtractionStatus(
            scope.scopeKey,
            scope.s3Prefix,
            file.file_id as string,
            file.parent_path as string,
          );
          if (status.updated) {
            file.extraction_status = status.status;
          }
        }

        // Promote queued files if slots opened
        await promoteQueuedFiles(scope.scopeKey, scope.s3Prefix);

        return jsonResponse(200, result);
      }
      if (actionSegments.length === 1) {
        // Get file metadata
        const fileId = actionSegments[0];
        const file = await getFile(scope.scopeKey, scope.s3Prefix, fileId);
        if (!file) return errorResponse(404, 'File not found');
        return jsonResponse(200, file);
      }
      if (actionSegments.length === 2 && actionSegments[1] === 'download') {
        // Get download URL
        const fileId = actionSegments[0];
        const file = await findFileById(scope.scopeKey, fileId);
        if (!file) return errorResponse(404, 'File not found');
        const result = await getDownloadUrl(scope.s3Prefix, fileId, file.name as string);
        return jsonResponse(200, result);
      }
      break;
    }

    case 'POST': {
      if (actionSegments.length === 0) {
        const body = parseJsonBody<Record<string, unknown>>(event.body);
        if (!body) return errorResponse(400, 'Request body is required');

        if (body.action === 'create_folder') {
          const path = (body.path as string) || '/';
          const name = body.name as string;
          if (!name) return errorResponse(400, 'name is required');
          const result = await createFolder(scope.scopeKey, path, name, auth.sub);
          if ('error' in result) return errorResponse(409, result.error as string);
          return jsonResponse(201, result);
        }

        if (body.action === 'register') {
          const fileId = body.file_id as string;
          const name = body.name as string;
          const parentPath = (body.parent_path as string) || '/';
          const contentType = (body.content_type as string) || 'application/octet-stream';
          const sizeBytes = (body.size_bytes as number) || 0;
          if (!fileId || !name) return errorResponse(400, 'file_id and name are required');
          const result = await registerFile(
            scope.scopeKey,
            scope.s3Prefix,
            fileId,
            name,
            parentPath,
            contentType,
            sizeBytes,
            auth.sub,
          );
          return jsonResponse(201, result);
        }

        return errorResponse(400, 'Unknown action. Use: create_folder, register');
      }

      if (actionSegments.length === 2 && actionSegments[1] === 'copy') {
        // Copy file
        const fileId = actionSegments[0];
        const body = parseJsonBody<{ parent_path?: string; name?: string }>(event.body);
        const result = await copyFile(scope.scopeKey, scope.s3Prefix, fileId, body?.parent_path, body?.name);
        if (!result) return errorResponse(404, 'Source file not found');
        return jsonResponse(201, result);
      }
      break;
    }

    case 'PUT': {
      if (actionSegments.length === 1) {
        if (actionSegments[0] === 'folder') {
          // Rename/move folder
          const body = parseJsonBody<{ path: string; name?: string; new_parent?: string }>(event.body);
          if (!body?.path) return errorResponse(400, 'path is required');
          const result = await renameFolder(scope.scopeKey, body.path, body.name, body.new_parent);
          if (!result) return errorResponse(404, 'Folder not found');
          if ('error' in result) return errorResponse(400, result.error as string);
          return jsonResponse(200, result);
        }

        // Rename/move file
        const fileId = actionSegments[0];
        const body = parseJsonBody<{ name?: string; parent_path?: string }>(event.body);
        const result = await renameFile(scope.scopeKey, fileId, body?.name, body?.parent_path);
        if (!result) return errorResponse(404, 'File not found');
        return jsonResponse(200, result);
      }
      break;
    }

    case 'DELETE': {
      if (actionSegments.length === 1) {
        if (actionSegments[0] === 'folder') {
          // Delete folder
          const path = event.queryStringParameters?.path;
          if (!path) return errorResponse(400, 'path query parameter is required');
          const result = await deleteFolder(scope.scopeKey, path);
          if ('error' in result) return errorResponse(400, result.error);
          return jsonResponse(200, result);
        }

        // Delete file
        const fileId = actionSegments[0];
        const deleted = await deleteFile(scope.scopeKey, scope.s3Prefix, fileId);
        if (!deleted) return errorResponse(404, 'File not found');
        return jsonResponse(200, { deleted: true });
      }
      break;
    }
  }

  return errorResponse(404, 'Route not found');
};
