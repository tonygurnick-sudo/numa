#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPRM } from '../lib/prm-node/prm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function which(cmd: string): string | null {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim();
  return null;
}

function ensureDocker(): void {
  if (!which('docker')) {
    console.error('Docker is required to build the deployment container.');
    process.exit(1);
  }
}

function getGitHash(): string {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function getGitBranch(): string {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

async function generatePresignedUrl(): Promise<string> {
  const bucket = process.env.CLAUDE_ARTIFACT_S3_BUCKET || 'numa-claude-cli-artifacts';
  const prefix = process.env.CLAUDE_ARTIFACT_S3_PREFIX || 'claude-artifacts';
  const version = process.env.CLAUDE_CLI_VERSION || '2.0.37';
  const region = process.env.CLAUDE_ARTIFACT_S3_REGION || 'us-east-1';
  const key = `${prefix}/${version}/claude-x86_64.zip`;

  try {
    console.log(`Generating presigned URL for s3://${bucket}/${key}...`);
    const s3 = withPRM(S3Client, { region, credentials: fromNodeProviderChain() });

    // Test if the object exists first (HEAD, not GET)
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

    // Generate presigned URL using AWS CLI (explicit region to match bucket)
    const result = spawnSync(
      'aws',
      ['s3', 'presign', `s3://${bucket}/${key}`, '--region', region, '--expires-in', '7200'],
      {
        encoding: 'utf8',
      },
    );

    if (result.status === 0) {
      const url = result.stdout.trim();
      console.log('Successfully generated presigned URL');
      return url;
    } else {
      console.warn('Failed to generate presigned URL:', result.stderr);
      return '';
    }
  } catch (err) {
    console.warn(
      'Could not access S3 artifact (will build from installer):',
      err instanceof Error ? err.message : String(err),
    );
    return '';
  }
}

function buildContainer(presignedUrl: string): void {
  const gitHash = getGitHash();
  const gitBranch = getGitBranch();
  const claudeVersion = process.env.CLAUDE_CLI_VERSION || '2.0.37';
  const ciProjectPath = process.env.CI_PROJECT_PATH || 'local';

  console.log('\n=== Building deployment container ===');
  console.log(`Git hash: ${gitHash}`);
  console.log(`Git branch: ${gitBranch}`);
  console.log(`Claude CLI version: ${claudeVersion}`);
  console.log(`Presigned URL: ${presignedUrl ? '[set]' : '[none - will build from installer]'}`);
  console.log();

  const args = [
    'build',
    '--build-arg',
    `GIT_HASH=${gitHash}`,
    '--build-arg',
    `GIT_BRANCH=${gitBranch}`,
    '--build-arg',
    `CI_PROJECT_PATH=${ciProjectPath}`,
    '--build-arg',
    `CLAUDE_CLI_VERSION=${claudeVersion}`,
    '--build-arg',
    `CLAUDE_ARTIFACT_URL=${presignedUrl}`,
    '-f',
    'infra/container/Dockerfile',
    '.',
    '-t',
    `numa-deploy:local`,
    '-t',
    `numa-deploy:${gitHash}`,
  ];

  console.log('Running: docker', args.join(' '));
  console.log();

  const result = spawnSync('docker', args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error('\nDocker build failed');
    process.exit(result.status ?? 1);
  }

  console.log('\n=== Build successful ===');
  console.log(`Tagged as: numa-deploy:local`);
  console.log(`Tagged as: numa-deploy:${gitHash}`);
  console.log('\nTo run the container:');
  console.log('  docker run --rm -it numa-deploy:local');
}

async function main(): Promise<void> {
  console.log('Building deployment container locally...\n');

  ensureDocker();

  const presignedUrl = await generatePresignedUrl();

  buildContainer(presignedUrl);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
