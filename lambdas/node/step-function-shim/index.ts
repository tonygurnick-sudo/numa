import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';

const runningStates = ['RUNNING', 'PENDING_REDRIVE'];

export async function handler(event: Event): Promise<{ event: string }> {
  // Extract job ID from event if available
  const jobId = event.jobId;
  const client = withPRM(SFNClient, {
    region: process.env.TARGET_REGION,
    credentials: fromTemporaryCredentials({
      params: {
        RoleArn: process.env.START_ROLE_ARN,
      },
    }),
  });

  const start = new StartExecutionCommand({
    stateMachineArn: process.env.TARGET_STATE_MACHINE,
    input: JSON.stringify({ accountName: event.clientName }),
  });
  const startResult = await client.send(start);

  const describe = new DescribeExecutionCommand({
    executionArn: startResult.executionArn,
  });

  let i = 10;
  let describeResult;
  while (--i > 0) {
    describeResult = await client.send(describe);
    console.log(describeResult.status);
    if (!runningStates.includes(describeResult.status ?? 'RUNNING')) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!describeResult || describeResult.status != 'SUCCEEDED' || !describeResult.output) {
    // Update job status in DynamoDB if jobId is provided
    if (jobId) {
      await updateJobStatus(
        jobId,
        'FAILURE',
        `Your job could not be completed. Status: ${getReadableStatus(describeResult?.status || 'UNKNOWN')}`
      );
    }
    throw new Error('Execution did not succeed.');
  }
  console.log('Success:', describeResult.output);
  return JSON.parse(describeResult.output).CreateAccountStatus.AccountId;
}

interface Event {
  clientName: string;
  jobId?: string;
  appId?: string;
}

/**
 * Converts technical Step Function status codes into user-friendly messages
 */
function getReadableStatus(status: string): string {
  switch (status) {
    case 'FAILED':
      return 'The process encountered an error';
    case 'TIMED_OUT':
      return 'The process took too long to complete';
    case 'ABORTED':
      return 'The process was stopped before completion';
    default:
      return `The process could not complete (${status})`;
  }
}

/**
 * Updates the job status in DynamoDB when a Step Function execution fails or times out
 */
async function updateJobStatus(jobId: string, status: string, errorMessage: string): Promise<void> {
  try {
    const tableName = process.env.JOBS_TABLE_NAME || 'numa-jobs';

    const dynamoClient = withPRM(DynamoDBClient, {
      region: process.env.TARGET_REGION,
    });

    const updateCommand = new UpdateItemCommand({
      TableName: tableName,
      Key: {
        job_id: { S: jobId },
      },
      UpdateExpression: 'SET #status = :status, #error = :error, #lastUpdated = :lastUpdated',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#error': 'error',
        '#lastUpdated': 'lastUpdated',
      },
      ExpressionAttributeValues: {
        ':status': { S: status },
        ':error': { S: errorMessage },
        ':lastUpdated': { S: new Date().toISOString() },
      },
    });

    await dynamoClient.send(updateCommand);
    console.log(`Updated job ${jobId} status to ${status} in DynamoDB`);
  } catch (error) {
    console.error('Failed to update job status in DynamoDB:', error);
    // Don't throw here to avoid failing the Lambda completely
  }
}
