import { fetchFileFromS3 } from '../utils/s3Utils';

const MAX_WORDS = 7500; // Maximum number of words to use in prompt
const MAX_MESSAGES = 30; // Maximum number of messages to use in prompt
const MAX_DYNAMO_MESSAGES = 100; // Maximum number of messages to fetch from DynamoDB for UI display (more messages = better chat history visibility)

const wordCount = (str) => {
  if (!str || typeof str !== 'string') {
    return 0; // Return 0 words for tool blocks (tool_call/tool_result) which don't have content field, or other non-string content
  }
  return str.split(/\s+/).length;
};

/**
 * Validates message-level tool block count matching between consecutive assistant/user messages.
 * AWS Bedrock requires that each assistant message with toolUse blocks is followed by a user message
 * with exactly matching toolResult blocks (same count and IDs).
 *
 * @param {Array} messages - Array of formatted message objects
 * @returns {Array} - Messages with invalid tool conversation sequences removed
 */
const validateMessageLevelToolCounts = (messages) => {
  const validatedMessages = [];
  let removedMessagePairs = 0;

  for (let i = 0; i < messages.length; i++) {
    const currentMessage = messages[i];

    // Check if current message is assistant with tool calls
    if (currentMessage.role === 'assistant' && currentMessage.content && Array.isArray(currentMessage.content)) {
      const toolUseBlocks = currentMessage.content.filter((block) => block.toolUse);

      if (toolUseBlocks.length > 0) {
        // Look for the next user message with tool results
        const nextMessage = i + 1 < messages.length ? messages[i + 1] : null;

        if (!nextMessage || nextMessage.role !== 'user') {
          console.warn(
            '[bedrockMessageHistoryUtils] Assistant message with tool calls not followed by user message, removing tool call message',
            { messageIndex: i, toolCount: toolUseBlocks.length }
          );
          removedMessagePairs++;
          continue; // Skip this assistant message
        }

        const toolResultBlocks =
          nextMessage.content && Array.isArray(nextMessage.content)
            ? nextMessage.content.filter((block) => block.toolResult)
            : [];

        // Validate tool block counts and IDs match
        const toolUseIds = new Set(toolUseBlocks.map((block) => block.toolUse.toolUseId));
        const toolResultIds = new Set(toolResultBlocks.map((block) => block.toolResult.toolUseId));

        const countsMatch = toolUseBlocks.length === toolResultBlocks.length;
        const idsMatch = toolUseIds.size === toolResultIds.size && [...toolUseIds].every((id) => toolResultIds.has(id));

        if (!countsMatch || !idsMatch) {
          console.warn(
            '[bedrockMessageHistoryUtils] Tool block count/ID mismatch between consecutive messages, removing message pair',
            {
              messageIndex: i,
              toolUseCount: toolUseBlocks.length,
              toolResultCount: toolResultBlocks.length,
              toolUseIds: Array.from(toolUseIds),
              toolResultIds: Array.from(toolResultIds),
              countsMatch,
              idsMatch,
            }
          );
          removedMessagePairs += 2;
          i++; // Skip the next message too since we're removing the pair
          continue;
        }

        // Both messages are valid, add them
        validatedMessages.push(currentMessage);
        validatedMessages.push(nextMessage);
        i++; // Skip the next message since we already processed it
      } else {
        // No tool calls, add normally
        validatedMessages.push(currentMessage);
      }
    } else {
      // Non-assistant message or already processed, add normally
      validatedMessages.push(currentMessage);
    }
  }

  if (removedMessagePairs > 0) {
    console.warn(
      `[bedrockMessageHistoryUtils] Message-level validation removed ${removedMessagePairs} messages due to tool block mismatches`
    );
  }

  return validatedMessages;
};

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

  // Tool validation - Found ${toolUseIds.size} toolUse blocks and ${toolResultIds.size} toolResult blocks

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
              contentBlock.toolResult.name || 'unknown'
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
              contentBlock.toolUse.name || 'unknown'
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
      `[bedrockMessageHistoryUtils] Tool cleanup summary - Removed ${removedToolUse} orphaned toolUse blocks and ${removedToolResult} orphaned toolResult blocks`
    );
  }

  // Third pass: Validate message-level tool block count matching
  const finalMessages = validateMessageLevelToolCounts(cleanedMessages);

  return finalMessages;
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
  return truncatedMessages;
};

const formatMessagesForChat = async (messages, getCredentials, loadFiles = true) => {
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

      if (loadFiles) {
        // Load file content directly (original behavior)
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
      } else {
        // Pass file reference instead of content - lambda will load it to avoid WebSocket size limits
        formattedMessages.push({
          role: 'assistant',
          content: [
            {
              text: `User has uploaded file:: ${fileName} (${fileType}). Extracting content...`,
            },
            {
              // Pass file reference instead of content - lambda will load it
              fileRef: {
                s3Bucket,
                extractedContentS3Key,
                fileType,
                fileName,
                region,
              },
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

  // In agent mode, don't load files to avoid WebSocket size limits
  const loadFiles = false;

  const formattedMessages = await formatMessagesForChat(truncatedHistory, getCredentials, loadFiles);

  // Note: Conversation truncation from ${sortedHistory.length} to ${truncatedHistory.length} messages if limits exceeded

  // Validate and clean tool call/result pairs to prevent Chat validation errors
  const cleanedMessages = validateAndCleanToolPairs(formattedMessages);

  if (cleanedMessages.length !== formattedMessages.length) {
    console.warn(
      `[bedrockMessageHistoryUtils] Cleaned conversation history from ${formattedMessages.length} to ${cleanedMessages.length} messages due to orphaned tool blocks`
    );
  }

  return cleanedMessages;
};

export { MAX_DYNAMO_MESSAGES, prepareConversationHistoryForChat };
