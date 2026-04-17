import type { SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ECSClient, RunTaskCommand, ListTasksCommand } from '@aws-sdk/client-ecs';
// CHOSE HEAD: CopyObjectCommand needed to copy extraction output to {fileKey}.json for nova-api discovery.
// To revert to 3af3ef8e: remove CopyObjectCommand from import.
import { S3Client, PutObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { withPRM } from '../../../lib/prm-node/prm';

const REGION = process.env.REGION ?? 'us-east-1';
const TABLE_NAME = process.env.TRANSCRIPTIONS_TABLE_NAME as string;
const DATA_BUCKET = process.env.DATA_BUCKET_NAME as string;
const EXTRACT_CONTENT_LAMBDA = process.env.EXTRACT_CONTENT_LAMBDA_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;
const AUDIT_AUTOMATION_TABLE = process.env.AUDIT_AUTOMATION_TABLE_NAME;

// Fargate routing configuration
const ECS_CLUSTER_ARN = process.env.ECS_CLUSTER_ARN;
const ECS_TASK_DEFINITION_ARN = process.env.ECS_TASK_DEFINITION_ARN;
const ECS_SUBNET_IDS = process.env.ECS_SUBNET_IDS?.split(',') ?? [];
const ECS_SECURITY_GROUP_ID = process.env.ECS_SECURITY_GROUP_ID;
const FARGATE_MAX_CONCURRENT = parseInt(process.env.FARGATE_MAX_CONCURRENT ?? '3', 10);

const ddbClient = withPRM(DynamoDBClient, { region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const lambda = withPRM(LambdaClient, { region: REGION });
const ecs = withPRM(ECSClient, { region: REGION });
const s3 = withPRM(S3Client, { region: REGION });

interface JobMessage {
  jobId: string;
  userSub: string;
  fileName: string;
  fileKey: string;
  fileExtension: string;
  fileSize: number;
  dataBucket: string;
  clientName: string;
  fileHash?: string;
  pipelineId?: string; // CHOSE HEAD: kept for traceability; 3af3ef8e removed it.
}

// Formats that require Fargate (special system deps)
const FARGATE_ONLY_FORMATS = new Set([
  '.epub',
  '.djvu',
  '.parquet',
  '.sqlite',
  '.db',
  '.zip',
  '.tar',
  '.tgz',
  '.gz',
  '.svg',
]);

// File size thresholds for Fargate routing (bytes)
const FARGATE_SIZE_THRESHOLDS: Record<string, number> = {
  default: 50 * 1024 * 1024, // All files over 50 MB → Fargate
};

/** Write an audit log entry to the automation table (non-fatal). */
const writeAuditLog = async (item: Record<string, unknown>): Promise<void> => {
  if (!AUDIT_AUTOMATION_TABLE) return;
  try {
    await dynamo.send(new PutCommand({ TableName: AUDIT_AUTOMATION_TABLE, Item: item }));
    console.log('Audit log written', { logId: item.logId, action: item.action });
  } catch (err) {
    console.error('Failed to write audit log', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const shouldUseFargate = (job: JobMessage): boolean => {
  // Fargate-only formats always go to Fargate
  if (FARGATE_ONLY_FORMATS.has(job.fileExtension)) return true;

  // Large files go to Fargate based on format-specific thresholds
  const threshold = FARGATE_SIZE_THRESHOLDS[job.fileExtension] ?? FARGATE_SIZE_THRESHOLDS['default'];
  return job.fileSize > threshold;
};

const updateJobStatus = async (
  userSub: string,
  jobId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<void> => {
  const expressionParts = ['#s = :status', 'updatedAt = :now'];
  const attrNames: Record<string, string> = { '#s': 'status' };
  const attrValues: Record<string, unknown> = { ':status': status, ':now': Date.now() };

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      expressionParts.push(`${key} = :${key}`);
      attrValues[`:${key}`] = value;
    }
  }

  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { userSub, jobId },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    })
  );
};

const checkCancelled = async (userSub: string, jobId: string): Promise<boolean> => {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE_NAME, Key: { userSub, jobId } }));
  return result.Item?.status === 'CANCEL_REQUESTED';
};

const getRunningFargateTaskCount = async (): Promise<number> => {
  if (!ECS_CLUSTER_ARN) return 0;
  const result = await ecs.send(
    new ListTasksCommand({
      cluster: ECS_CLUSTER_ARN,
      desiredStatus: 'RUNNING',
    })
  );
  return result.taskArns?.length ?? 0;
};

const dispatchToFargate = async (job: JobMessage): Promise<void> => {
  if (!ECS_CLUSTER_ARN || !ECS_TASK_DEFINITION_ARN || !ECS_SECURITY_GROUP_ID) {
    throw new Error('Fargate configuration not available — ECS_CLUSTER_ARN, ECS_TASK_DEFINITION_ARN required');
  }

  // Check concurrency limit
  const runningCount = await getRunningFargateTaskCount();
  if (runningCount >= FARGATE_MAX_CONCURRENT) {
    // Return the message to the queue by throwing (SQS will redeliver after visibility timeout)
    throw new Error(
      `Fargate concurrency limit reached (${runningCount}/${FARGATE_MAX_CONCURRENT}). Message will be retried.`
    );
  }

  console.log(`Dispatching job ${job.jobId} to Fargate`, {
    fileExtension: job.fileExtension,
    fileSize: job.fileSize,
    runningTasks: runningCount,
  });

  await ecs.send(
    new RunTaskCommand({
      cluster: ECS_CLUSTER_ARN,
      taskDefinition: ECS_TASK_DEFINITION_ARN,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: 'ENABLED',
          subnets: ECS_SUBNET_IDS,
          securityGroups: [ECS_SECURITY_GROUP_ID],
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'transcription',
            environment: [
              { name: 'JOB_ID', value: job.jobId },
              { name: 'USER_SUB', value: job.userSub },
              { name: 'FILE_BUCKET', value: job.dataBucket },
              { name: 'FILE_KEY', value: job.fileKey },
              { name: 'FILE_NAME', value: job.fileName },
              { name: 'FILE_HASH', value: job.fileHash ?? '' },
              { name: 'PIPELINE_ID', value: job.pipelineId ?? '' }, // CHOSE HEAD: pass pipelineId to Fargate task.
              { name: 'OUTPUT_BUCKET', value: DATA_BUCKET },
              { name: 'TABLE_NAME', value: TABLE_NAME },
              { name: 'CLIENT_NAME', value: CLIENT_NAME },
              { name: 'REGION', value: REGION },
              { name: 'EXTRACT_CONTENT_LAMBDA_NAME', value: EXTRACT_CONTENT_LAMBDA },
              { name: 'JOB_QUEUE_URL', value: process.env.JOB_QUEUE_URL ?? '' },
              { name: 'DATA_BUCKET_NAME', value: DATA_BUCKET },
            ],
          },
        ],
      },
    })
  );

  // Mark as processing — the Fargate task will update status as it runs
  await updateJobStatus(job.userSub, job.jobId, 'PROCESSING');
  console.log(`Fargate task launched for job ${job.jobId}`);
};

// ─── Resource usage tracking ───

interface CostBreakdown {
  lambda?: { durationMs: number; memoryMb: number };
  s3?: { reads: number; writes: number };
  bedrock?: { inputTokens: number; outputTokens: number };
  transcribe?: { durationSeconds: number };
  total: number;
}

const buildResourceUsage = (
  durationMs: number,
  lambdaMemoryMb: number,
  responsePayload: Record<string, unknown>
): CostBreakdown => {
  const costs: CostBreakdown = { total: 0 };

  // Lambda resource usage
  costs.lambda = { durationMs, memoryMb: lambdaMemoryMb };

  // S3: 1 read (input) + 1 write (output)
  costs.s3 = { reads: 1, writes: 1 };

  // Bedrock tokens (if vision/LLM was used)
  const inputTokens = typeof responsePayload?.input_tokens === 'number' ? responsePayload.input_tokens : 0;
  const outputTokens = typeof responsePayload?.output_tokens === 'number' ? responsePayload.output_tokens : 0;
  if (inputTokens > 0 || outputTokens > 0) {
    costs.bedrock = { inputTokens, outputTokens };
  }

  // Transcribe duration (if audio/video)
  const transcribeDuration =
    typeof responsePayload?.transcribe_duration_seconds === 'number' ? responsePayload.transcribe_duration_seconds : 0;
  if (transcribeDuration > 0) {
    costs.transcribe = { durationSeconds: transcribeDuration };
  }

  return costs;
};

const writeStatusFile = async (
  job: JobMessage,
  outputKey: string,
  startTime: number,
  result: {
    status: 'SUCCEEDED' | 'FAILED';
    processingTimeMs: number;
    costs?: CostBreakdown;
    errorMessage?: string;
  }
): Promise<void> => {
  const statusKey = `transcriptions/${job.userSub}/${job.jobId}/output.status.json`;
  const statusData: Record<string, unknown> = {
    version: 2,
    status: result.status,
    input_bucket: job.dataBucket,
    input_key: job.fileKey,
    output_bucket: DATA_BUCKET,
    output_key: outputKey,
    file_name: job.fileName,
    file_size: job.fileSize,
    file_extension: job.fileExtension,
    file_hash: job.fileHash ?? null,
    pipeline_id: job.pipelineId ?? null, // CHOSE HEAD: kept for traceability; 3af3ef8e removed it.
    client_name: CLIENT_NAME,
    data_bucket: DATA_BUCKET,
    started_at: startTime / 1000,
    updated_at: Date.now() / 1000,
    duration_ms: result.processingTimeMs,
  };

  if (result.costs) {
    statusData.costs = result.costs;
  }
  if (result.errorMessage) {
    statusData.error_message = result.errorMessage;
  }

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: DATA_BUCKET,
        Key: statusKey,
        Body: JSON.stringify(statusData, null, 2),
        ContentType: 'application/json',
      })
    );
    console.log(`Wrote enriched status file: ${statusKey}`);
  } catch (err) {
    console.error(`Failed to write status file ${statusKey}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const processJobViaLambda = async (job: JobMessage): Promise<void> => {
  const { jobId, userSub, fileName, fileKey, fileExtension, dataBucket } = job;
  const outputKey = `transcriptions/${userSub}/${jobId}/output.json`;

  await updateJobStatus(userSub, jobId, 'PROCESSING');

  const startTime = Date.now();

  try {
    const payload = JSON.stringify({
      input_bucket: dataBucket,
      input_key: fileKey,
      output_bucket: DATA_BUCKET,
      output_key: outputKey,
      file_name: fileName,
      return_content: false,
    });

    console.log(`Invoking extract-content-from-file for job ${jobId}`, {
      fileKey,
      fileExtension,
      outputKey,
    });

    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: EXTRACT_CONTENT_LAMBDA,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(payload),
      })
    );

    const responsePayload = JSON.parse(new TextDecoder().decode(response.Payload));

    if (response.FunctionError) {
      const errorMessage =
        responsePayload?.errorMessage || responsePayload?.error || 'Extraction Lambda returned an error';
      throw new Error(errorMessage);
    }

    if (await checkCancelled(userSub, jobId)) {
      await updateJobStatus(userSub, jobId, 'CANCELLED');
      console.log(`Job ${jobId} was cancelled during processing`);
      return;
    }

    const processingTimeMs = Date.now() - startTime;
    const costs = buildResourceUsage(processingTimeMs, 1024, responsePayload ?? {});

    await updateJobStatus(userSub, jobId, 'COMPLETED', {
      outputKey,
      progress: 100,
      processingTimeMs,
      costs,
    });

    await writeStatusFile(job, outputKey, startTime, {
      status: 'SUCCEEDED',
      processingTimeMs,
      costs,
    });

    // CHOSE HEAD: copy extraction output to {fileKey}.json so nova-api can discover it without DDB access.
    // To revert to 3af3ef8e: remove this try/catch block.
    try {
      const copyResponse = await s3.send(
        new CopyObjectCommand({
          Bucket: DATA_BUCKET,
          Key: `${fileKey}.json`,
          CopySource: `${DATA_BUCKET}/${outputKey}`,
        })
      );
      console.log(`Copied extraction output to ${fileKey}.json`, { copyResponse });
    } catch (copyErr) {
      console.error(`Failed to copy extraction output to ${fileKey}.json`, {
        error: copyErr instanceof Error ? copyErr.message : String(copyErr),
      });
    }

    console.log(`Job ${jobId} completed successfully`, { outputKey, processingTimeMs, totalCost: costs.total });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const processingTimeMs = Date.now() - startTime;
    console.error(`Job ${jobId} failed`, { error: errorMessage, processingTimeMs });

    await updateJobStatus(userSub, jobId, 'FAILED', {
      errorMessage,
      processingTimeMs,
    });

    await writeStatusFile(job, outputKey, startTime, {
      status: 'FAILED',
      processingTimeMs,
      errorMessage,
    });
  }
};

const processJob = async (job: JobMessage): Promise<void> => {
  const { jobId, userSub } = job;

  // Check for cancellation before starting
  if (await checkCancelled(userSub, jobId)) {
    await updateJobStatus(userSub, jobId, 'CANCELLED');
    console.log(`Job ${jobId} was cancelled before processing`);
    return;
  }

  // Route to Lambda (fast) or Fargate (slow/special)
  if (shouldUseFargate(job)) {
    await dispatchToFargate(job);
  } else {
    await processJobViaLambda(job);
  }
};

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    try {
      const job: JobMessage = JSON.parse(record.body);
      const sqsMessageId = record.messageId;
      const sqsReceiveCount = Number(record.attributes?.ApproximateReceiveCount ?? 1);

      console.log(`Processing job ${job.jobId}`, {
        fileName: job.fileName,
        fileSize: job.fileSize,
        fileExtension: job.fileExtension,
        useFargate: shouldUseFargate(job),
        sqsMessageId,
        sqsReceiveCount,
      });

      // Store SQS metadata + audit timestamp on the job record so stream handler can read them
      const auditLogTimestamp = Date.now();
      await dynamo.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { userSub: job.userSub, jobId: job.jobId },
          UpdateExpression: 'SET sqsMessageId = :mid, sqsReceiveCount = :rc, auditLogTimestamp = :alt',
          ExpressionAttributeValues: {
            ':mid': sqsMessageId,
            ':rc': sqsReceiveCount,
            ':alt': auditLogTimestamp,
          },
        })
      );

      // Write audit log: transcription started (deterministic logId so stream handler can update it)
      await writeAuditLog({
        logId: `txn-${job.jobId}`,
        timestamp: auditLogTimestamp,
        action: 'TRANSCRIPTION_STARTED',
        status: 'in_progress',
        userId: job.userSub,
        details: {
          jobId: job.jobId,
          fileName: job.fileName,
          fileKey: job.fileKey,
          fileSize: job.fileSize,
          fileExtension: job.fileExtension,
          routedTo: shouldUseFargate(job) ? 'fargate' : 'lambda',
          sqsMessageId,
          sqsReceiveCount,
        },
        ttl: Math.floor(auditLogTimestamp / 1000) + 90 * 24 * 60 * 60,
      });

      await processJob(job);
    } catch (error) {
      console.error('Failed to process SQS record', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
};
