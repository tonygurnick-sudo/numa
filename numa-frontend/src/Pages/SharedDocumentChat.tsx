import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { SharedChatPanel } from '../Components/Shared/SharedChatPanel';
import { SharedNavPanel } from '../Components/Shared/SharedNavPanel';
import { DocumentViewer } from '../Components/Shared/DocumentViewer';
import { getShareInfo, ShareInfo } from '../Services/sharedChatService';
import './SharedDocumentChat.scss';

/**
 * Public page for shared document Q&A.
 * Displays a 3-pane layout with:
 * - Left: Collapsible nav with branding (toggle via arrow button)
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

  useEffect(() => {
    if (!uuid) {
      setError(t('errors.noUuid'));
      setIsLoading(false);
      return;
    }

    const loadShareInfo = async () => {
      try {
        const info = await getShareInfo(uuid);
        setShareInfo(info);
        if (info.status === 'error') {
          setError(t('errors.extractionFailed'));
        }
      } catch (err) {
        if (err instanceof Error) {
          if (err.message.includes('404')) {
            setError(t('errors.notFound'));
          } else if (err.message.includes('410')) {
            setError(t('errors.expired'));
          } else {
            setError(t('errors.loadFailed'));
          }
        } else {
          setError(t('errors.loadFailed'));
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadShareInfo();
  }, [uuid, t]);

  if (isLoading) {
    return (
      <div className="shared-loading">
        <div className="spinner-border text-primary" role="status" aria-hidden="true" />
        <div className="mt-3">{t('loading')}</div>
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

  return (
    <div className="shared-document-chat">
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
                onCollapse={() => setIsNavCollapsed(true)}
              />
            </Panel>
            <Separator className="resize-handle" />
          </>
        )}

        {/* Middle: Document viewer with minimal UI */}
        <Panel
          id="document"
          defaultSize={shareInfo.enable_chat ? (isNavCollapsed ? 55 : 50) : isNavCollapsed ? 85 : 75}
          minSize={30}
        >
          {shareInfo.s3_signed_url && (
            <DocumentViewer url={shareInfo.s3_signed_url} allowDownload={shareInfo.allow_download} />
          )}
        </Panel>

        {/* Right: Chat panel (if enabled) — shows processing banner when document is being extracted */}
        {shareInfo.enable_chat && (
          <>
            <Separator className="resize-handle" />
            <Panel id="chat" defaultSize={35} minSize={20}>
              <SharedChatPanel uuid={uuid!} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
};
