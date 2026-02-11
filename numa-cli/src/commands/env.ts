/**
 * Environment management commands for Numa CLI.
 * Handles listing, switching, adding, and removing environments.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { fromIni, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  listEnvironments,
  setCurrentEnv,
  addEnvironment,
  removeEnvironment,
  getEnvironment,
  getDeployerProfile,
  getRolesConfig,
  getCurrentEnvName,
} from '../config.js';
import type { EnvironmentConfig, CognitoConfig } from '../types.js';

const CONFIG_TABLE = 'numa-client-config';

interface ClientConfigEntry {
  clientAccountId: string;
  region: string;
  [key: string]: unknown;
}

/**
 * Load available clients from DynamoDB and clientConfigProd.json
 */
async function loadAvailableClients(): Promise<Record<string, ClientConfigEntry>> {
  const localClients = loadLocalClients();

  try {
    // Use the deployer profile for DynamoDB access
    const credentials = fromIni({ profile: getDeployerProfile() });

    const client = new DynamoDBClient({ region: 'us-east-1', credentials });
    const docClient = DynamoDBDocumentClient.from(client);

    const result = await docClient.send(new ScanCommand({ TableName: CONFIG_TABLE }));

    const dynamoClients: Record<string, ClientConfigEntry> = {};
    for (const item of result.Items ?? []) {
      const clientName = item['clientName'] as string | undefined;
      const config = item['config'] as ClientConfigEntry | undefined;
      if (clientName && config) {
        dynamoClients[clientName] = config;
      }
    }

    // Merge: DynamoDB configs + local JSON (local takes precedence)
    return { ...dynamoClients, ...localClients };
  } catch {
    // Fall back to local JSON file if DynamoDB access fails
    return localClients;
  }
}

/**
 * Load clients from local clientConfigProd.json only (fallback)
 */
function loadLocalClients(): Record<string, ClientConfigEntry> {
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    return {};
  }

  const configPath = join(repoRoot, 'clientConfigProd.json');
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as Record<string, ClientConfigEntry>;
  } catch {
    return {};
  }
}

/**
 * Fetch Cognito configuration from the client's AWS account.
 * Uses role assumption to access the client account.
 */
async function fetchCognitoConfig(
  clientName: string,
  accountId: string,
  region: string
): Promise<CognitoConfig | undefined> {
  try {
    // Chain: deployer profile → ArcanumAIAccess in client account
    const deployerCredentials = fromIni({ profile: getDeployerProfile() });
    const credentials = fromTemporaryCredentials({
      masterCredentials: deployerCredentials,
      params: {
        RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
        RoleSessionName: 'numa-cli-cognito',
      },
    });

    const cognitoClient = new CognitoIdentityProviderClient({ region, credentials });

    // List user pools and find the one for this client
    // Numa user pools are named: numa-{clientName} (prod) or numa-{clientName}-{env} (non-prod)
    const expectedPoolName = `numa-${clientName}`;

    const poolsResponse = await cognitoClient.send(
      new ListUserPoolsCommand({ MaxResults: 60 })
    );

    const userPool = poolsResponse.UserPools?.find(
      pool => pool.Name === expectedPoolName
    );

    if (!userPool?.Id) {
      console.warn(`Warning: Could not find user pool '${expectedPoolName}'`);
      return undefined;
    }

    // List user pool clients
    const clientsResponse = await cognitoClient.send(
      new ListUserPoolClientsCommand({
        UserPoolId: userPool.Id,
        MaxResults: 10,
      })
    );

    // Find the web client (usually named numa-{clientName}-web-client or similar)
    const webClient = clientsResponse.UserPoolClients?.find(
      c => c.ClientName?.includes('web') || c.ClientName?.includes('frontend')
    ) ?? clientsResponse.UserPoolClients?.[0];

    if (!webClient?.ClientId) {
      console.warn('Warning: Could not find user pool client');
      return undefined;
    }

    return {
      userPoolId: userPool.Id,
      clientId: webClient.ClientId,
      region,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.warn(`Warning: Could not fetch Cognito config: ${error.message}`);
    }
    return undefined;
  }
}

// Find the repo root by looking for clientConfigProd.json
function findRepoRoot(): string | undefined {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);

  // Walk up looking for clientConfigProd.json
  for (let i = 0; i < 10; i++) {
    const configPath = join(dir, 'clientConfigProd.json');
    if (existsSync(configPath)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

/**
 * Create the env command with all subcommands.
 */
export function createEnvCommand(): Command {
  const env = new Command('env')
    .description('Manage Numa environments');

  // List environments
  env
    .command('list')
    .alias('ls')
    .description('List all configured and available environments')
    .option('-a, --all', 'Show all available environments')
    .action(async (options: { all?: boolean }) => {
      const configuredEnvs = listEnvironments();
      const availableClients = await loadAvailableClients();
      const configuredClientNames = new Set(configuredEnvs.map(e => e.config.clientName));

      // Show configured environments
      if (configuredEnvs.length > 0) {
        console.log('Configured environments:');
        console.log('');

        for (const e of configuredEnvs) {
          const marker = e.isCurrent ? '* ' : '  ';
          const profile = e.config.awsProfile ? ` (profile: ${e.config.awsProfile})` : '';
          console.log(`${marker}${e.name}`);
          console.log(`    Client: ${e.config.clientName}`);
          console.log(`    Account: ${e.config.clientAccountId}`);
          console.log(`    Region: ${e.config.region}${profile}`);
          console.log('');
        }

        if (!configuredEnvs.some(e => e.isCurrent)) {
          console.log('No environment selected. Use "numa env use <name>" to select one.');
          console.log('');
        }
      }

      // Show available (not yet configured) environments
      const availableNames = Object.keys(availableClients).filter(
        name => !configuredClientNames.has(name)
      );

      if (options.all || configuredEnvs.length === 0) {
        if (availableNames.length > 0) {
          console.log('Available environments:');
          console.log('');

          for (const name of availableNames.sort()) {
            const client = availableClients[name];
            if (client) {
              console.log(`  ${name}`);
              console.log(`    Account: ${client.clientAccountId}`);
              console.log(`    Region: ${client.region}`);
              console.log('');
            }
          }

          console.log('Add with: numa env add <alias> --from <client-name>');
          console.log('Or quick-add: numa env use <client-name>');
        }
      } else if (availableNames.length > 0) {
        console.log(`${availableNames.length} more environments available. Use "numa env ls -a" to see all.`);
      }

      if (configuredEnvs.length === 0 && availableNames.length === 0) {
        console.log('No environments found.');
        console.log('');
        console.log('Add an environment with:');
        console.log('  numa env add <name> --client <clientName> --account <accountId> --region <region>');
      }
    });

  // Use/switch environment
  env
    .command('use <name>')
    .description('Switch to an environment (auto-adds from config if needed)')
    .action(async (name: string) => {
      const availableClients = await loadAvailableClients();

      // Check if it's already configured
      let envConfig = getEnvironment(name);

      if (!envConfig) {
        // Check if it's a client name from available configs
        const clientConfig = availableClients[name];
        if (clientConfig) {
          // Auto-add the environment
          envConfig = {
            clientName: name,
            clientAccountId: clientConfig.clientAccountId,
            region: clientConfig.region,
          };
          // Auto-set awsProfile if a matching client profile exists in roles config
          const rolesConfig = getRolesConfig();
          if (rolesConfig) {
            const matchingProfile = Object.entries(rolesConfig.profiles).find(
              ([profileName, meta]) => meta.category === 'client' && profileName === name
            );
            if (matchingProfile) {
              envConfig.awsProfile = matchingProfile[0];
            }
          }

          // Fetch Cognito config from AWS
          console.log('Fetching Cognito configuration...');
          const cognitoConfig = await fetchCognitoConfig(
            name,
            clientConfig.clientAccountId,
            clientConfig.region
          );
          if (cognitoConfig) {
            envConfig.cognito = cognitoConfig;
            console.log('Cognito configuration retrieved successfully');
          }

          addEnvironment(name, envConfig);
          console.log(`Added environment: ${name}`);
        } else {
          console.error(`Error: Environment '${name}' not found.`);
          console.error('');
          console.error('Run "numa env ls -a" to see available environments.');
          process.exit(1);
        }
      }

      try {
        setCurrentEnv(name);
        console.log(`Switched to environment: ${name}`);
        if (envConfig) {
          console.log(`  Client: ${envConfig.clientName}`);
          console.log(`  Account: ${envConfig.clientAccountId}`);
          console.log(`  Region: ${envConfig.region}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  // Add environment
  env
    .command('add <name>')
    .description('Add a new environment')
    .option('-f, --from <clientName>', 'Import from available configs by client name')
    .option('-c, --client <clientName>', 'Client name (e.g., arcanum-demo-tony)')
    .option('-a, --account <accountId>', 'AWS account ID')
    .option('-r, --region <region>', 'AWS region (e.g., us-east-1)')
    .option('-p, --profile <profile>', 'AWS CLI profile to use')
    .option('--use', 'Switch to this environment after adding')
    .action(async (name: string, options: {
      from?: string;
      client?: string;
      account?: string;
      region?: string;
      profile?: string;
      use?: boolean;
    }) => {
      // Check if environment already exists
      const existing = getEnvironment(name);
      if (existing) {
        console.error(`Error: Environment '${name}' already exists.`);
        console.error('Use a different name or remove it first with "numa env remove".');
        process.exit(1);
      }

      let envConfig: EnvironmentConfig;

      if (options.from) {
        // Import from available configs
        const availableClients = await loadAvailableClients();
        const clientConfig = availableClients[options.from];

        if (!clientConfig) {
          console.error(`Error: Client '${options.from}' not found.`);
          console.error('Run "numa env ls -a" to see available clients.');
          process.exit(1);
        }

        envConfig = {
          clientName: options.from,
          clientAccountId: clientConfig.clientAccountId,
          region: clientConfig.region,
          awsProfile: options.profile,
        };

        // Fetch Cognito config from AWS
        console.log('Fetching Cognito configuration...');
        const cognitoConfig = await fetchCognitoConfig(
          options.from,
          clientConfig.clientAccountId,
          clientConfig.region
        );
        if (cognitoConfig) {
          envConfig.cognito = cognitoConfig;
          console.log('Cognito configuration retrieved successfully');
        }
      } else {
        // Manual configuration
        if (!options.client || !options.account || !options.region) {
          console.error('Error: --client, --account, and --region are required.');
          console.error('Or use --from <clientName> to import from available configs.');
          process.exit(1);
        }

        envConfig = {
          clientName: options.client,
          clientAccountId: options.account,
          region: options.region,
          awsProfile: options.profile,
        };
      }

      addEnvironment(name, envConfig);
      console.log(`Added environment: ${name}`);
      console.log(`  Client: ${envConfig.clientName}`);
      console.log(`  Account: ${envConfig.clientAccountId}`);
      console.log(`  Region: ${envConfig.region}`);
      if (envConfig.awsProfile) {
        console.log(`  Profile: ${envConfig.awsProfile}`);
      }

      if (options.use) {
        setCurrentEnv(name);
        console.log('');
        console.log(`Switched to environment: ${name}`);
      }
    });

  // Remove environment
  env
    .command('remove <name>')
    .alias('rm')
    .description('Remove an environment')
    .option('-f, --force', 'Skip confirmation')
    .action((name: string, options: { force?: boolean }) => {
      const existing = getEnvironment(name);
      if (!existing) {
        console.error(`Error: Environment '${name}' not found.`);
        process.exit(1);
      }

      if (!options.force) {
        console.log(`Removing environment: ${name}`);
        console.log(`  Client: ${existing.clientName}`);
        console.log(`  Account: ${existing.clientAccountId}`);
        console.log('');
        console.log('Use --force to skip this confirmation.');
        process.exit(0);
      }

      try {
        removeEnvironment(name);
        console.log(`Removed environment: ${name}`);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  // Refresh Cognito config for an environment
  env
    .command('refresh [name]')
    .description('Re-fetch Cognito configuration from AWS for an environment')
    .action(async (name?: string) => {
      const targetName = name ?? getCurrentEnvName();
      if (!targetName) {
        console.error('Error: No environment specified and no current environment set.');
        console.error('Run "numa env use <name>" first or specify an environment name.');
        process.exit(1);
      }

      const envConfig = getEnvironment(targetName);
      if (!envConfig) {
        console.error(`Error: Environment '${targetName}' not found.`);
        process.exit(1);
      }

      console.log(`Refreshing Cognito configuration for: ${targetName}`);
      const cognitoConfig = await fetchCognitoConfig(
        envConfig.clientName,
        envConfig.clientAccountId,
        envConfig.region
      );

      if (cognitoConfig) {
        envConfig.cognito = cognitoConfig;
        addEnvironment(targetName, envConfig);
        console.log('Cognito configuration updated successfully');
        console.log(`  User Pool ID: ${cognitoConfig.userPoolId}`);
        console.log(`  Client ID: ${cognitoConfig.clientId}`);
      } else {
        console.error('Failed to fetch Cognito configuration.');
        process.exit(1);
      }
    });

  // Show current environment
  env
    .command('current')
    .description('Show the current environment')
    .action(() => {
      const envs = listEnvironments();
      const current = envs.find(e => e.isCurrent);

      if (!current) {
        console.log('No environment selected.');
        console.log('Use "numa env use <name>" to select one.');
        process.exit(1);
      }

      console.log(`Current environment: ${current.name}`);
      console.log(`  Client: ${current.config.clientName}`);
      console.log(`  Account: ${current.config.clientAccountId}`);
      console.log(`  Region: ${current.config.region}`);
      if (current.config.awsProfile) {
        console.log(`  Profile: ${current.config.awsProfile}`);
      }
      if (current.config.cognito) {
        console.log(`  Cognito: configured`);
        console.log(`    User Pool: ${current.config.cognito.userPoolId}`);
        console.log(`    Client ID: ${current.config.cognito.clientId}`);
      } else {
        console.log(`  Cognito: not configured (run "numa env refresh" to fetch)`);
      }
    });

  return env;
}
