import React, { useState, useCallback, useEffect } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useShareAnalytics } from '../../hooks/useShareAnalytics';
import { deleteShare } from '../../Services/sharedChatService';
import type { ShareListItem } from '../../Services/sharedChatService';
import { calculateShareMetrics, exportShareAnalyticsAsCSV } from '../../utils/messageAnalyticsUtils';
import { getFlag } from '../../utils/featureFlags';
import { CreateShareModal } from '../Files/CreateShareModal';

type ViewMode = 'list' | 'grid' | 'analytics';

interface SharedFoldersTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

// ── Helper components ──────────────────────────────────────────

function ShareStatusBadge({ status, expiresAt }: { status: string; expiresAt?: string | null }) {
  const { t } = useTranslation('files');
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  if (isExpired) {
    return <span className="badge bg-warning-subtle text-warning">{t('shared.expired')}</span>;
  }
  switch (status) {
    case 'ready':
      return <span className="badge bg-success-subtle text-success">{t('status.ready')}</span>;
    case 'processing':
      return <span className="badge bg-primary-subtle text-primary">{t('status.processing')}</span>;
    case 'error':
      return <span className="badge bg-danger-subtle text-danger">{t('status.error')}</span>;
    default:
      return <span className="badge bg-success-subtle text-success">{t('status.ready')}</span>;
  }
}

function formatShareDate(timestamp: number | null): string {
  if (!timestamp) return '';
  const ts = timestamp > 9999999999 ? timestamp : timestamp * 1000;
  return new Date(ts).toLocaleDateString();
}

// ── Main component ─────────────────────────────────────────────

export function SharedFoldersTab({ onActionChange }: SharedFoldersTabProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const { t: tShared } = useTranslation('shared');
  const { t: tUnified } = useTranslation('unifiedFiles');
  const navigate = useNavigate();

  const sharingEnabled = getFlag('NUMA_SHARING');
  const dropZonesEnabled = getFlag('NUMA_DROP_ZONES');

  const { summary: analyticsSummary, isLoading: analyticsLoading, refresh: refreshShares } = useShareAnalytics();
  const shares = analyticsSummary?.shares ?? [];

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDropZoneModal, setShowDropZoneModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ShareListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [analyticsExporting, setAnalyticsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Propagate action buttons to the page header
  React.useEffect(() => {
    onActionChange?.(
      <div className="d-flex gap-2">
        {sharingEnabled && (
          <button className="btn btn-sm btn-outline-primary" onClick={() => setShowShareModal(true)}>
            <i className="bi bi-plus-lg me-1" />
            {t('shared.createShare')}
          </button>
        )}
        {dropZonesEnabled && (
          <button className="btn btn-sm btn-outline-success" onClick={() => setShowDropZoneModal(true)}>
            <i className="bi bi-cloud-upload me-1" />
            {t('dropzones.create')}
          </button>
        )}
      </div>
    );
    return () => onActionChange?.(null);
  }, [onActionChange, sharingEnabled, dropZonesEnabled, t]);

  const handleDeleteShare = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteShare(deleteTarget.uuid);
      await refreshShares();
      setDeleteTarget(null);
    } catch (err) {
      setError(t('shared.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, refreshShares, t]);

  const handleViewShareDetail = useCallback(
    (uuid: string) => {
      navigate(`/analyze/shared/${uuid}`);
    },
    [navigate]
  );

  const handleExportAnalytics = useCallback(() => {
    if (!analyticsSummary?.shares) return;
    setAnalyticsExporting(true);
    try {
      const csv = exportShareAnalyticsAsCSV(analyticsSummary.shares);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `share-analytics-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setAnalyticsExporting(false);
    }
  }, [analyticsSummary]);

  const handleCreated = useCallback(() => {
    refreshShares();
  }, [refreshShares]);

  // ── Tab intro (permanent) ──────────────────────────────
  // Two-column descriptions of what the External Share tab offers.
  // Treated as part of the page header rather than a dismissible banner.

  const tabIntro =
    sharingEnabled || dropZonesEnabled ? (
      <div className="shared-intro mx-3 mt-3">
        {sharingEnabled && (
          <div className="shared-intro__item">
            <i className="bi bi-link-45deg shared-intro__icon shared-intro__icon--share" />
            <div className="shared-intro__body">
              <strong className="shared-intro__title">{tUnified('shared.helpers.sharing.title')}</strong>
              <p className="shared-intro__description">{tUnified('shared.helpers.sharing.description')}</p>
            </div>
          </div>
        )}
        {dropZonesEnabled && (
          <div className="shared-intro__item">
            <i className="bi bi-cloud-upload shared-intro__icon shared-intro__icon--dropzone" />
            <div className="shared-intro__body">
              <strong className="shared-intro__title">{tUnified('shared.helpers.dropZone.title')}</strong>
              <p className="shared-intro__description">{tUnified('shared.helpers.dropZone.description')}</p>
            </div>
          </div>
        )}
      </div>
    ) : null;

  // ── Loading state ──────────────────────────────────────

  if (analyticsLoading && shares.length === 0) {
    return (
      <div className="finder-files">
        {tabIntro}
        <div className="finder-loading">
          <Spinner animation="border" size="sm" variant="secondary" />
          <span>{tShared('analytics.loading')}</span>
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────

  if (shares.length === 0) {
    return (
      <div className="finder-files">
        {tabIntro}
        <div className="finder-empty" style={{ padding: '3rem' }}>
          <i className="bi bi-share" style={{ fontSize: '2rem', color: '#86868b' }} />
          <h6 className="mt-2">{t('shared.empty')}</h6>
          <p className="text-muted small mb-3">{t('shared.emptyMessage')}</p>
          <div className="d-flex gap-2">
            {sharingEnabled && (
              <button className="btn btn-sm btn-primary" onClick={() => setShowShareModal(true)}>
                <i className="bi bi-plus-lg me-1" />
                {t('shared.createShare')}
              </button>
            )}
            {dropZonesEnabled && (
              <button className="btn btn-sm btn-success" onClick={() => setShowDropZoneModal(true)}>
                <i className="bi bi-cloud-upload me-1" />
                {t('dropzones.create')}
              </button>
            )}
          </div>
        </div>

        <CreateShareModal show={showShareModal} onHide={() => setShowShareModal(false)} onCreated={handleCreated} />
        <CreateShareModal
          show={showDropZoneModal}
          onHide={() => setShowDropZoneModal(false)}
          onCreated={handleCreated}
          mode="dropzone"
        />
      </div>
    );
  }

  // ── View mode toggle ──────────────────────────────────

  const viewToggle = (
    <div className="btn-group btn-group-sm">
      <button
        className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('list')}
        title="List view"
      >
        <i className="bi bi-list" />
      </button>
      <button
        className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('grid')}
        title="Grid view"
      >
        <i className="bi bi-grid" />
      </button>
      <button
        className={`btn ${viewMode === 'analytics' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('analytics')}
        title="Analytics"
      >
        <i className="bi bi-bar-chart" />
      </button>
    </div>
  );

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="finder-files">
      {tabIntro}
      {/* Toolbar */}
      <div className="finder-toolbar">
        <div className="finder-toolbar__location">
          <span className="finder-toolbar__title">{t('shared.rootLabel')}</span>
          <span className="text-muted small ms-2">({shares.length})</span>
        </div>
        <div className="finder-toolbar__actions">
          {viewToggle}
          <button className="finder-btn" onClick={() => refreshShares()}>
            <i className="bi bi-arrow-clockwise" />
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger mx-3 mt-2 mb-0" role="alert">
          {error}
          <button type="button" className="btn-close float-end" onClick={() => setError(null)} />
        </div>
      )}

      {/* Content area */}
      {viewMode === 'analytics' ? (
        <AnalyticsDashboard
          analyticsSummary={analyticsSummary}
          analyticsExporting={analyticsExporting}
          onViewDetail={handleViewShareDetail}
          onExport={handleExportAnalytics}
        />
      ) : viewMode === 'grid' ? (
        <div className="p-3">
          <div className="row g-3">
            {shares.map((share) => {
              const isDropzone = share.share_type === 'dropzone' || !!share.folder_path;
              return (
                <div key={share.uuid} className="col-6 col-md-4 col-lg-3">
                  <div
                    className="card h-100"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/analyze/shared/${share.uuid}`)}
                  >
                    <div className="card-body text-center p-3">
                      <i
                        className={`bi ${isDropzone ? 'bi-cloud-upload' : 'bi-file-earmark-text'}`}
                        style={{ fontSize: '2rem', color: isDropzone ? 'var(--bs-success)' : 'var(--bs-primary)' }}
                      />
                      <div className="fw-semibold mt-2 text-truncate" title={share.name}>
                        {share.name}
                      </div>
                      <div className="mt-1">
                        <ShareStatusBadge status={share.status} expiresAt={share.expires_at} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* List view */
        <>
          <div className="finder-columns" style={{ gridTemplateColumns: '1fr 100px 120px 100px 120px' }}>
            <div className="finder-col">{t('headers.name')}</div>
            <div className="finder-col d-none d-md-flex">{t('headers.type')}</div>
            <div className="finder-col d-none d-md-flex">{t('shared.created')}</div>
            <div className="finder-col d-none d-sm-flex">{t('headers.status')}</div>
            <div className="finder-col" />
          </div>
          <div className="finder-list">
            {shares.map((share) => {
              const isDropzone = share.share_type === 'dropzone' || !!share.folder_path;
              return (
                <div
                  key={share.uuid}
                  className="finder-row"
                  style={{ gridTemplateColumns: '1fr 100px 120px 100px 120px', cursor: 'pointer' }}
                  onClick={() => navigate(`/analyze/shared/${share.uuid}`)}
                >
                  <div className="finder-row__name-content">
                    <i
                      className={`bi ${isDropzone ? 'bi-cloud-upload' : 'bi-file-earmark-text'} finder-icon`}
                      style={{ color: isDropzone ? 'var(--bs-success)' : 'var(--bs-primary)' }}
                    />
                    <div className="d-flex flex-column">
                      <span className="finder-name">{share.name}</span>
                      {share.description && (
                        <small className="text-muted text-truncate" style={{ maxWidth: '300px' }}>
                          {share.description}
                        </small>
                      )}
                    </div>
                  </div>
                  <div className="finder-row__meta d-none d-md-block">
                    <span
                      className={`badge ${isDropzone ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary'}`}
                    >
                      {isDropzone ? t('dropzones.title') : t('shared.shareFile')}
                    </span>
                  </div>
                  <div className="finder-row__meta d-none d-md-block">
                    <span className="text-muted small">{formatShareDate(share.created_at)}</span>
                  </div>
                  <div className="finder-row__meta d-none d-sm-block">
                    <ShareStatusBadge status={share.status} expiresAt={share.expires_at} />
                  </div>
                  <div className="finder-row__actions">
                    {isDropzone && share.passcode && (
                      <button
                        title={t('dropzones.copyPasscode')}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(share.passcode!);
                        }}
                      >
                        <i className="bi bi-key" />
                      </button>
                    )}
                    <button
                      title={t('shared.viewAnalytics')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/analyze/shared/${share.uuid}`);
                      }}
                    >
                      <i className="bi bi-bar-chart" />
                    </button>
                    <button
                      title={t('shared.viewShare')}
                      onClick={(e) => {
                        e.stopPropagation();
                        const path = isDropzone ? 'dropzone' : 'shared';
                        window.open(`/${path}/${share.uuid}`, '_blank');
                      }}
                    >
                      <i className="bi bi-box-arrow-up-right" />
                    </button>
                    <button
                      className="text-danger"
                      title={t('shared.delete')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(share);
                      }}
                    >
                      <i className="bi bi-trash" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modals */}
      <CreateShareModal show={showShareModal} onHide={() => setShowShareModal(false)} onCreated={handleCreated} />
      <CreateShareModal
        show={showDropZoneModal}
        onHide={() => setShowDropZoneModal(false)}
        onCreated={handleCreated}
        mode="dropzone"
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {deleteTarget.share_type === 'dropzone'
                    ? t('shared.deleteDropzoneConfirmTitle')
                    : t('shared.deleteConfirmTitle')}
                </h5>
                <button type="button" className="btn-close" onClick={() => setDeleteTarget(null)} disabled={deleting} />
              </div>
              <div className="modal-body">
                <p>
                  {deleteTarget.share_type === 'dropzone'
                    ? t('shared.deleteDropzoneConfirmMessage', { name: deleteTarget.name })
                    : t('shared.deleteConfirmMessage', { name: deleteTarget.name })}
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                  {t('upload.cancel')}
                </button>
                <button className="btn btn-danger" onClick={handleDeleteShare} disabled={deleting}>
                  {deleting ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      {t('shared.deleting')}
                    </>
                  ) : (
                    <>
                      <i className="bi bi-trash me-1" />
                      {t('shared.delete')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Analytics Dashboard (extracted from Files.tsx) ────────────

function AnalyticsDashboard({
  analyticsSummary,
  analyticsExporting,
  onViewDetail,
  onExport,
}: {
  analyticsSummary: import('../../hooks/useShareAnalytics').ShareAnalyticsSummary | null;
  analyticsExporting: boolean;
  onViewDetail: (uuid: string) => void;
  onExport: () => void;
}) {
  const { t } = useTranslation('shared');

  if (!analyticsSummary) {
    return (
      <div className="finder-loading" style={{ padding: '3rem' }}>
        <Spinner animation="border" size="sm" variant="secondary" />
      </div>
    );
  }

  if (analyticsSummary.shares.length === 0) {
    return (
      <div className="finder-empty" style={{ padding: '3rem' }}>
        <i className="bi bi-bar-chart" style={{ fontSize: '1.5rem' }} />
        <span>{t('analytics.noData')}</span>
      </div>
    );
  }

  const metrics = calculateShareMetrics(analyticsSummary.shares);

  return (
    <div className="p-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h6 className="mb-0">{t('analytics.title')}</h6>
        <button className="btn btn-sm btn-outline-primary" onClick={onExport} disabled={analyticsExporting}>
          <i className="bi bi-download me-1" />
          {t('analytics.exportButton')}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="row g-3 mb-4">
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.totalMessages')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.totalMessages}</div>
              <small className="text-muted">{t('analytics.messages')}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.totalUploads')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.totalUploads}</div>
              <small className="text-muted">{t('analytics.uploads')}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.totalViews')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.totalViews}</div>
              <small className="text-muted">{t('analytics.views')}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.activeShares')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.activeShares}</div>
              <small className="text-muted">/ {metrics.totalShares}</small>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="text-muted small mb-1">{t('analytics.avgPerShare')}</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metrics.avgMessagesPerShare}</div>
              <small className="text-muted">{t('analytics.messages')}</small>
            </div>
          </div>
        </div>
      </div>

      {/* Top Share */}
      {metrics.topShare && (
        <div className="card mb-4">
          <div className="card-header">
            <h6 className="mb-0">{t('analytics.topShare')}</h6>
          </div>
          <div className="card-body">
            <div className="d-flex align-items-center gap-3">
              <i className="bi bi-trophy text-warning" style={{ fontSize: '2rem' }} />
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{metrics.topShare.name}</div>
                <small className="text-muted">
                  {t('analytics.topShareMessages', { count: metrics.topShare.messages })}
                </small>
              </div>
              <button
                className="btn btn-outline-primary btn-sm ms-auto"
                onClick={() => onViewDetail(metrics.topShare!.uuid)}
              >
                {t('analytics.viewDetail')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Breakdown Table */}
      <div className="card">
        <div className="card-header">
          <h6 className="mb-0">{t('analytics.shareBreakdown')}</h6>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>{t('analytics.name')}</th>
                  <th>{t('analytics.type')}</th>
                  <th>{t('analytics.messages')}</th>
                  <th>{t('analytics.uploads')}</th>
                  <th>{t('analytics.totalViews')}</th>
                  <th>{t('analytics.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {metrics.shareBreakdown.map((share) => (
                  <tr key={share.uuid}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <i
                          className={`bi ${share.shareType === 'dropzone' ? 'bi-cloud-upload' : 'bi-file-earmark-text'}`}
                        />
                        <div>
                          <div className="fw-semibold">{share.name}</div>
                          {share.description && <small className="text-muted">{share.description}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${share.shareType === 'dropzone' ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary'}`}
                      >
                        {share.shareType === 'dropzone' ? t('analytics.dropzoneType') : t('analytics.shareType')}
                      </span>
                    </td>
                    <td>
                      <span className="fw-semibold">{share.callCount}</span>
                    </td>
                    <td>
                      {share.shareType === 'dropzone' ? share.uploadCount : <span className="text-muted">&mdash;</span>}
                    </td>
                    <td>{share.viewCount}</td>
                    <td>
                      <span className={`badge bg-${share.isExpired ? 'secondary' : 'success'}`}>
                        {share.isExpired ? t('analytics.expired') : t('analytics.active')}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-outline-primary btn-sm" onClick={() => onViewDetail(share.uuid)}>
                        {t('analytics.viewDetail')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="text-muted">{t('analytics.shareBreakdownDescription')}</small>
        </div>
      </div>
    </div>
  );
}
