import { ServiceQuotas, GetServiceQuotaCommand } from '@aws-sdk/client-service-quotas';

const CLAUDE_QUOTA_CODE = 'L-254CACF4';
const SERVICE_CODE = 'bedrock';

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

    return {
      quotaOk: (response.Quota.Value ?? 0) >= 10,
      currentQuota: response.Quota.Value ?? 0,
      quotaName: response.Quota.QuotaName ?? '',
      adjustable: response.Quota.Adjustable ?? false,
    };
  } catch (error) {
    console.error('Error checking Bedrock quota:', error);
    throw error;
  }
};
