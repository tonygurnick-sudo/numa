import type { AccountOrgValue, Client } from '@/types';
import { nextgenBrokerService } from './nextgenBrokerService';

// NextGen org management account. Always classifies as `nextgen` even if it
// somehow appears as a client's `clientAccountId`.
export const NEXTGEN_MGMT_ACCOUNT_ID = '282304106064';

// Arcanum's internal AWS org — the dev / demo / HQ / quota-sharing accounts
// we use to host non-customer-owned client stacks. Stable, won't grow.
export const ARCANUM_ORG_ACCOUNTS: ReadonlySet<string> = new Set([
  '458119850496', // arcanum-dev
  '975186400848', // arcanum-dev-images
  '063563181233', // arcanum-dev-numa-pipedream-proxy
  '872515258482', // arcanum-dev-q-client
  '324037291751', // arcanum-dev-q-deployer
  '262893720581', // arcanum-prod
  '826326270637', // arcanum-prod-images
  '619071323471', // arcanum-prod-numa-demo (HQ)
  '965745962688', // arcanum-prod-numa-pipedream-proxy
  '207567759910', // arcanum-prod-q-deployer
  '978450690680', // arcanum-quota-sharing-account-1
  '905418183804', // Q Demo Account
]);

const CACHE_KEY = 'numa-csp:nextgen-org-accounts-v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedAccounts {
  ts: number;
  accountIds: string[];
}

export function classifyAccount(
  accountId: string | undefined | null,
  nextgenAccountIds: ReadonlySet<string>
): AccountOrgValue | null {
  if (!accountId) return null;
  // Arcanum set first — small, human-curated, wins on any unlikely overlap.
  if (ARCANUM_ORG_ACCOUNTS.has(accountId)) return 'arcanum';
  if (accountId === NEXTGEN_MGMT_ACCOUNT_ID) return 'nextgen';
  if (nextgenAccountIds.has(accountId)) return 'nextgen';
  return 'standalone';
}

function readCache(): ReadonlySet<string> | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAccounts;
    if (!parsed?.ts || !Array.isArray(parsed.accountIds)) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return new Set(parsed.accountIds);
  } catch {
    return null;
  }
}

function writeCache(accountIds: string[]): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const payload: CachedAccounts = { ts: Date.now(), accountIds };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / disabled storage — silently fall through, classification still works.
  }
}

export async function getNextgenAccountIds(): Promise<ReadonlySet<string>> {
  const cached = readCache();
  if (cached) return cached;
  try {
    const { accounts } = await nextgenBrokerService.listOrgAccounts();
    const ids = accounts.map((a) => a.id);
    writeCache(ids);
    return new Set(ids);
  } catch (err) {
    // Degrade gracefully — page should still load with Arcanum/Standalone classification.
    console.warn('Failed to fetch NextGen account list from broker:', err);
    return new Set<string>();
  }
}

export async function classifyAll(clients: Client[]): Promise<Map<string, AccountOrgValue | null>> {
  const nextgenIds = await getNextgenAccountIds();
  const result = new Map<string, AccountOrgValue | null>();
  for (const c of clients) {
    result.set(c.name, classifyAccount(c.config.clientAccountId, nextgenIds));
  }
  return result;
}

export function clearCache(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore.
  }
}

export const accountOrgService = {
  classifyAll,
  getNextgenAccountIds,
  clearCache,
};
