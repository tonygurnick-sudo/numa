import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { authService } from './authService';
import { getConfigValue } from './configService';

function getRegion(): string {
  return getConfigValue('AWS_REGION') || 'us-east-1';
}

function getAwsCredentialsProvider() {
  const region = getRegion();
  const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!;
  const userPoolId = getConfigValue('USER_POOL_ID')!;
  return async () => {
    const ensured = await authService.ensureValidSession(60 * 1000);
    const session = ensured || authService.getCurrentSession();
    if (!session) throw new Error('Not authenticated');
    const idToken = session.idToken;
    const base = fromCognitoIdentityPool({
      identityPoolId,
      logins: { [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken },
      clientConfig: { region },
    });
    return base();
  };
}

export type RepositoryName = 'numa-deploy' | 'numa-deploy-dev';

export interface ImageMetadata {
  repository: RepositoryName;
  imageTag: string;
  digest: string;
  customName?: string;
  description?: string;
  createdAt?: string;
  createdBy?: string;
}

// The DDB table's hash key is `imageTag` (legacy field name) — we encode the
// repository as a prefix so the same SHA tag in numa-deploy vs numa-deploy-dev
// gets distinct rows (and distinct custom names). Format: `${repository}#${imageTag}`.
function encodeKey(repository: RepositoryName, imageTag: string): string {
  return `${repository}#${imageTag}`;
}

// Pre-migration rows have no prefix (just the bare tag). Used as a fallback during
// the transition window so renamed prod images keep showing their custom names
// before the backfill runs.
function legacyKey(imageTag: string): string {
  return imageTag;
}

function decodeKey(encoded: string): { repository: RepositoryName; imageTag: string } | null {
  const sepIdx = encoded.indexOf('#');
  if (sepIdx === -1) return null; // legacy/un-prefixed row
  const repo = encoded.slice(0, sepIdx);
  if (repo !== 'numa-deploy' && repo !== 'numa-deploy-dev') return null;
  return { repository: repo, imageTag: encoded.slice(sepIdx + 1) };
}

function getDdbDoc(): DynamoDBDocumentClient {
  const region = getRegion();
  const client = new DynamoDBClient({ region, credentials: getAwsCredentialsProvider() });
  return DynamoDBDocumentClient.from(client);
}

function getImageMetadataTable(): string {
  return getConfigValue('IMAGE_METADATA_TABLE') || 'numa-portal-image-metadata';
}

interface RawRow {
  imageTag: string; // DDB hash key — encoded as `${repository}#${realTag}` post-migration
  digest: string;
  repository?: RepositoryName; // present on migrated/new rows
  customName?: string;
  description?: string;
  createdAt?: string;
  createdBy?: string;
}

function rowToMetadata(row: RawRow): ImageMetadata | null {
  const decoded = decodeKey(row.imageTag);
  if (decoded) {
    return {
      repository: decoded.repository,
      imageTag: decoded.imageTag,
      digest: row.digest,
      customName: row.customName,
      description: row.description,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
  // Legacy row (no prefix) — assume prod (numa-deploy). The migration script
  // backfills these rows to the new format so this branch goes away over time.
  return {
    repository: 'numa-deploy',
    imageTag: row.imageTag,
    digest: row.digest,
    customName: row.customName,
    description: row.description,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

export async function getImageMetadata(
  repository: RepositoryName,
  imageTag: string,
  digest: string
): Promise<ImageMetadata | null> {
  const table = getImageMetadataTable();
  const ddb = getDdbDoc();

  try {
    // Try the prefixed key first
    const res = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { imageTag: encodeKey(repository, imageTag), digest },
      })
    );
    if (res.Item) return rowToMetadata(res.Item as RawRow);

    // Fallback: legacy un-prefixed row, only meaningful for prod
    if (repository === 'numa-deploy') {
      const legacy = await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { imageTag: legacyKey(imageTag), digest },
        })
      );
      if (legacy.Item) return rowToMetadata(legacy.Item as RawRow);
    }
    return null;
  } catch (error) {
    console.warn('Failed to get image metadata:', error);
    return null;
  }
}

export async function setImageMetadata(metadata: ImageMetadata): Promise<void> {
  const table = getImageMetadataTable();
  const ddb = getDdbDoc();

  const item: RawRow = {
    imageTag: encodeKey(metadata.repository, metadata.imageTag),
    digest: metadata.digest,
    repository: metadata.repository,
    customName: metadata.customName,
    description: metadata.description,
    createdAt: metadata.createdAt || new Date().toISOString(),
    createdBy: metadata.createdBy,
  };

  try {
    await ddb.send(new PutCommand({ TableName: table, Item: item }));
  } catch (error) {
    console.error('Failed to set image metadata:', error);
    throw new Error('Unable to save image metadata');
  }
}

export async function deleteImageMetadata(repository: RepositoryName, imageTag: string, digest: string): Promise<void> {
  const table = getImageMetadataTable();
  const ddb = getDdbDoc();

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { imageTag: encodeKey(repository, imageTag), digest },
      })
    );
  } catch (error) {
    console.error('Failed to delete image metadata:', error);
    throw new Error('Unable to delete image metadata');
  }
}

export async function getAllImageMetadata(): Promise<ImageMetadata[]> {
  const table = getImageMetadataTable();
  const ddb = getDdbDoc();

  try {
    const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 500 }));
    const rows = (res.Items as RawRow[]) || [];
    return rows.map(rowToMetadata).filter((m): m is ImageMetadata => m !== null);
  } catch (error) {
    console.warn('Failed to get all image metadata:', error);
    return [];
  }
}

export function getDisplayName(imageTag: string, customName?: string): string {
  return customName || imageTag;
}
