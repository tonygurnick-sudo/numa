/**
 * Gate-response normalisation: server-side gate outcomes must surface on the
 * error channel every command already checks (`status === 'error'` →
 * fail(res.error)). The HITL `denied`/`timeout` statuses carry the user's
 * reason in `message` and no `result` — un-normalised they print as a bare
 * `result: null` and the deny reason never reaches the model (BUG found in
 * nd-labs T12: user denied with a reason, Numa saw `null`).
 */
import { test } from 'node:test';
import assert from 'node:assert';

import { normalizeGateResponse } from '../dist/api/tools.js';

test('denied response moves message onto the error channel', () => {
  const resp = {
    status: 'denied',
    message: 'The user denied this action. The user said: "not now"',
    deny_reason: 'not now',
    approval_id: 'req-1',
  };
  normalizeGateResponse(resp);
  assert.equal(resp.status, 'error');
  assert.equal(resp.error, 'The user denied this action. The user said: "not now"');
});

test('denied response without a message gets a sane fallback', () => {
  const resp = { status: 'denied' };
  normalizeGateResponse(resp);
  assert.equal(resp.status, 'error');
  assert.equal(resp.error, 'The user denied this action.');
});

test('timeout response surfaces as an error with its message', () => {
  const resp = { status: 'timeout', message: 'Approval timed out', approval_id: 'req-2' };
  normalizeGateResponse(resp);
  assert.equal(resp.status, 'error');
  assert.equal(resp.error, 'Approval timed out');
});

test('gate error with message-only reason is copied to error', () => {
  const resp = { status: 'error', message: 'numa ops is not enabled for this client' };
  normalizeGateResponse(resp);
  assert.equal(resp.error, 'numa ops is not enabled for this client');
});

test('successful responses pass through untouched', () => {
  const resp = { status: 'success', result: { items: [1, 2] } };
  normalizeGateResponse(resp);
  assert.equal(resp.status, 'success');
  assert.equal(resp.error, undefined);
  assert.deepEqual(resp.result, { items: [1, 2] });
});

test('explicit error field is never overwritten', () => {
  const resp = { status: 'denied', error: 'already-set', message: 'other' };
  normalizeGateResponse(resp);
  assert.equal(resp.status, 'error');
  assert.equal(resp.error, 'already-set');
});
