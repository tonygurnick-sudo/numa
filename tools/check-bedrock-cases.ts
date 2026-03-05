import { GetServiceQuotaCommand, ServiceQuotas } from '@aws-sdk/client-service-quotas';
import { CaseDetails, DescribeCasesCommand, DescribeCasesCommandInput, Support } from '@aws-sdk/client-support';
import fs from 'node:fs/promises';
import { argv } from 'node:process';
import { AWSClientConfig, BasicClientConfig, temporaryCredentials } from './utils';
import { getClientConfig, listClients } from '@arcanumai/client-config';

const args = argv.slice(2);
const CLAUDE_QUOTA_CODE = 'L-254CACF4';
const REQUIRED_QUOTA = 50;

interface ClientResult {
  clientName: string;
  accountId: string;
  currentQuota: number;
  requiredQuota: number;
  sufficientQuota: string;
  cases: { caseId: string; status: string; created: string; subject?: string }[];
  error?: string;
}

interface ReportSummary {
  timestamp: string;
  summary: {
    totalClients: number;
    processedClients: number;
    errorClients: number;
    clientsWithSufficientQuota: number;
    clientsWithCases: number;
  };
  results: ClientResult[];
}

// Core functionality from original script
async function getCurrentQuota(awsClientConfig: AWSClientConfig): Promise<number> {
  const quotasClient = new ServiceQuotas(awsClientConfig);

  try {
    const response = await quotasClient.send(
      new GetServiceQuotaCommand({
        ServiceCode: 'bedrock',
        QuotaCode: CLAUDE_QUOTA_CODE,
      })
    );
    return response.Quota?.Value ?? 0;
  } catch (error) {
    console.error('Error checking quota:', error);
    throw error;
  }
}

async function findBedrockCases(awsClientConfig: AWSClientConfig, clientName: string): Promise<CaseDetails[]> {
  const support = new Support(awsClientConfig);
  try {
    const params: DescribeCasesCommandInput = {
      includeResolvedCases: args.includes('--include-resolved'),
      includeCommunications: args.includes('--details'),
      language: 'en',
      maxResults: 100,
    };

    const response = await support.send(new DescribeCasesCommand(params));

    return (
      response.cases?.filter(
        (c) =>
          c.subject?.includes(`Bedrock Claude 3.5 Sonnet Quota Increase Request for ${clientName}`) &&
          c.serviceCode === 'service-bedrock'
      ) ?? []
    );
  } catch (error) {
    if (error.name === 'SubscriptionRequiredException') {
      console.error('Error: Account requires Business Support plan to view support cases');
      return [];
    }
    console.error('Error checking for cases:', error);
    throw error;
  }
}

// Main functions
async function checkClient(clientName: string, showDetails: boolean): Promise<ClientResult> {
  console.log(`\nChecking Bedrock quota and cases for ${clientName}...`);
  const clientConfig = await getClientConfig<BasicClientConfig>(clientName);

  const result: ClientResult = {
    clientName,
    accountId: '',
    currentQuota: 0,
    requiredQuota: REQUIRED_QUOTA,
    sufficientQuota: '❌',
    cases: [],
  };

  const accountId = clientConfig.clientAccountId;
  result.accountId = accountId;
  const awsClientConfig = {
    credentials: temporaryCredentials(accountId),
    region: clientConfig.region,
  };

  try {
    const currentQuota = await getCurrentQuota(awsClientConfig);
    result.currentQuota = currentQuota;
    result.sufficientQuota = currentQuota >= REQUIRED_QUOTA ? '✅' : '❌';

    console.log(`Quota Status: ${currentQuota}/${REQUIRED_QUOTA} RPM (${result.sufficientQuota})`);

    const cases = await findBedrockCases(awsClientConfig, clientName);
    if (cases.length === 0) {
      console.log('No Bedrock quota cases found');
    } else {
      cases.forEach((c) => {
        result.cases.push({
          caseId: c.displayId || '',
          status: c.status || '',
          created: c.timeCreated || '',
          subject: c.subject,
        });

        console.log(`Found case: ${c.displayId} (${c.status})`);

        if (showDetails && c.recentCommunications?.communications) {
          console.log(`Subject: ${c.subject}`);
          c.recentCommunications.communications.forEach((comm) => {
            console.log(`${comm.timeCreated}: ${comm.body}`);
          });
        }
      });
    }

    return result;
  } catch (error) {
    console.error(`Error processing ${clientName}:`, error);
    result.error = `Error: ${error.message || 'Unknown error'}`;
    return result;
  }
}

async function processAllClients(): Promise<ReportSummary> {
  const showDetails = args.includes('--details');
  const clientNames = await listClients();

  console.log(`Checking Bedrock quotas for ${clientNames.length} clients...`);

  const results: ClientResult[] = [];
  let errorCount = 0;

  for (const clientName of clientNames) {
    try {
      const result = await checkClient(clientName, showDetails);
      results.push(result);
      if (result.error) errorCount++;
    } catch (error) {
      const clientConfig = await getClientConfig<BasicClientConfig>(clientName);
      errorCount++;
      results.push({
        clientName,
        accountId: clientConfig.clientAccountId || '',
        currentQuota: 0,
        requiredQuota: REQUIRED_QUOTA,
        sufficientQuota: '❌',
        cases: [],
        error: `Fatal error: ${error.message || 'Unknown error'}`,
      });
    }
  }

  const clientsWithSufficientQuota = results.filter((r) => r.sufficientQuota === '✅').length;
  const clientsWithCases = results.filter((r) => r.cases.length > 0).length;

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalClients: clientNames.length,
      processedClients: results.length,
      errorClients: errorCount,
      clientsWithSufficientQuota,
      clientsWithCases,
    },
    results,
  };
}

// Main function
if (import.meta.filename === process?.argv[1]) {
  const clientName = args.find((arg) => !arg.startsWith('--'));

  // If single client specified, run original behavior
  if (clientName && !args.includes('--all')) {
    const clientConfig = await getClientConfig<BasicClientConfig>(clientName);
    const accountId = clientConfig.clientAccountId;
    if (!accountId) {
      console.error(`Client ${clientName} not found in configuration`);
      process.exit(1);
    }

    const awsClientConfig = {
      region: clientConfig.region,
      credentials: temporaryCredentials(accountId),
    };
    const showDetails = args.includes('--details');

    console.log(`Checking Bedrock quota and cases for ${clientName}...`);

    try {
      // Check quota
      const currentQuota = await getCurrentQuota(awsClientConfig);
      console.log('\nQuota Status:');
      console.log(`Current quota: ${currentQuota} requests per minute`);
      console.log(`Required quota: ${REQUIRED_QUOTA} requests per minute`);
      console.log(`Status: ${currentQuota >= REQUIRED_QUOTA ? '✅ Sufficient' : '❌ Insufficient'}`);

      // Check cases
      console.log('\nChecking support cases...');
      const cases = await findBedrockCases(awsClientConfig, clientName);

      if (cases.length === 0) {
        console.log('No Bedrock quota cases found');
        process.exit(0);
      }

      cases.forEach((c) => {
        console.log('\nCase Details:');
        console.log(`Case ID: ${c.displayId}`);
        console.log(`Status: ${c.status}`);
        console.log(`Created: ${c.timeCreated}`);

        if (showDetails && c.recentCommunications?.communications) {
          console.log(`Subject: ${c.subject}`);
          console.log(`Recent Communications:`);
          c.recentCommunications.communications.forEach((comm) => {
            console.log(`\n${comm.timeCreated}: ${comm.body}`);
          });
        }
      });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  }
  // Otherwise process all clients and generate report
  else {
    processAllClients()
      .then(async (report) => {
        // Save JSON report
        const jsonOutputPath = 'bedrock-quota-report.json';
        await fs.writeFile(jsonOutputPath, JSON.stringify(report, null, 2));
        console.log(`\nReport saved to ${jsonOutputPath}`);

        // Print summary
        const { summary } = report;
        console.log(`\n==========================================`);
        console.log(`Summary Report (${new Date(report.timestamp).toLocaleString()})`);
        console.log(`==========================================`);
        console.log(`Total clients: ${summary.totalClients}`);
        console.log(
          `Successfully processed: ${summary.processedClients - summary.errorClients}/${summary.totalClients}`
        );
        console.log(`Clients with sufficient quota: ${summary.clientsWithSufficientQuota}/${summary.totalClients}`);
        console.log(`Clients with active cases: ${summary.clientsWithCases}/${summary.totalClients}`);

        if (summary.errorClients > 0) {
          console.log(`\nClients with errors (${summary.errorClients}):`);
          report.results.filter((r) => r.error).forEach((r) => console.log(`- ${r.clientName}: ${r.error}`));
        }

        if (summary.totalClients - summary.clientsWithSufficientQuota > 0) {
          console.log(
            `\nClients needing quota increase (${summary.totalClients - summary.clientsWithSufficientQuota}):`
          );
          report.results
            .filter((r) => r.sufficientQuota === '❌')
            .forEach((r) =>
              console.log(`- ${r.clientName}: Current quota ${r.currentQuota}, needed ${r.requiredQuota}`)
            );
        }
      })
      .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
      });
  }
}
