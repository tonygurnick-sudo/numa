/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autoNameConversation } from '../../utils/autoChatTitle';
import type { BedrockRuntimeClient, InvokeModelCommandOutput } from '@aws-sdk/client-bedrock-runtime';

// Mock bedrockModelConfig to avoid env dependencies
vi.mock('../../utils/bedrockModelConfig', () => ({
  getModelId: vi.fn().mockReturnValue('anthropic.claude-3-haiku-20240307-v1:0'),
  MODEL_TYPES: { CLAUDE_HAIKU: 'CLAUDE_HAIKU' },
}));

describe('autoChatTitle - prompt-only title generation', () => {
  const originalSessionStorage = window.sessionStorage;

  beforeEach(() => {
    // Ensure REGION is available for model selection code path
    try {
      window.sessionStorage.setItem('REGION', 'us-east-1');
    } catch {
      Object.defineProperty(window, 'sessionStorage', {
        value: {
          getItem: (key: string) => (key === 'REGION' ? 'us-east-1' : null),
          setItem: () => undefined,
          removeItem: () => undefined,
          clear: () => undefined,
          key: () => null,
          length: 1,
        },
        configurable: true,
      });
    }
  });

  afterEach(() => {
    try {
      window.sessionStorage.removeItem('REGION');
    } catch {
      Object.defineProperty(window, 'sessionStorage', { value: originalSessionStorage });
    }
    vi.clearAllMocks();
  });

  it('updates default title using Bedrock result and sanitizes quotes/periods', async () => {
    const conversationId = 'convo-1';
    const userId = 'user-1';

    // Mock Dynamo utils
    const items = [
      {
        message_type: 'meta',
        conversationName: 'Untitled Chat',
        timestamp: 1,
      },
      {
        message_type: 'text',
        role: 'user',
        content: 'why is the sky blue and the grass green?',
        timestamp: 2,
      },
      {
        message_type: 'text',
        role: 'assistant',
        content: 'Because of Rayleigh scattering and chlorophyll.',
        timestamp: 3,
      },
    ];

    const numaChatDynamoUtils = {
      queryConversations: vi.fn().mockResolvedValue(items),
      updateConversationName: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('../../utils/DynamoDBUtils').NumaChatDynamoUtils;

    // Mock Bedrock client send() to return a title with quotes and trailing period
    const modelResponse = {
      content: [{ type: 'text', text: '"Sky and grass colours."' }],
    };
    const encoded = new TextEncoder().encode(JSON.stringify(modelResponse));
    const bedrockRuntimeClient = {
      send: vi.fn().mockResolvedValue({ body: encoded } as InvokeModelCommandOutput),
    } as unknown as BedrockRuntimeClient;

    const renamed = await autoNameConversation({
      conversationId,
      userId,
      bedrockRuntimeClient,
      numaChatDynamoUtils,
      region: null,
    });

    expect(renamed).toBe(true);
    expect(numaChatDynamoUtils.updateConversationName).toHaveBeenCalledTimes(1);
    expect(numaChatDynamoUtils.updateConversationName).toHaveBeenCalledWith(
      conversationId,
      userId,
      'Sky and grass colours',
      'auto',
    );
  });
});
