import { isScheduleCompleted } from './cronUtils';
import type { AgentSchedule } from '../types/agentSchedules';

export type DerivedAutomationStatus = 'active' | 'paused' | 'completed';

/**
 * Derives a display status for an automation.
 * - 'paused' if manually paused
 * - 'completed' if active but all runs are done (one-time past date or maxRuns reached)
 * - 'active' otherwise
 */
export const getDerivedAutomationStatus = (schedule: AgentSchedule): DerivedAutomationStatus => {
  if (schedule.status === 'paused') return 'paused';
  if (schedule.status === 'active' && isScheduleCompleted(schedule)) return 'completed';
  return 'active';
};

/**
 * Formats an epoch timestamp as a relative time string (e.g., "2h ago", "Just now")
 */
export const formatRelativeTime = (epoch?: number): string => {
  if (!epoch) return '';
  const date = new Date(epoch > 1e12 ? epoch : epoch * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Formats a duration between two ISO date strings (e.g., "2m 15s", "1h 30m")
 */
export const formatDuration = (startedAt?: string, completedAt?: string): string | null => {
  if (!startedAt || !completedAt) return null;
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
};

/**
 * Extracts userId from an S3 key like "numa-chat/scheduled-runs/{userId}/{automationId}/..."
 */
export const extractUserIdFromS3Key = (s3Key?: string): string | null => {
  if (!s3Key) return null;
  const match = s3Key.match(/numa-chat\/scheduled-runs\/([^/]+)\//);
  return match?.[1] ?? null;
};
