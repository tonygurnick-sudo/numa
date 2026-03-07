import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for knowledge base creation
 */
export const KbCreatedEventDataSchema = z.object({
  /**
   * Knowledge base ID
   */
  knowledgeBaseId: z.string(),

  /**
   * KB name/title
   */
  knowledgeBaseName: z.string(),

  /**
   * KB type (Q Business or Bedrock)
   */
  kbType: z.enum(['q_business', 'bedrock_kb']),

  /**
   * Initial visibility
   */
  visibility: z.enum(['personal', 'shared', 'company']),

  /**
   * Number of files uploaded initially
   */
  initialFileCount: z.number().int().nonnegative().default(0),

  /**
   * Total storage size in bytes
   */
  initialStorageBytes: z.number().int().nonnegative().default(0),
});

export const KbCreatedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('kb_created'),
  eventData: KbCreatedEventDataSchema,
});

export type KbCreatedEvent = z.infer<typeof KbCreatedEventSchema>;
