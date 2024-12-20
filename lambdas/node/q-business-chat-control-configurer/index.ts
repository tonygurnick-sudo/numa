import { QBusinessClient, UpdateChatControlsConfigurationCommand } from '@aws-sdk/client-qbusiness';
import { Handler } from 'aws-lambda';

interface ChatControlConfiguration {
  applicationId: string;
  enableDirectLLMAccess: boolean;
  enableLLMKnowledgeFallback: boolean;
}

export const handler: Handler<ChatControlConfiguration, void> = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  const client = new QBusinessClient();

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
