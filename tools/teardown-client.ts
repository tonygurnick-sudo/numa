import { Command } from 'commander';
import chalk from 'chalk';
import { getClientConfig } from '@arcanumai/client-config';
import { ClientConfig, clientConfigSchema } from '../infra/stacks/numa-client-stack';
import { temporaryCredentials, AWSClientConfig } from './utils';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { SFNClient, ListStateMachinesCommand, ListExecutionsCommand, StopExecutionCommand } from '@aws-sdk/client-sfn';
import {
  IAMClient,
  ListEntitiesForPolicyCommand,
  DetachRolePolicyCommand,
  DetachUserPolicyCommand,
  DetachGroupPolicyCommand,
} from '@aws-sdk/client-iam';
import {
  RDSClient,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  ModifyDBClusterCommand,
  DeleteDBClusterCommand,
  DeleteDBInstanceCommand,
} from '@aws-sdk/client-rds';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { deleteClientConfig } from './delete-config';
import { spawn } from 'node:child_process';
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Options {
  profile?: string;
  check?: boolean;
  region?: string; // override
  skipFinalSnapshot?: boolean;
  yes?: boolean; // skip confirmation
  deleteConfig?: boolean; // delete client config from DynamoDB after teardown
  destroyInfra?: boolean; // run cdktf destroy after teardown
  stack?: string; // explicit CDKTF stack name
}

function logSection(title: string): void {
  console.log(`\n${chalk.bold(title)}\n${'-'.repeat(title.length)}`);
}

async function confirmTeardown(client: string, accountId: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    console.log(chalk.yellow('This will delete data and resources for the client.'));
    console.log(`Client: ${chalk.bold(client)} | Account ID: ${chalk.bold(accountId)}`);
    const prompt = `Type "${client} ${accountId}" to confirm, or anything else to cancel: `;
    const answer = await rl.question(prompt);
    return answer.trim() === `${client} ${accountId}`;
  } finally {
    rl.close();
  }
}

async function buildAwsConfig(client: string, opts: Options): Promise<{ cfg: AWSClientConfig; config: ClientConfig }> {
  const config = await getClientConfig<ClientConfig>(client, clientConfigSchema);
  const region = opts.region ?? config.region ?? 'us-east-1';
  const credentials = temporaryCredentials(config.clientAccountId);
  return { cfg: { region, credentials }, config };
}

async function emptyBucketIfExists(s3: S3Client, bucket: string, checkOnly: boolean): Promise<void> {
  try {
    // Quick existence check via listing a single object page
    let ContinuationToken: string | undefined = undefined;
    let foundAny = false;
    do {
      const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken }));
      const Objects = list.Contents ?? [];
      if (Objects.length > 0) {
        foundAny = true;
        if (checkOnly) {
          console.log(`${bucket}: ${Objects.length} objects (showing first page), would delete`);
        } else {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: Objects.map((o) => ({ Key: o.Key! })) },
            }),
          );
          console.log(`${bucket}: deleted ${Objects.length} objects`);
        }
      }
      ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (ContinuationToken);
    if (!foundAny) console.log(`${bucket}: empty or not found`);
  } catch (e: any) {
    if (e?.name === 'NoSuchBucket') {
      console.log(`${bucket}: does not exist`);
    } else {
      console.warn(`Warning: could not process ${bucket}:`, e?.message ?? e);
    }
  }
}

async function stopRunningExecutions(sfn: SFNClient, client: string, checkOnly: boolean): Promise<void> {
  const sms = await sfn.send(new ListStateMachinesCommand({}));
  const targets = (sms.stateMachines ?? []).filter((sm) => sm.name?.includes(client));
  if (targets.length === 0) {
    console.log('Step Functions: no state machines matching client');
    return;
  }
  for (const sm of targets) {
    const execs = await sfn.send(
      new ListExecutionsCommand({
        stateMachineArn: sm.stateMachineArn,
        statusFilter: 'RUNNING',
      }),
    );
    const running = execs.executions ?? [];
    if (running.length === 0) {
      console.log(`SFN ${sm.name}: no RUNNING executions`);
      continue;
    }
    if (checkOnly) {
      console.log(`SFN ${sm.name}: would stop ${running.length} executions`);
    } else {
      for (const ex of running) {
        await sfn.send(new StopExecutionCommand({ executionArn: ex.executionArn! }));
      }
      console.log(`SFN ${sm.name}: stopped ${running.length} executions`);
    }
  }
}

async function detachIamPolicies(iam: IAMClient, client: string, accountId: string, checkOnly: boolean): Promise<void> {
  const policies = [
    `arn:aws:iam::${accountId}:policy/${client}-ingestion-scheduled-event`,
    `arn:aws:iam::${accountId}:policy/${client}-ingestion-state-machine`,
  ];
  // If caller didn't export AWS_ACCOUNT_ID, still try both but ignore failures
  for (const policyArn of policies) {
    try {
      const entities = await iam.send(new ListEntitiesForPolicyCommand({ PolicyArn: policyArn }));
      const roles = entities.PolicyRoles ?? [];
      const users = entities.PolicyUsers ?? [];
      const groups = entities.PolicyGroups ?? [];
      const total = roles.length + users.length + groups.length;
      if (total === 0) {
        console.log(`${policyArn}: no attachments`);
        continue;
      }
      if (checkOnly) {
        console.log(`${policyArn}: would detach from ${total} entities`);
        continue;
      }
      for (const r of roles) {
        await iam.send(new DetachRolePolicyCommand({ RoleName: r.RoleName!, PolicyArn: policyArn }));
      }
      for (const u of users) {
        await iam.send(new DetachUserPolicyCommand({ UserName: u.UserName!, PolicyArn: policyArn }));
      }
      for (const g of groups) {
        await iam.send(new DetachGroupPolicyCommand({ GroupName: g.GroupName!, PolicyArn: policyArn }));
      }
      console.log(`${policyArn}: detached from ${total} entities`);
    } catch (e: any) {
      console.warn(`Warning: IAM detach for ${policyArn} skipped: ${e?.message ?? e}`);
    }
  }
}

async function deleteRds(
  rds: RDSClient,
  client: string,
  checkOnly: boolean,
  skipFinalSnapshot: boolean,
): Promise<void> {
  const clusterId = `${client}-knowledge-base`;
  const instanceId = `${client}-knowledge-base-instance`;
  // Instances first (Aurora requirement)
  try {
    const di = await rds.send(new DescribeDBInstancesCommand({}));
    const ours = (di.DBInstances ?? []).filter((i) => i.DBInstanceIdentifier?.includes(instanceId));
    if (ours.length > 0) {
      if (checkOnly) {
        console.log(`RDS: would delete ${ours.length} instance(s)`);
      } else {
        for (const inst of ours) {
          await rds.send(
            new DeleteDBInstanceCommand({ DBInstanceIdentifier: inst.DBInstanceIdentifier!, SkipFinalSnapshot: true }),
          );
          console.log(`RDS: deleting instance ${inst.DBInstanceIdentifier}`);
        }
      }
    } else {
      console.log('RDS: no matching instances');
    }
  } catch (e) {
    console.warn('Warning: RDS instances check failed:', (e as any)?.message ?? e);
  }

  // Cluster
  try {
    const dc = await rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: clusterId }));
    const cluster = (dc.DBClusters ?? [])[0];
    if (!cluster) {
      console.log('RDS: cluster not found');
      return;
    }
    if (checkOnly) {
      console.log(`RDS: would delete cluster ${clusterId} (skipFinalSnapshot=${skipFinalSnapshot})`);
      return;
    }
    // Ensure deletion protection is off
    if (cluster.DeletionProtection) {
      await rds.send(
        new ModifyDBClusterCommand({
          DBClusterIdentifier: clusterId,
          DeletionProtection: false,
          ApplyImmediately: true,
        }),
      );
    }
    await rds.send(
      new DeleteDBClusterCommand({
        DBClusterIdentifier: clusterId,
        SkipFinalSnapshot: !!skipFinalSnapshot,
        ...(skipFinalSnapshot ? {} : { FinalDBSnapshotIdentifier: `${clusterId}-final-${Date.now()}` }),
      }),
    );
    console.log(`RDS: delete initiated for cluster ${clusterId}`);
  } catch (e: any) {
    if (e?.name === 'DBClusterNotFoundFault') {
      console.log('RDS: cluster not found');
    } else {
      console.warn('Warning: RDS cluster delete failed:', e?.message ?? e);
    }
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('teardown-client')
    .argument('<client>', 'client slug, e.g. bendigo-council')
    .option('--profile <name>', 'AWS profile used to read client config (delegated admin)', 'arcanum-q-deployer-prod')
    .option('--region <name>', 'override region from client config')
    .option('--check', 'check/dry-run only', false)
    .option('--yes', 'skip confirmation prompt (DANGEROUS)', false)
    .option('--delete-config', 'delete client config from DynamoDB after successful teardown', false)
    .option('--destroy-infra', 'run `yarn cdktf destroy --auto-approve` for the client stack after teardown', false)
    .option('--stack <name>', 'explicit CDKTF stack name to destroy (defaults to numa-<client>)')
    .option('--no-skip-final-snapshot', 'when deleting RDS cluster, create a final snapshot instead of skipping', false)
    .action(async (client: string, opts: Options) => {
      try {
        logSection(`Teardown for ${client}`);
        // Ensure AWS profile is honored for reading client config and assuming roles
        if (opts.profile) {
          process.env.AWS_PROFILE = opts.profile;
        } else if (!process.env.AWS_PROFILE) {
          process.env.AWS_PROFILE = 'arcanum-q-deployer-prod';
        }
        const { cfg, config } = await buildAwsConfig(client, opts);
        // Ensure region envs to avoid ap-southeast-21 mishaps
        process.env.AWS_REGION = cfg.region;
        process.env.AWS_DEFAULT_REGION = cfg.region;

        const s3 = new S3Client(cfg);
        const sfn = new SFNClient(cfg);
        const iam = new IAMClient(cfg);
        const rds = new RDSClient(cfg);

        const checkOnly = !!opts.check;
        const skipFinalSnapshot = opts.skipFinalSnapshot !== false;

        if (!checkOnly && !opts.yes) {
          logSection('Confirmation');
          const ok = await confirmTeardown(client, config.clientAccountId);
          if (!ok) {
            console.log('Aborted by user.');
            process.exit(1);
          }
        }

        logSection('S3 buckets');
        const bucketsToEmpty = [`numa-${client}-data`, `numa-${client}-outputs`, `numa-${client}-fe`];
        for (const b of bucketsToEmpty) await emptyBucketIfExists(s3, b, checkOnly);

        logSection('Step Functions');
        await stopRunningExecutions(sfn, client, checkOnly);

        logSection('IAM Policies');
        await detachIamPolicies(iam, client, config.clientAccountId, checkOnly);

        logSection('RDS');
        await deleteRds(rds, client, checkOnly, skipFinalSnapshot);

        // Defer deletion of client config until after infra destroy
        const deleteRequested = !checkOnly && !!opts.deleteConfig;

        // Optionally destroy infra via CDKTF
        let destroySucceeded: boolean | undefined;
        if (!checkOnly && opts.destroyInfra) {
          logSection('Destroy Infrastructure (CDKTF)');
          const candidates = opts.stack ? [opts.stack] : [`numa-${client}`, `${client}`];
          let success = false;
          for (const stackName of candidates) {
            // Attempt destroy for this candidate
            await new Promise<void>((resolve) => {
              const finalSnapWanted = !skipFinalSnapshot ? 'false' : 'true';
              const envVars: NodeJS.ProcessEnv = {
                ...process.env,
                CLIENT_OVERRIDE: client,
                TF_VAR_skip_final_snapshot: finalSnapWanted,
              };
              if (!skipFinalSnapshot) {
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                envVars.TF_VAR_final_snapshot_identifier = `${stackName}-final-${ts}`;
              }
              const child = spawn('yarn', ['cdktf', 'destroy', '--auto-approve', stackName], {
                cwd: new URL('../infra', import.meta.url).pathname,
                stdio: 'inherit',
                env: envVars,
              });
              child.on('close', (code) => {
                if (code === 0) {
                  console.log(`CDKTF destroy completed for ${stackName}`);
                  success = true;
                } else {
                  console.error(
                    `CDKTF destroy failed with code ${code}. You can run: yarn -C infra cdktf destroy ${stackName}`,
                  );
                }
                resolve();
              });
            });
            if (success) break;
          }
          if (!success) {
            console.error('CDKTF destroy did not complete. If your stack name differs, rerun with:');
            console.error(`  yarn teardown-client ${client} --destroy-infra --stack <exact-stack-name>`);
          }
          destroySucceeded = success;
        }

        // Perform deferred delete-config if requested and safe
        if (deleteRequested && (!opts.destroyInfra || destroySucceeded === true)) {
          logSection('Delete Client Config');
          try {
            const ok = await deleteClientConfig(client, !!opts.yes);
            if (ok) {
              console.log(`Client config for '${client}' deleted successfully.`);
            } else {
              console.log(`Client config for '${client}' was not deleted (cancelled or not found).`);
            }
          } catch (e: any) {
            console.error(`Failed to delete client config for '${client}':`, e?.message ?? e);
          }
        } else if (deleteRequested && destroySucceeded === false) {
          console.log('\nSkipping client config deletion because CDKTF destroy did not succeed.');
        }

        if (opts.destroyInfra && destroySucceeded === false) {
          const hint = opts.stack ? opts.stack : `numa-${client}`;
          console.log(
            `\nDone. Next: try 'yarn -C infra cdktf destroy ${hint}' or pass --stack with the exact stack name.`,
          );
        } else if (!opts.destroyInfra) {
          console.log('\nDone. Next: run `yarn -C infra cdktf destroy numa-' + client + '` to remove remaining infra.');
        }
      } catch (e: any) {
        console.error('Error:', e?.message ?? e);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

void main();
