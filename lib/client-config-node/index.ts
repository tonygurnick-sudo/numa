import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import fs from 'node:fs';
import path from 'node:path';
import { ZodTypeAny } from 'zod';

const TableName = 'numa-client-config';
const ClientKey = 'clientName';
const deployerRole = `arn:aws:iam::207567759910:role/admin-delegated-access`;

export async function listClients(): Promise<string[]> {
  return [...new Set([...(await listClientsFromDynamo()), ...listClientsFromJson()])];
}

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

async function listClientsFromDynamo(): Promise<string[]> {
  const ddbdc = getDocument();
  const result = await ddbdc.scan({
    TableName,
    ProjectionExpression: ClientKey,
  });
  if (!result.Items) {
    return [];
  }
  return result.Items.map((item) => item[ClientKey]).filter((item) => item !== undefined);
}

function listClientsFromJson(): string[] {
  return Object.keys(loadFromJson());
}

function loadFromJson<ClientConfig>(): Record<string, ClientConfig> {
  try {
    const clientFile = path.join(import.meta.dirname, '..', '..', 'clientConfigProd.json');
    const data = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
    return data as Record<string, ClientConfig>;
  } catch (error) {
    console.warn('Issue reading clients file:', error);
  }
  return {} as Record<string, ClientConfig>;
}

export async function getClientConfig<ClientConfig>(clientName: string, schema?: ZodTypeAny): Promise<ClientConfig> {
  const config = getClientConfigFromJson(clientName) ?? (await getClientConfigFromDynamo(clientName));
  if (!config) {
    throw new Error(`Client config not found for client: ${clientName}`);
  }
  if (!schema) {
    return config as ClientConfig;
  }
  return schema.parse(config);
}

export async function getClientConfigFromDynamo<ClientConfig>(clientName: string): Promise<ClientConfig | undefined> {
  const ddbdc = getDocument();
  const result = await ddbdc.get({
    TableName,
    Key: {
      clientName,
    },
    ProjectionExpression: 'config',
  });
  return result.Item?.config as ClientConfig | undefined;
}

function getClientConfigFromJson<ClientConfig>(clientName: string): ClientConfig | undefined {
  const data = loadFromJson<ClientConfig>();
  return data[clientName];
}

export async function putClientConfig<ClientConfig>(
  clientName: string,
  config: ClientConfig,
  schema?: ZodTypeAny,
): Promise<boolean> {
  if (schema) {
    schema.parse(config);
  }
  const ddbdc = getDocument();
  const result = await ddbdc.put({
    TableName,
    Item: {
      clientName,
      config,
    },
  });
  return result.$metadata.httpStatusCode === 200;
}
