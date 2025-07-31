import { useState, useEffect, useCallback } from 'react';
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
    setHasUserStartedNewChat(false);
  }, []);

  /**
   * Create a new conversation if needed
   */
  const createNewConversationIfNeeded = useCallback(
    async (initialText = '') => {
      if (conversationId && !hasUserStartedNewChat) return conversationId; // Already have one, but only if not in new chat mode

      const newId = `${sub || 'anonymous'}_${Date.now()}`;
      setConversationId(newId);
      localStorage.setItem('currentConversationId', newId);

      // Create a meta item in Dynamo
      if (numaChatDynamoUtils) {
        const defaultName = initialText.length > 60 ? initialText.slice(0, 57) + '...' : initialText || 'Untitled Chat';
        await numaChatDynamoUtils.addMessage({
          conversationId: newId,
          userId: sub,
          messageType: 'meta',
          role: 'user',
          conversationName: defaultName,
          content: 'New conversation started',
        });

        await numaChatDynamoUtils.addMessage({
          conversationId: newId,
          userId: sub,
          messageType: 'text',
          role: 'assistant',
          content: 'How can I help you today?',
        });
      }

      return newId;
    },
    [conversationId, sub, numaChatDynamoUtils, hasUserStartedNewChat],
  );

  /**
   * Create a new conversation and reset state
   */
  const handleNewChat = useCallback(async () => {
    setIsConversationLoading(false);
    setConversationId(null);
    setHasUserStartedNewChat(true);
    localStorage.removeItem('currentConversationId');

    // Reset conversation ID first, then create new one will be handled by createNewConversationIfNeeded
    return null;
  }, []);

  /**
   * Initialize conversation on component mount
   */
  useEffect(() => {
    async function initializeConversation() {
      if (numaChatDynamoUtils && sub && !hasUserStartedNewChat) {
        try {
          // Fetch the conversation meta items for this user
          const metaItems = await numaChatDynamoUtils.getUserConversationsMeta(sub);
          if (metaItems.length === 0) {
            // No conversation exists, so simulate "New Chat"
            console.log('No conversation history found; initializing new conversation...');
            handleNewChat();
          } else {
            // If there is a saved conversation and it exists in the meta, load it.
            const savedConvoId = localStorage.getItem('currentConversationId');
            if (savedConvoId && metaItems.some((item) => item.conversation_id === savedConvoId)) {
              setConversationId(savedConvoId);
            } else {
              // Otherwise, load the most recent conversation (or choose one as needed)
              console.log('Loading the most recent conversation from history.');
              setConversationId(metaItems[0].conversation_id);
            }
          }
        } catch (err) {
          console.error('Error initializing conversation:', err);
        }
      }
    }
    initializeConversation();
  }, [numaChatDynamoUtils, sub, handleNewChat, hasUserStartedNewChat]);

  return {
    conversationId,
    setConversationId,
    isConversationLoading,
    setIsConversationLoading,
    createNewConversationIfNeeded,
    handleNewChat,
    resetUserNewChatFlag,
    hasUserStartedNewChat,
  };
};
