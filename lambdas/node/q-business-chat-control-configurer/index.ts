import { QBusinessClient, UpdateChatControlsConfigurationCommand } from '@aws-sdk/client-qbusiness';
import { withPRM } from '../../../lib/prm-node/prm';
import { Handler } from 'aws-lambda';

interface ChatControlConfiguration {
  applicationId: string;
  enableDirectLLMAccess: boolean;
  enableLLMKnowledgeFallback: boolean;
}

export const handler: Handler<ChatControlConfiguration, void> = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  const client = withPRM(QBusinessClient, { region: process.env['Q_BUSINESS_REGION'] });

  await client.send(
    new UpdateChatControlsConfigurationCommand({
      applicationId: event.applicationId,
      responseScope: event.enableLLMKnowledgeFallback ? 'EXTENDED_KNOWLEDGE_ENABLED' : 'ENTERPRISE_CONTENT_ONLY',
      creatorModeConfiguration: {
        creatorModeControl: event.enableDirectLLMAccess ? 'ENABLED' : 'DISABLED',
      },
    }),
  );
};
