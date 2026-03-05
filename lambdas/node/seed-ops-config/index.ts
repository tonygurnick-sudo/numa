import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import {
  DEFAULT_TICKET_TYPES,
  DEFAULT_STATUSES,
  DEFAULT_FIELDS,
  DEFAULT_CRM_CONFIG,
  DEFAULT_SUPPLIER_CONFIG,
  DEFAULT_LINK_CONFIG,
  DEFAULT_PREFIX_REGISTRY,
} from './seed-data';

const client = withPRM(DynamoDBClient, {});
const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const OPS_CONFIG_TABLE = process.env.OPS_CONFIG_TABLE!;
const OPS_TABLE = process.env.OPS_TABLE!;

interface SeedResult {
  created: number;
  skipped: number;
  errors: string[];
}

async function putIfNotExists(tableName: string, item: Record<string, unknown>, result: SeedResult): Promise<void> {
  try {
    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
    result.created++;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException') {
      result.skipped++;
    } else {
      const sk = typeof item.SK === 'string' ? item.SK : 'unknown';
      result.errors.push(`Failed to seed ${sk}: ${String(err)}`);
    }
  }
}

const sleep = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  // Wait for IAM policy propagation — the seed Lambda is invoked immediately
  // after its IAM policy attachment is created, but IAM is eventually consistent
  // and can take several seconds to propagate.
  console.log('Waiting 10s for IAM policy propagation...');
  await sleep(10_000);

  console.log('Starting Numa Ops config seed...');
  console.log(`Config table: ${OPS_CONFIG_TABLE}, Ops table: ${OPS_TABLE}`);

  const result: SeedResult = { created: 0, skipped: 0, errors: [] };

  // Seed config table items
  const configItems = [
    ...DEFAULT_TICKET_TYPES,
    ...DEFAULT_STATUSES,
    ...DEFAULT_FIELDS,
    DEFAULT_CRM_CONFIG,
    DEFAULT_SUPPLIER_CONFIG,
    DEFAULT_LINK_CONFIG,
  ];

  for (const item of configItems) {
    await putIfNotExists(OPS_CONFIG_TABLE, item, result);
  }

  // Seed prefix registry in ops table
  for (const item of DEFAULT_PREFIX_REGISTRY) {
    await putIfNotExists(OPS_TABLE, item, result);
  }

  const summary = `Seed complete: ${result.created} created, ${result.skipped} skipped (already exist), ${result.errors.length} errors`;
  console.log(summary);

  if (result.errors.length > 0) {
    console.error('Seed errors:', result.errors);
  }

  return {
    statusCode: result.errors.length > 0 ? 500 : 200,
    body: JSON.stringify({ message: summary, ...result }),
  };
};
