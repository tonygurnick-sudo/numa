import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { clientService } from './clientService';
import { awsCredentialsService } from './awsCredentialsService';
import { activityService } from './activityService';
import type { CreditConfig } from '@/types';

/** A billing-admin roster entry (CLIENT#/BILLING_ADMIN#<sub>) — who may see credit data in-client. */
export interface BillingAdminRow {
  sub: string;
  email: string | null;
  grantedBy: string | null;
  grantedAt: string | null;
}

/** A client Cognito user (for the promote picker). */
export interface ClientUser {
  sub: string;
  email: string;
  enabled: boolean;
}

/** A top-up-balance event-log entry (CLIENT#/TXN#…). `credits` is signed. */
export interface CreditTxn {
  kind: 'topup' | 'settlement' | 'adjustment' | string;
  credits: number;
  month?: string;
  createdAt: string;
  createdBy?: string;
  note?: string;
}

/** Live credit standing derived from a client's ledger (read-only, cross-account). */
export interface CreditStanding {
  /** Live top-up balance: settled TXN events minus not-yet-settled monthly overflow. Can be negative. */
  availableBalance: number;
  /** Σ of all TXN credits (top-ups + month-close settlements + adjustments). */
  settledBalance: number;
  /** Overflow past allocation for months not yet settled (open month + any closed-but-unsettled). */
  liveOverflow: number;
  /**
   * Per NZ billing month ('YYYY-MM') → credits used, allocation in effect, whether settled, plus the
   * underlying USD economics (Arcanum-internal): `costUsd` = real token+AgentCore consumption that
   * month, `revenueUsd` = credit value billed. margin ≈ revenueUsd / costUsd.
   */
  months: Record<string, { used: number; allocation: number; settled: boolean; costUsd: number; revenueUsd: number }>;
  /** Top-up-balance event log, newest first (for audit / display). */
  txns: CreditTxn[];
}

/**
 * CreditsService — central authoring for the Numa Credit System (SPK-015).
 *
 * Pricing config + top-ups are owned here (the portal), NOT in the client account. On save we:
 *   1. write the config to the central `numa-client-config` (source of truth), and
 *   2. PUSH it into the client account's `numa-<client>-credit-ledger` CONFIG row (via the portal's
 *      ArcanumAIAccess assume-role) — which the in-client `credit-debit` Lambda reads at meter time.
 * The client's read path is unchanged; it never authors config.
 */

const ledgerTable = (clientName: string): string => `numa-${clientName}-credit-ledger`;
const clientPk = (clientName: string) => `CLIENT#${clientName}`;
const configKey = (clientName: string) => ({ PK: clientPk(clientName), SK: 'CONFIG' });

/** lib/credit-pricing defaults — keep in sync with credit_pricing/credits.py + tiers.py. */
export const DEFAULT_CREDIT_CONFIG: Required<CreditConfig> = {
  creditUsd: 0.3, // ~NZD $0.50/credit @ FX 1.69 — the NZD-anchored default
  margin: 2.0, // scalar fallback (unclassified); marginsByTier below is the real defence
  agentcoreMult: 1.234,
  trivialConsumptionUsd: 0.01,
  // Half-credit pricing steps (the floor rounds up to 0.5); agent stays cheaper than chat at every tier.
  valueTiers: {
    chat: { low: 1, medium: 2, high: 5, very_high: 8 },
    agent: { low: 0.5, medium: 1.5, high: 3, very_high: 5 },
  },
  marginsByTier: { low: 1.1, medium: 1.25, high: 1.4, very_high: 1.6 },
  // New-client starter plan: 2000 credits/mo (≈ NZD $1,015). Portal edits override per client.
  monthlyAllocations: Array.from({ length: 12 }, () => 2000),
  // Numa Voice per-minute USD anchors (provisional — confirm with Asa). Mirrors
  // lib/credit-pricing/voice_pricing.py defaults; the non-LLM cost of a call.
  voiceRates: { telephonyPerMin: 0.04, transcribePerMin: 0.024, contactLensPerMin: 0.015 },
  // Synergy KB crawl ingestion rates (provisional — confirm with Asa). Mirrors
  // lib/credit-pricing/synergy_pricing.py defaults; embedding cost + a small
  // overhead uplift covering the negligible S3/SQS/Lambda spend.
  synergyRates: { embedUsdPerMtoken: 0.02, charsPerToken: 4, avgTokensPerDoc: 4000, overheadMult: 1.1 },
};

export class CreditsService {
  /** A DynamoDB document client scoped to a client account (assumes ArcanumAIAccess). */
  private async clientLedger(accountId: string, region: string): Promise<DynamoDBDocumentClient> {
    const credentials = await awsCredentialsService.getClientCredentials(accountId, region);
    return DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }));
  }

  /** Save pricing config centrally and push it into the client's ledger CONFIG row. */
  async saveConfig(clientName: string, accountId: string, region: string, config: CreditConfig): Promise<void> {
    // 1. Central source of truth.
    await clientService.updateClientConfig(clientName, { creditConfig: config });
    // 2. Push to the client account (read by the in-client credit-debit Lambda).
    const doc = await this.clientLedger(accountId, region);
    await doc.send(
      new PutCommand({
        TableName: ledgerTable(clientName),
        Item: { ...configKey(clientName), ...config, updatedAt: new Date().toISOString(), updatedBy: 'portal' },
      })
    );
    await activityService.logActivity({
      type: 'config',
      action: 'updated',
      resourceType: 'client-credits',
      resourceId: clientName,
      details: { creditConfig: config },
      success: true,
    });
  }

  /**
   * Top up the client's persistent balance by appending a `topup` event to the ledger event log
   * (CLIENT#/TXN#…). Balance is the sum of TXN events — there's no decrementing scalar — so a top-up
   * is an append, never a mutation. Also logged to the portal activity table for the audit trail.
   */
  async topUp(clientName: string, accountId: string, region: string, credits: number): Promise<void> {
    const doc = await this.clientLedger(accountId, region);
    const createdAt = new Date().toISOString();
    const id = globalThis.crypto?.randomUUID?.() ?? createdAt;
    await doc.send(
      new PutCommand({
        TableName: ledgerTable(clientName),
        Item: {
          PK: clientPk(clientName),
          SK: `TXN#${createdAt}#${id}`,
          txnKind: 'topup',
          credits,
          createdAt,
          createdBy: 'portal',
        },
      })
    );
    await activityService.logActivity({
      type: 'config',
      action: 'topup',
      resourceType: 'client-credits',
      resourceId: clientName,
      details: { credits },
      success: true,
    });
  }

  /**
   * Append a signed `adjustment` event to the balance log — a manual correction or a reset-to-zero.
   * `credits` is signed (negative to draw down / zero the balance). Auditable, never a deletion.
   */
  async adjustBalance(
    clientName: string,
    accountId: string,
    region: string,
    credits: number,
    note: string
  ): Promise<void> {
    const doc = await this.clientLedger(accountId, region);
    const createdAt = new Date().toISOString();
    const id = globalThis.crypto?.randomUUID?.() ?? createdAt;
    await doc.send(
      new PutCommand({
        TableName: ledgerTable(clientName),
        Item: {
          PK: clientPk(clientName),
          SK: `TXN#${createdAt}#${id}`,
          txnKind: 'adjustment',
          credits,
          note,
          createdAt,
          createdBy: 'portal',
        },
      })
    );
    await activityService.logActivity({
      type: 'config',
      action: 'updated',
      resourceType: 'client-credits',
      resourceId: clientName,
      details: { adjustment: credits, note },
      success: true,
    });
  }

  /**
   * Set whether the in-app credits view is visible to the client (`showCredits`). Writes the central
   * numa-client-config only; it's emitted to the client's config.json at DEPLOY time, so it takes
   * visible effect on the next deploy. Metering runs regardless of this flag.
   */
  async setVisibility(clientName: string, show: boolean): Promise<void> {
    await clientService.updateClientConfig(clientName, { showCredits: show });
    await activityService.logActivity({
      type: 'config',
      action: 'updated',
      resourceType: 'client-credits',
      resourceId: clientName,
      details: { showCredits: show },
      success: true,
    });
  }

  /**
   * Derive the client's live credit standing from its ledger in one partition query (read-only,
   * cross-account). Implements the Option-B drawdown waterfall:
   *   - per month: credits used (exact `creditsCharged`, or revenue ÷ creditUsd for older rows) vs the
   *     allocation in effect (the month's frozen `allocationSnapshot`, else the live CONFIG allocation);
   *   - `liveOverflow` = Σ over months WITHOUT a settlement TXN of max(0, used − allocation);
   *   - `settledBalance` = Σ TXN credits (top-ups + settlements + adjustments);
   *   - `availableBalance` = settledBalance − liveOverflow (can be negative = invoice signal).
   * Months already settled by the nightly job are excluded from liveOverflow (their overflow is in TXN).
   */
  async getStanding(clientName: string, accountId: string, region: string): Promise<CreditStanding> {
    const doc = await this.clientLedger(accountId, region);
    const res = await doc.send(
      new QueryCommand({
        TableName: ledgerTable(clientName),
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': clientPk(clientName) },
      })
    );
    const items = res.Items ?? [];

    const cfg = items.find((it) => String(it.SK) === 'CONFIG');
    const allocations: number[] = Array.isArray(cfg?.monthlyAllocations)
      ? (cfg!.monthlyAllocations as unknown[]).map(Number)
      : [];
    const creditUsd = Number(cfg?.creditUsd ?? DEFAULT_CREDIT_CONFIG.creditUsd) || DEFAULT_CREDIT_CONFIG.creditUsd;

    const txns: CreditTxn[] = items
      .filter((it) => String(it.SK ?? '').startsWith('TXN#'))
      .map((it) => ({
        kind: String(it.txnKind ?? ''),
        credits: Number(it.credits ?? 0),
        month: it.month ? String(it.month) : undefined,
        createdAt: String(it.createdAt ?? ''),
        createdBy: it.createdBy ? String(it.createdBy) : undefined,
        note: it.note ? String(it.note) : undefined,
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const settledBalance = txns.reduce((s, t) => s + t.credits, 0);
    const settledMonths = new Set(txns.filter((t) => t.kind === 'settlement' && t.month).map((t) => t.month!));

    const months: CreditStanding['months'] = {};
    let liveOverflow = 0;
    for (const it of items) {
      const sk = String(it.SK ?? '');
      if (!sk.startsWith('MONTH#')) continue;
      const m = sk.slice('MONTH#'.length);
      const monthIdx = Number(m.slice(5, 7)) - 1;
      const used =
        it.creditsCharged != null
          ? Number(it.creditsCharged)
          : creditUsd
            ? Math.round(Number(it.creditRevenueUsd ?? 0) / creditUsd)
            : 0;
      const allocation = it.allocationSnapshot != null ? Number(it.allocationSnapshot) : (allocations[monthIdx] ?? 0);
      const settled = settledMonths.has(m);
      months[m] = {
        used,
        allocation,
        settled,
        costUsd: Number(it.consumptionCostUsd ?? 0),
        revenueUsd: Number(it.creditRevenueUsd ?? 0),
      };
      if (!settled) liveOverflow += Math.max(0, used - Math.max(0, allocation));
    }

    return {
      availableBalance: settledBalance - Math.max(0, liveOverflow),
      settledBalance,
      liveOverflow,
      months,
      txns,
    };
  }

  // ── Billing admins (who may see credit data in-client) ─────────────────────────────────────────
  // Membership lives in the client ledger (NOT a Cognito group — that'd be self-grantable by any
  // admin). The portal seeds the first billing-admin per client; after that an existing billing-admin
  // propagates from in-client User Management. All writes here are Arcanum-side (assume-role) + logged.

  /** List the client's enabled Cognito users (for the promote picker), via ArcanumAIAccess. */
  async listClientUsers(clientName: string, accountId: string, region: string): Promise<ClientUser[]> {
    const cfg = await awsCredentialsService.getClientConfig(accountId, region);
    const cognito = new CognitoIdentityProviderClient(cfg);
    const pools = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
    const pool = pools.UserPools?.find((p) => p.Name === `numa-${clientName}`);
    if (!pool?.Id) throw new Error(`User pool numa-${clientName} not found`);
    const users: ClientUser[] = [];
    let token: string | undefined;
    do {
      const res = await cognito.send(new ListUsersCommand({ UserPoolId: pool.Id, Limit: 60, PaginationToken: token }));
      for (const u of res.Users ?? []) {
        const sub = u.Attributes?.find((a) => a.Name === 'sub')?.Value;
        const email = u.Attributes?.find((a) => a.Name === 'email')?.Value;
        if (sub && email) users.push({ sub, email, enabled: u.Enabled !== false });
      }
      token = res.PaginationToken;
    } while (token);
    return users.filter((u) => u.enabled).sort((a, b) => a.email.localeCompare(b.email));
  }

  /** The current billing-admin roster for a client (CLIENT#/BILLING_ADMIN# rows). */
  async listBillingAdmins(clientName: string, accountId: string, region: string): Promise<BillingAdminRow[]> {
    const doc = await this.clientLedger(accountId, region);
    const res = await doc.send(
      new QueryCommand({
        TableName: ledgerTable(clientName),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': clientPk(clientName), ':sk': 'BILLING_ADMIN#' },
      })
    );
    return (res.Items ?? []).map((it) => ({
      sub: String(it.sub ?? String(it.SK).slice('BILLING_ADMIN#'.length)),
      email: it.email ? String(it.email) : null,
      grantedBy: it.grantedBy ? String(it.grantedBy) : null,
      grantedAt: it.grantedAt ? String(it.grantedAt) : null,
    }));
  }

  /** Seed/grant a billing-admin (bootstrap). Writes the ledger row via assume-role + logs it. */
  async promoteBillingAdmin(
    clientName: string,
    accountId: string,
    region: string,
    sub: string,
    email: string | null
  ): Promise<void> {
    const doc = await this.clientLedger(accountId, region);
    await doc.send(
      new PutCommand({
        TableName: ledgerTable(clientName),
        Item: {
          PK: clientPk(clientName),
          SK: `BILLING_ADMIN#${sub}`,
          sub,
          email: email ?? null,
          grantedBy: 'portal',
          grantedAt: new Date().toISOString(),
        },
      })
    );
    await activityService.logActivity({
      type: 'config',
      action: 'billing-admin-grant',
      resourceType: 'client-credits',
      resourceId: clientName,
      details: { metadata: { sub, email } },
      success: true,
    });
  }

  /** Revoke a billing-admin. */
  async demoteBillingAdmin(clientName: string, accountId: string, region: string, sub: string): Promise<void> {
    const doc = await this.clientLedger(accountId, region);
    await doc.send(
      new DeleteCommand({
        TableName: ledgerTable(clientName),
        Key: { PK: clientPk(clientName), SK: `BILLING_ADMIN#${sub}` },
      })
    );
    await activityService.logActivity({
      type: 'config',
      action: 'billing-admin-revoke',
      resourceType: 'client-credits',
      resourceId: clientName,
      details: { metadata: { sub } },
      success: true,
    });
  }
}

export const creditsService = new CreditsService();
