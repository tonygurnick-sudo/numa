import { useState, useEffect, useCallback, useRef } from 'react';
import { NotificationService } from '../Services/NotificationService';
import type { EventNotification } from '../types/notifications';

type UnreadCountListener = (count: number) => void;
type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;

let unreadCountValue = 0;
const unreadCountListeners = new Set<UnreadCountListener>();

const setUnreadCountValue = (count: number) => {
  unreadCountValue = count;
  unreadCountListeners.forEach((listener) => listener(unreadCountValue));
};

const incrementUnreadCount = () => {
  setUnreadCountValue(unreadCountValue + 1);
};

export const useNotificationStream = () => {
  const [unreadCount, setUnreadCount] = useState(unreadCountValue);
  const [isConnected, setIsConnected] = useState(false);
  const [lastNotification, _setLastNotification] = useState<EventNotification | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const _showToast = useCallback((notification: EventNotification) => {
    // Simple toast implementation - can be enhanced with a toast library
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/favicon.ico',
      });
    }
  }, []);

  const _updateUnreadCount = useCallback(async () => {
    try {
      // This would need to be called with numaGet from context
      // For now, just increment the count when we receive a notification
      incrementUnreadCount();
    } catch (error) {
      console.error('Failed to update unread count:', error);
    }
  }, []);

  const connect = useCallback(() => {
    // Disable streaming for now - Lambda doesn't support SSE without Lambda Web Adapter
    setIsConnected(false);
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const refreshUnreadCount = useCallback(async (numaGet: NumaGet) => {
    try {
      const count = await NotificationService.getUnreadCount(numaGet);
      setUnreadCountValue(count);
    } catch (error) {
      console.error('Failed to refresh unread count:', error);
    }
  }, []);

  // Initialize unread count on mount
  useEffect(() => {
    // This will be called from components that have access to numaGet
    // For now, we'll start with 0 and update when refreshUnreadCount is called
  }, []);

  useEffect(() => {
    unreadCountListeners.add(setUnreadCount);
    return () => {
      unreadCountListeners.delete(setUnreadCount);
    };
  }, []);

  useEffect(() => {
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    unreadCount,
    isConnected,
    lastNotification,
    refreshUnreadCount,
    connect,
    disconnect,
  };
};
