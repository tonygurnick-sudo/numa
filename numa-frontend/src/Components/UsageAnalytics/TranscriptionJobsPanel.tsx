import type { ReactElement } from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Table, Form, Button, Spinner, Badge, Row, Col, Modal, ProgressBar, Alert, Tab, Nav } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAuth } from '../../Providers/AuthProvider';
import { TranscriptionService } from '../../Services/TranscriptionService';
import { getFileIcon } from '../../Services/filesService';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import { downloadFileWithSignedUrl } from '../../utils/s3Utils';
import type {
  TranscriptionJob,
  JobStatus,
  TranscriptionOutput,
  UploadHandle,
  CostBreakdown,
} from '../../Services/TranscriptionService';

const STATUS_VARIANTS: Record<JobStatus, string> = {
  QUEUED: 'secondary',
  PROCESSING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCEL_REQUESTED: 'info',
  CANCELLED: 'dark',
};

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.py',
  '.sql',
  '.sh',
  '.log',
  '.adoc',
  '.bib',
  '.rst',
  '.org',
  '.typ',
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.pptx',
  '.ppt',
  '.rtf',
  '.odt',
  '.ods',
  '.odp',
  '.pages',
  '.key',
  '.numbers',
  '.msg',
  '.eml',
  '.ics',
  '.vcf',
  '.ipynb',
  '.png',
  '.jpg',
  '.jpeg',
  '.tiff',
  '.tif',
  '.webp',
  '.gif',
  '.bmp',
  '.heic',
  '.heif',
  '.svg',
  '.mp3',
  '.mp4',
  '.wav',
  '.flac',
  '.ogg',
  '.amr',
  '.webm',
  '.m4a',
  '.mov',
  '.avi',
  '.mkv',
  '.aac',
  '.wma',
  '.epub',
  '.djvu',
  '.parquet',
  '.sqlite',
  '.db',
  '.zip',
  '.tar',
  '.tar.gz',
  '.tgz',
]);

// ─── Upload file item tracking ───

interface FileUploadItem {
  file: File;
  status: 'pending' | 'uploading' | 'submitting' | 'success' | 'error' | 'cancelled';
  progress: number;
  error?: string;
  id: string;
}

// ─── Helpers ───

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${minutes}m ${remainSeconds}s`;
}

function getFileExtension(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  const idx = lower.lastIndexOf('.');
  return idx >= 0 ? lower.slice(idx) : '';
}

// ─── Main Component ───

export default function TranscriptionJobsPanel(): ReactElement {
  const { t } = useTranslation('settings');
  const { numaGet, numaPost, numaDelete } = useNumaRequest();
  const { user, getCredentials } = useAuth();

  // Jobs state
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showAdmin, setShowAdmin] = useState(false);

  // Detail / output modal
  const [selectedJob, setSelectedJob] = useState<TranscriptionJob | null>(null);
  const [outputContent, setOutputContent] = useState<TranscriptionOutput | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('info');

  // Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<FileUploadItem[]>([]);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done'>('idle');
  const uploadHandles = useRef<Map<string, UploadHandle>>(new Map());
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const isUserAdmin = user?.decoded_tokens?.idToken?.['cognito:groups']?.includes('admin') ?? false;

  // ─── Load Jobs ───

  const loadJobs = useCallback(
    async (token?: string): Promise<void> => {
      setLoading(true);
      try {
        const filters = { status: statusFilter || undefined, nextToken: token, limit: 50 };
        const response =
          showAdmin && isUserAdmin
            ? await TranscriptionService.listAll(filters, numaGet)
            : await TranscriptionService.list(filters, numaGet);
        setJobs(response.jobs ?? []);
        setNextToken(response.nextToken);
      } catch (e) {
        console.error('Failed to load transcription jobs', e);
        setJobs([]);
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, showAdmin, isUserAdmin, numaGet]
  );

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // ─── Job Actions ───

  const handleCancel = async (jobId: string): Promise<void> => {
    try {
      await TranscriptionService.cancel(jobId, numaDelete);
      loadJobs();
    } catch (e) {
      console.error('Failed to cancel job', e);
    }
  };

  const handleRetry = async (jobId: string): Promise<void> => {
    try {
      await TranscriptionService.retry(jobId, numaPost);
      loadJobs();
    } catch (e) {
      console.error('Failed to retry job', e);
    }
  };

  const handleDelete = (job: TranscriptionJob): void => {
    setJobs((prev) => prev.filter((j) => j.jobId !== job.jobId));
    TranscriptionService.cancel(job.jobId, numaDelete).catch((e) => {
      console.error('Failed to delete job', e);
      setJobs((prev) => [...prev, job].sort((a, b) => b.createdAt - a.createdAt));
    });
  };

  // ─── View Output ───

  const handleViewJob = async (job: TranscriptionJob): Promise<void> => {
    setSelectedJob(job);
    setOutputContent(null);
    setOutputError(null);
    setDetailTab('info');

    if (job.status === 'COMPLETED' && job.outputKey) {
      setOutputLoading(true);
      try {
        const content = await TranscriptionService.getOutputContent(job.outputKey, getCredentials);
        setOutputContent(content);
      } catch (e) {
        console.error('Failed to fetch output', e);
        setOutputError(t('transcriptions.errors.outputFetchFailed', { defaultValue: 'Failed to load output' }));
      } finally {
        setOutputLoading(false);
      }
    }
  };

  // ─── Upload: Add files ───

  const addFilesToUpload = useCallback((files: File[]): void => {
    const items: FileUploadItem[] = [];
    for (const file of files) {
      const ext = getFileExtension(file.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      items.push({
        file,
        status: 'pending',
        progress: 0,
        id: crypto.randomUUID(),
      });
    }
    if (items.length > 0) {
      setUploadFiles((prev) => [...prev, ...items]);
    }
  }, []);

  // ─── Upload: Remove pending file ───

  const removeUploadFile = useCallback((id: string): void => {
    setUploadFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ─── Upload: Cancel single ───

  const cancelSingleUpload = useCallback((id: string): void => {
    const handle = uploadHandles.current.get(id);
    if (handle) {
      handle.abort();
      uploadHandles.current.delete(id);
    }
    setUploadFiles((prev) =>
      prev.map((f) =>
        f.id === id && (f.status === 'uploading' || f.status === 'pending')
          ? { ...f, status: 'cancelled' as const, progress: 0 }
          : f
      )
    );
  }, []);

  // ─── Upload: Cancel all ───

  const cancelAllUploads = useCallback((): void => {
    cancelledRef.current = true;
    uploadHandles.current.forEach((handle) => handle.abort());
    uploadHandles.current.clear();
    setUploadFiles((prev) =>
      prev.map((f) =>
        f.status === 'uploading' || f.status === 'pending' || f.status === 'submitting'
          ? { ...f, status: 'cancelled' as const, progress: 0 }
          : f
      )
    );
    setUploadStatus('done');
  }, []);

  // ─── Upload: Start all ───

  const startUploads = useCallback(async (): Promise<void> => {
    const userSub = user?.decoded_tokens?.idToken?.sub;
    if (!userSub) return;

    cancelledRef.current = false;
    setUploadStatus('uploading');

    const pendingIds = uploadFiles.filter((f) => f.status === 'pending').map((f) => f.id);

    // Process in batches of 3 for concurrency
    for (let i = 0; i < pendingIds.length; i += 3) {
      if (cancelledRef.current) break;
      const batch = pendingIds.slice(i, i + 3);
      await Promise.all(
        batch.map(async (id) => {
          if (cancelledRef.current) return;

          const fileItem = uploadFiles.find((f) => f.id === id);
          if (!fileItem || fileItem.status !== 'pending') return;

          // Mark uploading
          setUploadFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, status: 'uploading' as const, progress: 0 } : f))
          );

          try {
            const handle = TranscriptionService.uploadToS3(
              fileItem.file,
              userSub,
              (progress) => {
                setUploadFiles((prev) =>
                  prev.map((f) => (f.id === id && f.status === 'uploading' ? { ...f, progress } : f))
                );
              },
              getCredentials
            );
            uploadHandles.current.set(id, handle);

            const fileKey = await handle.promise;
            uploadHandles.current.delete(id);

            if (cancelledRef.current) return;

            // Mark submitting
            setUploadFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, status: 'submitting' as const, progress: 100 } : f))
            );

            await TranscriptionService.submit(fileItem.file.name, fileKey, numaPost);

            setUploadFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, status: 'success' as const, progress: 100 } : f))
            );
          } catch (error) {
            const msg = (error as Error).message || 'Upload failed';
            if (msg === 'Upload cancelled' || cancelledRef.current) {
              setUploadFiles((prev) =>
                prev.map((f) =>
                  f.id === id && f.status !== 'cancelled' ? { ...f, status: 'cancelled' as const, progress: 0 } : f
                )
              );
            } else {
              console.error(`Upload failed for ${fileItem.file.name}:`, error);
              setUploadFiles((prev) =>
                prev.map((f) => (f.id === id ? { ...f, status: 'error' as const, progress: 0, error: msg } : f))
              );
            }
          }
        })
      );
    }

    setUploadStatus('done');
    loadJobs();
  }, [uploadFiles, user, getCredentials, numaPost, loadJobs]);

  const clearUploads = useCallback((): void => {
    uploadHandles.current.forEach((h) => h.abort());
    uploadHandles.current.clear();
    cancelledRef.current = false;
    setUploadFiles([]);
    setUploadStatus('idle');
  }, []);

  // ─── Drag-and-drop handlers ───

  const handleDragEnter = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFilesToUpload(Array.from(e.dataTransfer.files));
        setShowUploadModal(true);
      }
    },
    [addFilesToUpload]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) addFilesToUpload(selected);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Upload summary counts ───

  const successCount = uploadFiles.filter((f) => f.status === 'success').length;
  const errorCount = uploadFiles.filter((f) => f.status === 'error').length;
  const cancelledCount = uploadFiles.filter((f) => f.status === 'cancelled').length;
  const pendingCount = uploadFiles.filter((f) => f.status === 'pending').length;
  const isUploading = uploadStatus === 'uploading';
  const isUploadDone = uploadStatus === 'done';

  // ─── Render helpers ───

  const statusBadge = (status: JobStatus): ReactElement => (
    <Badge bg={STATUS_VARIANTS[status] || 'secondary'} text={status === 'PROCESSING' ? 'dark' : undefined}>
      {t(`transcriptions.statuses.${status}`, { defaultValue: status })}
    </Badge>
  );

  const renderCostBreakdown = (costs: CostBreakdown): ReactElement => (
    <Table size="sm" bordered className="mb-0 small">
      <thead>
        <tr>
          <th>{t('transcriptions.costs.service', { defaultValue: 'Service' })}</th>
          <th>{t('transcriptions.costs.detail', { defaultValue: 'Detail' })}</th>
        </tr>
      </thead>
      <tbody>
        {costs.lambda && (
          <tr>
            <td>{t('transcriptions.costs.lambda', { defaultValue: 'Lambda' })}</td>
            <td>
              {formatDuration(costs.lambda.durationMs)}
              {costs.lambda.memoryMb != null && `, ${costs.lambda.memoryMb} MB`}
            </td>
          </tr>
        )}
        {costs.fargate && (
          <tr>
            <td>{t('transcriptions.costs.fargate', { defaultValue: 'Fargate' })}</td>
            <td>
              {t('transcriptions.costs.fargateDetail', {
                defaultValue: '{{vcpu}} vCPU, {{memory}} GB',
                vcpu: costs.fargate.vcpu,
                memory: costs.fargate.memoryGb,
              })}{' '}
              &mdash; {formatDuration(costs.fargate.durationMs)}
            </td>
          </tr>
        )}
        {costs.s3 && (
          <tr>
            <td>{t('transcriptions.costs.s3', { defaultValue: 'S3' })}</td>
            <td>
              {costs.s3.reads} {t('transcriptions.costs.reads', { defaultValue: 'reads' })}, {costs.s3.writes}{' '}
              {t('transcriptions.costs.writes', { defaultValue: 'writes' })}
            </td>
          </tr>
        )}
        {costs.bedrock && (
          <tr>
            <td>{t('transcriptions.costs.bedrock', { defaultValue: 'Bedrock' })}</td>
            <td>
              {costs.bedrock.inputTokens.toLocaleString()} {t('transcriptions.costs.tokensIn', { defaultValue: 'in' })}{' '}
              / {costs.bedrock.outputTokens.toLocaleString()}{' '}
              {t('transcriptions.costs.tokensOut', { defaultValue: 'out' })}
            </td>
          </tr>
        )}
        {costs.transcribe && (
          <tr>
            <td>{t('transcriptions.costs.transcribe', { defaultValue: 'Transcribe' })}</td>
            <td>{formatDuration(costs.transcribe.durationSeconds * 1000)}</td>
          </tr>
        )}
      </tbody>
    </Table>
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <input ref={fileInputRef} type="file" className="d-none" onChange={handleFileInputChange} accept="*/*" multiple />

      {/* Drag overlay */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            backgroundColor: 'rgba(var(--bs-primary-rgb), 0.05)',
            border: '2px dashed var(--bs-primary)',
            borderRadius: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div className="text-primary fw-bold fs-5">
            <i className="bi bi-cloud-arrow-up me-2"></i>
            {t('transcriptions.dropZone.dropHere')}
          </div>
        </div>
      )}

      {/* Filters + Refresh + Upload */}
      <Row className="mb-3 align-items-center">
        <Col md={4}>
          <Form.Select
            value={statusFilter}
            onChange={(e): void => setStatusFilter(e.target.value)}
            aria-label={t('transcriptions.filters.statusFilter')}
          >
            <option value="">{t('transcriptions.filters.allStatuses')}</option>
            <option value="QUEUED">{t('transcriptions.statuses.QUEUED')}</option>
            <option value="PROCESSING">{t('transcriptions.statuses.PROCESSING')}</option>
            <option value="COMPLETED">{t('transcriptions.statuses.COMPLETED')}</option>
            <option value="FAILED">{t('transcriptions.statuses.FAILED')}</option>
            <option value="CANCELLED">{t('transcriptions.statuses.CANCELLED')}</option>
          </Form.Select>
        </Col>
        <Col md="auto" className="d-flex gap-2">
          <Button
            variant="outline-secondary"
            onClick={(): void => {
              loadJobs();
            }}
            disabled={loading}
          >
            <i className="bi bi-arrow-clockwise me-1"></i>
            {t('transcriptions.actions.refresh')}
          </Button>
          <Button variant="primary" onClick={(): void => setShowUploadModal(true)}>
            <i className="bi bi-cloud-upload me-1"></i>
            {t('transcriptions.upload.uploadFiles')}
          </Button>
        </Col>
        {isUserAdmin && (
          <Col md="auto">
            <Form.Check
              type="switch"
              id="admin-toggle"
              label={t('transcriptions.filters.showAllUsers')}
              checked={showAdmin}
              onChange={(e): void => setShowAdmin(e.target.checked)}
            />
          </Col>
        )}
      </Row>

      {/* Jobs table */}
      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <Table striped bordered hover>
              <thead>
                <tr>
                  <th>{t('transcriptions.table.fileName')}</th>
                  <th>{t('transcriptions.table.format')}</th>
                  <th>{t('transcriptions.table.size')}</th>
                  <th>{t('transcriptions.table.status')}</th>
                  <th>{t('transcriptions.table.processingTime', { defaultValue: 'Time' })}</th>
                  <th>{t('transcriptions.table.submitted')}</th>
                  <th>{t('transcriptions.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">
                      {t('transcriptions.table.noJobs')}
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.jobId}>
                      <td className="text-truncate" style={{ maxWidth: '200px' }} title={job.fileName}>
                        {job.fileName}
                      </td>
                      <td>
                        <code>{job.fileExtension}</code>
                      </td>
                      <td>{formatFileSize(job.fileSize)}</td>
                      <td>
                        {statusBadge(job.status)}
                        {job.status === 'PROCESSING' && job.progress != null && (
                          <ProgressBar now={job.progress} className="mt-1" style={{ height: '4px' }} />
                        )}
                      </td>
                      <td className="text-muted small">
                        {job.processingTimeMs ? formatDuration(job.processingTimeMs) : '-'}
                      </td>
                      <td>
                        {new Date(job.createdAt).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td>
                        <div className="d-flex gap-1">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={(): void => {
                              handleViewJob(job);
                            }}
                            title={t('transcriptions.actions.viewDetails')}
                          >
                            <i className="bi bi-eye"></i>
                          </Button>
                          {(job.status === 'QUEUED' || job.status === 'PROCESSING') && (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={(): void => {
                                handleCancel(job.jobId);
                              }}
                              title={t('transcriptions.actions.cancel')}
                            >
                              <i className="bi bi-x-circle"></i>
                            </Button>
                          )}
                          {(job.status === 'FAILED' ||
                            job.status === 'CANCELLED' ||
                            job.status === 'CANCEL_REQUESTED') && (
                            <Button
                              size="sm"
                              variant="outline-warning"
                              onClick={(): void => {
                                handleRetry(job.jobId);
                              }}
                              title={t('transcriptions.actions.retry')}
                            >
                              <i className="bi bi-arrow-repeat"></i>
                            </Button>
                          )}
                          {(job.status === 'COMPLETED' ||
                            job.status === 'FAILED' ||
                            job.status === 'CANCELLED' ||
                            job.status === 'CANCEL_REQUESTED') && (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={(): void => {
                                handleDelete(job);
                              }}
                              title={t('transcriptions.actions.delete', { defaultValue: 'Delete' })}
                            >
                              <i className="bi bi-trash"></i>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span className="text-muted small">{t('transcriptions.table.showing', { count: jobs.length })}</span>
            {nextToken && (
              <Button
                variant="outline-primary"
                onClick={(): void => {
                  loadJobs(nextToken);
                }}
              >
                {t('transcriptions.table.loadMore')}
              </Button>
            )}
          </div>
        </>
      )}

      {/* Upload Modal */}
      <Modal
        show={showUploadModal}
        onHide={(): void => {
          if (isUploading) {
            cancelAllUploads();
          }
          clearUploads();
          setShowUploadModal(false);
        }}
        centered
        backdrop={isUploading ? 'static' : true}
        keyboard={!isUploading}
      >
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-cloud-upload me-2" />
            {t('transcriptions.upload.title')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* Drop Zone */}
          <div
            className={`p-4 text-center rounded ${isDragging ? 'border-primary bg-light' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e): void => {
              handleDrop(e);
              if (!showUploadModal) setShowUploadModal(true);
            }}
            onClick={(): void => {
              if (!isUploading) fileInputRef.current?.click();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e): void => {
              if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
                fileInputRef.current?.click();
              }
            }}
            style={{
              cursor: isUploading ? 'default' : 'pointer',
              minHeight: '120px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderStyle: 'dashed',
              borderWidth: '2px',
              borderColor: isDragging ? undefined : '#dee2e6',
              transition: 'all 0.2s ease-in-out',
            }}
          >
            <i className="bi bi-cloud-arrow-up fs-1 text-muted mb-2"></i>
            <p className="mb-1">{t('transcriptions.upload.dropzone')}</p>
            <p className="text-muted small mb-2">{t('transcriptions.upload.clickToBrowse')}</p>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={(e): void => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={isUploading}
            >
              <i className="bi bi-file-earmark-plus me-1"></i>
              {t('transcriptions.upload.uploadFiles')}
            </Button>
          </div>

          {/* File List */}
          {uploadFiles.length > 0 && (
            <div className="mt-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {uploadFiles.map((item) => (
                <div
                  key={item.id}
                  className="d-flex align-items-center py-2 px-2 border-bottom"
                  style={{ gap: '0.5rem' }}
                >
                  <i className={`${getFileIcon(item.file.name)} text-muted`}></i>
                  <div className="flex-grow-1 overflow-hidden">
                    <div className="text-truncate small" title={item.file.name} style={{ maxWidth: '250px' }}>
                      {item.file.name}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                      {formatFileSize(item.file.size)}
                    </div>
                  </div>
                  {item.status === 'pending' && (
                    <button
                      className="btn btn-sm btn-link text-danger p-0"
                      onClick={(): void => removeUploadFile(item.id)}
                      title={t('transcriptions.upload.remove')}
                      disabled={isUploading}
                    >
                      <i className="bi bi-x-lg"></i>
                    </button>
                  )}
                  {(item.status === 'uploading' || item.status === 'submitting') && (
                    <>
                      <div style={{ width: '60px' }}>
                        <ProgressBar now={item.progress} striped style={{ height: '6px' }} />
                      </div>
                      <button
                        className="btn btn-sm btn-link text-danger p-0"
                        onClick={(): void => cancelSingleUpload(item.id)}
                        title={t('transcriptions.upload.cancelUpload')}
                      >
                        <i className="bi bi-x-lg"></i>
                      </button>
                    </>
                  )}
                  {item.status === 'success' && <i className="bi bi-check-circle-fill text-success"></i>}
                  {item.status === 'error' && (
                    <i className="bi bi-exclamation-circle-fill text-danger" title={item.error}></i>
                  )}
                  {item.status === 'cancelled' && (
                    <i className="bi bi-dash-circle text-muted" title={t('transcriptions.upload.cancelled')}></i>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Upload summary */}
          {isUploadDone && (successCount > 0 || errorCount > 0 || cancelledCount > 0) && (
            <Alert
              variant={errorCount > 0 ? (successCount > 0 ? 'warning' : 'danger') : 'success'}
              className="mt-3 mb-0 small"
            >
              {successCount > 0 && (
                <span className="me-2">
                  <i className="bi bi-check-circle me-1"></i>
                  {t('transcriptions.upload.successCount', { count: successCount })}
                </span>
              )}
              {errorCount > 0 && (
                <span className="me-2">
                  <i className="bi bi-exclamation-circle me-1"></i>
                  {t('transcriptions.upload.errorCount', { count: errorCount })}
                </span>
              )}
              {cancelledCount > 0 && (
                <span>
                  <i className="bi bi-dash-circle me-1"></i>
                  {t('transcriptions.upload.cancelledCount', { count: cancelledCount })}
                </span>
              )}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          {uploadStatus === 'idle' && uploadFiles.length > 0 && (
            <>
              <Button variant="secondary" onClick={clearUploads}>
                {t('transcriptions.upload.clear')}
              </Button>
              <Button variant="primary" onClick={startUploads} disabled={pendingCount === 0}>
                <i className="bi bi-upload me-1"></i>
                {t('transcriptions.upload.uploadCount', { count: pendingCount })}
              </Button>
            </>
          )}
          {isUploading && (
            <Button variant="danger" onClick={cancelAllUploads}>
              <i className="bi bi-x-circle me-1"></i>
              {t('transcriptions.upload.cancelUpload')}
            </Button>
          )}
          {isUploadDone && (
            <Button
              variant="primary"
              onClick={(): void => {
                clearUploads();
                setShowUploadModal(false);
              }}
            >
              {t('transcriptions.upload.done')}
            </Button>
          )}
          {uploadStatus === 'idle' && uploadFiles.length === 0 && (
            <Button variant="secondary" onClick={(): void => setShowUploadModal(false)}>
              {t('common:close', { defaultValue: 'Close' })}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* Detail / Output Modal */}
      <Modal show={!!selectedJob} onHide={(): void => setSelectedJob(null)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{t('transcriptions.detailModal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedJob && (
            <Tab.Container activeKey={detailTab} onSelect={(k): void => setDetailTab(k || 'info')}>
              <Nav variant="tabs" className="mb-3">
                <Nav.Item>
                  <Nav.Link eventKey="info">
                    {t('transcriptions.detailModal.infoTab', { defaultValue: 'Info' })}
                  </Nav.Link>
                </Nav.Item>
                {selectedJob.status === 'COMPLETED' && selectedJob.outputKey && (
                  <Nav.Item>
                    <Nav.Link eventKey="output">
                      {t('transcriptions.detailModal.outputTab', { defaultValue: 'Output' })}
                    </Nav.Link>
                  </Nav.Item>
                )}
                {selectedJob.costs && (
                  <Nav.Item>
                    <Nav.Link eventKey="costs">
                      {t('transcriptions.detailModal.costsTab', { defaultValue: 'Costs' })}
                    </Nav.Link>
                  </Nav.Item>
                )}
              </Nav>

              <Tab.Content>
                {/* Info tab */}
                <Tab.Pane eventKey="info">
                  <Row className="mb-3">
                    <Col md={6}>
                      <strong>{t('transcriptions.table.fileName')}:</strong> {selectedJob.fileName}
                    </Col>
                    <Col md={6}>
                      <strong>{t('transcriptions.table.status')}:</strong> {statusBadge(selectedJob.status)}
                    </Col>
                  </Row>
                  <Row className="mb-3">
                    <Col md={6}>
                      <strong>{t('transcriptions.table.size')}:</strong> {formatFileSize(selectedJob.fileSize)}
                    </Col>
                    <Col md={6}>
                      <strong>{t('transcriptions.table.submitted')}:</strong>{' '}
                      {new Date(selectedJob.createdAt).toLocaleString()}
                    </Col>
                  </Row>
                  {selectedJob.processingTimeMs && (
                    <Row className="mb-3">
                      <Col md={6}>
                        <strong>
                          {t('transcriptions.table.processingTime', { defaultValue: 'Processing Time' })}:
                        </strong>{' '}
                        {formatDuration(selectedJob.processingTimeMs)}
                      </Col>
                      <Col md={6}>
                        <strong>{t('transcriptions.detailModal.format', { defaultValue: 'Format' })}:</strong>{' '}
                        <code>{selectedJob.fileExtension}</code>
                      </Col>
                    </Row>
                  )}
                  {selectedJob.errorMessage && (
                    <Alert variant="danger">
                      <strong>{t('transcriptions.detailModal.error')}:</strong> {selectedJob.errorMessage}
                    </Alert>
                  )}
                </Tab.Pane>

                {/* Output tab */}
                {selectedJob.status === 'COMPLETED' && selectedJob.outputKey && (
                  <Tab.Pane eventKey="output">
                    <div className="d-flex justify-content-end mb-2">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={(): void => {
                          const bucket = sessionStorage.getItem('DATA_BUCKET') || '';
                          const region = sessionStorage.getItem('REGION') || '';
                          downloadFileWithSignedUrl(
                            selectedJob.outputKey!,
                            bucket,
                            region,
                            getCredentials,
                            `${selectedJob.fileName}.json`
                          );
                        }}
                      >
                        <i className="bi bi-download me-1" />
                        {t('transcriptions.actions.download')}
                      </Button>
                    </div>
                    {outputLoading && (
                      <div className="text-center py-4">
                        <Spinner animation="border" size="sm" />
                      </div>
                    )}
                    {outputError && <Alert variant="danger">{outputError}</Alert>}
                    {outputContent && (
                      <div
                        className="bg-light p-3 rounded"
                        style={{ maxHeight: '500px', overflow: 'auto', fontSize: '0.875rem' }}
                      >
                        {outputContent.pages?.map((page, idx) => (
                          <div key={idx}>
                            {outputContent.pages.length > 1 && (
                              <div className="text-muted small mb-1 fw-bold border-bottom pb-1">
                                {t('transcriptions.output.page', {
                                  defaultValue: 'Page {{num}}',
                                  num: page.page_number,
                                })}
                              </div>
                            )}
                            <div className="mb-3 markdown-content">
                              <MarkdownContent content={page.text} />
                            </div>
                          </div>
                        ))}
                        {!outputContent.pages?.length && <pre>{JSON.stringify(outputContent, null, 2)}</pre>}
                      </div>
                    )}
                  </Tab.Pane>
                )}

                {/* Costs tab */}
                {selectedJob.costs && <Tab.Pane eventKey="costs">{renderCostBreakdown(selectedJob.costs)}</Tab.Pane>}
              </Tab.Content>
            </Tab.Container>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={(): void => setSelectedJob(null)}>
            {t('common:close', { defaultValue: 'Close' })}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
