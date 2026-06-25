import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Module-level state -- survives component unmount so that notification
// tracking works even when the user navigates away from /chat.
// ---------------------------------------------------------------------------
let _wasAway = false;
let _processing = false;
let _permissionState: NotificationPermission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

// Approval window, in seconds. Source of truth is APPROVAL_TIMEOUT_SECONDS in
// `WorkspaceChatInlineTool.tsx` / `lambdas/python/workspace-chat-tools/tools/approval.py`.
// Only used here as a freshness guard, so it does not need to track exactly.
const APPROVAL_WINDOW_SECONDS = 180;

// ---------------------------------------------------------------------------
// Pending-approval attention indicator (tab title).
// Tracks approvals awaiting a decision and, while the tab is hidden, swaps the
// document title to a noticeable "approval needed" message so the user spots it
// in their tab strip even when OS/browser notifications are disabled. The
// original title is restored when the tab regains focus or all approvals
// resolve. Driven by WorkspaceChatInlineTool (which knows pending vs decided).
// ---------------------------------------------------------------------------
const _pendingApprovalIds = new Set<string>();
let _savedTitle: string | null = null;

function applyApprovalTitle() {
  if (typeof document === 'undefined') return;
  const count = _pendingApprovalIds.size;
  const shouldFlag = count > 0 && document.visibilityState === 'hidden';

  if (shouldFlag) {
    if (_savedTitle === null) _savedTitle = document.title;
    const next = count > 1 ? `🔔 (${count}) Approvals needed — Numa` : '🔔 Approval needed — Numa';
    if (document.title !== next) document.title = next;
  } else if (_savedTitle !== null) {
    // Restore and clear so the next cycle re-captures a fresh base title.
    document.title = _savedTitle;
    _savedTitle = null;
  }
}

// Global visibility listener -- registered once when the module loads.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (_processing && document.visibilityState === 'hidden') {
      _wasAway = true;
    }
    // Show the attention title when the user leaves with a pending approval,
    // and restore it the moment they come back.
    applyApprovalTitle();
  });
}

/** Flag an approval as awaiting a decision (drives the tab-title indicator). */
export function registerPendingApproval(requestId: string) {
  if (!requestId) return;
  _pendingApprovalIds.add(requestId);
  applyApprovalTitle();
}

/** Clear a pending approval once it is decided, times out, or unmounts. */
export function resolvePendingApproval(requestId: string) {
  if (!requestId) return;
  _pendingApprovalIds.delete(requestId);
  applyApprovalTitle();
}

/**
 * Call when the user sends a message / streaming begins.
 * Resets the "was away" flag for the new processing session.
 */
export function markProcessingStart() {
  _processing = true;
  _wasAway = false;

  // Proactively request permission on first message send so the browser
  // prompt appears early. The OS-level toggle (System Settings > Notifications)
  // must still be enabled by the user manually.
  if (typeof Notification !== 'undefined' && _permissionState === 'default') {
    Notification.requestPermission().then((result) => {
      _permissionState = result;
    });
  }
}

/**
 * Call from stream completion callbacks (works from stale closures because
 * it reads module-level state, not React refs).
 */
export async function notifyCompletion(conversationName?: string) {
  const shouldNotify = _wasAway || document.visibilityState === 'hidden';

  // Reset tracking state
  _wasAway = false;
  _processing = false;

  if (!shouldNotify) return;
  if (typeof Notification === 'undefined') return;

  // Lazy permission request
  if (_permissionState === 'default') {
    _permissionState = await Notification.requestPermission();
  }
  if (_permissionState !== 'granted') return;

  const body = conversationName
    ? `Finished responding in "${conversationName}"`
    : 'Finished responding to your message';

  const notification = new Notification('Numa', {
    body,
    icon: '/numa-logo.svg',
    tag: 'numa-chat-complete',
  });

  notification.onclick = () => {
    window.focus();
    // Navigate to /chat if user is on a different page
    if (!window.location.pathname.startsWith('/chat')) {
      window.location.href = '/chat';
    }
    notification.close();
  };

  setTimeout(() => notification.close(), 10_000);
}

/**
 * Call when a tool-approval prompt becomes pending mid-turn. Fires a browser
 * notification -- only when the user is away or the tab is hidden -- so they
 * don't miss the ~180s approval window after switching tabs.
 *
 * Unlike notifyCompletion this does NOT reset the away/processing flags: the
 * turn is still in progress, and a completion (or further approval) is yet to
 * come. Gated on `_processing` so it never fires on stream resume / history
 * replays where markProcessingStart() wasn't called for this session.
 */
export async function notifyApprovalPending(opts?: { description?: string; createdAt?: number }) {
  if (!_processing) return;

  // Freshness guard: skip approvals whose window has already elapsed.
  if (typeof opts?.createdAt === 'number') {
    const elapsed = Math.floor(Date.now() / 1000) - opts.createdAt;
    if (elapsed >= APPROVAL_WINDOW_SECONDS) return;
  }

  const shouldNotify = _wasAway || document.visibilityState === 'hidden';
  if (!shouldNotify) return;
  if (typeof Notification === 'undefined') return;

  if (_permissionState === 'default') {
    _permissionState = await Notification.requestPermission();
  }
  if (_permissionState !== 'granted') return;

  const description = opts?.description?.trim();
  const body = description ? `Approval needed: ${description}` : 'An action is waiting for your approval';

  const notification = new Notification('Numa — approval needed', {
    body,
    icon: '/numa-logo.svg',
    tag: 'numa-approval-pending',
    // Keep it on screen until the user acts -- it's time-sensitive.
    requireInteraction: true,
  });

  notification.onclick = () => {
    window.focus();
    if (!window.location.pathname.startsWith('/chat')) {
      window.location.href = '/chat';
    }
    notification.close();
  };

  // Fallback close shortly before the approval window ends so a stale prompt
  // doesn't linger after it has already timed out server-side.
  setTimeout(() => notification.close(), (APPROVAL_WINDOW_SECONDS - 20) * 1000);
}

/**
 * Hook that tracks route changes to detect when the user navigates away
 * from /chat while processing. Must be called in a component that does NOT
 * unmount on navigation (e.g. AppRoutes, AppLayout).
 */
export function useBrowserNotificationRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    if (_processing && !location.pathname.startsWith('/chat')) {
      _wasAway = true;
    }
  }, [location.pathname]);
}
