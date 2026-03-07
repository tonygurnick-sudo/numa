import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for individual chat messages (V1 and V2)
 */
export const ChatMessageEventDataSchema = z.object({
  /**
   * Conversation ID this message belongs to
   */
  conversationId: z.string().uuid(),

  /**
   * Message ID (unique per message)
   */
  messageId: z.string().uuid(),

  /**
   * Role of the message sender
   */
  role: z.enum(['user', 'assistant']),

  /**
   * Model used for assistant messages
   */
  modelId: z.string().optional(),

  /**
   * Input tokens consumed (user messages)
   */
  inputTokens: z.number().int().nonnegative().optional(),

  /**
   * Output tokens generated (assistant messages)
   */
  outputTokens: z.number().int().nonnegative().optional(),

  /**
   * Latency in milliseconds for assistant response
   */
  latencyMs: z.number().int().nonnegative().optional(),

  /**
   * Tools invoked during this message
   */
  toolsUsed: z.array(z.string()).optional(),

  /**
   * Knowledge bases queried during this message
   */
  kbsQueried: z.array(z.string()).optional(),

  /**
   * Chat version (V1 or V2 workspace chat)
   */
  chatVersion: z.enum(['v1', 'v2']).default('v1'),
});

export const ChatMessageEventSchema = BaseEventSchema.extend({
  eventType: z.literal('chat_message'),
  eventData: ChatMessageEventDataSchema,
});

export type ChatMessageEvent = z.infer<typeof ChatMessageEventSchema>;
