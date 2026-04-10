export type EventNotification = {
  user_id: string;
  notification_id: string;
  event_type: 'started' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'new_event';
  schedule_type: 'agent' | 'application' | 'data_sync' | 'transcription' | 'connector';
  schedule_id: string;
  title: string;
  message: string;
  status: 'unread' | 'read' | 'dismissed';
  metadata?: Record<string, unknown>;
  created_at: number;
  read_at?: number;
  expires_at: number;
};
