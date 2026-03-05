/**
 * files-index-sync — S3 event notification handler
 *
 * Keeps the DynamoDB files index in sync with S3 as source of truth.
 * Triggered by S3 ObjectCreated/ObjectRemoved events on:
 *   - metadata.json (file sidecars)
 *   - _folder.json (folder markers)
 */
import type { S3Event } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const ddbClient = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});
const s3 = new S3Client({});

const FILES_TABLE = process.env.FILES_TABLE_NAME!;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const readJsonFromS3 = async (bucket: string, key: string): Promise<Record<string, unknown> | null> => {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await result.Body!.transformToString();
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/**
 * Parse scope_key and fileId from an S3 key.
 * Key patterns:
 *   files/user/{userId}/{fileId}/metadata.json
 *   files/company/{fileId}/metadata.json
 *   files/projects/{projectId}/{fileId}/metadata.json
 */
const parseScopeAndFileIdFromKey = (key: string): { scopeKey: string | null; fileId: string | null } => {
  const parts = key.split('/');
  // parts[0] = 'files'
  if (parts[0] !== 'files') return { scopeKey: null, fileId: null };

  if (parts[1] === 'user' && parts.length >= 5) {
    // files/user/{userId}/{fileId}/metadata.json
    return { scopeKey: `USER#${parts[2]}`, fileId: parts[3] };
  }
  if (parts[1] === 'company' && parts.length >= 4) {
    // files/company/{fileId}/metadata.json
    return { scopeKey: 'COMPANY', fileId: parts[2] };
  }
  if (parts[1] === 'projects' && parts.length >= 5) {
    // files/projects/{projectId}/{fileId}/metadata.json
    return { scopeKey: `PROJECT#${parts[2]}`, fileId: parts[3] };
  }
  return { scopeKey: null, fileId: null };
};

/**
 * Parse scope_key and folder path from an S3 _folder.json key.
 * Key patterns:
 *   files/user/{userId}/_folders/documents/_folder.json
 *   files/company/_folders/spreadsheets/_folder.json
 *   files/projects/{projectId}/_folders/subdir/_folder.json
 */
const parseScopeAndPathFromFolderKey = (key: string): { scopeKey: string | null; folderPath: string | null } => {
  const parts = key.split('/');
  if (parts[0] !== 'files') return { scopeKey: null, folderPath: null };

  const foldersIdx = parts.indexOf('_folders');
  if (foldersIdx === -1) return { scopeKey: null, folderPath: null };

  // Everything between scope prefix and _folders is the scope info
  let scopeKey: string | null = null;
  if (parts[1] === 'user' && foldersIdx >= 3) {
    scopeKey = `USER#${parts[2]}`;
  } else if (parts[1] === 'company') {
    scopeKey = 'COMPANY';
  } else if (parts[1] === 'projects' && foldersIdx >= 3) {
    scopeKey = `PROJECT#${parts[2]}`;
  }

  if (!scopeKey) return { scopeKey: null, folderPath: null };

  // Everything after _folders and before _folder.json is the folder path
  const pathParts = parts.slice(foldersIdx + 1, -1); // Exclude _folder.json
  const folderPath = pathParts.length === 0 ? '/' : `/${pathParts.join('/')}/`;

  return { scopeKey, folderPath };
};

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

const handleFileMetadataEvent = async (bucket: string, key: string, eventName: string): Promise<void> => {
  if (eventName.startsWith('ObjectCreated')) {
    const metadata = await readJsonFromS3(bucket, key);
    if (!metadata) return;
    if (!metadata.version || (metadata.version as number) < 2) return; // Skip old format
    if (!metadata.scope_key || !metadata.file_id || !metadata.parent_path) return;

    const sk = `FILE#${metadata.parent_path}#${metadata.file_id}`;
    await dynamo.send(
      new PutCommand({
        TableName: FILES_TABLE,
        Item: {
          scope_key: metadata.scope_key as string,
          sk,
          file_id: metadata.file_id as string,
          name: metadata.name as string,
          parent_path: metadata.parent_path as string,
          size_bytes: metadata.size_bytes,
          content_type: metadata.content_type,
          source_type: metadata.source_type,
          extraction_status: metadata.extraction_status || 'not_applicable',
          extracted_words: metadata.extracted_words,
          extracted_pages: metadata.extracted_pages,
          created_at: metadata.created_at,
          updated_at: metadata.updated_at,
          created_by: metadata.created_by,
          item_type: 'file',
        },
      })
    );
    console.log(`Upserted file index: ${metadata.scope_key}/${sk}`);
  } else if (eventName.startsWith('ObjectRemoved')) {
    const { scopeKey, fileId } = parseScopeAndFileIdFromKey(key);
    if (!scopeKey || !fileId) return;

    // Find the DynamoDB entry by file_id
    const result = await dynamo.send(
      new QueryCommand({
        TableName: FILES_TABLE,
        KeyConditionExpression: 'scope_key = :sk AND begins_with(sk, :prefix)',
        FilterExpression: 'file_id = :fid',
        ExpressionAttributeValues: { ':sk': scopeKey, ':prefix': 'FILE#', ':fid': fileId },
      })
    );

    if (result.Items?.[0]) {
      await dynamo.send(
        new DeleteCommand({
          TableName: FILES_TABLE,
          Key: { scope_key: scopeKey, sk: result.Items[0].sk as string },
        })
      );
      console.log(`Deleted file index: ${scopeKey}/${result.Items[0].sk}`);
    }
  }
};

const handleFolderMarkerEvent = async (bucket: string, key: string, eventName: string): Promise<void> => {
  if (eventName.startsWith('ObjectCreated')) {
    const marker = await readJsonFromS3(bucket, key);
    if (!marker) return;
    if (!marker.version || (marker.version as number) < 2) return;
    if (!marker.scope_key || !marker.path) return;

    const folderPath = marker.path as string;
    await dynamo.send(
      new PutCommand({
        TableName: FILES_TABLE,
        Item: {
          scope_key: marker.scope_key as string,
          sk: `FOLDER#${folderPath}`,
          name: marker.name as string,
          created_at: marker.created_at,
          updated_at: marker.updated_at,
          created_by: marker.created_by,
          item_type: 'folder',
        },
      })
    );
    console.log(`Upserted folder index: ${marker.scope_key}/FOLDER#${folderPath}`);
  } else if (eventName.startsWith('ObjectRemoved')) {
    const { scopeKey, folderPath } = parseScopeAndPathFromFolderKey(key);
    if (!scopeKey || !folderPath) return;

    await dynamo.send(
      new DeleteCommand({
        TableName: FILES_TABLE,
        Key: { scope_key: scopeKey, sk: `FOLDER#${folderPath}` },
      })
    );
    console.log(`Deleted folder index: ${scopeKey}/FOLDER#${folderPath}`);
  }
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const eventName = record.eventName;

    try {
      if (key.endsWith('metadata.json') && !key.includes('/_folders/')) {
        await handleFileMetadataEvent(bucket, key, eventName);
      } else if (key.endsWith('_folder.json') && key.includes('/_folders/')) {
        await handleFolderMarkerEvent(bucket, key, eventName);
      }
    } catch (err) {
      console.error(`Error processing ${eventName} for ${key}:`, err);
      // Don't throw — process remaining records
    }
  }
};
