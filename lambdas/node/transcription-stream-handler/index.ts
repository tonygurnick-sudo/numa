/**
 * DynamoDB Streams handler for the transcriptions table.
 *
 * Fires a notification on every lifecycle event:
 *   INSERT  (QUEUED)       → "Transcription Queued"
 *   MODIFY  (PROCESSING)   → "Transcription Processing"
 *   MODIFY  (COMPLETED)    → "Transcription Complete"
 *   MODIFY  (FAILED)       → "Transcription Failed"
 *   MODIFY  (CANCELLED)    → "Transcription Cancelled"
 *   REMOVE                 → "Transcription Deleted"
 */

import type { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { withPRM } from '../../../lib/prm-node/prm';

const REGION = process.env.REGION ?? 'us-east-1';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME as string;
const USAGE_EVENTS_TABLE = process.env.USAGE_EVENTS_TABLE_NAME;
const AUDIT_AUTOMATION_TABLE = process.env.AUDIT_AUTOMATION_TABLE_NAME;

const ddbClient = withPRM(DynamoDBClient, { region: REGION });
const dynamo = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Unmarshall a DynamoDB Streams image (simple types only). */
function unmarshall(image: Record<string, Record<string, string>> | undefined): Record<string, unknown> {
  if (!image) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(image)) {
    if ('S' in value) result[key] = value.S;
    else if ('N' in value) result[key] = Number(value.N);
    else if ('BOOL' in value) result[key] = value.BOOL === 'true' || value.BOOL === (true as unknown);
    else if ('NULL' in value) result[key] = null;
    else result[key] = value;
  }
  return result;
}

type EventType = 'started' | 'completed' | 'failed' | 'cancelled';

/** Map a DDB status (or REMOVE event) to a notification event_type. */
function mapEventType(status: string | undefined, eventName: string): EventType {
  if (eventName === 'REMOVE') return 'cancelled';
  switch (status) {
    case 'QUEUED':
    case 'PROCESSING':
      return 'started';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
    case 'CANCEL_REQUESTED':
      return 'cancelled';
    default:
      return 'started';
  }
}

/** Build a human-readable title for the notification. */
function buildTitle(status: string | undefined, eventName: string): string {
  if (eventName === 'REMOVE') return 'Transcription Deleted';
  switch (status) {
    case 'QUEUED':
      return 'Transcription Queued';
    case 'PROCESSING':
      return 'Transcription Processing';
    case 'COMPLETED':
      return 'Transcription Complete';
    case 'FAILED':
      return 'Transcription Failed';
    case 'CANCELLED':
      return 'Transcription Cancelled';
    case 'CANCEL_REQUESTED':
      return 'Transcription Cancelling';
    default:
      return 'Transcription Updated';
  }
}

/** Build a message describing the event. */
function buildMessage(fileName: string, status: string | undefined, eventName: string): string {
  if (eventName === 'REMOVE') return `${fileName} has been deleted`;
  switch (status) {
    case 'QUEUED':
      return `${fileName} has been queued for processing`;
    case 'PROCESSING':
      return `${fileName} is being processed`;
    case 'COMPLETED':
      return `${fileName} has been processed`;
    case 'FAILED':
      return `${fileName} processing failed`;
    case 'CANCELLED':
    case 'CANCEL_REQUESTED':
      return `${fileName} has been cancelled`;
    default:
      return `${fileName} status updated`;
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    try {
      const eventName = record.eventName ?? '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newImage = unmarshall(record.dynamodb?.NewImage as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oldImage = unmarshall(record.dynamodb?.OldImage as any);

      // Determine what happened
      let shouldNotify = false;
      let image = newImage;
      let status = newImage.status as string | undefined;

      if (eventName === 'INSERT') {
        // New job created
        shouldNotify = true;
      } else if (eventName === 'MODIFY') {
        // Only notify on status changes
        if (newImage.status !== oldImage.status) {
          shouldNotify = true;
        }
      } else if (eventName === 'REMOVE') {
        // Job deleted — use oldImage for data
        shouldNotify = true;
        image = oldImage;
        status = undefined; // signals deletion
      }

      if (!shouldNotify) continue;

      const userId = image.userSub as string;
      const fileName = (image.fileName as string) || 'Unknown file';
      const jobId = image.jobId as string;

      if (!userId || !NOTIFICATIONS_TABLE) continue;

      const now = Date.now();
      const notification = {
        user_id: userId,
        notification_id: uuidv4(),
        event_type: mapEventType(status, eventName),
        schedule_type: 'transcription',
        schedule_id: uuidv4(),
        title: buildTitle(status, eventName),
        message: buildMessage(fileName, status, eventName),
        status: 'unread',
        metadata: {
          jobId,
          fileName,
          fileSize: image.fileSize,
          fileExtension: image.fileExtension,
          jobStatus: eventName === 'REMOVE' ? 'DELETED' : status,
        },
        created_at: now,
        expires_at: now + 90 * 24 * 60 * 60 * 1000,
      };

      await dynamo.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE,
          Item: notification,
        })
      );

      console.log(`Notification created: ${notification.title}`, {
        userId,
        fileName,
        jobId,
        eventName,
        status,
      });

      // Write usage record when a transcription completes
      if (USAGE_EVENTS_TABLE && eventName === 'MODIFY' && status === 'COMPLETED') {
        try {
          await dynamo.send(
            new PutCommand({
              TableName: USAGE_EVENTS_TABLE,
              Item: {
                PK: `USER#${userId}`,
                SK: `EVENT#${now}#${jobId}`,
                eventType: 'transcribe',
                timestamp: now,
                userSub: userId,
                fileName,
                fileSize: image.fileSize,
                processingTimeMs: image.processingTimeMs,
                isTest: 'false',
              },
            })
          );
          console.log('Usage record created for transcription', { userId, jobId });
        } catch (usageError) {
          console.error('Failed to write usage record', {
            error: usageError instanceof Error ? usageError.message : String(usageError),
          });
        }
      }

      // Update the STARTED audit entry in-place for terminal status changes
      if (AUDIT_AUTOMATION_TABLE && eventName === 'MODIFY') {
        const auditAction =
          status === 'COMPLETED'
            ? 'TRANSCRIPTION_COMPLETED'
            : status === 'FAILED'
              ? 'TRANSCRIPTION_FAILED'
              : status === 'CANCELLED'
                ? 'TRANSCRIPTION_CANCELLED'
                : null;

        const auditStatus =
          status === 'COMPLETED' ? 'success' : status === 'FAILED' || status === 'CANCELLED' ? 'failure' : null;

        const auditLogTimestamp = image.auditLogTimestamp as number | undefined;

        if (auditAction && auditStatus && auditLogTimestamp) {
          try {
            // Update the existing STARTED entry using deterministic logId + stored timestamp
            await dynamo.send(
              new UpdateCommand({
                TableName: AUDIT_AUTOMATION_TABLE,
                Key: {
                  logId: `txn-${jobId}`,
                  timestamp: auditLogTimestamp,
                },
                UpdateExpression:
                  'SET #a = :action, #s = :status, details.processingTimeMs = :pms, details.outputKey = :ok, details.errorMessage = :err, details.completedAt = :ca',
                ExpressionAttributeNames: {
                  '#a': 'action',
                  '#s': 'status',
                },
                ExpressionAttributeValues: {
                  ':action': auditAction,
                  ':status': auditStatus,
                  ':pms': image.processingTimeMs ?? null,
                  ':ok': image.outputKey ?? null,
                  ':err': image.errorMessage ?? null,
                  ':ca': now,
                },
              })
            );
            console.log('Audit log updated', { action: auditAction, jobId });
          } catch (auditError) {
            console.error('Failed to update audit log', {
              error: auditError instanceof Error ? auditError.message : String(auditError),
            });
          }
        }
      }
    } catch (error) {
      // Don't throw — notification failure shouldn't fail the stream
      console.error('Failed to process stream record', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
