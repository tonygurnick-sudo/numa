import type { EventNotification } from '../types/notifications';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

const BASE_URL = '/api/notifications';

export const NotificationService = {
  list: async (numaGet: NumaGet): Promise<EventNotification[]> => {
    const response = (await numaGet(BASE_URL)) as { notifications?: EventNotification[] };
    return response?.notifications ?? [];
  },

  getUnreadCount: async (numaGet: NumaGet): Promise<number> => {
    const response = (await numaGet(`${BASE_URL}/unread-count`)) as { count?: number };
    return response?.count ?? 0;
  },

  markAsRead: async (numaPut: NumaPut, notificationId: string): Promise<EventNotification> => {
    const response = (await numaPut(`${BASE_URL}/${notificationId}`, { status: 'read' })) as EventNotification;
    return response;
  },

  dismiss: async (numaPut: NumaPut, notificationId: string): Promise<EventNotification> => {
    const response = (await numaPut(`${BASE_URL}/${notificationId}`, { status: 'dismissed' })) as EventNotification;
    return response;
  },

  delete: async (numaDelete: NumaDelete, notificationId: string): Promise<void> => {
    await numaDelete(`${BASE_URL}/${notificationId}`);
  },

  // Stream connection
  createEventSource: (): EventSource => {
    const eventSource = new EventSource(`${BASE_URL}/stream`);

    // Add authorization header if possible (EventSource doesn't support custom headers)
    // The stream endpoint will validate via CloudFront secret + JWT in URL params
    return eventSource;
  },
};
