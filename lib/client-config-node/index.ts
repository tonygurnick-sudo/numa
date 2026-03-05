import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { RuntimeConfigAwsCredentialIdentityProvider } from '@aws-sdk/types';
import fs from 'node:fs';
import path from 'node:path';
import { ZodTypeAny } from 'zod';

const TableName = 'numa-client-config';
const ClientKey = 'clientName';
const ConfigKey = 'config';

// Client name validation regex: lowercase alphanumeric with optional dashes
const CLIENT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validates a client name against naming conventions.
 * Client names must be lowercase letters, numbers, and dashes only.
 * No leading/trailing dashes, no consecutive dashes.
 *
 * @param clientName - The client name to validate
 * @returns null if valid, error message string if invalid
 */
function validateClientName(clientName: string): string | null {
  if (!clientName || clientName.trim().length === 0) {
    return 'Client name is required';
  }

  const trimmedName = clientName.trim();

  // Check for invalid characters (this catches uppercase, special chars, spaces, etc.)
  if (!/^[a-z0-9-]+$/.test(trimmedName)) {
    return 'Client name can only contain lowercase letters, numbers, and dashes';
  }

  // Check for leading/trailing dashes
  if (trimmedName.startsWith('-') || trimmedName.endsWith('-')) {
    return 'Client name cannot start or end with a dash';
  }

  // Check for consecutive dashes
  if (trimmedName.includes('--')) {
    return 'Client name cannot contain consecutive dashes';
  }

  // Final pattern check
  if (!CLIENT_NAME_PATTERN.test(trimmedName)) {
    return 'Client name format is invalid';
  }

  return null; // Valid
}

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
  credentials?: RuntimeConfigAwsCredentialIdentityProvider
): Promise<ClientConfig>;
export async function getClientConfig<ClientConfig>(
  x: GetClientConfigProps | string,
  schema?: ZodTypeAny,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider
): Promise<ClientConfig> {
  const props = typeof x === 'string' ? { clientName: x, schema, credentials } : x;
  // JSON file is a local dev override; DynamoDB is the fallback (always exists in deployed environments)
  const config =
    getClientConfigFromJson(props.clientName) ?? (await getClientConfigFromDynamo(props.clientName, props.credentials));
  if (!config) {
    throw new Error(`Client config not found for client: ${props.clientName}`);
  }
  if (!props.schema) {
    return config as ClientConfig;
  }
  return props.schema.parse(config) as ClientConfig;
}

interface GetClientConfigFromDynamoProps {
  clientName: string;
  credentials?: RuntimeConfigAwsCredentialIdentityProvider;
}
export async function getClientConfigFromDynamo<ClientConfig>(
  props: GetClientConfigFromDynamoProps
): Promise<ClientConfig | undefined>;
export async function getClientConfigFromDynamo<ClientConfig>(
  clientName: string,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider
): Promise<ClientConfig | undefined>;
export async function getClientConfigFromDynamo<ClientConfig>(
  x: string | GetClientConfigFromDynamoProps,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider
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

async function getAllClientsFromDynamo<ClientConfig>(
  credentials?: RuntimeConfigAwsCredentialIdentityProvider
): Promise<Record<string, ClientConfig>> {
  const ddbdc = await getDocument(credentials);
  const result = await ddbdc.scan({
    TableName,
  });
  if (!result.Items) {
    return {};
  }
  return Object.fromEntries(result.Items.map((item) => [item[ClientKey], item[ConfigKey]]));
}

function getAllClientsFromJSON<ClientConfig>(): Record<string, ClientConfig> {
  return loadFromJson();
}

interface GetAllClientConfigsProps {
  credentials?: RuntimeConfigAwsCredentialIdentityProvider;
}
export async function getAllClientConfigs<ClientConfig>(
  props?: GetAllClientConfigsProps
): Promise<Record<string, ClientConfig>> {
  // JSON provides local dev overrides; DynamoDB is the base (always exists in deployed environments)
  const dynamoConfigs = await getAllClientsFromDynamo<ClientConfig>(props?.credentials);
  const jsonConfigs = getAllClientsFromJSON<ClientConfig>();
  return { ...dynamoConfigs, ...jsonConfigs };
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
  credentials?: RuntimeConfigAwsCredentialIdentityProvider
): Promise<boolean>;
export async function putClientConfig<ClientConfig>(
  x: string | PutClientConfigProps<ClientConfig>,
  config?: ClientConfig,
  schema?: ZodTypeAny,
  credentials?: RuntimeConfigAwsCredentialIdentityProvider
): Promise<boolean> {
  const props = typeof x === 'string' ? { clientName: x, config, schema, credentials } : x;

  // Validate client name format
  const nameError = validateClientName(props.clientName);
  if (nameError) {
    throw new Error(`Invalid client name: ${nameError}`);
  }

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
