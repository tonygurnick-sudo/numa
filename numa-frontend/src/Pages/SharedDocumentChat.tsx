import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { SharedChatPanel } from '../Components/Shared/SharedChatPanel';
import { SharedNavPanel } from '../Components/Shared/SharedNavPanel';
import { DocumentViewer } from '../Components/Shared/DocumentViewer';
import {
  getShareInfo,
  generateDescription,
  ShareInfo,
  getPersistentCallCount,
  incrementPersistentCallCount,
  DocumentProcessingError,
} from '../Services/sharedChatService';
import './SharedDocumentChat.scss';

/**
 * Public page for shared document Q&A.
 * Displays a header bar + 3-pane layout:
 * - Top: Header with document name, description, expiry, and question count
 * - Left: Collapsible nav with branding
 * - Middle: Document viewer with minimal UI
 * - Right: Chat panel for Q&A with streaming responses
 *
 * Documents are extracted on upload in the file system, so shares
 * are always ready by the time someone opens the link.
 */
export const SharedDocumentChat = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const { t } = useTranslation('shared');
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [liveCallCount, setLiveCallCount] = useState(0);
  const [isDocumentProcessing, setIsDocumentProcessing] = useState(false);
  const [chatStatus, setChatStatus] = useState<'ready' | 'pending' | 'error'>('ready');
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const handleCallCountIncrement = useCallback(() => {
    if (!uuid) return;

    // Optimistically increment the persistent count
    const newCount = incrementPersistentCallCount(uuid);
    setLiveCallCount(newCount);
  }, [uuid]);

  useEffect(() => {
    if (!uuid) {
      setError(t('errors.noUuid'));
      setIsLoading(false);
      return;
    }

    const loadShareInfo = async (retryCount = 0): Promise<void> => {
      let shouldStopLoading = true;
      try {
        const info = await getShareInfo(uuid);
        setShareInfo(info);
        setIsDocumentProcessing(false);

        // Set chat status from response (default "ready" for backward compat)
        setChatStatus(info.chat_status ?? 'ready');

        // Use the persistent call count that survives page refreshes
        const persistentCount = getPersistentCallCount(uuid, info.call_count ?? 0);
        setLiveCallCount(persistentCount);

        if (info.status === 'error') {
          setError(t('errors.extractionFailed'));
        }
      } catch (err) {
        if (err instanceof DocumentProcessingError) {
          // Legacy share still processing — retry
          setIsDocumentProcessing(true);
          setError(null);

          if (retryCount < 10) {
            shouldStopLoading = false;
            setTimeout(() => {
              loadShareInfo(retryCount + 1);
            }, 5000);
          } else {
            setError(t('processing.message'));
            setIsDocumentProcessing(false);
          }
        } else if (err instanceof Error) {
          setIsDocumentProcessing(false);
          if (err.message.includes('404')) {
            setError(t('errors.notFound'));
          } else if (err.message.includes('410')) {
            setError(t('errors.expired'));
          } else {
            setError(t('errors.loadFailed'));
          }
        } else {
          setIsDocumentProcessing(false);
          setError(t('errors.loadFailed'));
        }
      } finally {
        if (shouldStopLoading) {
          setIsLoading(false);
        }
      }
    };

    loadShareInfo();
  }, [uuid, t]);

  // Poll for chat readiness when chat_status is "pending"
  useEffect(() => {
    if (!uuid || chatStatus !== 'pending') return;

    let attempts = 0;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const info = await getShareInfo(uuid);
        if (cancelled) return;
        const newChatStatus = info.chat_status ?? 'ready';
        if (newChatStatus === 'ready') {
          setChatStatus('ready');
          setShareInfo(info);
          return;
        }
        if (newChatStatus === 'error') {
          setChatStatus('error');
          return;
        }
      } catch {
        // Ignore polling errors
      }
      if (attempts < 24 && !cancelled) {
        timer = window.setTimeout(poll, 5000);
      }
    };

    let timer = window.setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [uuid, chatStatus]);

  if (isLoading) {
    return (
      <div className="shared-loading">
        <div className="spinner-border text-primary" role="status" aria-hidden="true" />
        <div className="mt-3">{isDocumentProcessing ? t('processing.message') : t('loading')}</div>
      </div>
    );
  }

  // Show processing state while document is being processed and no share info yet
  if (isDocumentProcessing && !shareInfo) {
    return (
      <div className="shared-processing">
        <div className="processing-icon">
          <div className="spinner-border text-info" role="status" aria-hidden="true" />
        </div>
        <h2>{t('processing.title')}</h2>
        <p>{t('processing.message')}</p>
      </div>
    );
  }

  if (error || !shareInfo) {
    return (
      <div className="shared-error">
        <div className="error-icon">
          <i className="bi bi-exclamation-circle" />
        </div>
        <h2>{error || t('errors.loadFailed')}</h2>
        <p>{t('errors.tryAgain')}</p>
      </div>
    );
  }

  // Derive a display name from the share info or signed URL
  const documentName =
    shareInfo.name ||
    (shareInfo.s3_signed_url
      ? decodeURIComponent(new URL(shareInfo.s3_signed_url).pathname.split('/').pop() || '')
      : null) ||
    t('documentTitle');

  return (
    <div className="shared-document-chat">
      {/* Header bar — intentionally blank */}
      <div className="shared-header" />

      <div className="shared-body">
        {/* Collapsed nav: fixed width button, not resizable */}
        {isNavCollapsed && (
          <div className="nav-collapsed">
            <button className="expand-button" onClick={() => setIsNavCollapsed(false)} aria-label="Expand navigation">
              <i className="bi bi-chevron-right" />
            </button>
          </div>
        )}

        <Group orientation="horizontal" id="shared-document-chat">
          {/* Left: Collapsible nav with branding */}
          {!isNavCollapsed && (
            <>
              <Panel id="nav" defaultSize={15} minSize={10}>
                <SharedNavPanel
                  clientName={shareInfo.client_name}
                  expiresAt={shareInfo.expires_at}
                  description={shareInfo.description}
                  maxCalls={shareInfo.max_calls}
                  callCount={liveCallCount}
                  allowDownload={shareInfo.allow_download}
                  documentUrl={shareInfo.s3_signed_url}
                  documentName={documentName}
                  onCollapse={() => setIsNavCollapsed(true)}
                  chatStatus={chatStatus}
                  generatingDescription={generatingDesc}
                  onGenerateDescription={async () => {
                    setGeneratingDesc(true);
                    try {
                      const desc = await generateDescription(uuid!);
                      setShareInfo((prev) => (prev ? { ...prev, description: desc } : prev));
                    } catch {
                      // Ignore — user can try again
                    } finally {
                      setGeneratingDesc(false);
                    }
                  }}
                />
              </Panel>
              <Separator className="resize-handle" />
            </>
          )}

          {/* Document panel */}
          <Panel
            id="document"
            defaultSize={shareInfo.enable_chat ? (isNavCollapsed ? 55 : 50) : isNavCollapsed ? 85 : 75}
            minSize={30}
          >
            <div style={{ position: 'relative', height: '100%' }}>
              {shareInfo.s3_signed_url && (
                <DocumentViewer url={shareInfo.s3_signed_url} allowDownload={shareInfo.allow_download} />
              )}
              {/* Legacy overlay: only for old shares with status="processing" */}
              {(isDocumentProcessing || (shareInfo.status === 'processing' && !shareInfo.chat_status)) && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    borderRadius: '0.5rem',
                  }}
                >
                  <div className="spinner-border text-primary mb-3" />
                  <h5>{t('processing.title')}</h5>
                  <p className="text-muted">{t('processing.message')}</p>
                </div>
              )}
            </div>
          </Panel>

          {/* Chat panel (if enabled) */}
          {shareInfo.enable_chat && (
            <>
              <Separator className="resize-handle" />
              <Panel id="chat" defaultSize={35} minSize={20}>
                <SharedChatPanel
                  uuid={uuid!}
                  maxCalls={shareInfo.max_calls}
                  callCount={liveCallCount}
                  onCallComplete={handleCallCountIncrement}
                  chatStatus={chatStatus}
                />
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  );
};
