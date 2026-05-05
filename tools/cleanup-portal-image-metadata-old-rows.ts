/**
 * Delete legacy un-prefixed rows from numa-portal-image-metadata.
 *
 * Safe to run only AFTER:
 *   1. backup-portal-image-metadata.ts (in case you need to roll back)
 *   2. migrate-portal-image-metadata.ts (which writes new-shape rows)
 *   3. The portal has been redeployed and Containers page shows custom names
 *      (proves the migration's new-shape rows are being read correctly)
 *
 * Usage:
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn workspace @arcanumai/q-apps-deployer-tools \
 *     exec tsx cleanup-portal-image-metadata-old-rows.ts --dry-run
 *
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn workspace @arcanumai/q-apps-deployer-tools \
 *     exec tsx cleanup-portal-image-metadata-old-rows.ts
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'numa-portal-image-metadata';
const REGION = 'us-east-1';

interface Row {
  imageTag: string;
  digest: string;
  [key: string]: unknown;
}

async function scanAll(ddb: DynamoDBDocumentClient): Promise<Row[]> {
  const rows: Row[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        ExclusiveStartKey: exclusiveStartKey as Record<string, never> | undefined,
      })
    );
    if (res.Items) rows.push(...(res.Items as Row[]));
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return rows;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

  const all = await scanAll(ddb);
  const legacy = all.filter((r) => !r.imageTag.includes('#'));

  console.log(`Total rows: ${all.length}. Legacy un-prefixed rows: ${legacy.length}.`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'DELETE'}\n`);

  for (const row of legacy) {
    if (dryRun) {
      console.log(`  - DRY: would delete ${row.imageTag} / ${row.digest}`);
    } else {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { imageTag: row.imageTag, digest: row.digest } }));
      console.log(`  - DELETED ${row.imageTag} / ${row.digest}`);
    }
  }

  console.log(`\nDone. ${legacy.length} ${dryRun ? 'would be deleted' : 'deleted'}.`);
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
