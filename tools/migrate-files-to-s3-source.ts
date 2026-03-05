#!/usr/bin/env -S node --import tsx
/**
 * Migrate Files system to S3-as-source-of-truth model.
 *
 * Scans all DynamoDB entries in the files table and:
 * - For each FILE# entry: reads existing metadata.json from S3, enriches with
 *   missing fields (version, scope_key, parent_path, etc.), writes back
 * - For each FOLDER# entry: creates a _folder.json marker in S3
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx tools/migrate-files-to-s3-source.ts --client arcanum-demo-tony
 *   npx tsx tools/migrate-files-to-s3-source.ts --client arcanum-demo-tony --dry-run
 */
import { Command } from 'commander';
import { getClientConfig } from '@arcanumai/client-config';
import type { ClientConfig } from '../infra/stacks/numa-client-stack';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { temporaryCredentials } from './utils';
import type { AWSClientConfig } from './utils';
import { withPRM } from '../lib/prm-node/prm';

const program = new Command();
program
  .description('Migrate files table to S3-as-source-of-truth model')
  .requiredOption('-c, --client <name>', 'Client name')
  .option('--dry-run', 'Preview only — no writes', false);

program.parse();
const opts = program.opts<{ client: string; dryRun: boolean }>();

async function main(): Promise<void> {
  const clientName = opts.client;
  const dryRun = opts.dryRun;

  console.log(`Migrating files for client: ${clientName}${dryRun ? ' (DRY RUN)' : ''}`);

  const cfg = await getClientConfig<ClientConfig>(clientName);
  const credentials = temporaryCredentials(cfg.clientAccountId);
  const aws: AWSClientConfig = { region: cfg.region, credentials };

  const s3 = withPRM(S3Client, aws);
  const ddbClient = withPRM(DynamoDBClient, aws);
  const dynamo = DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  const tableName = `numa-${clientName}-files`;
  const bucketName = `numa-${clientName}-data`;

  console.log(`Table: ${tableName}`);
  console.log(`Bucket: ${bucketName}`);

  // Scope → S3 prefix mapping
  const scopeToPrefix = (scopeKey: string): string | null => {
    if (scopeKey.startsWith('USER#')) {
      const userId = scopeKey.replace('USER#', '');
      return `files/user/${userId}`;
    }
    if (scopeKey === 'COMPANY') return 'files/company';
    if (scopeKey === 'PROJECTS') return 'files/projects';
    if (scopeKey.startsWith('PROJECT#')) {
      const projectId = scopeKey.replace('PROJECT#', '');
      return `files/projects/${projectId}`;
    }
    return null;
  };

  // Stats
  let filesEnriched = 0;
  let filesSkipped = 0;
  let foldersCreated = 0;
  let foldersSkipped = 0;
  let errors = 0;

  // Scan entire table
  let lastKey: Record<string, unknown> | undefined;
  let totalScanned = 0;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items || []) {
      totalScanned++;
      const scopeKey = item.scope_key as string;
      const sk = item.sk as string;
      const s3Prefix = scopeToPrefix(scopeKey);

      if (!s3Prefix) continue;

      try {
        if (sk.startsWith('FILE#')) {
          // Enrich metadata.json
          const fileId = item.file_id as string;
          if (!fileId) {
            filesSkipped++;
            continue;
          }

          const metadataKey = `${s3Prefix}/${fileId}/metadata.json`;

          // Read existing metadata.json
          let existingMeta: Record<string, unknown> = {};
          try {
            const obj = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: metadataKey }));
            existingMeta = JSON.parse(await obj.Body!.transformToString());
          } catch {
            // No existing metadata.json — create from DynamoDB fields
          }

          // Skip if already enriched
          if (existingMeta.version === 2 && existingMeta.scope_key && existingMeta.parent_path) {
            filesSkipped++;
            if (totalScanned % 100 === 0) process.stdout.write('.');
            continue;
          }

          const enriched = {
            ...existingMeta,
            version: 2,
            file_id: fileId,
            scope_key: scopeKey,
            parent_path: item.parent_path || '/',
            name: item.name,
            original_name: existingMeta.original_name || item.name,
            content_type: item.content_type,
            size_bytes: item.size_bytes,
            source_type: item.source_type,
            item_type: 'file',
            created_at: item.created_at,
            updated_at: item.updated_at || item.created_at,
            created_by: item.created_by,
            extraction_status: item.extraction_status || 'not_applicable',
            extracted_words: item.extracted_words ?? null,
            extracted_pages: item.extracted_pages ?? null,
          };

          if (!dryRun) {
            await s3.send(
              new PutObjectCommand({
                Bucket: bucketName,
                Key: metadataKey,
                Body: JSON.stringify(enriched, null, 2),
                ContentType: 'application/json',
              })
            );
          }
          filesEnriched++;
        } else if (sk.startsWith('FOLDER#')) {
          // Create _folder.json marker
          const folderPath = sk.replace('FOLDER#', '');
          const folderName = (item.name as string) || folderPath.replace(/\/$/, '').split('/').pop() || 'root';

          // Derive parent path
          const normalized = folderPath.endsWith('/') ? folderPath : folderPath + '/';
          const withoutTrailing = normalized.replace(/\/$/, '');
          const parts = withoutTrailing.split('/').filter(Boolean);
          const parentPath = parts.length <= 1 ? '/' : '/' + parts.slice(0, -1).join('/') + '/';

          const markerSegment = normalized === '/' ? '/' : normalized.replace(/\/$/, '');
          const markerKey = `${s3Prefix}/_folders${markerSegment}/_folder.json`;

          const marker = {
            version: 2,
            name: folderName,
            path: normalized,
            parent_path: parentPath,
            scope_key: scopeKey,
            created_at: item.created_at || new Date().toISOString(),
            updated_at: item.updated_at || item.created_at || new Date().toISOString(),
            created_by: item.created_by || 'system',
            item_type: 'folder',
          };

          if (!dryRun) {
            await s3.send(
              new PutObjectCommand({
                Bucket: bucketName,
                Key: markerKey,
                Body: JSON.stringify(marker, null, 2),
                ContentType: 'application/json',
              })
            );
          }
          foldersCreated++;
        }
      } catch (err) {
        errors++;
        console.error(`\nError processing ${scopeKey}/${sk}:`, err);
      }

      if (totalScanned % 100 === 0) process.stdout.write('.');
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log('\n');
  console.log('=== Migration Summary ===');
  console.log(`Total scanned:    ${totalScanned}`);
  console.log(`Files enriched:   ${filesEnriched}`);
  console.log(`Files skipped:    ${filesSkipped} (already v2)`);
  console.log(`Folders created:  ${foldersCreated}`);
  console.log(`Folders skipped:  ${foldersSkipped}`);
  console.log(`Errors:           ${errors}`);
  if (dryRun) console.log('\n(DRY RUN — no changes written)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
