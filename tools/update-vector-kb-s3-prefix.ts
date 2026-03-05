#!/usr/bin/env -S node --import tsx
/**
 * Update Bedrock S3 Vectors Data Source inclusionPrefixes to ['documents/']
 * - Supports --client <name> to limit to one client
 * - Supports --dry-run to preview changes
 */
import { Command } from 'commander';
import { getClientConfig, listClients } from '@arcanumai/client-config';
import type { ClientConfig } from '../infra/stacks/numa-client-stack';
import {
  BedrockAgentClient,
  ListKnowledgeBasesCommand,
  ListDataSourcesCommand,
  GetDataSourceCommand,
  UpdateDataSourceCommand,
} from '@aws-sdk/client-bedrock-agent';
import { temporaryCredentials } from './utils';
import type { AWSClientConfig } from './utils';

const program = new Command();
program
  .description("Update S3 Vectors KB Data Source inclusionPrefixes to ['documents/']")
  .option('-c, --client <name>', 'Single client to update')
  .option('--dry-run', 'Preview changes only', false);

type KbDs = {
  kbId: string;
  kbName: string;
  dsId: string;
  dsName: string;
  inclusionPrefixes?: string[];
  bucketArn?: string;
  vectorIngestionConfiguration?: unknown;
};

async function getAwsConfig(clientName: string): Promise<{ cfg: ClientConfig; aws: AWSClientConfig }> {
  const cfg = await getClientConfig<ClientConfig>(clientName);
  const credentials = temporaryCredentials(cfg.clientAccountId);
  const aws = { region: cfg.region, credentials };
  return { cfg, aws };
}

async function findKbAndDs(ba: BedrockAgentClient, clientName: string): Promise<KbDs | null> {
  const kbName = `${clientName}-kb-s3vectors`;
  const dsName = `${clientName}-datasource`;
  const kbList = await ba.send(new ListKnowledgeBasesCommand({}));
  const kb = (kbList.knowledgeBaseSummaries || []).find((k) => k.name === kbName);
  if (!kb?.knowledgeBaseId) return null;
  const dsList = await ba.send(new ListDataSourcesCommand({ knowledgeBaseId: kb.knowledgeBaseId }));
  const ds = (dsList.dataSourceSummaries || []).find((d) => d.name === dsName);
  if (!ds?.dataSourceId) return null;
  try {
    const got = await ba.send(
      new GetDataSourceCommand({ knowledgeBaseId: kb.knowledgeBaseId, dataSourceId: ds.dataSourceId })
    );
    const s3cfg = got.dataSource?.dataSourceConfiguration?.s3Configuration;
    const inclusionPrefixes = s3cfg?.inclusionPrefixes;
    const bucketArn = s3cfg?.bucketArn;
    const vectorIngestionConfiguration = got.dataSource?.vectorIngestionConfiguration;
    return {
      kbId: kb.knowledgeBaseId,
      kbName,
      dsId: ds.dataSourceId,
      dsName,
      inclusionPrefixes,
      bucketArn,
      vectorIngestionConfiguration,
    };
  } catch {
    return { kbId: kb.knowledgeBaseId, kbName, dsId: ds.dataSourceId, dsName };
  }
}

async function updateInclusionPrefixes(
  clientName: string,
  aws: AWSClientConfig,
  kbds: KbDs,
  dryRun: boolean
): Promise<void> {
  const ba = new BedrockAgentClient(aws);
  const desired = ['documents/'];

  if (JSON.stringify(kbds.inclusionPrefixes || []) === JSON.stringify(desired)) {
    console.log(`[${clientName}] Already correct: inclusionPrefixes=${JSON.stringify(desired)} (DS: ${kbds.dsName})`);
    return;
  }

  console.log(
    `[${clientName}] Will set inclusionPrefixes from ${JSON.stringify(kbds.inclusionPrefixes)} to ${JSON.stringify(desired)} (KB: ${kbds.kbName}, DS: ${kbds.dsName})`
  );
  if (dryRun) return;

  // UpdateDataSource with full S3 config (bucketArn required by Bedrock)
  // IMPORTANT: Must include existing vectorIngestionConfiguration to avoid "cannot be updated" errors
  const bucketArn = kbds.bucketArn || `arn:aws:s3:::numa-${clientName}-data`;
  try {
    const updateParams: Record<string, unknown> = {
      dataSourceId: kbds.dsId,
      knowledgeBaseId: kbds.kbId,
      name: kbds.dsName,
      dataSourceConfiguration: {
        type: 'S3' as const,
        s3Configuration: {
          bucketArn,
          inclusionPrefixes: desired,
        },
      },
    };

    // Preserve existing vectorIngestionConfiguration if it exists
    if (kbds.vectorIngestionConfiguration) {
      updateParams.vectorIngestionConfiguration = kbds.vectorIngestionConfiguration;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ba.send(new UpdateDataSourceCommand(updateParams as any));
    console.log(`[${clientName}] UpdateDataSource succeeded (DS: ${kbds.dsName})`);
  } catch (e) {
    console.error(
      `[${clientName}] UpdateDataSource failed. BucketArn=${bucketArn} Desired=${JSON.stringify(desired)} Reason: ${(e as Error).message}`
    );
    throw e;
  }
}

async function runForClient(clientName: string, dryRun: boolean): Promise<void> {
  const { aws } = await getAwsConfig(clientName);
  const ba = new BedrockAgentClient(aws);
  const kbds = await findKbAndDs(ba, clientName);
  if (!kbds) {
    console.log(`[${clientName}] No S3 Vectors KB/Data Source found; skipping`);
    return;
  }
  await updateInclusionPrefixes(clientName, aws, kbds, dryRun);
}

async function main(): Promise<void> {
  program.parse(process.argv);
  const opts = program.opts<{ client?: string; dryRun?: boolean }>();
  const clients = opts.client ? [opts.client] : await listClients();
  for (const c of clients) {
    try {
      await runForClient(c, !!opts.dryRun);
    } catch (e) {
      console.error(`[${c}] Error:`, (e as Error).message);
    }
  }
}

if (import.meta.filename === process.argv[1])
  main().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
