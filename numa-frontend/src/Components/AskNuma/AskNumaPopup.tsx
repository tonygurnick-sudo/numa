import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OverlayTrigger, Tooltip, Spinner } from 'react-bootstrap';
import { Paperclip, Send, X, Info } from 'lucide-react';
import { useAuth } from '../../Providers/AuthProvider';
import { usePageContext } from './usePageContext';
import { PendingFilesBar } from '../Chat/PendingFilesBar';
import { WorkspaceChatFileUpload } from '../WorkspaceChat/WorkspaceChatFileUpload';
import { uploadWorkspaceChatFileDirect } from '../../Services/workspaceChatAgentService';
import { saveStagedItems, flattenStagedItems, groupFilesIntoFolders } from '../../utils/workspaceChatStagedUploads';
import type {
  StagedItem,
  StagedFile,
  UploadingFile,
  WorkspaceChatUploadResponse,
} from '../../types/workspaceChatTypes';

const PAGE_CONTEXT_KEY = 'numa_ask_numa_page_context';

interface AskNumaPopupProps {
  onClose: () => void;
}

/**
 * Lightweight chat popup for the Ask Numa FAB.
 * Creates a FRESH conversation every time and navigates to /chat on send.
 *
 * Important: Does NOT use useConversationManager to avoid inheriting an
 * existing conversation from sessionStorage. Instead, mints its own
 * conversation ID and writes meta directly to DynamoDB.
 */
export function AskNumaPopup({ onClose }: AskNumaPopupProps) {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const { numaChatDynamoUtils, getCredentials, user } = useAuth();
  const sub = user?.decoded_tokens?.idToken?.sub;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { captureContext, isCapturing } = usePageContext();

  // State
  const [inputMessage, setInputMessage] = useState('');
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const [uploadingFiles] = useState<UploadingFile[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [includePageContext, setIncludePageContext] = useState(() => {
    try {
      const stored = localStorage.getItem(PAGE_CONTEXT_KEY);
      return stored !== null ? stored === 'true' : true; // Default ON
    } catch {
      return true;
    }
  });
  const [isSending, setIsSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Persist page context preference
  const togglePageContext = useCallback(() => {
    setIncludePageContext((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PAGE_CONTEXT_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  // Auto-resize textarea
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, []);

  /**
   * Mint a fresh conversation ID and write meta to DynamoDB.
   * Bypasses useConversationManager to guarantee a new conversation every time.
   */
  const mintNewConversation = useCallback(
    async (conversationName: string): Promise<string> => {
      if (!numaChatDynamoUtils || !sub) {
        throw new Error('Auth not ready');
      }

      const cid = `${sub}_${Date.now()}`;

      await numaChatDynamoUtils.addMessage({
        conversationId: cid,
        userId: sub,
        messageType: 'meta',
        role: 'user',
        conversationName: conversationName.length > 60 ? `${conversationName.slice(0, 57)}...` : conversationName,
        content: 'New conversation started',
        isWorkspaceConversation: true,
      } as never);

      // Write the initial assistant greeting
      await numaChatDynamoUtils.addMessage({
        conversationId: cid,
        userId: sub,
        messageType: 'text',
        role: 'assistant',
        content: 'How can I help you today?',
      });

      return cid;
    },
    [numaChatDynamoUtils, sub]
  );

  // Get or create conversation ID (for file uploads before sending)
  const getOrMintConversationId = useCallback(async (): Promise<string> => {
    if (conversationId) return conversationId;
    const cid = await mintNewConversation('File Upload');
    setConversationId(cid);
    return cid;
  }, [conversationId, mintNewConversation]);

  // Handle file upload button click
  const handleUploadClick = useCallback(async () => {
    await getOrMintConversationId();
    setShowUploadModal(true);
  }, [getOrMintConversationId]);

  // Handle file upload complete
  const handleUploadComplete = useCallback(
    async (responses: WorkspaceChatUploadResponse[]) => {
      const newFiles: StagedFile[] = responses.map((r) => ({
        kind: 'file' as const,
        filename: r.filename,
        path: r.path,
        size: r.size,
        uploadedAt: Date.now(),
      }));

      const existingFiles = flattenStagedItems(stagedItems);
      const allFiles = [...existingFiles, ...newFiles];
      const grouped = groupFilesIntoFolders(allFiles);

      setStagedItems(grouped);
      if (conversationId) {
        saveStagedItems(conversationId, grouped);
      }
    },
    [stagedItems, conversationId]
  );

  // Remove staged file
  const handleRemoveStagedItem = useCallback(
    (item: StagedItem) => {
      const updated = stagedItems.filter((i) => i !== item);
      setStagedItems(updated);
      if (conversationId) {
        saveStagedItems(conversationId, updated);
      }
    },
    [stagedItems, conversationId]
  );

  // Upload a blob as a file (for screenshot/HTML context)
  const uploadContextFile = useCallback(
    async (blob: Blob, filename: string, cid: string): Promise<StagedFile | null> => {
      if (!getCredentials) return null;
      try {
        const file = new File([blob], filename, { type: blob.type });
        const response = await uploadWorkspaceChatFileDirect(
          file,
          cid,
          undefined,
          () => {}, // No progress tracking for context files
          getCredentials
        );
        return {
          kind: 'file' as const,
          filename: response.filename,
          path: response.path,
          size: response.size,
          uploadedAt: Date.now(),
        };
      } catch (err) {
        console.warn(`[AskNuma] Failed to upload ${filename}:`, err);
        return null;
      }
    },
    [getCredentials]
  );

  // Send message
  const handleSend = useCallback(async () => {
    const hasMessage = inputMessage.trim().length > 0;
    const hasFiles = stagedItems.length > 0;
    if (!hasMessage && !hasFiles) return;
    if (!numaChatDynamoUtils || !sub) return;

    setIsSending(true);

    try {
      // Use existing pre-minted conversation or create a fresh one
      const cid = conversationId || (await mintNewConversation(inputMessage || 'Ask Numa'));
      setConversationId(cid);

      let finalMessage = inputMessage;
      const contextFiles: StagedFile[] = [];

      // Capture page context if enabled
      if (includePageContext) {
        const { textPrefix, screenshotBlob, htmlContent } = await captureContext();

        // Prepend text context
        if (textPrefix) {
          finalMessage = textPrefix + finalMessage;
        }

        // Upload screenshot as attachment
        if (screenshotBlob) {
          const screenshotFile = await uploadContextFile(screenshotBlob, 'page-screenshot.png', cid);
          if (screenshotFile) contextFiles.push(screenshotFile);
        }

        // Upload HTML as attachment
        if (htmlContent) {
          const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
          const htmlFile = await uploadContextFile(htmlBlob, 'page-context.html', cid);
          if (htmlFile) contextFiles.push(htmlFile);
        }
      }

      // Merge context files with user-staged files
      const allStagedFiles = [...flattenStagedItems(stagedItems), ...contextFiles];
      const allGrouped = groupFilesIntoFolders(allStagedFiles);
      console.log('[AskNuma] Context capture results:', {
        contextFilesCount: contextFiles.length,
        totalStagedCount: allGrouped.length,
        contextFileNames: contextFiles.map((f) => f.filename),
      });
      if (allGrouped.length > 0) {
        saveStagedItems(cid, allGrouped);
        console.log('[AskNuma] Saved staged items to localStorage for conversation:', cid);
      }

      // Write user message to DynamoDB
      await numaChatDynamoUtils.addMessage({
        conversationId: cid,
        userId: sub,
        messageType: 'text',
        role: 'user',
        content: finalMessage,
      });

      // Set sessionStorage for the chat page to pick up this NEW conversation.
      // We also set numa_preselected_agent_token to prevent useConversationManager's
      // init from running the DynamoDB query (which can fail due to eventual consistency
      // on the just-created conversation). The auto-submit effect will clean this up.
      sessionStorage.setItem('currentConversationId-v2', cid);
      sessionStorage.setItem('isWorkspaceConversation-v2', 'true');
      localStorage.setItem('numa_chat_lastInteraction-v2', String(Date.now()));
      sessionStorage.setItem('numa_preselected_agent_token', 'ask-numa');
      sessionStorage.setItem('numa_ask_numa_draft', JSON.stringify({ message: finalMessage, conversationId: cid }));

      // Navigate to chat
      navigate('/chat');
    } catch (err) {
      console.error('[AskNuma] Failed to send:', err);
      setIsSending(false);
    }
  }, [
    inputMessage,
    stagedItems,
    numaChatDynamoUtils,
    sub,
    conversationId,
    mintNewConversation,
    includePageContext,
    captureContext,
    uploadContextFile,
    navigate,
  ]);

  // Handle Enter key (send) and Shift+Enter (newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isSending && !isCapturing) {
          handleSend();
        }
      }
    },
    [handleSend, isSending, isCapturing]
  );

  const isBusy = isSending || isCapturing;
  const canSend = (inputMessage.trim().length > 0 || stagedItems.length > 0) && !isBusy;

  return (
    <>
      <div className="ask-numa-popup">
        {/* Header */}
        <div className="ask-numa-popup-header">
          <h6 className="ask-numa-popup-title">{t('askNuma.popupTitle')}</h6>
          <button className="ask-numa-popup-close" onClick={onClose} aria-label={t('askNuma.close')}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="ask-numa-popup-body">
          {(stagedItems.length > 0 || uploadingFiles.length > 0) && (
            <PendingFilesBar
              items={stagedItems}
              onRemove={handleRemoveStagedItem}
              uploadingFiles={uploadingFiles}
              maxVisible={3}
            />
          )}
          <textarea
            ref={textareaRef}
            className="ask-numa-textarea"
            placeholder={t('askNuma.placeholder')}
            value={inputMessage}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            rows={3}
          />
        </div>

        {/* Footer */}
        <div className="ask-numa-popup-footer">
          <div className="ask-numa-footer-left">
            <button
              className="ask-numa-upload-btn"
              onClick={handleUploadClick}
              disabled={isBusy}
              aria-label={t('chat:input.aria.upload')}
            >
              <Paperclip size={16} />
            </button>

            <div className="ask-numa-context-toggle">
              <input
                type="checkbox"
                className="form-check-input"
                id="ask-numa-context"
                checked={includePageContext}
                onChange={togglePageContext}
                disabled={isBusy}
              />
              <label className="ask-numa-context-label" htmlFor="ask-numa-context">
                {t('askNuma.includePageContext')}
              </label>
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip id="ask-numa-context-tooltip">{t('askNuma.pageContextTooltip')}</Tooltip>}
              >
                <span className="ask-numa-context-info">
                  <Info size={10} />
                </span>
              </OverlayTrigger>
            </div>
          </div>

          <div className="ask-numa-footer-right">
            {isBusy && (
              <span className="text-muted" style={{ fontSize: '12px' }}>
                {isCapturing ? t('askNuma.capturingContext') : t('askNuma.sending')}
              </span>
            )}
            <button
              className="ask-numa-send-btn"
              onClick={handleSend}
              disabled={!canSend}
              aria-label={t('askNuma.send')}
            >
              {isBusy ? <Spinner size="sm" animation="border" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* File upload modal */}
      {conversationId && (
        <WorkspaceChatFileUpload
          show={showUploadModal}
          onHide={() => setShowUploadModal(false)}
          conversationId={conversationId}
          onUploadComplete={handleUploadComplete}
          getCredentials={getCredentials}
        />
      )}
    </>
  );
}

export default AskNumaPopup;
