import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { CloudwatchMetricAlarm } from '@cdktf/provider-aws/lib/cloudwatch-metric-alarm';
import { SqsQueue } from '@cdktf/provider-aws/lib/sqs-queue';
import { ConnectInstance } from '@cdktf/provider-aws/lib/connect-instance';
import { ConnectInstanceStorageConfig } from '@cdktf/provider-aws/lib/connect-instance-storage-config';
import { ConnectUser } from '@cdktf/provider-aws/lib/connect-user';
import { ConnectQueue } from '@cdktf/provider-aws/lib/connect-queue';
import { ConnectHoursOfOperation } from '@cdktf/provider-aws/lib/connect-hours-of-operation';
import { ConnectPhoneNumber } from '@cdktf/provider-aws/lib/connect-phone-number';
import { DataAwsConnectSecurityProfile } from '@cdktf/provider-aws/lib/data-aws-connect-security-profile';
import { ConnectRoutingProfile } from '@cdktf/provider-aws/lib/connect-routing-profile';
import { ConnectContactFlow } from '@cdktf/provider-aws/lib/connect-contact-flow';
import { ConnectLambdaFunctionAssociation } from '@cdktf/provider-aws/lib/connect-lambda-function-association';
import { KmsKey } from '@cdktf/provider-aws/lib/kms-key';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketLifecycleConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-lifecycle-configuration';
import { S3BucketNotification } from '@cdktf/provider-aws/lib/s3-bucket-notification';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block';
import { S3BucketServerSideEncryptionConfigurationA } from '@cdktf/provider-aws/lib/s3-bucket-server-side-encryption-configuration';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { Fn, ITerraformDependable } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { v5 as uuidv5 } from 'uuid';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { awsNameWithHashedPrefix } from './aws-name-utils';

// MUST match VOICE_UUID_NAMESPACE in lambdas/node/seed-voice-agents/seed-data.ts —
// both compute the same deterministic UUIDv5 schedule ids so the SchedulerSchedule
// below targets the cron schedule record the seed Lambda writes.
const VOICE_UUID_NAMESPACE = '4f3b2a1c-9d8e-5f6a-8b8c-0d1e2f3a4b5c';

// ─── Numa Voice Construct ─────────────────────────────────────────────────────
// Owns ALL Numa Voice infrastructure so a single feature-flag guard
// (`if (clientConfig.numaVoice)` in numa-client-stack.ts) gates the whole
// feature — flag false ⇒ this construct is never instantiated ⇒ zero voice
// resources synthesize (same pattern as OpsConstruct / DisasterRecoveryConstruct).
//
// REGION: Amazon Connect requires its call-recordings bucket in-region, and S3
// ObjectCreated notifications can only invoke a same-region Lambda. So the
// recordings bucket + processor Lambda are pinned to a Connect/Transcribe region
// (ap-southeast-2) via an alias `voiceProvider`. When the stack is ALREADY in
// that region, voiceProvider is undefined and the resources use the default
// provider. The `pin` spread applies the provider to every region-scoped resource.
//
// PHASE ROADMAP (see ai-workspace/numa-voice-ship-plan.md):
//   Phase 1 (THIS) — recordings bucket + numa-voice-processor Lambda + IAM.
//                    Event-driven, scale-to-zero: S3 ObjectCreated → START a
//                    diarised Transcribe job (return immediately); Transcribe's
//                    "Job State Change" EventBridge event → fetch + write the
//                    transcript. Nothing polls; no Lambda is held open.
//   Phase 2        — seed-voice-agents (4 agents + post-call schedule),
//                    SchedulerSchedule for the morning Call List Preparer,
//                    separate xlsx intake bucket, native Connect event source
//                    (the Lambda emits numa.connector.connect → Post-Call agent).
//   Phase 5        — Amazon Connect instance / phone numbers / CALL_RECORDINGS
//                    storage config (provider 6.25.0 supports aws_connect_*).

export interface NumaVoiceConstructProps extends ApiGatewayLambdaCollectionProps {
  environmentName: string;
  /** Stack/client default-provider region. */
  region: string;
  /** Region Connect + Transcribe + recordings run in (e.g. ap-southeast-2). */
  voiceRegion: string;
  /** Alias provider pinning voice resources to voiceRegion. Undefined when the
   *  stack's default region already equals voiceRegion (then resources use the
   *  default provider). */
  voiceProvider?: AwsProvider;
  clientAccountId: string;
  /** Per-tenant Amazon Connect instance URL (Phase 1 manual, Phase 2 provisioned). */
  connectInstanceUrl?: string;
  /** ARN of the deployer-account numa-voice-config-writer Lambda (FEAT-169
   *  config write-back via STS-proof relay). The voice-admin Lambda invokes it
   *  cross-account to persist recordingsBucket/didNumbers/connectInstanceUrl. */
  voiceConfigWriterLambdaArn: string;
  /** Shared outputs bucket (client region) — reserved for later phases. */
  outputsBucketArn: string;
  outputsBucketName: string;
  /** KB data bucket — prospect-state JSON (master_prospects.json / today_calls.json)
   *  and the intake/transcript copy destination. Required (the IAM/env need it). */
  dataBucketName: string;
  /** Connector-events EventBridge bus (CLIENT region) — the processor emits the
   *  numa.connector.connect event here to fire the Post-Call agent. */
  connectorEventBusName: string;
  // ── Client-region resources the seed Lambda writes to (NOT region-pinned) ──
  /** {client}-agents table — the 4 voice agents are seeded here. */
  agentsTableName: string;
  agentsTableArn: string;
  /** {client}-agent-schedules table — the Post-Call event schedule is seeded here. */
  schedulesTableName: string;
  schedulesTableArn: string;
  /** Cognito user pool — the seed Lambda resolves the system user's sub (schedule owner). */
  userPoolId: string;
  userPoolArn: string;
  /** System-user email (schedule owner) — must match core systemUserCreator.username. */
  systemUserEmail: string;
  /** agent-schedule-runner ARN (CLIENT region) — the morning Call List Preparer
   *  SchedulerSchedule invokes it via the scheduler execution role. */
  runnerArn: string;
  /** Phase 2 (FEAT-169): auto-provision the Amazon Connect instance via IaC.
   *  OFF by default — Phase 1 uses a manually-created instance (FEAT-158). */
  connectAutoProvision?: boolean;
  /** Claim a BILLABLE DID via the deploy-time Connect config Lambda and set it as
   *  the queue's outbound caller-id. Only takes effect when connectAutoProvision
   *  is also on. OFF by default so no client is surprise-charged. */
  connectClaimDid?: boolean;
  /** Deploy-time dependency on the system-user-creator invocation, so the seed
   *  (which resolves the system user via AdminGetUser) runs AFTER it exists. */
  systemUserDependsOn: ITerraformDependable[];
}

/**
 * FEAT-158 pre-flight: does `raw` look like an Amazon Connect instance ACCESS
 * URL (not the CCP softphone URL, not a random string)? Accepts the modern
 * `*.my.connect.aws` and legacy `*.awsapps.com` hosts over https. Rejects a URL
 * that already points at the CCP (`/ccp-v2`) — that is the runtime's job to append.
 */
export function isValidConnectInstanceUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('.my.connect.aws') && !host.endsWith('.awsapps.com')) return false;
  // Reject the common mistake of pasting the full CCP URL instead of the instance URL.
  if (/ccp-v2|\/ccp(\/|$)/i.test(u.pathname)) return false;
  return true;
}

export class NumaVoiceConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;
  public readonly recordingsBucket: S3Bucket;
  public readonly processorLambda: LambdaFunction;

  constructor(scope: Construct, name: string, props: NumaVoiceConstructProps) {
    super(scope, name, props);

    const clientName = props.clientName;
    const envSuffix = props.environmentName !== 'prod' ? `-${props.environmentName}` : '';
    // Spread onto every region-scoped resource so it lands in voiceRegion.
    const pin = props.voiceProvider ? { provider: props.voiceProvider } : {};

    // ── FEAT-158 deploy-time pre-flight ───────────────────────────────────────
    // A Phase-1 (manual) Connect instance MUST supply a well-formed
    // connectInstanceUrl. Without it the CCP softphone renders with an empty
    // instance URL and no agent can dial — a silent runtime failure that looks
    // like a successful deploy. Fail loud at synth with an actionable message.
    // (When connectAutoProvision is on, the URL is derived from the instance
    // alias downstream, so no manual value is required.)
    if (!props.connectAutoProvision) {
      const url = (props.connectInstanceUrl ?? '').trim();
      if (!url) {
        throw new Error(
          `Numa Voice is enabled for "${clientName}" without connectAutoProvision, so a manually-created ` +
            `Amazon Connect instance is required — but connectInstanceUrl is missing from the client config. ` +
            `Set connectInstanceUrl to the instance access URL (e.g. https://numa-${clientName}.my.connect.aws), ` +
            `see the FEAT-158 Connect setup runbook, or set connectAutoProvision: true to provision one via IaC.`
        );
      }
      if (!isValidConnectInstanceUrl(url)) {
        throw new Error(
          `connectInstanceUrl "${url}" for "${clientName}" is not a valid Amazon Connect instance URL. ` +
            `Expected an https URL on *.my.connect.aws (preferred) or *.awsapps.com with no CCP path ` +
            `(e.g. https://numa-${clientName}.my.connect.aws) — do NOT include /connect/ccp-v2.`
        );
      }
    }

    // ── Log group (region-pinned; also satisfies the abstract base field) ──────
    this.logGroup = new CloudwatchLogGroup(this, 'voice-log-group', {
      name: `${clientName}-voice`,
      retentionInDays: 30,
      ...pin,
    });

    // ── Call-recordings bucket ────────────────────────────────────────────────
    // numa-{client}{envSuffix}-connect-recordings (SPK-010 naming convention).
    // Connect's recording storage config (Phase 1 manual, Phase 2 IaC) points here.
    const recordingsBucketName = `numa-${clientName}${envSuffix}-connect-recordings`;
    // Fail loud at synth (clear message) rather than an opaque S3 ConstraintViolation
    // at apply. The deterministic name is load-bearing for the Connect recording
    // storage config, so we assert rather than hash.
    if (recordingsBucketName.length > 63) {
      throw new Error(
        `Voice recordings bucket name "${recordingsBucketName}" is ${recordingsBucketName.length} chars; S3 caps at 63. Shorten clientName "${clientName}".`
      );
    }
    this.recordingsBucket = new S3Bucket(this, 'recordings-bucket', {
      bucket: recordingsBucketName,
      ...pin,
    });
    new S3BucketPublicAccessBlock(this, 'recordings-pab', {
      bucket: this.recordingsBucket.id,
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
      ...pin,
    });
    new S3BucketServerSideEncryptionConfigurationA(this, 'recordings-sse', {
      bucket: this.recordingsBucket.id,
      rule: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
      ...pin,
    });
    // Expire ONLY the re-derivable raw Transcribe scratch output (transcripts/).
    // Call recordings (recordings/) are intentionally NOT auto-expired here —
    // their retention is a per-customer compliance decision (set separately).
    new S3BucketLifecycleConfiguration(this, 'recordings-lifecycle', {
      bucket: this.recordingsBucket.bucket,
      rule: [
        {
          id: 'expire-raw-transcribe-scratch',
          status: 'Enabled',
          filter: [{ prefix: 'transcripts/' }],
          expiration: [{ days: 7 }],
        },
      ],
      ...pin,
    });

    // ── Dead-letter queue for the recording→transcript pipeline ───────────────
    // Both processor triggers are ASYNC invokes (S3 ObjectCreated and the
    // Transcribe Job State Change EventBridge rule). After Lambda's 2 async
    // retries a failed event would be silently dropped — so capture it here and
    // alarm on depth. Region-pinned to live alongside the processor. Mirrors the
    // agent-schedule-runner / connector-event-dispatcher DLQ pattern.
    const processorDlq = new SqsQueue(this, 'voice-processor-dlq', {
      name: `${clientName}-voice-processor-dlq`,
      messageRetentionSeconds: 14 * 24 * 60 * 60, // 14 days
      tags: { Purpose: 'voice-processor-dlq', ClientName: clientName },
      ...pin,
    });

    // ── numa-voice-processor Lambda (raw-built so it can be region-pinned) ─────
    // NumaLambda has no provider prop and is shared by ~80 lambdas, so we build
    // the role/policy/function directly here to keep the cross-region concern
    // isolated to this gated construct.
    const resourceName = awsNameWithHashedPrefix(clientName, '_voice-processor', 64);

    const role = new IamRole(this, 'voice-processor-role', {
      name: resourceName,
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
      lifecycle: { createBeforeDestroy: true },
      ...pin,
    });
    new IamRolePolicyAttachment(this, 'voice-processor-basic', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      ...pin,
    });
    const policy = new IamPolicy(this, 'voice-processor-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'voice-processor-policy-doc', {
        statement: [
          {
            // Transcribe job ARNs aren't predictable at deploy time, so '*'.
            effect: 'Allow',
            actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
            resources: ['*'],
          },
          {
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
            resources: [this.recordingsBucket.arn, `${this.recordingsBucket.arn}/*`],
          },
          {
            // Read the SDR wrap-up outcome the FE wrote to the outputs bucket.
            effect: 'Allow',
            actions: ['s3:GetObject'],
            resources: [`${props.outputsBucketArn}/voice/outcomes/*`],
          },
          {
            // Write the normalised transcript into the company KB (client region)
            // so the post-call agent can read it via numa_files.
            effect: 'Allow',
            actions: ['s3:PutObject'],
            resources: [`arn:aws:s3:::${props.dataBucketName}/documents/company/voice/transcripts/*`],
          },
          {
            // Fire the Post-Call agent via the connector-events bus (client region).
            effect: 'Allow',
            actions: ['events:PutEvents'],
            resources: [
              `arn:aws:events:${props.region}:${props.clientAccountId}:event-bus/${props.connectorEventBusName}`,
            ],
          },
          {
            // Deliver failed async invocations to the DLQ.
            effect: 'Allow',
            actions: ['sqs:SendMessage'],
            resources: [processorDlq.arn],
          },
          {
            // Emit the TranscriptionFailed / DiarisationUnexpected custom metrics
            // the pipeline alarms watch. PutMetricData has no resource scoping, so
            // restrict it to the NumaVoice namespace via condition. Without this
            // the best-effort emits silently no-op and the alarms get no data.
            effect: 'Allow',
            actions: ['cloudwatch:PutMetricData'],
            resources: ['*'],
            condition: [{ test: 'StringEquals', variable: 'cloudwatch:namespace', values: ['NumaVoice'] }],
          },
        ],
      }).json,
      ...pin,
    });
    const processorPolicyAttach = new IamRolePolicyAttachment(this, 'voice-processor-policy-attach', {
      role: role.name,
      policyArn: policy.arn,
      ...pin,
    });

    const lambdaZip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python/numa-voice-processor',
      'lambda_function.zip'
    );
    const sourceCodeHash = Fn.filebase64sha256(lambdaZip);
    this.processorLambda = new LambdaFunction(this, 'voice-processor-lambda', {
      functionName: resourceName,
      role: role.arn,
      runtime: 'python3.13',
      handler: 'lambda_function.handler',
      filename: lambdaZip,
      sourceCodeHash,
      // Event-driven, scale-to-zero: each invocation either starts a job or
      // processes a completion event — both are short, so no long timeout needed.
      timeout: 120,
      memorySize: 256,
      loggingConfig: {
        logFormat: 'JSON',
        logGroup: this.logGroup.name,
        systemLogLevel: 'INFO',
      },
      environment: {
        variables: {
          TRANSCRIPTS_PREFIX: 'transcripts/',
          // SPK-010 Q6 default; override per-tenant once the en-AU vs en-NZ A/B closes.
          NUMA_VOICE_LANGUAGE: 'en-AU',
          CLIENT_NAME: clientName,
          // Post-call dispatch targets the connector-events bus in the CLIENT region.
          CONNECTOR_EVENT_BUS_NAME: props.connectorEventBusName,
          CLIENT_REGION: props.region,
          OUTPUTS_BUCKET: props.outputsBucketName,
          // DATA bucket (client region) — the normalised transcript is written
          // into the company KB here so the post-call agent can numa_files-read it.
          DATA_BUCKET: props.dataBucketName,
          // Explicit so it stays in lockstep with the s3:PutObject IAM grant below
          // (documents/company/voice/transcripts/*) rather than relying on the
          // lambda's matching default.
          KB_TRANSCRIPTS_S3_PREFIX: 'documents/company/voice/transcripts/',
          KB_TRANSCRIPTS_FILE_PREFIX: 'voice/transcripts/',
          ...(props.connectInstanceUrl ? { CONNECT_INSTANCE_URL: props.connectInstanceUrl } : {}),
        },
      },
      tracingConfig: { mode: 'Active' },
      deadLetterConfig: { targetArn: processorDlq.arn },
      dependsOn: [processorPolicyAttach],
      ...pin,
    });

    // ── S3 ObjectCreated → Lambda ─────────────────────────────────────────────
    // Loop-safe: the processor writes transcript .json (transcripts/ prefix) which
    // does NOT match the .wav suffix filter, so it never re-triggers itself.
    const s3Permission = new LambdaPermission(this, 'voice-s3-permission', {
      statementId: 'AllowS3InvokeVoiceProcessor',
      functionName: this.processorLambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: 's3.amazonaws.com',
      sourceArn: this.recordingsBucket.arn,
      ...pin,
    });
    new S3BucketNotification(this, 'recordings-notification', {
      bucket: this.recordingsBucket.bucket,
      dependsOn: [s3Permission],
      lambdaFunction: [
        {
          events: ['s3:ObjectCreated:*'],
          filterSuffix: '.wav',
          lambdaFunctionArn: this.processorLambda.arn,
        },
      ],
      ...pin,
    });

    // ── Transcribe "Job State Change" → completion handler (scale-to-zero) ─────
    // Amazon Transcribe emits this on the default bus when a job finishes. The
    // job-name prefix filter scopes it to THIS feature's jobs only, so the
    // handler never fires for unrelated Transcribe jobs in the same account
    // (e.g. extract-content-from-file). No polling — the event drives completion.
    const transcribeRule = new CloudwatchEventRule(this, 'voice-transcribe-rule', {
      name: `${clientName}-voice-transcribe-complete`,
      description: 'Numa Voice: fire the processor when a transcription job finishes',
      eventPattern: JSON.stringify({
        source: ['aws.transcribe'],
        'detail-type': ['Transcribe Job State Change'],
        detail: {
          TranscriptionJobName: [{ prefix: `numa-voice-${clientName}-` }],
          TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
        },
      }),
      ...pin,
    });
    new CloudwatchEventTarget(this, 'voice-transcribe-target', {
      rule: transcribeRule.name,
      arn: this.processorLambda.arn,
      ...pin,
    });
    new LambdaPermission(this, 'voice-events-permission', {
      statementId: 'AllowEventBridgeInvokeVoiceProcessor',
      functionName: this.processorLambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'events.amazonaws.com',
      sourceArn: transcribeRule.arn,
      ...pin,
    });

    // ── Pipeline monitoring (alarms; region-pinned) ───────────────────────────
    // SNS topic intentionally not wired — Arcanum's account-level CloudWatch
    // hookup surfaces these to the existing notification channel (same convention
    // as the agent-schedule-runner / connector-event-dispatcher DLQ alarms).
    const VOICE_METRIC_NAMESPACE = 'NumaVoice';

    // 1) Anything in the DLQ = a recording/transcript event was dropped.
    new CloudwatchMetricAlarm(this, 'voice-processor-dlq-alarm', {
      alarmName: `${clientName}-voice-processor-dlq-not-empty`,
      alarmDescription:
        'Numa Voice processor produced a DLQ message — a recording or transcript-completion event was lost.',
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensions: { QueueName: processorDlq.name },
      statistic: 'Maximum',
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      treatMissingData: 'notBreaching',
      ...pin,
    });

    // 2) Processor Lambda crashed (before it could DLQ / emit a custom metric).
    new CloudwatchMetricAlarm(this, 'voice-processor-errors-alarm', {
      alarmName: `${clientName}-voice-processor-errors`,
      alarmDescription: 'Numa Voice processor Lambda is erroring — recording→transcript pipeline degraded.',
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensions: { FunctionName: this.processorLambda.functionName },
      statistic: 'Sum',
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      treatMissingData: 'notBreaching',
      ...pin,
    });

    // 3) Amazon Transcribe reported a FAILED job (custom metric from the processor).
    new CloudwatchMetricAlarm(this, 'voice-transcription-failed-alarm', {
      alarmName: `${clientName}-voice-transcription-failed`,
      alarmDescription: 'Amazon Transcribe returned a FAILED job for a Numa Voice recording.',
      namespace: VOICE_METRIC_NAMESPACE,
      metricName: 'TranscriptionFailed',
      dimensions: { ClientName: clientName },
      statistic: 'Sum',
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      treatMissingData: 'notBreaching',
      ...pin,
    });

    // 4) Systematic diarisation breakage (custom metric). Threshold is generous
    // and the window daily on purpose — a single voicemail legitimately yields one
    // speaker, so we alarm only when bad diarisation is happening at scale, not on
    // the expected one-off.
    new CloudwatchMetricAlarm(this, 'voice-diarisation-unexpected-alarm', {
      alarmName: `${clientName}-voice-diarisation-unexpected`,
      alarmDescription:
        'Numa Voice transcripts are frequently not 2-speaker — the SDR/prospect mapping may be corrupted.',
      namespace: VOICE_METRIC_NAMESPACE,
      metricName: 'DiarisationUnexpected',
      dimensions: { ClientName: clientName },
      statistic: 'Sum',
      period: 24 * 60 * 60, // 1 day
      evaluationPeriods: 1,
      threshold: 10,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      treatMissingData: 'notBreaching',
      ...pin,
    });

    // ── Deploy-time agent + schedule seeding (CLIENT region; NOT pinned) ───────
    // The 4 voice agents, the Post-Call event schedule, and Cognito all live in
    // the client region — so the seed Lambda uses the stack DEFAULT provider
    // (no voiceProvider pin). Idempotent, modeled on seed-ops-config: it resolves
    // the system user's sub via AdminGetUser and conditional-puts each record.
    //
    // SINGLE SOURCE OF TRUTH for the call-prep schedule id: computed here once and
    // passed to the seed Lambda via env (CALL_PREP_SCHEDULE_ID). The SchedulerSchedule
    // (below) targets this same value, so the seeded schedule record and the cron
    // target can never drift to different UUIDs — a divergence would compile and
    // deploy fine but silently no-op at 7:30am (getSchedule miss).
    const callPrepScheduleId = uuidv5(`callprep-${clientName}`, VOICE_UUID_NAMESPACE);
    const seedZip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node/seed-voice-agents',
      'lambda_function.zip'
    );
    const seedRole = new IamRole(this, 'seed-voice-role', {
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
    });
    const seedBasic = new IamRolePolicyAttachment(this, 'seed-voice-basic', {
      role: seedRole.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });
    const seedPolicy = new IamPolicy(this, 'seed-voice-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'seed-voice-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['dynamodb:PutItem'],
            resources: [props.agentsTableArn, props.schedulesTableArn],
          },
          {
            // The seeder upserts existing schedule records (refreshing prompt_text /
            // agent_snapshot / trigger on re-deploy while preserving runtime counters),
            // so it needs UpdateItem on the schedules table — not just PutItem.
            effect: 'Allow',
            actions: ['dynamodb:UpdateItem'],
            resources: [props.schedulesTableArn],
          },
          {
            effect: 'Allow',
            actions: ['cognito-idp:AdminGetUser'],
            resources: [props.userPoolArn],
          },
          {
            // Read-only: the seed validates the company KB record exists before
            // creating the cron schedule (else the 7:30am call-prep run has no KB
            // access — see fetchAccessibleKBIds in agent-schedule-runner).
            effect: 'Allow',
            actions: ['dynamodb:GetItem'],
            resources: [
              `arn:aws:dynamodb:${props.region}:${props.clientAccountId}:table/numa-${clientName}-knowledge-bases`,
            ],
          },
        ],
      }).json,
    });
    const seedPolicyAttach = new IamRolePolicyAttachment(this, 'seed-voice-policy-attach', {
      role: seedRole.name,
      policyArn: seedPolicy.arn,
    });
    const seedLambda = new LambdaFunction(this, 'seed-voice-lambda', {
      functionName: `${clientName}-seed-voice-agents`,
      role: seedRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: seedZip,
      sourceCodeHash: Fn.filebase64sha256(seedZip),
      timeout: 120,
      environment: {
        variables: {
          AGENTS_TABLE: props.agentsTableName,
          SCHEDULES_TABLE: props.schedulesTableName,
          USER_POOL_ID: props.userPoolId,
          CLIENT_NAME: clientName,
          SYSTEM_USER_EMAIL: props.systemUserEmail,
          // Authoritative call-prep schedule id (matches the SchedulerSchedule).
          CALL_PREP_SCHEDULE_ID: callPrepScheduleId,
          // For the deploy-time company-KB existence check.
          KNOWLEDGE_BASES_TABLE: `numa-${clientName}-knowledge-bases`,
        },
      },
    });
    new LambdaInvocation(this, 'seed-voice-invocation', {
      functionName: seedLambda.functionName,
      input: JSON.stringify({ action: 'seed' }),
      // Re-invoke when the seed code changes or the target tables change.
      triggers: {
        seedSourceHash: seedLambda.sourceCodeHash,
        agentsTable: props.agentsTableName,
        schedulesTable: props.schedulesTableName,
      },
      dependsOn: [seedLambda, seedBasic, seedPolicyAttach, ...props.systemUserDependsOn],
    });

    // ── Morning Call List Preparer (EventBridge Scheduler → runner SCHEDULE) ───
    // Cron lives in the CLIENT region with the runner (default provider, NOT
    // pinned). Targets the runner with {type:'SCHEDULE', scheduleId} where the
    // id is the same deterministic UUIDv5 the seed Lambda wrote for the callprep
    // cron schedule record.
    // callPrepScheduleId is computed once near the seed Lambda (single source of truth).
    const callPrepScheduleName = `${clientName}-voice-callprep`;
    const schedulerRole = new IamRole(this, 'voice-callprep-scheduler-role', {
      name: `${clientName}-voice-callprep-scheduler`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'voice-callprep-scheduler-assume', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['scheduler.amazonaws.com'] }],
          },
        ],
      }).json,
    });
    const schedulerPolicy = new IamPolicy(this, 'voice-callprep-scheduler-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'voice-callprep-scheduler-policy-doc', {
        statement: [{ effect: 'Allow', actions: ['lambda:InvokeFunction'], resources: [props.runnerArn] }],
      }).json,
    });
    new IamRolePolicyAttachment(this, 'voice-callprep-scheduler-attach', {
      role: schedulerRole.name,
      policyArn: schedulerPolicy.arn,
    });
    new SchedulerSchedule(this, 'voice-callprep-schedule', {
      name: callPrepScheduleName,
      groupName: 'default',
      scheduleExpression: 'cron(30 7 * * ? *)',
      scheduleExpressionTimezone: 'Pacific/Auckland',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: props.runnerArn,
        roleArn: schedulerRole.arn,
        input: JSON.stringify({ type: 'SCHEDULE', scheduleId: callPrepScheduleId }),
      },
    });
    // NOTE: no LambdaPermission for scheduler.amazonaws.com — EventBridge
    // Scheduler invokes the target by assuming schedulerRole (target.roleArn),
    // not via the function's resource policy, so a resource permission would be
    // dead. (runnerFunctionName is the shared runner; we don't touch its policy.)

    // ── Prospect-spreadsheet intake (CLIENT region; NOT pinned) ───────────────
    // Researchers drop .xlsx into a dedicated intake bucket. The emitter copies
    // it into Numa Files (company KB voice/intake/) so the Ingest agent can read
    // it by exact path, then emits a numa.connector.connect event
    // (event_type 'prospects.uploaded') to fire that agent. Separate bucket so it
    // owns its own S3 notification (the shared data bucket can hold only one).
    const intakeBucketName = `numa-${clientName}${envSuffix}-prospect-intake`;
    if (intakeBucketName.length > 63) {
      throw new Error(
        `Voice intake bucket name "${intakeBucketName}" is ${intakeBucketName.length} chars; S3 caps at 63. Shorten clientName "${clientName}".`
      );
    }
    const intakeBucket = new S3Bucket(this, 'intake-bucket', { bucket: intakeBucketName });
    new S3BucketPublicAccessBlock(this, 'intake-pab', {
      bucket: intakeBucket.id,
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });
    new S3BucketServerSideEncryptionConfigurationA(this, 'intake-sse', {
      bucket: intakeBucket.id,
      rule: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
    });
    // The emitter copies each spreadsheet into the company KB, so the source copy
    // here is disposable after processing (client region — no pin).
    new S3BucketLifecycleConfiguration(this, 'intake-lifecycle', {
      bucket: intakeBucket.bucket,
      rule: [{ id: 'expire-processed-intake', status: 'Enabled', expiration: [{ days: 14 }] }],
    });

    const intakeRole = new IamRole(this, 'voice-intake-role', {
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
      lifecycle: { createBeforeDestroy: true },
    });
    new IamRolePolicyAttachment(this, 'voice-intake-basic', {
      role: intakeRole.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });
    const intakePolicy = new IamPolicy(this, 'voice-intake-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'voice-intake-policy-doc', {
        statement: [
          { effect: 'Allow', actions: ['s3:GetObject'], resources: [`${intakeBucket.arn}/*`] },
          {
            effect: 'Allow',
            actions: ['s3:PutObject'],
            resources: [`arn:aws:s3:::${props.dataBucketName}/documents/company/voice/intake/*`],
          },
          {
            effect: 'Allow',
            actions: ['events:PutEvents'],
            resources: [
              `arn:aws:events:${props.region}:${props.clientAccountId}:event-bus/${props.connectorEventBusName}`,
            ],
          },
        ],
      }).json,
    });
    const intakePolicyAttach = new IamRolePolicyAttachment(this, 'voice-intake-policy-attach', {
      role: intakeRole.name,
      policyArn: intakePolicy.arn,
    });
    const intakeZip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python/numa-voice-intake',
      'lambda_function.zip'
    );
    const intakeLambda = new LambdaFunction(this, 'voice-intake-lambda', {
      functionName: awsNameWithHashedPrefix(clientName, '_voice-intake', 64),
      role: intakeRole.arn,
      runtime: 'python3.13',
      handler: 'lambda_function.handler',
      filename: intakeZip,
      sourceCodeHash: Fn.filebase64sha256(intakeZip),
      timeout: 120,
      memorySize: 256,
      environment: {
        variables: {
          DATA_BUCKET: props.dataBucketName,
          KB_INTAKE_S3_PREFIX: 'documents/company/voice/intake/',
          KB_INTAKE_FILE_PREFIX: 'voice/intake/',
          CONNECTOR_EVENT_BUS_NAME: props.connectorEventBusName,
          CLIENT_NAME: clientName,
          // Expected source bucket — the handler ignores events from anything else.
          INTAKE_BUCKET: intakeBucketName,
        },
      },
      tracingConfig: { mode: 'Active' },
      dependsOn: [intakePolicyAttach],
    });
    const intakeS3Permission = new LambdaPermission(this, 'voice-intake-s3-permission', {
      statementId: 'AllowS3InvokeVoiceIntake',
      functionName: intakeLambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: 's3.amazonaws.com',
      sourceArn: intakeBucket.arn,
    });
    new S3BucketNotification(this, 'intake-notification', {
      bucket: intakeBucket.bucket,
      dependsOn: [intakeS3Permission],
      // No filterSuffix: S3 suffix matching is CASE-SENSITIVE, so a '.xlsx' filter
      // silently drops 'prospects.XLSX' before the Lambda ever sees it. Use a single
      // ObjectCreated rule and let the Lambda's case-insensitive INTAKE_EXTENSIONS
      // check (.lower().endswith(...)) decide — it already skips non-spreadsheets.
      // One S3BucketNotification resource only (Terraform replaces the whole config).
      lambdaFunction: [{ events: ['s3:ObjectCreated:*'], lambdaFunctionArn: intakeLambda.arn }],
    });

    // ── Voice Admin API (client region; created whenever numaVoice is on) ─────
    // Backs the Voice Admin panel: phone numbers (list/claim/release + caller-id),
    // agent/origins, instance status, and per-user softphone federation. Routes go
    // through the shared API Gateway + custom authorizer
    // (addLambdaFunction); admin-group checks live in the handler. Resolves the
    // Connect instance at runtime by alias, so it works for both the autoProvision
    // and a manually-created (FEAT-158) instance.
    //
    // Federation role for password-free agent SSO: the voice-admin Lambda assumes
    // this role with RoleSessionName = the Connect username, then calls
    // GetFederationToken (SAML-mode instances only) to mint a SignInUrl. Account-root
    // trust + the Lambda's scoped sts:AssumeRole grant below = only that Lambda can.
    const voiceFederationRole = new IamRole(this, 'voice-federation-role', {
      name: awsNameWithHashedPrefix(clientName, '_voice-federation', 64),
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'voice-federation-assume', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'AWS', identifiers: [`arn:aws:iam::${props.clientAccountId}:root`] }],
          },
        ],
      }).json,
    });
    const voiceFederationPolicy = new IamPolicy(this, 'voice-federation-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'voice-federation-policy-doc', {
        statement: [{ effect: 'Allow', actions: ['connect:GetFederationToken'], resources: ['*'] }],
      }).json,
    });
    new IamRolePolicyAttachment(this, 'voice-federation-attach', {
      role: voiceFederationRole.name,
      policyArn: voiceFederationPolicy.arn,
    });

    this.addLambdaFunction(this, 'voice-admin', {
      lambdaDirectory: 'node/numa-voice-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      timeout: 29,
      environment: {
        CONNECT_REGION: props.voiceRegion,
        CLIENT_NAME: clientName,
        ENV_SUFFIX: envSuffix,
        APPROVED_ORIGIN: `https://${clientName}.numa.arcanum.ai`,
        // Password-free agent SSO (GetFederationToken via the assumed role).
        FEDERATION_ROLE_ARN: voiceFederationRole.arn,
        AGENT_USERNAME: 'numa-voice-agent',
        // FEAT-169 config write-back (STS-proof relay -> deployer numa-client-config).
        VOICE_CONFIG_WRITER_LAMBDA_ARN: props.voiceConfigWriterLambdaArn,
        RECORDINGS_BUCKET: recordingsBucketName,
        // Cognito pool — resolve a Connect agent username (== the user's sub) back to a
        // real email/name for the admin panel (the FE access token carries no email, so
        // Connect usernames are bare subs and IdentityInfo is junk without this).
        USER_POOL_ID: props.userPoolId,
        ...(props.connectInstanceUrl ? { CONNECT_INSTANCE_URL: props.connectInstanceUrl } : {}),
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: [
            'connect:ListInstances',
            'connect:ListPhoneNumbersV2',
            'connect:SearchAvailablePhoneNumbers',
            'connect:ClaimPhoneNumber',
            'connect:ReleasePhoneNumber',
            'connect:ListApprovedOrigins',
            'connect:AssociateApprovedOrigin',
            'connect:DisassociateApprovedOrigin',
            'connect:ListUsers',
            // Per-user agent provisioning (each Numa user federates as their own agent).
            'connect:CreateUser',
            // Read/repair agent IdentityInfo (sync-identities backfill from Cognito).
            'connect:DescribeUser',
            'connect:UpdateUserIdentityInfo',
            'connect:ListRoutingProfiles',
            'connect:ListSecurityProfiles',
            'connect:ListQueues',
            'connect:DescribeQueue',
            'connect:DescribeRoutingProfile',
            'connect:UpdateQueueOutboundCallerConfig',
            // DID ownership (tag DIDs + instance mode) + wiring DIDs to the inbound flow.
            'connect:DescribePhoneNumber',
            'connect:TagResource',
            'connect:UntagResource',
            'connect:ListTagsForResource',
            'connect:ListContactFlows',
            'connect:AssociatePhoneNumberContactFlow',
          ],
          resources: ['*'],
        },
        // Resolve agent usernames (Cognito subs) → real email/name for the admin panel.
        {
          effect: 'Allow',
          actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
          resources: [props.userPoolArn],
        },
        // Assume the federation role (RoleSessionName = Connect username) for SSO.
        { effect: 'Allow', actions: ['sts:AssumeRole'], resources: [voiceFederationRole.arn] },
        // FEAT-169: invoke the deployer-account config writer (cross-account).
        { effect: 'Allow', actions: ['lambda:InvokeFunction'], resources: [props.voiceConfigWriterLambdaArn] },
      ],
      // NOTE: addLambdaFunction names routes by array INDEX (voice-admin_route_N).
      // Only ever APPEND — inserting/reordering shifts indices and makes Terraform
      // try to re-key existing routes onto keys that already exist (409 conflict).
      route: [
        { verb: 'GET', path: 'voice/admin/status' },
        { verb: 'POST', path: 'voice/phone-numbers' },
        { verb: 'DELETE', path: 'voice/phone-numbers/{id}' },
        { verb: 'POST', path: 'voice/phone-numbers/{id}/caller-id' },
        { verb: 'POST', path: 'voice/approved-origins' },
        { verb: 'DELETE', path: 'voice/approved-origins' },
        // RETIRED route — its handler was removed (returns 404 now). Kept in place,
        // NOT deleted: addLambdaFunction keys routes by ARRAY INDEX, so removing this
        // mid-array shifts voice/federation-token's index and triggers a Terraform 409
        // re-key conflict on apply (see the "only ever APPEND" note above). Drop only
        // with a state migration.
        { verb: 'POST', path: 'voice/outbound-country-request' },
        { verb: 'GET', path: 'voice/federation-token' },
        // Per-DID ownership (self-claim / admin assign-release) + tenant inbound mode.
        { verb: 'POST', path: 'voice/phone-numbers/{id}/owner' },
        { verb: 'DELETE', path: 'voice/phone-numbers/{id}/owner' },
        { verb: 'POST', path: 'voice/mode' },
        // APPEND-ONLY (routes keyed by array index): backfill agent IdentityInfo from Cognito.
        { verb: 'POST', path: 'voice/agents/sync-identities' },
      ],
    });

    // ── Phase 2 (FEAT-169) Amazon Connect provisioning — OFF by default ───────
    // Real, billable Connect resources, region-pinned to voiceRegion. Gated by
    // connectAutoProvision so Phase-1 clients keep a MANUALLY-provisioned instance
    // (FEAT-158) writing to the same recordings bucket. Still UNTESTED against a
    // live deploy (no real Connect instance to validate against) — DID phone-number
    // claiming is intentionally left to the admin UI / Connect console to avoid
    // surprise charges. The KMS key policy + recordings-bucket policy below grant
    // the Connect service principal what it needs to deposit encrypted recordings.
    if (props.connectAutoProvision) {
      // CMK for call-recording encryption. A custom key policy loses the implicit
      // root admin statement, so it MUST be re-added, plus a grant for Connect.
      const recordingsKey = new KmsKey(this, 'connect-recordings-key', {
        description: `Numa Voice call-recording encryption (${clientName})`,
        policy: new DataAwsIamPolicyDocument(this, 'connect-recordings-key-doc', {
          statement: [
            {
              sid: 'EnableRootAccount',
              effect: 'Allow',
              principals: [{ type: 'AWS', identifiers: [`arn:aws:iam::${props.clientAccountId}:root`] }],
              actions: ['kms:*'],
              resources: ['*'],
            },
            {
              sid: 'AllowConnectGenerateDataKey',
              effect: 'Allow',
              principals: [{ type: 'Service', identifiers: ['connect.amazonaws.com'] }],
              actions: ['kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey'],
              resources: ['*'],
              condition: [{ test: 'StringEquals', variable: 'aws:SourceAccount', values: [props.clientAccountId] }],
            },
            {
              // Transcribe reads the KMS-encrypted .wav and writes its encrypted
              // output AS THE SERVICE PRINCIPAL — start_transcription_job passes no
              // DataAccessRole, so the processor role's KMS grant does NOT cover it.
              // Without this statement the job fails with AccessDenied and NO
              // transcript is ever produced (post-call agent never fires).
              sid: 'AllowTranscribeUseOfKey',
              effect: 'Allow',
              principals: [{ type: 'Service', identifiers: ['transcribe.amazonaws.com'] }],
              actions: ['kms:Decrypt', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
              resources: ['*'],
              condition: [{ test: 'StringEquals', variable: 'aws:SourceAccount', values: [props.clientAccountId] }],
            },
          ],
        }).json,
        ...pin,
      });
      // The voice-processor Lambda role must also use the CMK: Transcribe reads
      // the KMS-encrypted .wav under the Lambda's credentials (no DataAccessRole),
      // and fetch_transcript reads the output. Without this the auto-provision
      // path produces no transcript.
      const processorKmsPolicy = new IamPolicy(this, 'voice-processor-kms-policy', {
        policy: new DataAwsIamPolicyDocument(this, 'voice-processor-kms-doc', {
          statement: [
            {
              effect: 'Allow',
              actions: ['kms:Decrypt', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
              resources: [recordingsKey.arn],
            },
          ],
        }).json,
        ...pin,
      });
      new IamRolePolicyAttachment(this, 'voice-processor-kms-attach', {
        role: role.name,
        policyArn: processorKmsPolicy.arn,
        ...pin,
      });

      // Grant the Connect service principal write access to the recordings bucket.
      const connectRecordingsBucketPolicy = new S3BucketPolicy(this, 'connect-recordings-bucket-policy', {
        bucket: this.recordingsBucket.id,
        policy: new DataAwsIamPolicyDocument(this, 'connect-recordings-bucket-policy-doc', {
          statement: [
            {
              sid: 'AllowConnectPutRecordings',
              effect: 'Allow',
              principals: [{ type: 'Service', identifiers: ['connect.amazonaws.com'] }],
              actions: ['s3:PutObject', 's3:GetBucketAcl', 's3:GetBucketLocation'],
              resources: [this.recordingsBucket.arn, `${this.recordingsBucket.arn}/*`],
              condition: [{ test: 'StringEquals', variable: 'aws:SourceAccount', values: [props.clientAccountId] }],
            },
          ],
        }).json,
        ...pin,
      });
      const connectInstance = new ConnectInstance(this, 'connect-instance', {
        // SAML so agents federate in from their Numa session (no Connect password).
        // The numa-voice-admin federation endpoint mints a SignInUrl via
        // GetFederationToken (RoleSessionName = the Connect username).
        identityManagementType: 'SAML',
        inboundCallsEnabled: true,
        outboundCallsEnabled: true,
        instanceAlias: `numa-${clientName}${envSuffix}`,
        ...pin,
      });
      new ConnectInstanceStorageConfig(this, 'connect-recordings-storage', {
        instanceId: connectInstance.id,
        resourceType: 'CALL_RECORDINGS',
        storageConfig: {
          storageType: 'S3',
          s3Config: {
            bucketName: recordingsBucketName,
            bucketPrefix: 'recordings',
            encryptionConfig: { encryptionType: 'KMS', keyId: recordingsKey.arn },
          },
        },
        // Connect validates write access at config time — ensure the bucket +
        // its Connect-PutObject policy exist first (the plain bucketName string
        // creates no implicit edge).
        dependsOn: [this.recordingsBucket, connectRecordingsBucketPolicy],
        ...pin,
      });

      // ── Declarative agent + queue + DID (native CDKTF, no seed Lambda) ────────
      // The instance auto-creates default 'Agent' security + 'Basic Routing
      // Profile'; read their ids via data sources to wire the federated agent user.
      const agentSecurityProfile = new DataAwsConnectSecurityProfile(this, 'voice-agent-sec-profile', {
        instanceId: connectInstance.id,
        name: 'Agent',
        ...pin,
      });
      // 24/7 hours for the outbound queue (Connect has no default hours resource).
      const voiceHours = new ConnectHoursOfOperation(this, 'voice-hours', {
        instanceId: connectInstance.id,
        name: 'numa-voice-24x7',
        timeZone: 'UTC',
        config: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((day) => ({
          day,
          startTime: { hours: 0, minutes: 0 },
          endTime: { hours: 23, minutes: 59 },
        })),
        ...pin,
      });
      // DID claim — Terraform owns it (no double-claim on re-apply). Gated by
      // connectClaimDid so no client is surprise-billed.
      const voicePhoneNumber = props.connectClaimDid
        ? new ConnectPhoneNumber(this, 'voice-did', {
            targetArn: connectInstance.arn,
            countryCode: 'US',
            type: 'DID',
            ...pin,
          })
        : undefined;
      // Outbound whisper flow that turns call recording ON (Agent + Customer) for
      // agent-initiated outbound dials. Without this the queue falls back to the
      // default outbound whisper (RecordedParticipants []), Connect announces "this
      // call is not being recorded", and no .wav is written — so the FEAT-159
      // S3 -> Transcribe -> diarise -> post-call pipeline never triggers. The content
      // is the minimal Connect flow: UpdateContactRecordingBehavior -> EndFlowExecution.
      const voiceOutboundWhisper = new ConnectContactFlow(this, 'voice-outbound-whisper', {
        instanceId: connectInstance.id,
        name: 'numa-voice-outbound-whisper',
        type: 'OUTBOUND_WHISPER',
        description:
          'Numa Voice: record Agent + Customer on agent-initiated outbound dials (FEAT-159). No customer-played prompt — the OUTBOUND_WHISPER plays to the CUSTOMER, so the agent-facing recording-consent reminder lives in the UI, not here.',
        content: JSON.stringify({
          Version: '2019-10-30',
          // NOTE: an OUTBOUND_WHISPER flow plays to the CUSTOMER (the called party),
          // NOT the agent. A MessageParticipant here was heard by the PROSPECT, even
          // though the text ("...tell the prospect the call is being recorded") is an
          // instruction for the SDR. So we play nothing to the customer and only set
          // the recording behavior; the agent's recording-consent reminder is surfaced
          // in the Numa UI (RecordingConsentBanner + on-connect reminder + wrap-up
          // attestation) — the other halves of the consent flow.
          StartAction: 'rec',
          Metadata: {
            entryPointPosition: { x: 20, y: 20 },
            snapToGrid: false,
            ActionMetadata: {
              rec: { position: { x: 224, y: 56 } },
              end: { position: { x: 448, y: 56 } },
            },
          },
          Actions: [
            {
              Identifier: 'rec',
              Type: 'UpdateContactRecordingBehavior',
              Parameters: { RecordingBehavior: { RecordedParticipants: ['Agent', 'Customer'] } },
              Transitions: { NextAction: 'end', Errors: [], Conditions: [] },
            },
            { Identifier: 'end', Type: 'EndFlowExecution', Parameters: {}, Transitions: {} },
          ],
        }),
        ...pin,
      });
      // Outbound queue: DID as caller-ID + the recording whisper flow so outbound
      // calls are recorded (the missing FEAT-159 link).
      const voiceOutboundQueue = new ConnectQueue(this, 'voice-outbound-queue', {
        instanceId: connectInstance.id,
        name: 'numa-voice-outbound',
        hoursOfOperationId: voiceHours.hoursOfOperationId,
        outboundCallerConfig: {
          ...(voicePhoneNumber ? { outboundCallerIdNumberId: voicePhoneNumber.id } : {}),
          outboundFlowId: voiceOutboundWhisper.contactFlowId,
        },
        ...pin,
      });

      // ── INBOUND: shared team queue + per-DID router + inbound flow ─────────────
      // Shared inbound queue: every claimed DID can ring the whole team here. In
      // personal mode an OWNED DID instead rings only its owner's agent queue (the
      // router Lambda resolves that); unowned DIDs and shared mode land here.
      const voiceInboundShared = new ConnectQueue(this, 'voice-inbound-shared-queue', {
        instanceId: connectInstance.id,
        name: 'numa-voice-inbound-shared',
        hoursOfOperationId: voiceHours.hoursOfOperationId,
        ...pin,
      });

      // Router Lambda — the inbound flow invokes it per call to pick the target queue
      // from the dialled DID's `numa-owner` tag + the instance `numa-voice-mode` tag.
      const voiceRouterZip = path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'lambdas',
        'node/numa-voice-router',
        'lambda_function.zip'
      );
      const voiceRouterRole = new IamRole(this, 'voice-router-role', {
        assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
        ...pin,
      });
      const voiceRouterBasic = new IamRolePolicyAttachment(this, 'voice-router-basic', {
        role: voiceRouterRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        ...pin,
      });
      const voiceRouterPolicy = new IamPolicy(this, 'voice-router-policy', {
        policy: new DataAwsIamPolicyDocument(this, 'voice-router-policy-doc', {
          statement: [
            {
              effect: 'Allow',
              actions: [
                'connect:ListPhoneNumbersV2',
                'connect:DescribePhoneNumber',
                'connect:ListTagsForResource',
                'connect:ListUsers',
              ],
              resources: ['*'],
            },
          ],
        }).json,
        ...pin,
      });
      new IamRolePolicyAttachment(this, 'voice-router-policy-attach', {
        role: voiceRouterRole.name,
        policyArn: voiceRouterPolicy.arn,
        ...pin,
      });
      const voiceRouterLambda = new LambdaFunction(this, 'voice-router-lambda', {
        functionName: `${clientName}-numa-voice-router`,
        role: voiceRouterRole.arn,
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        filename: voiceRouterZip,
        sourceCodeHash: Fn.filebase64sha256(voiceRouterZip),
        timeout: 10,
        environment: {
          variables: {
            SHARED_INBOUND_QUEUE_ARN: voiceInboundShared.arn,
            OWNER_TAG: 'numa-owner',
            MODE_TAG: 'numa-voice-mode',
          },
        },
        dependsOn: [voiceRouterBasic],
        ...pin,
      });
      // Connect needs both a resource-policy grant AND the instance association to
      // invoke the Lambda from a contact flow.
      new LambdaPermission(this, 'voice-router-connect-invoke', {
        statementId: 'AllowConnectInvoke',
        action: 'lambda:InvokeFunction',
        functionName: voiceRouterLambda.functionName,
        principal: 'connect.amazonaws.com',
        sourceArn: connectInstance.arn,
        ...pin,
      });
      new ConnectLambdaFunctionAssociation(this, 'voice-router-assoc', {
        instanceId: connectInstance.id,
        functionArn: voiceRouterLambda.arn,
        ...pin,
      });

      // Inbound contact flow: record both channels → ask the router which queue → set
      // it and transfer. FAIL-OPEN: any error routes to the shared queue so an inbound
      // call never drops. (NOTE: Connect flow JSON is finicky and only verifiable on a
      // live instance — validate/adjust this flow in the Connect console after deploy.)
      const voiceInboundFlow = new ConnectContactFlow(this, 'voice-inbound-flow', {
        instanceId: connectInstance.id,
        name: 'numa-voice-inbound',
        type: 'CONTACT_FLOW',
        description:
          'Numa Voice inbound: record + route the dialled DID to its owner (personal) or the shared team queue.',
        content: JSON.stringify({
          Version: '2019-10-30',
          StartAction: 'rec',
          Metadata: {
            entryPointPosition: { x: 20, y: 20 },
            snapToGrid: false,
            ActionMetadata: {
              rec: { position: { x: 200, y: 40 } },
              route: { position: { x: 400, y: 40 } },
              setq: { position: { x: 600, y: 40 } },
              xfer: { position: { x: 800, y: 40 } },
              sharedq: { position: { x: 600, y: 240 } },
              xfershared: { position: { x: 800, y: 240 } },
              end: { position: { x: 1000, y: 140 } },
            },
          },
          Actions: [
            {
              Identifier: 'rec',
              Type: 'UpdateContactRecordingBehavior',
              Parameters: { RecordingBehavior: { RecordedParticipants: ['Agent', 'Customer'] } },
              Transitions: { NextAction: 'route', Errors: [], Conditions: [] },
            },
            {
              Identifier: 'route',
              Type: 'InvokeLambdaFunction',
              Parameters: { LambdaFunctionARN: voiceRouterLambda.arn, InvocationTimeLimitSeconds: '8' },
              Transitions: { NextAction: 'setq', Errors: [{ NextAction: 'sharedq', ErrorType: 'NoMatchingError' }] },
            },
            {
              Identifier: 'setq',
              Type: 'UpdateContactTargetQueue',
              Parameters: { QueueId: '$.External.queueArn' },
              Transitions: { NextAction: 'xfer', Errors: [{ NextAction: 'sharedq', ErrorType: 'NoMatchingError' }] },
            },
            {
              Identifier: 'xfer',
              Type: 'TransferContactToQueue',
              Parameters: {},
              Transitions: {
                NextAction: 'end',
                Errors: [
                  { NextAction: 'sharedq', ErrorType: 'QueueAtCapacity' },
                  { NextAction: 'sharedq', ErrorType: 'NoMatchingError' },
                ],
              },
            },
            {
              Identifier: 'sharedq',
              // "Set working queue" takes the queue ARN — match the router's ARN format
              // (the dynamic personal path uses $.External.queueArn, an ARN) so both
              // branches are consistent.
              Type: 'UpdateContactTargetQueue',
              Parameters: { QueueId: voiceInboundShared.arn },
              Transitions: { NextAction: 'xfershared', Errors: [{ NextAction: 'end', ErrorType: 'NoMatchingError' }] },
            },
            {
              Identifier: 'xfershared',
              Type: 'TransferContactToQueue',
              Parameters: {},
              Transitions: {
                NextAction: 'end',
                Errors: [
                  { NextAction: 'end', ErrorType: 'QueueAtCapacity' },
                  { NextAction: 'end', ErrorType: 'NoMatchingError' },
                ],
              },
            },
            { Identifier: 'end', Type: 'DisconnectParticipant', Parameters: {}, Transitions: {} },
          ],
        }),
        ...pin,
      });
      // Surface the inbound flow id so the admin Lambda can associate claimed DIDs with it.
      void voiceInboundFlow;

      // Routing profile whose DEFAULT OUTBOUND queue is numa-voice-outbound (the one
      // carrying the caller-ID DID). The default "Basic Routing Profile" routes outbound
      // through BasicQueue, which has no caller-ID -> Connect rejects the dial with
      // "Cannot dial third party destination: The outbound queue is misconfigured".
      // The agent must use THIS profile so its default outbound queue has a caller-ID.
      const voiceRoutingProfile = new ConnectRoutingProfile(this, 'voice-routing-profile', {
        instanceId: connectInstance.id,
        name: 'numa-voice-routing',
        description: 'Numa Voice outbound SDR routing (default outbound queue carries the caller-ID DID)',
        defaultOutboundQueueId: voiceOutboundQueue.queueId,
        mediaConcurrencies: [{ channel: 'VOICE', concurrency: 1 }],
        // Outbound queue (caller-ID) + the shared inbound queue, so every agent on this
        // profile both dials out AND receives shared/team inbound calls.
        queueConfigs: [
          { channel: 'VOICE', delay: 0, priority: 1, queueId: voiceOutboundQueue.queueId },
          { channel: 'VOICE', delay: 0, priority: 1, queueId: voiceInboundShared.queueId },
        ],
        ...pin,
      });
      // Federated agent user (SAML → no password). numa-voice-admin's
      // /voice/federation-token mints a console-federation login URL for this username.
      new ConnectUser(this, 'voice-agent-user', {
        instanceId: connectInstance.id,
        name: 'numa-voice-agent',
        routingProfileId: voiceRoutingProfile.routingProfileId,
        securityProfileIds: [agentSecurityProfile.securityProfileId],
        identityInfo: { firstName: 'Numa', lastName: 'Voice' },
        phoneConfig: { phoneType: 'SOFT_PHONE', autoAccept: false, afterContactWorkTimeLimit: 0 },
        ...pin,
      });

      // ── Approved Origin (the ONE Connect item with no Terraform resource) ─────
      // AssociateApprovedOrigin is SDK-only — a tiny idempotent deploy-time
      // LambdaInvocation associates the Numa domain so the embedded CCP loads.
      const connectSeedZip = path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'lambdas',
        'node/seed-connect-config',
        'lambda_function.zip'
      );
      const connectSeedRole = new IamRole(this, 'seed-connect-role', {
        assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
        ...pin,
      });
      const connectSeedBasic = new IamRolePolicyAttachment(this, 'seed-connect-basic', {
        role: connectSeedRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        ...pin,
      });
      const connectSeedPolicy = new IamPolicy(this, 'seed-connect-policy', {
        policy: new DataAwsIamPolicyDocument(this, 'seed-connect-policy-doc', {
          statement: [{ effect: 'Allow', actions: ['connect:AssociateApprovedOrigin'], resources: ['*'] }],
        }).json,
        ...pin,
      });
      const connectSeedAttach = new IamRolePolicyAttachment(this, 'seed-connect-policy-attach', {
        role: connectSeedRole.name,
        policyArn: connectSeedPolicy.arn,
        ...pin,
      });
      const connectSeedLambda = new LambdaFunction(this, 'seed-connect-lambda', {
        functionName: `${clientName}-seed-connect-config`,
        role: connectSeedRole.arn,
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        filename: connectSeedZip,
        sourceCodeHash: Fn.filebase64sha256(connectSeedZip),
        timeout: 120,
        environment: {
          variables: {
            INSTANCE_ID: connectInstance.id,
            APPROVED_ORIGIN: `https://${clientName}.numa.arcanum.ai`,
          },
        },
        dependsOn: [connectSeedAttach],
        ...pin,
      });
      new LambdaInvocation(this, 'seed-connect-invocation', {
        functionName: connectSeedLambda.functionName,
        input: JSON.stringify({ action: 'configure' }),
        triggers: { seedSourceHash: connectSeedLambda.sourceCodeHash, instanceId: connectInstance.id },
        dependsOn: [connectSeedLambda, connectSeedBasic, connectInstance],
        ...pin,
      });
    }
  }
}
