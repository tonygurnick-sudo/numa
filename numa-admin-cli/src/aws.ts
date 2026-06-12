/**
 * AWS client utilities for Numa CLI.
 * Handles credential management and client creation.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, ListDistributionsCommand, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { fromIni, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import type { EnvironmentConfig } from './types.js';
import { getDeployerProfile } from './config.js';

/**
 * Create a DynamoDB Document Client for the given environment.
 */
export function createDynamoDBClient(env: EnvironmentConfig): DynamoDBDocumentClient {
  const credentials = env.awsProfile ? fromIni({ profile: env.awsProfile }) : undefined;

  const client = new DynamoDBClient({
    region: env.region,
    credentials,
  });

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

/**
 * Create an S3 Client for the given environment.
 */
export function createS3Client(env: EnvironmentConfig): S3Client {
  const credentials = env.awsProfile ? fromIni({ profile: env.awsProfile }) : undefined;

  return new S3Client({
    region: env.region,
    credentials,
  });
}

/**
 * Create credentials for the deployer account (DynamoDB client-config access).
 */
export function createDeployerCredentials(): AwsCredentialIdentityProvider {
  return fromIni({ profile: getDeployerProfile() });
}

/**
 * Create credentials for a client account by chaining through the deployer role.
 */
export function createClientAccountCredentials(accountId: string): AwsCredentialIdentityProvider {
  return fromTemporaryCredentials({
    masterCredentials: fromIni({ profile: getDeployerProfile() }),
    params: {
      RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
      RoleSessionName: 'numa-cli-flags',
    },
  });
}

/**
 * Get the shared documents bucket name for a client.
 */
export function getSharedBucketName(clientName: string): string {
  return `numa-${clientName}-shared`;
}

/**
 * Get the shared documents DynamoDB table name for a client.
 */
export function getSharedTableName(clientName: string): string {
  return `numa-${clientName}-shared`;
}

/**
 * Get the frontend S3 bucket name for a client.
 */
export function getFrontendBucketName(clientName: string): string {
  return `numa-${clientName}-fe`;
}

/**
 * Create an S3 client for a client account (assumes ArcanumAIAccess role).
 */
export function createClientS3Client(env: EnvironmentConfig): S3Client {
  const credentials = createClientAccountCredentials(env.clientAccountId);
  return new S3Client({ region: env.region, credentials });
}

/**
 * Upload a JSON file to a client's frontend S3 bucket.
 */
export async function putFrontendS3Object(env: EnvironmentConfig, key: string, body: string): Promise<void> {
  const s3 = createClientS3Client(env);
  const bucketName = getFrontendBucketName(env.clientName);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    })
  );
}

/**
 * Find the CloudFront distribution for a client and invalidate the given paths.
 */
export async function invalidateCloudFront(env: EnvironmentConfig, paths: string[]): Promise<void> {
  const credentials = createClientAccountCredentials(env.clientAccountId);
  const cf = new CloudFrontClient({ region: 'us-east-1', credentials });

  const bucketDomain = `${getFrontendBucketName(env.clientName)}.s3`;
  let distributionId: string | undefined;

  const listResponse = await cf.send(new ListDistributionsCommand({}));
  for (const dist of listResponse.DistributionList?.Items ?? []) {
    for (const origin of dist.Origins?.Items ?? []) {
      if (origin.DomainName?.includes(bucketDomain)) {
        distributionId = dist.Id;
        break;
      }
    }
    if (distributionId) break;
  }

  if (!distributionId) {
    console.warn(`  ⚠️  Could not find CloudFront distribution for ${env.clientName}. Cache not invalidated.`);
    return;
  }

  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `numa-cli-${Date.now()}`,
        Paths: {
          Quantity: paths.length,
          Items: paths,
        },
      },
    })
  );
}
