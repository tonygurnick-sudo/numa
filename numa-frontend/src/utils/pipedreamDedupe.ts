import type { ConnectedAccount, ConnectionStatus } from '../types/pipedream';

const healthRank = (a: ConnectedAccount): number => {
  if (a.dead) return 0;
  if (a.healthy) return 2;
  return 1;
};

/**
 * BUG-380: collapse connected accounts that point at the same upstream
 * identity (same email).
 *
 * Pipedream mints a fresh account id (`apn_...`) on every OAuth completion and
 * never dedupes by identity, so one mailbox can appear 2-3x for a single user
 * — and FEAT-019 (multi-account) surfaced the whole backlog the old
 * single-account view used to hide.
 *
 * Keyed on the normalized account `name` (the email for OAuth apps). Keeps one
 * entry per identity: a healthy account beats unhealthy/dead, and on a tie the
 * first seen wins. Accounts with no resolvable identity (empty/null name) are
 * never collapsed — we can't prove they're duplicates. Order is preserved.
 *
 * Display-only and non-destructive: the duplicate accounts still exist in
 * Pipedream; this just stops them rendering multiple times and inflating the
 * "N accounts" count. The proxy applies the same collapse server-side; this is
 * the matching guard so stale/older cached responses still render correctly.
 */
export const dedupeConnectedAccounts = (accounts: ConnectedAccount[]): ConnectedAccount[] => {
  const result: ConnectedAccount[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const acc of accounts) {
    const identity = (acc.name || '').trim().toLowerCase();
    if (!identity) {
      // Unknown identity — never collapse; keep as-is.
      result.push(acc);
      continue;
    }
    const existingIdx = indexByIdentity.get(identity);
    if (existingIdx === undefined) {
      indexByIdentity.set(identity, result.length);
      result.push(acc);
      continue;
    }
    if (healthRank(acc) > healthRank(result[existingIdx])) {
      result[existingIdx] = acc;
    }
  }
  return result;
};

/** Apply {@link dedupeConnectedAccounts} to every connection's `accounts` list. */
export const dedupeConnectionAccounts = (connections: ConnectionStatus[]): ConnectionStatus[] =>
  connections.map((c) =>
    c.accounts && c.accounts.length > 1 ? { ...c, accounts: dedupeConnectedAccounts(c.accounts) } : c
  );
