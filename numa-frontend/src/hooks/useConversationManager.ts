import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../Providers/AuthProvider';

/**
 * Hook for managing conversation state, loading, and creation
 * Extracted from NumaChat.jsx to improve maintainability
 */
export type AgentMeta = {
  agentId: string;
  title: string;
  version?: number;
  icon?: string;
  agentType?: string;
  visibility?: string;
};

const getHasPreselectedAgent = () => {
  try {
    if (typeof window === 'undefined') {
      return false;
    }
    const hasAgent = window.sessionStorage.getItem('numa_preselected_agent') !== null;
    const hasToken = window.sessionStorage.getItem('numa_preselected_agent_token') !== null;
    return hasAgent || hasToken;
  } catch (error) {
    console.warn('Unable to read preselected agent from sessionStorage:', error);
    return false;
  }
};

type UseConversationManagerOptions = {
  /** Optional suffix to isolate sessionStorage keys (e.g., '-v2' for workspace mode) */
  storageKeySuffix?: string;
  /** If true, conversations created will be marked as workspace conversations (for V2 chat) */
  isWorkspaceMode?: boolean;
};

export const useConversationManager = (options: UseConversationManagerOptions = {}) => {
  const { storageKeySuffix = '', isWorkspaceMode = false } = options;
  const storageKey = `currentConversationId${storageKeySuffix}`;
  const workspaceStorageKey = `isWorkspaceConversation${storageKeySuffix}`;

  const [conversationId, setConversationId] = useState(null);
  const [isConversationLoading, setIsConversationLoading] = useState(true);
  const [hasUserStartedNewChat, setHasUserStartedNewChat] = useState<boolean>(() => getHasPreselectedAgent());

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

  const pendingConversationIdRef = useRef<string | null>(null);
  const creationPromisesRef = useRef<Map<string, Promise<string>>>(new Map());
  const createdConversationIdsRef = useRef<Set<string>>(new Set());
  const hasUserStartedNewChatRef = useRef<boolean>(hasUserStartedNewChat);

  useEffect(() => {
    hasUserStartedNewChatRef.current = hasUserStartedNewChat;
  }, [hasUserStartedNewChat]);

  // If a preselected agent/new chat is indicated, stop showing the loading spinner
  useEffect(() => {
    if (hasUserStartedNewChat) {
      setIsConversationLoading(false);
    }
  }, [hasUserStartedNewChat]);

  const ensureConversationReady = useCallback(
    async (initialText = '', agentInfo?: AgentMeta | null) => {
      if (!numaChatDynamoUtils) {
        throw new Error('Dynamo utilities unavailable');
      }

      if (conversationId && !hasUserStartedNewChatRef.current) {
        return conversationId;
      }

      let targetId = conversationId || pendingConversationIdRef.current;
      if (!targetId) {
        targetId = `${sub || 'anonymous'}_${Date.now()}`;
        pendingConversationIdRef.current = targetId;
        setConversationId(targetId);
        sessionStorage.setItem(storageKey, targetId);
        // Store whether this is a workspace conversation for auto-load on page refresh
        sessionStorage.setItem(workspaceStorageKey, isWorkspaceMode ? 'true' : 'false');
      }

      if (createdConversationIdsRef.current.has(targetId)) {
        return targetId;
      }

      const existingPromise = creationPromisesRef.current.get(targetId);
      if (existingPromise) {
        return existingPromise;
      }

      const defaultName =
        agentInfo?.title && agentInfo.title.trim().length > 0
          ? agentInfo.title.trim()
          : initialText && initialText.trim().length > 0
            ? initialText.trim().length > 60
              ? `${initialText.trim().slice(0, 57)}...`
              : initialText.trim()
            : 'Untitled Chat';

      const creationPromise = (async () => {
        try {
          // Use the isWorkspaceMode option passed by the calling component
          // V1 chat passes false, V2 chat passes true
          const metaPayload: Record<string, unknown> = {
            conversationId: targetId,
            userId: sub,
            messageType: 'meta',
            role: 'user',
            conversationName: defaultName,
            content: 'New conversation started',
            isWorkspaceConversation: isWorkspaceMode,
          };

          if (agentInfo) {
            metaPayload.agentId = agentInfo.agentId;
            metaPayload.agentTitle = agentInfo.title;
            metaPayload.agentVersion = agentInfo.version ?? Date.now();
            metaPayload.agentIcon = agentInfo.icon;
            metaPayload.agentType = agentInfo.agentType;
            metaPayload.agentVisibility = agentInfo.visibility;
            metaPayload.isAgentConversation = true;
          }

          console.log('[DEBUG] Creating conversation meta record:', {
            conversationId: targetId,
            isWorkspaceMode,
            userId: sub,
          });

          await numaChatDynamoUtils.addMessage(metaPayload as never);

          console.log('[DEBUG] Meta record created successfully for conversation:', targetId);

          if (!agentInfo) {
            await numaChatDynamoUtils.addMessage({
              conversationId: targetId,
              userId: sub,
              messageType: 'text',
              role: 'assistant',
              content: 'How can I help you today?',
            });
          }

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
    [
      conversationId,
      hasUserStartedNewChat,
      numaChatDynamoUtils,
      setConversationId,
      sub,
      storageKey,
      workspaceStorageKey,
      isWorkspaceMode,
    ]
  );

  /**
   * Create a new conversation and reset state
   */
  const handleNewChat = useCallback(async () => {
    setIsConversationLoading(false);
    setConversationId(null);
    setHasUserStartedNewChat(true);
    hasUserStartedNewChatRef.current = true;
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(workspaceStorageKey);
    pendingConversationIdRef.current = null;
    creationPromisesRef.current.clear();

    // Reset conversation ID first; ensureConversationReady will handle persistence when needed
    return null;
  }, [storageKey, workspaceStorageKey]);

  /**
   * Initialize conversation on component mount
   */
  useEffect(() => {
    let cancelled = false;

    async function initializeConversation() {
      if (!numaChatDynamoUtils || !sub || hasUserStartedNewChatRef.current) {
        return;
      }

      // Check if there's a preselected agent or token - if so, don't load previous conversation
      const preselectedAgent = sessionStorage.getItem('numa_preselected_agent');
      const preselectedToken = sessionStorage.getItem('numa_preselected_agent_token');
      if (preselectedAgent || preselectedToken) {
        return;
      }

      try {
        const metaItems = await numaChatDynamoUtils.getUserConversationsMeta(sub);
        if (cancelled || hasUserStartedNewChatRef.current) {
          return;
        }

        if (metaItems.length === 0) {
          handleNewChat();
          return;
        }

        // Check if inactivity has expired before restoring a previous conversation.
        // This prevents a race where useConversationManager sets conversationId from
        // sessionStorage (triggering auto-load) before useChatInactivity can expire it.
        const inactivityKey = `numa_chat_lastInteraction${storageKeySuffix}`;
        const INACTIVITY_MS = 20 * 60 * 1000; // 20 minutes — must match useChatInactivity
        const lastInteraction = Number(localStorage.getItem(inactivityKey) || 0);
        const isStale = !lastInteraction || Date.now() - lastInteraction >= INACTIVITY_MS;

        if (isStale) {
          handleNewChat();
          return;
        }

        const savedConvoId = sessionStorage.getItem(storageKey);
        const savedConvo = metaItems.find((item) => item.conversation_id === savedConvoId);
        if (savedConvoId && savedConvo) {
          setConversationId(savedConvoId);
          // Update sessionStorage with workspace status from metadata
          sessionStorage.setItem(workspaceStorageKey, savedConvo.isWorkspaceConversation === false ? 'false' : 'true');
        } else {
          setConversationId(metaItems[0].conversation_id);
          // Update sessionStorage with workspace status from first conversation
          sessionStorage.setItem(
            workspaceStorageKey,
            metaItems[0].isWorkspaceConversation === false ? 'false' : 'true'
          );
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
  }, [numaChatDynamoUtils, sub, handleNewChat, storageKey, workspaceStorageKey]);

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
