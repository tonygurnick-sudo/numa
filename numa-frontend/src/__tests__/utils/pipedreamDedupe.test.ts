import { describe, expect, it } from 'vitest';
import { dedupeConnectedAccounts, dedupeConnectionAccounts } from '../../utils/pipedreamDedupe';
import type { ConnectedAccount, ConnectionStatus } from '../../types/pipedream';

const acc = (over: Partial<ConnectedAccount>): ConnectedAccount => ({
  account_id: 'apn_x',
  name: 'a@b.com',
  healthy: true,
  dead: false,
  connected_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('dedupeConnectedAccounts', () => {
  it("collapses Ian's real MMRC gmail shape (3 -> 2, BUG-380)", () => {
    // Two nziandoc@gmail.com (true dup) + one distinct pro@mmrc.org.nz.
    const out = dedupeConnectedAccounts([
      acc({ account_id: 'apn_arhQxd7', name: 'nziandoc@gmail.com', connected_at: '2026-05-30T00:33:14.000Z' }),
      acc({ account_id: 'apn_MGhdolK', name: 'nziandoc@gmail.com', connected_at: '2026-05-30T01:01:44.000Z' }),
      acc({ account_id: 'apn_arhZp4A', name: 'pro@mmrc.org.nz', connected_at: '2026-06-20T22:52:03.000Z' }),
    ]);
    expect(out.map((a) => a.account_id)).toEqual(['apn_arhQxd7', 'apn_arhZp4A']);
  });

  it('is case/whitespace insensitive on the identity', () => {
    const out = dedupeConnectedAccounts([
      acc({ account_id: 'apn_1', name: 'User@Gmail.com' }),
      acc({ account_id: 'apn_2', name: '  user@gmail.com ' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].account_id).toBe('apn_1');
  });

  it('keeps distinct emails (multi-account is legitimate)', () => {
    const out = dedupeConnectedAccounts([
      acc({ account_id: 'apn_1', name: 'one@x.com' }),
      acc({ account_id: 'apn_2', name: 'two@x.com' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('prefers a healthy account over a dead/unhealthy one with the same identity', () => {
    const out = dedupeConnectedAccounts([
      acc({ account_id: 'apn_dead', name: 'a@b.com', healthy: false, dead: true }),
      acc({ account_id: 'apn_live', name: 'a@b.com', healthy: true, dead: false }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].account_id).toBe('apn_live');
  });

  it('never collapses accounts with an unresolvable identity (null/empty name)', () => {
    const out = dedupeConnectedAccounts([
      acc({ account_id: 'apn_1', name: null }),
      acc({ account_id: 'apn_2', name: '' }),
      acc({ account_id: 'apn_3', name: '   ' }),
    ]);
    expect(out.map((a) => a.account_id)).toEqual(['apn_1', 'apn_2', 'apn_3']);
  });

  it('preserves order of the surviving accounts', () => {
    const out = dedupeConnectedAccounts([
      acc({ account_id: 'apn_a', name: 'a@x.com' }),
      acc({ account_id: 'apn_b', name: 'b@x.com' }),
      acc({ account_id: 'apn_a2', name: 'a@x.com' }),
      acc({ account_id: 'apn_c', name: 'c@x.com' }),
    ]);
    expect(out.map((a) => a.account_id)).toEqual(['apn_a', 'apn_b', 'apn_c']);
  });
});

describe('dedupeConnectionAccounts', () => {
  const conn = (over: Partial<ConnectionStatus>): ConnectionStatus => ({
    app_name: 'gmail',
    status: 'connected',
    pipedream_account_id: 'apn_x',
    last_auth_check: null,
    accounts: [],
    ...over,
  });

  it('dedupes per-connection and leaves single/zero-account rows untouched by reference', () => {
    const single = conn({ app_name: 'slack', accounts: [acc({ account_id: 'apn_s', name: 's@x.com' })] });
    const empty = conn({ app_name: 'notion', status: 'not_connected', accounts: [] });
    const dup = conn({
      app_name: 'gmail',
      accounts: [acc({ account_id: 'apn_1', name: 'a@x.com' }), acc({ account_id: 'apn_2', name: 'a@x.com' })],
    });
    const out = dedupeConnectionAccounts([single, empty, dup]);
    // Rows with <2 accounts are returned by reference (no needless copy).
    expect(out[0]).toBe(single);
    expect(out[1]).toBe(empty);
    expect(out[2].accounts).toHaveLength(1);
  });
});
