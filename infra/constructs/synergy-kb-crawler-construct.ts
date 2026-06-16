import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { Construct } from 'constructs';
import { NumaCorsEnabledBucket } from './cors-enabled-bucket';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { NumaLambda } from './numa-lambda';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { Fn, TerraformOutput } from 'cdktf';
import { Resource as NullResource } from '@cdktf/provider-null/lib/resource';
import path from 'node:path';

export interface SynergyKbCrawlerConstructProps {
  clientName: string;
  environmentName: string;
  dataBucket: NumaCorsEnabledBucket;
  logGroup: CloudwatchLogGroup;
  region: string;
  /** Deployer role ARN for chain assume during ECR push */
  deployerRoleArn: string;
}

/**
 * Crawls a client's 12d Synergy instance into a Bedrock-KB corpus for cross-job
 * chat search. A coordinator enumerates jobs into a state table, a Step Function
 * drains pending jobs through a container worker that extracts document text and
 * writes `.txt` + `.metadata.json` (with per-document `allowed_users` ACL) into
 * `documents/synergy/` in the data bucket, where the existing bucket-wide Bedrock
 * ingestion picks them up. Mirrors WebCrawlerConstruct (ECR/skopeo push, SFN Map
 * drain + self-restart near the history limit).
 */
export class SynergyKbCrawlerConstruct extends Construct {
  public readonly stateTable: DynamodbTable;
  public readonly stateMachine: SfnStateMachine;
  public readonly stateMachineName: string;
  public readonly coordinatorLambda: LambdaFunction;
  public readonly workerLambda: LambdaFunction;
  public readonly restartLambda: LambdaFunction;

  constructor(scope: Construct, name: string, props: SynergyKbCrawlerConstructProps) {
    super(scope, name);

    const numaClient = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;
    const stateMachineName = `${numaClient}-synergy-kb-crawl`;
    this.stateMachineName = stateMachineName;

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});
    const userVaultSecretArn = `arn:aws:secretsmanager:${props.region}:${callerIdentity.accountId}:secret:${props.clientName}/vault/*`;
    const synergyPrefixArn = `${props.dataBucket.bucket.arn}/documents/synergy/*`;

    // --- Crawl state table: FILE# / JOB# / RUN# / CONFIG# single-table ---
    this.stateTable = new DynamodbTable(this, 'crawl-state-table', {
      name: `${numaClient}-synergy-crawl-state`,
      hashKey: 'pk',
      rangeKey: 'sk',
      attribute: [
        { name: 'pk', type: 'S' },
        { name: 'sk', type: 'S' },
        { name: 'run_id', type: 'S' },
        { name: 'status', type: 'S' },
        { name: 'job_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          // SFN drains pending jobs for a run: run_id = :r AND status = pending
          name: 'run-status-index',
          hashKey: 'run_id',
          rangeKey: 'status',
          projectionType: 'ALL',
        },
        {
          // Deletion sweep / orphan purge: all FILE# rows of a job.
          name: 'job-index',
          hashKey: 'job_id',
          projectionType: 'ALL',
        },
      ],
      billingMode: 'PAY_PER_REQUEST',
      pointInTimeRecovery: { enabled: true },
    });

    // --- Worker: container image Lambda (document text extractors) ---
    const workerEcr = new EcrRepository(this, 'worker-ecr', {
      name: `numa-${props.clientName}-synergy-text-crawler`,
      imageScanningConfiguration: { scanOnPush: true },
      forceDelete: true,
    });

    const imageTarPath = path.resolve(
      import.meta.dirname,
      '..',
      'assets',
      'artifacts',
      'synergy-text-crawler',
      'image.tar'
    );
    const imageTarHash = Fn.filesha256(imageTarPath);
    const imageTag = Fn.substr(imageTarHash, 0, 12);

    const pushImage = new NullResource(this, 'push-worker-image', {
      triggers: { image_tag: imageTag },
      provisioners: [
        {
          type: 'local-exec',
          command: `
set -e

echo "Assuming deployer role..."
DEPLOYER_CREDS=$(aws sts assume-role \\
  --role-arn ${props.deployerRoleArn} \\
  --role-session-name skopeo-deployer \\
  --query 'Credentials' \\
  --output json)

export AWS_ACCESS_KEY_ID=$(echo $DEPLOYER_CREDS | jq -r .AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo $DEPLOYER_CREDS | jq -r .SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo $DEPLOYER_CREDS | jq -r .SessionToken)

echo "Assuming client role..."
CLIENT_CREDS=$(aws sts assume-role \\
  --role-arn arn:aws:iam::${callerIdentity.accountId}:role/ArcanumAIAccess \\
  --role-session-name skopeo-push \\
  --query 'Credentials' \\
  --output json)

export AWS_ACCESS_KEY_ID=$(echo $CLIENT_CREDS | jq -r .AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo $CLIENT_CREDS | jq -r .SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo $CLIENT_CREDS | jq -r .SessionToken)

aws ecr get-login-password --region ${props.region} | \\
  skopeo login --authfile /tmp/skopeo-auth-synergy.json --username AWS --password-stdin ${callerIdentity.accountId}.dkr.ecr.${props.region}.amazonaws.com

REPO_NAME="numa-${props.clientName}-synergy-text-crawler"
IMAGES=$(aws ecr list-images --repository-name "$REPO_NAME" --region ${props.region} --query 'imageIds[*]' --output json 2>/dev/null || echo "[]")
if [ "$IMAGES" != "[]" ] && [ -n "$IMAGES" ]; then
  aws ecr batch-delete-image --repository-name "$REPO_NAME" --region ${props.region} --image-ids "$IMAGES" || true
fi

skopeo copy --authfile /tmp/skopeo-auth-synergy.json --insecure-policy \\
  docker-archive:${imageTarPath} \\
  docker://${workerEcr.repositoryUrl}:${imageTag}

echo "Pushed synergy-text-crawler image to ${workerEcr.repositoryUrl}:${imageTag}"
`,
        },
      ],
    });

    const worker = new NumaLambda(this, 'worker', {
      clientName: props.clientName,
      logGroup: props.logGroup,
      resourceNameSuffix: '_synergy-text-crawler',
      packageType: 'Image',
      architecture: 'arm64',
      imageUri: `${workerEcr.repositoryUrl}:${imageTag}`,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:PutObject', 's3:DeleteObject', 's3:GetObject'],
          resources: [synergyPrefixArn],
        },
        {
          effect: 'Allow',
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
          ],
          resources: [this.stateTable.arn, `${this.stateTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [userVaultSecretArn],
        },
      ],
      environment: {
        CLIENT_NAME: props.clientName,
        DATA_BUCKET_NAME: props.dataBucket.bucket.bucket,
        STATE_TABLE_NAME: this.stateTable.name,
        KB_ID: 'synergy',
        S3_PREFIX: 'documents/synergy',
      },
      timeout: 900,
      memorySize: 2048,
      ephemeralStorageMb: 2048,
    });
    worker.lambda.addOverride('depends_on', [`null_resource.${pushImage.friendlyUniqueId}`]);
    this.workerLambda = worker.lambda;

    const coordinator = new NumaLambda(this, 'coordinator', {
      clientName: props.clientName,
      lambdaDirectory: 'python/synergy-crawl-coordinator/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_synergy-crawl-coordinator',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: [
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:GetItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
          ],
          resources: [this.stateTable.arn, `${this.stateTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [userVaultSecretArn],
        },
        {
          // Scheduled permission pass discovers connected users by vault prefix.
          // ListSecrets has no resource-level scoping; reads stay scoped above.
          effect: 'Allow',
          actions: ['secretsmanager:ListSecrets'],
          resources: ['*'],
        },
        {
          // Orphan purge (no verified user sees the job anymore).
          effect: 'Allow',
          actions: ['s3:DeleteObject'],
          resources: [synergyPrefixArn],
        },
      ],
      environment: {
        CLIENT_NAME: props.clientName,
        STATE_TABLE_NAME: this.stateTable.name,
        DATA_BUCKET_NAME: props.dataBucket.bucket.bucket,
      },
      timeout: 900,
      memorySize: 1024,
    });
    this.coordinatorLambda = coordinator.lambda;

    const restart = new NumaLambda(this, 'restart', {
      clientName: props.clientName,
      lambdaDirectory: 'python/synergy-crawl-restart/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_synergy-crawl-restart',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['states:StartExecution'],
          resources: [`arn:aws:states:${props.region}:*:stateMachine:${stateMachineName}`],
        },
      ],
    });
    this.restartLambda = restart.lambda;

    // --- Step Function: coordinator -> drain pending jobs -> worker -> restart ---
    const sfnPolicyDoc = new DataAwsIamPolicyDocument(this, 'sfn-policy-doc', {
      statement: [
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [this.coordinatorLambda.arn, this.workerLambda.arn, this.restartLambda.arn],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
          resources: [this.stateTable.arn, `${this.stateTable.arn}/index/*`],
        },
        {
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
    });

    const sfnRole = new IamRole(this, 'sfn-role', {
      name: `${stateMachineName}-step-function-role`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'states.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });
    new IamRolePolicy(this, 'sfn-role-policy', {
      name: 'step-function-policy',
      role: sfnRole.name,
      policy: sfnPolicyDoc.json,
    });

    const definition = {
      Comment: 'Synergy 12d -> Bedrock KB crawler',
      TimeoutSeconds: 86400, // 24h
      StartAt: 'CheckContinuation',
      States: {
        CheckContinuation: {
          Type: 'Choice',
          Choices: [
            {
              And: [
                { Variable: '$.continue', IsPresent: true },
                { Variable: '$.continue', BooleanEquals: true },
              ],
              Next: 'InitEventCounter',
            },
          ],
          Default: 'RunCoordinator',
        },
        RunCoordinator: {
          Type: 'Task',
          Resource: this.coordinatorLambda.arn,
          ResultPath: '$.coord',
          Next: 'CheckEnabled',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
              IntervalSeconds: 5,
              MaxAttempts: 2,
              BackoffRate: 2,
            },
          ],
        },
        // Scheduled runs short-circuit when the crawl is disabled / not due.
        CheckEnabled: {
          Type: 'Choice',
          Choices: [{ Variable: '$.coord.enabled', BooleanEquals: false, Next: 'SkipRun' }],
          Default: 'ApplyCoordinatorOutput',
        },
        SkipRun: { Type: 'Succeed' },
        // Promote the coordinator's resolved run identity (scheduled runs carry
        // no creds in the execution input — the coordinator resolves them).
        ApplyCoordinatorOutput: {
          Type: 'Pass',
          Parameters: {
            'run_id.$': '$.coord.run_id',
            'user_sub.$': '$.coord.user_sub',
            'secret_id.$': '$.coord.secret_id',
            'instance_url.$': '$.coord.instance_url',
          },
          Next: 'InitEventCounter',
        },
        InitEventCounter: {
          Type: 'Pass',
          Result: 0,
          ResultPath: '$.eventCounter',
          Next: 'InitCounter',
        },
        InitCounter: {
          Type: 'Choice',
          Choices: [{ Variable: '$.counter', IsPresent: true, Next: 'GetNextPending' }],
          Default: 'SetCounterZero',
        },
        SetCounterZero: {
          Type: 'Pass',
          Result: 0,
          ResultPath: '$.counter',
          Next: 'GetNextPending',
        },
        GetNextPending: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:query',
          Parameters: {
            TableName: this.stateTable.name,
            IndexName: 'run-status-index',
            KeyConditionExpression: '#rid = :run AND #st = :pending',
            ExpressionAttributeNames: { '#rid': 'run_id', '#st': 'status' },
            ExpressionAttributeValues: {
              ':run': { 'S.$': '$.run_id' },
              ':pending': { S: 'pending' },
            },
            Limit: 1,
          },
          ResultPath: '$.next',
          Next: 'HasJob',
        },
        HasJob: {
          Type: 'Choice',
          Choices: [
            { Variable: '$.next.Count', NumericEquals: 0, Next: 'MarkRunDone' },
            { Variable: '$.counter', NumericGreaterThanEquals: 50000, Next: 'MarkRunDone' },
          ],
          Default: 'ExtractJob',
        },
        ExtractJob: {
          Type: 'Pass',
          Parameters: {
            'pk.$': '$.next.Items[0].pk.S',
            'job_id.$': '$.next.Items[0].job_id.S',
            'job_name.$': '$.next.Items[0].job_name.S',
            'job_path.$': '$.next.Items[0].job_path.S',
            'run_id.$': '$.run_id',
            'user_sub.$': '$.user_sub',
            // Per-job crawl credential: a user who provably sees this job
            // (set by the coordinator), so every job is crawlable even when
            // the run-level credential can't see it.
            'secret_id.$': '$.next.Items[0].crawl_secret_id.S',
            'instance_url.$': '$.instance_url',
            'counter.$': '$.counter',
            'eventCounter.$': '$.eventCounter',
            cursor: null,
          },
          Next: 'CheckEventLimit',
        },
        CheckEventLimit: {
          Type: 'Choice',
          Choices: [{ Variable: '$.eventCounter', NumericGreaterThanEquals: 18000, Next: 'RestartExecution' }],
          Default: 'ProcessJob',
        },
        RestartExecution: {
          Type: 'Task',
          Resource: this.restartLambda.arn,
          Parameters: { 'input.$': '$', 'stateMachineArn.$': '$$.StateMachine.Id' },
          End: true,
          // The restart lambda raises on StartExecution failure so the run
          // doesn't end "successfully" with pending jobs stranded.
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
              IntervalSeconds: 5,
              MaxAttempts: 3,
              BackoffRate: 2,
            },
          ],
        },
        ProcessJob: {
          Type: 'Task',
          Resource: this.workerLambda.arn,
          Parameters: {
            'job_id.$': '$.job_id',
            'job_name.$': '$.job_name',
            'job_path.$': '$.job_path',
            'run_id.$': '$.run_id',
            'user_sub.$': '$.user_sub',
            'secret_id.$': '$.secret_id',
            'instance_url.$': '$.instance_url',
            'cursor.$': '$.cursor',
          },
          ResultPath: '$.process',
          Next: 'JobComplete',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
              IntervalSeconds: 5,
              MaxAttempts: 2,
              BackoffRate: 2,
            },
          ],
          Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkJobDone' }],
        },
        JobComplete: {
          Type: 'Choice',
          Choices: [{ Variable: '$.process.job_status', StringEquals: 'partial', Next: 'ContinueJob' }],
          Default: 'MarkJobDone',
        },
        ContinueJob: {
          Type: 'Pass',
          Parameters: {
            'pk.$': '$.pk',
            'job_id.$': '$.job_id',
            'job_name.$': '$.job_name',
            'job_path.$': '$.job_path',
            'run_id.$': '$.run_id',
            'user_sub.$': '$.user_sub',
            'secret_id.$': '$.secret_id',
            'instance_url.$': '$.instance_url',
            'counter.$': '$.counter',
            'cursor.$': '$.process.cursor',
            // A partial loop re-runs ProcessJob (~12 history events).
            'eventCounter.$': 'States.MathAdd($.eventCounter, 12)',
          },
          Next: 'CheckEventLimit',
        },
        MarkJobDone: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.stateTable.name,
            Key: { pk: { 'S.$': '$.pk' }, sk: { S: 'META' } },
            UpdateExpression: 'SET #st = :done',
            // Only mark done if the row still belongs to THIS run. A concurrent
            // run's coordinator may have re-seeded the job (status=pending,
            // run_id=other) with a rebuilt ACL that still needs propagating —
            // blindly setting done would silently skip that run's restamp.
            ConditionExpression: 'run_id = :run',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':done': { S: 'done' }, ':run': { 'S.$': '$.run_id' } },
          },
          ResultPath: '$.markResult',
          Next: 'IncrementCounters',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
              IntervalSeconds: 3,
              MaxAttempts: 3,
              BackoffRate: 2,
            },
          ],
          // Condition failure = a newer run owns the row now; leave it pending
          // for that run and move on.
          Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.markError', Next: 'IncrementCounters' }],
        },
        IncrementCounters: {
          Type: 'Pass',
          Parameters: {
            'run_id.$': '$.run_id',
            'user_sub.$': '$.user_sub',
            'secret_id.$': '$.secret_id',
            'instance_url.$': '$.instance_url',
            'counter.$': 'States.MathAdd($.counter, 1)',
            // Each job burns ~25 Step Functions history events across its states;
            // restart well before the 25k hard limit (CheckEventLimit @ 18000).
            'eventCounter.$': 'States.MathAdd($.eventCounter, 25)',
          },
          Next: 'GetNextPending',
        },
        MarkRunDone: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.stateTable.name,
            Key: { pk: { 'S.$': "States.Format('RUN#{}', $.run_id)" }, sk: { S: 'META' } },
            UpdateExpression: 'SET #st = :done',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':done': { S: 'done' } },
          },
          ResultPath: '$.runResult',
          Next: 'Done',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
              IntervalSeconds: 3,
              MaxAttempts: 3,
              BackoffRate: 2,
            },
          ],
        },
        Done: { Type: 'Succeed' },
      },
    };

    this.stateMachine = new SfnStateMachine(this, 'state-machine', {
      name: stateMachineName,
      roleArn: sfnRole.arn,
      definition: JSON.stringify(definition),
      type: 'STANDARD',
      loggingConfiguration: {
        level: 'ALL',
        includeExecutionData: true,
        logDestination: `${props.logGroup.arn}:*`,
      },
    });

    [
      { id: 'coordinator', lambda: this.coordinatorLambda },
      { id: 'worker', lambda: this.workerLambda },
      { id: 'restart', lambda: this.restartLambda },
    ].forEach(({ id, lambda }) => {
      new LambdaPermission(this, `${id}-sfn-permission`, {
        action: 'lambda:InvokeFunction',
        functionName: lambda.functionName,
        principal: 'states.amazonaws.com',
        sourceArn: this.stateMachine.arn,
      });
    });

    // --- Scheduled trigger: daily off-peak tick. The coordinator decides
    // whether the run actually proceeds (CONFIG#crawl enabled + frequency),
    // so admin changes never require an infra deploy. ---
    const scheduleRole = new IamRole(this, 'schedule-role', {
      name: `${stateMachineName}-schedule-role`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'scheduler.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });
    new IamRolePolicy(this, 'schedule-role-policy', {
      name: 'start-synergy-crawl',
      role: scheduleRole.name,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'states:StartExecution', Resource: this.stateMachine.arn }],
      }),
    });
    new SchedulerSchedule(this, 'daily-schedule', {
      name: `${stateMachineName}-daily`,
      // 03:00, not 02:00: NZ spring-forward jumps 02:00→03:00, so a 02:00 local
      // cron silently never fires that day (EventBridge skips nonexistent
      // times) — losing the once-daily authoritative revocation pass.
      scheduleExpression: 'cron(0 3 * * ? *)',
      scheduleExpressionTimezone: 'Pacific/Auckland',
      flexibleTimeWindow: { mode: 'FLEXIBLE', maximumWindowInMinutes: 30 },
      target: {
        arn: this.stateMachine.arn,
        roleArn: scheduleRole.arn,
        input: JSON.stringify({ trigger: 'scheduled' }),
      },
    });

    new TerraformOutput(this, 'synergy-crawl-state-machine-arn', {
      value: this.stateMachine.arn,
    });
  }
}
