import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProvider,
  ListUserPoolsCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import fs from 'node:fs/promises';
import { argv } from 'node:process';
import { AWSClientConfig, BasicClientConfig, temporaryCredentials } from './utils';
import { getClientConfig, listClients } from '@arcanumai/client-config';

function getGetCommandLineFlags(): { isDevOnly: boolean; shouldFix: boolean } {
  const args = argv.slice(2);
  return {
    isDevOnly: args.includes('--dev'),
    shouldFix: args.includes('--fix'),
  };
}

interface UnverifiedUser {
  username: string;
  userPoolId: string;
  email: string;
}

interface ClientResult {
  clientName: string;
  accountId: string;
  unverifiedUsers: UnverifiedUser[];
  error?: string;
}

interface ReportSummary {
  timestamp: string;
  summary: {
    totalClients: number;
    processedClients: number;
    errorClients: number;
    clientsWithUnverifiedEmails: number;
    totalUnverifiedUsers: number;
  };
  results: ClientResult[];
}

export async function fixUserEmailVerification(
  awsClientConfig: AWSClientConfig,
  userPoolId: string,
  username: string,
  currentEmail: string
): Promise<void> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);

  try {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          {
            Name: 'email_verified',
            Value: 'true',
          },
        ],
      })
    );
    console.log(`Fixed email verification for ${username}: ${currentEmail}`);
  } catch (error) {
    console.error(`Error fixing email verification for ${username}:`, error);
    throw error;
  }
}

export async function findUnverifiedUsers(
  awsClientConfig: AWSClientConfig,
  userPoolId: string
): Promise<UnverifiedUser[]> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);
  const unverifiedUsers: UnverifiedUser[] = [];

  try {
    let paginationToken: string | undefined;

    do {
      const response = await cognito.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Limit: 60,
          PaginationToken: paginationToken,
        })
      );

      if (response.Users) {
        for (const user of response.Users) {
          const emailAttr = user.Attributes?.find((attr) => attr.Name === 'email');
          const email = emailAttr?.Value;
          const emailVerifiedAttr = user.Attributes?.find((attr) => attr.Name === 'email_verified');
          const emailVerified = emailVerifiedAttr?.Value === 'true';
          if (email && !emailVerified) {
            unverifiedUsers.push({
              username: user.Username,
              userPoolId,
              email,
            });
          }
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return unverifiedUsers;
  } catch (error) {
    console.error('Error checking users:', error);
    throw error;
  }
}

export async function fixUnverifiedUsers(awsClientConfig: AWSClientConfig, users: UnverifiedUser[]): Promise<void> {
  for (const user of users) {
    try {
      await fixUserEmailVerification(awsClientConfig, user.userPoolId, user.username, user.email);
    } catch (error) {
      console.error(`Error fixing user ${user.username}:`, error);
    }
  }
}

export async function findUserPoolId(awsClientConfig: AWSClientConfig, clientName: string): Promise<string> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);

  try {
    const response = await cognito.send(
      new ListUserPoolsCommand({
        MaxResults: 60,
      })
    );

    const userPool = response.UserPools?.find((pool) => pool.Name === `numa-${clientName}`);
    if (!userPool) {
      throw new Error(`User pool numa-${clientName} not found`);
    }
    return userPool.Id;
  } catch (error) {
    console.error('Error finding user pool:', error);
    throw error;
  }
}

async function checkClient(clientName: string, shouldFix = false): Promise<ClientResult> {
  console.log(`\nChecking Cognito users for ${clientName}...`);

  const result: ClientResult = {
    clientName,
    accountId: '',
    unverifiedUsers: [],
  };
  const clientConfig = await getClientConfig<BasicClientConfig>(clientName);

  const accountId = clientConfig.clientAccountId;
  if (!accountId) {
    console.error(`Account ID for ${clientName} not found in configuration`);
    result.error = 'Configuration error: Account ID not found in configuration';
    return result;
  }

  result.accountId = accountId;

  const awsClientConfig = {
    region: clientConfig.region,
    credentials: temporaryCredentials(accountId),
  };

  try {
    const userPoolId = await findUserPoolId(awsClientConfig, clientName);
    const unverifiedUsers = await findUnverifiedUsers(awsClientConfig, userPoolId);
    result.unverifiedUsers = unverifiedUsers;

    if (shouldFix && unverifiedUsers.length > 0) {
      await fixUnverifiedUsers(awsClientConfig, unverifiedUsers);
    }

    if (unverifiedUsers.length > 0) {
      console.log(`Found ${unverifiedUsers.length} unverified users`);
      unverifiedUsers.forEach((user) => {
        console.log(`- ${user.username}: ${user.email}`);
      });
    } else {
      console.log('No unverified users found');
    }

    return result;
  } catch (error) {
    console.error(`Error processing ${clientName}:`, error);
    result.error = `Error: ${error.message || 'Unknown error'}`;
    return result;
  }
}

export async function processClients(config?: { isDevOnly?: boolean; shouldFix?: boolean }): Promise<ReportSummary> {
  const { isDevOnly, shouldFix } = config ?? getGetCommandLineFlags();

  let clientNames = await listClients();

  console.log(`Checking Cognito users for ${clientNames.length} clients...`);
  if (isDevOnly) {
    console.log('Filtering for dev instances only');
  }

  const results: ClientResult[] = [];
  let errorCount = 0;

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
        unverifiedUsers: [],
        error: `Fatal error: ${error.message || 'Unknown error'}`,
      });
    }
  }

  const clientsWithUnverifiedEmails = results.filter((r) => r.unverifiedUsers.length > 0).length;
  const totalUnverifiedUsers = results.reduce((sum, r) => sum + r.unverifiedUsers.length, 0);

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalClients: clientNames.length,
      processedClients: results.length,
      errorClients: errorCount,
      clientsWithUnverifiedEmails: clientsWithUnverifiedEmails,
      totalUnverifiedUsers: totalUnverifiedUsers,
    },
    results,
  };
}

async function handleSingleClient(clientName: string, accountId: string, region: string): Promise<void> {
  const awsClientConfig = {
    credentials: temporaryCredentials(accountId),
    region,
  };

  const { isDevOnly, shouldFix } = getGetCommandLineFlags();

  console.log(`Checking Cognito users for ${clientName}...`);
  if (isDevOnly) {
    console.log('Running in dev instance mode');
  }
  if (shouldFix) {
    console.log('Running in fix mode - will veirfiy emails');
  }

  try {
    const userPoolId = await findUserPoolId(awsClientConfig, clientName);
    const unverifiedUsers = await findUnverifiedUsers(awsClientConfig, userPoolId);

    if (unverifiedUsers.length === 0) {
      console.log('No unverified users found');
      process.exit(0);
    }

    console.log(`\nFound ${unverifiedUsers.length} unverified users:`);
    unverifiedUsers.forEach((user) => {
      console.log(`- ${user.username}: ${user.email}`);
    });

    if (shouldFix) {
      await fixUnverifiedUsers(awsClientConfig, unverifiedUsers);
      console.log('\nAll emails have been verified');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

async function handleMultipleClients(): Promise<void> {
  try {
    const report = await processClients();

    // Save JSON report
    await fs.writeFile('email-verification-report.json', JSON.stringify(report, null, 2));
    console.log(`\nReport saved to email-verification-report.json`);

    // Print summary
    const { summary } = report;
    console.log(`\n==========================================`);
    console.log(`Summary Report (${new Date(report.timestamp).toLocaleString()})`);
    console.log(`==========================================`);
    console.log(`Total clients: ${summary.totalClients}`);
    console.log(`Successfully processed: ${summary.processedClients - summary.errorClients}/${summary.totalClients}`);
    console.log(`Clients with unverified emails: ${summary.clientsWithUnverifiedEmails}/${summary.totalClients}`);
    console.log(`Total users with unverified emails: ${summary.totalUnverifiedUsers}`);

    if (summary.errorClients > 0) {
      console.log(`\nClients with errors (${summary.errorClients}):`);
      report.results.filter((r) => r.error).forEach((r) => console.log(`- ${r.clientName}: ${r.error}`));
    }

    if (summary.totalUnverifiedUsers > 0) {
      console.log(`\nClients with unverified emails:`);
      report.results
        .filter((r) => r.unverifiedUsers.length > 0)
        .forEach((r) => {
          console.log(`\n${r.clientName}:`);
          r.unverifiedUsers.forEach((user) => console.log(`- ${user.username}: ${user.email}`));
        });
    }
  } catch (error) {
    console.error('Fatal error:', error);
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

    const { isDevOnly } = getGetCommandLineFlags();
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
