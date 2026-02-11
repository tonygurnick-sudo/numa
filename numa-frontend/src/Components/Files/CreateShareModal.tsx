import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Form, Button, Spinner, Alert, InputGroup } from 'react-bootstrap';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../../Providers/AuthProvider';
import { withPRM } from '../../utils/prmUtils';
import {
  listFolder,
  registerFile,
  getDownloadUrl,
  buildS3Key,
  getFileIcon,
  formatFileSize,
} from '../../Services/filesService';
import { createShare } from '../../Services/sharedChatService';
import type { CreateShareResponse } from '../../Services/sharedChatService';
import type { FileItem, FileScope } from '../../Services/filesService';

interface CreateShareModalProps {
  show: boolean;
  onHide: () => void;
  onCreated: () => void;
  /** Pre-selected file info when launched from a file row share button */
  preSelectedFile?: {
    fileId: string;
    name: string;
    scope: FileScope;
  };
}

type Step = 'select' | 'configure' | 'success';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant that answers questions about the shared document. Be concise and accurate. If the answer is not in the document, say so.';

export const CreateShareModal = ({ show, onHide, onCreated, preSelectedFile }: CreateShareModalProps) => {
  const { t } = useTranslation('files');
  const { getCredentials, user } = useAuth();

  // Step state
  const [step, setStep] = useState<Step>(preSelectedFile ? 'configure' : 'select');

  // File selection state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ fileId: string; name: string; scope: FileScope } | null>(
    preSelectedFile ?? null,
  );
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configuration state
  const [description, setDescription] = useState('');
  const [expiryHours, setExpiryHours] = useState<number | null>(null); // null = permanent
  const [maxQuestions, setMaxQuestions] = useState('');
  const [enableChat, setEnableChat] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Success state
  const [shareResult, setShareResult] = useState<CreateShareResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when modal opens/closes or preSelectedFile changes
  useEffect(() => {
    if (show) {
      setStep(preSelectedFile ? 'configure' : 'select');
      setSelectedFile(preSelectedFile ?? null);
      setDescription('');
      setExpiryHours(null);
      setMaxQuestions('');
      setEnableChat(true);
      setAllowDownload(true);
      setSubmitting(false);
      setError(null);
      setShareResult(null);
      setCopied(false);
    }
  }, [show, preSelectedFile]);

  // Load files when in select mode
  useEffect(() => {
    if (show && step === 'select') {
      loadMyFiles();
    }
  }, [show, step]);

  const loadMyFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const result = await listFolder({ type: 'my' }, '/');
      setFiles(result.files);
    } catch {
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const handleFileUpload = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const file = fileList[0];
      const region = sessionStorage.getItem('REGION') || 'us-east-1';
      const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;

      if (!bucket || !userSub) {
        setError('Upload configuration not available.');
        return;
      }

      setUploadingFile(true);
      setError(null);

      try {
        const credentials = await getCredentials();
        if (!credentials) throw new Error('No credentials');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s3Client = withPRM(S3Client as any, { region, credentials });
        const fileId = crypto.randomUUID();
        const scope: FileScope = { type: 'my' };
        const s3Key = buildS3Key(scope, fileId, file.name, userSub);

        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          ContentType: file.type || 'application/octet-stream',
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const presignedUrl = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed: ${xhr.status}`));
          });
          xhr.addEventListener('error', () => reject(new Error('Upload failed')));
          xhr.open('PUT', presignedUrl);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
        });

        await registerFile(scope, fileId, file.name, '/', file.type || 'application/octet-stream', file.size);

        setSelectedFile({ fileId, name: file.name, scope });
        setStep('configure');
      } catch (err) {
        setError(t('errors.uploadFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
      } finally {
        setUploadingFile(false);
      }
    },
    [user, getCredentials, t],
  );

  const handleSelectFile = useCallback((file: FileItem) => {
    setSelectedFile({ fileId: file.file_id, name: file.name, scope: { type: 'my' } });
    setStep('configure');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return;

    setSubmitting(true);
    setError(null);

    try {
      // Get a pre-signed download URL for the file
      const { url } = await getDownloadUrl(selectedFile.scope, selectedFile.fileId);

      const result = await createShare({
        s3_signed_url: url,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        expiry_hours: expiryHours ?? undefined,
        max_calls: maxQuestions ? parseInt(maxQuestions, 10) : undefined,
        description: description || undefined,
        enable_chat: enableChat,
        allow_download: allowDownload,
      });

      setShareResult(result);
      setStep('success');
      onCreated();
    } catch (err) {
      setError(t('errors.shareFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
    } finally {
      setSubmitting(false);
    }
  }, [selectedFile, expiryHours, maxQuestions, description, enableChat, allowDownload, onCreated, t]);

  const shareUrl = shareResult ? `${window.location.origin}/shared/${shareResult.uuid}` : '';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleClose = () => {
    if (!submitting) onHide();
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop={submitting ? 'static' : true} size="lg">
      <Modal.Header closeButton={!submitting}>
        <Modal.Title>{t('createShare.title')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Step 1: Select File */}
        {step === 'select' && (
          <div>
            <p className="text-muted mb-3">{t('createShare.selectFile')}</p>

            {/* Upload option */}
            <div className="mb-3">
              <Button
                variant="outline-primary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
              >
                {uploadingFile ? (
                  <>
                    <Spinner size="sm" className="me-1" /> {t('status.uploading')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-cloud-upload me-1" /> {t('createShare.uploadNew')}
                  </>
                )}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="d-none"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
            </div>

            <hr />

            {/* Browse My Files */}
            <p className="fw-semibold mb-2">{t('createShare.browseFiles')}</p>
            {loadingFiles ? (
              <div className="text-center py-3">
                <Spinner size="sm" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-center text-muted py-3">
                <p>{t('createShare.noFiles')}</p>
                <p className="small">{t('createShare.uploadFirst')}</p>
              </div>
            ) : (
              <div className="list-group" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {files.map((file) => (
                  <button
                    key={file.file_id}
                    type="button"
                    className="list-group-item list-group-item-action d-flex align-items-center gap-2"
                    onClick={() => handleSelectFile(file)}
                  >
                    <i className={getFileIcon(file.source_type)} />
                    <span className="flex-grow-1 text-truncate">{file.name}</span>
                    <span className="text-muted small">{formatFileSize(file.size_bytes)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure Share */}
        {step === 'configure' && (
          <div>
            {selectedFile && (
              <div className="d-flex align-items-center gap-2 mb-3 p-2 bg-light rounded">
                <i className="bi bi-file-earmark-text" />
                <span className="fw-semibold">{selectedFile.name}</span>
                {!preSelectedFile && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ms-auto p-0"
                    onClick={() => {
                      setSelectedFile(null);
                      setStep('select');
                    }}
                  >
                    <i className="bi bi-x-lg" />
                  </Button>
                )}
              </div>
            )}

            <Form>
              <Form.Group className="mb-3">
                <Form.Label>{t('createShare.descriptionLabel')}</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  placeholder={t('createShare.descriptionPlaceholder')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Form.Group>

              <div className="row">
                <Form.Group className="col-md-6 mb-3">
                  <Form.Label>{t('createShare.expiryLabel')}</Form.Label>
                  <Form.Select
                    value={expiryHours ?? ''}
                    onChange={(e) => setExpiryHours(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">{t('createShare.expiryOptions.never')}</option>
                    <option value={168}>{t('createShare.expiryOptions.7')}</option>
                    <option value={336}>{t('createShare.expiryOptions.14')}</option>
                    <option value={720}>{t('createShare.expiryOptions.30')}</option>
                    <option value={2160}>{t('createShare.expiryOptions.90')}</option>
                  </Form.Select>
                </Form.Group>

                <Form.Group className="col-md-6 mb-3">
                  <Form.Label>{t('createShare.maxQuestionsLabel')}</Form.Label>
                  <Form.Control
                    type="number"
                    min={1}
                    placeholder={t('createShare.maxQuestionsPlaceholder')}
                    value={maxQuestions}
                    onChange={(e) => setMaxQuestions(e.target.value)}
                  />
                </Form.Group>
              </div>

              <div className="d-flex gap-4 mb-2">
                <Form.Check
                  type="switch"
                  id="enable-chat"
                  label={t('createShare.enableChat')}
                  checked={enableChat}
                  onChange={(e) => setEnableChat(e.target.checked)}
                />
                <Form.Check
                  type="switch"
                  id="allow-download"
                  label={t('createShare.allowDownload')}
                  checked={allowDownload}
                  onChange={(e) => setAllowDownload(e.target.checked)}
                />
              </div>
              <div className="d-flex gap-4 mb-3">
                <small className="text-muted flex-fill">{t('createShare.enableChatHelp')}</small>
                <small className="text-muted flex-fill">{t('createShare.allowDownloadHelp')}</small>
              </div>
            </Form>
          </div>
        )}

        {/* Step 3: Success */}
        {step === 'success' && shareResult && (
          <div className="text-center py-3">
            <i className="bi bi-check-circle text-success" style={{ fontSize: '3rem' }} />
            <h5 className="mt-2">{t('createShare.success')}</h5>

            <InputGroup className="mt-3">
              <Form.Control readOnly value={shareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <Button variant={copied ? 'success' : 'outline-primary'} onClick={handleCopy}>
                <i className={`bi ${copied ? 'bi-check' : 'bi-clipboard'} me-1`} />
                {copied ? t('createShare.copied') : t('createShare.copyLink')}
              </Button>
            </InputGroup>

            <div className="mt-3">
              <Button variant="outline-secondary" size="sm" onClick={() => window.open(shareUrl, '_blank')}>
                <i className="bi bi-box-arrow-up-right me-1" />
                {t('createShare.openShare')}
              </Button>
            </div>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        {step === 'configure' && (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={submitting}>
              {t('actions.cancel', { ns: 'common', defaultValue: 'Cancel' })}
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting || !selectedFile}>
              {submitting ? (
                <>
                  <Spinner size="sm" className="me-1" /> {t('createShare.creating')}
                </>
              ) : (
                t('createShare.createButton')
              )}
            </Button>
          </>
        )}
        {step === 'success' && (
          <Button variant="primary" onClick={handleClose}>
            {t('actions.done', { ns: 'common', defaultValue: 'Done' })}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};
