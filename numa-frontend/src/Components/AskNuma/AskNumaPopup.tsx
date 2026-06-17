import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OverlayTrigger, Tooltip, Spinner } from 'react-bootstrap';
import { Paperclip, Send, X, Info, Check } from 'lucide-react';
import { useAuth } from '../../Providers/AuthProvider';
import { usePageContext } from './usePageContext';
import { PendingFilesBar } from '../Chat/PendingFilesBar';
import { WorkspaceChatFileUpload } from '../WorkspaceChat/WorkspaceChatFileUpload';
import { uploadWorkspaceChatFileDirect } from '../../Services/workspaceChatAgentService';
import { saveStagedItems, flattenStagedItems, groupFilesIntoFolders } from '../../utils/workspaceChatStagedUploads';
import {
  ASK_NUMA_PRESELECT_TOKEN,
  ASK_NUMA_NEW_TAB_PARAM,
  CONVERSATION_AGENT_TYPE_KEY_PREFIX,
  newTabDraftKey,
} from './askNumaHandoff';
import type {
  StagedItem,
  StagedFile,
  UploadingFile,
  WorkspaceChatUploadResponse,
} from '../../types/workspaceChatTypes';

const PAGE_CONTEXT_KEY = 'numa_ask_numa_page_context';

/** Phases surfaced to the user while a message is being sent. */
type SendPhase = 'idle' | 'preparing' | 'capturing' | 'opening' | 'opened';

export interface AskNumaContextFile {
  filename: string;
  blob: Blob;
}

interface AskNumaPopupProps {
  onClose: () => void;
  /**
   * Extra class(es) on the popup panel. Used by the Support popup to anchor
   * next to the nav sidebar (bottom-left) instead of the default bottom-right
   * placement next to the Ask Numa FAB.
   */
  className?: string;
  /** Popup header title. Defaults to the Ask Numa title. */
  title?: string;
  /** Textarea placeholder. Defaults to the Ask Numa placeholder. */
  placeholder?: string;
  /** Assistant greeting written to the new conversation. */
  greeting?: string;
  /** Prefix for the conversation name (e.g. "Support: "). */
  conversationNamePrefix?: string;
  /**
   * Workspace agent type for the conversation (e.g. "numa-chat-support").
   * Carried through the draft handoff so the chat page sends it on every
   * turn of the conversation, and stored on the conversation meta record so
   * the pin survives across sessions. Omit for the default numa-chat type.
   */
  agentType?: string;
  /**
   * Display title stored on the conversation meta record (isAgentConversation
   * + agentTitle, deliberately WITHOUT agentId since there is no saved-agent
   * record). Drives the agent badge in history panels and the chat header.
   */
  agentTitle?: string;
  /**
   * Extra context files captured on send and uploaded to the conversation
   * workspace. Always attached — independent of the user-facing page-context
   * toggle (used by the Support popup for the environment report).
   */
  buildExtraContextFiles?: () => Promise<AskNumaContextFile[]>;
  /**
   * Open the conversation in a NEW browser tab on send instead of navigating
   * the current tab. Keeps the user on the page they were working on (used by
   * the Support popup). Falls back to same-tab navigation if the browser
   * blocks the popup.
   */
  openInNewTab?: boolean;
  /**
   * Keep the page-context text out of the visible user message. The page
   * location line is folded into the attached page-context.html (or a small
   * page-context.md) instead of being prepended to the message, so the chat
   * shows only what the user typed while the agent still receives the context.
   */
  hidePageContextPrefix?: boolean;
}

/**
 * Lightweight chat popup for the Ask Numa FAB (and, parameterized, the
 * Support popup — see Components/Support/SupportNumaPopup).
 * Creates a FRESH conversation every time and navigates to /chat on send.
 *
 * Important: Does NOT use useConversationManager to avoid inheriting an
 * existing conversation from sessionStorage. Instead, mints its own
 * conversation ID and writes meta directly to DynamoDB.
 */
export function AskNumaPopup({
  onClose,
  className,
  title,
  placeholder,
  greeting,
  conversationNamePrefix,
  agentType,
  agentTitle,
  buildExtraContextFiles,
  openInNewTab,
  hidePageContextPrefix,
}: AskNumaPopupProps) {
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
  const [sendPhase, setSendPhase] = useState<SendPhase>('idle');
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
    // Clear the "opened in a new tab" confirmation once they start a new question.
    setSendPhase((prev) => (prev === 'opened' ? 'idle' : prev));
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
      const fullName = `${conversationNamePrefix || ''}${conversationName}`;

      await numaChatDynamoUtils.addMessage({
        conversationId: cid,
        userId: sub,
        messageType: 'meta',
        role: 'user',
        conversationName: fullName.length > 60 ? `${fullName.slice(0, 57)}...` : fullName,
        content: 'New conversation started',
        isWorkspaceConversation: true,
        // Typed conversations (e.g. Support) persist their workspace agent
        // type and show an agent-style title badge in history. No agentId —
        // there is no saved-agent record behind an agent type.
        workspaceAgentType: agentType,
        ...(agentTitle ? { isAgentConversation: true, agentTitle } : {}),
      } as never);

      // Write the initial assistant greeting
      await numaChatDynamoUtils.addMessage({
        conversationId: cid,
        userId: sub,
        messageType: 'text',
        role: 'assistant',
        content: greeting || 'How can I help you today?',
      });

      return cid;
    },
    [numaChatDynamoUtils, sub, conversationNamePrefix, greeting, agentType, agentTitle]
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
    setSendPhase('preparing');

    // New-tab flow: open a blank tab SYNCHRONOUSLY inside the click handler so
    // the browser treats it as user-initiated and doesn't block it after the
    // awaits below. We redirect it once the conversation is ready.
    let newTab: Window | null = null;
    if (openInNewTab) {
      newTab = window.open('about:blank', '_blank');
    }

    try {
      // Use existing pre-minted conversation or create a fresh one
      const cid = conversationId || (await mintNewConversation(inputMessage || 'Ask Numa'));
      setConversationId(cid);

      let finalMessage = inputMessage;
      const contextFiles: StagedFile[] = [];

      // Extra context files (e.g. Support environment report) are always
      // attached — they are not covered by the page-context toggle.
      if (buildExtraContextFiles) {
        try {
          const extraFiles = await buildExtraContextFiles();
          for (const { filename, blob } of extraFiles) {
            const uploaded = await uploadContextFile(blob, filename, cid);
            if (uploaded) contextFiles.push(uploaded);
          }
        } catch (err) {
          console.warn('[AskNuma] Extra context capture failed:', err);
        }
      }

      // Capture page context if enabled
      if (includePageContext) {
        setSendPhase('capturing');
        const { textPrefix, screenshotBlob, htmlContent } = await captureContext();

        let htmlForUpload = htmlContent;
        if (hidePageContextPrefix) {
          // Keep the user's message clean: fold the page-context line into the
          // attached HTML snapshot (leading comment) so the agent still gets
          // it, but the chat shows only what the user typed. When there's no
          // HTML to carry it, attach a tiny page-context.md instead.
          if (textPrefix) {
            if (htmlForUpload) {
              htmlForUpload = `<!-- ${textPrefix.trim()} -->\n${htmlForUpload}`;
            } else {
              const ctxBlob = new Blob([textPrefix.trim()], { type: 'text/markdown' });
              const ctxFile = await uploadContextFile(ctxBlob, 'page-context.md', cid);
              if (ctxFile) contextFiles.push(ctxFile);
            }
          }
        } else if (textPrefix) {
          finalMessage = textPrefix + finalMessage;
        }

        // Upload screenshot as attachment
        if (screenshotBlob) {
          const screenshotFile = await uploadContextFile(screenshotBlob, 'page-screenshot.png', cid);
          if (screenshotFile) contextFiles.push(screenshotFile);
        }

        // Upload HTML as attachment
        if (htmlForUpload) {
          const htmlBlob = new Blob([htmlForUpload], { type: 'text/html' });
          const htmlFile = await uploadContextFile(htmlBlob, 'page-context.html', cid);
          if (htmlFile) contextFiles.push(htmlFile);
        }
      }

      // Merge context files with user-staged files
      const allStagedFiles = [...flattenStagedItems(stagedItems), ...contextFiles];
      const allGrouped = groupFilesIntoFolders(allStagedFiles);
      if (allGrouped.length > 0) {
        saveStagedItems(cid, allGrouped);
      }

      // Write user message to DynamoDB
      await numaChatDynamoUtils.addMessage({
        conversationId: cid,
        userId: sub,
        messageType: 'text',
        role: 'user',
        content: finalMessage,
      });

      const draftPayload = JSON.stringify({ message: finalMessage, conversationId: cid, agentType });

      // --- New-tab handoff -------------------------------------------------
      // sessionStorage can't cross tabs, so stash the draft in localStorage
      // (keyed by cid) and pass the cid via the URL. The new tab rehydrates
      // via hydrateAskNumaNewTabHandoff() before it initialises.
      if (openInNewTab && newTab) {
        setSendPhase('opening');
        localStorage.setItem(newTabDraftKey(cid), draftPayload);
        localStorage.setItem('numa_chat_lastInteraction-v2', String(Date.now()));
        newTab.location.href = `/chat?${ASK_NUMA_NEW_TAB_PARAM}=${encodeURIComponent(cid)}`;

        // Leave the user where they were; reset so they can ask again.
        setInputMessage('');
        setStagedItems([]);
        setConversationId(null);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        setIsSending(false);
        setSendPhase('opened');
        return;
      }

      // --- Same-tab handoff (default, or popup-blocked fallback) -----------
      // Set sessionStorage for the chat page to pick up this NEW conversation.
      // We also set numa_preselected_agent_token to prevent useConversationManager's
      // init from running the DynamoDB query (which can fail due to eventual consistency
      // on the just-created conversation). The auto-submit effect will clean this up.
      sessionStorage.setItem('currentConversationId-v2', cid);
      sessionStorage.setItem('isWorkspaceConversation-v2', 'true');
      localStorage.setItem('numa_chat_lastInteraction-v2', String(Date.now()));
      sessionStorage.setItem('numa_preselected_agent_token', ASK_NUMA_PRESELECT_TOKEN);
      // Clear any stale Agents-page launch payload. If one is left over (an
      // agent was selected but never activated in this tab), the chat page's
      // preselect effect would apply that agent OVER this fresh popup
      // conversation — wrong header title and, worse, the stale agent's
      // prompt/agentId on subsequent turns.
      sessionStorage.removeItem('numa_preselected_agent');
      if (agentType) {
        sessionStorage.setItem(`${CONVERSATION_AGENT_TYPE_KEY_PREFIX}${cid}`, agentType);
      }
      sessionStorage.setItem('numa_ask_numa_draft', draftPayload);

      // Navigate to chat. The chat page consumes the draft on mount, so when
      // we are already on /chat (e.g. Support popup opened from the chat page)
      // a SPA navigate would be a no-op — force a full load instead.
      if (window.location.pathname.startsWith('/chat')) {
        window.location.assign('/chat');
      } else {
        navigate('/chat');
      }
    } catch (err) {
      console.error('[AskNuma] Failed to send:', err);
      if (newTab) newTab.close();
      setSendPhase('idle');
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
    agentType,
    buildExtraContextFiles,
    openInNewTab,
    hidePageContextPrefix,
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

  // What's happening right now, so the user isn't left guessing on send.
  const busyStatusText =
    sendPhase === 'capturing'
      ? t('askNuma.capturingContext')
      : sendPhase === 'opening'
        ? t('askNuma.openingNewTab')
        : sendPhase === 'preparing'
          ? t('askNuma.preparing')
          : t('askNuma.sending');

  return (
    <>
      <div className={`ask-numa-popup${className ? ` ${className}` : ''}`}>
        {/* Header */}
        <div className="ask-numa-popup-header">
          <h6 className="ask-numa-popup-title">{title || t('askNuma.popupTitle')}</h6>
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
            placeholder={placeholder || t('askNuma.placeholder')}
            value={inputMessage}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            rows={3}
          />
          {isBusy && (
            <div className="ask-numa-status d-flex align-items-center gap-2 small text-muted mt-2" role="status">
              <Spinner size="sm" animation="border" />
              <span>{busyStatusText}</span>
            </div>
          )}
          {!isBusy && sendPhase === 'opened' && (
            <div className="ask-numa-status d-flex align-items-center gap-2 small text-success mt-2" role="status">
              <Check size={14} />
              <span>{t('askNuma.openedNewTab')}</span>
            </div>
          )}
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
