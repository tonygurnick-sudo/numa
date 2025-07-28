import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { RuntimeConfigAwsCredentialIdentityProvider } from '@aws-sdk/types';
import fs from 'node:fs';
import path from 'node:path';
import { ZodTypeAny } from 'zod';

const TableName = 'numa-client-config';
const ClientKey = 'clientName';

interface ListClientProps {
  credentials?: RuntimeConfigAwsCredentialIdentityProvider;
}
export async function listClients(props?: ListClientProps): Promise<string[]> {
  return [...new Set([...(await listClientsFromDynamo(props?.credentials)), ...listClientsFromJson()])];
}

async function getDocument(credentials?: RuntimeConfigAwsCredentialIdentityProvider): Promise<DynamoDBDocument> {
  const client = new DynamoDBClient({
    credentials,
    region: 'us-east-1',
  });
  return DynamoDBDocument.from(client);
}

async function listClientsFromDynamo(credentials?: RuntimeConfigAwsCredentialIdentityProvider): Promise<string[]> {
  const ddbdc = await getDocument(credentials);
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

interface GetClientConfigProps {
  clientName: string;
  schema?: ZodTypeAny;
  credentials?: RuntimeConfigAwsCredentialIdentityProvider;
}
export async function getClientConfig<ClientConfig>(props: GetClientConfigProps): Promise<ClientConfig>;
export async function getClientConfig<ClientConfig>(
  clientName: string,
  schema?: ZodTypeAny,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider,
): Promise<ClientConfig>;
export async function getClientConfig<ClientConfig>(
  x: GetClientConfigProps | string,
  schema?: ZodTypeAny,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider,
): Promise<ClientConfig> {
  const props = typeof x === 'string' ? { clientName: x, schema, credentials } : x;
  const config =
    getClientConfigFromJson(props.clientName) ?? (await getClientConfigFromDynamo(props.clientName, props.credentials));
  if (!config) {
    throw new Error(`Client config not found for client: ${props.clientName}`);
  }
  if (!props.schema) {
    return config as ClientConfig;
  }
  return props.schema.parse(config);
}

interface GetClientConfigFromDynamoProps {
  clientName: string;
  credentials?: RuntimeConfigAwsCredentialIdentityProvider;
}
export async function getClientConfigFromDynamo<ClientConfig>(
  props: GetClientConfigFromDynamoProps,
): Promise<ClientConfig | undefined>;
export async function getClientConfigFromDynamo<ClientConfig>(
  clientName: string,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider,
): Promise<ClientConfig | undefined>;
export async function getClientConfigFromDynamo<ClientConfig>(
  x: string | GetClientConfigFromDynamoProps,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider,
): Promise<ClientConfig | undefined> {
  const props = typeof x === 'string' ? { clientName: x, credentials } : x;
  const ddbdc = await getDocument(props.credentials);
  const result = await ddbdc.get({
    TableName,
    Key: {
      clientName: props.clientName,
    },
    ProjectionExpression: 'config',
  });
  return result.Item?.config as ClientConfig | undefined;
}

function getClientConfigFromJson<ClientConfig>(clientName: string): ClientConfig | undefined {
  const data = loadFromJson<ClientConfig>();
  return data[clientName];
}

interface PutClientConfigProps<ClientConfig> {
  clientName: string;
  config: ClientConfig;
  schema?: ZodTypeAny;
  credentials?: RuntimeConfigAwsCredentialIdentityProvider;
}
export async function putClientConfig<ClientConfig>(props: PutClientConfigProps<ClientConfig>): Promise<boolean>;
export async function putClientConfig<ClientConfig>(
  clientName: string,
  config: ClientConfig,
  schema?: ZodTypeAny,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider,
): Promise<boolean>;
export async function putClientConfig<ClientConfig>(
  x: string | PutClientConfigProps<ClientConfig>,
  config?: ClientConfig,
  schema?: ZodTypeAny,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider,
): Promise<boolean> {
  const props = typeof x === 'string' ? { clientName: x, config, schema, credentials } : x;
  if (props.schema) {
    props.schema.parse(config);
  }
  const ddbdc = await getDocument(credentials);
  const result = await ddbdc.put({
    TableName,
    Item: {
      clientName: props.clientName,
      config: props.config,
    },
  });
  return result.$metadata.httpStatusCode === 200;
}
