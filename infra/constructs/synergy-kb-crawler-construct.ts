import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { Construct } from 'constructs';
import { NumaCorsEnabledBucket } from './cors-enabled-bucket';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { SqsQueue } from '@cdktf/provider-aws/lib/sqs-queue';
import { LambdaEventSourceMapping } from '@cdktf/provider-aws/lib/lambda-event-source-mapping';
import { CloudwatchMetricAlarm } from '@cdktf/provider-aws/lib/cloudwatch-metric-alarm';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { NumaLambda } from './numa-lambda';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { TerraformOutput } from 'cdktf';

export interface SynergyKbCrawlerConstructProps {
  clientName: string;
  environmentName: string;
  dataBucket: NumaCorsEnabledBucket;
  logGroup: CloudwatchLogGroup;
  region: string;
  /** Credit ledger table (numa-<client>-credit-ledger) the per-crawl ingestion
   *  debit writes into. */
  creditLedgerTableName: string;
  /** Mirror of the credit metering flag — the debit lambda no-ops when false. */
  creditMeteringEnabled?: boolean;
  /** Exact-term inverted index (4th search mode). Driven by the single `synergy`
   *  flag — it provisions whenever the rest of the Synergy surface does (the
   *  quality win is the point; the small DynamoDB write cost is captured by the
   *  crawl's credit debit). When false the worker skips indexing entirely; the
   *  term-job-index GSI exists either way (cheap when empty). */
  termIndexEnabled?: boolean;
}

/**
 * Crawls a client's 12d Synergy instance into a Bedrock-KB corpus for cross-job
 * chat search.
 *
 * A single SQS FIFO queue is the ONE extraction automation job: every trigger
 * (the daily scheduled coordinator, a manual "Sync now", and the on-visit hook)
 * enqueues per-job "extract this job" messages; the worker is the queue's sole
 * consumer (max concurrency 3, gentle on the customer's on-prem 12d server). The
 * coordinator enumerates jobs + reconciles per-document `allowed_users` ACLs and
 * seeds a `RUN#` row with `remaining = job_count`; each worker atomically
 * decrements it on job completion and the one that drives it to zero closes the
 * run and fires a single per-crawl credit debit (Bedrock embedding estimate).
 *
 * Replaces the former Step Function drain-loop + self-restart: SQS gives the
 * queue, dedup (per job_id), retry/DLQ, and concurrency control for free.
 */
export class SynergyKbCrawlerConstruct extends Construct {
  public readonly stateTable: DynamodbTable;
  public readonly extractQueue: SqsQueue;
  public readonly extractQueueUrl: string;
  public readonly coordinatorLambda: LambdaFunction;
  public readonly workerLambda: LambdaFunction;
  public readonly creditDebitLambda: LambdaFunction;

  constructor(scope: Construct, name: string, props: SynergyKbCrawlerConstructProps) {
    super(scope, name);

    const numaClient = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});
    const userVaultSecretArn = `arn:aws:secretsmanager:${props.region}:${callerIdentity.accountId}:secret:${props.clientName}/vault/*`;
    // Single source of truth for the S3 key prefix: the worker writes/deletes
    // under it and the coordinator derives the orphan-purge rollup key from it,
    // so both env blocks (and the IAM ARN) must reference the same literal.
    const s3Prefix = 'documents/synergy';
    const synergyPrefixArn = `${props.dataBucket.bucket.arn}/${s3Prefix}/*`;
    const creditLedgerArn = `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.creditLedgerTableName}`;

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
        { name: 'term', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          // Pending-job lookups + idempotency (status/run_id guards on the
          // worker's conditional MarkJobDone).
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
        {
          // Exact-term search: "all jobs containing token X" = one Query.
          // Base-table pk is sharded TERM#{token}#{job_id} (no hot WRITE
          // partition for common terms); this GSL collapses by term for reads.
          // KEYS_ONLY → returns job_id per hit; the handler reads JOB# for the
          // name + the allowed_users ACL.
          name: 'term-job-index',
          hashKey: 'term',
          rangeKey: 'job_id',
          projectionType: 'KEYS_ONLY',
        },
      ],
      billingMode: 'PAY_PER_REQUEST',
      pointInTimeRecovery: { enabled: true },
    });

    // --- SQS FIFO extraction queue (+ DLQ) ---
    // FIFO gives per-group ordering, NOT cross-run dedup. Senders supply
    // run-scoped MessageDeduplicationId (run_id:job_id:leg:N for run enqueues,
    // adhoc:job_id for on-visit), so the same job from two overlapping runs is
    // intentionally NOT collapsed — each run processes it. Per-job message groups
    // (MessageGroupId = job_id) let different jobs process in parallel up to the
    // ESM's maximumConcurrency. Visibility must exceed the worker timeout (900s)
    // so a long job isn't redelivered mid-flight.
    const extractDlq = new SqsQueue(this, 'extract-dlq', {
      name: `${numaClient}-synergy-extract-dlq.fifo`,
      fifoQueue: true,
      messageRetentionSeconds: 1209600, // 14d
    });
    this.extractQueue = new SqsQueue(this, 'extract-queue', {
      name: `${numaClient}-synergy-extract.fifo`,
      fifoQueue: true,
      // Senders supply a run-scoped MessageDeduplicationId (run_id:job_id:leg:N /
      // adhoc:job_id), so dedup is per-run, not per-job — overlapping runs each
      // process the same job by design.
      contentBasedDeduplication: false,
      // 2× the worker timeout (900s) so a long-running job is never redelivered
      // mid-flight (which would double-process + double-decrement the counter).
      visibilityTimeoutSeconds: 1800,
      messageRetentionSeconds: 345600, // 4d
      redrivePolicy: JSON.stringify({
        deadLetterTargetArn: extractDlq.arn,
        maxReceiveCount: 3,
      }),
    });
    this.extractQueueUrl = this.extractQueue.url;

    // A message in the DLQ = a job that failed 3× (poison / permanent listing
    // error). The stale-run reconcile (coordinator) still closes its run, but a
    // human should look — surface it as an alarm.
    new CloudwatchMetricAlarm(this, 'extract-dlq-alarm', {
      alarmName: `${numaClient}-synergy-extract-dlq-not-empty`,
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensions: { QueueName: extractDlq.name },
      statistic: 'Maximum',
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      treatMissingData: 'notBreaching',
      alarmDescription: 'Synergy extraction job(s) landed in the DLQ — investigate.',
    });

    // --- Credit debit: per-crawl ingestion (Bedrock embedding) drawdown ---
    const creditDebit = new NumaLambda(this, 'credit-debit', {
      clientName: props.clientName,
      lambdaDirectory: 'python/synergy-credit-debit/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_synergy-credit-debit',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
          resources: [creditLedgerArn, `${creditLedgerArn}/index/*`],
        },
      ],
      environment: {
        CLIENT_NAME: props.clientName,
        CREDITS_TABLE_NAME: props.creditLedgerTableName,
        CREDIT_METERING_ENABLED: String(props.creditMeteringEnabled ?? false),
      },
      timeout: 60,
      memorySize: 256,
    });
    this.creditDebitLambda = creditDebit.lambda;

    // --- Worker: zip Lambda, sole consumer of the FIFO queue ---
    // Pure-Python + manylinux2014_x86_64 wheels (pdfplumber/Pillow/lxml/...), so
    // a standard zip like extract-content-from-file — no container/ECR.
    const worker = new NumaLambda(this, 'worker', {
      clientName: props.clientName,
      lambdaDirectory: 'python/synergy-text-crawler/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_synergy-text-crawler',
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
        {
          // Consume the queue (ESM) + re-enqueue partial-page continuations.
          effect: 'Allow',
          actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:SendMessage'],
          resources: [this.extractQueue.arn],
        },
        {
          // Fire the per-run credit debit when a run drains.
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [this.creditDebitLambda.arn],
        },
      ],
      environment: {
        CLIENT_NAME: props.clientName,
        DATA_BUCKET_NAME: props.dataBucket.bucket.bucket,
        STATE_TABLE_NAME: this.stateTable.name,
        KB_ID: 'synergy',
        S3_PREFIX: s3Prefix,
        SYNERGY_EXTRACT_QUEUE_URL: this.extractQueueUrl,
        SYNERGY_CREDIT_DEBIT_FUNCTION_NAME: this.creditDebitLambda.functionName,
        SYNERGY_TERM_INDEX_ENABLED: props.termIndexEnabled ? 'true' : 'false',
      },
      timeout: 900,
      memorySize: 2048,
      ephemeralStorageMb: 2048,
    });
    this.workerLambda = worker.lambda;

    new LambdaEventSourceMapping(this, 'worker-queue-mapping', {
      eventSourceArn: this.extractQueue.arn,
      functionName: this.workerLambda.functionName,
      batchSize: 1,
      // Cap consumer fan-out — the throttle on the customer's 12d server,
      // alongside the worker's per-request pacing.
      scalingConfig: { maximumConcurrency: 3 },
      functionResponseTypes: ['ReportBatchItemFailures'],
    });

    // --- Coordinator: enumerate + reconcile ACLs + enqueue per job ---
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
        {
          // Enqueue per-job extraction messages.
          effect: 'Allow',
          actions: ['sqs:SendMessage'],
          resources: [this.extractQueue.arn],
        },
        {
          // Fire the per-run debit when force-closing a stalled previous run.
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [this.creditDebitLambda.arn],
        },
      ],
      environment: {
        CLIENT_NAME: props.clientName,
        STATE_TABLE_NAME: this.stateTable.name,
        DATA_BUCKET_NAME: props.dataBucket.bucket.bucket,
        S3_PREFIX: s3Prefix,
        SYNERGY_EXTRACT_QUEUE_URL: this.extractQueueUrl,
        SYNERGY_CREDIT_DEBIT_FUNCTION_NAME: this.creditDebitLambda.functionName,
      },
      timeout: 900,
      memorySize: 1024,
    });
    this.coordinatorLambda = coordinator.lambda;

    // --- Scheduled trigger: daily off-peak tick → coordinator. The coordinator
    // decides whether the run actually proceeds (CONFIG#crawl enabled +
    // frequency), so admin changes never require an infra deploy. ---
    const scheduleRole = new IamRole(this, 'schedule-role', {
      name: `${numaClient}-synergy-crawl-schedule-role`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'scheduler.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });
    new IamRolePolicy(this, 'schedule-role-policy', {
      name: 'invoke-synergy-coordinator',
      role: scheduleRole.name,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: this.coordinatorLambda.arn }],
      }),
    });
    new SchedulerSchedule(this, 'daily-schedule', {
      name: `${numaClient}-synergy-kb-crawl-daily`,
      // 03:00, not 02:00: NZ spring-forward jumps 02:00→03:00, so a 02:00 local
      // cron silently never fires that day (EventBridge skips nonexistent
      // times) — losing the once-daily authoritative revocation pass.
      scheduleExpression: 'cron(0 3 * * ? *)',
      scheduleExpressionTimezone: 'Pacific/Auckland',
      flexibleTimeWindow: { mode: 'FLEXIBLE', maximumWindowInMinutes: 30 },
      target: {
        arn: this.coordinatorLambda.arn,
        roleArn: scheduleRole.arn,
        input: JSON.stringify({ trigger: 'scheduled' }),
      },
    });

    new TerraformOutput(this, 'synergy-extract-queue-url', {
      value: this.extractQueueUrl,
    });
  }
}
