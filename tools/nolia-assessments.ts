import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProvider,
  ListUserPoolsCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import chalk from 'chalk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { exit } from 'node:process';
import { getClientConfig } from '@arcanumai/client-config';
import { stringify } from 'csv';

interface AWSClientConfig {
  region: string;
  credentials: AwsCredentialIdentityProvider;
}

interface BasicClientConfig {
  clientAccountId: string;
  region: string;
}

function temporaryCredentials(accountId: string): AwsCredentialIdentityProvider {
  return fromTemporaryCredentials({
    params: { RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess` },
  });
}

const CLIENT_NAME = 'nolia-id-gov-moh';
const NZ_TZ = 'Pacific/Auckland';

interface AssessmentRun {
  nzStartTime: string;
  nzEndTime: string;
  status: 'Done' | 'Running' | 'Stalled' | 'Failed';
  assessmentType: string;
  language: string;
  document: string;
  runtimeMin: string;
  costUsd: string;
  turns: string;
  userEmail: string;
  userId: string;
  globalKb: string;
  procurementKb: string;
  projectKb: string;
  runId: string;
  createdUtc: string;
}

function toNzTime(isoStr: string): string {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('en-NZ', {
      timeZone: NZ_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr.slice(0, 16);
  }
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function getS3Result(
  s3: S3Client,
  bucket: string,
  userId: string,
  runId: string
): Promise<{ status: string; cost: number; durationMs: number; turns: number } | null> {
  const key = `v2-apps/nolia/${userId}/${runId}/_result.json`;
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await streamToString(resp.Body as NodeJS.ReadableStream);
    const data = JSON.parse(body);
    const usage = data.usage || {};
    return {
      status: (data.status || '?').toUpperCase(),
      cost: usage.total_cost_usd || 0,
      durationMs: usage.duration_ms || 0,
      turns: usage.num_turns || 0,
    };
  } catch {
    return null;
  }
}

async function hasS3Files(s3: S3Client, bucket: string, userId: string, runId: string): Promise<boolean> {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  try {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `v2-apps/nolia/${userId}/${runId}/`,
        MaxKeys: 1,
      })
    );
    return (resp.KeyCount || 0) > 0;
  } catch {
    return false;
  }
}

async function findUserPoolId(awsConfig: AWSClientConfig, clientName: string): Promise<string> {
  const cognito = new CognitoIdentityProvider(awsConfig);
  const response = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  const pool = response.UserPools?.find((p) => p.Name === `numa-${clientName}`);
  if (!pool) throw new Error(`User pool numa-${clientName} not found`);
  return pool.Id!;
}

async function resolveUserEmails(
  awsConfig: AWSClientConfig,
  userPoolId: string,
  userIds: string[]
): Promise<Record<string, string>> {
  const cognito = new CognitoIdentityProvider(awsConfig);
  const emails: Record<string, string> = {};

  for (const userId of userIds) {
    try {
      const resp = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: userId }));
      const emailAttr = resp.UserAttributes?.find((a) => a.Name === 'email');
      emails[userId] = emailAttr?.Value || userId;
    } catch {
      emails[userId] = userId;
    }
  }
  return emails;
}

async function main(): Promise<void> {
  console.log(chalk.blue.bold(`Nolia Assessment Runs Report`));
  console.log(chalk.blue(`Client: ${CLIENT_NAME}\n`));

  // Get client config from deployer
  const config: BasicClientConfig = await getClientConfig(CLIENT_NAME);
  const credentials = temporaryCredentials(config.clientAccountId);
  const awsConfig: AWSClientConfig = { region: config.region, credentials };

  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig));
  const s3 = new S3Client(awsConfig);
  const outputsBucket = `numa-${CLIENT_NAME}-outputs`;

  // Scan all V2 app runs
  console.log(chalk.blue('Scanning runs table...'));
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: `${CLIENT_NAME}-v2-app-runs`,
        ExclusiveStartKey: lastKey,
      })
    );
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Filter to assessments only (exclude rules gen)
  const assessmentItems = allItems.filter((item) => {
    const metadata = (item as Record<string, unknown>).inputs?.['options']?.['metadata'] || {};
    const kbCategory = metadata['kb_category'];
    const agentType = (item as Record<string, unknown>).agentType as string;
    return !kbCategory && !agentType?.includes('rules');
  });

  console.log(chalk.blue(`Found ${assessmentItems.length} assessment runs`));

  // Resolve user emails
  const userIds = [...new Set(assessmentItems.map((i) => i.userId as string).filter(Boolean))];
  console.log(chalk.blue(`Resolving ${userIds.length} user emails...`));
  const userPoolId = await findUserPoolId(awsConfig, CLIENT_NAME);
  const emailMap = await resolveUserEmails(awsConfig, userPoolId, userIds);

  // Check S3 for real status
  const runs: AssessmentRun[] = [];
  const now = Date.now();
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

  for (let i = 0; i < assessmentItems.length; i++) {
    const item = assessmentItems[i];
    const runId = item.runId as string;
    const userId = item.userId as string;
    const created = item.createdAt as string;
    const metadata = item.inputs?.['options']?.['metadata'] || {};
    const files = item.inputs?.['files'] || [];

    process.stderr.write(`\r  Checking S3 [${i + 1}/${assessmentItems.length}] ${runId.slice(0, 8)}...`);

    // Check DB result first (if DB has cost data, it was updated correctly)
    const dbResult = item.result as Record<string, unknown> | undefined;
    const dbUsage = dbResult?.usage as Record<string, unknown> | undefined;
    const dbCost = Number(dbUsage?.total_cost_usd || 0);

    let status: 'Done' | 'Running' | 'Stalled' | 'Failed';
    let cost = 0;
    let durationMs = 0;
    let turns = 0;

    if (dbCost > 0) {
      status = 'Done';
      cost = dbCost;
      durationMs = Number(dbUsage?.duration_ms || 0);
      turns = Number(dbUsage?.num_turns || 0);
    } else {
      const s3Result = await getS3Result(s3, outputsBucket, userId, runId);
      if (s3Result) {
        status = 'Done';
        cost = s3Result.cost;
        durationMs = s3Result.durationMs;
        turns = s3Result.turns;
      } else {
        const hasFiles = await hasS3Files(s3, outputsBucket, userId, runId);
        if (!hasFiles) {
          const elapsed = now - new Date(created).getTime();
          if (elapsed > THREE_HOURS_MS) {
            status = 'Failed';
          } else {
            status = 'Running';
          }
        } else {
          const elapsed = now - new Date(created).getTime();
          if (elapsed > THREE_HOURS_MS) {
            status = 'Stalled';
          } else {
            status = 'Running';
          }
        }
      }
    }

    // For running jobs, calculate elapsed time
    if (status === 'Running' || status === 'Stalled') {
      durationMs = now - new Date(created).getTime();
    }

    // Estimate end time for completed runs
    let endTimeIso = '';
    if (status === 'Done' && durationMs > 0) {
      endTimeIso = new Date(new Date(created).getTime() + durationMs).toISOString();
    }

    runs.push({
      nzStartTime: toNzTime(created),
      nzEndTime: status === 'Done' ? toNzTime(endTimeIso) : '',
      status,
      assessmentType: (metadata['assessment_type'] as string) || '',
      language: (metadata['output_language'] as string) || '',
      document: (files[0] as string) || '',
      runtimeMin: durationMs > 0 ? (durationMs / 60000).toFixed(1) : '',
      costUsd: cost > 0 ? cost.toFixed(2) : '',
      turns: turns > 0 ? String(turns) : '',
      userEmail: emailMap[userId] || userId,
      userId,
      globalKb: (metadata['global_kb'] as string) || '',
      procurementKb: (metadata['procurement_kb'] as string) || '',
      projectKb: (metadata['project_kb'] as string) || '',
      runId,
      createdUtc: created,
    });
  }

  console.log('');

  // Sort by start time descending
  runs.sort((a, b) => b.createdUtc.localeCompare(a.createdUtc));

  // Write CSV
  const outputDir = join(import.meta.dirname, 'test-reports');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'nolia-assessments.csv');

  const columns = [
    'nzStartTime',
    'nzEndTime',
    'status',
    'assessmentType',
    'language',
    'document',
    'runtimeMin',
    'costUsd',
    'turns',
    'userEmail',
    'globalKb',
    'procurementKb',
    'projectKb',
    'runId',
  ];
  const headers = [
    'Start (NZ)',
    'End (NZ)',
    'Status',
    'Assessment Type',
    'Language',
    'Document',
    'Runtime (min)',
    'Cost (USD)',
    'Turns',
    'User',
    'Global KB',
    'Procurement KB',
    'Project KB',
    'Run ID',
  ];

  stringify(
    runs.map((r) => columns.map((c) => r[c as keyof AssessmentRun])),
    { header: true, columns: headers },
    (err, output) => {
      if (err) throw err;
      writeFileSync(outputPath, output);
    }
  );

  // Print summary table
  console.log(chalk.blue.bold('\n--- Nolia Assessment Runs ---\n'));

  const done = runs.filter((r) => r.status === 'Done');
  const running = runs.filter((r) => r.status === 'Running');
  const stalled = runs.filter((r) => r.status === 'Stalled');
  const failed = runs.filter((r) => r.status === 'Failed');
  const costs = done.filter((r) => Number(r.costUsd) > 0).map((r) => Number(r.costUsd));

  console.log(chalk.green(`  Done:     ${done.length}`));
  if (running.length > 0) console.log(chalk.yellow(`  Running:  ${running.length}`));
  if (stalled.length > 0) console.log(chalk.red(`  Stalled:  ${stalled.length}`));
  if (failed.length > 0) console.log(chalk.gray(`  Failed:   ${failed.length}`));
  console.log(`  Total:    ${runs.length}`);

  if (costs.length > 0) {
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    const total = costs.reduce((a, b) => a + b, 0);
    console.log(chalk.blue(`\n  Avg cost: $${avg.toFixed(2)} | Total: $${total.toFixed(2)}`));
  }

  // Print recent runs
  console.log(chalk.blue.bold('\nRecent runs:\n'));
  const recent = runs.slice(0, 15);
  for (const r of recent) {
    const statusColor =
      r.status === 'Done'
        ? chalk.green
        : r.status === 'Running'
          ? chalk.yellow
          : r.status === 'Stalled'
            ? chalk.red
            : chalk.gray;
    const costStr = r.costUsd ? `$${r.costUsd}` : '-';
    const durStr = r.runtimeMin ? `${r.runtimeMin}min` : '-';
    const doc = r.document.length > 50 ? r.document.slice(0, 47) + '...' : r.document || '-';
    console.log(
      `  ${r.nzStartTime}  ${statusColor(r.status.padEnd(8))}  ${durStr.padStart(8)}  ${costStr.padStart(8)}  ${r.userEmail.padEnd(30)}  ${doc}`
    );
  }

  console.log(chalk.green(`\nWritten to ${outputPath}`));
}

main().catch((err) => {
  console.error(chalk.red('Error:'), err);
  exit(1);
});
