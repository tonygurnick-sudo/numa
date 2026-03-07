import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for knowledge base queries
 */
export const KbQueryEventDataSchema = z.object({
  /**
   * Knowledge base ID queried
   */
  knowledgeBaseId: z.string(),

  /**
   * Query text
   */
  query: z.string(),

  /**
   * Number of results returned
   */
  resultCount: z.number().int().nonnegative(),

  /**
   * Query latency in milliseconds
   */
  latencyMs: z.number().int().nonnegative(),

  /**
   * Context where query was made
   */
  queryContext: z.enum(['chat_v1', 'chat_v2', 'agent', 'app']),

  /**
   * Related conversation ID (for chat queries)
   */
  conversationId: z.string().uuid().optional(),

  /**
   * Related agent ID (for agent queries)
   */
  agentId: z.string().optional(),
});

export const KbQueryEventSchema = BaseEventSchema.extend({
  eventType: z.literal('kb_query'),
  eventData: KbQueryEventDataSchema,
});

export type KbQueryEvent = z.infer<typeof KbQueryEventSchema>;
