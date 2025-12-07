#!/usr/bin/env -S node --import tsx
/**
 * Backfill .metadata.json sidecar files under documents/company/ for a client
 * - Supports --client <name>
 * - Supports --dry-run
 *
 * Sidecar format:
 * {
 *   "metadataAttributes": {
 *     "tenant_id": <client>,
 *     "kb_id": 'company' | <uuid-if-path-contains-kb-uuid>,
 *     "uploader_id": <derived or 'system'>,
 *     "uploaded_at": <ISO timestamp>
 *   }
 * }
 */
import { Command } from 'commander';
import { getClientConfig, listClients } from '@arcanumai/client-config';
import type { ClientConfig } from '../infra/stacks/numa-client-stack';
import { S3Client, ListObjectsV2Command, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { temporaryCredentials } from './utils';
import type { AWSClientConfig } from './utils';
import { withPRM } from '../lib/prm-node/prm';

const program = new Command();
program
  .description('Backfill .metadata.json sidecars under documents/company/')
  .option('-c, --client <name>')
  .option('--dry-run', 'Preview only', false);

async function getAws(clientName: string): Promise<{ cfg: ClientConfig; s3: S3Client; bucket: string }> {
  const cfg = await getClientConfig<ClientConfig>(clientName);
  const credentials = temporaryCredentials(cfg.clientAccountId);
  const aws: AWSClientConfig = { region: cfg.region, credentials };
  const s3 = withPRM(S3Client, aws);
  const bucket = `numa-${clientName}-data`;
  return { cfg, s3, bucket };
}

function deriveKbIdFromKey(key: string): string {
  // Expect keys under documents/company/...; if next segment starts with kb-<uuid>, prefer that as kb_id
  const parts = key.split('/');
  // parts[0]='documents', parts[1]='company', parts[2]=maybe 'kb-<uuid>' or uploaderId
  if (parts.length > 2 && parts[2]?.startsWith('kb-')) {
    const raw = parts[2];
    return raw.replace(/^kb-/, '').trim() || 'company';
  }
  return 'company';
}

function deriveUploaderIdFromKey(key: string): string {
  const parts = key.split('/');
  // documents/company/<maybe uploader or kb-uuid>/...
  if (parts.length > 2 && parts[2] && !parts[2].startsWith('kb-')) return parts[2];
  return 'system';
}

async function backfillForClient(clientName: string, dryRun: boolean): Promise<void> {
  const { s3, bucket } = await getAws(clientName);
  const prefix = 'documents/company/';
  let token: string | undefined;
  let processed = 0;
  let created = 0;
  let skipped = 0;

  console.log(`[${clientName}] Scanning s3://${bucket}/${prefix} for missing sidecars${dryRun ? ' (dry-run)' : ''}`);

  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const obj of page.Contents || []) {
      const key = obj.Key;
      if (!key) continue;
      // Skip folders, existing metadata sidecars
      if (key.endsWith('/') || key.endsWith('.metadata.json')) continue;
      processed++;

      const metaKey = `${key}.metadata.json`;
      // Check if sidecar exists
      let exists = false;
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: metaKey }));
        exists = true;
      } catch {
        exists = false;
      }
      if (exists) {
        skipped++;
        continue;
      }

      // Build sidecar
      const uploadedAt = (obj.LastModified || new Date()).toISOString();
      const kb_id = deriveKbIdFromKey(key);
      const uploader_id = deriveUploaderIdFromKey(key);
      const payload = {
        metadataAttributes: {
          tenant_id: clientName,
          kb_id,
          uploader_id,
          uploaded_at: uploadedAt,
        },
      };

      console.log(`[${clientName}] + ${metaKey} -> ${JSON.stringify(payload.metadataAttributes)}`);
      if (dryRun) continue;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: metaKey,
          Body: JSON.stringify(payload),
          ContentType: 'application/json',
        }),
      );
      created++;
    }
    token = page.NextContinuationToken;
  } while (token);

  console.log(`[${clientName}] Done. processed=${processed}, created=${created}, skipped=${skipped}`);
}

async function main(): Promise<void> {
  program.parse(process.argv);
  const opts = program.opts<{ client?: string; dryRun?: boolean }>();
  const clients = opts.client ? [opts.client] : await listClients();
  for (const c of clients) {
    try {
      await backfillForClient(c, !!opts.dryRun);
    } catch (e) {
      console.error(`[${c}] Error:`, (e as Error).message);
    }
  }
}

if (import.meta.filename === process.argv[1])
  main().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
