import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Module-level state -- survives component unmount so that notification
// tracking works even when the user navigates away from /chat.
// ---------------------------------------------------------------------------
let _wasAway = false;
let _processing = false;
let _permissionState: NotificationPermission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

// Global visibility listener -- registered once when the module loads.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (_processing && document.visibilityState === 'hidden') {
      _wasAway = true;
    }
  });
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
