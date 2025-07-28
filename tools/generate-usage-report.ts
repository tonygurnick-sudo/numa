import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProvider,
  ListUserPoolsCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import chalk from 'chalk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { temporaryCredentials, type AWSClientConfig, type BasicClientConfig } from './utils';
import { getClientConfig } from '@arcanumai/client-config';
import { stringify } from 'csv';
import { AwsCredentialIdentityProvider } from '@smithy/types';

const clientName = argv[2];
const timePeriod = argv[3] || 'current-year'; // 'current-year', 'previous-month', 'YYYY', 'YYYY-MM'
const outputFormat = argv[4] || 'csv'; // csv or json

if (!clientName) {
  console.log(chalk.red('Usage: node --import tsx generate-usage-report.ts <client-name> [time-period] [format]'));
  console.log(chalk.yellow('Time Period Options:'));
  console.log(chalk.yellow('  current-year    - Current year (default)'));
  console.log(chalk.yellow('  previous-month  - Previous month'));
  console.log(chalk.yellow('  YYYY           - Specific year (e.g., 2024)'));
  console.log(chalk.yellow('  YYYY-MM        - Specific month (e.g., 2024-03)'));
  console.log(chalk.yellow('Examples:'));
  console.log(chalk.yellow('  node --import tsx generate-usage-report.ts arcanum-demo'));
  console.log(chalk.yellow('  node --import tsx generate-usage-report.ts arcanum-demo previous-month'));
  console.log(chalk.yellow('  node --import tsx generate-usage-report.ts arcanum-demo 2024'));
  console.log(chalk.yellow('  node --import tsx generate-usage-report.ts arcanum-demo 2024-03 json'));
  exit(1);
}

// Function to get credentials for accessing customer accounts
function getClientCredentials(accountId: string): AwsCredentialIdentityProvider {
  return temporaryCredentials(accountId);
}

// Helper function to temporarily switch AWS profile
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

async function findUserPoolId(awsClientConfig: AWSClientConfig, clientName: string): Promise<string> {
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
    console.error('Error finding user pool:', error);
    throw error;
  }
}

async function getUserEmails(
  awsClientConfig: AWSClientConfig,
  userPoolId: string,
  userIds: string[],
): Promise<Record<string, string>> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);
  const userEmails: Record<string, string> = {};

  console.log(chalk.blue(`Looking up emails for ${userIds.length} users...`));

  for (const userId of userIds) {
    try {
      const response = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: userId,
        }),
      );

      const emailAttr = response.UserAttributes?.find((attr) => attr.Name === 'email');
      userEmails[userId] = emailAttr?.Value || `${userId}@unknown`;
    } catch (error) {
      console.warn(chalk.yellow(`Could not find email for user ${userId}: ${error.message || error}`));
      userEmails[userId] = `${userId}@unknown`;
    }
  }

  return userEmails;
}

function enrichDataWithEmails(
  appRuns: AppRunRecord[],
  chatMessages: ChatMessageRecord[],
  userEmails: Record<string, string>,
): { appRuns: AppRunRecord[]; chatMessages: ChatMessageRecord[] } {
  const enrichedAppRuns = appRuns.map((run) => ({
    ...run,
    userEmail: userEmails[run.userId] || `${run.userId}@unknown`,
  }));

  const enrichedChatMessages = chatMessages.map((message) => ({
    ...message,
    userEmail: userEmails[message.userId] || `${message.userId}@unknown`,
  }));

  return { appRuns: enrichedAppRuns, chatMessages: enrichedChatMessages };
}

interface AppRunRecord {
  userId: string;
  userEmail?: string;
  appId: string;
  appName: string;
  month: string;
  jobId: string;
  startedAt: string;
  status: string;
}

interface ChatMessageRecord {
  userId: string;
  userEmail?: string;
  month: string;
  conversationId: string;
  messageType: string;
  role: string;
  timestamp: string; // Changed from number to string for DD/MM/YYYY format
}

interface UsageSummary {
  userId: string;
  userEmail?: string;
  month: string;
  appRuns: number;
  chatMessages: number;
  appRunsByApp: Record<string, number>;
  chatMessagesByType: Record<string, number>;
}

interface DateRange {
  startDate: Date;
  endDate: Date;
  period: string;
  displayName: string;
}

function parseTimePeriod(timePeriod: string): DateRange {
  const now = new Date();

  if (timePeriod === 'current-year') {
    const year = now.getFullYear();
    return {
      startDate: new Date(`${year}-01-01T00:00:00Z`),
      endDate: new Date(`${year + 1}-01-01T00:00:00Z`),
      period: year.toString(),
      displayName: `${year}`,
    };
  }

  if (timePeriod === 'previous-month') {
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = previousMonth.getFullYear();
    const month = previousMonth.getMonth();
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 1);

    return {
      startDate,
      endDate,
      period: `${year}-${String(month + 1).padStart(2, '0')}`,
      displayName: `${year}-${String(month + 1).padStart(2, '0')} (Previous Month)`,
    };
  }

  // Check if it's a year (YYYY)
  const yearMatch = timePeriod.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    return {
      startDate: new Date(`${year}-01-01T00:00:00Z`),
      endDate: new Date(`${year + 1}-01-01T00:00:00Z`),
      period: year.toString(),
      displayName: `${year}`,
    };
  }

  // Check if it's a specific month (YYYY-MM)
  const monthMatch = timePeriod.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = parseInt(monthMatch[1]);
    const month = parseInt(monthMatch[2]) - 1; // JavaScript months are 0-based
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 1);

    return {
      startDate,
      endDate,
      period: timePeriod,
      displayName: timePeriod,
    };
  }

  throw new Error(`Invalid time period: ${timePeriod}. Use 'current-year', 'previous-month', 'YYYY', or 'YYYY-MM'`);
}

async function getJobsTableNames(dynamoClient: DynamoDBDocumentClient): Promise<string[]> {
  console.log(chalk.blue('Discovering jobs tables...'));

  // List all tables and filter for jobs tables
  const { ListTablesCommand } = await import('@aws-sdk/client-dynamodb');

  const client = new DynamoDBClient({
    region: dynamoClient.config.region,
    credentials: dynamoClient.config.credentials,
  });
  const result = await client.send(new ListTablesCommand({}));

  console.log(chalk.gray(`All tables found: ${result.TableNames?.join(', ') || 'none'}`));

  const jobsTables =
    result.TableNames?.filter(
      (tableName) => tableName.startsWith(`${clientName}-`) && tableName.endsWith('-recent-jobs'),
    ) || [];

  console.log(chalk.green(`Found ${jobsTables.length} jobs tables: ${jobsTables.join(', ')}`));

  if (jobsTables.length === 0) {
    console.log(chalk.yellow(`No jobs tables found matching pattern: ${clientName}-*-recent-jobs`));
    console.log(chalk.yellow(`This means either:`));
    console.log(chalk.yellow(`  1. No apps have been deployed for this client`));
    console.log(chalk.yellow(`  2. No app runs have been executed`));
    console.log(chalk.yellow(`  3. Jobs tables use a different naming convention`));
  }

  return jobsTables;
}

async function getAllAppRuns(
  dynamoClient: DynamoDBDocumentClient,
  jobsTableNames: string[],
  startDate: Date,
  endDate: Date,
): Promise<AppRunRecord[]> {
  console.log(chalk.blue('Fetching app runs...'));
  const allRuns: AppRunRecord[] = [];

  for (const tableName of jobsTableNames) {
    console.log(chalk.yellow(`Scanning table: ${tableName}`));

    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
    do {
      const command = new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const result = await dynamoClient.send(command);

      if (result.Items) {
        for (const item of result.Items) {
          const startedAt = new Date(item.startedAt || item.dateTime);

          if (startedAt >= startDate && startedAt < endDate) {
            // Extract app ID from table name: arcanum-demo-nick-document-summariser-recent-jobs -> document-summariser
            const appId = tableName.replace(`${clientName}-`, '').replace('-recent-jobs', '');

            allRuns.push({
              userId: item.userId || 'unknown',
              appId,
              appName: item.appName || appId,
              month: startedAt.toISOString().substring(0, 7), // YYYY-MM format
              jobId: item.jobId,
              startedAt: item.startedAt || item.dateTime,
              status: item.status || 'unknown',
            });
          }
        }
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  }

  console.log(chalk.green(`Found ${allRuns.length} app runs in date range`));
  return allRuns;
}

async function getAllChatMessages(
  dynamoClient: DynamoDBDocumentClient,
  chatTableName: string,
  startDate: Date,
  endDate: Date,
): Promise<ChatMessageRecord[]> {
  console.log(chalk.blue(`Fetching chat messages from: ${chatTableName}`));
  const allMessages: ChatMessageRecord[] = [];

  let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
  do {
    const command = new ScanCommand({
      TableName: chatTableName,
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const result = await dynamoClient.send(command);

    if (result.Items) {
      for (const item of result.Items) {
        const messageDate = new Date(item.timestamp);

        if (messageDate >= startDate && messageDate < endDate) {
          // Convert timestamp to NZ date format DD/MM/YYYY
          const nzDate = new Date(item.timestamp).toLocaleDateString('en-NZ', {
            timeZone: 'Pacific/Auckland',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });

          allMessages.push({
            userId: item.user_id || 'unknown',
            month: messageDate.toISOString().substring(0, 7), // YYYY-MM format
            conversationId: item.conversation_id || 'unknown',
            messageType: item.message_type || 'unknown',
            role: item.role || 'unknown',
            timestamp: nzDate,
          });
        }
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(chalk.green(`Found ${allMessages.length} chat messages in date range`));
  return allMessages;
}

function aggregateUsageData(appRuns: AppRunRecord[], chatMessages: ChatMessageRecord[]): UsageSummary[] {
  console.log(chalk.blue('Aggregating usage data...'));

  const summaryMap = new Map<string, UsageSummary>();

  // Process app runs
  for (const run of appRuns) {
    const key = `${run.userId}-${run.month}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        userId: run.userId,
        userEmail: run.userEmail,
        month: run.month,
        appRuns: 0,
        chatMessages: 0,
        appRunsByApp: {},
        chatMessagesByType: {},
      });
    }

    const summary = summaryMap.get(key)!;
    summary.appRuns++;
    summary.appRunsByApp[run.appName] = (summary.appRunsByApp[run.appName] || 0) + 1;
  }

  // Process chat messages
  for (const message of chatMessages) {
    const key = `${message.userId}-${message.month}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        userId: message.userId,
        userEmail: message.userEmail,
        month: message.month,
        appRuns: 0,
        chatMessages: 0,
        appRunsByApp: {},
        chatMessagesByType: {},
      });
    }

    const summary = summaryMap.get(key)!;
    summary.chatMessages++;
    summary.chatMessagesByType[message.messageType] = (summary.chatMessagesByType[message.messageType] || 0) + 1;
  }

  return Array.from(summaryMap.values()).sort((a, b) => {
    if (a.month !== b.month) return a.month.localeCompare(b.month);
    return a.userId.localeCompare(b.userId);
  });
}

function exportToCSV(
  appRuns: AppRunRecord[],
  chatMessages: ChatMessageRecord[],
  summary: UsageSummary[],
  period: string,
): void {
  console.log(chalk.blue('Exporting to CSV files...'));

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  // Create output directory
  const outputDir = join('reports', clientName);
  mkdirSync(outputDir, { recursive: true });

  // Export detailed app runs
  stringify(
    appRuns,
    {
      header: true,
      columns: ['userId', 'userEmail', 'appId', 'appName', 'month', 'jobId', 'startedAt', 'status'],
    },
    (err, output) => {
      if (err) throw err;
      writeFileSync(join(outputDir, `${clientName}-app-runs-${period}-${timestamp}.csv`), output);
    },
  );

  // Export detailed chat messages
  stringify(
    chatMessages,
    {
      header: true,
      columns: ['userId', 'userEmail', 'month', 'conversationId', 'messageType', 'role', 'timestamp'],
    },
    (err, output) => {
      if (err) throw err;
      writeFileSync(join(outputDir, `${clientName}-chat-messages-${period}-${timestamp}.csv`), output);
    },
  );

  // Export usage summary
  const summaryData = summary.map((s) => ({
    ...s,
    appRunsByApp: JSON.stringify(s.appRunsByApp),
    chatMessagesByType: JSON.stringify(s.chatMessagesByType),
  }));

  stringify(
    summaryData,
    {
      header: true,
      columns: ['userId', 'userEmail', 'month', 'appRuns', 'chatMessages', 'appRunsByApp', 'chatMessagesByType'],
    },
    (err, output) => {
      if (err) throw err;
      writeFileSync(join(outputDir, `${clientName}-usage-summary-${period}-${timestamp}.csv`), output);
    },
  );

  console.log(chalk.green(`✅ Exported 3 CSV files to ${outputDir}:`));
  console.log(chalk.green(`   📊 ${clientName}-app-runs-${period}-${timestamp}.csv`));
  console.log(chalk.green(`   💬 ${clientName}-chat-messages-${period}-${timestamp}.csv`));
  console.log(chalk.green(`   📈 ${clientName}-usage-summary-${period}-${timestamp}.csv`));
}

function exportToJSON(
  appRuns: AppRunRecord[],
  chatMessages: ChatMessageRecord[],
  summary: UsageSummary[],
  period: string,
  displayName: string,
): void {
  console.log(chalk.blue('Exporting to JSON file...'));

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  // Create output directory
  const outputDir = join('reports', clientName);
  mkdirSync(outputDir, { recursive: true });

  const exportData = {
    metadata: {
      clientName,
      period,
      displayName,
      exportDate: new Date().toISOString(),
      totalAppRuns: appRuns.length,
      totalChatMessages: chatMessages.length,
      uniqueUsers: new Set([...appRuns.map((r) => r.userId), ...chatMessages.map((m) => m.userId)]).size,
    },
    appRuns,
    chatMessages,
    summary,
  };

  const filename = `${clientName}-usage-report-${period}-${timestamp}.json`;
  writeFileSync(join(outputDir, filename), JSON.stringify(exportData, null, 2));

  console.log(chalk.green(`✅ Exported: ${outputDir}/${filename}`));
}

async function generateUsageReport(): Promise<void> {
  try {
    const dateRange = parseTimePeriod(timePeriod);

    console.log(chalk.blue.bold(`🚀 Generating usage report for ${clientName} (${dateRange.displayName})`));

    // Get client configuration first (using default credentials)
    const config: BasicClientConfig = await getClientConfig(clientName);
    const accountId = config.clientAccountId;

    if (!accountId) {
      throw new Error(`Account ID for ${clientName} not found in configuration`);
    }

    console.log(chalk.yellow(`Date range: ${dateRange.startDate.toISOString()} to ${dateRange.endDate.toISOString()}`));

    // All AWS SDK calls for this client should use the deployer profile
    await withDeployerProfile(async () => {
      // Set up AWS clients with proper credential handling
      const awsClientConfig: AWSClientConfig = {
        region: config.region,
        credentials: getClientCredentials(accountId),
      };

      const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(awsClientConfig));

      // Get all jobs tables
      const jobsTableNames = await getJobsTableNames(dynamoClient);

      // Chat history table name
      const chatTableName = `numa-${clientName}-chat-history`;

      // Fetch data
      const [appRuns, chatMessages] = await Promise.all([
        getAllAppRuns(dynamoClient, jobsTableNames, dateRange.startDate, dateRange.endDate),
        getAllChatMessages(dynamoClient, chatTableName, dateRange.startDate, dateRange.endDate),
      ]);

      // Get unique user IDs and look up their emails
      const allUserIds = [...new Set([...appRuns.map((r) => r.userId), ...chatMessages.map((m) => m.userId)])];

      let enrichedAppRuns = appRuns;
      let enrichedChatMessages = chatMessages;

      if (allUserIds.length > 0) {
        try {
          const userPoolId = await findUserPoolId(awsClientConfig, clientName);
          const userEmails = await getUserEmails(awsClientConfig, userPoolId, allUserIds);
          const enrichedData = enrichDataWithEmails(appRuns, chatMessages, userEmails);
          enrichedAppRuns = enrichedData.appRuns;
          enrichedChatMessages = enrichedData.chatMessages;
        } catch (error) {
          console.warn(chalk.yellow(`Could not enrich data with emails: ${error.message}`));
          console.warn(chalk.yellow('Proceeding with user IDs only...'));
        }
      }

      // Aggregate data
      const summary = aggregateUsageData(enrichedAppRuns, enrichedChatMessages);

      // Print basic statistics
      console.log(chalk.blue.bold('\n📊 Usage Statistics:'));
      console.log(chalk.yellow(`Total app runs: ${enrichedAppRuns.length}`));
      console.log(chalk.yellow(`Total chat messages: ${enrichedChatMessages.length}`));
      console.log(
        chalk.yellow(
          `Unique users: ${new Set([...enrichedAppRuns.map((r) => r.userId), ...enrichedChatMessages.map((m) => m.userId)]).size}`,
        ),
      );
      console.log(
        chalk.yellow(
          `Months covered: ${new Set([...enrichedAppRuns.map((r) => r.month), ...enrichedChatMessages.map((m) => m.month)]).size}`,
        ),
      );

      // Export data
      if (outputFormat === 'json') {
        exportToJSON(enrichedAppRuns, enrichedChatMessages, summary, dateRange.period, dateRange.displayName);
      } else {
        exportToCSV(enrichedAppRuns, enrichedChatMessages, summary, dateRange.period);
      }

      console.log(chalk.green.bold('\n✅ Usage report generation completed!'));
    });
  } catch (error) {
    console.error(chalk.red('❌ Error generating usage report:'), error);
    exit(1);
  }
}

generateUsageReport();
