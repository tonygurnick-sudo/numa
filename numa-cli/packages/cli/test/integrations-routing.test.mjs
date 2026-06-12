/**
 * Dual-method slug routing: a slug enabled via BOTH pipedream and native must
 * never be picked silently — the CLI fails and asks for `--via`. Runs the
 * BUILT binary (dist/) as a subprocess with a synthetic workspace env, so the
 * routing decision is exercised exactly as the agent hits it. The commands
 * fail later at the auth/network stage either way — what we assert is which
 * error fired (routing vs. downstream).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), '../dist/cli/numa.js');

const run = async (args, env) => {
  try {
    const { stdout, stderr } = await exec('node', [BIN, ...args], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

const dualEnv = {
  NUMA_ACCOUNT: 'test-account',
  NUMA_CONVERSATION_ID: 'conv-test',
  NUMA_ENABLED_INTEGRATIONS: '["google_drive"]',
  NUMA_ENABLED_NATIVE_CONNECTORS: '["google_drive"]',
};

test('dual-method slug fails loudly without --via', async () => {
  const r = await run(['integrations', 'docs', 'google_drive', '-m', 'test'], dualEnv);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /multiple connection methods/);
  assert.match(r.stderr, /--via pipedream\|native/);
});

test('request also refuses a dual-method slug without --via', async () => {
  const r = await run(
    ['integrations', 'request', 'google_drive', 'GET', 'https://api.example.com/x', '-m', 'test'],
    dualEnv
  );
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /multiple connection methods/);
});

test('--via disambiguates past the routing check', async () => {
  const r = await run(['integrations', 'docs', 'google_drive', '--via', 'pipedream', '-m', 'test'], dualEnv);
  // Proceeds past routing and dies later at token/docs resolution — the
  // point is the ambiguity error must NOT fire.
  assert.doesNotMatch(r.stderr, /multiple connection methods/);
});

test('--via rejects junk values', async () => {
  const r = await run(['integrations', 'docs', 'google_drive', '--via', 'carrier-pigeon', '-m', 'test'], dualEnv);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /invalid --via/);
});

test('single-method slug routes without --via (no regression)', async () => {
  const r = await run(['integrations', 'docs', 'google_drive', '-m', 'test'], {
    ...dualEnv,
    NUMA_ENABLED_NATIVE_CONNECTORS: '[]',
  });
  assert.doesNotMatch(r.stderr, /multiple connection methods/);
});

test('pipedream-* commands find the pipedream entry even when shadowed by a native row', async () => {
  // Native listed FIRST in the combined scope — the old first-match logic
  // would have mis-errored with "uses the native integration method".
  const r = await run(['integrations', 'pipedream-actions', 'google_drive', '-m', 'test'], dualEnv);
  assert.doesNotMatch(r.stderr, /uses the native integration method/);
});

test('unknown slug still reports not-enabled', async () => {
  const r = await run(['integrations', 'docs', 'nonexistent_app', '-m', 'test'], dualEnv);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /not in your enabled integrations/);
});

test('same-method duplicates (multi-account) do NOT trip the ambiguity valve', async () => {
  // Two connected accounts of one app can put the slug into
  // NUMA_ENABLED_INTEGRATIONS twice — identical for routing, so the context
  // dedupes and no --via should be demanded.
  const r = await run(['integrations', 'docs', 'google_drive', '-m', 'test'], {
    ...dualEnv,
    NUMA_ENABLED_INTEGRATIONS: '["google_drive","google_drive"]',
    NUMA_ENABLED_NATIVE_CONNECTORS: '[]',
  });
  assert.doesNotMatch(r.stderr, /multiple connection methods/);
});

test('list shows a multi-account slug exactly once', async () => {
  const r = await run(['integrations', 'list', '--json', '-m', 'test'], {
    ...dualEnv,
    NUMA_ENABLED_INTEGRATIONS: '["google_drive","google_drive","gmail"]',
    NUMA_ENABLED_NATIVE_CONNECTORS: '[]',
  });
  const occurrences = (r.stdout.match(/google_drive/g) ?? []).length;
  assert.equal(occurrences, 1, `expected 1 google_drive row, got ${occurrences}\n${r.stdout}`);
});
