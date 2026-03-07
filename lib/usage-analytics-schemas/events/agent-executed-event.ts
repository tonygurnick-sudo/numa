import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for agent execution (manual or scheduled)
 */
export const AgentExecutedEventDataSchema = z.object({
  /**
   * Agent ID
   */
  agentId: z.string(),

  /**
   * Execution ID (unique per run)
   */
  executionId: z.string().uuid(),

  /**
   * Execution trigger type
   */
  trigger: z.enum(['manual', 'scheduled', 'api']),

  /**
   * Schedule ID if triggered by schedule
   */
  scheduleId: z.string().optional(),

  /**
   * Total messages in the agent run
   */
  messageCount: z.number().int().nonnegative(),

  /**
   * Total tokens consumed
   */
  totalTokens: z.number().int().nonnegative().optional(),

  /**
   * Execution duration in milliseconds
   */
  durationMs: z.number().int().nonnegative(),

  /**
   * Whether execution completed successfully
   */
  success: z.boolean(),

  /**
   * Error message if failed
   */
  errorMessage: z.string().optional(),
});

export const AgentExecutedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('agent_executed'),
  eventData: AgentExecutedEventDataSchema,
});

export type AgentExecutedEvent = z.infer<typeof AgentExecutedEventSchema>;
