import { z } from 'zod';
import { BaseEventSchema } from '../base-event';

/**
 * Event data for user login/authentication events
 */
export const LoginEventDataSchema = z.object({
  /**
   * IP address of the user
   */
  ipAddress: z.string().ip().optional(),

  /**
   * User agent string from browser
   */
  userAgent: z.string().optional(),

  /**
   * Device information (from Cognito Advanced Security)
   */
  deviceInfo: z.string().optional(),

  /**
   * Authentication method used
   */
  loginMethod: z.enum(['cognito', 'saml', 'oauth']).default('cognito'),

  /**
   * Whether the login attempt was successful
   */
  success: z.boolean(),

  /**
   * Reason for failure (if success is false)
   */
  failureReason: z.string().optional(),

  /**
   * Risk score from Cognito Advanced Security (0-100)
   */
  riskScore: z.number().min(0).max(100).optional(),
});

export const LoginEventSchema = BaseEventSchema.extend({
  eventType: z.literal('login'),
  eventData: LoginEventDataSchema,
});

export type LoginEvent = z.infer<typeof LoginEventSchema>;
