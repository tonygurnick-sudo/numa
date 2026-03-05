import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Alert } from 'react-bootstrap';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import {
  getShareInfo,
  listDropZoneFiles,
  getPersistentCallCount,
  incrementPersistentCallCount,
  type ShareInfo,
  type DropZoneFile,
} from '../Services/sharedChatService';
import { DropZoneAuthGate } from '../Components/DropZone/DropZoneAuthGate';
import { DropZoneUploadArea } from '../Components/DropZone/DropZoneUploadArea';
import { DropZoneFileList } from '../Components/DropZone/DropZoneFileList';
import { DropZoneQuotaBar } from '../Components/DropZone/DropZoneQuotaBar';
import { DropZoneNavPanel } from '../Components/DropZone/DropZoneNavPanel';
import { DropZoneApiExamples } from '../Components/DropZone/DropZoneApiExamples';
import { DropZoneChatPanel } from '../Components/DropZone/DropZoneChatPanel';
import { ExpiryCountdown } from '../Components/Shared/ExpiryCountdown';
import './DropZonePage.scss';

export const DropZonePage: React.FC = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const { t } = useTranslation('files');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<DropZoneFile[]>([]);
  const [usedQuotaMb, setUsedQuotaMb] = useState(0);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [liveCallCount, setLiveCallCount] = useState(0);

  const handleCallCountIncrement = useCallback(() => {
    if (!uuid) return;
    const newCount = incrementPersistentCallCount(uuid);
    setLiveCallCount(newCount);
  }, [uuid]);

  // Load drop zone info
  useEffect(() => {
    if (!uuid) return;

    const loadInfo = async () => {
      setLoading(true);
      try {
        const info = await getShareInfo(uuid);
        if (info.share_type !== 'dropzone') {
          window.location.href = `/shared/${uuid}`;
          return;
        }
        setShareInfo(info);
        setUsedQuotaMb(info.used_quota_mb ?? 0);

        // Initialize call count from persistent storage
        const persistedCount = getPersistentCallCount(uuid);
        const serverCount = info.call_count ?? 0;
        setLiveCallCount(Math.max(persistedCount, serverCount));

        if (info.auth_mode === 'none') {
          setIsAuthenticated(true);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('410')) {
          setError(t('dropzones.expired'));
        } else if (err instanceof Error && err.message.includes('404')) {
          setError(t('dropzones.notFound'));
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load drop zone');
        }
      } finally {
        setLoading(false);
      }
    };

    loadInfo();
  }, [uuid, t]);

  // Load files once authenticated
  useEffect(() => {
    if (!uuid || !isAuthenticated) return;

    const loadFiles = async () => {
      try {
        const result = await listDropZoneFiles(uuid, authToken ?? undefined);
        setUploadedFiles(result.files);
        setUsedQuotaMb(result.quota.used_mb);
      } catch {
        // Files list may be empty initially
      }
    };

    loadFiles();
  }, [uuid, isAuthenticated, authToken]);

  const handleAuthenticated = useCallback((token: string) => {
    setAuthToken(token);
    setIsAuthenticated(true);
  }, []);

  const handleUploadComplete = useCallback((file: DropZoneFile) => {
    setUploadedFiles((prev) => [...prev, file]);
  }, []);

  const handleQuotaUpdate = useCallback((newUsedMb: number) => {
    setUsedQuotaMb(newUsedMb);
  }, []);

  if (loading) {
    return (
      <div className="dropzone-loading">
        <div className="spinner-border text-primary" role="status" aria-hidden="true" />
      </div>
    );
  }

  if (error || !shareInfo) {
    return (
      <div className="dropzone-error">
        <div className="error-icon">
          <i className="bi bi-exclamation-triangle" />
        </div>
        <p>{error || 'Drop zone not found'}</p>
      </div>
    );
  }

  if (!isAuthenticated && shareInfo.auth_mode !== 'none') {
    return (
      <DropZoneAuthGate
        uuid={uuid!}
        authMode={shareInfo.auth_mode as 'passcode' | 'email'}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const quotaExceeded =
    shareInfo.total_quota_mb !== null &&
    shareInfo.total_quota_mb !== undefined &&
    usedQuotaMb >= shareInfo.total_quota_mb;

  const hasChat = !!shareInfo.enable_chat;

  return (
    <div className="dropzone-page">
      {/* Header bar */}
      <div className="dropzone-header">
        <div className="d-flex align-items-center gap-2">
          <i className="bi bi-cloud-upload" style={{ fontSize: '1.25rem', color: 'var(--bs-primary)' }} />
          <h5 className="mb-0">{t('dropzones.title')}</h5>
          {shareInfo.description && <span className="text-muted">&mdash; {shareInfo.description}</span>}
        </div>
        <div className="d-flex align-items-center gap-3">
          <DropZoneQuotaBar usedMb={usedQuotaMb} totalMb={shareInfo.total_quota_mb ?? null} />
          <ExpiryCountdown expiresAt={shareInfo.expires_at} />
          {hasChat && shareInfo.max_calls != null && (
            <span className="badge bg-primary-subtle text-primary">
              {liveCallCount} / {shareInfo.max_calls}{' '}
              {t('dropzones.questionsUsed', { used: liveCallCount, total: shareInfo.max_calls })}
            </span>
          )}
        </div>
      </div>

      {/* Body: 3-panel resizable layout */}
      <div className="dropzone-body">
        {isNavCollapsed && (
          <div className="nav-collapsed">
            <button className="expand-button" onClick={() => setIsNavCollapsed(false)} aria-label="Expand navigation">
              <i className="bi bi-chevron-right" />
            </button>
          </div>
        )}

        <Group orientation="horizontal" id="dropzone-panels">
          {/* Left: Collapsible nav */}
          {!isNavCollapsed && (
            <>
              <Panel id="nav" defaultSize={18} minSize={12}>
                <DropZoneNavPanel
                  clientName={shareInfo.client_name}
                  expiresAt={shareInfo.expires_at}
                  description={shareInfo.description}
                  instructions={shareInfo.instructions}
                  maxCalls={shareInfo.max_calls}
                  callCount={liveCallCount}
                  enableChat={hasChat}
                  onCollapse={() => setIsNavCollapsed(true)}
                />
              </Panel>
              <Separator className="resize-handle" />
            </>
          )}

          {/* Center: Upload + Files + API Examples */}
          <Panel id="upload" defaultSize={hasChat ? (isNavCollapsed ? 55 : 50) : isNavCollapsed ? 85 : 75} minSize={30}>
            <div className="dropzone-panel dropzone-main-panel">
              <div className="p-4">
                <DropZoneUploadArea
                  uuid={uuid!}
                  token={authToken ?? undefined}
                  maxFileSizeMb={shareInfo.max_file_size_mb ?? null}
                  allowedExtensions={shareInfo.allowed_extensions ?? null}
                  disabled={quotaExceeded}
                  onUploadComplete={handleUploadComplete}
                  onQuotaUpdate={handleQuotaUpdate}
                />
                {quotaExceeded && (
                  <Alert variant="warning" className="mt-2 py-2">
                    <i className="bi bi-exclamation-triangle me-1" />
                    {t('dropzones.quotaExceeded')}
                  </Alert>
                )}

                {uploadedFiles.length > 0 && (
                  <div className="mt-4">
                    <h6>{t('dropzones.uploadedFiles')}</h6>
                    <DropZoneFileList files={uploadedFiles} />
                  </div>
                )}

                {shareInfo.enable_api && (
                  <div className="mt-4">
                    <DropZoneApiExamples uuid={uuid!} authMode={shareInfo.auth_mode ?? 'none'} />
                  </div>
                )}
              </div>
            </div>
          </Panel>

          {/* Right: Chat panel (if enabled) */}
          {hasChat && (
            <>
              <Separator className="resize-handle" />
              <Panel id="chat" defaultSize={32} minSize={20}>
                <DropZoneChatPanel
                  uuid={uuid!}
                  maxCalls={shareInfo.max_calls}
                  callCount={liveCallCount}
                  onCallComplete={handleCallCountIncrement}
                />
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  );
};
