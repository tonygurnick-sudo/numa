/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prepareConversationHistoryForChat } from '../../utils/bedrockMessageHistoryUtils';

// Mock the s3Utils module
vi.mock('../../utils/s3Utils', () => ({
  fetchFileFromS3: vi.fn().mockResolvedValue({
    text: () => Promise.resolve('Mock file content from S3'),
  }),
}));

describe('bedrockMessageHistoryUtils', () => {
  const mockGetCredentials = vi.fn().mockResolvedValue({
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    sessionToken: 'test-session-token',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods to suppress logs during testing
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => {
          if (key === 'REGION') return 'us-east-1';
          if (key === 'NUMA_CHAT_AGENTS') return 'false';
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    // Restore console methods
    console.log.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
  });

  describe('Tool Block Count Validation Tests', () => {
    it('should handle ValidationException scenario: toolResult count exceeds toolUse count', async () => {
      // This replicates the exact error scenario from your logs
      const conversationHistory = [
        {
          timestamp: 1000,
          message_type: 'text',
          role: 'assistant',
          content: "I'll test both the knowledge base search and web search tools for you.",
        },
        // Single tool call
        {
          timestamp: 1001,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_yk9nVHA_QLWmWgu9hZVSBw',
          tool_name: 'query_knowledge_base',
          tool_payload: { input: {} },
        },
        // Multiple tool results (this should cause validation error)
        {
          timestamp: 1002,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_yk9nVHA_QLWmWgu9hZVSBw',
          tool_payload: {
            content: [{ json: { summarised_content: 'Test result 1' } }],
            status: 'success',
          },
        },
        {
          timestamp: 1003,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_INVALID_EXTRA_RESULT',
          tool_payload: {
            content: [{ json: { summarised_content: 'Extra result that exceeds tool use count' } }],
            status: 'success',
          },
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      // Should have cleaned up the mismatched tool blocks
      expect(result.length).toBeLessThan(4); // Original would be 2 messages (assistant + user)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Removing orphaned toolResult block'),
        'tooluse_INVALID_EXTRA_RESULT',
        'Tool name:',
        'unknown'
      );
    });

    it('should handle case where toolUse count exceeds toolResult count', async () => {
      const conversationHistory = [
        // Multiple tool calls
        {
          timestamp: 1000,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_1',
          tool_name: 'query_knowledge_base',
          tool_payload: { input: {} },
        },
        {
          timestamp: 1001,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_2',
          tool_name: 'web_search',
          tool_payload: { input: {} },
        },
        // Single tool result (missing one result)
        {
          timestamp: 1002,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_1',
          tool_payload: {
            content: [{ json: { summarised_content: 'Only one result' } }],
            status: 'success',
          },
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      // Should have cleaned up the orphaned toolUse block
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Removing orphaned toolUse block'),
        'tooluse_2',
        'Tool name:',
        'web_search'
      );

      // Verify result is properly formatted
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should preserve valid matching tool call/result pairs', async () => {
      const conversationHistory = [
        {
          timestamp: 999,
          message_type: 'text',
          role: 'assistant',
          content: 'Let me call both tools.',
        },
        {
          timestamp: 1000,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_valid_1',
          tool_name: 'query_knowledge_base',
          tool_payload: { input: {} },
        },
        {
          timestamp: 1001,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_valid_2',
          tool_name: 'web_search',
          tool_payload: { input: {} },
        },
        {
          timestamp: 1002,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_valid_1',
          tool_payload: {
            content: [{ json: { summarised_content: 'KB result' } }],
            status: 'success',
          },
        },
        {
          timestamp: 1003,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_valid_2',
          tool_payload: {
            content: [{ json: { summarised_content: 'Web result' } }],
            status: 'success',
          },
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      expect(result).toHaveLength(3); // One assistant text + One assistant message with 2 tool calls + one user message with 2 results
      expect(result[0].role).toBe('assistant'); // Text message
      expect(result[1].role).toBe('assistant'); // Tool calls
      expect(result[1].content).toHaveLength(2); // Two toolUse blocks
      expect(result[2].role).toBe('user');
      expect(result[2].content).toHaveLength(2); // Two toolResult blocks
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Removing orphaned'));
    });
  });

  describe('Real-world Scenario Tests - Your Exact Conversation', () => {
    it('should handle the parallel tool calling scenario from your logs without ValidationException', async () => {
      // This is based on your actual conversation history that caused the error
      const conversationHistory = [
        {
          timestamp: 1000,
          message_type: 'text',
          role: 'user',
          content: 'Can you tests calling two tools at once? ie two tool calls in parallel?',
        },
        {
          timestamp: 1001,
          message_type: 'text',
          role: 'assistant',
          content: 'Absolutely! Let me test calling both tools simultaneously in parallel:',
        },
        // Parallel tool calls (2 calls)
        {
          timestamp: 1002,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_tbPSBUWCTIu19HVP4QXQUA',
          tool_name: 'query_knowledge_base',
          tool_payload: { input: {} },
        },
        {
          timestamp: 1003,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_FMejGVvrT4G22PbOs2ZiAQ',
          tool_name: 'web_search',
          tool_payload: { input: {} },
        },
        // Corresponding tool results (2 results)
        {
          timestamp: 1004,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_tbPSBUWCTIu19HVP4QXQUA',
          tool_payload: {
            content: [
              {
                json: {
                  summarised_content: 'Knowledge base content...',
                  references: ['s3://numa-arcanum-demo-sydney-data/chat-cost-analysis.xlsx'],
                  provider: 'bedrock',
                  results_count: 6,
                },
              },
            ],
            status: 'success',
          },
        },
        {
          timestamp: 1005,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_FMejGVvrT4G22PbOs2ZiAQ',
          tool_payload: {
            content: [
              {
                json: {
                  max_results: 2,
                  user_intent: 'Testing parallel tool execution with web search',
                  summarised_content: 'Web search results...',
                  references: ['https://www.businessinitiative.org/statistics/future-of-remote-work/'],
                  results_count: 1,
                },
              },
            ],
            status: 'success',
          },
        },
        {
          timestamp: 1006,
          message_type: 'text',
          role: 'assistant',
          content: 'Perfect! ✅ **Parallel tool calling test successful!**',
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      // Should have properly formatted messages without validation errors
      expect(result).toHaveLength(5); // user text + assistant text + assistant tools + user results + final assistant text

      // Find the assistant message with tool calls
      const assistantToolMessage = result.find(
        (msg) => msg.role === 'assistant' && msg.content.some((block) => block.toolUse)
      );
      expect(assistantToolMessage).toBeDefined();
      expect(assistantToolMessage.content).toHaveLength(2); // Two tool calls

      // Find the user message with tool results
      const userResultMessage = result.find(
        (msg) => msg.role === 'user' && msg.content.some((block) => block.toolResult)
      );
      expect(userResultMessage).toBeDefined();
      expect(userResultMessage.content).toHaveLength(2); // Two tool results

      // Verify tool IDs match
      const toolUseIds = assistantToolMessage.content.map((block) => block.toolUse.toolUseId);
      const toolResultIds = userResultMessage.content.map((block) => block.toolResult.toolUseId);
      expect(toolUseIds).toEqual(expect.arrayContaining(toolResultIds));
      expect(toolResultIds).toEqual(expect.arrayContaining(toolUseIds));

      // Should not have any orphaned blocks warnings
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Removing orphaned'));
    });

    it('should handle sequential tool calls mixed with regular messages', async () => {
      const conversationHistory = [
        {
          timestamp: 1000,
          message_type: 'text',
          role: 'user',
          content: 'Test tool calling ie KB and web search',
        },
        {
          timestamp: 1001,
          message_type: 'text',
          role: 'assistant',
          content: "I'll test both the knowledge base search and web search tools for you.",
        },
        // First tool call
        {
          timestamp: 1002,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_first',
          tool_name: 'query_knowledge_base',
          tool_payload: { input: {} },
        },
        // First tool result
        {
          timestamp: 1003,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_first',
          tool_payload: {
            content: [{ json: { summarised_content: 'KB result' } }],
            status: 'success',
          },
        },
        // Second tool call
        {
          timestamp: 1004,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_second',
          tool_name: 'web_search',
          tool_payload: { input: {} },
        },
        // Second tool result
        {
          timestamp: 1005,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_second',
          tool_payload: {
            content: [{ json: { summarised_content: 'Web result' } }],
            status: 'success',
          },
        },
        {
          timestamp: 1006,
          message_type: 'text',
          role: 'assistant',
          content: 'Both tools are working well!',
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      // Should have formatted messages correctly
      expect(result).toHaveLength(7); // user + assistant + assistant tool + user result + assistant tool + user result + final assistant + assistant

      // Should not have validation errors
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Tool block count/ID mismatch'));
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Removing orphaned'));
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty conversation history', async () => {
      const result = await prepareConversationHistoryForChat([], mockGetCredentials);
      expect(result).toEqual([]);
    });

    it('should handle messages with no content', async () => {
      const conversationHistory = [
        {
          timestamp: 1000,
          message_type: 'text',
          role: 'user',
          content: '',
        },
        {
          timestamp: 1001,
          message_type: 'text',
          role: 'assistant',
          content: null,
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);
      expect(result).toHaveLength(0); // Empty content messages should be filtered out
    });

    it('should handle malformed tool_call messages', async () => {
      const conversationHistory = [
        {
          timestamp: 1000,
          message_type: 'tool_call',
          role: 'assistant',
          // Missing tool_use_id and tool_name
          tool_payload: { input: {} },
        },
        {
          timestamp: 1001,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'some_id',
          tool_payload: {
            content: [{ json: { result: 'test' } }],
            status: 'success',
          },
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      // Should handle malformed messages gracefully
      expect(result).toBeDefined();
      // The malformed tool call should create a toolUse block with undefined values
      if (result.length > 0) {
        const assistantMessage = result.find((msg) => msg.role === 'assistant');
        if (assistantMessage) {
          expect(assistantMessage.content[0].toolUse).toBeDefined();
        }
      }
    });

    it('should handle mixed content types in messages', async () => {
      const conversationHistory = [
        {
          timestamp: 1000,
          message_type: 'text',
          role: 'user',
          content: 'Hello',
        },
        {
          timestamp: 1001,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_mixed',
          tool_name: 'query_knowledge_base',
          tool_payload: { input: {} },
        },
        {
          timestamp: 1002,
          message_type: 'text',
          role: 'assistant',
          content: 'Let me search for that information.',
        },
        {
          timestamp: 1003,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_mixed',
          tool_payload: {
            content: [{ json: { result: 'found' } }],
            status: 'success',
          },
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      expect(result).toHaveLength(3); // user + assistant tool + user result
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
      expect(result[2].role).toBe('user');
    });
  });

  describe('Message Truncation with Tool Blocks', () => {
    it('should not break tool call/result pairs during truncation', async () => {
      // Create a conversation that would exceed word limits
      const longContent = 'word '.repeat(2000); // 2000 words
      const conversationHistory = [];

      // Add many messages to exceed MAX_MESSAGES
      for (let i = 0; i < 40; i++) {
        conversationHistory.push({
          timestamp: i * 2,
          message_type: 'text',
          role: 'user',
          content: `Message ${i}: ${longContent}`,
        });
        conversationHistory.push({
          timestamp: i * 2 + 1,
          message_type: 'text',
          role: 'assistant',
          content: `Response ${i}: ${longContent}`,
        });
      }

      // Add a tool call/result pair at the end
      conversationHistory.push({
        timestamp: 1000,
        message_type: 'tool_call',
        role: 'assistant',
        tool_use_id: 'tooluse_truncation_test',
        tool_name: 'query_knowledge_base',
        tool_payload: { input: {} },
      });
      conversationHistory.push({
        timestamp: 1001,
        message_type: 'tool_result',
        role: 'user',
        tool_use_id: 'tooluse_truncation_test',
        tool_payload: {
          content: [{ json: { result: 'test' } }],
          status: 'success',
        },
      });

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      // Should have truncated but maintained valid tool pairs
      expect(result.length).toBeLessThan(conversationHistory.length);
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Tool block count/ID mismatch'));
    });
  });

  describe('File Message Integration', () => {
    it('should handle file messages mixed with tool calls', async () => {
      const conversationHistory = [
        {
          timestamp: 1000,
          message_type: 'file',
          role: 'user',
          fileInfo: {
            s3Bucket: 'test-bucket',
            extractedContentS3Key: 'test-file.txt',
            fileType: 'text/plain',
            fileName: 'test.txt',
          },
        },
        {
          timestamp: 1001,
          message_type: 'tool_call',
          role: 'assistant',
          tool_use_id: 'tooluse_file_analysis',
          tool_name: 'query_knowledge_base',
          tool_payload: { input: {} },
        },
        {
          timestamp: 1002,
          message_type: 'tool_result',
          role: 'user',
          tool_use_id: 'tooluse_file_analysis',
          tool_payload: {
            content: [{ json: { result: 'file analyzed' } }],
            status: 'success',
          },
        },
      ];

      const result = await prepareConversationHistoryForChat(conversationHistory, mockGetCredentials);

      expect(result).toHaveLength(3); // file message + assistant tool + user result
      expect(result[0].role).toBe('assistant'); // File messages are converted to assistant messages
      expect(result[0].content[0].text).toContain('test.txt');
      expect(result[1].role).toBe('assistant');
      expect(result[1].content[0].toolUse).toBeDefined();
      expect(result[2].role).toBe('user');
      expect(result[2].content[0].toolResult).toBeDefined();
    });
  });
});
