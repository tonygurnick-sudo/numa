import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for knowledge base deletion
 */
export const KbDeletedEventDataSchema = z.object({
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
   * Number of files deleted
   */
  fileCount: z.number().int().nonnegative().default(0),

  /**
   * Total storage reclaimed in bytes
   */
  storageReclaimedBytes: z.number().int().nonnegative().default(0),
});

export const KbDeletedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('kb_deleted'),
  eventData: KbDeletedEventDataSchema,
});

export type KbDeletedEvent = z.infer<typeof KbDeletedEventSchema>;
