#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Accept an explicit version, or default to pinned version
const VERSION = process.env.CLAUDE_CLI_VERSION || '2.0.37';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT_DIR, 'infra', 'assets', 'artifacts', 'claude-cli');
const BIN_DIR = path.join(ARTIFACT_DIR, 'bin');
const ZIP_PATH = path.join(ARTIFACT_DIR, 'claude-x86_64.zip');

function which(cmd: string): string | null {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim();
  return null;
}

function ensureDocker(): void {
  if (!which('docker')) {
    console.error('Docker is required to build the Claude CLI artifact (amazonlinux:2023).');
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
      'set -euo pipefail',
      'dnf -y install tar gzip zip which jq',
      'GCS_BUCKET="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases"',
      'ARCH=$(uname -m); ARCH_LABEL=$([ "$ARCH" = x86_64 ] && echo x64 || echo arm64)',
      'if ldd /bin/ls 2>&1 | grep -q musl; then PLATFORM="linux-${ARCH_LABEL}-musl"; else PLATFORM="linux-${ARCH_LABEL}"; fi',
      `if [ "${VERSION}" = "stable" ] || [ "${VERSION}" = "latest" ]; then VERSION=$(curl -fsSL "$GCS_BUCKET/stable"); else VERSION="${VERSION}"; fi`,
      'echo "Using Claude CLI version: $VERSION for $PLATFORM"',
      'MANIFEST=$(curl -fsSL "$GCS_BUCKET/$VERSION/manifest.json")',
      'CHECKSUM=$(echo "$MANIFEST" | jq -r --arg p "$PLATFORM" \'\.platforms[$p]\.checksum\')',
      'test -n "$CHECKSUM"',
      `mkdir -p ${path.posix.join('/work', 'infra', 'assets', 'artifacts', 'claude-cli', 'bin')}`,
      `curl -fsSL -o ${path.posix.join('/work', 'infra', 'assets', 'artifacts', 'claude-cli', 'bin', 'claude')} "$GCS_BUCKET/$VERSION/$PLATFORM/claude"`,
      `echo "$CHECKSUM  ${path.posix.join('/work', 'infra', 'assets', 'artifacts', 'claude-cli', 'bin', 'claude')}" | sha256sum -c -`,
      `chmod +x ${path.posix.join('/work', 'infra', 'assets', 'artifacts', 'claude-cli', 'bin', 'claude')}`,
      `(cd ${path.posix.join('/work', 'infra', 'assets', 'artifacts', 'claude-cli')} && zip -r claude-x86_64.zip bin)`,
      `ls -lh ${path.posix.join('/work', 'infra', 'assets', 'artifacts', 'claude-cli', 'claude-x86_64.zip')}`,
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
  console.log(`Building Claude CLI artifact → ${ZIP_PATH}`);
  ensureDocker();
  buildWithDocker();
  if (!fs.existsSync(ZIP_PATH)) {
    console.error('Expected artifact ZIP not found after build.');
    process.exit(1);
  }
  console.log('Success:', ZIP_PATH);
}

main();
