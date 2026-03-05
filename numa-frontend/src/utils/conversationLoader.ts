import { MAX_DYNAMO_MESSAGES } from './bedrockMessageHistoryUtils';
import { extractSingleDocBlock } from './streamingProcessors';
import { resolveToolDescriptor, getToolActionSteps } from './ToolConfig';

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
          sub
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

    // Identify agent metadata from meta entry (if present)
    const metaItem = conversationHistory.find((item) => item.message_type === 'meta');
    const chatConfig = metaItem?.chatConfig ?? null;

    const agentMeta = metaItem?.isAgentConversation
      ? {
          agentId: metaItem.agentId,
          agentTitle: metaItem.agentTitle,
          agentVersion: metaItem.agentVersion,
          agentIcon: metaItem.agentIcon,
          agentType: metaItem.agentType,
          agentVisibility: metaItem.agentVisibility,
        }
      : null;

    // Convert grouped items to chat messages
    const chatMessages = messageGroups
      .map((group) => {
        if (group.role === 'user' || group.items.length === 1) {
          // Single message (user messages or single assistant messages)
          const item = group.items[0];

          if (item.message_type === 'document_metadata') {
            // Handle document-only assistant turns by reconstructing a text segment from metadata
            try {
              const docData = JSON.parse(item.content || '{}');
              const docContent = docData.docContent || '';
              const docTitle = docData.docTitle || null;
              return {
                role: 'assistant',
                content: docContent,
                segments: docContent
                  ? [
                      {
                        kind: 'text',
                        text: docContent,
                        finalized: true,
                      },
                    ]
                  : undefined,
                docTitle,
                docContent: docContent || null,
                references: item.references || [],
              };
            } catch (err) {
              console.error('Error parsing document metadata:', err);
              // Fall through to generic assistant message with raw content if parsing fails
            }
          }

          // Handle single assistant tool messages as unified cards
          if (
            group.role === 'assistant' &&
            (item.message_type === 'tool_call' || item.message_type === 'tool_result')
          ) {
            const segments: Array<{ kind: string; [key: string]: unknown }> = [];
            let toolName = item.tool_name || item.tool_payload?.name || 'unknown';
            const descriptor = resolveToolDescriptor(toolName);
            const label = descriptor.label || toolName;
            if (item.message_type === 'tool_call') {
              const inputPayload = item.tool_payload?.input ?? item.tool_payload ?? {};
              const steps = getToolActionSteps(toolName, inputPayload);
              segments.push({
                kind: 'tool_card',
                toolName,
                label,
                toolUseId: item.tool_use_id || null,
                isLoading: false,
                steps: steps || [],
              });
            } else {
              const payload = item.tool_payload || {};
              payload.name = toolName;
              segments.push({
                kind: 'tool_card',
                toolName,
                label,
                toolUseId: item.tool_use_id || null,
                isLoading: false,
                steps: [],
                result: payload,
              });
            }
            return { role: 'assistant', content: '', segments };
          }

          const baseMsg: {
            role: string;
            content: string;
            references: unknown[];
            docTitle?: string | null;
            docContent?: string | null;
          } = {
            role: item.role,
            content: item.content || '',
            references: item.references || [],
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
            if (item.messageContext === 'agent_reference') {
              return null;
            }
            // Use file_upload segment for styled file message display with S3 metadata for download
            const region = window.sessionStorage.getItem('REGION');
            baseMsg.segments = [
              {
                kind: 'file_upload',
                filename: item.fileInfo.fileName,
                type: 'success',
                s3Key: item.fileInfo.s3Key,
                s3Bucket: item.fileInfo.s3Bucket,
                region: region || undefined,
              },
            ];
            baseMsg.role = 'assistant';
          } else if (item.message_type === 'image_description') {
            // Use file_upload segment for styled file message display with S3 metadata for download
            const region = window.sessionStorage.getItem('REGION');
            baseMsg.segments = [
              {
                kind: 'file_upload',
                filename: item.fileInfo.fileName,
                type: 'success',
                s3Key: item.fileInfo.s3Key,
                s3Bucket: item.fileInfo.s3Bucket,
                region: region || undefined,
              },
            ];
            baseMsg.role = 'assistant';
          } else if (item.message_type === 'knowledge') {
            baseMsg.content = `Retrieving data source knowledge...`;
            baseMsg.role = 'assistant';
          } else if (item.message_type === 'meta') {
            // Meta items are for tracking only, don't display them in chat
            return null;
          }
          return baseMsg;
        } else {
          // Multiple assistant messages - reconstruct segments
          const segments: Array<{ kind: string; [key: string]: unknown }> = [];
          const toolCardIndexById = new Map<string, number>();
          let content = '';
          const references = [];
          let docTitle = null;
          let docContent = null;

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
            } else if (item.message_type === 'tool_call') {
              // Reconstruct unified tool card for tool call
              let toolName = item.tool_name;
              if (!toolName && item.tool_payload?.name) toolName = item.tool_payload.name;
              const name = toolName || 'unknown';
              const descriptor = resolveToolDescriptor(name);
              const label = descriptor.label || name;
              const inputPayload = item.tool_payload?.input ?? item.tool_payload ?? {};
              const steps = getToolActionSteps(name, inputPayload);

              const card = {
                kind: 'tool_card',
                toolName: name,
                label,
                toolUseId: item.tool_use_id || null,
                isLoading: false,
                steps: steps || [],
              };
              const idx = segments.push(card) - 1;
              if (item.tool_use_id) toolCardIndexById.set(item.tool_use_id, idx);
            } else if (item.message_type === 'tool_result') {
              // Attach result to existing card (by tool_use_id) or create a new one
              let toolName = item.tool_name;
              if (!toolName && item.tool_payload?.name) toolName = item.tool_payload.name;
              const name = toolName || item.tool_payload?.name || 'unknown';
              const payload = item.tool_payload || {};
              payload.name = name;

              let attached = false;
              if (item.tool_use_id && toolCardIndexById.has(item.tool_use_id)) {
                const idx = toolCardIndexById.get(item.tool_use_id)!;
                type ToolCardSegLocal = {
                  kind: 'tool_card';
                  toolName: string;
                  label: string;
                  toolUseId: string | null;
                  isLoading: boolean;
                  steps: string[];
                  result?: unknown;
                };
                const seg = segments[idx] as ToolCardSegLocal;
                const updated: ToolCardSegLocal = { ...seg, result: payload, isLoading: false };
                segments[idx] = updated;
                attached = true;
              }

              if (!attached) {
                const descriptor = resolveToolDescriptor(name);
                const label = descriptor.label || name;
                segments.push({
                  kind: 'tool_card',
                  toolName: name,
                  label,
                  toolUseId: item.tool_use_id || null,
                  isLoading: false,
                  steps: [],
                  result: payload,
                });
              }
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

          if ((!content || !content.trim()) && docContent) {
            // Reconstruct text content entirely from document metadata if no text segments exist
            segments.push({ kind: 'text', text: docContent, finalized: true });
            content = docContent;
          }

          return {
            role: 'assistant',
            content,
            segments: segments.length > 0 ? segments : undefined,
            references,
            docTitle,
            docContent,
          };
        }
      })
      .filter(Boolean); // Remove null values from document_metadata items

    return {
      messages: chatMessages,
      agentMeta,
      chatConfig,
    };
  } catch (error) {
    console.error('Error loading conversation:', error);
    throw error; // Re-throw to let caller handle UI updates
  }
}
