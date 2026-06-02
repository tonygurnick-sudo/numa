import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { clientService } from './clientService';
import { awsCredentialsService } from './awsCredentialsService';
import { activityService } from './activityService';
import type { CreditConfig } from '@/types';

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
const configKey = (clientName: string) => ({ PK: `CLIENT#${clientName}`, SK: 'CONFIG' });
const balanceKey = (clientName: string) => ({ PK: `CLIENT#${clientName}`, SK: 'BALANCE' });

/** lib/credit-pricing defaults — keep in sync with credit_pricing/credits.py + tiers.py. */
export const DEFAULT_CREDIT_CONFIG: Required<CreditConfig> = {
  creditUsd: 0.4, // Scheme A — "thin / customer-friendly" default
  margin: 2.0, // scalar fallback (unclassified); marginsByTier below is the real defence
  agentcoreMult: 1.234,
  trivialConsumptionUsd: 0.01,
  valueTiers: {
    chat: { low: 1, medium: 3, high: 8, very_high: 18 },
    agent: { low: 1, medium: 2, high: 5, very_high: 12 },
  },
  marginsByTier: { low: 1.05, medium: 1.25, high: 1.5, very_high: 1.9 },
  monthlyAllocations: Array.from({ length: 12 }, () => 0),
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

  /** Add credits to the client's ledger BALANCE row (the monthly/annual allocation top-up). */
  async topUp(clientName: string, accountId: string, region: string, credits: number): Promise<number> {
    const doc = await this.clientLedger(accountId, region);
    const res = await doc.send(
      new UpdateCommand({
        TableName: ledgerTable(clientName),
        Key: balanceKey(clientName),
        UpdateExpression: 'ADD balance :c SET updatedAt = :t, updatedBy = :u',
        ExpressionAttributeValues: { ':c': credits, ':t': new Date().toISOString(), ':u': 'portal' },
        ReturnValues: 'UPDATED_NEW',
      })
    );
    const newBalance = Number(res.Attributes?.balance ?? credits);
    await activityService.logActivity({
      type: 'config',
      action: 'topup',
      resourceType: 'client-credits',
      resourceId: clientName,
      details: { credits, newBalance },
      success: true,
    });
    return newBalance;
  }
}

export const creditsService = new CreditsService();
