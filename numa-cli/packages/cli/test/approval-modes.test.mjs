/**
 * Workspace approval-mode resolution: the agent injects the user's resolved
 * HITL approval policy as NUMA_APPROVAL_MODES (per-category map + per-slug
 * integration overrides); the CLI gates its approval cards on it. These
 * tests import the built module directly (pure env/fs reads) and cover the
 * fail-safes: absent/malformed env → non_destructive, missing action schema
 * → prompt, GET/HEAD proxy requests → read-only safe.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readApprovalMode,
  readIntegrationApprovalMode,
  requiresLocalApproval,
  requiresLocalApprovalForIntegration,
} from '../dist/context/approval.js';

const ENV_KEYS = ['NUMA_AUTH_MODE', 'NUMA_APPROVAL_MODES', 'NUMA_INTEGRATION_SCHEMA_DIR'];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.NUMA_AUTH_MODE = 'workspace-iam';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const setModes = (categories, integrationOverrides = {}) => {
  process.env.NUMA_APPROVAL_MODES = JSON.stringify({
    categories,
    integration_overrides: integrationOverrides,
  });
};

// ── per-category modes from env ──────────────────────────────────────────

test('workspace mode reads category modes from NUMA_APPROVAL_MODES', () => {
  setModes({ memories: 'never', ops: 'always', knowledgeBases: 'non_destructive' });
  assert.equal(readApprovalMode('memories'), 'never');
  assert.equal(readApprovalMode('ops'), 'always');
  assert.equal(readApprovalMode('knowledgeBases'), 'non_destructive');
});

test('memories write op is auto-approved when user set never', () => {
  setModes({ memories: 'never' });
  assert.equal(requiresLocalApproval('memories', 'add'), false);
  assert.equal(requiresLocalApproval('memories', 'delete'), false);
});

test('non_destructive gates writes but not safe ops', () => {
  setModes({ knowledgeBases: 'non_destructive' });
  assert.equal(requiresLocalApproval('knowledgeBases', 'upload'), true);
  assert.equal(requiresLocalApproval('knowledgeBases', 'query'), false);
  assert.equal(requiresLocalApproval('knowledgeBases', 'download'), false);
});

test('absent env falls back to non_destructive in workspace mode', () => {
  assert.equal(readApprovalMode('memories'), 'non_destructive');
  assert.equal(requiresLocalApproval('memories', 'add'), true);
  assert.equal(requiresLocalApproval('memories', 'list'), false);
});

test('malformed env falls back to non_destructive', () => {
  process.env.NUMA_APPROVAL_MODES = 'not-json{';
  assert.equal(readApprovalMode('ops'), 'non_destructive');
});

test('invalid mode values are dropped, falling back per category', () => {
  setModes({ memories: 'yolo', ops: 'never' });
  assert.equal(readApprovalMode('memories'), 'non_destructive');
  assert.equal(readApprovalMode('ops'), 'never');
});

// ── integrations consult chain ───────────────────────────────────────────

test('per-slug override beats the integrations category mode', () => {
  setModes({ integrations: 'always' }, { gmail: 'never' });
  assert.equal(readIntegrationApprovalMode('gmail'), 'never');
  assert.equal(readIntegrationApprovalMode('slack'), 'always');
  assert.equal(
    requiresLocalApprovalForIntegration({ slug: 'gmail', actionKey: 'gmail-send-email' }),
    false
  );
  assert.equal(
    requiresLocalApprovalForIntegration({ slug: 'slack', actionKey: 'slack-send-message' }),
    true
  );
});

test('integrations default to non_destructive without env (writes gate)', () => {
  assert.equal(
    requiresLocalApprovalForIntegration({ slug: 'gmail', actionKey: 'gmail-send-email' }),
    true
  );
});

test('GET/HEAD proxy requests are safe under non_destructive; writes are not', () => {
  setModes({ integrations: 'non_destructive' });
  assert.equal(requiresLocalApprovalForIntegration({ slug: 'gmail', httpMethod: 'GET' }), false);
  assert.equal(requiresLocalApprovalForIntegration({ slug: 'gmail', httpMethod: 'HEAD' }), false);
  assert.equal(requiresLocalApprovalForIntegration({ slug: 'gmail', httpMethod: 'POST' }), true);
  assert.equal(requiresLocalApprovalForIntegration({ slug: 'gmail', httpMethod: 'DELETE' }), true);
});

// ── schema-annotation safety (non_destructive mode) ──────────────────────

test('schema annotations decide action safety under non_destructive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'numa-approval-test-'));
  try {
    process.env.NUMA_INTEGRATION_SCHEMA_DIR = dir;
    mkdirSync(join(dir, 'gmail'), { recursive: true });
    writeFileSync(
      join(dir, 'gmail', 'gmail-find-email.json'),
      JSON.stringify({ annotations: { readOnlyHint: true } })
    );
    writeFileSync(
      join(dir, 'gmail', 'gmail-create-draft.json'),
      JSON.stringify({ annotations: { readOnlyHint: false, destructiveHint: false } })
    );
    writeFileSync(
      join(dir, 'gmail', 'gmail-send-email.json'),
      JSON.stringify({ annotations: { readOnlyHint: false, destructiveHint: true } })
    );
    setModes({ integrations: 'non_destructive' });

    // read-only action → safe
    assert.equal(
      requiresLocalApprovalForIntegration({ slug: 'gmail', actionKey: 'gmail-find-email' }),
      false
    );
    // draft action explicitly non-destructive → safe
    assert.equal(
      requiresLocalApprovalForIntegration({ slug: 'gmail', actionKey: 'gmail-create-draft' }),
      false
    );
    // destructive write → prompt
    assert.equal(
      requiresLocalApprovalForIntegration({ slug: 'gmail', actionKey: 'gmail-send-email' }),
      true
    );
    // missing schema → fail closed → prompt
    assert.equal(
      requiresLocalApprovalForIntegration({ slug: 'gmail', actionKey: 'gmail-unknown-action' }),
      true
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('never/always short-circuit without consulting schemas', () => {
  // No schema dir set up at all — mode alone must decide.
  setModes({ integrations: 'never' });
  assert.equal(
    requiresLocalApprovalForIntegration({ slug: 'gmail', actionKey: 'gmail-send-email' }),
    false
  );
  setModes({ integrations: 'always' });
  assert.equal(requiresLocalApprovalForIntegration({ slug: 'gmail', httpMethod: 'GET' }), true);
});
