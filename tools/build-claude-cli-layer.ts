#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.CLAUDE_CLI_VERSION || '1.0.100';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const LAYER_DIR = path.join(ROOT_DIR, 'infra', 'assets', 'layers', 'claude-cli');
const BIN_DIR = path.join(LAYER_DIR, 'bin');
const ZIP_PATH = path.join(LAYER_DIR, 'claude-x86_64.zip');

function which(cmd: string): string | null {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim();
  return null;
}

function ensureDocker(): void {
  if (!which('docker')) {
    console.error('Docker is required to build the Claude CLI layer (amazonlinux:2023).');
    process.exit(1);
  }
}

function buildWithDocker(): void {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const image = 'public.ecr.aws/amazonlinux/amazonlinux:2023';
  const mountArgs = ['-v', `${ROOT_DIR}:/work`, '-w', '/work'];
  const shell = [
    'bash',
    '-lc',
    [
      'dnf -y install curl tar gzip zip which',
      `curl -fsSL https://claude.ai/install.sh | bash -s ${VERSION}`,
      'CLAUDE_BIN=$(command -v claude)',
      `cp "$CLAUDE_BIN" ${path.posix.join('/work', 'infra', 'assets', 'layers', 'claude-cli', 'bin', 'claude')}`,
      `chmod +x ${path.posix.join('/work', 'infra', 'assets', 'layers', 'claude-cli', 'bin', 'claude')}`,
      `(cd ${path.posix.join('/work', 'infra', 'assets', 'layers', 'claude-cli')} && zip -r claude-x86_64.zip bin)`,
      `ls -lh ${path.posix.join('/work', 'infra', 'assets', 'layers', 'claude-cli', 'claude-x86_64.zip')}`,
    ].join(' && '),
  ];
  const args = ['run', '--rm', ...mountArgs, image, ...shell];
  const env = { ...process.env, DOCKER_DEFAULT_PLATFORM: 'linux/amd64' };
  const res = spawnSync('docker', args, { stdio: 'inherit', env });
  if (res.status !== 0) {
    console.error('Docker build failed');
    process.exit(res.status ?? 1);
  }
}

function main(): void {
  console.log(`Building Claude CLI layer → ${ZIP_PATH}`);
  ensureDocker();
  buildWithDocker();
  if (!fs.existsSync(ZIP_PATH)) {
    console.error('Expected layer ZIP not found after build.');
    process.exit(1);
  }
  console.log('Success:', ZIP_PATH);
}

main();
