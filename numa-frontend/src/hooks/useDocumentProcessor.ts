import { useState, useCallback, useMemo } from 'react';
import { extractSingleDocBlock } from '../utils/streamingProcessors';

/**
 * Hook for managing inline document processing and split view state
 * Extracted from NumaChat.jsx to improve maintainability
 */
export const useDocumentProcessor = () => {
  // Document state
  const [inlineDocument, setInlineDocument] = useState(null);
  const [showSplitView, setShowSplitView] = useState(false);
  const [leftFraction, setLeftFraction] = useState(0.99);

  /**
   * Process accumulated response for document extraction
   */
  const processDocumentFromResponse = useCallback((accumulatedResponse) => {
    const docBlock = extractSingleDocBlock(accumulatedResponse);
    if (docBlock) {
      setInlineDocument({ title: docBlock.docTitle, content: docBlock.docContent });
      return docBlock;
    }
    return null;
  }, []);

  /**
   * Open document in split view
   */
  const openDocument = useCallback((docTitle, docContent) => {
    setLeftFraction(0.45);
    setInlineDocument({ title: docTitle, content: docContent });
    setShowSplitView(true);
  }, []);

  /**
   * Close document and reset split view
   */
  const closeDocument = useCallback(() => {
    setShowSplitView(false);
    setLeftFraction(0.99);
    setInlineDocument(null);
  }, []);

  /**
   * Update document metadata on a message
   */
  const updateMessageWithDocument = useCallback((setMessages, docBlock) => {
    if (!docBlock) return;

    // Attach doc to the last assistant message
    setMessages((prev) => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
        updated[lastIdx].docTitle = docBlock.docTitle;
        updated[lastIdx].docContent = docBlock.docContent;
      }
      return updated;
    });
  }, []);

  /**
   * Save document metadata to DynamoDB
   */
  const saveDocumentMetadata = useCallback(async (docBlock, numaChatDynamoUtils, conversationId, sub) => {
    if (!docBlock || !numaChatDynamoUtils || !conversationId || !sub) return;

    try {
      await numaChatDynamoUtils.addMessage({
        conversationId,
        userId: sub,
        messageType: 'document_metadata',
        role: 'assistant',
        content: JSON.stringify({
          docTitle: docBlock.docTitle,
          docContent: docBlock.docContent,
        }),
      });
    } catch (err) {
      console.error('Error saving document metadata:', err);
    }
  }, []);

  /**
   * Complete document processing workflow
   */
  const completeDocumentProcessing = useCallback(
    async ({ accumulatedResponse, setMessages, numaChatDynamoUtils, conversationId, sub }) => {
      const docBlock = processDocumentFromResponse(accumulatedResponse);
      if (docBlock) {
        updateMessageWithDocument(setMessages, docBlock);
        await saveDocumentMetadata(docBlock, numaChatDynamoUtils, conversationId, sub);
      }
      return docBlock;
    },
    [processDocumentFromResponse, updateMessageWithDocument, saveDocumentMetadata]
  );

  // Memoized so consumers can safely use the hook's return value as a dependency (BUG-194)
  return useMemo(
    () => ({
      // Document state
      inlineDocument,
      showSplitView,
      leftFraction,

      // Document state setters (for external control if needed)
      setInlineDocument,
      setShowSplitView,
      setLeftFraction,

      // Document processing functions
      processDocumentFromResponse,
      openDocument,
      closeDocument,
      updateMessageWithDocument,
      saveDocumentMetadata,
      completeDocumentProcessing,
    }),
    [
      inlineDocument,
      showSplitView,
      leftFraction,
      processDocumentFromResponse,
      openDocument,
      closeDocument,
      updateMessageWithDocument,
      saveDocumentMetadata,
      completeDocumentProcessing,
    ]
  );
};
