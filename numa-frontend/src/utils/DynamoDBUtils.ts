import { QueryCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
const client = window.sessionStorage.getItem('CLIENT_NAME'); // e.g. "arcanum-demo"
const environment = window.sessionStorage.getItem('ENVIRONMENT_NAME') || 'prod'; // default to "prod" if not set

const NUMA_CHAT_HISTORY_TABLE_NAME = `numa-${client}${environment !== 'prod' ? `-${environment}` : ''}-chat-history`;

class NumaChatDynamoUtils {
  constructor(dynamoDBClient) {
    this.dynamoDBClient = dynamoDBClient;
    this.tableName = NUMA_CHAT_HISTORY_TABLE_NAME;
  }

  /**
   * Store message item in DynamoDB.
   *
   * @param {Object} opts
   * @param {string} opts.conversationId - unique conversation ID
   * @param {string} opts.userId - unique user ID (Cognito sub)
   * @param {string} opts.messageType - e.g. "text", "file", "knowledge", "meta"
   * @param {string} opts.role - e.g. "user", "assistant", "system"
   * @param {string} opts.content - message content
   * @param {string} [opts.conversationName] - optional conversation name
   * @param {object} [opts.fileInfo] - optional file metadata if needed
   * @param {Array} [opts.references] - optional references
   */
  async addMessage({ conversationId, userId, messageType, role, content, conversationName, fileInfo, references }) {
    try {
      const timestamp = Date.now();
      const sk = `${conversationId}#${timestamp}`;

      const item = {
        // DynamoDB PK and SK:
        user_id: userId,
        sk,

        // Additional attributes (for convenience):
        conversation_id: conversationId,
        timestamp,
        message_type: messageType,
        role,
        content,
        conversationName,
        references,
        fileInfo,
      };

      const command = new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      });

      await this.dynamoDBClient.send(command);
      console.log(`Message added to conversation ${conversationId}`);
    } catch (error) {
      console.error(`Error adding message to conversation ${conversationId}:`, error);
    }
  }

  /**
   * Return all items in a single conversation, sorted by ascending timestamp.
   * We do this by KeyCondition on user_id + begins_with(sk, conversationId#).
   *
   * @param {string} conversationId
   * @param {number} limit
   */
  async queryConversations(conversationId, limit = 1000, userId) {
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'user_id = :u AND begins_with(sk, :c)',
        ExpressionAttributeValues: marshall({
          ':u': userId,
          ':c': `${conversationId}#`,
        }),
        ScanIndexForward: false, // sort descending by SK (newest first)
        Limit: limit,
      });

      const response = await this.dynamoDBClient.send(command);

      // Unmarshal and parse out the real timestamp
      const items = response.Items.map((item) => {
        const out = unmarshall(item);
        return out;
      });

      return items;
    } catch (error) {
      console.error(`Error querying conversation ${conversationId} for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Add a "file" message with file metadata.
   */
  async addFileMessage({ conversationId, userId, fileName, fileType, s3Key, s3Bucket, extractedContentS3Key }) {
    try {
      const timestamp = Date.now();
      const sk = `${conversationId}#${timestamp}`;

      const item = {
        user_id: userId,
        sk,
        conversation_id: conversationId,
        timestamp,
        message_type: 'file',
        role: 'user',
        content: `Successfully uploaded file: ${fileName}`,
        fileInfo: {
          fileName,
          fileType,
          s3Key,
          s3Bucket,
          extractedContentS3Key,
        },
      };

      const command = new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      });

      await this.dynamoDBClient.send(command);
      console.log(`File message added to conversation ${conversationId}`);
    } catch (error) {
      console.error(`Error adding file message to conversation ${conversationId}:`, error);
    }
  }

  /**
   * Update conversation name by finding the earliest "meta" item for that conversation.
   */
  async updateConversationName(conversationId, userId, newName) {
    try {
      // 1. Query all items for this user with begins_with(sk, conversationId#)
      const queryCommand = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'user_id = :u AND begins_with(sk, :c)',
        ExpressionAttributeValues: marshall({
          ':u': userId,
          ':c': `${conversationId}#`,
        }),
        ScanIndexForward: true,
      });
      const queryResponse = await this.dynamoDBClient.send(queryCommand);
      const items = queryResponse.Items.map(unmarshall);

      // 2. Find the first meta item
      const metaItem = items.find((item) => item.message_type === 'meta');
      if (!metaItem) {
        throw new Error('No meta item found to update conversationName.');
      }

      // 3. Update the conversationName field
      const updateCommand = new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({
          user_id: userId,
          sk: metaItem.sk, // i.e. conversationId#timestampOfMeta
        }),
        UpdateExpression: 'SET conversationName = :newName',
        ExpressionAttributeValues: marshall({
          ':newName': newName,
        }),
        ReturnValues: 'UPDATED_NEW',
      });

      await this.dynamoDBClient.send(updateCommand);
      console.log(`Conversation name updated to "${newName}" for ${conversationId}`);
    } catch (error) {
      console.error('Error updating conversation name:', error);
      throw error;
    }
  }

  /**
   * Update the "meta" item with the provided attributes.
   */
  async updateMetaItem(conversationId, userId, updates) {
    try {
      // 1. Query items for user + conversation
      const queryResp = await this.dynamoDBClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'user_id = :u AND begins_with(sk, :c)',
          FilterExpression: 'message_type = :mtype',
          ExpressionAttributeValues: marshall({
            ':u': userId,
            ':c': `${conversationId}#`,
            ':mtype': 'meta',
          }),
        }),
      );

      const items = queryResp.Items.map(unmarshall);
      if (items.length === 0) {
        throw new Error(`No meta item found for conversation ${conversationId} and user ${userId}`);
      }

      const metaItem = items[0];

      // 2. Build update expression
      let updateExp = 'SET';
      const expAttrValues = {};
      let first = true;

      for (const [key, value] of Object.entries(updates)) {
        updateExp += first ? ` ${key} = :${key}` : `, ${key} = :${key}`;
        expAttrValues[`:${key}`] = value;
        first = false;
      }

      // 3. Execute Update
      const updateCommand = new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({
          user_id: userId,
          sk: metaItem.sk,
        }),
        UpdateExpression: updateExp,
        ExpressionAttributeValues: marshall(expAttrValues),
        ReturnValues: 'UPDATED_NEW',
      });

      await this.dynamoDBClient.send(updateCommand);
      console.log(`Meta item updated for conversation ${conversationId} with`, updates);
    } catch (error) {
      console.error('Error updating meta item:', error);
      throw error;
    }
  }

  /**
   * Return "meta" items for this user's conversations.
   * Returns the 25 most recently updated conversations (newest first by latestTimestamp).
   */
  async getUserConversationsMeta(userId, limit = 100) {
    try {
      const allMetaItems = [];
      let lastEvaluatedKey = null;

      // Keep querying until we get all meta items (handle pagination)
      do {
        const command = new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'user_id = :u',
          FilterExpression: 'message_type = :mtype',
          ExpressionAttributeValues: marshall({
            ':u': userId,
            ':mtype': 'meta',
          }),
          ProjectionExpression: 'sk, conversation_id, user_id, conversationName, latestTimestamp, content',
          ScanIndexForward: false, // Sort descending by sort key (newest first)
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const response = await this.dynamoDBClient.send(command);
        const items = response.Items.map(unmarshall);

        // Add meta items to our collection
        allMetaItems.push(...items);

        // Check if there are more items to fetch
        lastEvaluatedKey = response.LastEvaluatedKey;

        // Stop if we have enough meta items for our needs (100 + some buffer)
        if (allMetaItems.length >= limit) {
          break;
        }
      } while (lastEvaluatedKey);

      // Convert to our return format
      const conversations = allMetaItems.map((it) => ({
        conversation_id: it.conversation_id,
        conversationName: it.conversationName || null,
        // Use latestTimestamp for sorting (most recent activity first), fallback to timestamp
        latestTimestamp: it.latestTimestamp || it.timestamp || 0,
        timestamp: it.timestamp || 0,
        content: it.content || '',
      }));

      // Sort by latestTimestamp (most recent activity first) to provide better UX
      conversations.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

      // Apply limit of 100 after sorting
      const limitedConversations = conversations.slice(0, limit);

      console.log(
        `Retrieved ${limitedConversations.length} conversations for user ${userId} (limited to 25 from ${conversations.length} total)`,
      );
      return limitedConversations;
    } catch (err) {
      console.error('Error fetching user conversation meta:', err);
      return [];
    }
  }

  /**
   * Delete all items associated with a conversation for this user.
   */
  async deleteConversation(conversationId, userId) {
    try {
      // 1. Query all items in that conversation for the user
      const queryCommand = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'user_id = :u AND begins_with(sk, :c)',
        ExpressionAttributeValues: marshall({
          ':u': userId,
          ':c': `${conversationId}#`,
        }),
      });

      const response = await this.dynamoDBClient.send(queryCommand);
      const items = response.Items.map(unmarshall);

      // 2. Delete each item
      for (const item of items) {
        const deleteCommand = new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({
            user_id: item.user_id,
            sk: item.sk,
          }),
        });
        await this.dynamoDBClient.send(deleteCommand);
      }
      console.log(`Conversation ${conversationId} deleted.`);
    } catch (error) {
      console.error(`Error deleting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Add a tool message (tool_call or tool_result) with tool metadata.
   *
   * @param {Object} opts
   * @param {string} opts.conversationId - unique conversation ID
   * @param {string} opts.userId - unique user ID (Cognito sub)
   * @param {string} opts.messageType - "tool_call" or "tool_result"
   * @param {string} opts.toolName - name of the tool (e.g., "query_knowledge_base")
   * @param {string} opts.toolUseId - unique tool use ID for pairing calls with results
   * @param {object} opts.toolPayload - the complete tool call or result payload
   * @param {string} [opts.content] - optional summary text for display
   */
  async addToolMessage({
    conversationId,
    userId,
    messageType, // 'tool_call' or 'tool_result'
    toolName,
    toolUseId,
    toolPayload,
    content = null,
  }) {
    try {
      const timestamp = Date.now();
      const sk = `${conversationId}#${timestamp}`;

      const item = {
        // DynamoDB PK and SK:
        user_id: userId,
        sk,

        // Additional attributes:
        conversation_id: conversationId,
        timestamp,
        message_type: messageType,
        role: 'assistant', // Tools are always associated with assistant responses
        content: content || `${messageType}: ${toolName}`,
        tool_name: toolName,
        tool_use_id: toolUseId,
        tool_payload: toolPayload,
      };

      const command = new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      });

      await this.dynamoDBClient.send(command);
      console.log(`Tool message (${messageType}) added to conversation ${conversationId}`);
    } catch (error) {
      console.error(`Error adding tool message to conversation ${conversationId}:`, error);
    }
  }
}

export { NumaChatDynamoUtils };
