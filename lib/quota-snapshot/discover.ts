import { GetServiceQuotaCommand, ListServiceQuotasCommand, ServiceQuotas } from '@aws-sdk/client-service-quotas';
import { classifyQuota, descriptorFromClassified, isQuotaNameSupported, sortQuotaDescriptors } from './classify.js';
import type { QuotaDescriptor, QuotaFilter } from './types.js';

export const BEDROCK_SERVICE_CODE = 'bedrock';

export async function discoverBedrockQuotas(client: ServiceQuotas, filter: QuotaFilter): Promise<QuotaDescriptor[]> {
  const { families, types, metrics, advancedFilter } = filter;
  const needle = advancedFilter?.toLowerCase();

  const found: QuotaDescriptor[] = [];
  let NextToken: string | undefined;

  do {
    const res = await client.send(
      new ListServiceQuotasCommand({ ServiceCode: BEDROCK_SERVICE_CODE, MaxResults: 100, NextToken })
    );
    NextToken = res.NextToken;

    for (const quota of res.Quotas ?? []) {
      if (!quota.QuotaName || !quota.QuotaCode) continue;
      if (!isQuotaNameSupported(quota.QuotaName)) continue;

      const classified = classifyQuota(quota.QuotaName);
      if (!classified) continue;
      if (!families.includes(classified.family)) continue;
      if (!types.includes(classified.type)) continue;
      if (!metrics.includes(classified.metric)) continue;
      if (
        needle &&
        !classified.label.toLowerCase().includes(needle) &&
        !classified.raw.toLowerCase().includes(needle)
      ) {
        continue;
      }

      found.push(descriptorFromClassified(quota.QuotaCode, classified));
    }
  } while (NextToken);

  return sortQuotaDescriptors(found);
}

export async function fetchQuotaValues(
  client: ServiceQuotas,
  descriptors: QuotaDescriptor[]
): Promise<Record<string, number | null>> {
  const values: Record<string, number | null> = {};
  for (const d of descriptors) {
    try {
      const res = await client.send(
        new GetServiceQuotaCommand({ ServiceCode: BEDROCK_SERVICE_CODE, QuotaCode: d.QuotaCode })
      );
      values[d.QuotaCode] = res.Quota?.Value ?? null;
    } catch {
      values[d.QuotaCode] = null;
    }
  }
  return values;
}
