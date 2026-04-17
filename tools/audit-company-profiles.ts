/**
 * Audit company profiles across all Numa client accounts.
 * Reports: client name, format (old/new), profile length, whether >3k.
 *
 * Usage: AWS_PROFILE=arcanum-q-deployer-prod npx tsx tools/audit-company-profiles.ts
 */
import { listClients, getClientConfig } from '@arcanumai/client-config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { createRequire } from 'module';

const req = createRequire(import.meta.url);
const prmBundle = req('../lib/prm-node/prm.js');
const withPRM = prmBundle.withPRM || prmBundle.default?.withPRM;

interface BasicConfig {
  clientAccountId: string;
  region: string;
}

interface AuditResult {
  client: string;
  format: 'old' | 'new' | 'empty' | 'error';
  companyInfoLength: number;
  bestPracticesLength: number;
  over3k: boolean;
  error?: string;
}

async function auditClient(clientName: string): Promise<AuditResult> {
  try {
    const config = await getClientConfig<BasicConfig>(clientName);
    const credentials = fromTemporaryCredentials({
      params: {
        RoleArn: `arn:aws:iam::${config.clientAccountId}:role/ArcanumAIAccess`,
      },
    });

    const s3 = withPRM(S3Client, { region: config.region, credentials });
    const bucketName = `numa-${clientName}-company`;

    const resp = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: 'company-data.json' }));
    const body = await resp.Body?.transformToString('utf-8');
    if (!body) {
      return { client: clientName, format: 'empty', companyInfoLength: 0, bestPracticesLength: 0, over3k: false };
    }

    const data = JSON.parse(body);

    // Determine format
    const isNew = 'companyInformation' in data;
    const isOld = 'profile' in data && !isNew;
    const format = isNew ? 'new' : isOld ? 'old' : 'empty';

    const companyInfoLength = isNew ? (data.companyInformation || '').length : isOld ? (data.profile || '').length : 0;
    const bestPracticesLength = (data.bestPractices || '').length;

    return {
      client: clientName,
      format,
      companyInfoLength,
      bestPracticesLength,
      over3k: companyInfoLength > 3000 || bestPracticesLength > 3000,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // NoSuchKey / NoSuchBucket are expected for clients without a profile
    if (msg.includes('NoSuchKey') || msg.includes('NoSuchBucket') || msg.includes('AccessDenied')) {
      return { client: clientName, format: 'empty', companyInfoLength: 0, bestPracticesLength: 0, over3k: false };
    }
    return {
      client: clientName,
      format: 'error',
      companyInfoLength: 0,
      bestPracticesLength: 0,
      over3k: false,
      error: msg,
    };
  }
}

async function main(): Promise<void> {
  const clients = (await listClients()).sort();
  console.log(`Auditing ${clients.length} clients...\n`);

  const results: AuditResult[] = [];

  // Process sequentially to avoid STS throttling
  for (const client of clients) {
    process.stdout.write(`  ${client}...`);
    const result = await auditClient(client);
    results.push(result);
    if (result.format === 'error') {
      process.stdout.write(` ERROR: ${result.error}\n`);
    } else if (result.format === 'empty') {
      process.stdout.write(` (no profile)\n`);
    } else {
      process.stdout.write(
        ` ${result.format} format, info=${result.companyInfoLength}, practices=${result.bestPracticesLength}${result.over3k ? ' ** OVER 3K **' : ''}\n`
      );
    }
  }

  // Summary
  const withProfile = results.filter((r) => r.format !== 'empty' && r.format !== 'error');
  const over3k = results.filter((r) => r.over3k);
  const errors = results.filter((r) => r.format === 'error');

  console.log('\n--- Summary ---');
  console.log(`Total clients: ${clients.length}`);
  console.log(`With profile: ${withProfile.length}`);
  console.log(`Over 3k chars: ${over3k.length}`);
  if (over3k.length > 0) {
    console.log('  Clients over 3k:');
    for (const r of over3k) {
      console.log(`    ${r.client}: info=${r.companyInfoLength}, practices=${r.bestPracticesLength}`);
    }
  }
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    for (const r of errors) {
      console.log(`    ${r.client}: ${r.error}`);
    }
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
