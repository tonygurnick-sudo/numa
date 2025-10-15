import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../Providers/AuthProvider';

/**
 * Hook for managing conversation state, loading, and creation
 * Extracted from NumaChat.jsx to improve maintainability
 */
export const useConversationManager = () => {
  const [conversationId, setConversationId] = useState(null);
  const [isConversationLoading, setIsConversationLoading] = useState(true);
  const [hasUserStartedNewChat, setHasUserStartedNewChat] = useState(false);

  const { numaChatDynamoUtils, user } = useAuth();

  // Extract user info from token
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub;

  /**
   * Reset the user new chat flag when explicitly loading a conversation
   */
  const resetUserNewChatFlag = useCallback(() => {
    hasUserStartedNewChatRef.current = false;
    setHasUserStartedNewChat(false);
  }, []);

  /**
   * Create a new conversation if needed
   */
  const pendingConversationIdRef = useRef<string | null>(null);
  const creationPromisesRef = useRef<Map<string, Promise<string>>>(new Map());
  const createdConversationIdsRef = useRef<Set<string>>(new Set());
  const hasUserStartedNewChatRef = useRef<boolean>(hasUserStartedNewChat);

  useEffect(() => {
    hasUserStartedNewChatRef.current = hasUserStartedNewChat;
  }, [hasUserStartedNewChat]);

  const ensureConversationReady = useCallback(
    async (initialText = '') => {
      if (!numaChatDynamoUtils) {
        throw new Error('Dynamo utilities unavailable');
      }

      // Existing conversation that has already been persisted
      if (conversationId && !hasUserStartedNewChat) {
        return conversationId;
      }

      // Use existing pending ID or create a fresh one
      let targetId = conversationId || pendingConversationIdRef.current;
      if (!targetId) {
        targetId = `${sub || 'anonymous'}_${Date.now()}`;
        pendingConversationIdRef.current = targetId;
        setConversationId(targetId);
        localStorage.setItem('currentConversationId', targetId);
      }

      if (createdConversationIdsRef.current.has(targetId)) {
        return targetId;
      }

      const existingPromise = creationPromisesRef.current.get(targetId);
      if (existingPromise) {
        return existingPromise;
      }

      const defaultName =
        initialText && initialText.trim().length > 0
          ? initialText.trim().length > 60
            ? `${initialText.trim().slice(0, 57)}...`
            : initialText.trim()
          : 'Untitled Chat';

      const creationPromise = (async () => {
        try {
          await numaChatDynamoUtils.addMessage({
            conversationId: targetId,
            userId: sub,
            messageType: 'meta',
            role: 'user',
            conversationName: defaultName,
            content: 'New conversation started',
          });

          await numaChatDynamoUtils.addMessage({
            conversationId: targetId,
            userId: sub,
            messageType: 'text',
            role: 'assistant',
            content: 'How can I help you today?',
          });

          createdConversationIdsRef.current.add(targetId);
          pendingConversationIdRef.current = null;
          return targetId;
        } finally {
          creationPromisesRef.current.delete(targetId);
        }
      })();

      creationPromisesRef.current.set(targetId, creationPromise);
      return creationPromise;
    },
    [conversationId, hasUserStartedNewChat, numaChatDynamoUtils, setConversationId, sub],
  );

  /**
   * Create a new conversation and reset state
   */
  const handleNewChat = useCallback(async () => {
    setIsConversationLoading(false);
    setConversationId(null);
    setHasUserStartedNewChat(true);
    hasUserStartedNewChatRef.current = true;
    localStorage.removeItem('currentConversationId');
    pendingConversationIdRef.current = null;
    creationPromisesRef.current.clear();

    // Reset conversation ID first; ensureConversationReady will handle persistence when needed
    return null;
  }, []);

  /**
   * Initialize conversation on component mount
   */
  useEffect(() => {
    let cancelled = false;

    async function initializeConversation() {
      if (!numaChatDynamoUtils || !sub || hasUserStartedNewChatRef.current) {
        return;
      }

      try {
        const metaItems = await numaChatDynamoUtils.getUserConversationsMeta(sub);
        if (cancelled || hasUserStartedNewChatRef.current) {
          return;
        }

        if (metaItems.length === 0) {
          console.log('No conversation history found; initializing new conversation...');
          handleNewChat();
          return;
        }

        const savedConvoId = localStorage.getItem('currentConversationId');
        if (savedConvoId && metaItems.some((item) => item.conversation_id === savedConvoId)) {
          console.log('Loading saved conversation:', savedConvoId);
          setConversationId(savedConvoId);
        } else {
          console.log('Loading the most recent conversation from history.');
          setConversationId(metaItems[0].conversation_id);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error initializing conversation:', err);
        }
      }
    }

    initializeConversation();

    return () => {
      cancelled = true;
    };
  }, [numaChatDynamoUtils, sub, handleNewChat]);

  return {
    conversationId,
    setConversationId,
    isConversationLoading,
    setIsConversationLoading,
    ensureConversationReady,
    handleNewChat,
    resetUserNewChatFlag,
    hasUserStartedNewChat,
  };
};
