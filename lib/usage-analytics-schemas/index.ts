/**
 * Numa Usage Analytics Schemas
 *
 * Shared Zod schemas for validating usage analytics events across
 * frontend, backend, and API documentation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// Import base schema
export * from './base-event';

// Import all event schemas
export * from './events/login-event';
export * from './events/chat-message-event';
export * from './events/chat-conversation-event';
export * from './events/agent-created-event';
export * from './events/agent-executed-event';
export * from './events/file-upload-event';
export * from './events/file-delete-event';
export * from './events/kb-created-event';
export * from './events/kb-deleted-event';
export * from './events/kb-query-event';
export * from './events/integration-activated-event';
export * from './events/integration-tool-call-event';
export * from './events/secret-accessed-event';

// Import individual event schemas for the discriminated union
import { LoginEventSchema } from './events/login-event';
import { ChatMessageEventSchema } from './events/chat-message-event';
import { ChatConversationEventSchema } from './events/chat-conversation-event';
import { AgentCreatedEventSchema } from './events/agent-created-event';
import { AgentExecutedEventSchema } from './events/agent-executed-event';
import { FileUploadEventSchema } from './events/file-upload-event';
import { FileDeleteEventSchema } from './events/file-delete-event';
import { KbCreatedEventSchema } from './events/kb-created-event';
import { KbDeletedEventSchema } from './events/kb-deleted-event';
import { KbQueryEventSchema } from './events/kb-query-event';
import { IntegrationActivatedEventSchema } from './events/integration-activated-event';
import { IntegrationToolCallEventSchema } from './events/integration-tool-call-event';
import { SecretAccessedEventSchema } from './events/secret-accessed-event';

/**
 * Discriminated union of all usage event types.
 * Discriminates on the `eventType` field for type-safe validation.
 */
export const UsageEventSchema = z.discriminatedUnion('eventType', [
  LoginEventSchema,
  ChatMessageEventSchema,
  ChatConversationEventSchema,
  AgentCreatedEventSchema,
  AgentExecutedEventSchema,
  FileUploadEventSchema,
  FileDeleteEventSchema,
  KbCreatedEventSchema,
  KbDeletedEventSchema,
  KbQueryEventSchema,
  IntegrationActivatedEventSchema,
  IntegrationToolCallEventSchema,
  SecretAccessedEventSchema,
]);

/**
 * TypeScript type for any usage event
 */
export type UsageEvent = z.infer<typeof UsageEventSchema>;

/**
 * Validates a usage event against the schema.
 * Throws a ZodError if validation fails.
 *
 * @param data - Unknown data to validate
 * @returns Validated and typed usage event
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * try {
 *   const event = validateUsageEvent({
 *     eventType: 'login',
 *     eventId: '123e4567-e89b-12d3-a456-426614174000',
 *     timestamp: Date.now(),
 *     isTest: true,
 *     userId: 'user-123',
 *     source: 'test-api',
 *     eventData: {
 *       ipAddress: '192.168.1.1',
 *       loginMethod: 'cognito',
 *       success: true,
 *     },
 *   });
 *   console.log('Valid event:', event);
 * } catch (error) {
 *   console.error('Invalid event:', error);
 * }
 * ```
 */
export const validateUsageEvent = (data: unknown): UsageEvent => {
  return UsageEventSchema.parse(data);
};

/**
 * Safely validates a usage event, returning success/error result.
 * Does not throw, suitable for production code.
 *
 * @param data - Unknown data to validate
 * @returns Result object with success flag and either data or error
 *
 * @example
 * ```typescript
 * const result = safeValidateUsageEvent(untrustedData);
 * if (result.success) {
 *   console.log('Valid event:', result.data);
 * } else {
 *   console.error('Validation error:', result.error);
 * }
 * ```
 */
export const safeValidateUsageEvent = (
  data: unknown
): { success: true; data: UsageEvent } | { success: false; error: z.ZodError } => {
  const result = UsageEventSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
};

// Export contract generator
export * from './contract-generator';
