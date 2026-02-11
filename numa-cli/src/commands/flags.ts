/**
 * Flags command for Numa CLI.
 * Displays feature flags and their current state for environments.
 */

import { Command } from 'commander';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient, ListGroupsCommand } from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { fromIni } from '@aws-sdk/credential-providers';
import { createDynamoDBClient, createS3Client } from '../aws.js';
import { loadConfig, getCurrentEnv } from '../config.js';
import type { EnvironmentConfig } from '../types.js';
import { clientConfigSchema } from '../types.js';

// Infrastructure flags to extract from client config
const INFRASTRUCTURE_FLAGS = [
  'pipedreamIntegrations',
  'agents',
  'dataConnectorsEnabled',
  'numaWorkspaceChat',
  'scheduling',
  'brandingProviderEnabled',
  'provisionQResources',
  'allApps',
  'devInstance',
] as const;

// Frontend config flags to look for
const FRONTEND_FLAGS = [
  'PIPEDREAM_INTEGRATIONS',
  'AGENTS',
  'DATA_CONNECTORS_ENABLED',
  'NUMA_WORKSPACE_CHAT',
  'SCHEDULING',
  'BRANDING_PROVIDER_ENABLED',
] as const;

// Key Lambda functions to inspect
const KEY_LAMBDAS = ['numa-chat-agent', 'step-function-start', 'pipedream-relay'] as const;

// Feature-related environment variables to extract
const FEATURE_ENV_VARS = [
  'PIPEDREAM_PROXY_LAMBDA_ARN',
  'SUPPORTED_INTEGRATIONS',
  'GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME',
  'WORKSPACE_AGENTS_TABLE',
  'WORKSPACE_CHAT_AGENT_FUNCTION_URL',
] as const;

interface InfrastructureFlags {
  [key: string]: { value: boolean; source: string };
}

interface FrontendConfig {
  [key: string]: { value: unknown; source: string };
}

interface UserFeatures {
  groups: {
    [groupName: string]: string[];
  };
}

interface LambdaEnvironment {
  [lambdaName: string]: {
    [envVar: string]: string;
  };
}

interface FlagData {
  client: string;
  accountId: string;
  region: string;
  timestamp: string;
  flags: {
    infrastructure?: InfrastructureFlags;
    frontend?: FrontendConfig;
    userFeatures?: UserFeatures;
    lambda?: LambdaEnvironment;
  };
}

/**
 * Create the flags command.
 */
export function createFlagsCommand(): Command {
  const cmd = new Command('flags')
    .description('Display feature flags and their current state')
    .option('--category <type>', 'show specific category: infra|user|frontend|lambda|all', 'all')
    .option('--format <type>', 'output format: table|json', 'table')
    .option('--env <name>', 'environment name (uses current env if not specified)')
    .action(async (options: {
      category: 'infra' | 'user' | 'frontend' | 'lambda' | 'all';
      format: 'table' | 'json';
      env?: string;
    }) => {
      await showFlags(options);
    });

  return cmd;
}

/**
 * Show flags for the specified environment.
 */
async function showFlags(options: {
  category: 'infra' | 'user' | 'frontend' | 'lambda' | 'all';
  format: 'table' | 'json';
  env?: string;
}): Promise<void> {
  try {
    const config = loadConfig();
    let envConfig: EnvironmentConfig;

    if (options.env) {
      const env = config.environments[options.env];
      if (!env) {
        console.error(`❌ Environment '${options.env}' not found.`);
        console.log('Available environments:', Object.keys(config.environments).join(', '));
        process.exit(1);
      }
      envConfig = env;
    } else {
      const currentEnv = getCurrentEnv();
      if (!currentEnv) {
        console.error('❌ No current environment set.');
        console.log('Use "numa env use <name>" to set an environment or --env <name> to specify one.');
        process.exit(1);
      }
      envConfig = currentEnv;
    }

    // Collect flag data based on category filter
    const flagData: FlagData = {
      client: envConfig.clientName,
      accountId: envConfig.clientAccountId,
      region: envConfig.region,
      timestamp: new Date().toISOString(),
      flags: {},
    };

    if (options.category === 'all' || options.category === 'infra') {
      flagData.flags.infrastructure = await getInfrastructureFlags(envConfig);
    }

    if (options.category === 'all' || options.category === 'frontend') {
      flagData.flags.frontend = await getFrontendConfig(envConfig);
    }

    if (options.category === 'all' || options.category === 'user') {
      flagData.flags.userFeatures = await getCognitoGroupFeatures(envConfig);
    }

    if (options.category === 'all' || options.category === 'lambda') {
      flagData.flags.lambda = await getLambdaEnvironment(envConfig);
    }

    // Output results
    if (options.format === 'json') {
      console.log(JSON.stringify(flagData, null, 2));
    } else {
      formatTableOutput(flagData);
    }
  } catch (error) {
    if (process.env['NUMA_DEBUG']) {
      console.error(error);
    } else {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

/**
 * Get infrastructure flags from client config in DynamoDB.
 */
async function getInfrastructureFlags(env: EnvironmentConfig): Promise<InfrastructureFlags> {
  try {
    const dynamoClient = createDynamoDBClient(env);

    const response = await dynamoClient.send(
      new GetCommand({
        TableName: 'numa-client-config',
        Key: { clientName: env.clientName },
      })
    );

    if (!response.Item) {
      console.warn(`⚠️  No client config found for ${env.clientName}`);
      return {};
    }

    const clientConfig = clientConfigSchema.parse(response.Item);
    const flags: InfrastructureFlags = {};

    for (const flagName of INFRASTRUCTURE_FLAGS) {
      const value = clientConfig[flagName];
      let source = 'client-config';

      // Check if it's using default value
      if (value === undefined || value === false) {
        source = 'client-config-default';
      }

      flags[flagName] = {
        value: Boolean(value),
        source,
      };
    }

    return flags;
  } catch (error) {
    console.warn(`⚠️  Could not retrieve infrastructure flags: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/**
 * Get frontend configuration from S3.
 */
async function getFrontendConfig(env: EnvironmentConfig): Promise<FrontendConfig> {
  try {
    const s3 = createS3Client(env);
    const bucketName = `numa-${env.clientName}-fe`;

    const response = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: 'config.json',
      })
    );

    const configText = await response.Body?.transformToString();
    const config = JSON.parse(configText || '{}') as Record<string, unknown>;

    const flags: FrontendConfig = {};

    for (const flagName of FRONTEND_FLAGS) {
      if (flagName in config) {
        flags[flagName] = {
          value: config[flagName],
          source: 'config.json',
        };
      }
    }

    // Also extract some key config values
    const otherKeys = ['REGION', 'CLIENT_NAME', 'PREFERRED_KNOWLEDGE_BASE', 'NUMA_VERSION'];
    for (const key of otherKeys) {
      if (key in config) {
        flags[key] = {
          value: config[key],
          source: 'config.json',
        };
      }
    }

    return flags;
  } catch (error) {
    console.warn(`⚠️  Could not retrieve frontend config: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/**
 * Get Cognito group features.
 */
async function getCognitoGroupFeatures(env: EnvironmentConfig): Promise<UserFeatures> {
  try {
    const credentials = env.awsProfile ? fromIni({ profile: env.awsProfile }) : undefined;
    const cognito = new CognitoIdentityProviderClient({
      region: env.region,
      credentials,
    });

    if (!env.cognito?.userPoolId) {
      console.warn('⚠️  No Cognito user pool ID configured for this environment');
      return { groups: {} };
    }

    const groupsResponse = await cognito.send(
      new ListGroupsCommand({
        UserPoolId: env.cognito.userPoolId,
      })
    );

    const groups: { [groupName: string]: string[] } = {};

    if (groupsResponse.Groups) {
      for (const group of groupsResponse.Groups) {
        if (group.GroupName) {
          // Try to extract features from group description if it's JSON
          let features: string[] = [];
          if (group.Description) {
            try {
              const desc = JSON.parse(group.Description) as unknown;
              if (typeof desc === 'object' && desc !== null && 'features' in desc) {
                const featuresValue = (desc as { features: unknown }).features;
                if (Array.isArray(featuresValue)) {
                  features = featuresValue.filter((f): f is string => typeof f === 'string');
                }
              }
            } catch {
              // Description is not JSON, skip
            }
          }

          groups[group.GroupName] = features;
        }
      }
    }

    return { groups };
  } catch (error) {
    console.warn(`⚠️  Could not retrieve Cognito group features: ${error instanceof Error ? error.message : String(error)}`);
    return { groups: {} };
  }
}

/**
 * Get Lambda environment variables.
 */
async function getLambdaEnvironment(env: EnvironmentConfig): Promise<LambdaEnvironment> {
  const credentials = env.awsProfile ? fromIni({ profile: env.awsProfile }) : undefined;
  const lambda = new LambdaClient({
    region: env.region,
    credentials,
  });

  const result: LambdaEnvironment = {};

  for (const lambdaBase of KEY_LAMBDAS) {
    const functionName = `numa-${env.clientName}-${lambdaBase}`;

    try {
      const response = await lambda.send(
        new GetFunctionConfigurationCommand({
          FunctionName: functionName,
        })
      );

      if (response.Environment?.Variables) {
        const envVars: { [key: string]: string } = {};

        // Extract feature-related environment variables
        for (const envVar of FEATURE_ENV_VARS) {
          if (envVar in response.Environment.Variables) {
            envVars[envVar] = response.Environment.Variables[envVar] || '';
          }
        }

        if (Object.keys(envVars).length > 0) {
          result[lambdaBase] = envVars;
        }
      }
    } catch (error) {
      // Lambda might not exist, which is fine for optional features
      if (process.env['NUMA_DEBUG']) {
        console.warn(`⚠️  Could not inspect ${functionName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return result;
}

/**
 * Format output in table format.
 */
function formatTableOutput(flagData: FlagData): void {
  const { client, accountId, region, timestamp, flags } = flagData;

  console.log(`\n🏁 Feature Flags for Client: ${client}`);
  console.log(`Account: ${accountId} | Region: ${region} | Updated: ${new Date(timestamp).toLocaleString()}`);

  if (flags.infrastructure && Object.keys(flags.infrastructure).length > 0) {
    console.log('\n📋 INFRASTRUCTURE FLAGS (Source: DynamoDB client config)');
    for (const [flag, data] of Object.entries(flags.infrastructure)) {
      const icon = data.value ? '✅' : '❌';
      const status = data.value ? 'enabled' : 'disabled';
      const source = data.source === 'client-config-default' ? '(default)' : '';
      console.log(`  ${flag.padEnd(25)} ${icon} ${status} ${source}`);
    }
  }

  if (flags.frontend && Object.keys(flags.frontend).length > 0) {
    console.log('\n🌐 FRONTEND CONFIG (Source: config.json)');
    for (const [flag, data] of Object.entries(flags.frontend)) {
      let value: string;
      if (typeof data.value === 'boolean') {
        value = data.value ? '✅ true' : '❌ false';
      } else {
        value = `📄 ${String(data.value)}`;
      }
      console.log(`  ${flag.padEnd(25)} ${value}`);
    }
  }

  if (flags.userFeatures && Object.keys(flags.userFeatures.groups).length > 0) {
    console.log('\n👥 USER FEATURES (Source: Cognito groups)');
    for (const [groupName, features] of Object.entries(flags.userFeatures.groups)) {
      const featuresStr = features.length > 0 ? features.join(', ') : 'no features defined';
      console.log(`  ${groupName.padEnd(15)} → ${featuresStr}`);
    }
  }

  if (flags.lambda && Object.keys(flags.lambda).length > 0) {
    console.log('\n⚡ LAMBDA ENVIRONMENT');
    for (const [lambdaName, envVars] of Object.entries(flags.lambda)) {
      console.log(`\n  📦 ${lambdaName}:`);
      for (const [envVar, value] of Object.entries(envVars)) {
        const truncatedValue = value.length > 60 ? value.substring(0, 60) + '...' : value;
        console.log(`    ${envVar}: ${truncatedValue}`);
      }
    }
  }

  console.log('');
}
