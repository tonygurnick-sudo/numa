import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const runningStates = ['RUNNING', 'PENDING_REDRIVE'];

export async function handler(event: Event): Promise<{ event: string }> {
  const client = new SFNClient({
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
    throw new Error('Execution did not succeed.');
  }
  console.log('Success:', describeResult.output);
  return JSON.parse(describeResult.output).CreateAccountStatus.AccountId;
}

interface Event {
  clientName: string;
}
