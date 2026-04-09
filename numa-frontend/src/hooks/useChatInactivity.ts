import { useCallback, useEffect, useRef, useState } from 'react';

export type ConversationMeta = {
  conversation_id: string;
  conversationName?: string | null;
  latestTimestamp: number;
  agentId?: string | null;
  agentTitle?: string | null;
  agentIcon?: string | null;
  agentType?: string | null;
  agentVisibility?: string | null;
  agentVersion?: number | null;
  isAgentConversation?: boolean;
  isWorkspaceConversation?: boolean;
};

type UseChatInactivityArgs = {
  numaChatDynamoUtils: { getUserConversationsMeta: (userId: string) => Promise<ConversationMeta[]> } | null;
  sub: string;
  buttonStatus: string;
  isProcessingRef: React.MutableRefObject<boolean>;
  onExpired: () => Promise<void> | void; // called when inactivity expires to start new chat
  inputMessage?: string; // optional: if provided, suggestions will hide on non-empty
  /** Optional suffix to isolate localStorage keys (e.g., '-v2' for workspace mode) */
  storageKeySuffix?: string;
  /** If true, filter out workspace conversations from suggestions (for V1 chat) */
  excludeWorkspaceConversations?: boolean;
  /** External flag indicating the new chat view is being shown (e.g. from useConversationManager) */
  hasUserStartedNewChat?: boolean;
};

export function useChatInactivity({
  numaChatDynamoUtils,
  sub,
  buttonStatus,
  isProcessingRef,
  onExpired,
  inputMessage,
  storageKeySuffix = '',
  excludeWorkspaceConversations = false,
  hasUserStartedNewChat = false,
}: UseChatInactivityArgs) {
  const [showContinueSuggestions, setShowContinueSuggestions] = useState(false);
  const [recentConversations, setRecentConversations] = useState<ConversationMeta[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const newChatActiveRef = useRef(false);
  const buttonStatusRef = useRef(buttonStatus);
  buttonStatusRef.current = buttonStatus;

  const INACTIVITY_KEY = `numa_chat_lastInteraction${storageKeySuffix}`;
  const INACTIVITY_MS = 20 * 60 * 1000; // 20 minutes

  const activateNewChatView = () => {
    newChatActiveRef.current = true;
    setShowContinueSuggestions(true);
  };

  const deactivateNewChatView = () => {
    newChatActiveRef.current = false;
  };

  const resetInactivityTimer = () => {
    try {
      localStorage.setItem(INACTIVITY_KEY, Date.now().toString());
    } catch (e) {
      console.warn('Failed to set inactivity timer:', e);
    }
    deactivateNewChatView();
  };

  /** Stamp the inactivity timer without deactivating the new-chat view.
   *  Call this on user activity (e.g. typing) to prevent the inactivity handler
   *  from firing while the user is actively composing a message. */
  const touchInactivityTimer = useCallback(() => {
    try {
      localStorage.setItem(INACTIVITY_KEY, Date.now().toString());
    } catch {
      // best-effort
    }
  }, [INACTIVITY_KEY]);

  const hideSuggestions = () => {
    setShowContinueSuggestions(false);
    deactivateNewChatView();
  };

  const hasInactivityExpired = (): boolean => {
    try {
      const last = Number(localStorage.getItem(INACTIVITY_KEY) || 0);
      if (!last) return true; // First visit => treat as expired to start fresh chat
      return Date.now() - last >= INACTIVITY_MS;
    } catch (e) {
      console.warn('Failed to read inactivity timer:', e);
      return true;
    }
  };

  const fetchRecentConversations = async (signal?: AbortSignal): Promise<ConversationMeta[]> => {
    if (!numaChatDynamoUtils || !sub) return [] as ConversationMeta[];
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1500;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const items = await numaChatDynamoUtils.getUserConversationsMeta(sub);
        return items as ConversationMeta[];
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1.5s, 3s, 6s
          console.warn(
            `Fetch recent conversations failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`,
            error
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (signal?.aborted) return [] as ConversationMeta[];
        } else {
          console.error(`All ${MAX_RETRIES + 1} attempts to fetch recent conversations failed:`, error);
          return [] as ConversationMeta[];
        }
      }
    }
    return [] as ConversationMeta[];
  };

  const showSuggestionsIfAvailable = async (forceShow = false, signal?: AbortSignal) => {
    setSuggestionsLoading(true);
    try {
      let items = await fetchRecentConversations(signal);
      // If the effect was torn down while we were fetching, discard the stale result
      if (signal?.aborted) return;
      // Filter out workspace conversations if excludeWorkspaceConversations is true (for V1 chat)
      if (excludeWorkspaceConversations) {
        items = items.filter((item) => !item.isWorkspaceConversation);
      }
      setRecentConversations(items.slice(0, 10));
      if (!forceShow) {
        const shouldShow = items.length > 0;
        setShowContinueSuggestions(shouldShow);
        if (shouldShow) {
          newChatActiveRef.current = true;
        } else {
          deactivateNewChatView();
        }
      }
    } finally {
      if (!signal?.aborted) {
        setSuggestionsLoading(false);
      }
    }
  };

  // Check inactivity on mount/focus/visibility and periodic polling
  useEffect(() => {
    // Wait until we have the user's identity and Dynamo helpers before running inactivity logic.
    // Otherwise we can mark the timer as "fresh" too early and skip the real new-chat flow
    // once the auth context finishes loading.
    if (!sub || !numaChatDynamoUtils) {
      return;
    }

    // AbortController cancels stale in-flight fetches when this effect tears down
    // (e.g. when numaChatDynamoUtils changes on token refresh), preventing a stale
    // response from overwriting fresh state.
    const abortController = new AbortController();
    const { signal } = abortController;

    const checkAndMaybeReset = async () => {
      // Skip if we've already activated new chat view AND inactivity hasn't expired again.
      // This allows re-triggering if the user returns after another inactivity period
      // (e.g. tab left open overnight, first reset fires at 20min, user returns 8hrs later).
      if (newChatActiveRef.current && !hasInactivityExpired()) {
        return;
      }

      if (hasInactivityExpired() && buttonStatusRef.current === 'idle' && !isProcessingRef.current) {
        activateNewChatView();
        // Stamp the timer so this handler doesn't re-fire every 30s while the user is typing.
        // It will re-trigger after another INACTIVITY_MS period (e.g. user returns hours later).
        try {
          localStorage.setItem(INACTIVITY_KEY, Date.now().toString());
        } catch {
          // best-effort; ignore storage failures
        }
        try {
          await onExpired();
        } catch (error) {
          console.warn('Error running inactivity expiration handler:', error);
        }
        if (signal.aborted) return;
        try {
          await showSuggestionsIfAvailable(true, signal);
        } catch (error) {
          console.warn('Failed to refresh recent conversations after inactivity expiration:', error);
        }
      }
    };

    // Initial check on mount
    checkAndMaybeReset();

    // Check on window focus
    const onFocus = () => {
      checkAndMaybeReset();
    };
    window.addEventListener('focus', onFocus);

    // Check when tab becomes visible again (handles frozen/discarded tabs returning)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAndMaybeReset();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Periodic check every 30s
    const interval = setInterval(checkAndMaybeReset, 30000);

    return () => {
      abortController.abort();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
    // buttonStatus is read via buttonStatusRef to avoid effect teardown on every status change.
  }, [numaChatDynamoUtils, sub]);

  // Catch-up fetch: if the new chat view is showing (e.g. useConversationManager detected
  // stale inactivity and called handleNewChat) but recent conversations haven't been populated
  // yet, fetch them now. This handles the race where useConversationManager shows the new chat
  // view before useChatInactivity's effect can populate recent conversations.
  const catchUpFetchedRef = useRef(false);
  useEffect(() => {
    if (
      hasUserStartedNewChat &&
      recentConversations.length === 0 &&
      !suggestionsLoading &&
      numaChatDynamoUtils &&
      sub &&
      !catchUpFetchedRef.current
    ) {
      catchUpFetchedRef.current = true;
      showSuggestionsIfAvailable(true).catch((error) => {
        console.warn('Failed to fetch recent conversations on catch-up:', error);
      });
    }
    // Reset the catch-up flag when new chat is deactivated so it can fire again next time
    if (!hasUserStartedNewChat) {
      catchUpFetchedRef.current = false;
    }
  }, [hasUserStartedNewChat, recentConversations.length, suggestionsLoading, numaChatDynamoUtils, sub]);

  const forceShowNewChatView = () => {
    activateNewChatView();
    showSuggestionsIfAvailable(true).catch((error) => {
      console.warn('Failed to refresh recent conversations for new chat view:', error);
    });
  };

  // Hide suggestions as soon as user starts typing
  useEffect(() => {
    if (inputMessage && inputMessage.trim().length > 0 && showContinueSuggestions) {
      setShowContinueSuggestions(false);
    }
  }, [inputMessage, showContinueSuggestions]);

  return {
    showContinueSuggestions,
    recentConversations,
    resetInactivityTimer,
    touchInactivityTimer,
    hideSuggestions,
    forceShowNewChatView,
    suggestionsLoading,
  } as const;
}
