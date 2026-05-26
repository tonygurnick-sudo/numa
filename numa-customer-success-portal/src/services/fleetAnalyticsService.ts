/**
 * Numa Dashboard — fleet analytics service.
 *
 * Reads pre-computed snapshots from the deployer-account `numa-portal-fleet-analytics`
 * DynamoDB table, and invokes the `numa-fleet-analytics-rollup` Lambda for
 * on-demand refresh.
 *
 * The snapshot shape mirrors what the gather script produces in
 * `dev-notes/tasks/numa-dashboard/scripts/gather_dashboard_data.py`. The
 * aggregate (_FLEET / _CLIENTS) snapshots have `is_aggregate: true` and a
 * different KPI shape — see ./fleetAnalyticsTypes.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsCredentialsService } from './awsCredentialsService';
import { getAllConfig } from './configService';
import type { FleetAnalyticsSnapshot, RefreshScope, RollupResponse, SnapshotMetadata } from '@/types/fleetAnalytics';

const SPECIAL_AGGREGATES = ['_FLEET', '_CLIENTS'] as const;

class FleetAnalyticsService {
  private _ddbClient: DynamoDBDocumentClient | null = null;
  private _lambdaClient: LambdaClient | null = null;

  private async ddb(): Promise<DynamoDBDocumentClient> {
    if (!this._ddbClient) {
      const credentials = await awsCredentialsService.getDeployerCredentials();
      const config = getAllConfig();
      const region = config?.AWS_REGION ?? 'us-east-1';
      const raw = new DynamoDBClient({ region, credentials });
      this._ddbClient = DynamoDBDocumentClient.from(raw, {
        marshallOptions: { removeUndefinedValues: true },
      });
    }
    return this._ddbClient;
  }

  private async lambda(): Promise<LambdaClient> {
    if (!this._lambdaClient) {
      const credentials = await awsCredentialsService.getDeployerCredentials();
      const config = getAllConfig();
      const region = config?.AWS_REGION ?? 'us-east-1';
      this._lambdaClient = new LambdaClient({ region, credentials });
    }
    return this._lambdaClient;
  }

  private tableName(): string {
    const config = getAllConfig();
    const t = config?.FLEET_ANALYTICS_TABLE;
    if (!t) throw new Error('FLEET_ANALYTICS_TABLE not configured');
    return t;
  }

  private lambdaName(): string {
    const config = getAllConfig();
    const fn = config?.FLEET_ANALYTICS_LAMBDA;
    if (!fn) throw new Error('FLEET_ANALYTICS_LAMBDA not configured');
    return fn;
  }

  /**
   * Fetch a single snapshot by client name. Returns null if no row exists yet
   * (e.g. brand-new client that hasn't been included in a rollup).
   */
  async getSnapshot(clientName: string): Promise<FleetAnalyticsSnapshot | null> {
    const client = await this.ddb();
    const resp = await client.send(
      new GetCommand({
        TableName: this.tableName(),
        Key: { clientName, sk: 'SNAPSHOT#latest' },
      })
    );
    if (!resp.Item) return null;
    const body = resp.Item.body as FleetAnalyticsSnapshot | undefined;
    if (!body) return null;
    return body;
  }

  /**
   * List metadata for every snapshot (latest only) — used by the sidebar.
   * Scans the latest pointers and returns the bare minimum needed to render
   * the list without pulling the whole snapshot body.
   */
  async listSnapshotMetadata(): Promise<SnapshotMetadata[]> {
    const client = await this.ddb();
    const items: SnapshotMetadata[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await client.send(
        new ScanCommand({
          TableName: this.tableName(),
          FilterExpression: 'sk = :latest',
          ExpressionAttributeValues: { ':latest': 'SNAPSHOT#latest' },
          // `region` is a DynamoDB reserved keyword; we just don't include it
          // in the sidebar projection. Other reserved words avoided here too.
          ProjectionExpression:
            'clientName, generated_at, body.client_config.dev_instance, body.client_config.client_account_id, body.is_aggregate, body.stack_count, body.chat.totals.cost, body.cost_explorer.grand_total, body.totals.ce_grand_total, body.totals.chat_cost',
          ExclusiveStartKey: lastKey,
        })
      );
      for (const row of resp.Items ?? []) {
        const body = (row as { body?: Record<string, unknown> }).body ?? {};
        const cfg = (body.client_config ?? {}) as Record<string, unknown>;
        const chat = (body.chat as Record<string, unknown>) ?? {};
        const chatTotals = (chat.totals ?? {}) as Record<string, unknown>;
        const ce = (body.cost_explorer as Record<string, unknown>) ?? {};
        const aggTotals = (body.totals as Record<string, unknown>) ?? {};
        items.push({
          clientName: row.clientName as string,
          generated_at: row.generated_at as string | undefined,
          dev_instance: Boolean(cfg.dev_instance),
          client_account_id: cfg.client_account_id as string | undefined,
          region: cfg.region as string | undefined,
          chat_cost: (chatTotals.cost as number) ?? (aggTotals.chat_cost as number) ?? 0,
          ce_total: (ce.grand_total as number) ?? (aggTotals.ce_grand_total as number) ?? 0,
        });
      }
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items;
  }

  /** Resolve the right `clientName` PK for a sidebar selection. */
  static aggregateKey(kind: 'fleet' | 'clients'): string {
    return kind === 'fleet' ? '_FLEET' : '_CLIENTS';
  }

  isAggregate(clientName: string): boolean {
    return (SPECIAL_AGGREGATES as readonly string[]).includes(clientName);
  }

  /**
   * Pull the full snapshot body for every client (latest only).
   * Used by the export button to bundle into a single JSON download.
   */
  async fetchAllSnapshots(): Promise<Record<string, FleetAnalyticsSnapshot>> {
    const client = await this.ddb();
    const out: Record<string, FleetAnalyticsSnapshot> = {};
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await client.send(
        new ScanCommand({
          TableName: this.tableName(),
          FilterExpression: 'sk = :latest',
          ExpressionAttributeValues: { ':latest': 'SNAPSHOT#latest' },
          ExclusiveStartKey: lastKey,
        })
      );
      for (const row of resp.Items ?? []) {
        const name = (row as { clientName?: string }).clientName;
        const body = (row as { body?: FleetAnalyticsSnapshot }).body;
        if (name && body) out[name] = body;
      }
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return out;
  }

  /**
   * Invoke the rollup Lambda. Returns when the Lambda returns; the latest
   * snapshot for the selection should already be updated.
   */
  async refresh(scope: RefreshScope): Promise<RollupResponse> {
    const lambda = await this.lambda();
    const payload = scope.kind === 'all' ? { scope: 'all' } : { scope: 'client', clientName: scope.clientName };
    const resp = await lambda.send(
      new InvokeCommand({
        FunctionName: this.lambdaName(),
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
        InvocationType: 'RequestResponse',
      })
    );
    if (!resp.Payload) {
      throw new Error('Rollup Lambda returned no payload');
    }
    const decoded = new TextDecoder().decode(resp.Payload);
    const parsed = JSON.parse(decoded) as RollupResponse | { errorMessage?: string };
    if ('errorMessage' in parsed && parsed.errorMessage) {
      throw new Error(`Rollup Lambda failed: ${parsed.errorMessage}`);
    }
    return parsed as RollupResponse;
  }
}

export const fleetAnalyticsService = new FleetAnalyticsService();
