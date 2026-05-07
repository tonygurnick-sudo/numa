/**
 * Unit tests for the Pipedream event receiver lambda.
 *
 * Focus: HMAC verification (the security boundary) and the DDB schedule
 * lookup helper. Integration tests of the full handler with mocked AWS
 * clients land in a follow-up commit alongside the API Gateway wiring.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { verifyPipedreamSignature, lookupScheduleByDeployedTriggerId } from './index';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const SIGNING_KEY = '9cdf159c6341e5e6eeee4fc59a2ba76180d9c86fe99814ddcf9dbcbd87d10605';

const buildSignature = (timestamp: number, body: string, key: string = SIGNING_KEY): string => {
  const v1 = createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
};

describe('verifyPipedreamSignature', () => {
  const NOW = 1_777_950_000; // arbitrary fixed "now" so timestamp checks are deterministic

  it('passes for a correctly-signed payload', () => {
    const body = '{"text":"hello"}';
    const sig = buildSignature(NOW, body);
    const result = verifyPipedreamSignature(sig, body, SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(true);
  });

  it('passes when timestamp is right at the edge of the freshness window', () => {
    const body = '{"text":"x"}';
    const ts = NOW - 5 * 60 + 1; // 4:59 ago — within 5min window
    const sig = buildSignature(ts, body);
    const result = verifyPipedreamSignature(sig, body, SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(true);
  });

  it('rejects a stale timestamp (replay)', () => {
    const body = '{}';
    const tsOld = NOW - 10 * 60; // 10 min ago
    const sig = buildSignature(tsOld, body);
    const result = verifyPipedreamSignature(sig, body, SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('stale_timestamp');
  });

  it('rejects a future-dated timestamp beyond skew tolerance', () => {
    const body = '{}';
    const tsFuture = NOW + 10 * 60;
    const sig = buildSignature(tsFuture, body);
    const result = verifyPipedreamSignature(sig, body, SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('stale_timestamp');
  });

  it('rejects when the signing key does not match', () => {
    const body = '{"text":"hello"}';
    const sig = buildSignature(NOW, body, 'wrong-key');
    const result = verifyPipedreamSignature(sig, body, SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });

  it('rejects when the body has been tampered with', () => {
    const body = '{"text":"hello"}';
    const sig = buildSignature(NOW, body);
    const tampered = '{"text":"hello, attacker"}';
    const result = verifyPipedreamSignature(sig, tampered, SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });

  it('rejects a malformed header (no v1)', () => {
    const result = verifyPipedreamSignature(`t=${NOW}`, 'body', SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed_header');
  });

  it('rejects a malformed header (non-numeric t)', () => {
    const result = verifyPipedreamSignature('t=abc,v1=def', 'body', SIGNING_KEY, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed_header');
  });

  it('rejects an empty/undefined header', () => {
    expect(verifyPipedreamSignature(undefined, 'body', SIGNING_KEY, { now: NOW }).ok).toBe(false);
    expect(verifyPipedreamSignature('', 'body', SIGNING_KEY, { now: NOW }).ok).toBe(false);
  });

  it('matches against the captured live delivery (regression fixture)', () => {
    // From dev-notes/tasks/pipedream-triggers/results/validate_delivery.json
    // Real Pipedream-signed delivery captured 2026-05-01.
    const body = JSON.stringify({
      type: 'message',
      user: 'U036X8Z6728',
      ts: '1777612621.417689',
      client_msg_id: '8cb3a6fe-ae93-477c-8032-7718712eadc8',
      text: 'pipedream-spike-validate-9f3a2',
      team: 'TCWFC16H5',
      blocks: [
        {
          type: 'rich_text',
          block_id: 'jxbwR',
          elements: [
            { type: 'rich_text_section', elements: [{ type: 'text', text: 'pipedream-spike-validate-9f3a2' }] },
          ],
        },
      ],
      channel: 'CD65MARED',
      event_ts: '1777612621.417689',
      channel_type: 'channel',
    });
    // The real signing key from validate_deploy_response.json. This pair is the
    // empirical proof that our verify implementation is correct.
    const liveKey = '9cdf159c6341e5e6eeee4fc59a2ba76180d9c86fe99814ddcf9dbcbd87d10605';
    const liveSig = 't=1777612623,v1=2507f89ee0cb702906e2263f47ec79d7dd354dffa0f7c1d68a01ba125899bd00';
    const result = verifyPipedreamSignature(liveSig, body, liveKey, {
      now: 1777612623,
      maxAgeSeconds: 5 * 60,
    });
    expect(result.ok).toBe(true);
  });
});

describe('lookupScheduleByDeployedTriggerId', () => {
  const buildMockClient = (items: Array<Record<string, unknown>>): DynamoDBDocumentClient => {
    return {
      send: async () => ({ Items: items }),
    } as unknown as DynamoDBDocumentClient;
  };

  it('returns the schedule when the GSI query yields a matching item', async () => {
    const client = buildMockClient([
      {
        user_id: 'auth0|abc',
        schedule_id: '550e8400-e29b-41d4-a716-446655440000',
        trigger: {
          source: 'pipedream',
          app_slug: 'slack',
          component_id: 'slack-new-keyword-mention',
          deployed_trigger_id: 'dc_xxx',
          webhook_signing_key: 'abc123',
        },
      },
    ]);
    const result = await lookupScheduleByDeployedTriggerId('dc_xxx', client, 'schedules', 'gsi');
    expect(result).not.toBeNull();
    expect(result?.user_id).toBe('auth0|abc');
    expect(result?.trigger_webhook_signing_key).toBe('abc123');
    expect(result?.trigger_app_slug).toBe('slack');
    expect(result?.trigger_component_id).toBe('slack-new-keyword-mention');
  });

  it('returns null when the GSI query yields nothing', async () => {
    const client = buildMockClient([]);
    const result = await lookupScheduleByDeployedTriggerId('dc_nope', client, 'schedules', 'gsi');
    expect(result).toBeNull();
  });

  it('returns null when the matched item is missing the signing key', async () => {
    const client = buildMockClient([
      {
        user_id: 'auth0|abc',
        schedule_id: '550e8400-e29b-41d4-a716-446655440000',
        trigger: {
          source: 'pipedream',
          app_slug: 'slack',
          component_id: 'slack-new-keyword-mention',
          deployed_trigger_id: 'dc_xxx',
          // webhook_signing_key absent — corrupt or pre-deploy state
        },
      },
    ]);
    const result = await lookupScheduleByDeployedTriggerId('dc_xxx', client, 'schedules', 'gsi');
    expect(result).toBeNull();
  });

  it('returns null when the matched item has no user_id', async () => {
    const client = buildMockClient([
      {
        // user_id missing
        schedule_id: '550e8400-e29b-41d4-a716-446655440000',
        trigger: { webhook_signing_key: 'k', app_slug: 'slack', component_id: 'x' },
      },
    ]);
    const result = await lookupScheduleByDeployedTriggerId('dc_xxx', client, 'schedules', 'gsi');
    expect(result).toBeNull();
  });
});
