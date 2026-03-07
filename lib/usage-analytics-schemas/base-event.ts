import { z } from 'zod';

/**
 * Base schema for all usage analytics events.
 * All event types must include these common fields.
 */
export const BaseEventSchema = z.object({
  /**
   * Type of event being tracked
   */
  eventType: z.enum([
    'login',
    'chat_message',
    'chat_conversation',
    'agent_created',
    'agent_executed',
    'file_upload',
    'file_delete',
    'kb_created',
    'kb_deleted',
    'kb_query',
    'integration_activated',
    'integration_tool_call',
    'secret_accessed',
  ]),

  /**
   * Unique identifier for this event (UUID v4)
   */
  eventId: z.string().uuid(),

  /**
   * Unix timestamp in milliseconds when the event occurred
   */
  timestamp: z.number().int().positive(),

  /**
   * Flag indicating if this is test data (can be bulk deleted)
   */
  isTest: z.boolean(),

  /**
   * User ID (Cognito sub) who triggered the event
   */
  userId: z.string().min(1),

  /**
   * Display name or email for the user — used only for UI rendering, never as a key
   */
  userName: z.string().optional(),

  /**
   * Source system that generated the event
   * @default 'test-api'
   */
  source: z.string().default('test-api'),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;
