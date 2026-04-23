import { ScheduledHandler } from 'aws-lambda';
import * as process from 'node:process';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ServiceQuotas } from '@aws-sdk/client-service-quotas';
import { getAllClientConfigs } from '@arcanumai/client-config';
import {
  discoverBedrockQuotas,
  fetchQuotaValues,
  buildQuotaReportCsv,
  type QuotaDescriptor,
  type QuotaReportRow,
  type ModelFamily,
  type QuotaType,
  type QuotaMetric,
} from '@numa/quota-snapshot';
import { withPRM } from '../../../lib/prm-node/prm';

const ALL_REGIONS = ['us-east-1', 'ap-southeast-2', 'ap-southeast-3'];

const FAMILIES: ModelFamily[] = ['sonnet', 'opus', 'haiku', 'nova'];
const TYPES: QuotaType[] = ['On-demand', 'Cross-region', 'Global cross-region'];
const METRICS: QuotaMetric[] = ['requests-per-minute', 'tokens-per-minute', 'requests-per-day', 'tokens-per-day'];

// Arcanum internal accounts — mirrors numa-customer-success-portal quotaReportService
const ARCANUM_INTERNAL_ACCOUNTS: { name: string; accountId: string; isDev: boolean }[] = [
  { name: 'arcanum-dev-numa-pipedream-proxy', accountId: '063563181233', isDev: true },
  { name: 'arcanum-dev-q-client', accountId: '872515258482', isDev: true },
  { name: 'arcanum-dev-q-deployer', accountId: '324037291751', isDev: true },
  { name: 'arcanum-prod', accountId: '262893720581', isDev: false },
  { name: 'arcanum-prod-images', accountId: '826326270637', isDev: false },
  { name: 'arcanum-prod-numa-demo', accountId: '619071323471', isDev: false },
  { name: 'arcanum-prod-numa-pipedream-proxy', accountId: '965745962688', isDev: false },
  { name: 'arcanum-prod-q-deployer', accountId: '207567759910', isDev: false },
  { name: 'arcanum-staging', accountId: '978450690680', isDev: true },
  { name: 'Q Demo Account', accountId: '905418183804', isDev: true },
];

interface ClientConfig {
  clientAccountId: string;
  region?: string;
  devInstance?: boolean;
  bedrockAccount?: string;
}

interface AccountGroup {
  accountId: string;
  accountName: string;
  isDev: boolean;
  regions: string[];
  bedrockAccount?: string;
  clientNames: string[];
}

const ARCANUM_AI_ACCESS_ROLE = process.env.ARCANUM_AI_ACCESS_ROLE_NAME || 'ArcanumAIAccess';
const QUOTA_WRITER_ROLE_ARN = process.env.QUOTA_WRITER_ROLE_ARN || '';
const HQ_DATA_BUCKET = process.env.HQ_DATA_BUCKET || '';
const S3_PREFIX = process.env.S3_PREFIX || 'documents/kb-b4ac6b7e-aad7-4fc1-af77-a1d7b83a97cb/Daily';
const CONCURRENCY = Number(process.env.CONCURRENCY || '6');

const sts = withPRM(STSClient, { region: 'us-east-1' });

interface AssumedCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

async function assumeRole(roleArn: string, sessionName: string): Promise<AssumedCreds> {
  const resp = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      DurationSeconds: 3600,
    })
  );
  const c = resp.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error(`AssumeRole returned incomplete credentials for ${roleArn}`);
  }
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  };
}

function buildAccountGroups(configs: Record<string, ClientConfig>): Record<string, AccountGroup> {
  const groups: Record<string, AccountGroup> = {};

  for (const [clientName, cfg] of Object.entries(configs)) {
    if (!cfg) continue;
    const { clientAccountId } = cfg;
    if (!clientAccountId) continue;

    if (!groups[clientAccountId]) {
      groups[clientAccountId] = {
        accountId: clientAccountId,
        accountName: clientName,
        isDev: cfg.devInstance === true,
        regions: [],
        bedrockAccount: cfg.bedrockAccount,
        clientNames: [],
      };
    }
    const g = groups[clientAccountId];
    g.clientNames.push(clientName);
    if (cfg.devInstance) g.isDev = true;
    if (cfg.bedrockAccount && !g.bedrockAccount) g.bedrockAccount = cfg.bedrockAccount;
  }

  for (const g of Object.values(groups)) {
    if (g.isDev) {
      g.regions = ALL_REGIONS;
      // Dev accounts consolidate multiple stack names
      g.accountName = g.clientNames.sort().join(', ');
    } else {
      const first = configs[g.clientNames[0]];
      g.regions = [first.region || 'us-east-1'];
      g.accountName = g.clientNames[0];
    }
  }

  // Append Arcanum internal accounts
  for (const acc of ARCANUM_INTERNAL_ACCOUNTS) {
    if (groups[acc.accountId]) continue; // avoid double-counting if a client shares this account
    groups[acc.accountId] = {
      accountId: acc.accountId,
      accountName: acc.name,
      isDev: acc.isDev,
      regions: ALL_REGIONS,
      clientNames: [],
    };
  }

  return groups;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (cursor < tasks.length) {
      const idx = cursor++;
      try {
        results[idx] = await tasks[idx]();
      } catch (err) {
        console.error(`Task ${idx} failed:`, err);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function discoverQuotasOnce(group: AccountGroup): Promise<QuotaDescriptor[]> {
  const region = group.regions[0];
  const roleArn = `arn:aws:iam::${group.accountId}:role/${ARCANUM_AI_ACCESS_ROLE}`;
  const creds = await assumeRole(roleArn, `quota-snapshot-discover-${group.accountId}`);
  const sq = withPRM(ServiceQuotas, { region, credentials: creds });
  return discoverBedrockQuotas(sq, { families: FAMILIES, types: TYPES, metrics: METRICS });
}

async function fetchGroupRegion(
  group: AccountGroup,
  region: string,
  quotas: QuotaDescriptor[]
): Promise<QuotaReportRow> {
  let values: Record<string, number | null> = {};
  try {
    const roleArn = `arn:aws:iam::${group.accountId}:role/${ARCANUM_AI_ACCESS_ROLE}`;
    const creds = await assumeRole(roleArn, `quota-snapshot-${group.accountId}-${region}`);
    const sq = withPRM(ServiceQuotas, { region, credentials: creds });
    values = await fetchQuotaValues(sq, quotas);
  } catch (err) {
    console.error(`Fetch failed for ${group.accountName} (${group.accountId}) in ${region}:`, err);
  }

  return {
    accountName: group.accountName,
    stackNames: group.isDev && group.clientNames.length > 0 ? group.clientNames : undefined,
    accountId: group.accountId,
    region,
    isDev: group.isDev,
    bedrockAccount: group.bedrockAccount,
    values,
  };
}

// KB ID extracted from the S3 prefix (documents/kb-{uuid}/...)
const KB_ID = process.env.KB_ID || 'b4ac6b7e-aad7-4fc1-af77-a1d7b83a97cb';

async function uploadCsvToHq(csv: string, snapshotDate: string): Promise<string> {
  if (!QUOTA_WRITER_ROLE_ARN) throw new Error('QUOTA_WRITER_ROLE_ARN env var not set');
  if (!HQ_DATA_BUCKET) throw new Error('HQ_DATA_BUCKET env var not set');

  const creds = await assumeRole(QUOTA_WRITER_ROLE_ARN, `quota-snapshot-write-${snapshotDate}`);
  const s3 = withPRM(S3Client, { region: 'us-east-1', credentials: creds });
  const key = `${S3_PREFIX}/quota-snapshot-${snapshotDate}.csv`;
  const metadataKey = `${key}.metadata.json`;

  const metadata = {
    metadataAttributes: {
      kb_id: KB_ID,
      uploaded_at: new Date().toISOString(),
      tenant_id: 'hq',
      uploader_id: 'system-quota-report-daily',
      uploader_email: 'system@arcanum.ai',
    },
  };

  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket: HQ_DATA_BUCKET,
        Key: key,
        Body: csv,
        ContentType: 'text/csv',
      })
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: HQ_DATA_BUCKET,
        Key: metadataKey,
        Body: JSON.stringify(metadata),
        ContentType: 'application/json',
      })
    ),
  ]);
  return `s3://${HQ_DATA_BUCKET}/${key}`;
}

export const handler: ScheduledHandler = async (): Promise<void> => {
  const started = Date.now();
  const snapshotDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  console.log(JSON.stringify({ _name: 'QUOTA_SNAPSHOT_START', snapshotDate, concurrency: CONCURRENCY }));

  const configs = await getAllClientConfigs<ClientConfig>();
  const groups = buildAccountGroups(configs);
  const groupList = Object.values(groups);

  if (groupList.length === 0) {
    console.warn('No accounts to snapshot');
    return;
  }

  // Discover quotas using Q Demo — a known-good account with Bedrock quotas.
  // All accounts share the same Bedrock quota catalog so any would work, but
  // relying on groupList insertion order is fragile.
  const Q_DEMO_ACCOUNT_ID = '905418183804';
  const discoverGroup = groupList.find((g) => g.accountId === Q_DEMO_ACCOUNT_ID) ?? groupList[0];
  const quotas = await discoverQuotasOnce(discoverGroup);
  console.log(
    JSON.stringify({
      _name: 'QUOTA_SNAPSHOT_DISCOVERED',
      quotaCount: quotas.length,
      accountUsed: discoverGroup.accountId,
    })
  );

  if (quotas.length === 0) {
    console.warn('No quotas discovered — aborting');
    return;
  }

  // Fan out: one task per (group, region)
  const tasks: Array<() => Promise<QuotaReportRow>> = [];
  for (const g of groupList) {
    for (const region of g.regions) {
      tasks.push(() => fetchGroupRegion(g, region, quotas));
    }
  }
  const rows = (await runWithConcurrency(tasks, CONCURRENCY)).filter((r): r is QuotaReportRow => !!r);

  rows.sort((a, b) => {
    if (a.isDev !== b.isDev) return a.isDev ? -1 : 1;
    if (a.accountName !== b.accountName) return a.accountName.localeCompare(b.accountName);
    return a.region.localeCompare(b.region);
  });

  const csv = buildQuotaReportCsv(rows, quotas, { snapshotDate });
  const uri = await uploadCsvToHq(csv, snapshotDate);

  console.log(
    JSON.stringify({
      _name: 'QUOTA_SNAPSHOT_COMPLETE',
      snapshotDate,
      accounts: groupList.length,
      rows: rows.length,
      quotas: quotas.length,
      uri,
      durationMs: Date.now() - started,
    })
  );
};
