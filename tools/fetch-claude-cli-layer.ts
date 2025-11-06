#!/usr/bin/env -S node --import tsx
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, Readable } from 'node:stream';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';

const streamPipeline = promisify(pipeline);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DEST_DIR = path.join(ROOT_DIR, 'infra', 'assets', 'layers', 'claude-cli');
const DEST_ZIP = path.join(DEST_DIR, 'claude-x86_64.zip');

function parseArgs(): Record<string, string | boolean> {
  const args = process.argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

function usage(): void {
  console.log(
    [
      'Fetch the prebuilt Claude CLI Lambda layer ZIP from S3 into infra/assets/layers/claude-cli.',
      '',
      'Usage:',
      '  yarn workspace @arcanumai/q-apps-deployer-tools fetch-claude-cli-layer [--bucket <name>] [--prefix <key-prefix>] [--version <ver>] [--region <aws-region>] [--force]',
      '',
      'Defaults:',
      '  --bucket  $CLAUDE_LAYER_S3_BUCKET or numa-claude-cli-layers',
      '  --prefix  $CLAUDE_LAYER_S3_PREFIX or claude-layers',
      '  --version $CLAUDE_CLI_VERSION or 1.0.100',
      '  --region  $AWS_REGION (optional; uses SDK default if unset)',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const argv = parseArgs();
  if (argv.help) return usage();

  const bucket = (argv.bucket as string) || process.env.CLAUDE_LAYER_S3_BUCKET || 'numa-claude-cli-layers';
  const prefix = (argv.prefix as string) || process.env.CLAUDE_LAYER_S3_PREFIX || 'claude-layers';
  const version = (argv.version as string) || process.env.CLAUDE_CLI_VERSION || '1.0.100';
  const region = (argv.region as string) || process.env.AWS_REGION || undefined;
  const force = Boolean(argv.force);

  const key = `${prefix}/${version}/claude-x86_64.zip`;
  console.log(`Downloading s3://${bucket}/${key} → ${DEST_ZIP}`);

  if (fs.existsSync(DEST_ZIP) && !force) {
    console.log('File already exists; use --force to overwrite.');
    console.log('Done.');
    return;
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });

  const s3 = new S3Client({ region, credentials: fromNodeProviderChain() });
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!resp.Body) throw new Error('Empty S3 response body');
  const body = resp.Body as Readable;
  const tmpPath = DEST_ZIP + '.part';
  await streamPipeline(body, fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, DEST_ZIP);
  console.log('Downloaded. Verifying ZIP contents...');

  // Sanity check: ensure bin/claude exists
  const zip = new AdmZip(DEST_ZIP);
  const entry = zip.getEntry('bin/claude');
  if (!entry) {
    throw new Error('ZIP missing bin/claude. Is this the correct layer artifact?');
  }
  console.log('Verified bin/claude present. Success.');
}

main().catch((err) => {
  console.error('Failed to fetch Claude CLI layer:', err);
  process.exit(1);
});
