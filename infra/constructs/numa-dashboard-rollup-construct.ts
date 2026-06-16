import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { TerraformOutput, Fn } from 'cdktf';
import path from 'node:path';

export interface NumaDashboardRollupConstructProps {
  /** ARN of the numa-client-config table (in this deployer account) */
  clientConfigTableArn: string;
  /** Name of the numa-client-config table */
  clientConfigTableName: string;
  /** Cron expression for the daily refresh job (default: midnight UTC). */
  scheduleExpression?: string;
  /**
   * Max concurrency for the SFN Map state (per-client fan-out).
   * Cost Explorer is the rate-limiting dependency; raise cautiously.
   * Default: 5.
   */
  maxConcurrency?: number;
  /**
   * In-process concurrency for the legacy `scope: 'all'` Lambda mode
   * (ad-hoc invokes only — the scheduled run uses SFN now). Default: 8.
   */
  perClientConcurrency?: number;
  /** Window in days for rolling metrics (default: 90). */
  windowDays?: number;
  /** TTL for dated snapshots in days (default: 180). */
  snapshotTtlDays?: number;
}

/**
 * Numa Dashboard — fleet-wide analytics rollup.
 *
 * Provisions:
 *   • DynamoDB `numa-portal-fleet-analytics` table (PK clientName, SK sk; TTL).
 *     Sparse GSI `latest-snapshots-index` (PK latest_pk) indexes only the
 *     `SNAPSHOT#latest` rows so the portal Queries ~150 rows instead of
 *     Scanning the full table (dated history is hundreds of MB).
 *   • Lambda `numa-fleet-analytics-rollup` (Python 3.13, 3008MB, 15min, 4GB ephemeral).
 *   • IAM execution role: read client config, write rollups, sts:AssumeRole into client accts.
 *   • Step Functions state machine `numa-fleet-analytics-rollup-orchestrator`:
 *       ListClients → Map(per-client, MaxConcurrency=5).
 *     Replaces the in-process loop; sidesteps the 15min Lambda ceiling as the
 *     fleet grows. One client per invoke; orchestrator state machine is
 *     STANDARD (1-year history). No aggregate pass — the frontend rolls up
 *     from per-client snapshots in the browser.
 *   • EventBridge Scheduler (daily) → state machine (not Lambda).
 *   • Portal invoke happens via the portal role's own IAM policy (same-account
 *     — no resource-based LambdaPermission needed for the portal).
 *
 * Per-client work: Lambda assumes `ArcanumAIAccess` in each client account and
 * reads chat-history / S3 traces / Cost Explorer / Pipedream proxy / etc.
 * Writes the snapshot to this account's DDB table.
 *
 * The Lambda's `scope: 'all'` mode still works for ad-hoc fleet refreshes but
 * is bounded by the 15min timeout — prefer triggering the state machine.
 */
export class NumaDashboardRollupConstruct extends Construct {
  public readonly functionArn: string;
  public readonly functionName: string;
  public readonly tableArn: string;
  public readonly tableName: string;
  public readonly stateMachineArn: string;
  public readonly stateMachineName: string;

  constructor(scope: Construct, id: string, props: NumaDashboardRollupConstructProps) {
    super(scope, id);

    const functionName = 'numa-fleet-analytics-rollup';
    const stateMachineName = 'numa-fleet-analytics-rollup-orchestrator';
    const tableName = 'numa-portal-fleet-analytics';
    const scheduleExpression = props.scheduleExpression ?? 'cron(0 0 * * ? *)';
    const maxConcurrency = props.maxConcurrency ?? 5;
    const perClientConcurrency = props.perClientConcurrency ?? 8;
    const windowDays = props.windowDays ?? 90;
    const snapshotTtlDays = props.snapshotTtlDays ?? 180;

    // ── DynamoDB ────────────────────────────────────────────────────────

    const table = new DynamodbTable(this, 'fleet-analytics-table', {
      name: tableName,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'clientName',
      rangeKey: 'sk',
      attribute: [
        { name: 'clientName', type: 'S' },
        { name: 'sk', type: 'S' },
        // Sparse-GSI partition key — stamped ONLY on `SNAPSHOT#latest` rows
        // (value "LATEST"). Dated history rows omit it, so they never enter the
        // index. Lets the portal Query the ~150 latest snapshots directly
        // instead of Scanning the whole table (which carries hundreds of MB of
        // dated history). See `latest-snapshots-index` below.
        { name: 'latest_pk', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'latest-snapshots-index',
          hashKey: 'latest_pk',
          rangeKey: 'clientName',
          projectionType: 'ALL',
        },
      ],
      ttl: {
        attributeName: 'ttl',
        enabled: true,
      },
      pointInTimeRecovery: { enabled: true },
      deletionProtectionEnabled: true,
      tags: {
        Name: tableName,
        ManagedBy: 'cdktf',
        Component: 'numa-dashboard',
      },
    });

    // ── CloudWatch Logs ─────────────────────────────────────────────────

    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: `/aws/lambda/${functionName}`,
      retentionInDays: 30,
    });

    // ── Lambda Execution Role ───────────────────────────────────────────

    const execRole = new IamRole(this, 'execution-role', {
      name: `${functionName}-execution`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'assume-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const policy = new IamPolicy(this, 'execution-policy', {
      name: `${functionName}-policy`,
      policy: new DataAwsIamPolicyDocument(this, 'policy-doc', {
        statement: [
          {
            sid: 'CloudWatchLogs',
            effect: 'Allow',
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [logGroup.arn, `${logGroup.arn}:*`],
          },
          {
            sid: 'ReadClientConfig',
            effect: 'Allow',
            actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
            resources: [props.clientConfigTableArn],
          },
          {
            // Same-account read of numa-client-metadata. Wildcard ARN avoids a
            // cross-construct dep on customer-success-portal-construct (which
            // owns this table but is built AFTER this construct). Stable name,
            // deployer-account-scoped principal — safe.
            sid: 'ReadClientMetadata',
            effect: 'Allow',
            actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
            resources: ['arn:aws:dynamodb:*:*:table/numa-client-metadata'],
          },
          {
            sid: 'WriteFleetAnalytics',
            effect: 'Allow',
            actions: [
              'dynamodb:PutItem',
              'dynamodb:GetItem',
              'dynamodb:UpdateItem',
              'dynamodb:Query',
              'dynamodb:Scan',
              'dynamodb:BatchWriteItem',
              'dynamodb:DeleteItem',
            ],
            resources: [table.arn],
          },
          {
            sid: 'AssumeRoleIntoClientAccounts',
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            resources: ['arn:aws:iam::*:role/ArcanumAIAccess'],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'role-policy-attachments', {
      roleName: execRole.name,
      policyArns: [policy.arn],
    });

    // ── Lambda Function ─────────────────────────────────────────────────

    const zip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'numa-fleet-analytics-rollup',
      'lambda_function.zip'
    );

    const fn = new LambdaFunction(this, 'function', {
      functionName,
      role: execRole.arn,
      filename: zip,
      sourceCodeHash: Fn.filebase64sha256(zip),
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      // Hot path: scans 100+ client accounts in parallel, pulls thousands of S3
      // trace files per client, computes analytics in memory. Memory-bound.
      memorySize: 3008,
      // Up to 15 min hard cap. Per-client work is parallelised inside, so a
      // fleet refresh of ~150 clients @ concurrency 8 should fit comfortably.
      timeout: 900,
      // Ephemeral storage for in-flight trace buffers; the rollup never persists
      // anything to /tmp but generous headroom avoids OOM surprises.
      ephemeralStorage: { size: 4096 },
      loggingConfig: {
        logGroup: logGroup.name,
        logFormat: 'Text',
      },
      environment: {
        variables: {
          CLIENT_CONFIG_TABLE_NAME: props.clientConfigTableName,
          // Stable name from customer-success-portal-construct. If the table
          // ever moves, update both names + the IAM resource above.
          CLIENT_METADATA_TABLE_NAME: 'numa-client-metadata',
          FLEET_ANALYTICS_TABLE_NAME: table.name,
          ARCANUM_AI_ACCESS_ROLE_NAME: 'ArcanumAIAccess',
          PER_CLIENT_CONCURRENCY: String(perClientConcurrency),
          WINDOW_DAYS: String(windowDays),
          SNAPSHOT_TTL_DAYS: String(snapshotTtlDays),
        },
      },
    });

    // ── Step Functions orchestrator ─────────────────────────────────────
    //
    // Replaces the in-process per-client loop. Sidesteps the Lambda 15min
    // timeout as the fleet grows. Standard workflow so we get a 1-year
    // history of executions visible in the console.
    //
    //     ListClients   ──►   Map(per-client, MaxConcurrency=N)
    //
    // Per-client Catch swallows errors so one bad client doesn't sink the
    // run; failures end up in the Map output for inspection. Aggregates are
    // computed in the browser at dashboard-load time, not by this Lambda.

    const sfnLogGroup = new CloudwatchLogGroup(this, 'sfn-log-group', {
      name: `/aws/vendedlogs/states/${stateMachineName}`,
      retentionInDays: 30,
    });

    const sfnRole = new IamRole(this, 'sfn-execution-role', {
      name: `${stateMachineName}-execution`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'sfn-assume-role', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['states.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const sfnPolicy = new IamPolicy(this, 'sfn-policy', {
      name: `${stateMachineName}-policy`,
      policy: new DataAwsIamPolicyDocument(this, 'sfn-policy-doc', {
        statement: [
          {
            sid: 'InvokeRollupLambda',
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [fn.arn, `${fn.arn}:*`],
          },
          {
            // CloudWatch Logs delivery — Step Functions Standard requires
            // these account-level perms (resource '*') to wire log delivery.
            sid: 'CloudWatchLogsDelivery',
            effect: 'Allow',
            actions: [
              'logs:CreateLogDelivery',
              'logs:GetLogDelivery',
              'logs:UpdateLogDelivery',
              'logs:DeleteLogDelivery',
              'logs:ListLogDeliveries',
              'logs:PutResourcePolicy',
              'logs:DescribeResourcePolicies',
              'logs:DescribeLogGroups',
            ],
            resources: ['*'],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'sfn-role-policy-attachments', {
      roleName: sfnRole.name,
      policyArns: [sfnPolicy.arn],
    });

    const orchestratorDefinition = {
      Comment:
        'Numa fleet-analytics rollup — list clients, fan out per-client refresh. Aggregates computed in the browser.',
      StartAt: 'ListClients',
      States: {
        ListClients: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: fn.arn,
            Payload: { scope: 'list' },
          },
          ResultSelector: {
            'clients.$': '$.Payload.clients',
            'count.$': '$.Payload.count',
          },
          ResultPath: '$',
          Retry: [
            {
              ErrorEquals: [
                'Lambda.ServiceException',
                'Lambda.AWSLambdaException',
                'Lambda.SdkClientException',
                'Lambda.TooManyRequestsException',
              ],
              IntervalSeconds: 5,
              MaxAttempts: 3,
              BackoffRate: 2.0,
            },
          ],
          Next: 'PerClient',
        },
        PerClient: {
          Type: 'Map',
          ItemsPath: '$.clients',
          MaxConcurrency: maxConcurrency,
          Parameters: {
            'clientName.$': '$$.Map.Item.Value.clientName',
          },
          Iterator: {
            StartAt: 'RefreshClient',
            States: {
              RefreshClient: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: fn.arn,
                  Payload: {
                    scope: 'client',
                    'clientName.$': '$.clientName',
                  },
                },
                ResultSelector: {
                  'ok.$': '$.Payload.ok',
                  'clientName.$': '$.Payload.client',
                  'duration_ms.$': '$.Payload.duration_ms',
                },
                Retry: [
                  {
                    // Transient Lambda errors only — surface client-logic
                    // failures (NPE, AWS API throttles in the gather code)
                    // to Catch so they don't burn retries.
                    ErrorEquals: [
                      'Lambda.ServiceException',
                      'Lambda.AWSLambdaException',
                      'Lambda.SdkClientException',
                      'Lambda.TooManyRequestsException',
                    ],
                    IntervalSeconds: 5,
                    MaxAttempts: 2,
                    BackoffRate: 2.0,
                  },
                ],
                Catch: [
                  {
                    ErrorEquals: ['States.ALL'],
                    ResultPath: '$.error',
                    Next: 'RecordFailure',
                  },
                ],
                End: true,
              },
              RecordFailure: {
                // One bad client must not sink the orchestration — record
                // the failure into the Map output and move on.
                Type: 'Pass',
                Parameters: {
                  'clientName.$': '$.clientName',
                  ok: false,
                  'error.$': '$.error',
                },
                End: true,
              },
            },
          },
          ResultPath: '$.perClient',
          End: true,
        },
      },
    };

    const stateMachine = new SfnStateMachine(this, 'orchestrator-state-machine', {
      name: stateMachineName,
      definition: JSON.stringify(orchestratorDefinition),
      roleArn: sfnRole.arn,
      type: 'STANDARD',
      loggingConfiguration: {
        level: 'ALL',
        includeExecutionData: true,
        logDestination: `${sfnLogGroup.arn}:*`,
      },
    });

    // ── EventBridge Scheduler (daily) ───────────────────────────────────
    //
    // Targets the state machine (not the Lambda) — see orchestrator above.

    const schedulerRole = new IamRole(this, 'scheduler-role', {
      name: `${functionName}-scheduler`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'scheduler-assume-role', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['scheduler.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const schedulerPolicy = new IamPolicy(this, 'scheduler-policy', {
      name: `${functionName}-scheduler-invoke`,
      policy: new DataAwsIamPolicyDocument(this, 'scheduler-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['states:StartExecution'],
            resources: [stateMachine.arn],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'scheduler-role-policy-attachments', {
      roleName: schedulerRole.name,
      policyArns: [schedulerPolicy.arn],
    });

    new SchedulerSchedule(this, 'daily-schedule', {
      name: `${functionName}-daily`,
      groupName: 'default',
      scheduleExpression: scheduleExpression,
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: stateMachine.arn,
        roleArn: schedulerRole.arn,
        // Orchestrator takes no input — it lists clients itself.
        input: JSON.stringify({}),
      },
    });

    // Note: no LambdaPermission for the portal — same-account invokes only
    // need IAM permissions on the caller. The portal's authenticated role is
    // granted `lambda:InvokeFunction` on this Lambda's ARN inside
    // customer-success-portal-construct.ts.

    // ── Outputs ─────────────────────────────────────────────────────────

    new TerraformOutput(this, 'function-arn', {
      value: fn.arn,
      description: 'ARN of the Numa Dashboard rollup Lambda',
    });

    new TerraformOutput(this, 'function-name', {
      value: fn.functionName,
      description: 'Name of the Numa Dashboard rollup Lambda',
    });

    new TerraformOutput(this, 'table-arn', {
      value: table.arn,
      description: 'ARN of the numa-portal-fleet-analytics DynamoDB table',
    });

    new TerraformOutput(this, 'table-name', {
      value: table.name,
      description: 'Name of the numa-portal-fleet-analytics DynamoDB table',
    });

    new TerraformOutput(this, 'state-machine-arn', {
      value: stateMachine.arn,
      description: 'ARN of the Numa Dashboard rollup orchestrator state machine',
    });

    new TerraformOutput(this, 'state-machine-name', {
      value: stateMachine.name,
      description: 'Name of the Numa Dashboard rollup orchestrator state machine',
    });

    this.functionArn = fn.arn;
    this.functionName = fn.functionName;
    this.tableArn = table.arn;
    this.tableName = table.name;
    this.stateMachineArn = stateMachine.arn;
    this.stateMachineName = stateMachine.name;
  }
}
