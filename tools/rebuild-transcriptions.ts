#!/usr/bin/env -S node --import tsx
/**
 * Rebuild transcription DynamoDB records from S3 output.status.json files.
 *
 * When the transcriptions DynamoDB table is recreated (e.g. during deployment),
 * job metadata is lost even though the S3 data (uploads + outputs) remains.
 * This script scans S3 for completed transcription jobs and re-creates the
 * corresponding DynamoDB records.
 *
 * Usage:
 *   npx tsx tools/rebuild-transcriptions.ts --client arcanum-demo-tony
 *   npx tsx tools/rebuild-transcriptions.ts --client arcanum-demo-tony --dry-run
 */
import { Command } from 'commander';
import { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand, ScanCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { withPRM } from '../lib/prm-node/prm';
import path from 'node:path';

const program = new Command();
program
  .description('Rebuild transcription DynamoDB records from S3 output.status.json files')
  .requiredOption('-c, --client <name>', 'Client name (e.g. arcanum-demo-tony)')
  .option('--dry-run', 'Preview what would be written without making changes', false)
  .option('--region <region>', 'AWS region', 'us-east-1')
  .parse();

const opts = program.opts();
const clientName = opts.client as string;
const dryRun = opts.dryRun as boolean;
const region = opts.region as string;

const dataBucket = `numa-${clientName}-data`;
const tableName = `numa-${clientName}-transcriptions`;

const s3 = withPRM(S3Client, { region });
const dynamo = withPRM(DynamoDBClient, { region });

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function getJson(bucket: string, key: string): Promise<Record<string, unknown> | null> {
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await streamToString(resp.Body as NodeJS.ReadableStream);
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function getExistingJobIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let lastKey: Record<string, { S: string }> | undefined;
  do {
    const resp = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: 'jobId',
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of resp.Items ?? []) {
      ids.add(item.jobId.S!);
    }
    lastKey = resp.LastEvaluatedKey as typeof lastKey;
  } while (lastKey);
  return ids;
}

interface StatusFile {
  version: number;
  status: string;
  input_bucket: string;
  input_key: string;
  output_bucket: string;
  output_key: string;
  file_name: string;
  started_at: number;
  updated_at: number;
  duration_ms: number;
  request_id?: string;
  file_size?: number;
  file_extension?: string;
  file_hash?: string;
  client_name?: string;
  data_bucket?: string;
  costs?: Record<string, unknown>;
  error_message?: string;
}

async function listStatusFiles(): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: dataBucket,
        Prefix: 'transcriptions/',
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key?.endsWith('/output.status.json')) {
        keys.push(obj.Key);
      }
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

function parseStatusKey(key: string): { userSub: string; jobId: string } | null {
  // transcriptions/{userSub}/{jobId}/output.status.json
  const parts = key.split('/');
  if (parts.length < 4) return null;
  return { userSub: parts[1], jobId: parts[2] };
}

async function getUploadFileSize(fileKey: string): Promise<number | null> {
  try {
    const resp = await s3.send(new HeadObjectCommand({ Bucket: dataBucket, Key: fileKey }));
    return resp.ContentLength ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`Rebuilding transcriptions for client: ${clientName}`);
  console.log(`  Data bucket: ${dataBucket}`);
  console.log(`  DynamoDB table: ${tableName}`);
  if (dryRun) console.log('  *** DRY RUN - no writes ***\n');

  // Get existing records to avoid duplicates
  console.log('Scanning existing DynamoDB records...');
  const existingIds = await getExistingJobIds();
  console.log(`  Found ${existingIds.size} existing records\n`);

  // List all output.status.json files
  console.log('Scanning S3 for output.status.json files...');
  const statusKeys = await listStatusFiles();
  console.log(`  Found ${statusKeys.length} status files\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const statusKey of statusKeys) {
    const parsed = parseStatusKey(statusKey);
    if (!parsed) {
      console.log(`  SKIP (bad key format): ${statusKey}`);
      skipped++;
      continue;
    }

    if (existingIds.has(parsed.jobId)) {
      skipped++;
      continue;
    }

    const status = (await getJson(dataBucket, statusKey)) as unknown as StatusFile | null;
    if (!status) {
      console.log(`  FAIL (cannot read): ${statusKey}`);
      failed++;
      continue;
    }

    const outputKey = statusKey.replace('/output.status.json', '/output.json');

    // Derive file extension — prefer enriched value, fallback to path.extname
    const fileName = status.file_name || 'unknown';
    const fileExtension = status.file_extension || path.extname(fileName) || '';

    // Try to get upload file size — prefer enriched value, fallback to HeadObject
    let fileSize = status.file_size ?? null;
    if (fileSize == null && status.input_key) {
      fileSize = await getUploadFileSize(status.input_key);
    }

    // Map S3 status to DynamoDB status
    const dbStatus = status.status === 'SUCCEEDED' ? 'COMPLETED' : status.status === 'FAILED' ? 'FAILED' : 'COMPLETED';

    // Build DynamoDB item — use enriched fields when available, fallback for v1 status files
    const item: Record<string, AttributeValue> = {
      userSub: { S: parsed.userSub },
      jobId: { S: parsed.jobId },
      clientName: { S: status.client_name || clientName },
      fileName: { S: fileName },
      fileExtension: { S: fileExtension },
      status: { S: dbStatus },
      outputKey: { S: outputKey },
      fileKey: { S: status.input_key || '' },
      dataBucket: { S: status.data_bucket || dataBucket },
      createdAt: { N: String(status.started_at * 1000) },
      updatedAt: { N: String(status.updated_at * 1000) },
      progress: { N: '100' },
    };

    if (fileSize != null) {
      item.fileSize = { N: String(fileSize) };
    }

    if (status.file_hash) {
      item.fileHash = { S: status.file_hash };
    }

    if (status.duration_ms) {
      item.processingTimeMs = { N: String(status.duration_ms) };
    }

    if (status.error_message) {
      item.errorMessage = { S: status.error_message };
    }

    if (status.costs) {
      const marshalledCosts = marshall(status.costs, { removeUndefinedValues: true });
      item.costs = { M: marshalledCosts };
    }

    // Set expiresAt to 90 days from now (matching default TTL)
    const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
    item.expiresAt = { N: String(expiresAt) };

    console.log(`  ${dryRun ? 'WOULD CREATE' : 'CREATE'}: ${fileName} (${parsed.jobId})`);

    if (!dryRun) {
      try {
        await dynamo.send(
          new PutItemCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(userSub)',
          })
        );
        created++;
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          skipped++;
        } else {
          console.log(`  FAIL: ${(err as Error).message}`);
          failed++;
        }
      }
    } else {
      created++;
    }
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
