/**
 * Migrate numa-portal-image-metadata rows to the new repository-prefixed key
 * format used by the Customer Success Portal once the dev image channel exists.
 *
 * Old shape: PK = `${imageTag}` (just the SHA / tag)
 * New shape: PK = `${repository}#${imageTag}`, plus a `repository` attribute.
 *
 * Pre-existing rows belong to the prod (`numa-deploy`) repo — that's the only
 * channel that existed before this migration.
 *
 * Migration writes the new rows but does NOT delete the old ones. Run the
 * companion cleanup-portal-image-metadata-old-rows.ts script after verifying.
 *
 * Usage:
 *   # Dry run (writes nothing, prints the plan):
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn workspace @arcanumai/q-apps-deployer-tools \
 *     exec tsx migrate-portal-image-metadata.ts --backup tools/backups/<file>.json --dry-run
 *
 *   # Real run:
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn workspace @arcanumai/q-apps-deployer-tools \
 *     exec tsx migrate-portal-image-metadata.ts --backup tools/backups/<file>.json
 *
 *   # Force overwrite of existing new-shape rows:
 *   ... migrate-portal-image-metadata.ts --backup ... --force
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TABLE = 'numa-portal-image-metadata';
const REGION = 'us-east-1';
const PROD_REPO = 'numa-deploy';

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

interface Backup {
  table: string;
  region: string;
  takenAt: string;
  rows: Row[];
}

function parseArgs(): { backupPath: string; dryRun: boolean; force: boolean } {
  const args = process.argv.slice(2);
  let backupPath: string | undefined;
  let dryRun = false;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--backup') {
      backupPath = args[++i];
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--force') {
      force = true;
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!backupPath) {
    console.error('Missing --backup <path-to-backup.json>');
    process.exit(2);
  }
  return { backupPath: resolve(backupPath), dryRun, force };
}

async function main(): Promise<void> {
  const { backupPath, dryRun, force } = parseArgs();

  const backup = JSON.parse(readFileSync(backupPath, 'utf-8')) as Backup;
  if (backup.table !== TABLE) {
    console.error(`Backup is for table "${backup.table}" but expected "${TABLE}".`);
    process.exit(2);
  }

  console.log(`Loaded backup ${backupPath}`);
  console.log(`  Table: ${backup.table}, taken at ${backup.takenAt}, ${backup.rows.length} rows`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'WRITE'}${force ? ' (force)' : ''}\n`);

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

  let alreadyMigrated = 0;
  let written = 0;
  let skipped = 0;
  let collided = 0;

  for (const row of backup.rows) {
    if (row.imageTag.includes('#')) {
      // Already in the new format
      alreadyMigrated += 1;
      continue;
    }
    const newImageTag = `${PROD_REPO}#${row.imageTag}`;
    const newRow: Row = {
      ...row,
      imageTag: newImageTag,
      repository: PROD_REPO,
    };

    if (!force) {
      const existing = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { imageTag: newImageTag, digest: row.digest } })
      );
      if (existing.Item) {
        console.log(`  - SKIP (already exists): ${newImageTag} / ${row.digest}`);
        collided += 1;
        skipped += 1;
        continue;
      }
    }

    if (dryRun) {
      console.log(`  - DRY: would write ${newImageTag} / ${row.digest} (customName=${row.customName ?? '<none>'})`);
    } else {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: newRow }));
      console.log(`  - WROTE ${newImageTag} / ${row.digest} (customName=${row.customName ?? '<none>'})`);
    }
    written += 1;
  }

  console.log(
    `\nDone. ${written} ${dryRun ? 'would-be-written' : 'written'}, ${skipped} skipped (${collided} collided), ${alreadyMigrated} already in new format.`
  );
  if (!dryRun) {
    console.log(`\nNext: verify the portal Containers page still shows custom names, then run`);
    console.log(`  cleanup-portal-image-metadata-old-rows.ts to remove the legacy un-prefixed rows.`);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
