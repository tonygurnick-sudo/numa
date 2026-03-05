import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Form, Button, Spinner, Alert, InputGroup, ProgressBar } from 'react-bootstrap';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../../Providers/AuthProvider';
import { withPRM } from '../../utils/prmUtils';
import {
  listFolder,
  getDownloadUrl,
  buildS3Key,
  getFileIcon,
  formatFileSize,
  filePath as buildFilePath,
} from '../../Services/filesService';
import {
  createShare,
  createDropZone,
  getShareInfo,
  getDetailedShareError,
  DocumentProcessingError,
} from '../../Services/sharedChatService';
import type { CreateShareResponse, CreateDropZoneResponse } from '../../Services/sharedChatService';
import type { FileItem, FileScope } from '../../Services/filesService';
import { FolderTreeSelector } from '../FolderTreeSelector';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import type { UserKB } from '../../Services/knowledgeBaseService';
import { streamWorkspaceChatAgent } from '../../Services/workspaceChatAgentService';
import type { SDKEvent } from '../../types/workspaceChatTypes';
import { getEffectiveLanguage } from '../../utils/languagePreference';

/**
 * ARCHITECTURE NOTE: Files system uses DATA bucket as primary storage
 *
 * All user files should be saved to the data bucket for proper document extraction.
 * The shared document extraction process reads from the data bucket.
 */

interface CreateShareModalProps {
  show: boolean;
  onHide: () => void;
  onCreated: () => void;
  mode?: 'document' | 'dropzone';
  preSelectedFile?: FileItem;
  scope?: FileScope;
  currentPath?: string;
}

const DROPZONE_WIZARD_STEPS = [
  'folder', // 1. Folder selector
  'instructions', // 2. Freetext instructions
  'description', // 3. Freetext description
  'auth', // 4. Auth mode + passcode
  'expiry', // 5. Link expiry
  'limits', // 6. Max file size, total quota, file types
  'api', // 7. Allow API upload toggle
  'chat', // 8. Enable chat + max calls + KB attachment
  'review', // 9. Review all settings
] as const;

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant that answers questions about the shared document. Be concise and accurate. If the answer is not in the document, say so.';

const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 15; // ~60 seconds

const WIZARD_STEPS = [
  'file',
  'preview',
  'extract',
  'description',
  'kb',
  'expiry',
  'chat',
  'download',
  'review',
] as const;

/** Text file extensions that can be processed synchronously (no extraction needed) */
const TEXT_FILE_EXTENSIONS = [
  '.bash',
  '.cfg',
  '.conf',
  '.css',
  '.csv',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.less',
  '.log',
  '.markdown',
  '.md',
  '.py',
  '.scss',
  '.sh',
  '.sql',
  '.tex',
  '.ts',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
];

/** Document file extensions that require extraction */
const DOCUMENT_EXTENSIONS = ['.docx', '.xlsx', '.msg'];

/** Vision/image file extensions that require extraction */
const VISION_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];

/** Audio/video file extensions that require transcription */
const AUDIO_VIDEO_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.flac', '.ogg', '.amr', '.webm', '.m4a'];

const isTextFile = (name: string): boolean => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return TEXT_FILE_EXTENSIONS.includes(ext);
};

const isFileTypeSupported = (name: string): boolean => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return [...TEXT_FILE_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...VISION_EXTENSIONS, ...AUDIO_VIDEO_EXTENSIONS].includes(
    ext
  );
};

const needsExtraction = (name: string): boolean => !isTextFile(name);

const isImageFile = (name: string): boolean => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext);
};

// ---------------------------------------------------------------------------
// Step indicator component
// ---------------------------------------------------------------------------

const StepIndicator = ({
  currentStep,
  onStepClick,
  t,
  steps = WIZARD_STEPS,
  translationPrefix = 'createShare.wizard.steps',
}: {
  currentStep: number;
  onStepClick: (step: number) => void;
  t: (key: string) => string;
  steps?: readonly string[];
  translationPrefix?: string;
}) => {
  const stepLabels = steps.map((key) => t(`${translationPrefix}.${key}`));

  return (
    <div className="d-flex align-items-center justify-content-between mb-4 px-2">
      {stepLabels.map((label, idx) => {
        const stepNum = idx + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        const isFuture = stepNum > currentStep;

        return (
          <div key={idx} className="d-flex flex-column align-items-center" style={{ flex: 1, minWidth: 0 }}>
            <button
              type="button"
              className="btn p-0 border-0 bg-transparent"
              disabled={isFuture}
              onClick={() => !isFuture && onStepClick(stepNum)}
              style={{ cursor: isFuture ? 'default' : 'pointer' }}
            >
              <div
                className="d-flex align-items-center justify-content-center rounded-circle"
                style={{
                  width: 32,
                  height: 32,
                  fontSize: 13,
                  fontWeight: 600,
                  border: `2px solid ${isCurrent ? 'var(--bs-primary)' : isCompleted ? 'var(--bs-success)' : 'var(--bs-border-color)'}`,
                  backgroundColor: isCurrent ? 'var(--bs-primary)' : isCompleted ? 'var(--bs-success)' : 'transparent',
                  color: isCurrent || isCompleted ? '#fff' : 'var(--bs-secondary)',
                  transition: 'all 0.2s',
                }}
              >
                {isCompleted ? <i className="bi bi-check" /> : stepNum}
              </div>
            </button>
            <span
              className="text-truncate mt-1"
              style={{
                fontSize: 10,
                fontWeight: isCurrent ? 600 : 400,
                color: isFuture ? 'var(--bs-secondary)' : 'var(--bs-body-color)',
                maxWidth: '100%',
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CreateShareModal = ({
  show,
  onHide,
  onCreated,
  mode = 'document',
  preSelectedFile,
  scope: propScope,
  currentPath: propCurrentPath,
}: CreateShareModalProps) => {
  const { t } = useTranslation('files');
  const { getCredentials, user } = useAuth();

  const isDropzone = mode === 'dropzone';
  const effectiveScope = propScope ?? { type: 'my' as const };
  const effectiveCurrentPath = propCurrentPath ?? '/';

  // ─── Wizard step (document mode) ───────────────────────────────────
  const [wizardStep, setWizardStep] = useState(1);

  // ─── Dropzone wizard step ──────────────────────────────────────────
  const [dropzoneWizardStep, setDropzoneWizardStep] = useState(1);

  // ─── File selection state ──────────────────────────────────────────
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Drag and drop ─────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // ─── Configuration state ───────────────────────────────────────────
  const [description, setDescription] = useState('');
  const [expiryHours, setExpiryHours] = useState<number | null>(null);
  const [maxQuestions, setMaxQuestions] = useState(12);
  const [enableChat, setEnableChat] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);

  // ─── Phase 1: Content extraction state ─────────────────────────────
  const [extractedContent, setExtractedContent] = useState('');
  const [extractionStatus, setExtractionStatus] = useState<'idle' | 'streaming' | 'success' | 'error'>('idle');
  const extractionAbortRef = useRef<(() => void) | null>(null);

  // ─── Phase 2: Description generation state ────────────────────────
  const [descGenStatus, setDescGenStatus] = useState<'idle' | 'streaming' | 'success' | 'error'>('idle');
  const descGenAbortRef = useRef<(() => void) | null>(null);

  // ─── Knowledge Base selection state ────────────────────────────────
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [availableKbs, setAvailableKbs] = useState<UserKB[]>([]);
  const [kbsLoading, setKbsLoading] = useState(false);

  // ─── Dropzone-specific state ───────────────────────────────────────
  const [selectedFolder, setSelectedFolder] = useState('/');
  const [dropzoneScope, setDropzoneScope] = useState<FileScope>({ type: 'my' });
  const [instructions, setInstructions] = useState('');
  const [authMode, setAuthMode] = useState<'none' | 'passcode' | 'email'>('passcode');
  const [passcode, setPasscode] = useState('');
  const [maxFileSizeMb, setMaxFileSizeMb] = useState<string>('');
  const [totalQuotaMb, setTotalQuotaMb] = useState('');
  const [allowedExtensions, setAllowedExtensions] = useState('');
  const [enableApi, setEnableApi] = useState(true);
  const [dropzoneMaxQuestions, setDropzoneMaxQuestions] = useState('');

  // ─── Submit state ──────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Extraction polling ────────────────────────────────────────────
  const [extractionTimedOut, setExtractionTimedOut] = useState(false);
  const [specificError, setSpecificError] = useState<string | null>(null);

  // ─── Success state ─────────────────────────────────────────────────
  const [shareResult, setShareResult] = useState<CreateShareResponse | CreateDropZoneResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [passcodeCopied, setPasscodeCopied] = useState(false);

  // Derived
  const isExtracting = !isDropzone && wizardStep === 10; // virtual step for extraction polling

  // ─── Cleanup helpers (must be before effects that reference them) ──
  const cleanupExtraction = useCallback(() => {
    if (extractionAbortRef.current) {
      extractionAbortRef.current();
      extractionAbortRef.current = null;
    }
  }, []);

  const cleanupDescGen = useCallback(() => {
    if (descGenAbortRef.current) {
      descGenAbortRef.current();
      descGenAbortRef.current = null;
    }
  }, []);

  // ─── Reset on open/close ───────────────────────────────────────────
  useEffect(() => {
    if (show) {
      setWizardStep(preSelectedFile ? 2 : 1); // skip file selection if pre-selected
      setDropzoneWizardStep(1);
      setSelectedFile(preSelectedFile ?? null);
      setDescription('');
      setExpiryHours(null);
      setMaxQuestions(12);
      setEnableChat(true);
      setAllowDownload(true);
      setExtractedContent('');
      setExtractionStatus('idle');
      setDescGenStatus('idle');
      setSelectedKbId(null);
      setAvailableKbs([]);
      setKbsLoading(false);
      setSubmitting(false);
      setError(null);
      setShareResult(null);
      setCopied(false);
      setPasscodeCopied(false);
      setExtractionTimedOut(false);
      setSpecificError(null);
      setSelectedFolder('/');
      setInstructions(isDropzone ? t('dropzoneWizard.instructionsDefault') : '');
      setAuthMode('passcode');
      setPasscode('');
      setMaxFileSizeMb(isDropzone ? '10' : '');
      setTotalQuotaMb('');
      setAllowedExtensions('');
      setEnableApi(true);
      setDropzoneMaxQuestions(isDropzone ? '12' : '');
      cleanupExtraction();
      cleanupDescGen();
    }
  }, [show, preSelectedFile, isDropzone]);

  // ─── Load files for browse step ────────────────────────────────────
  useEffect(() => {
    if (show && !isDropzone && wizardStep === 1) {
      loadMyFiles();
    }
  }, [show, wizardStep, isDropzone]);

  // ─── Extraction polling ────────────────────────────────────────────
  useEffect(() => {
    if (!isExtracting || !shareResult) return;

    let attempts = 0;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      attempts++;

      try {
        const info = await getShareInfo(shareResult.uuid);
        if (cancelled) return;

        if (info.status === 'ready') {
          setWizardStep(11); // success
          return;
        }
        if (info.status === 'error') {
          let errorDetails = await getDetailedShareError(shareResult.uuid);

          if (!errorDetails && selectedFile?.name) {
            const ext = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase();
            if (['.pdf'].includes(ext)) {
              errorDetails =
                'PDF extraction failed. The file may be password-protected, corrupted, or temporarily unavailable.';
            } else if (['.docx', '.doc'].includes(ext)) {
              errorDetails =
                'Word document extraction failed. The file may be corrupted or contain unsupported formatting.';
            } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
              errorDetails =
                'Spreadsheet extraction failed. The file may be corrupted, too large, or temporarily unavailable.';
            } else if (['.mp3', '.mp4', '.wav', '.flac', '.ogg', '.amr', '.webm', '.m4a'].includes(ext)) {
              errorDetails =
                'Audio/video transcription failed. The file may be corrupted, too large, or temporarily unavailable.';
            } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
              errorDetails =
                'Image text extraction failed. The image may not contain readable text or may be temporarily unavailable.';
            } else {
              errorDetails = 'Document extraction failed. The file may be temporarily unavailable.';
            }
          }

          setSpecificError(errorDetails || 'Document processing failed. Please try again or choose a different file.');
          setExtractionTimedOut(true);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (!(err instanceof DocumentProcessingError)) {
          if (attempts >= MAX_POLL_ATTEMPTS) {
            setExtractionTimedOut(true);
            return;
          }
        }
      }

      if (attempts >= MAX_POLL_ATTEMPTS) {
        if (!cancelled) {
          try {
            const errorDetails = await getDetailedShareError(shareResult.uuid);
            if (errorDetails && errorDetails !== 'Document is still being processed') {
              setSpecificError(errorDetails);
            }
          } catch {
            // Ignore
          }
          setExtractionTimedOut(true);
        }
        return;
      }

      timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    };

    let timer = window.setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wizardStep, shareResult]);

  // ---------------------------------------------------------------------------
  // Phase 1: Content Extraction (workspace agent with file attachment)
  // ---------------------------------------------------------------------------

  const startExtraction = useCallback(
    async (file: FileItem) => {
      const userSub = (user?.decoded_tokens?.idToken?.sub as string) || '';
      if (!userSub) return;

      cleanupExtraction();
      setExtractionStatus('streaming');
      setExtractedContent('');

      const s3Key = buildS3Key(effectiveScope, file.name, effectiveCurrentPath, userSub);

      const prompt = `Extract and return the complete text content of the attached file. Return only the extracted text, no commentary or formatting.\n\nFile: ${file.name}\nS3 Key: ${s3Key}`;

      try {
        const { abort } = await streamWorkspaceChatAgent(
          {
            prompt,
            conversationId: `extract-${crypto.randomUUID()}`,
            attachments: {
              files: [
                {
                  path: s3Key,
                  filename: file.name,
                  size: file.size_bytes || 0,
                },
              ],
            },
            hasUploads: false,
            enabledTools: [],
            enabledConnections: [],
            responseMode: 'stream',
          },
          (event: SDKEvent) => {
            if (event.type === 'StreamEvent') {
              const streamEvent = (event as { event?: { type?: string; delta?: { type?: string; text?: string } } })
                .event;
              if (
                streamEvent?.type === 'content_block_delta' &&
                streamEvent.delta?.type === 'text_delta' &&
                streamEvent.delta.text
              ) {
                setExtractedContent((prev) => prev + streamEvent.delta!.text!);
              }
            }
          },
          () => {
            setExtractionStatus('success');
            extractionAbortRef.current = null;
          },
          (err: Error) => {
            console.error('Extraction failed:', err);
            setExtractionStatus('error');
            extractionAbortRef.current = null;
          }
        );
        extractionAbortRef.current = abort;
      } catch {
        setExtractionStatus('error');
      }
    },
    [user, effectiveScope, effectiveCurrentPath, cleanupExtraction]
  );

  // ---------------------------------------------------------------------------
  // Phase 2: Description Generation (workspace agent with extracted text)
  // ---------------------------------------------------------------------------

  const startDescriptionGen = useCallback(
    async (content: string) => {
      cleanupDescGen();
      setDescGenStatus('streaming');

      const language = getEffectiveLanguage();
      const prompt = `Write a brief 1-2 sentence description of the following document content, suitable for sharing with someone. Be concise and descriptive. Only output the description text, nothing else. Respond in ${language === 'browser' ? 'English' : language}.\n\nDocument content:\n${content.slice(0, 8000)}`;

      try {
        const { abort } = await streamWorkspaceChatAgent(
          {
            prompt,
            conversationId: `desc-gen-${crypto.randomUUID()}`,
            hasUploads: false,
            enabledTools: [],
            enabledConnections: [],
            responseMode: 'stream',
          },
          (event: SDKEvent) => {
            if (event.type === 'StreamEvent') {
              const streamEvent = (event as { event?: { type?: string; delta?: { type?: string; text?: string } } })
                .event;
              if (
                streamEvent?.type === 'content_block_delta' &&
                streamEvent.delta?.type === 'text_delta' &&
                streamEvent.delta.text
              ) {
                setDescription((prev) => prev + streamEvent.delta!.text!);
              }
            }
          },
          () => {
            setDescGenStatus('success');
            descGenAbortRef.current = null;
          },
          (err: Error) => {
            console.error('Description generation failed:', err);
            setDescGenStatus('error');
            descGenAbortRef.current = null;
          }
        );
        descGenAbortRef.current = abort;
      } catch {
        setDescGenStatus('error');
      }
    },
    [cleanupDescGen]
  );

  // ─── Auto-run content extraction when arriving at step 3 ───────────
  useEffect(() => {
    if (!isDropzone && wizardStep === 3 && selectedFile && extractionStatus === 'idle') {
      startExtraction(selectedFile);
    }
  }, [wizardStep, selectedFile, extractionStatus, isDropzone, startExtraction]);

  // ─── Auto-run description generation when arriving at step 4 ──────
  useEffect(() => {
    if (!isDropzone && wizardStep === 4 && extractedContent && !description && descGenStatus === 'idle') {
      startDescriptionGen(extractedContent);
    }
  }, [wizardStep, extractedContent, description, descGenStatus, isDropzone, startDescriptionGen]);

  // ─── Load KBs when arriving at step 5 ─────────────────────────────
  useEffect(() => {
    if (!isDropzone && wizardStep === 5 && availableKbs.length === 0 && !kbsLoading) {
      (async () => {
        setKbsLoading(true);
        try {
          const allKbs = await knowledgeBaseService.listUserKBs();
          allKbs.sort((a, b) => {
            if (a.kb_id === 'company') return -1;
            if (b.kb_id === 'company') return 1;
            return (a.kb_name ?? '').localeCompare(b.kb_name ?? '');
          });
          setAvailableKbs(allKbs);
        } catch {
          setAvailableKbs([]);
        } finally {
          setKbsLoading(false);
        }
      })();
    }
  }, [wizardStep, isDropzone, availableKbs.length, kbsLoading]);

  // ─── Load KBs for dropzone when arriving at step 8 (chat) ────────
  useEffect(() => {
    if (isDropzone && dropzoneWizardStep === 8 && enableChat && availableKbs.length === 0 && !kbsLoading) {
      (async () => {
        setKbsLoading(true);
        try {
          const allKbs = await knowledgeBaseService.listUserKBs();
          allKbs.sort((a, b) => {
            if (a.kb_id === 'company') return -1;
            if (b.kb_id === 'company') return 1;
            return (a.kb_name ?? '').localeCompare(b.kb_name ?? '');
          });
          setAvailableKbs(allKbs);
        } catch {
          setAvailableKbs([]);
        } finally {
          setKbsLoading(false);
        }
      })();
    }
  }, [dropzoneWizardStep, isDropzone, enableChat, availableKbs.length, kbsLoading]);

  // ---------------------------------------------------------------------------
  // File handlers
  // ---------------------------------------------------------------------------

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
      const bucket = sessionStorage.getItem('DATA_BUCKET');
      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;

      if (!bucket || !userSub) {
        setError(t('upload.configError'));
        return;
      }

      setUploadingFile(true);
      setError(null);

      try {
        const credentials = await getCredentials();
        if (!credentials) throw new Error('No credentials');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s3Client = withPRM(S3Client as any, { region, credentials });
        const uploadScope: FileScope = { type: 'my' };
        const s3Key = buildS3Key(uploadScope, file.name, '/', userSub);

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

        const fileItem: FileItem = {
          name: file.name,
          size_bytes: file.size,
          last_modified: new Date().toISOString(),
          parent_path: '/',
          is_folder: false,
        };
        setSelectedFile(fileItem);

        if (needsExtraction(file.name) && !isFileTypeSupported(file.name)) {
          setEnableChat(false);
        }

        setWizardStep(2);
      } catch (err) {
        setError(t('errors.uploadFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
      } finally {
        setUploadingFile(false);
      }
    },
    [user, getCredentials, t]
  );

  const handleSelectFile = useCallback((file: FileItem) => {
    setSelectedFile(file);
    if (needsExtraction(file.name) && !isFileTypeSupported(file.name)) {
      setEnableChat(false);
    }
    setWizardStep(2);
  }, []);

  // ---------------------------------------------------------------------------
  // Share submission
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return;

    setSubmitting(true);
    setError(null);
    setExtractionTimedOut(false);

    try {
      const fileScopePath = buildFilePath(selectedFile);
      const { url } = await getDownloadUrl(effectiveScope, fileScopePath);

      const result = await createShare({
        s3_signed_url: url,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        expiry_hours: expiryHours ?? undefined,
        max_calls: enableChat ? maxQuestions : 0,
        description: description || undefined,
        enable_chat: enableChat,
        allow_download: allowDownload,
        kb_id: selectedKbId ?? undefined,
      });

      setShareResult(result);

      if (result.status === 'ready') {
        setWizardStep(11); // success
      } else {
        setWizardStep(10); // extracting
      }

      onCreated();
    } catch (err) {
      setError(t('errors.shareFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedFile,
    effectiveScope,
    expiryHours,
    maxQuestions,
    description,
    enableChat,
    allowDownload,
    selectedKbId,
    onCreated,
    t,
  ]);

  const handleRetry = useCallback(() => {
    setError(null);
    setSpecificError(null);
    setExtractionTimedOut(false);
    setShareResult(null);
    setWizardStep(9); // back to review
  }, []);

  // ---------------------------------------------------------------------------
  // Dropzone submission (unchanged)
  // ---------------------------------------------------------------------------

  const handleDropzoneSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);

    try {
      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
      if (!userSub) throw new Error('User not authenticated');

      const pathSegment = selectedFolder.replace(/^\//, '');
      let s3FolderPrefix: string;
      if (dropzoneScope.type === 'company') {
        s3FolderPrefix = `files/company/${pathSegment}`;
      } else {
        s3FolderPrefix = `files/user/${userSub}/${pathSegment}`;
      }

      const result = await createDropZone({
        folder_path: selectedFolder,
        s3_folder_prefix: s3FolderPrefix,
        instructions,
        auth_mode: authMode,
        passcode: authMode === 'passcode' ? passcode : undefined,
        expiry_hours: expiryHours ?? undefined,
        max_file_size_mb: maxFileSizeMb ? parseInt(maxFileSizeMb, 10) : undefined,
        total_quota_mb: totalQuotaMb ? parseInt(totalQuotaMb, 10) : undefined,
        allowed_extensions: allowedExtensions
          ? allowedExtensions
              .split(',')
              .map((e) => e.trim())
              .filter(Boolean)
          : undefined,
        enable_api: enableApi,
        enable_chat: enableChat,
        description: description || undefined,
        max_calls: enableChat && dropzoneMaxQuestions ? parseInt(dropzoneMaxQuestions, 10) : undefined,
        kb_id: enableChat && selectedKbId ? selectedKbId : undefined,
      });

      setShareResult(result);
      setDropzoneWizardStep(10); // success
      onCreated();
    } catch (err) {
      setError(t('errors.dropzoneFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
    } finally {
      setSubmitting(false);
    }
  }, [
    user,
    selectedFolder,
    dropzoneScope,
    instructions,
    authMode,
    passcode,
    expiryHours,
    maxFileSizeMb,
    totalQuotaMb,
    allowedExtensions,
    enableApi,
    enableChat,
    description,
    dropzoneMaxQuestions,
    selectedKbId,
    onCreated,
    t,
  ]);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const shareUrl = shareResult
    ? `${window.location.origin}/${isDropzone ? 'dropzone' : 'shared'}/${shareResult.uuid}`
    : '';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleClose = () => {
    if (!submitting && !isExtracting) {
      cleanupExtraction();
      cleanupDescGen();
      onHide();
    }
  };

  const goNext = () => {
    if (wizardStep === 9) {
      handleSubmit();
    } else {
      setWizardStep((s) => Math.min(s + 1, 9));
    }
  };

  const goBack = () => {
    if (wizardStep === 3) cleanupExtraction();
    if (wizardStep === 4) cleanupDescGen();
    setWizardStep((s) => Math.max(s - 1, 1));
  };

  const jumpToStep = (step: number) => {
    if (step < wizardStep) {
      if (wizardStep === 3 && step !== 3) cleanupExtraction();
      if (wizardStep === 4 && step !== 4) cleanupDescGen();
      setWizardStep(step);
    }
  };

  const canGoNext = (): boolean => {
    switch (wizardStep) {
      case 1:
        return selectedFile !== null;
      default:
        return true;
    }
  };

  // ─── Dropzone wizard navigation ──────────────────────────────────
  const dzGoNext = () => {
    if (dropzoneWizardStep === DROPZONE_WIZARD_STEPS.length) {
      handleDropzoneSubmit();
    } else {
      setDropzoneWizardStep((s) => Math.min(s + 1, DROPZONE_WIZARD_STEPS.length));
    }
  };

  const dzGoBack = () => {
    setDropzoneWizardStep((s) => Math.max(s - 1, 1));
  };

  const dzJumpToStep = (step: number) => {
    if (step < dropzoneWizardStep) {
      setDropzoneWizardStep(step);
    }
  };

  const dzCanGoNext = (): boolean => {
    switch (dropzoneWizardStep) {
      case 4: // auth step: passcode required if passcode mode
        return authMode !== 'passcode' || passcode.trim().length > 0;
      default:
        return true;
    }
  };

  const dzExpiryLabel = (hours: number | null): string => {
    if (hours === null) return t('dropzoneWizard.reviewNever');
    const days = Math.round(hours / 24);
    return t('dropzoneWizard.reviewDays', { days });
  };

  // ---------------------------------------------------------------------------
  // Drag and drop (for step 1)
  // ---------------------------------------------------------------------------

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        const fileList = Array.from(e.dataTransfer.files);
        const fakeFileList = {
          0: fileList[0],
          length: 1,
          item: (index: number) => fileList[index] || null,
          [Symbol.iterator]: function* () {
            for (let i = 0; i < this.length; i++) {
              yield this[i];
            }
          },
        } as FileList;
        handleFileUpload(fakeFileList);
      }
    },
    [handleFileUpload]
  );

  // ---------------------------------------------------------------------------
  // Helper: expiry display
  // ---------------------------------------------------------------------------
  const expiryLabel = (hours: number | null): string => {
    if (hours === null) return t('createShare.wizard.reviewNever');
    const days = Math.round(hours / 24);
    return t('createShare.wizard.reviewDays', { days });
  };

  // ===================================================================
  // DROPZONE MODE — 9-step wizard
  // ===================================================================
  if (isDropzone) {
    const showDzStepIndicator = dropzoneWizardStep >= 1 && dropzoneWizardStep <= 9;
    const showDzFooterNav = dropzoneWizardStep >= 1 && dropzoneWizardStep <= 9;

    const renderDropzoneStep = () => {
      switch (dropzoneWizardStep) {
        // ─── Step 1: Select Folder ──────────────────────────────
        case 1:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.folderTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.folderHelp')}</p>
              <div className="btn-group mb-3 w-100" role="group">
                <button
                  type="button"
                  className={`btn btn-sm ${dropzoneScope.type === 'my' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => {
                    setDropzoneScope({ type: 'my' });
                    setSelectedFolder('/');
                  }}
                >
                  {t('tabs.myFiles')}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${dropzoneScope.type === 'company' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => {
                    setDropzoneScope({ type: 'company' });
                    setSelectedFolder('/');
                  }}
                >
                  {t('tabs.company')}
                </button>
              </div>
              <FolderTreeSelector
                selectedPath={selectedFolder}
                onPathChange={setSelectedFolder}
                scope={dropzoneScope}
              />
            </div>
          );

        // ─── Step 2: Instructions ───────────────────────────────
        case 2:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.instructionsTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.instructionsHelp')}</p>
              <Form.Control
                as="textarea"
                rows={8}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
          );

        // ─── Step 3: Description ────────────────────────────────
        case 3:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.descriptionTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.descriptionHelp')}</p>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder={t('dropzoneWizard.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          );

        // ─── Step 4: Authentication ─────────────────────────────
        case 4:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.authTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.authHelp')}</p>
              <div className="mb-3">
                <Form.Check
                  type="radio"
                  id="dz-auth-none"
                  label={t('dropzones.authNone')}
                  checked={authMode === 'none'}
                  onChange={() => setAuthMode('none')}
                  className="mb-2"
                />
                <Form.Check
                  type="radio"
                  id="dz-auth-passcode"
                  label={t('dropzones.authPasscode')}
                  checked={authMode === 'passcode'}
                  onChange={() => setAuthMode('passcode')}
                />
              </div>
              {authMode === 'passcode' && (
                <>
                  <Form.Control
                    type="text"
                    placeholder={t('dropzones.passcodePlaceholder')}
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                  />
                  <Form.Text className="text-muted">{t('dropzoneWizard.passcodeVisibleNote')}</Form.Text>
                </>
              )}
            </div>
          );

        // ─── Step 5: Expiry ─────────────────────────────────────
        case 5:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.expiryTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.expiryHelp')}</p>
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
            </div>
          );

        // ─── Step 6: Upload Limits ──────────────────────────────
        case 6:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.limitsTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.limitsHelp')}</p>
              <div className="row g-3 mb-3">
                <Form.Group className="col-md-6">
                  <Form.Label className="small fw-semibold">{t('dropzones.maxFileSize')}</Form.Label>
                  <Form.Select value={maxFileSizeMb} onChange={(e) => setMaxFileSizeMb(e.target.value)}>
                    <option value="">{t('dropzones.filesizeOptions.unlimited')}</option>
                    <option value="10">{t('dropzones.filesizeOptions.10')}</option>
                    <option value="50">{t('dropzones.filesizeOptions.50')}</option>
                    <option value="100">{t('dropzones.filesizeOptions.100')}</option>
                    <option value="500">{t('dropzones.filesizeOptions.500')}</option>
                  </Form.Select>
                </Form.Group>
                <Form.Group className="col-md-6">
                  <Form.Label className="small fw-semibold">{t('dropzones.totalQuota')}</Form.Label>
                  <Form.Control
                    type="number"
                    min={1}
                    placeholder={t('dropzones.totalQuotaPlaceholder')}
                    value={totalQuotaMb}
                    onChange={(e) => setTotalQuotaMb(e.target.value)}
                  />
                </Form.Group>
              </div>
              <Form.Group>
                <Form.Label className="small fw-semibold">{t('dropzones.allowedTypes')}</Form.Label>
                <Form.Control
                  placeholder={t('dropzones.allowedTypesPlaceholder')}
                  value={allowedExtensions}
                  onChange={(e) => setAllowedExtensions(e.target.value)}
                />
                <Form.Text className="text-muted">{t('dropzones.allowedTypesHelp')}</Form.Text>
              </Form.Group>
            </div>
          );

        // ─── Step 7: API ────────────────────────────────────────
        case 7:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.apiTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.apiHelp')}</p>
              <Form.Check
                type="switch"
                id="dz-wizard-enable-api"
                label={<span className="fw-semibold">{t('dropzones.enableApi')}</span>}
                checked={enableApi}
                onChange={(e) => setEnableApi(e.target.checked)}
              />
              <small className="text-muted d-block ms-4 ps-2">{t('dropzones.enableApiHelp')}</small>
            </div>
          );

        // ─── Step 8: Chat + KB ──────────────────────────────────
        case 8: {
          const companyKbs = availableKbs.filter((kb) => kb.kb_id === 'company');
          const personalKbs = availableKbs.filter((kb) => kb.role === 'OWNER' && kb.kb_id !== 'company');
          const sharedKbs = availableKbs.filter(
            (kb) => (kb.role === 'VIEWER' || kb.role === 'EDITOR') && kb.kb_id !== 'company'
          );

          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.chatTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.chatHelp')}</p>

              <Form.Check
                type="switch"
                id="dz-wizard-enable-chat"
                label={<span className="fw-semibold">{t('dropzones.enableChat')}</span>}
                checked={enableChat}
                onChange={(e) => setEnableChat(e.target.checked)}
                className="mb-3"
              />

              {enableChat && (
                <>
                  <Form.Group className="mb-3">
                    <Form.Label className="small fw-semibold">{t('dropzones.maxQuestions')}</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      max={100}
                      placeholder={t('dropzones.maxQuestionsPlaceholder')}
                      value={dropzoneMaxQuestions}
                      onChange={(e) => setDropzoneMaxQuestions(e.target.value)}
                    />
                    <Form.Text className="text-muted">{t('dropzones.maxQuestionsHelp')}</Form.Text>
                  </Form.Group>

                  <h6 className="mb-2 mt-4">{t('dropzoneWizard.chatKbTitle')}</h6>
                  <p className="text-muted small mb-3">{t('dropzoneWizard.chatKbHelp')}</p>

                  {kbsLoading ? (
                    <div className="text-center py-3">
                      <Spinner size="sm" className="me-2" />
                      <span className="text-muted">{t('createShare.wizard.kbLoading')}</span>
                    </div>
                  ) : (
                    <div className="list-group" style={{ maxHeight: 200, overflowY: 'auto' }}>
                      <button
                        type="button"
                        className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === null ? 'active' : ''}`}
                        onClick={() => setSelectedKbId(null)}
                      >
                        <i className="bi bi-x-circle" />
                        <span>{t('createShare.wizard.kbNone')}</span>
                      </button>

                      {companyKbs.map((kb) => (
                        <button
                          key={kb.kb_id}
                          type="button"
                          className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === kb.kb_id ? 'active' : ''}`}
                          onClick={() => setSelectedKbId(kb.kb_id)}
                        >
                          <i className="bi bi-building" />
                          <span className="flex-grow-1">{kb.kb_name || 'Company'}</span>
                        </button>
                      ))}

                      {personalKbs.map((kb) => (
                        <button
                          key={kb.kb_id}
                          type="button"
                          className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === kb.kb_id ? 'active' : ''}`}
                          onClick={() => setSelectedKbId(kb.kb_id)}
                        >
                          <i className="bi bi-person" />
                          <span className="flex-grow-1">{kb.kb_name}</span>
                        </button>
                      ))}

                      {sharedKbs.map((kb) => (
                        <button
                          key={kb.kb_id}
                          type="button"
                          className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === kb.kb_id ? 'active' : ''}`}
                          onClick={() => setSelectedKbId(kb.kb_id)}
                        >
                          <i className="bi bi-people" />
                          <span className="flex-grow-1">{kb.kb_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        }

        // ─── Step 9: Review ─────────────────────────────────────
        case 9: {
          const kbName = selectedKbId
            ? availableKbs.find((kb) => kb.kb_id === selectedKbId)?.kb_name || selectedKbId
            : t('dropzoneWizard.reviewNone');

          return (
            <div>
              <h6 className="mb-3">{t('dropzoneWizard.reviewTitle')}</h6>

              <div className="border rounded overflow-hidden">
                <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewFolder')}</span>
                  <span className="fw-semibold">{selectedFolder || '/'}</span>
                </div>

                <div className="d-flex justify-content-between align-items-start p-3 border-bottom">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewInstructions')}</span>
                  <span className="text-end text-truncate" style={{ maxWidth: '60%', fontSize: 13 }}>
                    {instructions ? (
                      instructions.slice(0, 80) + (instructions.length > 80 ? '...' : '')
                    ) : (
                      <em className="text-muted">{t('dropzoneWizard.reviewNoInstructions')}</em>
                    )}
                  </span>
                </div>

                <div className="d-flex justify-content-between align-items-start p-3 border-bottom bg-light">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewDescription')}</span>
                  <span className="text-end" style={{ maxWidth: '60%', fontSize: 13 }}>
                    {description || <em className="text-muted">{t('dropzoneWizard.reviewNoDescription')}</em>}
                  </span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewAuth')}</span>
                  <span>{authMode === 'passcode' ? t('dropzones.authPasscode') : t('dropzones.authNone')}</span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewExpiry')}</span>
                  <span>{dzExpiryLabel(expiryHours)}</span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewMaxFileSize')}</span>
                  <span>{maxFileSizeMb ? `${maxFileSizeMb} MB` : t('dropzoneWizard.reviewNoLimit')}</span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewTotalQuota')}</span>
                  <span>{totalQuotaMb ? `${totalQuotaMb} MB` : t('dropzoneWizard.reviewNoLimit')}</span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewAllowedTypes')}</span>
                  <span>{allowedExtensions || t('dropzoneWizard.reviewAllTypes')}</span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewApi')}</span>
                  <span className={enableApi ? 'text-success' : 'text-muted'}>
                    {enableApi ? t('dropzoneWizard.reviewEnabled') : t('dropzoneWizard.reviewDisabled')}
                  </span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                  <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewChat')}</span>
                  <span className={enableChat ? 'text-success' : 'text-muted'}>
                    {enableChat ? t('dropzoneWizard.reviewEnabled') : t('dropzoneWizard.reviewDisabled')}
                  </span>
                </div>

                {enableChat && (
                  <>
                    <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                      <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewMaxQuestions')}</span>
                      <span>{dropzoneMaxQuestions || t('dropzoneWizard.reviewNoLimit')}</span>
                    </div>
                    <div className="d-flex justify-content-between align-items-center p-3">
                      <span className="small fw-semibold text-muted">{t('dropzoneWizard.reviewKb')}</span>
                      <span>{kbName}</span>
                    </div>
                  </>
                )}

                {!enableChat && <div style={{ display: 'none' }} />}
              </div>

              {error && (
                <Alert variant="danger" className="mt-3" dismissible onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
            </div>
          );
        }

        default:
          return null;
      }
    };

    // ─── Dropzone success screen ──────────────────────────────────
    const renderDropzoneSuccess = () => (
      <div className="text-center py-3">
        <i className="bi bi-cloud-upload text-success" style={{ fontSize: '3rem' }} />
        <h5 className="mt-2 text-success">{t('dropzones.successTitle')}</h5>
        <p className="text-muted mb-3">{t('dropzones.successMessage')}</p>

        <InputGroup className="mt-3">
          <Form.Control readOnly value={shareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
          <Button variant={copied ? 'success' : 'outline-primary'} onClick={handleCopy}>
            <i className={`bi ${copied ? 'bi-check' : 'bi-clipboard'} me-1`} />
            {copied ? t('createShare.copied') : t('dropzones.copyUrl')}
          </Button>
        </InputGroup>

        {authMode === 'passcode' && passcode && (
          <div className="mt-3 text-start">
            <Alert variant="info" className="py-2">
              <div className="d-flex align-items-center justify-content-between">
                <div>
                  <strong>{t('dropzones.passcodeNotice')}</strong> <code>{passcode}</code>
                </div>
                <Button
                  variant={passcodeCopied ? 'success' : 'outline-info'}
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(passcode);
                    setPasscodeCopied(true);
                    setTimeout(() => setPasscodeCopied(false), 2000);
                  }}
                >
                  <i className={`bi ${passcodeCopied ? 'bi-check' : 'bi-clipboard'} me-1`} />
                  {passcodeCopied ? t('createShare.copied') : t('dropzones.copyPasscode')}
                </Button>
              </div>
            </Alert>
          </div>
        )}

        {enableApi && (
          <div className="mt-2 text-start">
            <Alert variant="light" className="py-2 border">
              <i className="bi bi-code-slash me-1" />
              {t('dropzones.apiNotice')}
            </Alert>
          </div>
        )}

        <div className="mt-3">
          <Button variant="outline-secondary" size="sm" onClick={() => window.open(shareUrl, '_blank')}>
            <i className="bi bi-box-arrow-up-right me-1" />
            {t('createShare.openShare')}
          </Button>
        </div>
      </div>
    );

    return (
      <Modal show={show} onHide={handleClose} backdrop={submitting ? 'static' : true} size="lg">
        <Modal.Header closeButton={!submitting}>
          <Modal.Title>{t('dropzones.editTitle')}</Modal.Title>
        </Modal.Header>

        <Modal.Body style={{ minHeight: showDzStepIndicator ? 420 : undefined }}>
          {showDzStepIndicator && (
            <StepIndicator
              currentStep={dropzoneWizardStep}
              onStepClick={dzJumpToStep}
              t={t}
              steps={DROPZONE_WIZARD_STEPS}
              translationPrefix="dropzoneWizard.steps"
            />
          )}

          {error && dropzoneWizardStep !== 9 && (
            <Alert variant="danger" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {dropzoneWizardStep >= 1 && dropzoneWizardStep <= 9 && renderDropzoneStep()}
          {dropzoneWizardStep === 10 && renderDropzoneSuccess()}
        </Modal.Body>

        {showDzFooterNav && (
          <Modal.Footer>
            {dropzoneWizardStep > 1 && (
              <Button variant="secondary" onClick={dzGoBack}>
                <i className="bi bi-arrow-left me-1" />
                {t('dropzoneWizard.back')}
              </Button>
            )}
            {dropzoneWizardStep === 1 && (
              <Button variant="secondary" onClick={handleClose}>
                {t('upload.cancel')}
              </Button>
            )}
            <div className="flex-grow-1" />
            {dropzoneWizardStep < 9 && (
              <Button variant="primary" onClick={dzGoNext} disabled={!dzCanGoNext()}>
                {t('dropzoneWizard.next')}
                <i className="bi bi-arrow-right ms-1" />
              </Button>
            )}
            {dropzoneWizardStep === 9 && (
              <Button variant="primary" onClick={dzGoNext} disabled={submitting}>
                {submitting ? (
                  <>
                    <Spinner size="sm" className="me-1" /> {t('dropzoneWizard.creating')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-cloud-upload me-1" />
                    {t('dropzoneWizard.create')}
                  </>
                )}
              </Button>
            )}
          </Modal.Footer>
        )}

        {dropzoneWizardStep === 10 && (
          <Modal.Footer>
            <Button variant="primary" onClick={handleClose}>
              {t('upload.done')}
            </Button>
          </Modal.Footer>
        )}
      </Modal>
    );
  }

  // ===================================================================
  // DOCUMENT MODE — 9-step wizard
  // ===================================================================

  const renderWizardStep = () => {
    switch (wizardStep) {
      // ─── Step 1: Select / Upload File ────────────────────────────
      case 1:
        return (
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{ position: 'relative' }}
          >
            {isDragging && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(13, 110, 253, 0.08)',
                  border: '2px dashed var(--bs-primary)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: 'var(--bs-primary)',
                    fontWeight: '500',
                  }}
                >
                  <i className="bi bi-cloud-upload" style={{ fontSize: '3rem' }} />
                  <span style={{ fontSize: '1.25rem' }}>{t('createShare.dropFileToShare')}</span>
                </div>
              </div>
            )}

            <p className="text-muted mb-3">{t('createShare.selectFile')}</p>

            <div
              className="mb-3 p-3 border border-2 border-dashed rounded text-center"
              style={{ borderColor: 'var(--bs-border-color)' }}
            >
              <i className="bi bi-cloud-upload text-muted" style={{ fontSize: '2rem' }} />
              <p className="mb-2 text-muted">
                <strong>{t('createShare.dragAndDropFile')}</strong>
              </p>
              <Button variant="outline-primary" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}>
                {uploadingFile ? (
                  <>
                    <Spinner size="sm" className="me-1" /> {t('upload.uploading')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-folder2-open me-1" /> {t('createShare.orBrowseFiles')}
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
                    key={file.name}
                    type="button"
                    className="list-group-item list-group-item-action d-flex align-items-center gap-2"
                    onClick={() => handleSelectFile(file)}
                  >
                    <i className={getFileIcon(file.name)} />
                    <span className="flex-grow-1 text-truncate">{file.name}</span>
                    <span className="text-muted small">{formatFileSize(file.size_bytes)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );

      // ─── Step 2: Preview ─────────────────────────────────────────
      case 2:
        return (
          <div>
            <h6 className="mb-3">{t('createShare.wizard.previewTitle')}</h6>
            {selectedFile && (
              <div className="d-flex flex-column align-items-center gap-3">
                <div className="d-flex align-items-center gap-2 p-3 border rounded bg-light w-100">
                  <i className={`${getFileIcon(selectedFile.name)}`} style={{ fontSize: '2rem' }} />
                  <div className="flex-grow-1">
                    <div className="fw-semibold">{selectedFile.name}</div>
                    <div className="text-muted small">{formatFileSize(selectedFile.size_bytes)}</div>
                  </div>
                </div>

                {isImageFile(selectedFile.name) && (
                  <div className="border rounded p-2 text-center w-100" style={{ maxHeight: 300, overflow: 'hidden' }}>
                    <ImagePreviewInline file={selectedFile} scope={effectiveScope} currentPath={effectiveCurrentPath} />
                  </div>
                )}

                {selectedFile && needsExtraction(selectedFile.name) && (
                  <>
                    {isFileTypeSupported(selectedFile.name) ? (
                      <div
                        className="d-flex align-items-start gap-2 p-2 rounded w-100"
                        style={{ backgroundColor: 'rgba(13, 110, 253, 0.06)' }}
                      >
                        <i className="bi bi-info-circle text-primary mt-1" />
                        <small className="text-muted">{t('createShare.extractionNotice')}</small>
                      </div>
                    ) : (
                      <div
                        className="d-flex align-items-start gap-2 p-2 rounded w-100"
                        style={{ backgroundColor: 'rgba(255, 193, 7, 0.1)' }}
                      >
                        <i className="bi bi-exclamation-triangle text-warning mt-1" />
                        <div>
                          <small className="text-warning fw-semibold d-block">
                            {t('createShare.extractionUnsupported')}
                          </small>
                          <small className="text-muted">{t('createShare.unsupportedFileTypes')}</small>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );

      // ─── Step 3: Content Extraction ─────────────────────────────
      case 3:
        return (
          <div>
            <h6 className="mb-2">{t('createShare.wizard.extractionTitle')}</h6>
            <p className="text-muted small mb-3">{t('createShare.wizard.extractionExplain')}</p>

            {/* Loading state: scanning document animation */}
            {extractionStatus === 'streaming' && !extractedContent && (
              <div className="text-center py-4">
                <div className="extraction-icon mb-3" style={{ fontSize: '2.5rem', color: 'var(--bs-primary)' }}>
                  <i className="bi bi-file-text" />
                </div>
                <p className="text-muted mb-1">{t('createShare.wizard.extractionGenerating')}</p>
                <p className="text-muted small">{t('createShare.wizard.extractionGeneratingDetail')}</p>
              </div>
            )}

            {/* Extracted content in scrollable box */}
            {extractedContent && (
              <div
                className="p-3 border rounded bg-light"
                style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 250, overflowY: 'auto' }}
              >
                {extractedContent}
                {extractionStatus === 'streaming' && <span className="text-muted">|</span>}
              </div>
            )}

            {/* Error state */}
            {extractionStatus === 'error' && (
              <div className="text-center py-4">
                <i className="bi bi-exclamation-triangle text-warning d-block mb-2" style={{ fontSize: '2rem' }} />
                <p className="text-muted">{t('createShare.wizard.extractionError')}</p>
                <div className="d-flex gap-2 justify-content-center mt-2">
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => {
                      setExtractionStatus('idle');
                    }}
                  >
                    {t('createShare.wizard.extractionRetry')}
                  </Button>
                  <Button variant="outline-secondary" size="sm" onClick={goNext}>
                    {t('createShare.wizard.extractionSkip')}
                  </Button>
                </div>
              </div>
            )}

            {/* Idle fallback */}
            {extractionStatus === 'idle' && !extractedContent && (
              <div className="text-center py-4 text-muted">
                <div className="extraction-icon mb-2" style={{ fontSize: '2.5rem' }}>
                  <i className="bi bi-file-text" />
                </div>
                <p>{t('createShare.wizard.extractionGenerating')}</p>
              </div>
            )}

            {/* Skip link */}
            {(extractionStatus === 'streaming' || extractionStatus === 'idle') && (
              <div className="text-center mt-3">
                <button className="btn btn-link btn-sm text-muted" onClick={goNext}>
                  {t('createShare.wizard.extractionSkip')} <i className="bi bi-arrow-right ms-1" />
                </button>
              </div>
            )}
          </div>
        );

      // ─── Step 4: AI Description Generation ─────────────────────
      case 4:
        return (
          <div>
            <h6 className="mb-2">{t('createShare.wizard.descriptionTitle')}</h6>
            <p className="text-muted small mb-3">{t('createShare.wizard.descriptionExplain')}</p>

            {/* Loading state: sparkle animation */}
            {descGenStatus === 'streaming' && !description && (
              <div className="text-center py-4">
                <div className="sparkle-animation mb-3" style={{ fontSize: '2.5rem', color: 'var(--bs-primary)' }}>
                  <i className="bi bi-stars" />
                </div>
                <p className="text-muted mb-1">{t('createShare.wizard.descriptionGenerating')}</p>
                <p className="text-muted small">{t('createShare.wizard.descriptionGeneratingDetail')}</p>
              </div>
            )}

            {/* Editable description textarea (shows once content starts streaming or user types) */}
            {(description || descGenStatus === 'success' || descGenStatus === 'error' || descGenStatus === 'idle') && (
              <>
                <Form.Control
                  as="textarea"
                  rows={4}
                  placeholder={t('createShare.descriptionPlaceholder')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={descGenStatus === 'streaming'}
                />
                {descGenStatus === 'streaming' && (
                  <div className="d-flex align-items-center gap-2 mt-2">
                    <div className="sparkle-animation" style={{ fontSize: '1rem', color: 'var(--bs-primary)' }}>
                      <i className="bi bi-stars" />
                    </div>
                    <small className="text-muted">{t('createShare.wizard.descriptionGenerating')}</small>
                  </div>
                )}
              </>
            )}

            {/* Error state */}
            {descGenStatus === 'error' && (
              <div className="text-center mt-3">
                <small className="text-warning">
                  <i className="bi bi-exclamation-triangle me-1" />
                  {t('createShare.wizard.extractionError')}
                </small>
              </div>
            )}

            <p className="text-muted small mt-3">{t('createShare.wizard.descriptionHelp')}</p>
          </div>
        );

      // ─── Step 5: Knowledge Base ───────────────────────────────────
      case 5: {
        const companyKbs = availableKbs.filter((kb) => kb.kb_id === 'company');
        const personalKbs = availableKbs.filter((kb) => kb.role === 'OWNER' && kb.kb_id !== 'company');
        const sharedKbs = availableKbs.filter(
          (kb) => (kb.role === 'VIEWER' || kb.role === 'EDITOR') && kb.kb_id !== 'company'
        );

        return (
          <div>
            <h6 className="mb-2">{t('createShare.wizard.kbTitle')}</h6>
            <p className="text-muted small mb-3">{t('createShare.wizard.kbExplain')}</p>

            {kbsLoading ? (
              <div className="text-center py-4">
                <Spinner size="sm" className="me-2" />
                <span className="text-muted">{t('createShare.wizard.kbLoading')}</span>
              </div>
            ) : (
              <div className="list-group" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {/* None option */}
                <button
                  type="button"
                  className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === null ? 'active' : ''}`}
                  onClick={() => setSelectedKbId(null)}
                >
                  <i className="bi bi-x-circle" />
                  <span>{t('createShare.wizard.kbNone')}</span>
                </button>

                {/* Company KBs */}
                {companyKbs.length > 0 && (
                  <>
                    <div className="list-group-item bg-light py-1 px-3 small fw-semibold text-muted">
                      <i className="bi bi-building me-1" />
                      {t('createShare.wizard.kbCompanyLabel')}
                    </div>
                    {companyKbs.map((kb) => (
                      <button
                        key={kb.kb_id}
                        type="button"
                        className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === kb.kb_id ? 'active' : ''}`}
                        onClick={() => setSelectedKbId(kb.kb_id)}
                      >
                        <i className="bi bi-database" />
                        <span className="flex-grow-1">{kb.kb_name || 'Company'}</span>
                        {kb.document_count !== undefined && (
                          <span
                            className={`badge ${selectedKbId === kb.kb_id ? 'bg-light text-primary' : 'bg-primary-subtle text-primary'}`}
                          >
                            {kb.document_count}
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {/* Personal KBs */}
                {personalKbs.length > 0 && (
                  <>
                    <div className="list-group-item bg-light py-1 px-3 small fw-semibold text-muted">
                      <i className="bi bi-person me-1" />
                      {t('createShare.wizard.kbPersonalLabel')}
                    </div>
                    {personalKbs.map((kb) => (
                      <button
                        key={kb.kb_id}
                        type="button"
                        className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === kb.kb_id ? 'active' : ''}`}
                        onClick={() => setSelectedKbId(kb.kb_id)}
                      >
                        <i className="bi bi-database" />
                        <span className="flex-grow-1">{kb.kb_name}</span>
                        {kb.document_count !== undefined && (
                          <span
                            className={`badge ${selectedKbId === kb.kb_id ? 'bg-light text-primary' : 'bg-primary-subtle text-primary'}`}
                          >
                            {kb.document_count}
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {/* Shared KBs */}
                {sharedKbs.length > 0 && (
                  <>
                    <div className="list-group-item bg-light py-1 px-3 small fw-semibold text-muted">
                      <i className="bi bi-people me-1" />
                      {t('createShare.wizard.kbSharedLabel')}
                    </div>
                    {sharedKbs.map((kb) => (
                      <button
                        key={kb.kb_id}
                        type="button"
                        className={`list-group-item list-group-item-action d-flex align-items-center gap-2 ${selectedKbId === kb.kb_id ? 'active' : ''}`}
                        onClick={() => setSelectedKbId(kb.kb_id)}
                      >
                        <i className="bi bi-database" />
                        <span className="flex-grow-1">{kb.kb_name}</span>
                        {kb.document_count !== undefined && (
                          <span
                            className={`badge ${selectedKbId === kb.kb_id ? 'bg-light text-primary' : 'bg-primary-subtle text-primary'}`}
                          >
                            {kb.document_count}
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      }

      // ─── Step 6: Link Expiry ─────────────────────────────────────
      case 6:
        return (
          <div>
            <h6 className="mb-2">{t('createShare.wizard.expiryTitle')}</h6>
            <p className="text-muted small mb-3">{t('createShare.wizard.expiryHelp')}</p>
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
          </div>
        );

      // ─── Step 7: Chat & Questions ────────────────────────────────
      case 7:
        return (
          <div>
            <h6 className="mb-3">{t('createShare.wizard.chatTitle')}</h6>

            <Form.Check
              type="switch"
              id="wizard-enable-chat"
              label={<span className="fw-semibold">{t('createShare.enableChat')}</span>}
              checked={enableChat && (!selectedFile || isFileTypeSupported(selectedFile.name))}
              disabled={
                selectedFile ? needsExtraction(selectedFile.name) && !isFileTypeSupported(selectedFile.name) : false
              }
              onChange={(e) => setEnableChat(e.target.checked)}
            />
            <small className="text-muted d-block ms-4 ps-2 mb-3">{t('createShare.wizard.enableChatHelp')}</small>

            {enableChat && (
              <Form.Group>
                <Form.Label className="small fw-semibold">{t('createShare.wizard.maxQuestionsLabel')}</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={100}
                  value={maxQuestions}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) {
                      setMaxQuestions(Math.max(1, Math.min(100, val)));
                    }
                  }}
                />
                <Form.Text className="text-muted">{t('createShare.wizard.maxQuestionsHelp')}</Form.Text>
              </Form.Group>
            )}
          </div>
        );

      // ─── Step 8: Download Permission ─────────────────────────────
      case 8:
        return (
          <div>
            <h6 className="mb-3">{t('createShare.wizard.downloadTitle')}</h6>

            <Form.Check
              type="switch"
              id="wizard-allow-download"
              label={<span className="fw-semibold">{t('createShare.allowDownload')}</span>}
              checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
            />
            <small className="text-muted d-block ms-4 ps-2">{t('createShare.wizard.allowDownloadHelp')}</small>
          </div>
        );

      // ─── Step 9: Review & Share ──────────────────────────────────
      case 9:
        return (
          <div>
            <h6 className="mb-3">{t('createShare.wizard.reviewTitle')}</h6>

            <div className="border rounded overflow-hidden">
              {/* File */}
              <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                <span className="small fw-semibold text-muted">{t('createShare.wizard.reviewFile')}</span>
                <div className="d-flex align-items-center gap-2">
                  {selectedFile && <i className={getFileIcon(selectedFile.name)} />}
                  <span className="fw-semibold">{selectedFile?.name}</span>
                </div>
              </div>

              {/* Description */}
              <div className="d-flex justify-content-between align-items-start p-3 border-bottom">
                <span className="small fw-semibold text-muted">{t('createShare.wizard.reviewDescription')}</span>
                <span className="text-end" style={{ maxWidth: '60%', fontSize: 13 }}>
                  {description || <em className="text-muted">{t('createShare.wizard.reviewNoDescription')}</em>}
                </span>
              </div>

              {/* Knowledge Base */}
              <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                <span className="small fw-semibold text-muted">{t('createShare.wizard.reviewKB')}</span>
                <span>
                  {selectedKbId
                    ? availableKbs.find((kb) => kb.kb_id === selectedKbId)?.kb_name || selectedKbId
                    : t('createShare.wizard.kbNone')}
                </span>
              </div>

              {/* Expiry */}
              <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                <span className="small fw-semibold text-muted">{t('createShare.wizard.reviewExpiry')}</span>
                <span>{expiryLabel(expiryHours)}</span>
              </div>

              {/* Chat */}
              <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                <span className="small fw-semibold text-muted">{t('createShare.wizard.reviewChat')}</span>
                <span className={enableChat ? 'text-success' : 'text-muted'}>
                  {enableChat ? t('createShare.wizard.reviewEnabled') : t('createShare.wizard.reviewDisabled')}
                </span>
              </div>

              {/* Max questions */}
              {enableChat && (
                <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                  <span className="small fw-semibold text-muted">{t('createShare.wizard.reviewMaxQuestions')}</span>
                  <span>{maxQuestions}</span>
                </div>
              )}

              {/* Download */}
              <div className="d-flex justify-content-between align-items-center p-3">
                <span className="small fw-semibold text-muted">{t('createShare.wizard.reviewDownload')}</span>
                <span className={allowDownload ? 'text-success' : 'text-muted'}>
                  {allowDownload ? t('createShare.wizard.reviewEnabled') : t('createShare.wizard.reviewDisabled')}
                </span>
              </div>
            </div>

            {error && (
              <Alert variant="danger" className="mt-3" dismissible onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ─── Extraction step (virtual step 9) ────────────────────────────
  const renderExtracting = () => (
    <div className="text-center py-4">
      {selectedFile && (
        <div className="d-flex align-items-center gap-2 p-2 border rounded bg-light mb-3 justify-content-center">
          <i className={`${getFileIcon(selectedFile.name)} fs-5`} />
          <span className="fw-semibold text-truncate">{selectedFile.name}</span>
        </div>
      )}

      {!extractionTimedOut ? (
        <>
          <ProgressBar animated striped now={100} className="mb-3" style={{ height: '8px' }} />
          <h6 className="mb-1">{t('createShare.extracting')}</h6>
          <small className="text-muted">{t('createShare.extractingDetail')}</small>
        </>
      ) : (
        <>
          {specificError ? (
            <Alert variant="danger" className="text-start mb-3">
              <div className="d-flex align-items-start gap-2">
                <i className="bi bi-exclamation-triangle text-danger mt-1 flex-shrink-0" />
                <div>
                  <div className="fw-semibold mb-1">{t('createShare.processingFailed')}</div>
                  <div className="mb-2" style={{ fontSize: '0.9rem' }}>
                    {specificError}
                  </div>
                  <div className="small text-muted">
                    <strong>{t('createShare.troubleshootingTitle')}</strong>
                    <ul className="mb-1 mt-1">
                      <li>{t('createShare.troubleshootingTips.simpleFormat')}</li>
                      <li>{t('createShare.troubleshootingTips.notProtected')}</li>
                      <li>{t('createShare.troubleshootingTips.fileSize')}</li>
                      <li>{t('createShare.troubleshootingTips.pdfText')}</li>
                      <li>{t('createShare.troubleshootingTips.officeDocs')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </Alert>
          ) : (
            <Alert variant="info" className="text-start mb-3">
              <div className="d-flex align-items-start gap-2">
                <i className="bi bi-clock-history text-info mt-1" />
                <div>
                  <div className="fw-semibold">{t('createShare.extractionTimeout')}</div>
                  <div className="small text-muted mt-1">{t('createShare.processingLong')}</div>
                </div>
              </div>
            </Alert>
          )}
          <div className="d-flex gap-2 justify-content-center">
            <Button variant="primary" onClick={handleRetry}>
              <i className="bi bi-arrow-clockwise me-1" />
              {t('createShare.tryAgain')}
            </Button>
            {!specificError && (
              <Button variant="outline-secondary" onClick={() => setWizardStep(11)}>
                <i className="bi bi-link-45deg me-1" />
                {t('createShare.viewAnyway')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );

  // ─── Success step (virtual step 10) ──────────────────────────────
  const renderSuccess = () => (
    <div className="text-center py-3">
      {specificError ? (
        <>
          <i className="bi bi-exclamation-triangle text-warning" style={{ fontSize: '3rem' }} />
          <h5 className="mt-2 text-warning">{t('createShare.shareLinkCreatedNoAI')}</h5>
          <Alert variant="warning" className="text-start mt-3 mb-3">
            <div className="d-flex align-items-start gap-2">
              <i className="bi bi-exclamation-circle text-warning mt-1 flex-shrink-0" />
              <div>
                <div className="fw-semibold mb-1">{t('createShare.processingFailed')}</div>
                <div className="mb-2" style={{ fontSize: '0.9rem' }}>
                  {specificError}
                </div>
                <div className="fw-semibold mb-1">{t('createShare.whatThisMeans')}</div>
                <ul className="mb-2 small">
                  <li>
                    <i className="bi bi-check-circle text-success me-1"></i>
                    {t('createShare.shareWorksForViewing')}
                  </li>
                  <li>
                    <i className="bi bi-x-circle text-danger me-1"></i>
                    {t('createShare.aiChatNotWork')}
                  </li>
                  <li>
                    <i className="bi bi-arrow-repeat text-primary me-1"></i>
                    {t('createShare.tryDifferentFormat')}
                  </li>
                </ul>
                <div className="small text-muted">
                  <strong>{t('createShare.tip')}</strong> {t('createShare.textFilesWorkBest')}
                </div>
              </div>
            </div>
          </Alert>
        </>
      ) : (
        <>
          <i className="bi bi-check-circle text-success" style={{ fontSize: '3rem' }} />
          <h5 className="mt-2 text-success">{t('createShare.shareLinkReady')}</h5>
          <p className="text-muted mb-3">{t('createShare.shareLinkReadyMessage')}</p>
        </>
      )}

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
  );

  // ===================================================================
  // Render
  // ===================================================================

  const showStepIndicator = wizardStep >= 1 && wizardStep <= 9;
  const showFooterNav = wizardStep >= 1 && wizardStep <= 9;

  return (
    <Modal show={show} onHide={handleClose} backdrop={submitting || isExtracting ? 'static' : true} size="lg">
      <Modal.Header closeButton={!submitting && !isExtracting}>
        <Modal.Title>{t('createShare.title')}</Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ minHeight: wizardStep >= 1 && wizardStep <= 9 ? 420 : undefined }}>
        {showStepIndicator && <StepIndicator currentStep={wizardStep} onStepClick={jumpToStep} t={t} />}

        {error && wizardStep !== 9 && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {wizardStep >= 1 && wizardStep <= 9 && renderWizardStep()}
        {wizardStep === 10 && renderExtracting()}
        {wizardStep === 11 && renderSuccess()}
      </Modal.Body>

      {showFooterNav && (
        <Modal.Footer>
          {wizardStep > 1 && (
            <Button variant="secondary" onClick={goBack}>
              <i className="bi bi-arrow-left me-1" />
              {t('createShare.wizard.back')}
            </Button>
          )}
          {wizardStep === 1 && (
            <Button variant="secondary" onClick={handleClose}>
              {t('upload.cancel')}
            </Button>
          )}
          <div className="flex-grow-1" />
          {wizardStep < 9 && (
            <Button variant="primary" onClick={goNext} disabled={!canGoNext()}>
              {t('createShare.wizard.next')}
              <i className="bi bi-arrow-right ms-1" />
            </Button>
          )}
          {wizardStep === 9 && (
            <Button variant="primary" onClick={goNext} disabled={submitting || !selectedFile}>
              {submitting ? (
                <>
                  <Spinner size="sm" className="me-1" /> {t('createShare.creating')}
                </>
              ) : (
                <>
                  <i className="bi bi-link-45deg me-1" />
                  {t('createShare.wizard.createShareButton')}
                </>
              )}
            </Button>
          )}
        </Modal.Footer>
      )}

      {(wizardStep === 10 || wizardStep === 11) && (
        <Modal.Footer>
          {wizardStep === 11 && (
            <Button variant="primary" onClick={handleClose}>
              {t('upload.done')}
            </Button>
          )}
        </Modal.Footer>
      )}
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Inline image preview helper (uses download URL)
// ---------------------------------------------------------------------------

const ImagePreviewInline = ({
  file,
  scope,
  currentPath,
}: {
  file: FileItem;
  scope: FileScope;
  currentPath: string;
}) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const fileScopePath = buildFilePath(file);
        const { url: downloadUrl } = await getDownloadUrl(scope, fileScopePath);
        if (!cancelled) setUrl(downloadUrl);
      } catch {
        // Silently fail — preview is optional
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [file, scope, currentPath]);

  if (!url) return <Spinner size="sm" />;

  return <img src={url} alt={file.name} style={{ maxHeight: 260, maxWidth: '100%', objectFit: 'contain' }} />;
};
