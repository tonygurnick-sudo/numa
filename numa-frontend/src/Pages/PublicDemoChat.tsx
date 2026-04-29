/**
 * Public Demo Chat Page
 *
 * Lightweight, unauthenticated version of Numa workspace chat for demos.
 * Reuses ChatMessages for rendering and ChatInput V2 for input.
 * No conversation persistence -- state lives in React, lost on refresh.
 *
 * Feature-flag gated: only rendered when PUBLIC_DEMO is true in config.json.
 * Not linked anywhere in the UI -- must know the URL (/demo).
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Modal } from 'react-bootstrap';
import { Plus } from 'lucide-react';
import { ChatMessages } from '../Components/Chat/ChatMessages';
import { ChatInput } from '../Components/Chat/ChatInput';
import { PageHeader } from '../Components/PageHeader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import ResizableSplitView from '../Components/ResizableSplitView';
import { FilePreviewPanel } from '../Components/FilePreviewPanel';
import { WorkspaceChatFileUpload } from '../Components/WorkspaceChat/WorkspaceChatFileUpload';
import { PendingFilesBar } from '../Components/Chat/PendingFilesBar';
import {
  streamPublicDemoChat,
  fetchDemoCredentials,
  convertDemoDocxPreview,
  uploadDemoFile,
} from '../Services/publicDemoChatService';
import type { DemoCredentials } from '../Services/publicDemoChatService';
import {
  createSDKEventContext,
  resetSDKEventContext,
  createStreamEventHandler,
  handleSDKStreamComplete,
  handleSDKStreamError,
  createWorkspaceChatMessageHelpers,
} from '../utils/workspaceChatEventHandlers';
import { extractSingleDocBlock } from '../utils/streamingProcessors';
import type { SDKEventContext, WorkspaceChatMessage } from '../types/workspaceChatTypes';
import type { FilePreview } from '../hooks/useFilePreviewProcessor';
import numaLogo from '/numa-logo.svg?url';
import asknumaIcon from '/asknuma-icon.png?url';

// ── Component ────────────────────────────────────────────────────────────────

export const PublicDemoChat = () => {
  const { t } = useTranslation('chat');
  const [searchParams] = useSearchParams();
  const isEmbed = useMemo(() => searchParams.get('mode') === 'embed', [searchParams]);

  // Core state
  const [messages, setMessages] = useState<WorkspaceChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [buttonStatus, setButtonStatus] = useState<'idle' | 'loading' | 'streaming'>('idle');
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [dailyLimitReached, setDailyLimitReached] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isFirstMessagePending, setIsFirstMessagePending] = useState(false);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<
    Array<{ kind: 'file'; filename: string; path: string; size: number; uploadedAt: number }>
  >([]);

  // Scoped credentials for S3 file preview (fetched from proxy)
  const [demoCreds, setDemoCreds] = useState<DemoCredentials | null>(null);
  const credsExpiryRef = useRef<number>(0);

  // Refs
  const messageEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isProcessingRef = useRef(false);
  const abortRef = useRef<(() => void) | null>(null);
  const eventContextRef = useRef<SDKEventContext>(createSDKEventContext());
  const rawTextRef = useRef('');
  const streamingToolsRef = useRef<
    Map<number, { id: string; name: string; inputBuffer: string; parentToolUseId?: string | null }>
  >(new Map());

  // Split view / file preview state
  const [showSplitView, setShowSplitView] = useState(false);
  const [leftFraction, setLeftFraction] = useState(0.55);
  const [previewItem, setPreviewItem] = useState<FilePreview | null>(null);
  const [inlinePreviewContent, setInlinePreviewContent] = useState<string | undefined>(undefined);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false);

  // Auto-scroll to bottom when new messages arrive.
  // Uses scrollTop instead of scrollIntoView to prevent the parent frame
  // from scrolling when this page is embedded in an iframe.
  useEffect(() => {
    const el = messageEndRef.current;
    if (el) {
      const container = el.closest('.chat-messages');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages]);

  // Clear first-message banner once assistant content arrives
  useEffect(() => {
    if (isFirstMessagePending && messages.some((m) => m.role === 'assistant' && m.segments && m.segments.length > 0)) {
      setIsFirstMessagePending(false);
    }
  }, [messages, isFirstMessagePending]);

  // Prompt the user to sign up for a free trial after they've sent a few
  // messages -- the demo has had enough time to impress by this point.
  // Once dismissed (via localStorage) we never re-show on this browser.
  const TRIAL_MODAL_DISMISSED_KEY = 'numa_demo_trial_modal_dismissed';
  const TRIAL_MODAL_TRIGGER_COUNT = 3;
  useEffect(() => {
    if (showTrialModal) return;
    if (localStorage.getItem(TRIAL_MODAL_DISMISSED_KEY) === 'true') return;
    const userMessageCount = messages.filter((m) => m.role === 'user').length;
    if (userMessageCount >= TRIAL_MODAL_TRIGGER_COUNT) {
      setShowTrialModal(true);
    }
  }, [messages, showTrialModal]);

  const handleDismissTrialModal = useCallback(() => {
    setShowTrialModal(false);
    localStorage.setItem(TRIAL_MODAL_DISMISSED_KEY, 'true');
  }, []);

  // Fetch scoped credentials on mount so bucket/region are available for file reference rendering.
  // Also populate storage so the upload service can find bucket/region/userSub.
  useEffect(() => {
    fetchDemoCredentials().then((creds) => {
      if (creds) {
        setDemoCreds(creds);
        credsExpiryRef.current = new Date(creds.expiration).getTime();
        sessionStorage.setItem('REGION', creds.region);
        sessionStorage.setItem('OUTPUTS_BUCKET_NAME', creds.bucket);
      }
    });
    // Set a minimal token so getUserSubFromToken() returns the demo user sub.
    // Only set if no real idToken exists (avoid clobbering a real user's session).
    const existingToken = localStorage.getItem('idToken');
    if (!existingToken) {
      const payload = btoa(JSON.stringify({ sub: 'public-demo-user' }));
      localStorage.setItem('idToken', `eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.${payload}.demo`);
    }
    return () => {
      // Clean up demo token on unmount (only if it's our demo token)
      const token = localStorage.getItem('idToken');
      if (token?.endsWith('.demo')) {
        localStorage.removeItem('idToken');
      }
    };
  }, []);

  // Track viewport for mobile-specific UI
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile((prev) => (prev === mobile ? prev : mobile));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Credentials ──────────────────────────────────────────────────────────

  /** Fetch or return cached scoped credentials. Auto-refreshes when expired. */
  const ensureCredentials = useCallback(async (): Promise<DemoCredentials | null> => {
    const now = Date.now();
    // Refresh 60s before expiry to avoid edge cases
    if (demoCreds && credsExpiryRef.current > now + 60_000) {
      return demoCreds;
    }
    const creds = await fetchDemoCredentials();
    if (creds) {
      setDemoCreds(creds);
      credsExpiryRef.current = new Date(creds.expiration).getTime();
    }
    return creds;
  }, [demoCreds]);

  /** Provide AWS credentials in the shape FilePreviewPanel/ChatMessages expect */
  const getCredentials = useCallback(async () => {
    const creds = await ensureCredentials();
    if (!creds) throw new Error('Demo credentials unavailable');
    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    };
  }, [ensureCredentials]);

  // ── New Chat ─────────────────────────────────────────────────────────────

  const handleNewChat = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setMessages([]);
    setInputMessage('');
    setButtonStatus('idle');
    setConversationId(crypto.randomUUID());
    isProcessingRef.current = false;
    eventContextRef.current = createSDKEventContext();
    rawTextRef.current = '';
    streamingToolsRef.current.clear();
    setShowSplitView(false);
    setShowFilePreviewModal(false);
    setPreviewItem(null);
    setInlinePreviewContent(undefined);
    inputRef.current?.focus();
  }, []);

  // ── Stop ──────────────────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setButtonStatus('idle');
    isProcessingRef.current = false;
  }, []);

  // ── Document / File Preview ──────────────────────────────────────────────

  const handleOpenDocument = useCallback(
    (title: string, content: string) => {
      setInlinePreviewContent(content);
      setPreviewItem({
        type: 'file',
        filename: title,
        fullPath: '',
        relativePath: title,
        extension: title.split('.').pop() || 'md',
      });
      setShowSplitView(true);
      if (isMobile) setShowFilePreviewModal(true);
    },
    [isMobile]
  );

  const handleOpenFilePreview = useCallback(
    (ref: { filename: string; fullPath: string; relativePath: string; extension: string }) => {
      setPreviewItem({ type: 'file', ...ref });
      setInlinePreviewContent(undefined);
      setShowSplitView(true);
      if (isMobile) setShowFilePreviewModal(true);
    },
    [isMobile]
  );

  const handleClosePreview = useCallback(() => {
    setShowSplitView(false);
    setShowFilePreviewModal(false);
    setPreviewItem(null);
    setInlinePreviewContent(undefined);
  }, []);

  // Back-button intercept for mobile file preview modal
  useEffect(() => {
    if (!isMobile || !showFilePreviewModal) return;
    window.history.pushState({ filePreviewOpen: true }, '');
    const close = () => {
      setShowFilePreviewModal(false);
      handleClosePreview();
    };
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, [isMobile, showFilePreviewModal, handleClosePreview]);

  // ── Typed setMessages wrapper for event handler utilities ────────────────

  const setMessagesForHelpers = useCallback((updater: (prev: WorkspaceChatMessage[]) => WorkspaceChatMessage[]) => {
    setMessages(updater);
  }, []);

  // ── Submit Message ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (e: any, overridePrompt?: string) => {
      e?.preventDefault?.();

      const prompt = (overridePrompt || inputMessage).trim();
      if (!prompt || isProcessingRef.current || dailyLimitReached) return;

      // Reset streaming state
      isProcessingRef.current = true;
      setButtonStatus('loading');
      setInputMessage('');
      rawTextRef.current = '';
      resetSDKEventContext(eventContextRef.current);
      streamingToolsRef.current.clear();

      // Show initializing banner on very first message of a conversation
      if (messages.length === 0) {
        setIsFirstMessagePending(true);
      }

      // Clear staged files (they've been uploaded, agent will see them)
      setStagedFiles([]);

      // Add user message
      setMessages((prev) => [...prev, { role: 'user', content: prompt, segments: [{ kind: 'text', text: prompt }] }]);

      // Add placeholder assistant message
      setMessages((prev) => [...prev, { role: 'assistant', content: '', segments: [], status: 'thinking' }]);

      try {
        const helpers = createWorkspaceChatMessageHelpers(setMessagesForHelpers, setButtonStatus);

        const { abort } = await streamPublicDemoChat(
          { prompt, conversationId },
          // onEvent -- delegate to shared stream event handler
          createStreamEventHandler({
            setMessages,
            setButtonStatus: (s) => setButtonStatus(s as 'idle' | 'loading' | 'streaming'),
            eventContextRef,
            streamingToolsRef,
            rawTextRef,
          }),
          // onComplete
          () => {
            const rawText = rawTextRef.current;
            const docBlock = extractSingleDocBlock(rawText);
            if (docBlock) {
              handleOpenDocument(docBlock.docTitle, docBlock.docContent);
            }

            handleSDKStreamComplete(eventContextRef.current, helpers);
            isProcessingRef.current = false;
            abortRef.current = null;
          },
          // onError
          (error: Error) => {
            console.error('[PublicDemo] Stream error:', error);

            if (error.message.includes('Daily demo limit reached') || error.message.includes('daily')) {
              setDailyLimitReached(true);
            }

            handleSDKStreamError(error, eventContextRef.current, helpers);
            isProcessingRef.current = false;
            abortRef.current = null;
          },
          // onSessionEvent -- no-op; we use isFirstMessagePending banner instead
          () => {}
        );

        abortRef.current = abort;
      } catch (err) {
        console.error('[PublicDemo] Failed to start stream:', err);
        setButtonStatus('idle');
        isProcessingRef.current = false;
      }
    },
    [inputMessage, conversationId, dailyLimitReached, handleOpenDocument, setMessagesForHelpers]
  );

  // ── Quick Actions (demo-specific) ──────────────────────────────────────
  // Prompts are short triggers -- the actual flow (Q&A, PDF generation,
  // free-trial pitch) is driven by the numa-chat-demo agent system prompt.

  // Row layout: 2 featured (large) | 3 middle | 3 bottom
  const featuredActions = [
    {
      id: 'draft',
      label: 'Draft a document',
      icon: 'bi-file-earmark-text',
      prompt: 'Can you help me draft a professional document?',
    },
    {
      id: 'analyze',
      label: 'Analyze a file',
      icon: 'bi-bar-chart-line',
      prompt: "I have some data I'd like you to analyze. What formats can you work with?",
    },
  ];
  const middleActions = [
    {
      id: 'business-impact',
      label: 'What can Numa do for my business?',
      icon: 'bi-graph-up-arrow',
      prompt:
        "I'd like to understand what Numa can do for my business. Please ask me some questions and then create a one-page PDF I can download.",
    },
    {
      id: 'email',
      label: 'Write an email',
      icon: 'bi-envelope',
      prompt: 'Can you help me write a professional email?',
    },
    {
      id: 'create-agent',
      label: 'Create an agent',
      icon: 'bi-robot',
      prompt: "I'd like to create an agent in Numa. Can you walk me through designing one?",
    },
  ];
  const bottomActions = [
    {
      id: 'presentation',
      label: 'Build a presentation',
      icon: 'bi-easel',
      prompt: 'Can you create a professional HTML presentation for me?',
    },
    {
      id: 'report',
      label: 'Create a report',
      icon: 'bi-file-earmark-bar-graph',
      prompt: 'I need a report created. Can you help?',
    },
    {
      id: 'learn',
      label: 'Teach me about Numa',
      icon: 'bi-mortarboard',
      prompt: 'What is Numa and what can it do? Tell me about all the features available on the full platform.',
    },
  ];

  // Use-case cards for embed mode -- fills the space and communicates capabilities
  const embedCards = [
    {
      id: 'business-impact',
      icon: 'bi-graph-up-arrow',
      title: t('demo.embed.cardBusinessTitle', 'What can Numa do for my business?'),
      description: t(
        'demo.embed.cardBusinessDesc',
        'Answer a few quick questions and get a personalised one-page PDF you can download.'
      ),
      prompt:
        "I'd like to understand what Numa can do for my business. Please ask me some questions and then create a one-page PDF I can download.",
    },
    {
      id: 'draft',
      icon: 'bi-file-earmark-text',
      title: t('demo.embed.cardDraftTitle', 'Draft a document'),
      description: t(
        'demo.embed.cardDraftDesc',
        'Create polished reports, emails, presentations, and professional documents.'
      ),
      prompt: 'Can you help me draft a professional document?',
    },
    {
      id: 'analyze',
      icon: 'bi-bar-chart-line',
      title: t('demo.embed.cardAnalyzeTitle', 'Analyze data'),
      description: t(
        'demo.embed.cardAnalyzeDesc',
        'Process files, run calculations, and create visualizations from your data.'
      ),
      prompt: "I have some data I'd like you to analyze. What formats can you work with?",
    },
    {
      id: 'create-agent',
      icon: 'bi-robot',
      title: t('demo.embed.cardAgentTitle', 'Create an agent'),
      description: t(
        'demo.embed.cardAgentDesc',
        'Walk through designing your own AI agent -- see how Numa automates your workflows.'
      ),
      prompt: "I'd like to create an agent in Numa. Can you walk me through designing one?",
    },
  ];

  const handleQuickAction = useCallback(
    (prompt: string) => {
      const syntheticEvent = { preventDefault: () => {} };
      handleSubmit(syntheticEvent, prompt);
    },
    [handleSubmit]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const hasMessages = messages.length > 0;

  const chatContent = (
    <div className="chat-left-pane d-flex flex-column h-100">
      {/* Initializing banner */}
      {isFirstMessagePending && (
        <div className="workspace-chat-first-message-banner" role="status">
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">{t('page.loading')}</span>
          </div>
          <span>{t('page.firstMessageInitializing')}</span>
        </div>
      )}

      {/* Messages area */}
      <div
        className={`flex-grow-1 overflow-auto chat-messages${!hasMessages ? ' chat-messages--new-chat' : ''}`}
        style={{ minHeight: 0 }}
      >
        {!hasMessages ? (
          isEmbed ? (
            /* ── Embed welcome: use-case cards for iframe ── */
            <div className="demo-welcome demo-welcome--embed">
              <p className="demo-embed-tagline">
                <img src={asknumaIcon} alt="" aria-hidden="true" className="demo-embed-tagline-icon" />
                <span>{t('demo.embed.tagline', 'Helping grow businesses more profitably')}</span>
              </p>
              <div className="demo-embed-cards" role="group" aria-label="Quick actions">
                {embedCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className="demo-embed-card"
                    onClick={() => handleQuickAction(card.prompt)}
                    disabled={dailyLimitReached}
                  >
                    <i className={`bi ${card.icon} demo-embed-card-icon`} aria-hidden="true" />
                    <span className="demo-embed-card-title">{card.title}</span>
                    <span className="demo-embed-card-desc">{card.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Standard welcome: full hero + tile grid ── */
            <div className="demo-welcome">
              {/* Hero */}
              <div className="demo-welcome-hero">
                <img src={numaLogo} alt="Numa" className="demo-welcome-logo" />
                <h2 className="demo-welcome-title">{t('demo.welcome', 'Welcome to Numa')}</h2>
                <p className="demo-welcome-subtitle">
                  {t(
                    'demo.subtitle',
                    'Ask me anything -- I can search the web, create documents, write code, and more.'
                  )}
                </p>
                <p className="demo-welcome-disclaimer">
                  {t(
                    'demo.disclaimer',
                    'This is a lightweight demo of Numa Chat -- some features may be limited. For the full experience,'
                  )}{' '}
                  <a href="https://asknuma.ai/freetrial" target="_blank" rel="noopener noreferrer">
                    {t('demo.disclaimerLink', 'request a free trial')}
                  </a>
                  .
                </p>
              </div>

              {/* Stacked tile grid: 2 featured | 4 middle | 3 bottom */}
              <div className="demo-tiles" role="group" aria-label="Quick actions">
                <div className="demo-tiles-row demo-tiles-featured">
                  {featuredActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="demo-tile demo-tile-featured"
                      onClick={() => handleQuickAction(action.prompt)}
                      disabled={dailyLimitReached}
                    >
                      <i className={`bi ${action.icon} demo-tile-icon`} aria-hidden="true" />
                      <span className="demo-tile-label">{action.label}</span>
                    </button>
                  ))}
                </div>
                <div className="demo-tiles-row demo-tiles-middle">
                  {middleActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="demo-tile"
                      onClick={() => handleQuickAction(action.prompt)}
                      disabled={dailyLimitReached}
                    >
                      <i className={`bi ${action.icon} demo-tile-icon`} aria-hidden="true" />
                      <span className="demo-tile-label">{action.label}</span>
                    </button>
                  ))}
                </div>
                <div className="demo-tiles-row demo-tiles-bottom">
                  {bottomActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="demo-tile"
                      onClick={() => handleQuickAction(action.prompt)}
                      disabled={dailyLimitReached}
                    >
                      <i className={`bi ${action.icon} demo-tile-icon`} aria-hidden="true" />
                      <span className="demo-tile-label">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        ) : (
          <ChatMessages
            messages={messages as Parameters<typeof ChatMessages>[0]['messages']}
            messageEndRef={messageEndRef}
            loadingIndicatorStyle={{}}
            onOpenDocument={handleOpenDocument}
            isConversationLoading={false}
            isWorkspaceMode={true}
            conversationId={conversationId}
            sub="public-demo-user"
            outputsBucket={demoCreds?.bucket}
            region={demoCreds?.region}
            getCredentials={getCredentials}
            onOpenFilePreview={handleOpenFilePreview}
            onSendPrompt={(text: string) => {
              const syntheticEvent = { preventDefault: () => {} };
              handleSubmit(syntheticEvent, text);
            }}
          />
        )}
      </div>

      {/* Daily limit warning */}
      {dailyLimitReached && (
        <div className="alert alert-warning mx-3 mb-2 py-2 text-center" role="alert">
          <i className="bi bi-exclamation-triangle me-2" />
          {t('demo.dailyLimit', 'The demo has reached its daily usage limit. Please try again tomorrow.')}
        </div>
      )}

      {/* Staged files indicator */}
      {stagedFiles.length > 0 && (
        <PendingFilesBar
          items={stagedFiles}
          onRemove={(item) => {
            setStagedFiles((prev) => prev.filter((f) => f.path !== ('path' in item ? item.path : '')));
          }}
        />
      )}

      {/* Chat input -- always visible, full width */}
      <div className="chat-input-wrapper">
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSubmit={handleSubmit}
          setShowUploadModal={setShowUploadModal}
          buttonStatus={buttonStatus}
          webSearchEnabled={false}
          setWebSearchEnabled={() => {}}
          createAgentEnabled={false}
          setCreateAgentEnabled={() => {}}
          autoToolsEnabled={false}
          setAutoToolsEnabled={() => {}}
          setEnabledConnections={() => {}}
          setEnabledKBIds={() => {}}
          disabled={dailyLimitReached}
          variant="v2"
          externalInputRef={inputRef}
          autoFocus={true}
          placeholderOverride={
            dailyLimitReached
              ? t('demo.inputDisabled', 'Daily limit reached')
              : t('demo.placeholder', 'Ask me anything...')
          }
          onStop={buttonStatus === 'streaming' ? handleStop : undefined}
        />
      </div>
    </div>
  );

  // Header action buttons (matching real workspace chat V2 style)
  const renderHeaderActions = () => (
    <div className="workspace-chat-header-actions">
      <button
        type="button"
        className="workspace-chat-history-btn"
        onClick={handleNewChat}
        title={t('demo.newChat', 'New Chat')}
        aria-label={t('demo.newChat', 'New Chat')}
      >
        <Plus size={14} className="workspace-chat-header-btn-icon" />
        <span>{t('demo.newChat', 'New Chat')}</span>
      </button>
    </div>
  );

  return (
    <div
      className={`dashboard workspace-chat-v2 demo-chat-page${isEmbed ? ' demo-embed' : ''}`}
      style={{ height: '100dvh' }}
    >
      <LayoutDashboard>
        <div className="chat-layout d-flex">
          <div className="flex-grow-1 d-flex flex-column min-h-0">
            {/* Header -- hidden in embed mode for iframe-friendly layout */}
            {!isEmbed && (
              <PageHeader
                title={t('demo.headerTitle', 'Numa Chat')}
                subtitle={t('demo.headerSubtitle', 'Public demo')}
                actionsClassName="workspace-chat-header-actions"
                actions={renderHeaderActions()}
              />
            )}

            {/* Main chat area */}
            <div className="chat-container position-relative flex-grow-1">
              {!isMobile && showSplitView && previewItem ? (
                <ResizableSplitView
                  leftFraction={leftFraction}
                  onLeftFractionChange={setLeftFraction}
                  rightPadding="0"
                  left={chatContent}
                  right={
                    <FilePreviewPanel
                      preview={previewItem}
                      onClose={handleClosePreview}
                      bucket={demoCreds?.bucket || ''}
                      region={demoCreds?.region || ''}
                      getCredentials={getCredentials}
                      convertDocxFn={convertDemoDocxPreview}
                      initialContent={inlinePreviewContent}
                      fullScreenBasePath="/demo/file-preview"
                    />
                  }
                />
              ) : (
                chatContent
              )}
            </div>
          </div>
        </div>
      </LayoutDashboard>

      {/* File upload modal */}
      <WorkspaceChatFileUpload
        show={showUploadModal}
        onHide={() => setShowUploadModal(false)}
        conversationId={conversationId}
        getCredentials={getCredentials}
        uploadFn={uploadDemoFile}
        onUploadComplete={(responses) => {
          setStagedFiles((prev) => [
            ...prev,
            ...responses.map((r) => ({
              kind: 'file' as const,
              filename: r.filename,
              path: r.path,
              size: r.size,
              uploadedAt: Date.now(),
            })),
          ]);
          setShowUploadModal(false);
        }}
      />

      {/* Mobile file preview modal */}
      <Modal
        show={isMobile && showFilePreviewModal && !!previewItem}
        onHide={() => {
          setShowFilePreviewModal(false);
          handleClosePreview();
        }}
        fullscreen
        centered
        scrollable
        dialogClassName="file-preview-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>{previewItem?.filename || 'File Preview'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          {previewItem && (
            <FilePreviewPanel
              preview={previewItem}
              onClose={() => {
                setShowFilePreviewModal(false);
                handleClosePreview();
              }}
              bucket={demoCreds?.bucket || ''}
              region={demoCreds?.region || ''}
              getCredentials={getCredentials}
              convertDocxFn={convertDemoDocxPreview}
              embedded={true}
              initialContent={inlinePreviewContent}
              fullScreenBasePath="/demo/file-preview"
            />
          )}
        </Modal.Body>
      </Modal>

      {/* Free-trial prompt -- appears after a few messages, persists dismissal */}
      <Modal
        show={showTrialModal}
        onHide={handleDismissTrialModal}
        centered
        dialogClassName="demo-trial-modal"
        backdrop={true}
      >
        <Modal.Header closeButton>
          <Modal.Title>{t('demo.trial.title', 'Enjoying the demo?')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            {t(
              'demo.trial.body',
              "What you're seeing is a lightweight taste of Numa. On the full platform you can connect your own tools, build custom agents, access your company's files (Numa Files), schedule automations, and much more."
            )}
          </p>
          <p className="mb-0 text-muted">
            {t('demo.trial.bodyCta', 'Start a free trial and have it running for your business in minutes.')}
          </p>
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between">
          <button type="button" className="btn btn-link text-muted" onClick={handleDismissTrialModal}>
            {t('demo.trial.dismiss', 'Maybe later')}
          </button>
          <a
            href="https://asknuma.ai/freetrial"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            onClick={handleDismissTrialModal}
          >
            {t('demo.trial.cta', 'Start free trial')}
          </a>
        </Modal.Footer>
      </Modal>
    </div>
  );
};
