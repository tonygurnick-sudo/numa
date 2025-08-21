import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { createInterface } from 'node:readline/promises';

const TableName = 'numa-client-config';
const deployerRole = `arn:aws:iam::207567759910:role/admin-delegated-access`;

function getDocument(): DynamoDBDocument {
  const client = new DynamoDBClient({
    credentials: fromTemporaryCredentials({
      params: {
        RoleArn: deployerRole,
        RoleSessionName: 'client-config',
      },
    }),
    region: 'us-east-1',
  });
  return DynamoDBDocument.from(client);
}

export async function deleteClientConfig(clientName: string, yes = false): Promise<boolean> {
  const ddbdc = getDocument();

  // First check if the client exists
  const existingResult = await ddbdc.get({
    TableName,
    Key: {
      clientName,
    },
  });

  if (!existingResult.Item) {
    console.log(`Client config for '${clientName}' not found in DynamoDB.`);
    return false;
  }

  console.log(`Found client config for '${clientName}':`);
  console.log(JSON.stringify(existingResult.Item.config, null, 2));

  // Confirm deletion unless yes=true
  if (!yes) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const confirm = await rl.question(`Are you sure you want to delete the config for '${clientName}'? [y/N] `);
    rl.close();
    if (confirm.toLowerCase() !== 'y') {
      console.log('Deletion cancelled.');
      return false;
    }
  }

  // Delete the item
  const result = await ddbdc.delete({
    TableName,
    Key: {
      clientName,
    },
  });

  return result.$metadata.httpStatusCode === 200;
}

async function main(clientName: string, yes = false): Promise<void> {
  if (!clientName) {
    console.error('Usage: yarn delete-config <client-name>');
    process.exit(1);
  }

  try {
    const success = await deleteClientConfig(clientName, yes);
    if (success) {
      console.log(`Successfully deleted client config for '${clientName}'`);
    } else {
      console.log(`Failed to delete client config for '${clientName}'`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error deleting client config:', error);
    process.exit(1);
  }
}

if (import.meta.filename === process.argv[1]) {
  const clientName = process.argv[2];
  const yes = process.argv.includes('--yes');
  main(clientName, yes);
}
