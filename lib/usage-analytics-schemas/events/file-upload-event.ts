import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for file uploads
 */
export const FileUploadEventDataSchema = z.object({
  /**
   * File name
   */
  fileName: z.string(),

  /**
   * MIME type
   */
  fileType: z.string(),

  /**
   * File size in bytes
   */
  fileSizeBytes: z.number().int().nonnegative(),

  /**
   * S3 bucket where stored
   */
  s3Bucket: z.string(),

  /**
   * S3 key (path)
   */
  s3Key: z.string(),

  /**
   * Upload context (chat, kb, app, etc.)
   */
  uploadContext: z.enum(['chat_v1', 'chat_v2', 'knowledge_base', 'app', 'data_connector']),

  /**
   * Related conversation ID (for chat uploads)
   */
  conversationId: z.string().uuid().optional(),

  /**
   * Related knowledge base ID (for KB uploads)
   */
  knowledgeBaseId: z.string().optional(),

  /**
   * Whether content was successfully extracted
   */
  contentExtracted: z.boolean().optional(),
});

export const FileUploadEventSchema = BaseEventSchema.extend({
  eventType: z.literal('file_upload'),
  eventData: FileUploadEventDataSchema,
});

export type FileUploadEvent = z.infer<typeof FileUploadEventSchema>;
