/**
 * Back up the numa-portal-image-metadata DynamoDB table to a local JSON file.
 *
 * The table holds curated names/descriptions for ECR images shown in the
 * Customer Success Portal. Run this BEFORE the migration script that reshapes
 * the partition key, so we can restore if anything goes wrong.
 *
 * Usage:
 *   AWS_PROFILE=arcanum-q-deployer-prod \
 *   yarn workspace @arcanumai/q-apps-deployer-tools \
 *   exec tsx backup-portal-image-metadata.ts
 *
 * Output: tools/backups/numa-portal-image-metadata-<ISO>.json
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE = 'numa-portal-image-metadata';
const REGION = 'us-east-1';

interface Row {
  imageTag: string;
  digest: string;
  repository?: string;
  customName?: string;
  description?: string;
  createdAt?: string;
  createdBy?: string;
  [key: string]: unknown;
}

async function scanAll(): Promise<Row[]> {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  const rows: Row[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let pages = 0;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        ExclusiveStartKey: exclusiveStartKey as Record<string, never> | undefined,
      })
    );
    if (res.Items) rows.push(...(res.Items as Row[]));
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    pages += 1;
  } while (exclusiveStartKey);
  console.log(`Scanned ${pages} page(s), ${rows.length} row(s) total.`);
  return rows;
}

async function main(): Promise<void> {
  const rows = await scanAll();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, 'backups', `${TABLE}-${timestamp}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify({ table: TABLE, region: REGION, takenAt: new Date().toISOString(), rows }, null, 2)
  );

  console.log(`\nBackup written: ${outPath}`);

  // Print a small sample so the operator can sanity-check before running the migration
  const withCustomName = rows.filter((r) => r.customName).length;
  const sample = rows.slice(0, 5).map((r) => ({
    imageTag: r.imageTag,
    digest: r.digest,
    customName: r.customName,
    description: r.description,
  }));
  console.log(`\nSummary: ${rows.length} rows, ${withCustomName} with customName.`);
  console.log('First 5 rows (sample):');
  console.dir(sample, { depth: null });
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
