/**
 * Unit tests for the deferred-finalize timeout gate.
 *
 * `isSyncInvocationTimeout` decides whether a failed sync invocation gets
 * handed to the deferred finalizer (the MicroVM kept running) or recorded as
 * an immediate failure (a real error). Getting this wrong in either direction
 * is bad: a false negative reverts to the old false-failure bug; a false
 * positive would defer genuine HTTP/network errors that will never produce a
 * status.json, delaying the failure report by the full wall-clock cap.
 *
 * The positive-case error shape is verified empirically against the bundled
 * undici (see commit message) — a real AbortSignal.timeout() rejection is a
 * DOMException { name: 'TimeoutError', message: 'The operation was aborted
 * due to timeout' }.
 */

import { describe, it, expect } from 'vitest';
import { isSyncInvocationTimeout } from './index';

describe('isSyncInvocationTimeout', () => {
  it('matches a real undici AbortSignal.timeout rejection by name', () => {
    // Exactly what `new Agent()` + `AbortSignal.timeout()` throws.
    const err = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect(isSyncInvocationTimeout(err)).toBe(true);
  });

  it('matches by message even if the name differs (defensive fallback)', () => {
    const err = new Error('The operation was aborted due to timeout');
    // Default Error name is 'Error', so this exercises the message branch.
    expect(isSyncInvocationTimeout(err)).toBe(true);
  });

  it("matches the exact string recorded on the customer's failed runs", () => {
    // This is the literal `last_error` value seen in DynamoDB for the
    // eliotsinclair "Project Email Filer" timed-out runs.
    const err = new Error('The operation was aborted due to timeout');
    expect(isSyncInvocationTimeout(err)).toBe(true);
  });

  it('does NOT match a non-OK HTTP response error (real failure → immediate fail path)', () => {
    const err = new Error('Workspace agent invocation failed (500): internal error');
    expect(isSyncInvocationTimeout(err)).toBe(false);
  });

  it('does NOT match an agent-returned error payload', () => {
    const err = new Error('Workspace agent returned error status');
    expect(isSyncInvocationTimeout(err)).toBe(false);
  });

  it('does NOT match a generic connection error', () => {
    const err = Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    expect(isSyncInvocationTimeout(err)).toBe(false);
  });

  it('handles null / undefined / non-error values without throwing', () => {
    expect(isSyncInvocationTimeout(null)).toBe(false);
    expect(isSyncInvocationTimeout(undefined)).toBe(false);
    expect(isSyncInvocationTimeout('a string')).toBe(false);
    expect(isSyncInvocationTimeout({})).toBe(false);
  });
});
