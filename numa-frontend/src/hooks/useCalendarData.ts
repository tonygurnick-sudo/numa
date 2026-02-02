import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentSchedule } from '../types/agentSchedules';
import { ScheduleService } from '../Services/ScheduleService';
import type { EventTypeFilter } from '../Components/Calendar/CalendarToolbar';

interface CalendarDataCache {
  [key: string]: {
    data: AgentSchedule[];
    timestamp: number;
    loading: boolean;
  };
}

interface UseCalendarDataProps {
  numaGet: NumaGet;
  selectedEventTypes: EventTypeFilter[];
  cacheTimeout?: number; // Cache timeout in milliseconds
}

interface UseCalendarDataReturn {
  schedules: AgentSchedule[];
  loading: boolean;
  error: string | null;
  loadSchedules: () => Promise<void>;
  loadDataForDateRange: (startDate: Date, endDate: Date) => Promise<void>;
  clearCache: () => void;
}

const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes default
type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;

export const useCalendarData = ({
  numaGet,
  selectedEventTypes,
  cacheTimeout = CACHE_TIMEOUT,
}: UseCalendarDataProps): UseCalendarDataReturn => {
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<CalendarDataCache>({});

  // Generate cache key based on date range and event types
  const getCacheKey = (startDate?: Date, endDate?: Date) => {
    const start = startDate?.toISOString().split('T')[0] || 'all';
    const end = endDate?.toISOString().split('T')[0] || 'all';
    const types = selectedEventTypes.sort().join(',');
    return `${start}-${end}-${types}`;
  };

  // Check if cache entry is still valid
  const isCacheValid = (cacheEntry: CalendarDataCache[string]) => {
    return Date.now() - cacheEntry.timestamp < cacheTimeout && !cacheEntry.loading;
  };

  // Load schedules with optional date range filtering
  const loadDataForDateRange = useCallback(
    async (startDate?: Date, endDate?: Date) => {
      const cacheKey = getCacheKey(startDate, endDate);
      const cached = cacheRef.current[cacheKey];

      // Return cached data if valid
      if (cached && isCacheValid(cached)) {
        setSchedules(cached.data);
        setError(null);
        return;
      }

      // Prevent concurrent requests for the same data
      if (cached?.loading) {
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Mark as loading in cache
        cacheRef.current[cacheKey] = {
          data: cached?.data || [],
          timestamp: Date.now(),
          loading: true,
        };

        let fetchedSchedules: AgentSchedule[];

        if (startDate && endDate) {
          // Fetch data for specific date range
          fetchedSchedules = await ScheduleService.getCalendarEvents(
            numaGet,
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0],
            selectedEventTypes,
          );
        } else {
          // Fetch all active schedules
          fetchedSchedules = await ScheduleService.getActiveSchedules(numaGet);
        }

        // Filter by selected event types (for now, only 'agent' type exists)
        const filteredSchedules = fetchedSchedules.filter((schedule) =>
          selectedEventTypes.includes((schedule.eventType ?? 'agent') as EventTypeFilter),
        );

        // Update cache
        cacheRef.current[cacheKey] = {
          data: filteredSchedules,
          timestamp: Date.now(),
          loading: false,
        };

        setSchedules(filteredSchedules);
      } catch (err) {
        console.error('Failed to load calendar data:', err);
        setError((err as Error)?.message ?? 'Failed to load calendar data');

        // Mark as not loading in cache
        if (cacheRef.current[cacheKey]) {
          cacheRef.current[cacheKey].loading = false;
        }
      } finally {
        setLoading(false);
      }
    },
    [numaGet, selectedEventTypes, cacheTimeout],
  );

  // Load all schedules (default behavior)
  const loadSchedules = useCallback(async () => {
    await loadDataForDateRange();
  }, [loadDataForDateRange]);

  // Clear cache and reload data
  const clearCache = useCallback(() => {
    cacheRef.current = {};
    loadSchedules();
  }, [loadSchedules]);

  // Auto-reload when event types change
  useEffect(() => {
    loadSchedules();
  }, [selectedEventTypes]);

  // Clean up expired cache entries periodically
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      Object.keys(cacheRef.current).forEach((key) => {
        const entry = cacheRef.current[key];
        if (now - entry.timestamp > cacheTimeout * 2) {
          delete cacheRef.current[key];
        }
      });
    }, cacheTimeout);

    return () => clearInterval(cleanup);
  }, [cacheTimeout]);

  return {
    schedules,
    loading,
    error,
    loadSchedules,
    loadDataForDateRange,
    clearCache,
  };
};
