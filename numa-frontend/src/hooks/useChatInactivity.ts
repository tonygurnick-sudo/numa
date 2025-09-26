import { useEffect, useState } from 'react';

export type ConversationMeta = {
  conversation_id: string;
  conversationName?: string | null;
  latestTimestamp: number;
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

  const INACTIVITY_KEY = 'numa_chat_lastInteraction';
  const INACTIVITY_MS = 20 * 60 * 1000; // 20 minutes

  const resetInactivityTimer = () => {
    try {
      localStorage.setItem(INACTIVITY_KEY, Date.now().toString());
    } catch (e) {
      console.warn('Failed to set inactivity timer:', e);
    }
  };

  const hideSuggestions = () => setShowContinueSuggestions(false);

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

  const showSuggestionsIfAvailable = async () => {
    const items = await fetchRecentConversations();
    setRecentConversations(items.slice(0, 3));
    setShowContinueSuggestions(items.length > 0);
  };

  // Check inactivity on mount/focus and periodic polling
  useEffect(() => {
    const checkAndMaybeReset = async () => {
      if (hasInactivityExpired() && buttonStatus === 'idle' && !isProcessingRef.current) {
        await onExpired();
        await showSuggestionsIfAvailable();
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
  } as const;
}
