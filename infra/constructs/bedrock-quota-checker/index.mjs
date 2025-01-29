import {
  ServiceQuotas,
  GetServiceQuotaCommand,
  RequestServiceQuotaIncreaseCommand
} from '@aws-sdk/client-service-quotas';

const CLAUDE_QUOTA_CODE = 'L-254CACF4';
const SERVICE_CODE = 'bedrock';
const REQUIRED_QUOTA = 50;

export const handler = async (event) => {
  const client = new ServiceQuotas({ region: process.env.AWS_REGION });

  try {
    console.log(`Checking Bedrock quota for client: ${event.client}`);

    const response = await client.send(
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

    if (!quotaOk) {
      console.log(`Current quota (${currentQuota}) is below required threshold (${REQUIRED_QUOTA}). Submitting increase request.`);

      try {
        const increaseResponse = await client.send(
          new RequestServiceQuotaIncreaseCommand({
            ServiceCode: SERVICE_CODE,
            QuotaCode: CLAUDE_QUOTA_CODE,
            DesiredValue: REQUIRED_QUOTA
          })
        );

        return {
          quotaOk,
          currentQuota,
          quotaName: response.Quota.QuotaName,
          quotaIncreaseRequested: true,
          requestId: increaseResponse.RequestedQuota?.Id,
          requestStatus: increaseResponse.RequestedQuota?.Status,
          caseId: increaseResponse.RequestedQuota?.CaseId
        };
      } catch (increaseError) {
        console.error('Error submitting quota increase request:', increaseError);
        return {
          quotaOk,
          currentQuota,
          quotaName: response.Quota.QuotaName,
          quotaIncreaseRequested: false,
          error: increaseError.message
        };
      }
    }

    return {
      quotaOk,
      currentQuota,
      quotaName: response.Quota.QuotaName,
      quotaIncreaseRequested: false
    };
  } catch (error) {
    console.error('Error checking Bedrock quota:', error);
    throw error;
  }
};
