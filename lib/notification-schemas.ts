import { z } from 'zod';

export const EventNotificationSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  notification_id: z.string().uuid('Invalid notification ID format'),
  event_type: z.enum(['started', 'completed', 'partial', 'failed', 'cancelled']),
  schedule_type: z.enum(['agent', 'application', 'data_sync']),
  schedule_id: z.string().uuid('Invalid schedule ID format'),
  title: z.string().min(1, 'Title is required'),
  message: z.string().min(1, 'Message is required'),
  status: z.enum(['unread', 'read', 'dismissed']).default('unread'),
  metadata: z.record(z.unknown()).optional(),
  created_at: z.number().positive('Invalid creation timestamp'),
  read_at: z.number().optional(),
  expires_at: z.number().positive('Invalid expiry timestamp'),
});

export const CreateNotificationPayloadSchema = z.object({
  event_type: z.enum(['started', 'completed', 'partial', 'failed', 'cancelled']),
  schedule_type: z.enum(['agent', 'application', 'data_sync']),
  schedule_id: z.string().uuid('Invalid schedule ID format'),
  title: z.string().min(1, 'Title is required'),
  message: z.string().min(1, 'Message is required'),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateNotificationPayloadSchema = z.object({
  status: z.enum(['read', 'dismissed']),
});

export type EventNotification = z.infer<typeof EventNotificationSchema>;
export type CreateNotificationPayload = z.infer<typeof CreateNotificationPayloadSchema>;
export type UpdateNotificationPayload = z.infer<typeof UpdateNotificationPayloadSchema>;

export const validateEventNotification = (data: unknown): EventNotification => {
  return EventNotificationSchema.parse(data);
};

export const validateCreateNotificationPayload = (data: unknown): CreateNotificationPayload => {
  return CreateNotificationPayloadSchema.parse(data);
};

export const validateUpdateNotificationPayload = (data: unknown): UpdateNotificationPayload => {
  return UpdateNotificationPayloadSchema.parse(data);
};
