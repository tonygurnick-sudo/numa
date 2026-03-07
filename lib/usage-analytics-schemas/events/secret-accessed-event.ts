import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for company secret access
 */
export const SecretAccessedEventDataSchema = z.object({
  /**
   * Secret identifier (never log actual secret)
   */
  secretId: z.string(),

  /**
   * Secret name/label
   */
  secretName: z.string(),

  /**
   * Access context
   */
  accessContext: z.enum(['data_connector', 'integration', 'api', 'admin']),

  /**
   * Operation performed
   */
  operation: z.enum(['read', 'created', 'updated', 'deleted', 'rotated']),

  /**
   * Related data connector ID (for data connector secrets)
   */
  dataConnectorId: z.string().optional(),

  /**
   * Related integration name (for integration secrets)
   */
  integrationName: z.string().optional(),
});

export const SecretAccessedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('secret_accessed'),
  eventData: SecretAccessedEventDataSchema,
});

export type SecretAccessedEvent = z.infer<typeof SecretAccessedEventSchema>;
