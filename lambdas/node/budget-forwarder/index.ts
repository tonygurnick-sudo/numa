import { SNSHandler, SNSEvent } from 'aws-lambda';
import * as process from 'node:process';
import { SNSClient, PublishCommand, MessageAttributeValue } from '@aws-sdk/client-sns';
import { withPRM } from '../../../lib/prm-node/prm';

const snsClient = withPRM(SNSClient, { region: 'us-east-1' });
const centralTopicArn = process.env.CENTRAL_SNS_TOPIC_ARN || '';
const clientName = process.env.CLIENT_NAME || '';
const accountId = process.env.ACCOUNT_ID || '';

interface BudgetMessage {
  ActualSpend?: string;
  BudgetLimit?: string;
  BudgetName?: string;
  Time?: string;
  ThresholdExceeded?: string;
  [key: string]: unknown;
}

export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));

  // Process all records
  const messages = event.Records.map((record) => {
    try {
      const message = JSON.parse(record.Sns.Message) as BudgetMessage;
      return {
        rawData: {
          ...message,
          clientMetadata: {
            clientName,
            accountId,
            timestamp: new Date().toISOString(),
            originalSubject: record.Sns.Subject || '',
          },
        },
      };
    } catch (error) {
      console.error('Error processing record:', error);
      throw error;
    }
  });

  try {
    const messageAttributes: Record<string, MessageAttributeValue> = {
      ClientName: { DataType: 'String', StringValue: clientName },
      AccountId: { DataType: 'String', StringValue: accountId },
      AlertType: { DataType: 'String', StringValue: 'BudgetAlert' },
    };

    const publishCommand = new PublishCommand({
      TopicArn: centralTopicArn,
      Message: JSON.stringify({
        default: JSON.stringify(messages.map((m) => m.rawData)),
      }),
      Subject: `Budget Alert: ${clientName} (${accountId})`,
      MessageStructure: 'json',
      MessageAttributes: messageAttributes,
    });

    const result = await snsClient.send(publishCommand);
    console.log(`Forwarded budget alerts to central topic with MessageId: ${result.MessageId}`);
  } catch (error) {
    console.error('Error forwarding budget alerts:', error);
    throw error;
  }
};
