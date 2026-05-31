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
import { createRequire } from 'module';
import { CAPABILITIES_METADATA } from '../infra/capabilities-metadata';

// withPRM is loaded from the CJS build via createRequire (same pattern as
// tools/audit-company-profiles.ts). A plain ESM `import { withPRM }` resolves to
// the compiled prm.js under tsx and fails with "no export named 'withPRM'".
const req = createRequire(import.meta.url);
const prmBundle = req('../lib/prm-node/prm.js');
const withPRM = prmBundle.withPRM || prmBundle.default?.withPRM;

const TABLE_NAME = 'numa-capabilities-metadata';
const REGION = 'us-east-1';

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }));

async function seed(): Promise<void> {
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
                // Only write tier when set — lib-dynamodb rejects undefined
                // attribute values (this client has no removeUndefinedValues).
                ...(cap.tier ? { tier: cap.tier } : {}),
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
