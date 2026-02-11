/**
 * AWS client utilities for Numa CLI.
 * Handles credential management and client creation.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import type { EnvironmentConfig } from './types.js';

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
