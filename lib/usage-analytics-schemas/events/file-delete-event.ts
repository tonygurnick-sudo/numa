import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for file deletions
 */
export const FileDeleteEventDataSchema = z.object({
  /**
   * File name
   */
  fileName: z.string(),

  /**
   * S3 bucket where file was stored
   */
  s3Bucket: z.string(),

  /**
   * S3 key (path)
   */
  s3Key: z.string(),

  /**
   * File size in bytes (reclaimed storage)
   */
  fileSizeBytes: z.number().int().nonnegative().optional(),

  /**
   * Deletion context
   */
  deleteContext: z.enum(['chat_cleanup', 'kb_removal', 'manual', 'automated_ttl']),

  /**
   * Related knowledge base ID (for KB file deletions)
   */
  knowledgeBaseId: z.string().optional(),
});

export const FileDeleteEventSchema = BaseEventSchema.extend({
  eventType: z.literal('file_delete'),
  eventData: FileDeleteEventDataSchema,
});

export type FileDeleteEvent = z.infer<typeof FileDeleteEventSchema>;
