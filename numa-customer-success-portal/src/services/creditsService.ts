import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { clientService } from './clientService';
import { awsCredentialsService } from './awsCredentialsService';
import { activityService } from './activityService';
import type { CreditConfig } from '@/types';

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
  /** Per NZ billing month ('YYYY-MM') → credits used, allocation in effect, and whether settled. */
  months: Record<string, { used: number; allocation: number; settled: boolean }>;
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
  // 2-credit floor on every interaction (low); agent stays cheaper than chat above the floor.
  valueTiers: {
    chat: { low: 2, medium: 4, high: 8, very_high: 18 },
    agent: { low: 2, medium: 3, high: 5, very_high: 12 },
  },
  marginsByTier: { low: 1.15, medium: 1.3, high: 1.6, very_high: 2.0 },
  // New-client starter plan: 2000 credits/mo (≈ NZD $1,015). Portal edits override per client.
  monthlyAllocations: Array.from({ length: 12 }, () => 2000),
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
      months[m] = { used, allocation, settled };
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
}

export const creditsService = new CreditsService();
