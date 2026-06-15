import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { withPRM } from './prm-node/prm';
import { validateEventNotification, type EventNotification } from './notification-schemas';

const REGION = process.env.REGION ?? 'us-east-1';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME ?? '';

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export class NotificationService {
  static async createNotification(
    userId: string,
    eventType: 'started' | 'completed' | 'partial' | 'failed' | 'cancelled',
    scheduleType: 'agent' | 'application' | 'data_sync' | 'transcription' | 'connector' | 'voice_call',
    scheduleId: string,
    title: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<EventNotification | null> {
    if (!NOTIFICATIONS_TABLE) {
      console.warn('Notifications table not configured, skipping notification creation');
      return null;
    }

    const now = Date.now();
    const notification: EventNotification = {
      user_id: userId,
      notification_id: uuidv4(),
      event_type: eventType,
      schedule_type: scheduleType,
      schedule_id: scheduleId,
      title,
      message,
      status: 'unread',
      metadata,
      created_at: now,
      expires_at: now + 90 * 24 * 60 * 60 * 1000, // 90 days TTL
    };

    try {
      const validatedNotification = validateEventNotification(notification);

      await dynamo.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE,
          Item: validatedNotification,
        })
      );

      return validatedNotification;
    } catch (error) {
      console.error('Failed to create notification:', error);
      // Don't throw - notification failure shouldn't break schedule execution
      return null;
    }
  }

  static async notifyScheduleStarted(
    userId: string,
    scheduleId: string,
    scheduleType: 'agent' | 'application' | 'data_sync' | 'transcription',
    scheduleName: string
  ): Promise<void> {
    await this.createNotification(
      userId,
      'started',
      scheduleType,
      scheduleId,
      'Schedule Started',
      `${scheduleName} has started execution`,
      { scheduleId, scheduleName }
    );
  }

  static async notifyScheduleCompleted(
    userId: string,
    scheduleId: string,
    scheduleType: 'agent' | 'application' | 'data_sync' | 'transcription',
    scheduleName: string,
    result?: string,
    extraMetadata?: Record<string, unknown>
  ): Promise<void> {
    await this.createNotification(
      userId,
      'completed',
      scheduleType,
      scheduleId,
      'Schedule Completed',
      `${scheduleName} completed successfully`,
      { scheduleId, scheduleName, result, ...extraMetadata }
    );
  }

  static async notifySchedulePartial(
    userId: string,
    scheduleId: string,
    scheduleType: 'agent' | 'application' | 'data_sync' | 'transcription',
    scheduleName: string,
    result?: string,
    extraMetadata?: Record<string, unknown>
  ): Promise<void> {
    await this.createNotification(
      userId,
      'partial',
      scheduleType,
      scheduleId,
      'Schedule Partially Completed',
      `${scheduleName} completed with warnings`,
      { scheduleId, scheduleName, result, ...extraMetadata }
    );
  }

  static async notifyScheduleFailed(
    userId: string,
    scheduleId: string,
    scheduleType: 'agent' | 'application' | 'data_sync' | 'transcription',
    scheduleName: string,
    error: string,
    extraMetadata?: Record<string, unknown>
  ): Promise<void> {
    await this.createNotification(
      userId,
      'failed',
      scheduleType,
      scheduleId,
      'Schedule Failed',
      `${scheduleName} failed: ${error}`,
      { scheduleId, scheduleName, error, ...extraMetadata }
    );
  }

  static async notifyScheduleCancelled(
    userId: string,
    scheduleId: string,
    scheduleType: 'agent' | 'application' | 'data_sync' | 'transcription',
    scheduleName: string
  ): Promise<void> {
    await this.createNotification(
      userId,
      'cancelled',
      scheduleType,
      scheduleId,
      'Schedule Cancelled',
      `${scheduleName} was cancelled`,
      { scheduleId, scheduleName }
    );
  }
}
