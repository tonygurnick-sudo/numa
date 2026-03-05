/**
 * User Files API — per-user virtual file system with three access scopes:
 *
 * - My Files:  USER#{user_id}  — private to the user
 * - Company:   COMPANY         — all tenant users
 * - Projects:  PROJECT#{id}    — explicit membership with roles
 *
 * Files are stored directly in S3 at {s3Prefix}{parentPath}{fileName}.
 * DynamoDB is used only for folders and projects — no per-file records.
 * File listings come from S3 ListObjectsV2.
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
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const FILES_TABLE = process.env.FILES_TABLE_NAME;
const DATA_BUCKET = process.env.DATA_BUCKET_NAME;

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

const normalizePath = (p: string | undefined): string => {
  if (!p || p === '/') return '/';
  let normalized = p.startsWith('/') ? p : `/${p}`;
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
};

/**
 * Convert a normalized virtual path to the S3 key prefix.
 * "/" → "{s3Prefix}/"
 * "/documents/" → "{s3Prefix}/documents/"
 */
const toS3Prefix = (s3Prefix: string, virtualPath: string): string => {
  if (virtualPath === '/') return `${s3Prefix}/`;
  // Strip leading slash, keep trailing slash
  return `${s3Prefix}${virtualPath}`;
};

// ---------------------------------------------------------------------------
// S3 folder marker helpers (_folder.json — DynamoDB-backed folder existence)
// ---------------------------------------------------------------------------

const folderMarkerKey = (s3Prefix: string, folderPath: string): string => {
  const normalized = normalizePath(folderPath);
  const markerSegment = normalized === '/' ? '/' : normalized.replace(/\/$/, '');
  return `${s3Prefix}/_folders${markerSegment}/_folder.json`;
};

const writeFolderMarker = async (
  s3Prefix: string,
  scopeKey: string,
  folderPath: string,
  folderName: string,
  userId: string,
  createdAt?: string,
  updatedAt?: string
) => {
  const now = new Date().toISOString();
  const marker = {
    version: 2,
    name: folderName,
    path: normalizePath(folderPath),
    parent_path: parentPathOf(folderPath),
    scope_key: scopeKey,
    created_at: createdAt || now,
    updated_at: updatedAt || now,
    created_by: userId,
    item_type: 'folder',
  };
  await s3.send(
    new PutObjectCommand({
      Bucket: DATA_BUCKET,
      Key: folderMarkerKey(s3Prefix, folderPath),
      Body: JSON.stringify(marker, null, 2),
      ContentType: 'application/json',
    })
  );
};

const deleteFolderMarker = async (s3Prefix: string, folderPath: string) => {
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: DATA_BUCKET,
      Delete: { Objects: [{ Key: folderMarkerKey(s3Prefix, folderPath) }] },
    })
  );
};

const parentPathOf = (folderPath: string): string => {
  const normalized = normalizePath(folderPath);
  if (normalized === '/') return '/';
  const withoutTrailing = normalized.replace(/\/$/, '');
  const parts = withoutTrailing.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return '/' + parts.slice(0, -1).join('/') + '/';
};

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

const listAllS3Objects = async (prefix: string, suffix?: string): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: DATA_BUCKET!,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of result.Contents || []) {
      if (obj.Key && (!suffix || obj.Key.endsWith(suffix))) {
        keys.push(obj.Key);
      }
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
};

/**
 * Move all S3 objects from one prefix to another (copy + delete).
 */
const moveS3Prefix = async (oldPrefix: string, newPrefix: string) => {
  const allKeys = await listAllS3Objects(oldPrefix);
  for (const key of allKeys) {
    const newKey = key.replace(oldPrefix, newPrefix);
    await s3.send(
      new CopyObjectCommand({
        Bucket: DATA_BUCKET!,
        CopySource: `${DATA_BUCKET}/${key}`,
        Key: newKey,
      })
    );
    await s3.send(new DeleteObjectCommand({ Bucket: DATA_BUCKET!, Key: key }));
  }
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

const resolveScope = (segments: string[], auth: AuthContext): ScopeInfo | null => {
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
      s3Prefix: `files/projects/${projectId}`,
      scopeType: 'project',
      projectId,
    };
  }
  return null;
};

const checkProjectAccess = async (userId: string, projectId: string): Promise<ProjectRole | null> => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: `MEMBER#${userId}`, sk: `PROJECT#${projectId}` },
    })
  );
  if (!result.Item) return null;
  return (result.Item.role as ProjectRole) || null;
};

const requireProjectAccess = async (
  auth: AuthContext,
  projectId: string,
  minRole: ProjectRole = 'viewer'
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
// File operations (S3-native — no DynamoDB records for files)
// ---------------------------------------------------------------------------

/**
 * List folder contents. Folders come from DynamoDB, files come from S3.
 */
const listFolder = async (scopeKey: string, path: string, s3Prefix: string) => {
  const normalizedPath = normalizePath(path);
  const s3ListPrefix = toS3Prefix(s3Prefix, normalizedPath);

  // Parallel: DynamoDB folders + S3 objects
  const [foldersRes, s3Result] = await Promise.all([
    dynamo.send(
      new QueryCommand({
        TableName: FILES_TABLE,
        KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':sk': scopeKey, ':prefix': `FOLDER#${normalizedPath}` },
      })
    ),
    s3.send(
      new ListObjectsV2Command({
        Bucket: DATA_BUCKET!,
        Prefix: s3ListPrefix,
        Delimiter: '/',
      })
    ),
  ]);

  // --- Folders: merge DynamoDB records + S3 CommonPrefixes ---
  const ddbFolderMap = new Map<string, Record<string, unknown>>();
  for (const item of foldersRes.Items || []) {
    const folderPath = (item.sk as string).replace('FOLDER#', '');
    if (folderPath === normalizedPath) continue;
    const remainder = folderPath.slice(normalizedPath.length);
    const segments = remainder.split('/').filter(Boolean);
    if (segments.length === 1) {
      ddbFolderMap.set(segments[0], item);
    }
  }

  // S3 CommonPrefixes: implicit folders from file uploads
  const s3FolderNames = new Set<string>();
  for (const prefix of s3Result.CommonPrefixes || []) {
    if (!prefix.Prefix) continue;
    const relative = prefix.Prefix.slice(s3ListPrefix.length);
    const name = relative.replace(/\/$/, '');
    // Skip infrastructure prefixes
    if (name && !name.startsWith('_') && !name.startsWith('.')) {
      s3FolderNames.add(name);
    }
  }

  const allFolderNames = new Set([...ddbFolderMap.keys(), ...s3FolderNames]);
  const folders = Array.from(allFolderNames)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const ddbItem = ddbFolderMap.get(name);
      return {
        name,
        path: `${normalizedPath}${name}/`,
        created_at: ddbItem?.created_at || new Date().toISOString(),
        updated_at: ddbItem?.updated_at || new Date().toISOString(),
        created_by: ddbItem?.created_by || 'unknown',
        item_type: 'folder',
      };
    });

  // --- Files: from S3 Contents ---
  const files = (s3Result.Contents || [])
    .filter((obj) => {
      if (!obj.Key) return false;
      const name = obj.Key.slice(s3ListPrefix.length);
      // Must be a direct child (no sub-path separators), not empty, not hidden
      if (!name || name.includes('/')) return false;
      if (name.startsWith('_') || name.startsWith('.')) return false;
      return true;
    })
    .map((obj) => {
      const name = obj.Key!.slice(s3ListPrefix.length);
      return {
        name,
        parent_path: normalizedPath,
        size_bytes: obj.Size || 0,
        last_modified: obj.LastModified?.toISOString() || new Date().toISOString(),
        item_type: 'file',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { path: normalizedPath, folders, files };
};

const createFolder = async (scopeKey: string, s3Prefix: string, parentPath: string, name: string, userId: string) => {
  const normalizedParent = normalizePath(parentPath);
  const folderPath = `${normalizedParent}${name}/`;
  const sk = `FOLDER#${folderPath}`;
  const now = new Date().toISOString();

  const existing = await dynamo.send(new GetCommand({ TableName: FILES_TABLE, Key: { scope_key: scopeKey, sk } }));
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
    })
  );

  await writeFolderMarker(s3Prefix, scopeKey, folderPath, name, userId, now, now);

  return { path: folderPath, name, created_at: now };
};

/**
 * Get a presigned download URL for a file.
 * @param filePath Virtual path like "/documents/report.pdf"
 */
const getDownloadUrl = async (s3Prefix: string, filePath: string) => {
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const key = `${s3Prefix}/${normalizedPath}`;
  const command = new GetObjectCommand({ Bucket: DATA_BUCKET, Key: key });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = await getSignedUrl(s3 as any, command, { expiresIn: 3600 });
  return { url, key };
};

/**
 * Delete a file from S3.
 * @param filePath Virtual path like "/documents/report.pdf"
 */
const deleteFileOp = async (s3Prefix: string, filePath: string) => {
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const key = `${s3Prefix}/${normalizedPath}`;
  await s3.send(new DeleteObjectCommand({ Bucket: DATA_BUCKET!, Key: key }));
  return true;
};

/**
 * Rename and/or move a file in S3 (copy + delete).
 * @param filePath Virtual path like "/documents/report.pdf"
 */
const renameFileOp = async (s3Prefix: string, filePath: string, newName?: string, newParentPath?: string) => {
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const sourceKey = `${s3Prefix}/${normalizedPath}`;

  const lastSlash = normalizedPath.lastIndexOf('/');
  const currentParent = lastSlash >= 0 ? normalizedPath.slice(0, lastSlash + 1) : '';
  const currentName = lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;

  const targetParent = newParentPath
    ? normalizePath(newParentPath).slice(1) // strip leading slash, keep trailing
    : currentParent;
  const targetName = newName || currentName;
  const destKey = `${s3Prefix}/${targetParent}${targetName}`;

  if (sourceKey === destKey) {
    return { name: targetName, parent_path: `/${targetParent}` };
  }

  await s3.send(
    new CopyObjectCommand({
      Bucket: DATA_BUCKET!,
      CopySource: `${DATA_BUCKET}/${sourceKey}`,
      Key: destKey,
    })
  );
  await s3.send(new DeleteObjectCommand({ Bucket: DATA_BUCKET!, Key: sourceKey }));

  return { name: targetName, parent_path: `/${targetParent}` };
};

/**
 * Copy a file in S3.
 * @param filePath Virtual path like "/documents/report.pdf"
 */
const copyFileOp = async (s3Prefix: string, filePath: string, targetParentPath?: string, targetName?: string) => {
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const sourceKey = `${s3Prefix}/${normalizedPath}`;

  const lastSlash = normalizedPath.lastIndexOf('/');
  const currentParent = lastSlash >= 0 ? normalizedPath.slice(0, lastSlash + 1) : '';
  const currentName = lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;

  const targetParent = targetParentPath ? normalizePath(targetParentPath).slice(1) : currentParent;
  const finalName = targetName || currentName;
  const destKey = `${s3Prefix}/${targetParent}${finalName}`;

  await s3.send(
    new CopyObjectCommand({
      Bucket: DATA_BUCKET!,
      CopySource: `${DATA_BUCKET}/${sourceKey}`,
      Key: destKey,
    })
  );

  return { name: finalName, parent_path: `/${targetParent}` };
};

// ---------------------------------------------------------------------------
// Folder operations
// ---------------------------------------------------------------------------

const deleteFolder = async (scopeKey: string, s3Prefix: string, path: string) => {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/') return { error: 'Cannot delete root folder' };

  // Check if folder is empty (files from S3, folders from DynamoDB + S3)
  const contents = await listFolder(scopeKey, normalizedPath, s3Prefix);
  if (contents.files.length > 0 || contents.folders.length > 0) {
    return { error: 'Folder is not empty' };
  }

  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: scopeKey, sk: `FOLDER#${normalizedPath}` },
    })
  );

  await deleteFolderMarker(s3Prefix, normalizedPath);

  return { deleted: true, path: normalizedPath };
};

const renameFolder = async (scopeKey: string, s3Prefix: string, path: string, newName?: string, newParent?: string) => {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/') return { error: 'Cannot rename root folder' };

  const existing = await dynamo.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: scopeKey, sk: `FOLDER#${normalizedPath}` },
    })
  );
  if (!existing.Item) return null;

  const now = new Date().toISOString();

  // --- Move folder to a new parent ---
  if (newParent) {
    const normalizedNewParent = normalizePath(newParent);
    const folderName = newName || (existing.Item.name as string);
    const newPath = `${normalizedNewParent}${folderName}/`;

    if (newPath.startsWith(normalizedPath)) {
      return { error: 'Cannot move a folder into itself or a descendant' };
    }

    const targetCheck = await dynamo.send(
      new GetCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: `FOLDER#${newPath}` },
      })
    );
    if (targetCheck.Item) return { error: 'A folder with this name already exists at the target' };

    // Move all S3 objects (actual files) from old prefix to new
    const oldS3Prefix = toS3Prefix(s3Prefix, normalizedPath);
    const newS3Prefix = toS3Prefix(s3Prefix, newPath);
    await moveS3Prefix(oldS3Prefix, newS3Prefix);

    // Update DynamoDB folder records
    const descendantFolders = await dynamo.send(
      new QueryCommand({
        TableName: FILES_TABLE,
        KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':sk': scopeKey, ':prefix': `FOLDER#${normalizedPath}` },
      })
    );

    for (const item of descendantFolders.Items || []) {
      const oldSk = item.sk as string;
      const oldFolderPath = oldSk.replace('FOLDER#', '');
      const newFolderPath = oldFolderPath.replace(normalizedPath, newPath);
      const itemName = oldFolderPath === normalizedPath ? folderName : item.name;

      await dynamo.send(
        new DeleteCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: scopeKey, sk: oldSk },
        })
      );
      await dynamo.send(
        new PutCommand({
          TableName: FILES_TABLE,
          Item: { ...item, sk: `FOLDER#${newFolderPath}`, name: itemName, updated_at: now },
        })
      );

      await deleteFolderMarker(s3Prefix, oldFolderPath);
      await writeFolderMarker(
        s3Prefix,
        scopeKey,
        newFolderPath,
        itemName as string,
        item.created_by as string,
        item.created_at as string,
        now
      );
    }

    return { path: newPath, name: folderName };
  }

  // --- Rename only ---
  if (newName) {
    const parts = normalizedPath.split('/').filter(Boolean);
    parts[parts.length - 1] = newName;
    const newPath = `/${parts.join('/')}/`;

    // Move S3 objects from old prefix to new
    const oldS3Prefix = toS3Prefix(s3Prefix, normalizedPath);
    const newS3Prefix = toS3Prefix(s3Prefix, newPath);
    await moveS3Prefix(oldS3Prefix, newS3Prefix);

    await dynamo.send(
      new DeleteCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: `FOLDER#${normalizedPath}` },
      })
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
      })
    );

    await deleteFolderMarker(s3Prefix, normalizedPath);
    await writeFolderMarker(
      s3Prefix,
      scopeKey,
      newPath,
      newName,
      existing.Item.created_by as string,
      existing.Item.created_at as string,
      now
    );

    return { path: newPath, name: newName };
  }

  return existing.Item;
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
    })
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
    })
  );

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
    })
  );

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
    })
  );

  return { project_id: projectId, name, created_at: now, role: 'owner' };
};

const getProject = async (projectId: string) => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
    })
  );
  return result.Item || null;
};

const addProjectMember = async (projectId: string, userId: string, role: ProjectRole) => {
  const now = new Date().toISOString();
  const project = await getProject(projectId);
  if (!project) return null;

  const projectName = project.name as string;

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
    })
  );

  const members = new Set((project.members as string[]) || []);
  members.add(userId);
  await dynamo.send(
    new UpdateCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
      UpdateExpression: 'SET members = :m',
      ExpressionAttributeValues: { ':m': Array.from(members) },
    })
  );

  return { user_id: userId, role, joined_at: now };
};

const removeProjectMember = async (projectId: string, userId: string) => {
  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: `MEMBER#${userId}`, sk: `PROJECT#${projectId}` },
    })
  );

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
      })
    );
  }

  return true;
};

const deleteProject = async (projectId: string) => {
  const contents = await listFolder(`PROJECT#${projectId}`, '/', `files/projects/${projectId}`);
  if (contents.files.length > 0 || contents.folders.length > 0) {
    return { error: 'Project has files or folders. Delete them first.' };
  }

  const project = await getProject(projectId);
  if (!project) return { error: 'Project not found' };

  const members = (project.members as string[]) || [];

  await Promise.all(
    members.map((uid) =>
      dynamo.send(
        new DeleteCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: `MEMBER#${uid}`, sk: `PROJECT#${projectId}` },
        })
      )
    )
  );

  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: `PROJECT#${projectId}`, sk: 'FOLDER#/' },
    })
  );

  await dynamo.send(
    new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { scope_key: 'PROJECTS', sk: `PROJECT#${projectId}` },
    })
  );

  return { deleted: true };
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (event.requestContext.http.method === 'OPTIONS') {
      return { statusCode: 200, headers: HEADERS, body: '' };
    }

    if (!FILES_TABLE || !DATA_BUCKET) {
      return errorResponse(500, 'Missing required environment variables');
    }

    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Unauthorized');

    const segments = buildPathSegments(event);
    const method = event.requestContext.http.method.toUpperCase();

    if (segments[0] !== 'files') return errorResponse(404, 'Route not found');

    // --- Project management routes: /api/files/projects/... ---
    if (segments[1] === 'projects') {
      return await handleProjectRoutes(method, segments, auth, event);
    }

    // --- File/folder routes: /api/files/{scope}/... ---
    const scope = resolveScope(segments, auth);
    if (!scope) return errorResponse(400, 'Invalid scope. Use: my, company, or project/{id}');

    if (scope.scopeType === 'project' && scope.projectId) {
      try {
        const role = await requireProjectAccess(auth, scope.projectId);
        if (['POST', 'PUT', 'DELETE'].includes(method) && role === 'viewer') {
          return errorResponse(403, 'Viewer role cannot modify files');
        }
      } catch (err) {
        if (err instanceof AccessDeniedError) return errorResponse(403, err.message);
        throw err;
      }
    }

    const scopeOffset = scope.scopeType === 'project' ? 3 : 2;
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
  event: APIGatewayProxyEventV2
) => {
  const projectSegments = segments.slice(2);

  switch (method) {
    case 'GET': {
      if (projectSegments.length === 0) {
        const projects = await listProjects(auth.sub);
        return jsonResponse(200, { projects });
      }
      if (projectSegments.length === 1) {
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
        const body = parseJsonBody<{ name: string }>(event.body);
        if (!body?.name) return errorResponse(400, 'name is required');
        const result = await createProject(body.name, auth.sub);
        return jsonResponse(201, result);
      }
      if (projectSegments.length === 2 && projectSegments[1] === 'members') {
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
          })
        );
        return jsonResponse(200, { project_id: projectId, name: body.name });
      }
      break;
    }
    case 'DELETE': {
      if (projectSegments.length === 1) {
        const projectId = projectSegments[0];
        await requireProjectAccess(auth, projectId, 'owner');
        const result = await deleteProject(projectId);
        if ('error' in result) return errorResponse(400, result.error);
        return jsonResponse(200, result);
      }
      if (projectSegments.length === 3 && projectSegments[1] === 'members') {
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

const handleFileRoutes = async (
  method: string,
  actionSegments: string[],
  scope: ScopeInfo,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
) => {
  switch (method) {
    case 'GET': {
      if (actionSegments.length === 0) {
        // List folder
        const path = event.queryStringParameters?.path || '/';
        const result = await listFolder(scope.scopeKey, path, scope.s3Prefix);
        return jsonResponse(200, result);
      }
      if (actionSegments[0] === 'download') {
        // Get download URL — ?path=/documents/report.pdf
        const filePath = event.queryStringParameters?.path;
        if (!filePath) return errorResponse(400, 'path query parameter is required');
        const result = await getDownloadUrl(scope.s3Prefix, filePath);
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
          const result = await createFolder(scope.scopeKey, scope.s3Prefix, path, name, auth.sub);
          if ('error' in result) return errorResponse(409, result.error as string);
          return jsonResponse(201, result);
        }

        return errorResponse(400, 'Unknown action. Use: create_folder');
      }

      if (actionSegments[0] === 'copy') {
        // Copy file
        const body = parseJsonBody<{ path: string; parent_path?: string; name?: string }>(event.body);
        if (!body?.path) return errorResponse(400, 'path is required');
        const result = await copyFileOp(scope.s3Prefix, body.path, body.parent_path, body.name);
        return jsonResponse(201, result);
      }
      break;
    }

    case 'PUT': {
      if (actionSegments[0] === 'file') {
        // Rename/move file
        const body = parseJsonBody<{ path: string; name?: string; parent_path?: string }>(event.body);
        if (!body?.path) return errorResponse(400, 'path is required');
        const result = await renameFileOp(scope.s3Prefix, body.path, body.name, body.parent_path);
        return jsonResponse(200, result);
      }
      if (actionSegments[0] === 'folder') {
        // Rename/move folder
        const body = parseJsonBody<{ path: string; name?: string; new_parent?: string }>(event.body);
        if (!body?.path) return errorResponse(400, 'path is required');
        const result = await renameFolder(scope.scopeKey, scope.s3Prefix, body.path, body.name, body.new_parent);
        if (!result) return errorResponse(404, 'Folder not found');
        if ('error' in result) return errorResponse(400, result.error as string);
        return jsonResponse(200, result);
      }
      break;
    }

    case 'DELETE': {
      if (actionSegments[0] === 'file') {
        // Delete file — ?path=/documents/report.pdf
        const filePath = event.queryStringParameters?.path;
        if (!filePath) return errorResponse(400, 'path query parameter is required');
        await deleteFileOp(scope.s3Prefix, filePath);
        return jsonResponse(200, { deleted: true });
      }
      if (actionSegments[0] === 'folder') {
        // Delete folder
        const path = event.queryStringParameters?.path;
        if (!path) return errorResponse(400, 'path query parameter is required');
        const result = await deleteFolder(scope.scopeKey, scope.s3Prefix, path);
        if ('error' in result) return errorResponse(400, result.error);
        return jsonResponse(200, result);
      }
      break;
    }
  }

  return errorResponse(404, 'Route not found');
};
