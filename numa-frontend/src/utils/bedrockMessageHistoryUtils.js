import { fetchFileFromS3 } from '../utils/s3Utils';

const MAX_WORDS = 7500; // Maximum number of words to use in prompt
const MAX_MESSAGES = 30; // Maximum number of messages to use in prompt
const MAX_DYNAMO_MESSAGES = 30; // Maximum number of messages to fetch from DynamoDB to use in this module. Doesn't need to be above 30 for now as we aren't doing any advanced processing on the messages.

const wordCount = (str) => str.split(/\s+/).length;

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

const formatMessagesForBedrock = async (messages, getCredentials) => {
  return Promise.all(
    messages.map(async (item) => {
      if (item.message_type === 'image_description') {
        // For images, we do NOT fetch S3 content.
        // The "description" is in item.content
        const { fileName } = item.fileInfo || {};
        return {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `User has uploaded file: ${fileName}. Extracting image content...`,
            },
            {
              type: 'text',
              text: 'Image content:' + item.content || 'No content found',
            },
          ],
        };
      } else if (item.message_type === 'file') {
        // For non-image files, fetch extracted content from S3
        const { s3Bucket, extractedContentS3Key, fileType, fileName } = item.fileInfo || {};
        const region = window.sessionStorage.getItem('REGION');

        try {
          const fileContent = await fetchFileFromS3(extractedContentS3Key, s3Bucket, region, getCredentials);

          // Convert that to text
          let textBody = await fileContent.text();
          // Check if there is content besides whitespaces or new lines
          // Let textbody be an error message if there is no content
          if (!textBody.trim()) {
            textBody = 'No content found in file';
          }

          return {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `User has uploaded file:: ${fileName} (${fileType}). Extracting content...`,
              },
              {
                type: 'text',
                text: textBody.trim() || 'No content found in file',
              },
            ],
          };
        } catch (error) {
          console.error('Error formatting file message:', error);
          return {
            role: item.role,
            content: [
              {
                type: 'text',
                text: `Error processing file ${fileName}: ${error.message}`,
              },
            ],
          };
        }
      } else {
        // Normal text or meta or knowledge messages
        return {
          role: item.role,
          content: [{ type: 'text', text: item.content || '' }],
        };
      }
    }),
  );
};

/**
 * Prepares conversation history for Bedrock
 * @param {Array} conversationHistory - Full conversation history from DynamoDB
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<Array>} - Formatted and truncated messages for Bedrock
 */
const prepareConversationHistoryForBedrock = async (conversationHistory, getCredentials) => {
  const sortedHistory = conversationHistory.sort((a, b) => a.timestamp - b.timestamp);
  const truncatedHistory = truncateConversationHistory(sortedHistory);

  const formattedMessages = await formatMessagesForBedrock(truncatedHistory, getCredentials);

  if (truncatedHistory.length < sortedHistory.length) {
    console.log(`Total words exceeded ${MAX_WORDS} or total messages exceeded ${MAX_MESSAGES}`);
    console.log(`Conversation truncated from ${sortedHistory.length} to ${truncatedHistory.length} messages`);
  }

  return formattedMessages;
};

export { MAX_DYNAMO_MESSAGES, prepareConversationHistoryForBedrock };
