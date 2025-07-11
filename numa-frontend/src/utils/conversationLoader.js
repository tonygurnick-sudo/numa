import { MAX_DYNAMO_MESSAGES } from './bedrockMessageHistoryUtils';
import { extractSingleDocBlock } from './streamingProcessors';
import { TOOL_CONFIG } from './ToolConfig';

/**
 * Loads and reconstructs a conversation from DynamoDB
 * Extracted from NumaChat.jsx to improve maintainability
 *
 * @param {string} selectedConversationId - The conversation ID to load
 * @param {Object} numaChatDynamoUtils - DynamoDB utilities instance
 * @param {string} sub - User's Cognito sub ID
 * @param {Function} getAccessToken - Function to refresh access token
 * @returns {Promise<Array>} Array of chat messages
 */
export async function loadConversation(selectedConversationId, numaChatDynamoUtils, sub, getAccessToken) {
  if (!numaChatDynamoUtils) {
    throw new Error('numaChatDynamoUtils is required');
  }

  try {
    let retryCount = 0;
    let conversationHistory = [];

    // Retry logic for token expiration
    while (retryCount < 2) {
      try {
        conversationHistory = await numaChatDynamoUtils.queryConversations(
          selectedConversationId,
          MAX_DYNAMO_MESSAGES,
          sub,
        );
        break;
      } catch (error) {
        if (error.message.includes('ExpiredTokenException') && retryCount === 0) {
          await getAccessToken(true);
          retryCount++;
        } else {
          throw error;
        }
      }
    }

    // Sort by timestamp
    conversationHistory.sort((a, b) => a.timestamp - b.timestamp);

    // Group conversation items - user messages are separators, all assistant content gets grouped
    const messageGroups = [];
    let currentGroup = null;

    conversationHistory.forEach((item) => {
      // User messages and meta messages always start new groups
      if (item.role === 'user' || item.message_type === 'meta') {
        if (currentGroup) {
          messageGroups.push(currentGroup);
        }
        currentGroup = {
          role: item.role,
          items: [item],
          timestamp: item.timestamp,
        };
      }
      // All assistant messages (text, tool calls, tool results) get grouped together
      else if (item.role === 'assistant') {
        if (!currentGroup || currentGroup.role !== 'assistant') {
          // Start new assistant group
          if (currentGroup) {
            messageGroups.push(currentGroup);
          }
          currentGroup = {
            role: 'assistant',
            items: [item],
            timestamp: item.timestamp,
          };
        } else {
          // Add to existing assistant group
          currentGroup.items.push(item);
          currentGroup.timestamp = Math.max(currentGroup.timestamp, item.timestamp);
        }
      }
    });

    if (currentGroup) {
      messageGroups.push(currentGroup);
    }

    // Convert grouped items to chat messages
    const chatMessages = messageGroups
      .map((group) => {
        if (group.role === 'user' || group.items.length === 1) {
          // Single message (user messages or single assistant messages)
          const item = group.items[0];
          const baseMsg = {
            role: item.role,
            content: item.content || '',
            references: item.references || [],
            interrupted: item.interrupted || false,
          };

          // Extract document info BEFORE stripping tags
          const docBlock = extractSingleDocBlock(item.content || '');
          if (docBlock && baseMsg.role === 'assistant') {
            baseMsg.docTitle = docBlock.docTitle;
            baseMsg.docContent = docBlock.docContent;
          }

          // Replace doc tags when loading conversation history (for display)
          if (baseMsg.content) {
            baseMsg.content = baseMsg.content.replace(/<!--[\s\S]*?-->/g, '---');
          }

          if (item.message_type === 'file') {
            baseMsg.content = `File '${item.fileInfo.fileName}' uploaded and processed successfully.`;
            baseMsg.role = 'assistant';
          } else if (item.message_type === 'image_description') {
            baseMsg.content = `File '${item.fileInfo.fileName}' uploaded and processed successfully.`;
            baseMsg.role = 'assistant';
          } else if (item.message_type === 'knowledge') {
            baseMsg.content = `Retrieving data source knowledge...`;
            baseMsg.role = 'assistant';
          } else if (item.message_type === 'meta') {
            // system-level info
            baseMsg.role = 'system';
          } else if (item.message_type === 'document_metadata') {
            // Skip document metadata items - they'll be applied to the main text message
            return null;
          }
          return baseMsg;
        } else {
          // Multiple assistant messages - reconstruct segments
          const segments = [];
          let content = '';
          const references = [];
          let docTitle = null;
          let docContent = null;
          let interrupted = false;

          // Process items in the order they appear from DynamoDB (already chronologically sorted by sort key)
          group.items.forEach((item) => {
            if (item.message_type === 'text') {
              // Regular text content
              const textContent = item.content || '';

              // Check for doc blocks BEFORE stripping tags
              const docBlock = extractSingleDocBlock(textContent);
              if (docBlock) {
                docTitle = docBlock.docTitle;
                docContent = docBlock.docContent;
              }

              // Then clean the text for display
              const cleanText = textContent.replace(/<!--[\s\S]*?-->/g, '---');
              content += cleanText;

              if (cleanText.trim()) {
                segments.push({ kind: 'text', text: cleanText, finalized: true });
              }

              if (item.references) {
                references.push(...item.references);
              }

              if (item.interrupted) {
                interrupted = true;
              }
            } else if (item.message_type === 'tool_call') {
              // Reconstruct tool call segment
              const toolLabel = TOOL_CONFIG[item.toolName]?.label || item.toolName;
              segments.push({
                kind: 'tool',
                label: `Calling ${toolLabel} tool`,
                toolUseId: item.toolUseId,
                isLoading: false, // Never loading when reconstructing from history
              });
            } else if (item.message_type === 'tool_result') {
              // Reconstruct tool result segment with full payload
              segments.push({
                kind: 'result',
                toolName: item.toolName,
                payload: {
                  ...item.toolPayload,
                  name: item.toolName, // Ensure name is set for renderer selection
                },
              });
            } else if (item.message_type === 'document_metadata') {
              // Extract document metadata and apply to the message
              try {
                const docData = JSON.parse(item.content || '{}');
                docTitle = docData.docTitle;
                docContent = docData.docContent;
              } catch (err) {
                console.error('Error parsing document metadata:', err);
              }
            }
          });

          return {
            role: 'assistant',
            content,
            segments: segments.length > 0 ? segments : undefined,
            references,
            interrupted,
            docTitle,
            docContent,
          };
        }
      })
      .filter(Boolean); // Remove null values from document_metadata items

    return chatMessages;
  } catch (error) {
    console.error('Error loading conversation:', error);
    throw error; // Re-throw to let caller handle UI updates
  }
}
