import { GetServiceQuotaCommand, ListServiceQuotasCommand, ServiceQuotas } from '@aws-sdk/client-service-quotas';
import { temporaryCredentials } from './utils';
import { create } from 'flat-cache';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { writeFileSync } from 'node:fs';
import { getAllClientConfigs } from '@arcanumai/client-config';

const CACHE = create({
  cacheId: 'quota-report-quotas',
});

const cartesian = (...a): string[][] => a.reduce((a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())));

const regions = ['us-east-1', 'ap-southeast-2'];

const ServiceCode = 'bedrock';
interface Quota {
  QuotaName: string;
  QuotaCode: string;
  Type: string;
  Model: string;
}

interface QuotaOutput {
  QuotaCode: string;
  Value: Promise<number>;
  Region: string;
  Account: string;
}

// Cache the results of this as it takes a little while and doesn't change very often.
async function getQuotas(): Promise<Quota[]> {
  const pattern = new RegExp('^.*requests per minute.*Sonnet.*$');
  const cacheKey = pattern.toString();
  const cachedResult = CACHE.get<Quota[]>(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }
  const SQClient = new ServiceQuotas();
  const quotas = [];
  let NextToken;
  do {
    const result = await SQClient.send(
      new ListServiceQuotasCommand({
        ServiceCode,
        MaxResults: 100,
        NextToken,
      }),
    );
    NextToken = result.NextToken;
    quotas.push(
      ...result.Quotas.filter((quota) => pattern.test(quota.QuotaName)).map((quota) => ({
        QuotaName: quota.QuotaName,
        QuotaCode: quota.QuotaCode,
        Type: quota.QuotaName.match(/^On-demand/) ? 'On-demand' : 'Cross-region',
        Model: quota.QuotaName.split('Anthropic ')[1],
      })),
    );
  } while (NextToken);
  CACHE.set(cacheKey, quotas);
  CACHE.save();
  return quotas;
}

interface ClientConfig {
  clientAccountId: string;
}
const accounts = Object.fromEntries(
  Object.entries(await getAllClientConfigs<ClientConfig>()).map(([clientName, clientConfig]) => [
    clientConfig.clientAccountId,
    { name: clientName },
  ]),
);

async function checkAccount(account: string, regions: string[], quotas: Quota[]): Promise<QuotaOutput[]> {
  return (
    await Promise.all(
      regions.map(async (region): Promise<QuotaOutput[]> => {
        const credentials = temporaryCredentials(account);
        const client = new ServiceQuotas({
          credentials,
          region,
        });
        return Promise.all(
          quotas.map(async (quota): Promise<QuotaOutput> => {
            const result = client.send(
              new GetServiceQuotaCommand({
                ServiceCode,
                QuotaCode: quota.QuotaCode,
              }),
            );
            return {
              Value: result.then((r) => r.Quota.Value),
              QuotaCode: quota.QuotaCode,
              Region: region,
              Account: account,
            };
          }),
        );
      }),
    )
  ).flat();
}

async function produceReport(data: QuotaOutput[], quotas: Quota[], reportPath: string): Promise<void> {
  const resultMap = {};
  for (const r of data) {
    if (!resultMap[r.Account]) resultMap[r.Account] = {};
    if (!resultMap[r.Account][r.Region]) resultMap[r.Account][r.Region] = {};
    resultMap[r.Account][r.Region][r.QuotaCode] = await r.Value;
  }

  const rows = cartesian(Object.keys(resultMap), regions).map(([account, region]) => {
    const accountName = accounts[account]?.name ?? '';
    return [accountName, account, region, ...quotas.map((quota) => resultMap[account][region][quota.QuotaCode])];
  });
  const header = ['accountName', 'accountId', 'region', ...quotas.map((quota) => `${quota.Model}-${quota.Type}`)];
  writeFileSync(reportPath, csvStringify([header, ...rows]));
}

if (import.meta.filename == process.argv[1]) {
  console.log('Retrieving quota ids...');
  const quotas = await getQuotas();

  console.log('Retrieving quotas...');
  const result = (
    await Promise.all(Object.keys(accounts).map(async (account) => checkAccount(account, regions, quotas)))
  )
    .flat()
    .filter((r) => r);

  console.log('Producing report...');
  const reportPath = './quota-report.csv';
  await produceReport(result, quotas, reportPath);

  console.log(`Report written to ${reportPath}`);
}
