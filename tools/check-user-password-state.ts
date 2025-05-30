import {
  AdminSetUserPasswordCommand,
  CognitoIdentityProvider,
  ListUserPoolsCommand,
  ListUsersCommand,
  UserStatusType,
} from '@aws-sdk/client-cognito-identity-provider';
import fs from 'node:fs/promises';
import { argv } from 'node:process';
import { AWSClientConfig, BasicClientConfig, temporaryCredentials } from './utils';
import { getClientConfig, listClients } from '@arcanumai/client-config';
import { AwsCredentialIdentityProvider } from '@smithy/types';

// Function to get credentials for accessing customer accounts
function getClientCredentials(accountId: string): AwsCredentialIdentityProvider {
  return temporaryCredentials(accountId);
}

function getCommandLineFlags(): { isDevOnly: boolean; shouldFix: boolean } {
  const args = argv.slice(2);
  return {
    isDevOnly: args.includes('--dev'),
    shouldFix: args.includes('--fix'),
  };
}

interface PasswordResetUser {
  username: string;
  userPoolId: string;
  email: string;
  status: UserStatusType;
}

interface ClientResult {
  clientName: string;
  accountId: string;
  passwordResetUsers: PasswordResetUser[];
  error?: string;
}

interface ReportSummary {
  timestamp: string;
  summary: {
    totalClients: number;
    processedClients: number;
    errorClients: number;
    clientsWithPasswordResetUsers: number;
    totalPasswordResetUsers: number;
  };
  results: ClientResult[];
}

export async function fixUserPasswordState(
  awsClientConfig: AWSClientConfig,
  userPoolId: string,
  username: string,
): Promise<void> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);
  const temporaryPassword = generateSecurePassword();

  try {
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
        Password: temporaryPassword,
        Permanent: true,
      }),
    );
    console.log(`Set new permanent password for ${username}`);
  } catch (error) {
    console.error(`Error fixing password state for ${username}: ${formatError(error)}`);
    throw error;
  }
}

function generateSecurePassword(): string {
  // Generate random 64 character password with uppercase, lowercase, numbers, and special chars
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
  let password = '';
  for (let i = 0; i < 64; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function findPasswordResetUsers(
  awsClientConfig: AWSClientConfig,
  userPoolId: string,
): Promise<PasswordResetUser[]> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);
  const passwordResetUsers: PasswordResetUser[] = [];

  try {
    let paginationToken: string | undefined;

    do {
      const response = await cognito.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Limit: 60,
          PaginationToken: paginationToken,
        }),
      );

      if (response.Users) {
        for (const user of response.Users) {
          if (user.UserStatus === 'FORCE_CHANGE_PASSWORD') {
            const emailAttr = user.Attributes?.find((attr) => attr.Name === 'email');
            const email = emailAttr?.Value || 'No email found';

            passwordResetUsers.push({
              username: user.Username,
              userPoolId,
              email,
              status: user.UserStatus,
            });
          }
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return passwordResetUsers;
  } catch (error) {
    console.error(`Error checking users: ${formatError(error)}`);
    throw error;
  }
}

export async function fixPasswordResetUsers(
  awsClientConfig: AWSClientConfig,
  users: PasswordResetUser[],
): Promise<void> {
  for (const user of users) {
    try {
      await fixUserPasswordState(awsClientConfig, user.userPoolId, user.username);
    } catch (error) {
      console.error(`Error fixing user ${user.username}: ${formatError(error)}`);
    }
  }
}

export async function findUserPoolId(awsClientConfig: AWSClientConfig, clientName: string): Promise<string> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);

  try {
    const response = await cognito.send(
      new ListUserPoolsCommand({
        MaxResults: 60,
      }),
    );

    const userPool = response.UserPools?.find((pool) => pool.Name === `numa-${clientName}`);
    if (!userPool) {
      throw new Error(`User pool numa-${clientName} not found`);
    }
    return userPool.Id;
  } catch (error) {
    console.error(`Error finding user pool: ${formatError(error)}`);
    throw error;
  }
}

// Helper function to format error messages
function formatError(error: unknown): string {
  if (error && typeof error === 'object' && '$fault' in error && 'Code' in error) {
    if (error.$fault === 'client' && error.Code === 'AccessDenied') {
      return 'Access Denied - check your AWS credentials and permissions';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

// Helper function to temporarily switch AWS profile
// Added since the change with the location of client configs wasn't supported by the existing
// temporary credentials getting
async function withDeployerProfile<T>(fn: () => Promise<T>): Promise<T> {
  const originalProfile = process.env.AWS_PROFILE;
  process.env.AWS_PROFILE = 'arcanum-q-deployer-prod';
  try {
    return await fn();
  } finally {
    if (originalProfile) {
      process.env.AWS_PROFILE = originalProfile;
    } else {
      delete process.env.AWS_PROFILE;
    }
  }
}

async function checkClient(clientName: string, shouldFix = false): Promise<ClientResult> {
  console.log(`\nChecking Cognito users for ${clientName}...`);

  const result: ClientResult = {
    clientName,
    accountId: '',
    passwordResetUsers: [],
  };
  const clientConfig = await getClientConfig<BasicClientConfig>(clientName);

  const accountId = clientConfig.clientAccountId;
  if (!accountId) {
    console.error(`Account ID for ${clientName} not found in configuration`);
    result.error = 'Configuration error: Account ID not found in configuration';
    return result;
  }

  result.accountId = accountId;

  const awsClientConfigBase = {
    region: clientConfig.region,
  };

  try {
    // All AWS SDK calls for this client should use the deployer profile
    return await withDeployerProfile(async () => {
      const awsClientConfig = {
        ...awsClientConfigBase,
        credentials: getClientCredentials(accountId),
      };
      const userPoolId = await findUserPoolId(awsClientConfig, clientName);
      const passwordResetUsers = await findPasswordResetUsers(awsClientConfig, userPoolId);
      result.passwordResetUsers = passwordResetUsers;

      if (shouldFix && passwordResetUsers.length > 0) {
        await fixPasswordResetUsers(awsClientConfig, passwordResetUsers);
      }

      if (passwordResetUsers.length > 0) {
        console.log(`Found ${passwordResetUsers.length} users with FORCE_CHANGE_PASSWORD status`);
        passwordResetUsers.forEach((user) => {
          console.log(`- ${user.username}: ${user.email}`);
        });
      } else {
        console.log('No users with FORCE_CHANGE_PASSWORD status found');
      }
      return result;
    });
  } catch (error) {
    console.error(`Error processing ${clientName}: ${formatError(error)}`);
    result.error = `Error: ${formatError(error)}`;
    return result;
  }
}

export async function processClients(config?: { isDevOnly?: boolean; shouldFix?: boolean }): Promise<ReportSummary> {
  const { isDevOnly, shouldFix } = config ?? getCommandLineFlags();

  // First, list clients using the default credentials (not the deployer)
  let clientNames = await listClients();

  console.log(clientNames);

  console.log(`Checking Cognito users for ${clientNames.length} clients...`);
  if (isDevOnly) {
    console.log('Filtering for dev instances only');
  }

  const results: ClientResult[] = [];
  let errorCount = 0;

  try {
    for (const clientName of clientNames) {
      const clientConfig = await getClientConfig<BasicClientConfig>(clientName);
      if (isDevOnly && !clientConfig.devInstance) {
        continue;
      }
      try {
        const result = await checkClient(clientName, shouldFix);
        results.push(result);
        // Only count errors from actual processing, not configuration issues
        if (result.error && !result.error.includes('configuration')) {
          errorCount++;
        }
      } catch (error) {
        errorCount++;
        results.push({
          clientName,
          accountId: clientConfig.clientAccountId || '',
          passwordResetUsers: [],
          error: `Fatal error: ${formatError(error)}`,
        });
      }
    }
  } catch (error) {
    console.error(`Error processing clients: ${formatError(error)}`);
    process.exit(1);
  }

  const clientsWithPasswordResetUsers = results.filter((r) => r.passwordResetUsers.length > 0).length;
  const totalPasswordResetUsers = results.reduce((sum, r) => sum + r.passwordResetUsers.length, 0);

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalClients: clientNames.length,
      processedClients: results.length,
      errorClients: errorCount,
      clientsWithPasswordResetUsers,
      totalPasswordResetUsers,
    },
    results,
  };
}

async function handleSingleClient(clientName: string, accountId: string, region: string): Promise<void> {
  const awsClientConfigBase = {
    region,
  };

  const { isDevOnly, shouldFix } = getCommandLineFlags();

  console.log(`Checking Cognito users for ${clientName}...`);
  if (isDevOnly) {
    console.log('Running in dev instance mode');
  }
  if (shouldFix) {
    console.log('Running in fix mode - will set permanent passwords');
  }

  try {
    // All AWS SDK calls for this client should use the deployer profile
    await withDeployerProfile(async () => {
      const awsClientConfig = {
        ...awsClientConfigBase,
        credentials: getClientCredentials(accountId),
      };
      const userPoolId = await findUserPoolId(awsClientConfig, clientName);
      const passwordResetUsers = await findPasswordResetUsers(awsClientConfig, userPoolId);

      if (passwordResetUsers.length === 0) {
        console.log('No users with FORCE_CHANGE_PASSWORD status found');
        return;
      }

      console.log(`\nFound ${passwordResetUsers.length} users with FORCE_CHANGE_PASSWORD status:`);
      passwordResetUsers.forEach((user) => {
        console.log(`- ${user.username}: ${user.email}`);
      });

      if (shouldFix) {
        await fixPasswordResetUsers(awsClientConfig, passwordResetUsers);
        console.log('\nAll users have been fixed');
      }
    });
  } catch (error) {
    console.error(`Error: ${formatError(error)}`);
    process.exit(1);
  }
}

async function handleMultipleClients(): Promise<void> {
  try {
    const report = await processClients();

    // Save JSON report
    await fs.writeFile('password-state-report.json', JSON.stringify(report, null, 2));
    console.log(`\nReport saved to password-state-report.json`);

    // Print summary
    const { summary } = report;
    console.log(`\n==========================================`);
    console.log(`Summary Report (${new Date(report.timestamp).toLocaleString()})`);
    console.log(`==========================================`);
    console.log(`Total clients: ${summary.totalClients}`);
    console.log(`Successfully processed: ${summary.processedClients - summary.errorClients}/${summary.totalClients}`);
    console.log(
      `Clients with users in FORCE_CHANGE_PASSWORD state: ${summary.clientsWithPasswordResetUsers}/${summary.totalClients}`,
    );
    console.log(`Total users in FORCE_CHANGE_PASSWORD state: ${summary.totalPasswordResetUsers}`);

    if (summary.errorClients > 0) {
      console.log(`\nClients with errors (${summary.errorClients}):`);
      report.results.filter((r) => r.error).forEach((r) => console.log(`- ${r.clientName}: ${r.error}`));
    }

    if (summary.totalPasswordResetUsers > 0) {
      console.log(`\nClients with users in FORCE_CHANGE_PASSWORD state:`);
      report.results
        .filter((r) => r.passwordResetUsers.length > 0)
        .forEach((r) => {
          console.log(`\n${r.clientName}:`);
          r.passwordResetUsers.forEach((user) => console.log(`- ${user.username}: ${user.email}`));
        });
    }
  } catch (error) {
    console.error(`Fatal error: ${formatError(error)}`);
    process.exit(1);
  }
}

// Main function
if (import.meta.filename === process?.argv[1]) {
  const args = argv.slice(2);
  const clientName = args.find((arg) => !arg.startsWith('--'));

  if (clientName && !args.includes('--all')) {
    const clientConfig = await getClientConfig<BasicClientConfig>(clientName);
    const accountId = clientConfig.clientAccountId;
    if (!accountId) {
      console.error(`Client ${clientName} not found in configuration`);
      process.exit(1);
    }

    const { isDevOnly } = getCommandLineFlags();
    if (isDevOnly && !clientConfig.devInstance) {
      console.error(`Client ${clientName} is not a dev instance`);
      process.exit(1);
    }

    const region = clientConfig.region;
    await handleSingleClient(clientName, accountId, region);
  } else {
    await handleMultipleClients();
  }
}
