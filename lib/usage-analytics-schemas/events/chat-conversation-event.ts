import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for conversation lifecycle events
 */
export const ChatConversationEventDataSchema = z.object({
  /**
   * Conversation ID
   */
  conversationId: z.string().uuid(),

  /**
   * Lifecycle action performed
   */
  action: z.enum(['created', 'deleted', 'archived', 'renamed']),

  /**
   * Conversation name/title
   */
  conversationName: z.string().optional(),

  /**
   * Total message count in conversation (for deletion events)
   */
  messageCount: z.number().int().nonnegative().optional(),

  /**
   * Agent ID if this is an agent conversation
   */
  agentId: z.string().optional(),

  /**
   * Chat version (V1 or V2 workspace chat)
   */
  chatVersion: z.enum(['v1', 'v2']).default('v1'),
});

export const ChatConversationEventSchema = BaseEventSchema.extend({
  eventType: z.literal('chat_conversation'),
  eventData: ChatConversationEventDataSchema,
});

export type ChatConversationEvent = z.infer<typeof ChatConversationEventSchema>;
