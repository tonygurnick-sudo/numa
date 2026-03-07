import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for integration tool invocations
 */
export const IntegrationToolCallEventDataSchema = z.object({
  /**
   * Integration name (e.g., gmail, slack, jira)
   */
  integrationName: z.string(),

  /**
   * Tool name invoked
   */
  toolName: z.string(),

  /**
   * Context where tool was called
   */
  callContext: z.enum(['chat_v1', 'chat_v2', 'agent', 'workspace_agent']),

  /**
   * Related conversation ID (for chat calls)
   */
  conversationId: z.string().uuid().optional(),

  /**
   * Related agent ID (for agent calls)
   */
  agentId: z.string().optional(),

  /**
   * Whether the tool call succeeded
   */
  success: z.boolean(),

  /**
   * Tool execution latency in milliseconds
   */
  latencyMs: z.number().int().nonnegative(),

  /**
   * Error message if failed
   */
  errorMessage: z.string().optional(),
});

export const IntegrationToolCallEventSchema = BaseEventSchema.extend({
  eventType: z.literal('integration_tool_call'),
  eventData: IntegrationToolCallEventDataSchema,
});

export type IntegrationToolCallEvent = z.infer<typeof IntegrationToolCallEventSchema>;
