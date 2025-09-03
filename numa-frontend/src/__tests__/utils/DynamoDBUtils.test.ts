/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NumaChatDynamoUtils } from '../../utils/DynamoDBUtils';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-dynamodb');
vi.mock('@aws-sdk/util-dynamodb');

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: vi.fn((key) => {
      if (key === 'CLIENT_NAME') return 'test-client';
      if (key === 'ENVIRONMENT_NAME') return 'test';
      return null;
    }),
  },
  writable: true,
});

describe('NumaChatDynamoUtils', () => {
  let dynamoUtils;
  let mockDynamoClient;

  beforeEach(() => {
    mockDynamoClient = {
      send: vi.fn(),
    };
    dynamoUtils = new NumaChatDynamoUtils(mockDynamoClient);

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('getUserConversationsMeta', () => {
    it('should return newest conversations first when there are many conversations', async () => {
      const userId = 'test-user';

      // Create mock conversation data - simulate having many conversations
      // with different timestamps to test ordering
      const mockConversations = [
        // Older conversations (should appear later in result)
        {
          sk: 'user_1609459200000#1609459200000', // Jan 1, 2021
          conversation_id: 'user_1609459200000',
          conversationName: 'Old Chat 1',
          latestTimestamp: 1609459200000,
          message_type: 'meta',
        },
        {
          sk: 'user_1609459300000#1609459300000', // Jan 1, 2021 + 100s
          conversation_id: 'user_1609459300000',
          conversationName: 'Old Chat 2',
          latestTimestamp: 1609459300000,
          message_type: 'meta',
        },
        // Newer conversations (should appear first in result)
        {
          sk: 'user_1640995200000#1640995200000', // Jan 1, 2022
          conversation_id: 'user_1640995200000',
          conversationName: 'New Chat 1',
          latestTimestamp: 1640995200000,
          message_type: 'meta',
        },
        {
          sk: 'user_1640995300000#1640995300000', // Jan 1, 2022 + 100s (newest)
          conversation_id: 'user_1640995300000',
          conversationName: 'New Chat 2',
          latestTimestamp: 1640995300000,
          message_type: 'meta',
        },
      ];

      // Mock DynamoDB response to return conversations in wrong order (oldest first)
      // This simulates the current bug where DynamoDB returns items in lexicographic order
      // of sort keys rather than chronological order
      const wrongOrderConversations = [
        mockConversations[0], // oldest first
        mockConversations[1],
        mockConversations[2],
        mockConversations[3], // newest last
      ];

      marshall.mockImplementation((item) => ({ marshalled: item }));
      unmarshall.mockImplementation((item) => item.marshalled || item);

      mockDynamoClient.send.mockResolvedValue({
        Items: wrongOrderConversations.map((conv) => ({ marshalled: conv })),
      });

      // Call the function
      const result = await dynamoUtils.getUserConversationsMeta(userId);

      // Verify the query was called
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(1);

      // After the fix: conversations should be properly sorted by latestTimestamp descending
      // What we expect (newest first):
      const expectedOrder = [
        'user_1640995300000', // newest (Jan 1, 2022 + 100s)
        'user_1640995200000', // Jan 1, 2022
        'user_1609459300000', // Jan 1, 2021 + 100s
        'user_1609459200000', // oldest (Jan 1, 2021)
      ];

      // What we get after fix (should be properly sorted):
      const actualOrder = result.map((conv) => conv.conversation_id);

      // This assertion should PASS after the fix
      expect(actualOrder).toEqual(expectedOrder);
    });

    it('should handle the case with a reasonable limit of conversations', async () => {
      const userId = 'test-user';

      // Create 15 mock conversations to test limiting behavior
      const mockConversations = [];
      const baseTimestamp = 1609459200000; // Jan 1, 2021

      for (let i = 0; i < 15; i++) {
        const timestamp = baseTimestamp + i * 100000; // Each conversation 100s later
        mockConversations.push({
          sk: `user_${timestamp}#${timestamp}`,
          conversation_id: `user_${timestamp}`,
          conversationName: `Chat ${i + 1}`,
          latestTimestamp: timestamp,
          message_type: 'meta',
        });
      }

      marshall.mockImplementation((item) => ({ marshalled: item }));
      unmarshall.mockImplementation((item) => item.marshalled || item);

      // Simulate DynamoDB returning all 15 conversations
      mockDynamoClient.send.mockResolvedValue({
        Items: mockConversations.map((conv) => ({ marshalled: conv })),
      });

      const result = await dynamoUtils.getUserConversationsMeta(userId);

      // Should return all conversations
      expect(result.length).toBe(15);

      // After fix: conversations should be properly sorted by recency (newest first)
      const timestamps = result.map((conv) => conv.latestTimestamp);
      const sortedDescending = [...timestamps].sort((a, b) => b - a);

      // This should PASS after the fix
      expect(timestamps).toEqual(sortedDescending);
    });

    it('should limit conversations to a reasonable number when there are too many', async () => {
      const userId = 'test-user';

      // Create 150 mock conversations to test limiting behavior
      const mockConversations = [];
      const baseTimestamp = 1609459200000; // Jan 1, 2021

      for (let i = 0; i < 150; i++) {
        const timestamp = baseTimestamp + i * 100000; // Each conversation later
        mockConversations.push({
          sk: `user_${timestamp}#${timestamp}`,
          conversation_id: `user_${timestamp}`,
          conversationName: `Chat ${i + 1}`,
          latestTimestamp: timestamp,
          message_type: 'meta',
        });
      }

      marshall.mockImplementation((item) => ({ marshalled: item }));
      unmarshall.mockImplementation((item) => item.marshalled || item);

      // Simulate DynamoDB returning only the limited number due to Limit parameter
      const limitedConversations = mockConversations.slice(-100); // Last 100 (newest)
      mockDynamoClient.send.mockResolvedValue({
        Items: limitedConversations.map((conv) => ({ marshalled: conv })),
      });

      const result = await dynamoUtils.getUserConversationsMeta(userId);

      // Should be limited to reasonable number (100 or less)
      expect(result.length).toBeLessThanOrEqual(100);

      // Should be sorted newest first
      const timestamps = result.map((conv) => conv.latestTimestamp);
      const sortedDescending = [...timestamps].sort((a, b) => b - a);
      expect(timestamps).toEqual(sortedDescending);
    });

    it('should work correctly when there are no conversations', async () => {
      const userId = 'test-user';

      marshall.mockImplementation((item) => ({ marshalled: item }));
      unmarshall.mockImplementation((item) => item.marshalled || item);

      mockDynamoClient.send.mockResolvedValue({
        Items: [],
      });

      const result = await dynamoUtils.getUserConversationsMeta(userId);

      expect(result).toEqual([]);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      const userId = 'test-user';

      marshall.mockImplementation((item) => ({ marshalled: item }));

      mockDynamoClient.send.mockRejectedValue(new Error('DynamoDB Error'));

      const result = await dynamoUtils.getUserConversationsMeta(userId);

      expect(result).toEqual([]);
    });
  });
});
