import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for agent creation
 */
export const AgentCreatedEventDataSchema = z.object({
  /**
   * Agent ID
   */
  agentId: z.string(),

  /**
   * Agent title/name
   */
  agentTitle: z.string(),

  /**
   * Agent visibility (personal or shared)
   */
  visibility: z.enum(['personal', 'shared']),

  /**
   * Custom instructions provided
   */
  hasCustomInstructions: z.boolean(),

  /**
   * Tools enabled for this agent
   */
  toolsEnabled: z.array(z.string()).optional(),

  /**
   * Knowledge bases attached
   */
  kbsAttached: z.array(z.string()).optional(),

  /**
   * Integrations configured
   */
  integrationsConfigured: z.array(z.string()).optional(),
});

export const AgentCreatedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('agent_created'),
  eventData: AgentCreatedEventDataSchema,
});

export type AgentCreatedEvent = z.infer<typeof AgentCreatedEventSchema>;
