import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { awsCredentialsService } from '@/services/awsCredentialsService';
import type { Client } from '@/types';

export interface PublicDemoStats {
  clientName: string;
  todayCostUsd: number;
  dailyLimitUsd: number;
  thirtyDayMessages: number;
  thirtyDayUniqueConversations: number;
  thirtyDayCostUsd: number;
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getDateRange(): { today: string; thirtyDaysAgo: string } {
  const now = new Date();
  const today = formatDateKey(now);
  const past = new Date(now);
  past.setDate(past.getDate() - 30);
  const thirtyDaysAgo = formatDateKey(past);
  return { today, thirtyDaysAgo };
}

async function fetchStatsForClient(client: Client): Promise<PublicDemoStats> {
  const { clientAccountId, region = 'us-east-1', publicDemoDailyLimitUsd } = client.config;
  const tableName = `${client.name}-usage-analytics-counters`;
  const { today, thirtyDaysAgo } = getDateRange();

  const awsConfig = await awsCredentialsService.getClientConfig(clientAccountId, region);
  const ddb = new DynamoDBClient(awsConfig);
  const doc = DynamoDBDocumentClient.from(ddb);

  // Run all three queries in parallel
  const [costResult, msgResult, uniqueConvResult] = await Promise.all([
    doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :sk_start AND :sk_end',
        ExpressionAttributeValues: {
          ':pk': 'PUBLIC_DEMO',
          ':sk_start': `COST#DATE#${thirtyDaysAgo}`,
          ':sk_end': `COST#DATE#${today}`,
        },
      })
    ),
    doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :sk_start AND :sk_end',
        ExpressionAttributeValues: {
          ':pk': 'PUBLIC_DEMO',
          ':sk_start': `CONVERSATIONS#DATE#${thirtyDaysAgo}`,
          ':sk_end': `CONVERSATIONS#DATE#${today}`,
        },
      })
    ),
    doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :sk_start AND :sk_end',
        ExpressionAttributeValues: {
          ':pk': 'PUBLIC_DEMO',
          ':sk_start': `UNIQUE_CONVERSATIONS#DATE#${thirtyDaysAgo}`,
          ':sk_end': `UNIQUE_CONVERSATIONS#DATE#${today}`,
        },
      })
    ),
  ]);

  // Aggregate cost data
  let thirtyDayCostUsd = 0;
  let todayCostUsd = 0;
  const todaySk = `COST#DATE#${today}`;

  for (const item of costResult.Items ?? []) {
    const cost = Number(item.accumulated_cost_usd ?? 0);
    thirtyDayCostUsd += cost;
    if (item.SK === todaySk) {
      todayCostUsd = cost;
    }
  }

  // Aggregate message counts
  let thirtyDayMessages = 0;
  for (const item of msgResult.Items ?? []) {
    thirtyDayMessages += Number(item.conversation_count ?? 0);
  }

  // Aggregate unique conversation counts
  let thirtyDayUniqueConversations = 0;
  for (const item of uniqueConvResult.Items ?? []) {
    thirtyDayUniqueConversations += Number(item.unique_count ?? 0);
  }

  return {
    clientName: client.name,
    todayCostUsd: Math.round(todayCostUsd * 100) / 100,
    dailyLimitUsd: publicDemoDailyLimitUsd ?? 50,
    thirtyDayMessages,
    thirtyDayUniqueConversations,
    thirtyDayCostUsd: Math.round(thirtyDayCostUsd * 100) / 100,
  };
}

export async function fetchPublicDemoStats(clients: Client[]): Promise<PublicDemoStats[]> {
  const demoClients = clients.filter((c) => c.config.publicDemo);
  if (demoClients.length === 0) return [];

  const results = await Promise.allSettled(demoClients.map(fetchStatsForClient));

  return results
    .filter((r): r is PromiseFulfilledResult<PublicDemoStats> => r.status === 'fulfilled')
    .map((r) => r.value);
}
