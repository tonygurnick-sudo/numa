import { fetchFileFromS3 } from '../utils/s3Utils';

const MAX_WORDS = 7500; // Maximum number of words to use in prompt
const MAX_MESSAGES = 30; // Maximum number of messages to use in prompt
const MAX_DYNAMO_MESSAGES = 100; // Maximum number of messages to fetch from DynamoDB for UI display (more messages = better chat history visibility)

const wordCount = (str) => str.split(/\s+/).length;

/**
 * Validates and cleans tool call/result pairs to prevent Chat validation errors.
 * Removes orphaned toolResult blocks without matching toolUse blocks.
 * Removes orphaned toolUse blocks without matching toolResult blocks.
 *
 * @param {Array} messages - Array of formatted message objects
 * @returns {Array} - Cleaned array of message objects with orphaned tool blocks removed
 */
const validateAndCleanToolPairs = (messages) => {
  // Collect all toolUseIds from toolUse and toolResult blocks
  const toolUseIds = new Set();
  const toolResultIds = new Set();

  // First pass: collect all tool IDs
  messages.forEach((message) => {
    if (message.content && Array.isArray(message.content)) {
      message.content.forEach((contentBlock) => {
        if (contentBlock.toolUse && contentBlock.toolUse.toolUseId) {
          toolUseIds.add(contentBlock.toolUse.toolUseId);
        }
        if (contentBlock.toolResult && contentBlock.toolResult.toolUseId) {
          toolResultIds.add(contentBlock.toolResult.toolUseId);
        }
      });
    }
  });

  console.log(
    `[bedrockMessageHistoryUtils] Tool validation - Found ${toolUseIds.size} toolUse blocks and ${toolResultIds.size} toolResult blocks`,
  );

  let removedToolUse = 0;
  let removedToolResult = 0;

  // Second pass: remove orphaned blocks and log warnings
  const cleanedMessages = messages
    .map((message) => {
      if (!message.content || !Array.isArray(message.content)) {
        return message;
      }

      const cleanedContent = message.content.filter((contentBlock) => {
        // Remove orphaned toolResult blocks (results without matching tool calls)
        if (contentBlock.toolResult) {
          if (!toolUseIds.has(contentBlock.toolResult.toolUseId)) {
            console.warn(
              '[bedrockMessageHistoryUtils] Removing orphaned toolResult block (no matching toolUse):',
              contentBlock.toolResult.toolUseId,
              'Tool name:',
              contentBlock.toolResult.name || 'unknown',
            );
            removedToolResult++;
            return false;
          }
        }

        // Remove orphaned toolUse blocks (tool calls without matching results)
        if (contentBlock.toolUse) {
          if (!toolResultIds.has(contentBlock.toolUse.toolUseId)) {
            console.warn(
              '[bedrockMessageHistoryUtils] Removing orphaned toolUse block (no matching toolResult):',
              contentBlock.toolUse.toolUseId,
              'Tool name:',
              contentBlock.toolUse.name || 'unknown',
            );
            removedToolUse++;
            return false;
          }
        }

        return true;
      });

      return {
        ...message,
        content: cleanedContent,
      };
    })
    .filter((message) => {
      // Remove messages that have empty content arrays after cleaning
      if (message.content && Array.isArray(message.content) && message.content.length === 0) {
        console.warn('[bedrockMessageHistoryUtils] Removing message with empty content after tool cleanup');
        return false;
      }
      return true;
    });

  // Log summary of cleanup
  if (removedToolUse > 0 || removedToolResult > 0) {
    console.warn(
      `[bedrockMessageHistoryUtils] Tool cleanup summary - Removed ${removedToolUse} orphaned toolUse blocks and ${removedToolResult} orphaned toolResult blocks`,
    );
  }

  return cleanedMessages;
};

/**
 * Truncates the conversation history based on word count or message count
 * @param {Array} messages - Array of message objects
 * @returns {Array} - Truncated array of message objects
 */
const truncateConversationHistory = (messages) => {
  let totalWords = 0;
  let truncatedMessages = [];
  // Note: This is a naive implementation that truncates from the end of the array
  // TODO: Implement a more sophisticated algorithm to select conversation history

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const messageWords = wordCount(message.content);

    if (totalWords + messageWords > MAX_WORDS || truncatedMessages.length >= MAX_MESSAGES) {
      break;
    }
    totalWords += messageWords;
    truncatedMessages.unshift(message);
  }
  console.log(`Total words returned in conversation: ${totalWords}`);
  return truncatedMessages;
};

const formatMessagesForChat = async (messages, getCredentials) => {
  const sortedHistory = messages.sort((a, b) => a.timestamp - b.timestamp);
  const formattedMessages = [];

  for (let i = 0; i < sortedHistory.length; i++) {
    const item = sortedHistory[i];

    if (item.message_type === 'image_description') {
      const { fileName } = item.fileInfo || {};
      formattedMessages.push({
        role: 'assistant',
        content: [
          {
            text: `User has uploaded file: ${fileName}. Extracting image content...`,
          },
          {
            text: 'Image content:' + item.content || 'No content found',
          },
        ],
      });
    } else if (item.message_type === 'file') {
      const { s3Bucket, extractedContentS3Key, fileType, fileName } = item.fileInfo || {};
      const region = window.sessionStorage.getItem('REGION');

      try {
        const fileContent = await fetchFileFromS3(extractedContentS3Key, s3Bucket, region, getCredentials);
        let textBody = await fileContent.text();
        if (!textBody.trim()) {
          textBody = 'No content found in file';
        }

        formattedMessages.push({
          role: 'assistant',
          content: [
            {
              text: `User has uploaded file:: ${fileName} (${fileType}). Extracting content...`,
            },
            {
              text: textBody.trim() || 'No content found in file',
            },
          ],
        });
      } catch (error) {
        console.error('Error formatting file message:', error);
        formattedMessages.push({
          role: item.role,
          content: [
            {
              text: `Error processing file ${fileName}: ${error.message}`,
            },
          ],
        });
      }
    } else if (item.message_type === 'text') {
      // Text messages - assistant or user role as stored
      if (item.content && item.content.trim()) {
        formattedMessages.push({
          role: item.role,
          content: [{ text: item.content }],
        });
      }
    } else if (item.message_type === 'tool_call') {
      // Group consecutive tool calls into a single assistant message
      const toolUseBlocks = [];
      let j = i;

      // Collect all consecutive tool_call messages
      while (j < sortedHistory.length && sortedHistory[j].message_type === 'tool_call') {
        const toolItem = sortedHistory[j];
        const toolPayload = toolItem.tool_payload || {};
        toolUseBlocks.push({
          toolUse: {
            toolUseId: toolItem.tool_use_id,
            name: toolItem.tool_name,
            input: toolPayload.input || {},
          },
        });
        j++;
      }

      // Add single assistant message with all tool use blocks
      formattedMessages.push({
        role: 'assistant',
        content: toolUseBlocks,
      });

      // Move index to the last processed tool call
      i = j - 1;
    } else if (item.message_type === 'tool_result') {
      // Group consecutive tool results into a single user message
      const toolResultBlocks = [];
      let j = i;

      // Collect all consecutive tool_result messages
      while (j < sortedHistory.length && sortedHistory[j].message_type === 'tool_result') {
        const resultItem = sortedHistory[j];
        const toolPayload = resultItem.tool_payload || {};
        toolResultBlocks.push({
          toolResult: {
            toolUseId: resultItem.tool_use_id,
            content: toolPayload.content || [],
            status: toolPayload.status || 'success',
          },
        });
        j++;
      }

      // Add single user message with all tool result blocks
      formattedMessages.push({
        role: 'user',
        content: toolResultBlocks,
      });

      // Move index to the last processed tool result
      i = j - 1;
    } else if (item.message_type === 'knowledge' && item.content?.trim()) {
      // Knowledge base results - include as assistant message
      formattedMessages.push({
        role: item.role,
        content: [{ text: item.content }],
      });
    } else if (item.message_type === 'meta' && item.content?.trim()) {
      // Meta messages (like "New conversation started")
      formattedMessages.push({
        role: item.role,
        content: [{ text: item.content }],
      });
    }
    // Skip any other message types we don't recognize
  }

  return formattedMessages;
};

/**
 * Prepares conversation history for Chat Agent
 * @param {Array} conversationHistory - Full conversation history from DynamoDB
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<Array>} - Formatted and truncated messages for Chat Agent
 */
const prepareConversationHistoryForChat = async (conversationHistory, getCredentials) => {
  const sortedHistory = conversationHistory.sort((a, b) => a.timestamp - b.timestamp);
  const truncatedHistory = truncateConversationHistory(sortedHistory);

  const formattedMessages = await formatMessagesForChat(truncatedHistory, getCredentials);

  if (truncatedHistory.length < sortedHistory.length) {
    console.log(`Total words exceeded ${MAX_WORDS} or total messages exceeded ${MAX_MESSAGES}`);
    console.log(`Conversation truncated from ${sortedHistory.length} to ${truncatedHistory.length} messages`);
  }

  // Validate and clean tool call/result pairs to prevent Chat validation errors
  const cleanedMessages = validateAndCleanToolPairs(formattedMessages);

  if (cleanedMessages.length !== formattedMessages.length) {
    console.warn(
      `[bedrockMessageHistoryUtils] Cleaned conversation history from ${formattedMessages.length} to ${cleanedMessages.length} messages due to orphaned tool blocks`,
    );
  }

  return cleanedMessages;
};

export { MAX_DYNAMO_MESSAGES, prepareConversationHistoryForChat };
