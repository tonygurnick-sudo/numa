import { argv } from 'node:process';
import { Support, DescribeCasesCommand } from '@aws-sdk/client-support';
import { ServiceQuotas, GetServiceQuotaCommand } from '@aws-sdk/client-service-quotas';
import { temporaryCredentials } from './utils';
import clientConfigProd from '../clientConfigProd.json';
const args = argv.slice(2);
const region = 'us-east-1';
const CLAUDE_QUOTA_CODE = 'L-254CACF4';
const REQUIRED_QUOTA = 50;
async function getCurrentQuota(credentials) {
  const quotasClient = new ServiceQuotas({
    region: process.env.AWS_REGION ?? region,
    credentials,
  });
  try {
    const response = await quotasClient.send(
      new GetServiceQuotaCommand({
        ServiceCode: 'bedrock',
        QuotaCode: CLAUDE_QUOTA_CODE,
      }),
    );
    return response.Quota?.Value ?? 0;
  } catch (error) {
    console.error('Error checking quota:', error);
    throw error;
  }
}
async function findBedrockCases(credentials, clientName) {
  const support = new Support({ region, credentials });
  try {
    const params = {
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
          c.serviceCode === 'service-bedrock',
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
if (import.meta.filename === process?.argv[1]) {
  const clientName = args[0];
  const showDetails = args.includes('--details');
  if (!clientName) {
    console.error('Please provide a client name');
    process.exit(1);
  }
  if (!clientConfigProd[clientName]) {
    console.error(`Client ${clientName} not found in configuration`);
    process.exit(1);
  }
  const accountId = clientConfigProd[clientName].clientAccountId;
  const credentials = temporaryCredentials(accountId);
  console.log(`Checking Bedrock quota and cases for ${clientName}...`);
  try {
    const currentQuota = await getCurrentQuota(credentials);
    console.log('\nQuota Status:');
    console.log(`Current quota: ${currentQuota} requests per minute`);
    console.log(`Required quota: ${REQUIRED_QUOTA} requests per minute`);
    console.log(`Status: ${currentQuota >= REQUIRED_QUOTA ? '✅ Sufficient' : '❌ Insufficient'}`);
    console.log('\nChecking support cases...');
    const cases = await findBedrockCases(credentials, clientName);
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
