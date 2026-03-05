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

export interface ImageMetadata {
  imageTag: string;
  digest: string;
  customName?: string;
  description?: string;
  createdAt?: string;
  createdBy?: string;
}

function getDdbDoc(): DynamoDBDocumentClient {
  const region = getRegion();
  const client = new DynamoDBClient({ region, credentials: getAwsCredentialsProvider() });
  return DynamoDBDocumentClient.from(client);
}

function getImageMetadataTable(): string {
  // Use a configuration key for the table name, with fallback
  return getConfigValue('IMAGE_METADATA_TABLE') || 'numa-portal-image-metadata';
}

export async function getImageMetadata(imageTag: string, digest: string): Promise<ImageMetadata | null> {
  const table = getImageMetadataTable();
  const ddb = getDdbDoc();

  try {
    const res = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: {
          imageTag,
          digest,
        },
      })
    );
    return (res.Item as ImageMetadata) || null;
  } catch (error) {
    console.warn('Failed to get image metadata:', error);
    return null;
  }
}

export async function setImageMetadata(metadata: ImageMetadata): Promise<void> {
  const table = getImageMetadataTable();
  const ddb = getDdbDoc();

  const item: ImageMetadata = {
    ...metadata,
    createdAt: metadata.createdAt || new Date().toISOString(),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: item,
      })
    );
  } catch (error) {
    console.error('Failed to set image metadata:', error);
    throw new Error('Unable to save image metadata');
  }
}

export async function deleteImageMetadata(imageTag: string, digest: string): Promise<void> {
  const table = getImageMetadataTable();
  const ddb = getDdbDoc();

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: {
          imageTag,
          digest,
        },
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
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        Limit: 200, // Reasonable limit for image metadata
      })
    );
    return (res.Items as ImageMetadata[]) || [];
  } catch (error) {
    console.warn('Failed to get all image metadata:', error);
    return [];
  }
}

// Helper function to get custom name for an image, with fallback to tag
export function getDisplayName(imageTag: string, customName?: string): string {
  return customName || imageTag;
}
