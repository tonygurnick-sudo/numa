import {
  ServiceQuotas,
  GetServiceQuotaCommand
} from '@aws-sdk/client-service-quotas';
import {
  Support,
  CreateCaseCommand,
  DescribeCasesCommand
} from '@aws-sdk/client-support';

const CLAUDE_QUOTA_CODE = 'L-254CACF4';
const SERVICE_CODE = 'bedrock';
const REQUIRED_QUOTA = 60;
const CASE_SUBJECT = (clientName) => `Bedrock Claude 3.5 Sonnet Quota Increase Request for ${clientName}`;

async function findExistingCase(supportClient, clientName) {
  try {
    const response = await supportClient.send(
      new DescribeCasesCommand({
        includeResolvedCases: false,
        serviceCode: 'bedrock',
        language: 'en'
      })
    );

    return response.cases?.find(c =>
      c.subject === CASE_SUBJECT(clientName) &&
      c.status !== 'resolved'
    );
  } catch (error) {
    console.error('Error checking for existing cases:', error);
    throw error;
  }
}

export const handler = async (event) => {
  const quotasClient = new ServiceQuotas({ region: process.env.AWS_REGION });
  const supportClient = new Support({ region: 'us-east-1' });

  try {
    console.log(`Checking Bedrock quota for client: ${event.client}`);
    const response = await quotasClient.send(
      new GetServiceQuotaCommand({
        ServiceCode: SERVICE_CODE,
        QuotaCode: CLAUDE_QUOTA_CODE,
      })
    );

    if (!response.Quota) {
      throw new Error('No quota details found for Claude 3.5 Sonnet');
    }

    const currentQuota = response.Quota.Value ?? 0;
    const quotaOk = currentQuota >= REQUIRED_QUOTA;

    if (quotaOk) {
      return {
        quotaOk,
        currentQuota,
        requiredQuota: REQUIRED_QUOTA,
        quotaName: response.Quota.QuotaName,
        supportCaseCreated: false
      };
    }

    console.log(`Quota insufficient (${currentQuota} < ${REQUIRED_QUOTA}). Checking for existing cases...`);
    const existingCase = await findExistingCase(supportClient, event.client);

    if (existingCase) {
      return {
        quotaOk,
        currentQuota,
        requiredQuota: REQUIRED_QUOTA,
        quotaName: response.Quota.QuotaName,
        existingCase: true,
        caseId: existingCase.caseId,
        caseStatus: existingCase.status,
        timeCreated: existingCase.timeCreated,
        displayId: existingCase.displayId
      };
    }

    console.log('No existing case found. Creating new support case...');
    const createCaseResponse = await supportClient.send(
      new CreateCaseCommand({
        subject: CASE_SUBJECT(event.client),
        serviceCode: "service-bedrock",
        severityCode: "high",
        categoryCode: "general-guidance",
        issueType: "service-limit-increase",
        communicationBody: `
We are requesting a quota increase for Amazon Bedrock Claude 3.5 Sonnet (anthropic.claude-3-5-sonnet) for client ${event.client}.

Current quota: ${currentQuota} requests per minute
Requested quota: ${REQUIRED_QUOTA} requests per minute

We are Arcanum AI, an AWS consulting partner specializing in Amazon Q Business implementations. This quota increase is required for our client's production deployment.

We appreciate your prompt attention to this request as it is blocking our client's implementation timeline.
        `
      })
    );

    return {
      quotaOk,
      currentQuota,
      requiredQuota: REQUIRED_QUOTA,
      quotaName: response.Quota.QuotaName,
      supportCaseCreated: true,
      newCase: true,
      caseId: createCaseResponse.caseId
    };

  } catch (error) {
    if (error.name === 'SubscriptionRequiredException') {
      return {
        quotaOk: false,
        currentQuota,
        requiredQuota: REQUIRED_QUOTA,
        quotaName: response.Quota.QuotaName,
        error: 'Account requires Business Support plan to create support cases',
        supportPlanRequired: true
      };
    }
    console.error('Error checking Bedrock quota:', error);
    throw error;
  }
};
