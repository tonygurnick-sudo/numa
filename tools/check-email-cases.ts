import { argv } from 'node:process';
import fs from 'node:fs/promises';
import {
  CognitoIdentityProvider,
  ListUsersCommand,
  ListUserPoolsCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { temporaryCredentials } from './utils';
import clientConfigProd from '../clientConfigProd.json';

const region = 'us-east-1';

// Get command line flags
function getFlags(): { isDevOnly: boolean; shouldFix: boolean } {
  const args = argv.slice(2);
  return {
    isDevOnly: args.includes('--dev'),
    shouldFix: args.includes('--fix'),
  };
}

interface UserWithCapital {
  username: string;
  userPoolId: string;
  email: string;
}

interface ClientResult {
  clientName: string;
  accountId: string;
  usersWithCapital: UserWithCapital[];
  error?: string;
}

interface ReportSummary {
  timestamp: string;
  summary: {
    totalClients: number;
    processedClients: number;
    errorClients: number;
    clientsWithCapitalEmails: number;
    totalUsersWithCapital: number;
  };
  results: ClientResult[];
}

export async function fixUserEmail(
  credentials: AwsCredentialIdentityProvider,
  userPoolId: string,
  username: string,
  currentEmail: string,
): Promise<void> {
  const cognito = new CognitoIdentityProvider({ region, credentials });
  const lowercaseEmail = currentEmail.toLowerCase();

  try {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          {
            Name: 'email',
            Value: lowercaseEmail,
          },
        ],
      }),
    );
    console.log(`Fixed email case for ${username}: ${currentEmail} -> ${lowercaseEmail}`);
  } catch (error) {
    console.error(`Error fixing email case for ${username}:`, error);
    throw error;
  }
}

export async function findUsersWithCapital(
  credentials: AwsCredentialIdentityProvider,
  userPoolId: string,
): Promise<UserWithCapital[]> {
  const cognito = new CognitoIdentityProvider({ region, credentials });
  const usersWithCapital: UserWithCapital[] = [];

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
          const emailAttr = user.Attributes?.find((attr) => attr.Name === 'email');
          const email = emailAttr?.Value;
          if (email && /[A-Z]/.test(email)) {
            usersWithCapital.push({
              username: user.Username,
              userPoolId,
              email,
            });
          }
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return usersWithCapital;
  } catch (error) {
    console.error('Error checking users:', error);
    throw error;
  }
}

export async function fixUsersWithCapital(
  credentials: AwsCredentialIdentityProvider,
  users: UserWithCapital[],
): Promise<void> {
  for (const user of users) {
    try {
      await fixUserEmail(credentials, user.userPoolId, user.username, user.email);
    } catch (error) {
      console.error(`Error fixing user ${user.username}:`, error);
    }
  }
}

export async function findUserPoolId(credentials: AwsCredentialIdentityProvider, clientName: string): Promise<string> {
  const cognito = new CognitoIdentityProvider({ region, credentials });

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
    console.error('Error finding user pool:', error);
    throw error;
  }
}

async function checkClient(clientName: string, shouldFix = false): Promise<ClientResult> {
  console.log(`\nChecking Cognito users for ${clientName}...`);

  const result: ClientResult = {
    clientName,
    accountId: '',
    usersWithCapital: [],
  };

  if (!clientConfigProd[clientName]) {
    console.error(`Client ${clientName} not found in configuration`);
    result.error = 'Configuration error: Client not found in configuration';
    return result;
  }

  const accountId = clientConfigProd[clientName].clientAccountId;
  if (!accountId) {
    console.error(`Account ID for ${clientName} not found in configuration`);
    result.error = 'Configuration error: Account ID not found in configuration';
    return result;
  }

  result.accountId = accountId;
  const credentials = temporaryCredentials(accountId);

  try {
    const userPoolId = await findUserPoolId(credentials, clientName);
    const usersWithCapital = await findUsersWithCapital(credentials, userPoolId);
    result.usersWithCapital = usersWithCapital;

    if (shouldFix && usersWithCapital.length > 0) {
      await fixUsersWithCapital(credentials, usersWithCapital);
    }

    if (usersWithCapital.length > 0) {
      console.log(`Found ${usersWithCapital.length} users with capital letters in their email`);
      usersWithCapital.forEach((user) => {
        console.log(`- ${user.username}`);
      });
    } else {
      console.log('No users found with capital letters in their email');
    }

    return result;
  } catch (error) {
    console.error(`Error processing ${clientName}:`, error);
    result.error = `Error: ${error.message || 'Unknown error'}`;
    return result;
  }
}

export async function processClients(
  specificClient?: string,
  config?: { isDevOnly?: boolean; shouldFix?: boolean },
): Promise<ReportSummary> {
  const { isDevOnly, shouldFix } = config ?? getFlags();

  // Filter clients based on dev flag
  let clientNames = Object.keys(clientConfigProd);
  if (isDevOnly) {
    clientNames = clientNames.filter((name) => clientConfigProd[name].devInstance === true);
  }

  if (specificClient) {
    if (!clientConfigProd[specificClient]) {
      throw new Error(`Client ${specificClient} not found in configuration`);
    }
    if (isDevOnly && !clientConfigProd[specificClient].devInstance) {
      throw new Error(`Client ${specificClient} is not a dev instance`);
    }
    clientNames = [specificClient];
  }

  console.log(`Checking Cognito users for ${clientNames.length} clients...`);
  if (isDevOnly) {
    console.log('Filtering for dev instances only');
  }

  const results: ClientResult[] = [];
  let errorCount = 0;

  for (const clientName of clientNames) {
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
        accountId: clientConfigProd[clientName]?.clientAccountId || '',
        usersWithCapital: [],
        error: `Fatal error: ${error.message || 'Unknown error'}`,
      });
    }
  }

  const clientsWithCapitalEmails = results.filter((r) => r.usersWithCapital.length > 0).length;
  const totalUsersWithCapital = results.reduce((sum, r) => sum + r.usersWithCapital.length, 0);

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalClients: clientNames.length,
      processedClients: results.length,
      errorClients: errorCount,
      clientsWithCapitalEmails,
      totalUsersWithCapital,
    },
    results,
  };
}

async function handleSingleClient(clientName: string, accountId: string): Promise<void> {
  const credentials = temporaryCredentials(accountId);
  const { isDevOnly, shouldFix } = getFlags();

  console.log(`Checking Cognito users for ${clientName}...`);
  if (isDevOnly) {
    console.log('Running in dev instance mode');
  }
  if (shouldFix) {
    console.log('Running in fix mode - will convert emails to lowercase');
  }

  try {
    const userPoolId = await findUserPoolId(credentials, clientName);
    const usersWithCapital = await findUsersWithCapital(credentials, userPoolId);

    if (usersWithCapital.length === 0) {
      console.log('No users found with capital letters in their email');
      process.exit(0);
    }

    console.log(`\nFound ${usersWithCapital.length} users with capital letters in their email:`);
    usersWithCapital.forEach((user) => {
      console.log(`- ${user.username}`);
    });

    if (shouldFix) {
      await fixUsersWithCapital(credentials, usersWithCapital);
      console.log('\nAll emails have been converted to lowercase');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

async function handleMultipleClients(clientName?: string): Promise<void> {
  try {
    const report = await processClients(clientName);

    // Save JSON report
    await fs.writeFile('email-case-report.json', JSON.stringify(report, null, 2));
    console.log(`\nReport saved to email-case-report.json`);

    // Print summary
    const { summary } = report;
    console.log(`\n==========================================`);
    console.log(`Summary Report (${new Date(report.timestamp).toLocaleString()})`);
    console.log(`==========================================`);
    console.log(`Total clients: ${summary.totalClients}`);
    console.log(`Successfully processed: ${summary.processedClients - summary.errorClients}/${summary.totalClients}`);
    console.log(`Clients with capital emails: ${summary.clientsWithCapitalEmails}/${summary.totalClients}`);
    console.log(`Total users with capital emails: ${summary.totalUsersWithCapital}`);

    if (summary.errorClients > 0) {
      console.log(`\nClients with errors (${summary.errorClients}):`);
      report.results.filter((r) => r.error).forEach((r) => console.log(`- ${r.clientName}: ${r.error}`));
    }

    if (summary.totalUsersWithCapital > 0) {
      console.log(`\nClients with capital emails:`);
      report.results
        .filter((r) => r.usersWithCapital.length > 0)
        .forEach((r) => {
          console.log(`\n${r.clientName}:`);
          r.usersWithCapital.forEach((user) => console.log(`- ${user.username}`));
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

  // If single client specified, run original behavior
  if (clientName && !args.includes('--all')) {
    const accountId = clientConfigProd[clientName]?.clientAccountId;
    if (!accountId) {
      console.error(`Client ${clientName} not found in configuration`);
      process.exit(1);
    }

    // Check if this is a dev instance when --dev flag is used
    const { isDevOnly } = getFlags();
    if (isDevOnly && !clientConfigProd[clientName].devInstance) {
      console.error(`Client ${clientName} is not a dev instance`);
      process.exit(1);
    }

    await handleSingleClient(clientName, accountId);
  }
  // Otherwise process all clients and generate report
  else {
    await handleMultipleClients(args.includes('--all') ? undefined : clientName);
  }
}
