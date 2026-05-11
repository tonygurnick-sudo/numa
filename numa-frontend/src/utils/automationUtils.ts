import { isScheduleCompleted } from './cronUtils';
import type { AgentSchedule } from '../types/agentSchedules';

export type DerivedAutomationStatus = 'active' | 'paused' | 'completed' | 'pending' | 'locked';

/**
 * Derives a display status for an automation. The underlying schedule
 * record can be in five states; this collapses them onto a UI-friendly
 * label so callers don't need to remember the full set.
 *
 * - `'paused'` — owner toggled it off
 * - `'pending'` — created over the user cap, awaiting admin approval
 *   (no EventBridge rule exists yet, so it isn't actually firing)
 * - `'locked'` — admin put it in `admin_locked` state; owner can't toggle
 * - `'completed'` — active but exhausted (one-time past date / maxRuns hit)
 * - `'active'` — running on schedule
 *
 * Anything other than these maps to `'active'` as a safe fallback.
 */
export const getDerivedAutomationStatus = (schedule: AgentSchedule): DerivedAutomationStatus => {
  if (schedule.status === 'paused') return 'paused';
  if (schedule.status === 'pending_approval') return 'pending';
  if (schedule.status === 'admin_locked') return 'locked';
  if (schedule.status === 'active' && isScheduleCompleted(schedule)) return 'completed';
  return 'active';
};

/**
 * Whether this schedule is funded by the company quota bucket rather than
 * the owner's personal cap. True for explicitly-promoted schedules
 * (`quotaScope === 'company'`) and for legacy admin-approved ones (where
 * the `quotaScope` field never got set but approval implies promotion).
 */
export const automationUsesCompanyQuota = (schedule: AgentSchedule): boolean =>
  schedule.quotaScope === 'company' || !!schedule.approvedBy;

/**
 * Single source of truth for the Bootstrap `bg` value used on status
 * badges across the automations UI.
 */
export const automationStatusBadgeVariant = (status: DerivedAutomationStatus): string => {
  switch (status) {
    case 'active':
      return 'success';
    case 'paused':
      return 'warning';
    case 'pending':
      return 'info';
    case 'locked':
      return 'danger';
    case 'completed':
      return 'secondary';
  }
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
