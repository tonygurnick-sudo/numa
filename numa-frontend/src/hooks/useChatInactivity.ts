import { useEffect, useRef, useState } from 'react';

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
};

type UseChatInactivityArgs = {
  numaChatDynamoUtils: { getUserConversationsMeta: (userId: string) => Promise<ConversationMeta[]> } | null;
  sub: string;
  buttonStatus: string;
  isProcessingRef: React.MutableRefObject<boolean>;
  onExpired: () => Promise<void> | void; // called when inactivity expires to start new chat
  inputMessage?: string; // optional: if provided, suggestions will hide on non-empty
};

export function useChatInactivity({
  numaChatDynamoUtils,
  sub,
  buttonStatus,
  isProcessingRef,
  onExpired,
  inputMessage,
}: UseChatInactivityArgs) {
  const [showContinueSuggestions, setShowContinueSuggestions] = useState(false);
  const [recentConversations, setRecentConversations] = useState<ConversationMeta[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const newChatActiveRef = useRef(false);

  const INACTIVITY_KEY = 'numa_chat_lastInteraction';
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

  const fetchRecentConversations = async (): Promise<ConversationMeta[]> => {
    if (!numaChatDynamoUtils || !sub) return [] as ConversationMeta[];
    try {
      const items = await numaChatDynamoUtils.getUserConversationsMeta(sub);
      return items as ConversationMeta[];
    } catch (e) {
      console.error('Failed to fetch recent conversations:', e);
      return [] as ConversationMeta[];
    }
  };

  const showSuggestionsIfAvailable = async (forceShow = false) => {
    setSuggestionsLoading(true);
    try {
      const items = await fetchRecentConversations();
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
      setSuggestionsLoading(false);
    }
  };

  // Check inactivity on mount/focus and periodic polling
  useEffect(() => {
    // Wait until we have the user's identity and Dynamo helpers before running inactivity logic.
    // Otherwise we can mark the timer as "fresh" too early and skip the real new-chat flow
    // once the auth context finishes loading.
    if (!sub || !numaChatDynamoUtils) {
      return;
    }

    const checkAndMaybeReset = async () => {
      if (newChatActiveRef.current) {
        return;
      }

      if (hasInactivityExpired() && buttonStatus === 'idle' && !isProcessingRef.current) {
        activateNewChatView();
        try {
          await onExpired();
        } catch (error) {
          console.warn('Error running inactivity expiration handler:', error);
        }
        try {
          await showSuggestionsIfAvailable(true);
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

    // Periodic check every 30s
    const interval = setInterval(checkAndMaybeReset, 30000);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [buttonStatus, numaChatDynamoUtils, sub]);

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
    hideSuggestions,
    forceShowNewChatView,
    suggestionsLoading,
  } as const;
}
