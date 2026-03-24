#!/usr/bin/env -S node --import tsx
/**
 * Seed the global numa-capabilities-metadata DynamoDB table with capability
 * display metadata from infra/capabilities-metadata.ts.
 *
 * Uses the deployer account credentials (default AWS_PROFILE).
 *
 * Usage:
 *   AWS_PROFILE=q-demo npx tsx tools/seed-capabilities-metadata.ts
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../lib/prm-node/prm';
import { CAPABILITIES_METADATA } from '../infra/capabilities-metadata';

const TABLE_NAME = 'numa-capabilities-metadata';
const REGION = 'us-east-1';

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }));

async function seed() {
  console.log(`Seeding ${CAPABILITIES_METADATA.length} capabilities into ${TABLE_NAME}...`);

  // BatchWriteItem supports max 25 items per request
  const batches: (typeof CAPABILITIES_METADATA)[] = [];
  for (let i = 0; i < CAPABILITIES_METADATA.length; i += 25) {
    batches.push(CAPABILITIES_METADATA.slice(i, i + 25));
  }

  for (const batch of batches) {
    await ddbDoc.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((cap) => ({
            PutRequest: {
              Item: {
                flag: cap.flag,
                title: cap.title,
                description: cap.description,
                icon: cap.icon,
                system_only: cap.system_only,
                dev_only: cap.dev_only,
                dependencies: cap.dependencies,
              },
            },
          })),
        },
      })
    );
    console.log(`  Wrote ${batch.length} items`);
  }

  console.log('Done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
