import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for integration activation/deactivation
 */
export const IntegrationActivatedEventDataSchema = z.object({
  /**
   * Integration name (e.g., gmail, slack, jira)
   */
  integrationName: z.string(),

  /**
   * Action performed
   */
  action: z.enum(['connected', 'disconnected', 'reconfigured']),

  /**
   * Number of tools enabled for this integration
   */
  toolsEnabled: z.number().int().nonnegative().default(0),

  /**
   * Whether user has custom tool policies
   */
  hasCustomPolicies: z.boolean().default(false),
});

export const IntegrationActivatedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('integration_activated'),
  eventData: IntegrationActivatedEventDataSchema,
});

export type IntegrationActivatedEvent = z.infer<typeof IntegrationActivatedEventSchema>;
