/**
 * URL Data Source Migration Script
 *
 * This script migrates URL data sources from client configurations in DynamoDB
 * to the new Numa Crawler system. It reads the webCrawlerConfigs from each client's
 * configuration and adds them to the client-specific crawl-urls DynamoDB table.
 */

import { DynamoDBClient, DescribeTableCommand, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { getClientConfig, listClients } from '@arcanumai/client-config';
import { ClientConfig as ImportedClientConfig, clientConfigSchema } from '../infra/stacks/numa-client-stack';
import { temporaryCredentials } from './utils';

interface WebCrawlerConfig {
  url: string;
  title?: string;
  crawlDepth?: number;
}

// Use imported ClientConfig type
type ClientConfig = ImportedClientConfig;

// Default values
const DEFAULT_REGION = 'us-east-1';

// Command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CLIENT_FILTER = args.find((arg) => !arg.startsWith('--'));

// Allow specifying AWS profile via command line or environment variable
const profileArg = args.find((arg) => arg.startsWith('--profile='));
const AWS_PROFILE = profileArg ? profileArg.split('=')[1] : process.env.AWS_PROFILE || 'arcanum-q-deployer-prod';

// Helper function to extract URLs from client configuration
function extractUrlsFromConfig(config: ClientConfig): WebCrawlerConfig[] {
  let urls: WebCrawlerConfig[] = [];

  // Check for webCrawlerConfigs at the top level
  if (config.webCrawlerConfigs) {
    console.log(`Found ${config.webCrawlerConfigs.length} URLs in webCrawlerConfigs`);
    // Convert to our WebCrawlerConfig format
    urls = config.webCrawlerConfigs
      .map((wc) => ({
        url: wc.url || '',
        title: wc.url, // Use URL as title if not specified
        crawlDepth: wc.configuration?.crawlDepth ? parseInt(wc.configuration.crawlDepth, 10) : undefined,
      }))
      .filter((wc) => wc.url); // Filter out any entries without URLs
  }

  return urls;
}

// Create a DynamoDB document client with assumed role credentials
async function createDynamoDBClientWithAssumedRole(region: string, accountId: string): Promise<DynamoDBDocument> {
  try {
    // Always use the consistent AWS profile for role assumption
    process.env.AWS_PROFILE = AWS_PROFILE;
    console.log(`Using temporaryCredentials for account ${accountId} in region ${region}`);
    // Create AWS client config using temporaryCredentials
    const awsClientConfig = {
      region,
      credentials: temporaryCredentials(accountId),
    };
    // Create DynamoDB client with the credentials
    const client = new DynamoDBClient(awsClientConfig);
    return DynamoDBDocument.from(client);
  } catch (error) {
    console.error(`Error assuming role for account ${accountId}:`, error);
    throw error;
  }
}

// Migrate URLs for a specific client
async function migrateUrlsForClient(clientName: string, config: ClientConfig): Promise<number> {
  // Process URLs from config
  const urls = extractUrlsFromConfig(config);
  console.log(`Found ${urls.length} URLs to process for client ${clientName}`);

  // Skip if no URLs found
  if (urls.length === 0) {
    console.log(`No URLs found for client ${clientName}, skipping...`);
    return 0;
  }

  let region = DEFAULT_REGION;
  let ddbdc: DynamoDBDocument;
  let migratedCount = 0;
  let checkClient: DynamoDBClient;

  try {
    // Get region and environment suffix from config
    region = config.region || DEFAULT_REGION;

    // Get region from the top-level config if available
    if (config.region) {
      region = config.region;
    }

    // Check for clientAccountId in either location
    const clientAccountId = config.clientAccountId;

    // Create appropriate DynamoDB client based on whether it has an account ID
    if (clientAccountId) {
      try {
        ddbdc = await createDynamoDBClientWithAssumedRole(region, clientAccountId);
        // Initialize check client with the same credentials
        process.env.AWS_PROFILE = AWS_PROFILE;
        checkClient = new DynamoDBClient({
          region,
          credentials: temporaryCredentials(clientAccountId),
        });
      } catch (error) {
        console.error(`Failed to assume role for ${clientName}, falling back to direct access:`, error);
        // Create DynamoDB client directly with AWS profile
        const client = new DynamoDBClient({
          region,
          credentials: undefined, // Use default credentials
        });
        ddbdc = DynamoDBDocument.from(client);
        checkClient = client;
      }
    } else {
      console.log(`No account ID for ${clientName}, using direct access in region ${region}`);
      // Create DynamoDB client directly with AWS profile
      const client = new DynamoDBClient({
        region,
        credentials: undefined, // Use default credentials
      });
      ddbdc = DynamoDBDocument.from(client);
      checkClient = client;
    }

    // Construct table name
    const tableName = `numa-${clientName}-crawl-urls`;
    console.log(`Using table: ${tableName}`);

    // Process each URL in the web crawler configs
    for (let i = 0; i < urls.length; i++) {
      const userId = 'migration-script';
      const urlObj = urls[i];
      // Extract URL from WebCrawlerConfig
      let urlString = urlObj.url;
      try {
        // Since we're using WebCrawlerConfig interface and filtering out empty URLs
        // in extractUrlsFromConfig, we can be confident urlString exists

        // Normalize URL
        if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
          urlString = `https://${urlString.replace(/^\/+/, '')}`; // Remove leading slashes
        }
      } catch (error) {
        console.error(`Error processing URL object: ${JSON.stringify(urlObj)}`, error);
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would add URL to crawl table: ${urlString}`);
        continue;
      }

      let exists = false;
      try {
        // Use the previously created client for table existence check
        exists = await tableExists(checkClient, tableName);
      } catch (error) {
        console.error(`Error checking if table ${tableName} exists:`, error);
        exists = false;
      }
      if (!exists) {
        console.log(`Table ${tableName} does not exist. Skipping URL: ${urlString}`);
        continue;
      }

      try {
        // Add URL to crawl table
        const item = {
          userId,
          url: urlString,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        // Put item in DynamoDB
        await ddbdc.put({
          TableName: tableName,
          Item: item,
        });

        console.log(`Added URL to crawl table: ${urlString}`);
        migratedCount++;
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          console.log(`URL already exists in queue: ${urlString}`);
        } else {
          console.error(`Error adding URL to crawl table: ${urlString}`, error);
          throw error;
        }
      }
    }

    return migratedCount;
  } catch (error) {
    console.error(`Error migrating URLs for client ${clientName}:`, error);
    throw error;
  }
}

// Check if a table exists
async function tableExists(client: DynamoDBClient, tableName: string): Promise<boolean> {
  try {
    const command = new DescribeTableCommand({ TableName: tableName });
    await client.send(command);
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    }
    throw error;
  }
}

// Main function to migrate URLs for all clients
async function migrateUrls(clientFilter?: string): Promise<void> {
  console.log('Starting URL migration...');

  try {
    // Get all clients using the client-config library
    const allClients = await listClients();

    // Filter clients if specified
    let clientsToProcess = allClients;
    if (clientFilter) {
      // First try exact match
      const exactMatch = allClients.filter((client) => client === clientFilter);
      if (exactMatch.length > 0) {
        // If we have an exact match, use only that client
        clientsToProcess = exactMatch;
      } else {
        // Otherwise fall back to partial match
        clientsToProcess = allClients.filter((client) => client.includes(clientFilter));
      }
    }

    console.log(`Found ${Array.isArray(clientsToProcess) ? clientsToProcess.length : 0} clients to process`);

    let totalProcessed = 0;
    let totalMigrated = 0;
    for (const clientName of clientsToProcess) {
      try {
        console.log(`Getting config for client ${clientName}...`);
        // Get client config using the client-config library
        let config: ClientConfig | undefined;
        try {
          config = await getClientConfig<ClientConfig>(clientName, clientConfigSchema);
        } catch (error) {
          console.error(`Error getting config for ${clientName}: ${error}`);
          console.log(`Skipping client ${clientName}`);
          continue;
        }

        if (!config) {
          console.log(`No config found for client ${clientName}, skipping...`);
          continue;
        }

        const urlsMigrated = await migrateUrlsForClient(clientName, config);
        totalProcessed++;
        totalMigrated += urlsMigrated;
      } catch (error) {
        console.error(`Error processing client ${clientName}:`, error);
      }
    }

    console.log(`Processed ${totalProcessed} clients`);
    console.log(`Migrated ${totalMigrated} URLs`);
    console.log('URL migration completed');
  } catch (error) {
    console.error('Error during URL migration:', error);
  }
}

// Run the script if called directly
if (import.meta.url.endsWith(process.argv[1])) {
  migrateUrls(CLIENT_FILTER)
    .then(() => console.log('URL migration completed successfully'))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { migrateUrlsForClient };
