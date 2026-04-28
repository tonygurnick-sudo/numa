import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Form, Button, Spinner, Alert, InputGroup } from 'react-bootstrap';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../../Providers/AuthProvider';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { withPRM } from '../../utils/prmUtils';
import { getFileIcon, formatFileSize } from '../../Services/filesService';
import { sanitizeS3Filename } from '../../utils/sanitizeFilename';
import { SYSTEM_KB_IDS } from '../../constants/knowledgeBase';
import { createShare, createDropZone, getShareInfo as _getShareInfo } from '../../Services/sharedChatService';
import type { CreateShareResponse, CreateDropZoneResponse } from '../../Services/sharedChatService';
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

/**
 * File reference for share creation. Files live in one of the user's
 * personal KBs at S3 key `documents/kb-{kb_id}/{path}{name}`.
 */
interface FileItem {
  name: string;
  size_bytes: number;
  /** KB the file lives in. Defaults to the user's root KB (kb_id === userSub). */
  kb_id?: string;
  /** Display name of the KB, for the picker label. */
  kb_name?: string;
  /** Path within the KB. '/' for root, '/folder/' for a subfolder. */
  path?: string;
  last_modified?: string;
}

interface CreateShareModalProps {
  show: boolean;
  onHide: () => void;
  onCreated: () => void;
  mode?: 'document' | 'dropzone';
  preSelectedFile?: FileItem;
}

/** Steps shown in the dropzone customize step indicator (steps 3+ internally) */
const DROPZONE_CUSTOMIZE_STEPS = [
  'instructions',
  'description',
  'auth',
  'expiry',
  'limits',
  'api',
  'chat',
  'review',
] as const;

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant that answers questions about the shared document. Be concise and accurate. If the answer is not in the document, say so.';

const WIZARD_STEPS = [
  'file',
  'quickShare',
  'preview',
  'description',
  'kb',
  'expiry',
  'chat',
  'download',
  'review',
] as const;

/** Steps shown in the step indicator when in customize mode (skips quickShare) */
const CUSTOMIZE_WIZARD_STEPS = ['preview', 'description', 'kb', 'expiry', 'chat', 'download', 'review'] as const;

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
}: CreateShareModalProps) => {
  const { t } = useTranslation('files');
  const { getCredentials, user } = useAuth();
  const { availableKBs, isLoadingKBs } = useKnowledgeBase();

  const isDropzone = mode === 'dropzone';

  // ─── Wizard step (document mode) ───────────────────────────────────
  const [wizardStep, setWizardStep] = useState(1);

  // ─── Dropzone wizard step ──────────────────────────────────────────
  const [dropzoneWizardStep, setDropzoneWizardStep] = useState(1);

  // ─── File selection state ──────────────────────────────────────────
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Hierarchical browser state ────────────────────────────────────
  // browseKbId === null means we're at the root showing the user's KBs.
  // Otherwise we're inside a KB at the given path (e.g. '', 'folder/').
  const [browseKbId, setBrowseKbId] = useState<string | null>(null);
  const [browseKbName, setBrowseKbName] = useState<string>('');
  const [browsePath, setBrowsePath] = useState<string>('');
  const [browseFolders, setBrowseFolders] = useState<string[]>([]);
  const [browseFiles, setBrowseFiles] = useState<FileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // ─── Drag and drop ─────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // ─── Configuration state ───────────────────────────────────────────
  const [description, setDescription] = useState('');
  const [expiryHours, setExpiryHours] = useState<number | null>(null);
  const [allowedIps, setAllowedIps] = useState('');
  const [maxQuestions, setMaxQuestions] = useState(12);
  const [enableChat, setEnableChat] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);

  // ─── Description generation state ──────────────────────────────────
  const [descGenStatus, setDescGenStatus] = useState<'idle' | 'streaming' | 'success' | 'error'>('idle');
  const descGenAbortRef = useRef<(() => void) | null>(null);
  const [_descriptionManuallyEdited, setDescriptionManuallyEdited] = useState(false);

  // ─── Knowledge Base selection state ────────────────────────────────
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [availableKbs, setAvailableKbs] = useState<UserKB[]>([]);
  const [kbsLoading, setKbsLoading] = useState(false);

  // ─── Dropzone-specific state ───────────────────────────────────────
  const [selectedFolder, setSelectedFolder] = useState('/');
  const [instructions, setInstructions] = useState('');
  const [authMode, setAuthMode] = useState<'none' | 'passcode' | 'email'>('passcode');
  const [passcode, setPasscode] = useState('');
  const [maxFileSizeMb, setMaxFileSizeMb] = useState<string>('');
  const [totalQuotaMb, setTotalQuotaMb] = useState('');
  const [allowedExtensions, setAllowedExtensions] = useState('');
  const [enableApi, setEnableApi] = useState(true);
  const [dropzoneMaxQuestions, setDropzoneMaxQuestions] = useState('');

  // ─── Quick Share vs Customize mode ────────────────────────────────
  const [isCustomizing, setIsCustomizing] = useState(false);

  // ─── Dropzone Quick Create vs Customize mode ────────────────────
  const [isDropzoneCustomizing, setIsDropzoneCustomizing] = useState(false);

  // ─── Dropzone folder browser state (uses KB folders) ─────────────
  const [dzBrowsePath, setDzBrowsePath] = useState('/');
  const [dzKbFolders, setDzKbFolders] = useState<UserKB[]>([]);
  const [dzSelectedKbId, setDzSelectedKbId] = useState<string | null>(null);
  const [dzLoadingFolders, setDzLoadingFolders] = useState(false);
  const [dzCreatingFolder, setDzCreatingFolder] = useState(false);
  const [dzNewFolderName, setDzNewFolderName] = useState('');
  const [dzShowNewFolder, setDzShowNewFolder] = useState(false);

  // ─── Submit state ──────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Success state ─────────────────────────────────────────────────
  const [shareResult, setShareResult] = useState<CreateShareResponse | CreateDropZoneResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [passcodeCopied, setPasscodeCopied] = useState(false);

  // ─── Cleanup helpers (must be before effects that reference them) ──
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
      setIsCustomizing(false);
      setIsDropzoneCustomizing(false);
      setDropzoneWizardStep(1);
      setDzBrowsePath('/');
      setDzShowNewFolder(false);
      setDzNewFolderName('');
      setBrowseKbId(null);
      setBrowseKbName('');
      setBrowsePath('');
      setBrowseFolders([]);
      setBrowseFiles([]);
      setSelectedFile(preSelectedFile ?? null);
      setDescription('');
      setExpiryHours(null);
      setAllowedIps('');
      setMaxQuestions(12);
      setEnableChat(true);
      setAllowDownload(true);
      setDescGenStatus('idle');
      setDescriptionManuallyEdited(false);
      setSelectedKbId(null);
      setAvailableKbs([]);
      setKbsLoading(false);
      setSubmitting(false);
      setError(null);
      setShareResult(null);
      setCopied(false);
      setPasscodeCopied(false);
      setSelectedFolder('/');
      setInstructions(isDropzone ? t('dropzoneWizard.instructionsDefault') : '');
      setAuthMode('passcode');
      setPasscode('');
      setMaxFileSizeMb(isDropzone ? '10' : '');
      setTotalQuotaMb('');
      setAllowedExtensions('');
      setEnableApi(true);
      setDropzoneMaxQuestions(isDropzone ? '12' : '');
      cleanupDescGen();
    }
  }, [show, preSelectedFile, isDropzone]);

  // ---------------------------------------------------------------------------
  // Description Generation (workspace agent with extracted text)
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

  // Description generation is now button-driven, not auto-triggered

  // ─── Load KBs when arriving at step 2 (Quick Share) or step 6 (KB) ─
  useEffect(() => {
    if (!isDropzone && (wizardStep === 2 || wizardStep === 5) && availableKbs.length === 0 && !kbsLoading) {
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

  // ─── Load KBs for dropzone when arriving at chat step (step 9 in customize) ─
  useEffect(() => {
    if (isDropzone && dropzoneWizardStep === 9 && enableChat && availableKbs.length === 0 && !kbsLoading) {
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

  // ─── Load KB folders for dropzone folder browser (step 1) ───────
  const loadDzKbFolders = useCallback(async () => {
    setDzLoadingFolders(true);
    try {
      const kbs = await knowledgeBaseService.listUserKBs();
      // Filter: no system KBs, no root KB, must have EDITOR or OWNER access
      const userKbs = kbs.filter(
        (kb) =>
          kb.kb_id !== 'company' &&
          kb.kb_id !== 'numa-support' &&
          !kb.is_root &&
          (kb.role === 'OWNER' || kb.role === 'EDITOR')
      );
      setDzKbFolders(userKbs);
    } catch {
      setDzKbFolders([]);
    } finally {
      setDzLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    if (show && isDropzone && dropzoneWizardStep === 1) {
      loadDzKbFolders();
    }
  }, [show, isDropzone, dropzoneWizardStep, loadDzKbFolders]);

  const handleDzCreateFolder = useCallback(async () => {
    if (!dzNewFolderName.trim()) return;
    setDzCreatingFolder(true);
    try {
      await knowledgeBaseService.createKB({ name: dzNewFolderName.trim(), is_shared: false, viewers: [], editors: [] });
      setDzNewFolderName('');
      setDzShowNewFolder(false);
      await loadDzKbFolders();
    } catch {
      // Folder creation failed silently
    } finally {
      setDzCreatingFolder(false);
    }
  }, [dzNewFolderName, loadDzKbFolders]);

  const dzBreadcrumbs = dzBrowsePath === '/' ? ['/'] : ['/', ...dzBrowsePath.split('/').filter(Boolean)];

  // ---------------------------------------------------------------------------
  // File handlers
  // ---------------------------------------------------------------------------

  // S3 key for a file inside one of the user's KBs.
  const buildKbFileKey = useCallback((file: FileItem, userSubFallback: string) => {
    const kbId = file.kb_id ?? userSubFallback;
    const path = (file.path ?? '/').replace(/^\//, '');
    return `documents/kb-${kbId}/${path}${sanitizeS3Filename(file.name)}`;
  }, []);

  // Pre-signed GET URL for the selected file. Resolves the kb_id from the file
  // when set, otherwise falls back to the user's root KB.
  const buildSignedDownloadUrl = useCallback(
    async (file: FileItem): Promise<string> => {
      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
      const bucket = sessionStorage.getItem('DATA_BUCKET');
      const region = sessionStorage.getItem('REGION') || 'us-east-1';
      if (!userSub || !bucket) throw new Error('User or data bucket not configured');
      const credentials = await getCredentials();
      if (!credentials) throw new Error('No credentials');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s3Client = withPRM(S3Client as any, { region, credentials });
      const command = new GetObjectCommand({ Bucket: bucket, Key: buildKbFileKey(file, userSub) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return getSignedUrl(s3Client as any, command, { expiresIn: 3600 });
    },
    [user, getCredentials, buildKbFileKey]
  );

  // "My Files" = root KB + all non-system KBs the user has access to. Sorted
  // root-first, then by name. Derived from KnowledgeBaseProvider's cached list
  // so it appears instantly without an extra fetch when the modal opens.
  const userSubStr = (user?.decoded_tokens?.idToken?.sub as string | undefined) ?? '';
  const browseKbs = useMemo(() => {
    const myKbs = availableKBs.filter((kb) => !SYSTEM_KB_IDS.has(kb.kb_id));
    myKbs.sort((a, b) => {
      const aRoot = a.kb_id === userSubStr || a.is_root;
      const bRoot = b.kb_id === userSubStr || b.is_root;
      if (aRoot && !bRoot) return -1;
      if (!aRoot && bRoot) return 1;
      return (a.kb_name ?? '').localeCompare(b.kb_name ?? '');
    });
    return myKbs;
  }, [availableKBs, userSubStr]);

  // Load files + folders inside a KB at a given path.
  const loadBrowseInside = useCallback(
    async (kbId: string, path: string) => {
      setLoadingFiles(true);
      try {
        const { files: kbFiles, folders = [] } = await knowledgeBaseService.listKBFiles(kbId, path || undefined);
        const prefix = `documents/kb-${kbId}/${path}`;
        const items: FileItem[] = kbFiles
          .map<FileItem | null>((f) => {
            const relative = f.key.startsWith(prefix) ? f.key.slice(prefix.length) : f.key;
            // Drop nested files (under a deeper folder) — those will surface when the
            // user drills into the folder.
            if (relative.includes('/')) return null;
            const kb = browseKbs.find((k) => k.kb_id === kbId);
            return {
              name: relative,
              size_bytes: f.size,
              kb_id: kbId,
              kb_name: kb?.kb_name,
              path: `/${path}`,
              last_modified: f.lastModified ?? undefined,
            };
          })
          .filter((x): x is FileItem => x !== null);
        setBrowseFolders(folders);
        setBrowseFiles(items);
      } catch {
        setBrowseFolders([]);
        setBrowseFiles([]);
      } finally {
        setLoadingFiles(false);
      }
    },
    [browseKbs]
  );

  // Browse navigation
  const handleEnterKb = useCallback((kb: UserKB) => {
    setBrowseKbId(kb.kb_id);
    setBrowseKbName(kb.kb_name);
    setBrowsePath('');
  }, []);
  const handleEnterFolder = useCallback((folderName: string) => {
    setBrowsePath((prev) => `${prev}${folderName}/`);
  }, []);
  const handleBrowseUp = useCallback(() => {
    if (browsePath) {
      // Pop the last segment.
      const parts = browsePath.split('/').filter(Boolean);
      parts.pop();
      setBrowsePath(parts.length ? `${parts.join('/')}/` : '');
    } else {
      // At KB root; go back to the KB list.
      setBrowseKbId(null);
      setBrowseKbName('');
    }
  }, [browsePath]);

  // Load files/folders whenever the browse position changes.
  // Root view shows the cached KB list synchronously — no fetch needed.
  useEffect(() => {
    if (!show || isDropzone || wizardStep !== 1) return;
    if (browseKbId === null) {
      setBrowseFolders([]);
      setBrowseFiles([]);
      return;
    }
    loadBrowseInside(browseKbId, browsePath);
  }, [show, wizardStep, isDropzone, browseKbId, browsePath, loadBrowseInside]);

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

        // Uploads always land in the user's root KB at root level.
        const newFile: FileItem = {
          name: file.name,
          size_bytes: file.size,
          kb_id: userSub,
          path: '/',
          last_modified: new Date().toISOString(),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s3Client = withPRM(S3Client as any, { region, credentials });
        const s3Key = buildKbFileKey(newFile, userSub);

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

        setSelectedFile(newFile);

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
    [user, getCredentials, t, buildKbFileKey]
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

    try {
      const url = await buildSignedDownloadUrl(selectedFile);

      const result = await createShare({
        s3_signed_url: url,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        expiry_hours: expiryHours ?? undefined,
        max_calls: enableChat ? maxQuestions : 0,
        description: description || undefined,
        enable_chat: enableChat,
        allow_download: allowDownload,
        kb_id: selectedKbId ?? undefined,
        allowed_ips: allowedIps
          ? allowedIps
              .split(',')
              .map((ip) => ip.trim())
              .filter(Boolean)
          : undefined,
      });

      setShareResult(result);
      setWizardStep(10); // always go straight to success
      onCreated();
    } catch (err) {
      setError(t('errors.shareFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedFile,
    buildSignedDownloadUrl,
    expiryHours,
    maxQuestions,
    description,
    enableChat,
    allowDownload,
    selectedKbId,
    onCreated,
    t,
  ]);

  const _handleRetry = useCallback(() => {
    setError(null);
    setShareResult(null);
    setWizardStep(9); // back to review
  }, []);

  // ---------------------------------------------------------------------------
  // Quick Share submission (defaults: no expiry, chat enabled 12 questions, download enabled)
  // ---------------------------------------------------------------------------

  const handleQuickShare = useCallback(async () => {
    if (!selectedFile) return;

    setSubmitting(true);
    setError(null);

    try {
      const url = await buildSignedDownloadUrl(selectedFile);

      const result = await createShare({
        s3_signed_url: url,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        expiry_hours: undefined, // never
        max_calls: 12,
        description: undefined,
        enable_chat: true,
        allow_download: true,
        kb_id: selectedKbId ?? undefined,
      });

      setShareResult(result);
      setWizardStep(10); // always go straight to success
      onCreated();
    } catch (err) {
      setError(t('errors.shareFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
    } finally {
      setSubmitting(false);
    }
  }, [selectedFile, buildSignedDownloadUrl, selectedKbId, onCreated, t]);

  // ---------------------------------------------------------------------------
  // Dropzone submission (unchanged)
  // ---------------------------------------------------------------------------

  const handleDropzoneSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);

    try {
      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
      if (!userSub) throw new Error('User not authenticated');

      // Use KB folder as destination -- S3 prefix is documents/kb-{kbId}/
      const targetKbId = dzSelectedKbId || userSub;
      const s3FolderPrefix = `documents/kb-${targetKbId}/`;
      const folderName = dzKbFolders.find((kb) => kb.kb_id === targetKbId)?.kb_name || 'My Files';

      const result = await createDropZone({
        folder_path: folderName,
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
        allowed_ips: allowedIps
          ? allowedIps
              .split(',')
              .map((ip) => ip.trim())
              .filter(Boolean)
          : undefined,
      });

      setShareResult(result);
      setDropzoneWizardStep(11); // success
      onCreated();
    } catch (err) {
      setError(t('errors.dropzoneFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
    } finally {
      setSubmitting(false);
    }
  }, [
    user,
    selectedFolder,
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
    if (!submitting) {
      cleanupDescGen();
      onHide();
    }
  };

  const goNext = () => {
    if (wizardStep === 9) {
      handleSubmit();
    } else if (wizardStep === 2) {
      // From Quick Share, "Next" enters customize mode at step 3 (Preview)
      setIsCustomizing(true);
      setWizardStep(3);
    } else {
      setWizardStep((s) => Math.min(s + 1, 9));
    }
  };

  const goBack = () => {
    if (wizardStep === 4) cleanupDescGen();
    if (wizardStep === 3 && isCustomizing) {
      // Going back from Preview returns to Quick Share
      setIsCustomizing(false);
      setWizardStep(2);
      return;
    }
    setWizardStep((s) => Math.max(s - 1, 1));
  };

  /** Jump-to-step for the customize step indicator (maps 1-7 index to actual steps 3-9) */
  const jumpToCustomizeStep = (indicatorStep: number) => {
    const actualStep = indicatorStep + 2; // customize steps start at actual step 3
    if (actualStep < wizardStep) {
      if (wizardStep === 4 && actualStep !== 4) cleanupDescGen();
      setWizardStep(actualStep);
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

  // ─── Dropzone wizard navigation (2-step quick + customize) ──────
  const dzGoNext = () => {
    if (dropzoneWizardStep === 1) {
      setDropzoneWizardStep(2); // folder -> quick create
    } else if (dropzoneWizardStep === 10) {
      handleDropzoneSubmit(); // review -> submit
    } else if (isDropzoneCustomizing) {
      setDropzoneWizardStep((s) => Math.min(s + 1, 10));
    }
  };

  const dzGoBack = () => {
    if (dropzoneWizardStep === 3 && isDropzoneCustomizing) {
      // Going back from first customize step returns to quick create
      setIsDropzoneCustomizing(false);
      setDropzoneWizardStep(2);
      return;
    }
    if (dropzoneWizardStep === 2) {
      setDropzoneWizardStep(1);
      return;
    }
    setDropzoneWizardStep((s) => Math.max(s - 1, 1));
  };

  /** Jump-to-step for the dropzone customize step indicator (maps 1-8 index to actual steps 3-10) */
  const dzJumpToStep = (indicatorStep: number) => {
    const actualStep = indicatorStep + 2; // customize steps start at actual step 3
    if (actualStep < dropzoneWizardStep) {
      setDropzoneWizardStep(actualStep);
    }
  };

  const dzCanGoNext = (): boolean => {
    switch (dropzoneWizardStep) {
      case 5: // auth step in customize: passcode required if passcode mode
        return authMode !== 'passcode' || passcode.trim().length > 0;
      default:
        return true;
    }
  };

  // ─── Quick Create Dropzone (with defaults) ──────────────────────
  const handleQuickCreateDropzone = useCallback(async () => {
    setSubmitting(true);
    setError(null);

    try {
      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
      if (!userSub) throw new Error('User not authenticated');

      // Use KB folder as destination -- S3 prefix is documents/kb-{kbId}/
      const targetKbId = dzSelectedKbId || userSub;
      const s3FolderPrefix = `documents/kb-${targetKbId}/`;
      const folderName = dzKbFolders.find((kb) => kb.kb_id === targetKbId)?.kb_name || 'My Files';

      const result = await createDropZone({
        folder_path: folderName,
        s3_folder_prefix: s3FolderPrefix,
        instructions: t('dropzoneWizard.instructionsDefault'),
        auth_mode: 'none',
        passcode: undefined,
        expiry_hours: undefined,
        max_file_size_mb: 200,
        total_quota_mb: 1024,
        allowed_extensions: undefined,
        enable_api: false,
        enable_chat: true,
        description: undefined,
        max_calls: 12,
        kb_id: undefined,
      });

      setShareResult(result);
      setDropzoneWizardStep(11); // success
      onCreated();
    } catch (err) {
      setError(t('errors.dropzoneFailed', { error: err instanceof Error ? err.message : 'Unknown' }));
    } finally {
      setSubmitting(false);
    }
  }, [user, selectedFolder, onCreated, t]);

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
  // DROPZONE MODE — 2-step quick create + optional customize wizard
  // ===================================================================
  if (isDropzone) {
    // Step indicator only shown during customize flow (steps 3-10, displayed as 1-8)
    const showDzStepIndicator = isDropzoneCustomizing && dropzoneWizardStep >= 3 && dropzoneWizardStep <= 10;
    const showDzFooterNav = dropzoneWizardStep >= 1 && dropzoneWizardStep <= 10;

    const renderDropzoneStep = () => {
      switch (dropzoneWizardStep) {
        // ─── Step 1: Folder Browser (flat list) ─────────────────
        case 1:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.folderTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.folderHelp')}</p>

              {/* Breadcrumb */}
              <nav className="mb-3">
                <ol className="breadcrumb mb-0 small">
                  {dzBreadcrumbs.map((seg, idx) => {
                    const isLast = idx === dzBreadcrumbs.length - 1;
                    const pathUpTo = idx === 0 ? '/' : '/' + dzBreadcrumbs.slice(1, idx + 1).join('/') + '/';
                    return (
                      <li
                        key={idx}
                        className={`breadcrumb-item ${isLast ? 'active' : ''}`}
                        style={isLast ? undefined : { cursor: 'pointer' }}
                        onClick={
                          isLast
                            ? undefined
                            : () => {
                                setDzBrowsePath(pathUpTo);
                                setSelectedFolder(pathUpTo);
                              }
                        }
                      >
                        {idx === 0 ? <i className="bi bi-folder2" /> : seg}
                      </li>
                    );
                  })}
                </ol>
              </nav>

              {/* KB Folder list */}
              <div className="modal-picker">
                {dzLoadingFolders ? (
                  <div className="modal-picker__state">
                    <Spinner size="sm" /> <span className="ms-2">{t('dropzoneWizard.folderBrowser.loading')}</span>
                  </div>
                ) : dzKbFolders.length === 0 && !dzShowNewFolder ? (
                  <div className="modal-picker__state modal-picker__state--empty">
                    <i className="bi bi-folder2-open" />
                    <p className="mb-0">{t('dropzoneWizard.folderBrowser.empty')}</p>
                  </div>
                ) : (
                  <div className="modal-picker__list">
                    <button
                      type="button"
                      className={`modal-picker__row${dzSelectedKbId === null ? ' modal-picker__row--selected' : ''}`}
                      onClick={() => {
                        setDzSelectedKbId(null);
                        setSelectedFolder('/');
                      }}
                    >
                      <i className="bi bi-person-fill modal-picker__icon" />
                      <span className="modal-picker__name">{t('createShare.myFilesRoot')}</span>
                    </button>
                    {dzKbFolders.map((kb) => {
                      const isSelected = dzSelectedKbId === kb.kb_id;
                      return (
                        <button
                          key={kb.kb_id}
                          type="button"
                          className={`modal-picker__row${isSelected ? ' modal-picker__row--selected' : ''}`}
                          onClick={() => {
                            setDzSelectedKbId(kb.kb_id);
                            setSelectedFolder(kb.kb_name);
                          }}
                        >
                          <i className="bi bi-folder-fill modal-picker__icon modal-picker__icon--folder" />
                          <span className="modal-picker__name">{kb.kb_name}</span>
                          {kb.is_shared && <i className="bi bi-people-fill modal-picker__badge-icon" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Create folder inline */}
              <div className="mt-3">
                {dzShowNewFolder ? (
                  <div className="d-flex gap-2">
                    <Form.Control
                      size="sm"
                      placeholder={t('dropzoneWizard.folderBrowser.createFolderPlaceholder')}
                      value={dzNewFolderName}
                      onChange={(e) => setDzNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleDzCreateFolder();
                        if (e.key === 'Escape') {
                          setDzShowNewFolder(false);
                          setDzNewFolderName('');
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleDzCreateFolder}
                      disabled={dzCreatingFolder || !dzNewFolderName.trim()}
                    >
                      {dzCreatingFolder ? <Spinner size="sm" /> : <i className="bi bi-check" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => {
                        setDzShowNewFolder(false);
                        setDzNewFolderName('');
                      }}
                    >
                      <i className="bi bi-x" />
                    </Button>
                  </div>
                ) : (
                  <button type="button" className="modal-picker-action-btn" onClick={() => setDzShowNewFolder(true)}>
                    <i className="bi bi-folder-plus" />
                    {t('dropzoneWizard.folderBrowser.createFolder')}
                  </button>
                )}
              </div>

              {/* Selected folder display */}
              <div className="mt-2 small text-muted">
                <i className="bi bi-check-circle text-success me-1" />
                {t('dropzoneWizard.quickCreate.folder')}:{' '}
                <strong>
                  {dzSelectedKbId
                    ? dzKbFolders.find((kb) => kb.kb_id === dzSelectedKbId)?.kb_name || dzSelectedKbId
                    : t('createShare.myFilesRoot')}
                </strong>
              </div>
            </div>
          );

        // ─── Step 2: Quick Create ───────────────────────────────
        case 2:
          return (
            <div>
              <h6 className="mb-3">{t('dropzoneWizard.quickCreate.title')}</h6>

              {/* Selected folder summary */}
              <div className="d-flex align-items-center gap-2 p-3 border rounded bg-light mb-3">
                <i className="bi bi-folder-fill text-warning" style={{ fontSize: '1.5rem' }} />
                <div className="flex-grow-1">
                  <div className="small fw-semibold text-muted">{t('dropzoneWizard.quickCreate.folder')}</div>
                  <div className="fw-semibold">{selectedFolder || '/'}</div>
                </div>
              </div>

              {/* Defaults summary */}
              <div className="mb-3">
                <div className="small fw-semibold text-muted mb-2">{t('dropzoneWizard.quickCreate.defaults')}</div>
                <div className="border rounded overflow-hidden">
                  <div className="d-flex align-items-center gap-2 p-2 px-3 border-bottom bg-light">
                    <i className="bi bi-shield text-muted" />
                    <span className="small">{t('dropzoneWizard.quickCreate.security')}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2 p-2 px-3 border-bottom">
                    <i className="bi bi-clock text-muted" />
                    <span className="small">{t('dropzoneWizard.quickCreate.expiry')}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2 p-2 px-3 border-bottom bg-light">
                    <i className="bi bi-file-earmark-arrow-up text-muted" />
                    <span className="small">{t('dropzoneWizard.quickCreate.limits')}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2 p-2 px-3">
                    <i className="bi bi-chat-dots text-success" />
                    <span className="small">{t('dropzoneWizard.quickCreate.chat')}</span>
                  </div>
                </div>
              </div>

              {error && (
                <Alert variant="danger" className="mt-3" dismissible onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
            </div>
          );

        // ─── Step 3: Instructions (customize) ───────────────────
        case 3:
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

        // ─── Step 4: Description (customize) ────────────────────
        case 4:
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

        // ─── Step 5: Authentication (customize) ─────────────────
        case 5:
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

        // ─── Step 6: Expiry (customize) ─────────────────────────
        case 6:
          return (
            <div>
              <h6 className="mb-2">{t('dropzoneWizard.expiryTitle')}</h6>
              <p className="text-muted small mb-3">{t('dropzoneWizard.expiryHelp')}</p>
              <Form.Select
                value={expiryHours ?? ''}
                onChange={(e) => setExpiryHours(e.target.value === '' ? null : Number(e.target.value))}
                className="mb-4"
              >
                <option value="">{t('createShare.expiryOptions.never')}</option>
                <option value={168}>{t('createShare.expiryOptions.7')}</option>
                <option value={336}>{t('createShare.expiryOptions.14')}</option>
                <option value={720}>{t('createShare.expiryOptions.30')}</option>
                <option value={2160}>{t('createShare.expiryOptions.90')}</option>
              </Form.Select>

              <h6 className="mb-2">
                {t('createShare.wizard.ipWhitelistTitle', { defaultValue: 'IP Whitelist (Optional)' })}
              </h6>
              <p className="text-muted small mb-3">
                {t('createShare.wizard.ipWhitelistHelp', {
                  defaultValue: 'Restrict access to specific IP addresses. Separate multiple IPs with commas.',
                })}
              </p>
              <Form.Control
                type="text"
                placeholder="e.g. 192.168.1.1, 10.0.0.0/24"
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
              />
            </div>
          );

        // ─── Step 7: Upload Limits (customize) ──────────────────
        case 7:
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

        // ─── Step 8: API (customize) ────────────────────────────
        case 8:
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

        // ─── Step 9: Chat + KB (customize) ──────────────────────
        case 9: {
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

        // ─── Step 10: Review (customize) ────────────────────────
        case 10: {
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
                  <span className="small fw-semibold text-muted">
                    {t('createShare.wizard.reviewIpWhitelist', { defaultValue: 'IP Whitelist' })}
                  </span>
                  <span className="text-end text-truncate" style={{ maxWidth: '60%', fontSize: 13 }}>
                    {allowedIps ? (
                      allowedIps
                    ) : (
                      <em className="text-muted">
                        {t('createShare.wizard.reviewNoIpWhitelist', { defaultValue: 'None (Public)' })}
                      </em>
                    )}
                  </span>
                </div>

                <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
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

        <Modal.Body style={{ minHeight: showDzFooterNav ? 420 : undefined }}>
          {/* Step indicator only shown during customize flow (steps 3-10, displayed as 1-8) */}
          {showDzStepIndicator && (
            <StepIndicator
              currentStep={dropzoneWizardStep - 2}
              onStepClick={dzJumpToStep}
              t={t}
              steps={DROPZONE_CUSTOMIZE_STEPS}
              translationPrefix="dropzoneWizard.steps"
            />
          )}

          {error && dropzoneWizardStep !== 2 && dropzoneWizardStep !== 10 && (
            <Alert variant="danger" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {dropzoneWizardStep >= 1 && dropzoneWizardStep <= 10 && renderDropzoneStep()}
          {dropzoneWizardStep === 11 && renderDropzoneSuccess()}
        </Modal.Body>

        {showDzFooterNav && (
          <Modal.Footer>
            {/* Back button */}
            {dropzoneWizardStep > 1 && dropzoneWizardStep !== 2 && (
              <Button variant="secondary" onClick={dzGoBack}>
                <i className="bi bi-arrow-left me-1" />
                {t('dropzoneWizard.back')}
              </Button>
            )}
            {/* Quick Create step: back to folder */}
            {dropzoneWizardStep === 2 && (
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

            {/* Step 1: Next to Quick Create */}
            {dropzoneWizardStep === 1 && (
              <Button variant="primary" onClick={dzGoNext}>
                {t('dropzoneWizard.next')}
                <i className="bi bi-arrow-right ms-1" />
              </Button>
            )}

            {/* Step 2: Quick Create — two buttons */}
            {dropzoneWizardStep === 2 && (
              <>
                <Button
                  variant="outline-secondary"
                  onClick={() => {
                    setIsDropzoneCustomizing(true);
                    setDropzoneWizardStep(3);
                  }}
                >
                  {t('dropzoneWizard.quickCreate.customize')}
                  <i className="bi bi-arrow-right ms-1" />
                </Button>
                <Button variant="primary" onClick={handleQuickCreateDropzone} disabled={submitting}>
                  {submitting ? (
                    <>
                      <Spinner size="sm" className="me-1" /> {t('dropzoneWizard.quickCreate.creating')}
                    </>
                  ) : (
                    <>
                      <i className="bi bi-cloud-upload me-1" />
                      {t('dropzoneWizard.quickCreate.createButton')}
                    </>
                  )}
                </Button>
              </>
            )}

            {/* Customize steps 3-9: normal next button */}
            {isDropzoneCustomizing && dropzoneWizardStep >= 3 && dropzoneWizardStep < 10 && (
              <Button variant="primary" onClick={dzGoNext} disabled={!dzCanGoNext()}>
                {t('dropzoneWizard.next')}
                <i className="bi bi-arrow-right ms-1" />
              </Button>
            )}

            {/* Step 10: Review — create button */}
            {dropzoneWizardStep === 10 && (
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

        {dropzoneWizardStep === 11 && (
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
  // DOCUMENT MODE — 2-step (Quick Share) or 10-step (Customize) wizard
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
              <button
                type="button"
                className="modal-picker-action-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
              >
                {uploadingFile ? (
                  <>
                    <Spinner size="sm" /> {t('upload.uploading')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-folder2-open" /> {t('createShare.orBrowseFiles')}
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="d-none"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
            </div>

            <hr />

            <p className="fw-semibold mb-2">{t('createShare.browseFiles')}</p>

            {/* Breadcrumb (only shown when inside a KB) */}
            {browseKbId !== null && (
              <div className="modal-picker-breadcrumb">
                <button type="button" className="modal-picker-breadcrumb__btn" onClick={handleBrowseUp}>
                  <i className="bi bi-arrow-left" /> {t('createShare.browseUp')}
                </button>
                <span className="modal-picker-breadcrumb__crumb">
                  <i className="bi bi-folder-fill" />
                  {browseKbId === (user?.decoded_tokens?.idToken?.sub as string | undefined)
                    ? t('createShare.myFilesRoot')
                    : browseKbName}
                </span>
                {browsePath
                  .split('/')
                  .filter(Boolean)
                  .map((part) => (
                    <span key={part} className="modal-picker-breadcrumb__crumb">
                      <i className="bi bi-chevron-right" />
                      {part}
                    </span>
                  ))}
              </div>
            )}

            <div className="modal-picker">
              {browseKbId === null ? (
                // Root view: list of KBs (already cached by KnowledgeBaseProvider).
                // Only show a spinner if the provider is still doing its initial fetch.
                isLoadingKBs && browseKbs.length === 0 ? (
                  <div className="modal-picker__state">
                    <Spinner size="sm" /> <span className="ms-2">{t('createShare.loadingFiles')}</span>
                  </div>
                ) : browseKbs.length === 0 ? (
                  <div className="modal-picker__state modal-picker__state--empty">
                    <i className="bi bi-folder2-open" />
                    <p className="mb-1">{t('createShare.noFiles')}</p>
                    <p className="small mb-0">{t('createShare.uploadFirst')}</p>
                  </div>
                ) : (
                  <div className="modal-picker__list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {browseKbs.map((kb) => {
                      const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
                      const isRoot = kb.kb_id === userSub || kb.is_root;
                      const label = isRoot ? t('createShare.myFilesRoot') : kb.kb_name;
                      return (
                        <button
                          key={kb.kb_id}
                          type="button"
                          className="modal-picker__row"
                          onDoubleClick={() => handleEnterKb(kb)}
                          onClick={() => handleEnterKb(kb)}
                        >
                          <i
                            className={`bi ${isRoot ? 'bi-person-fill' : 'bi-folder-fill'} modal-picker__icon modal-picker__icon--folder`}
                          />
                          <div className="modal-picker__name">
                            <div>{label}</div>
                            {kb.is_shared && !isRoot && (
                              <div className="modal-picker__sublabel">
                                <i className="bi bi-people-fill me-1" />
                                {kb.role.toLowerCase()}
                              </div>
                            )}
                          </div>
                          <i className="bi bi-chevron-right modal-picker__meta" />
                        </button>
                      );
                    })}
                  </div>
                )
              ) : loadingFiles ? (
                <div className="modal-picker__state">
                  <Spinner size="sm" /> <span className="ms-2">{t('createShare.loadingFiles')}</span>
                </div>
              ) : browseFolders.length === 0 && browseFiles.length === 0 ? (
                <div className="modal-picker__state modal-picker__state--empty">
                  <i className="bi bi-folder2-open" />
                  <p className="mb-0">{t('createShare.noFolderContents')}</p>
                </div>
              ) : (
                <div className="modal-picker__list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {browseFolders.map((folderName) => (
                    <button
                      key={`folder:${folderName}`}
                      type="button"
                      className="modal-picker__row"
                      onDoubleClick={() => handleEnterFolder(folderName)}
                      onClick={() => handleEnterFolder(folderName)}
                    >
                      <i className="bi bi-folder-fill modal-picker__icon modal-picker__icon--folder" />
                      <div className="modal-picker__name">{folderName}</div>
                      <i className="bi bi-chevron-right modal-picker__meta" />
                    </button>
                  ))}
                  {browseFiles.map((file) => (
                    <button
                      key={`file:${file.path ?? '/'}${file.name}`}
                      type="button"
                      className="modal-picker__row"
                      onClick={() => handleSelectFile(file)}
                    >
                      <i className={`${getFileIcon(file.name)} modal-picker__icon`} />
                      <div className="modal-picker__name">{file.name}</div>
                      <span className="modal-picker__meta">{formatFileSize(file.size_bytes)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      // ─── Step 2: Quick Share ─────────────────────────────────────
      case 2: {
        const companyKbs = availableKbs.filter((kb) => kb.kb_id === 'company');
        const personalKbs = availableKbs.filter((kb) => kb.role === 'OWNER' && kb.kb_id !== 'company');
        const sharedKbs = availableKbs.filter(
          (kb) => (kb.role === 'VIEWER' || kb.role === 'EDITOR') && kb.kb_id !== 'company'
        );

        return (
          <div>
            <h6 className="mb-3">{t('createShare.quickShare.title')}</h6>

            {/* Selected file summary */}
            {selectedFile && (
              <div className="d-flex align-items-center gap-2 p-3 border rounded bg-light mb-3">
                <i className={`${getFileIcon(selectedFile.name)}`} style={{ fontSize: '1.5rem' }} />
                <div className="flex-grow-1">
                  <div className="fw-semibold">{selectedFile.name}</div>
                  <div className="text-muted small">{formatFileSize(selectedFile.size_bytes)}</div>
                </div>
              </div>
            )}

            {/* KB selector */}
            <Form.Group className="mb-3">
              <Form.Label className="small fw-semibold">{t('createShare.quickShare.selectKB')}</Form.Label>
              {kbsLoading ? (
                <div className="text-center py-3">
                  <Spinner size="sm" className="me-2" />
                  <span className="text-muted">{t('createShare.wizard.kbLoading')}</span>
                </div>
              ) : (
                <Form.Select
                  value={selectedKbId ?? ''}
                  onChange={(e) => setSelectedKbId(e.target.value === '' ? null : e.target.value)}
                >
                  <option value="">{t('createShare.wizard.kbNone')}</option>
                  {companyKbs.map((kb) => (
                    <option key={kb.kb_id} value={kb.kb_id}>
                      {kb.kb_name || 'Company'}
                    </option>
                  ))}
                  {personalKbs.map((kb) => (
                    <option key={kb.kb_id} value={kb.kb_id}>
                      {kb.kb_name}
                    </option>
                  ))}
                  {sharedKbs.map((kb) => (
                    <option key={kb.kb_id} value={kb.kb_id}>
                      {kb.kb_name}
                    </option>
                  ))}
                </Form.Select>
              )}
            </Form.Group>

            {/* Default settings summary */}
            <div className="mb-3">
              <div className="small fw-semibold text-muted mb-2">{t('createShare.quickShare.defaults')}</div>
              <div className="border rounded overflow-hidden">
                <div className="d-flex align-items-center gap-2 p-2 px-3 border-bottom bg-light">
                  <i className="bi bi-clock text-muted" />
                  <span className="small">{t('createShare.quickShare.expiry')}</span>
                </div>
                <div className="d-flex align-items-center gap-2 p-2 px-3 border-bottom">
                  <i className="bi bi-chat-dots text-success" />
                  <span className="small">{t('createShare.quickShare.chat')}</span>
                </div>
                <div className="d-flex align-items-center gap-2 p-2 px-3">
                  <i className="bi bi-download text-success" />
                  <span className="small">{t('createShare.quickShare.download')}</span>
                </div>
              </div>
            </div>

            {error && (
              <Alert variant="danger" className="mt-3" dismissible onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </div>
        );
      }

      // ─── Step 3: Preview ──────────────────────────────────────────
      case 3:
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
                    <ImagePreviewInline file={selectedFile} buildSignedUrl={buildSignedDownloadUrl} />
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

      // ─── Step 4: Description (optional, button-driven) ─────────
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

            {/* Editable description textarea */}
            <Form.Control
              as="textarea"
              rows={4}
              placeholder={t('createShare.descriptionPlaceholder')}
              value={description}
              onChange={(e) => {
                setDescriptionManuallyEdited(true);
                if (descGenStatus === 'streaming') {
                  cleanupDescGen();
                  setDescGenStatus('idle');
                }
                setDescription(e.target.value);
              }}
            />
            {descGenStatus === 'streaming' && (
              <div className="d-flex align-items-center gap-2 mt-2">
                <div className="sparkle-animation" style={{ fontSize: '1rem', color: 'var(--bs-primary)' }}>
                  <i className="bi bi-stars" />
                </div>
                <small className="text-muted">{t('createShare.description.generating')}</small>
              </div>
            )}

            {/* Generate Description button */}
            {descGenStatus !== 'streaming' && (
              <div className="mt-3">
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => {
                    setDescription('');
                    setDescriptionManuallyEdited(false);
                    startDescriptionGen(selectedFile?.name || 'document');
                  }}
                >
                  <i className="bi bi-stars me-1" />
                  {t('createShare.wizard.generateDescription', { defaultValue: 'Generate Description' })}
                </Button>
              </div>
            )}

            {/* Error state */}
            {descGenStatus === 'error' && (
              <div className="text-center mt-3">
                <small className="text-warning">
                  <i className="bi bi-exclamation-triangle me-1" />
                  {t('createShare.wizard.descriptionError', { defaultValue: 'Failed to generate description' })}
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
              className="mb-4"
            >
              <option value="">{t('createShare.expiryOptions.never')}</option>
              <option value={168}>{t('createShare.expiryOptions.7')}</option>
              <option value={336}>{t('createShare.expiryOptions.14')}</option>
              <option value={720}>{t('createShare.expiryOptions.30')}</option>
              <option value={2160}>{t('createShare.expiryOptions.90')}</option>
            </Form.Select>

            <h6 className="mb-2">
              {t('createShare.wizard.ipWhitelistTitle', { defaultValue: 'IP Whitelist (Optional)' })}
            </h6>
            <p className="text-muted small mb-3">
              {t('createShare.wizard.ipWhitelistHelp', {
                defaultValue: 'Restrict access to specific IP addresses. Separate multiple IPs with commas.',
              })}
            </p>
            <Form.Control
              type="text"
              placeholder="e.g. 192.168.1.1, 10.0.0.0/24"
              value={allowedIps}
              onChange={(e) => setAllowedIps(e.target.value)}
            />
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

              {/* IP Whitelist */}
              <div className="d-flex justify-content-between align-items-center p-3 border-bottom bg-light">
                <span className="small fw-semibold text-muted">
                  {t('createShare.wizard.reviewIpWhitelist', { defaultValue: 'IP Whitelist' })}
                </span>
                <span className="text-end text-truncate" style={{ maxWidth: '60%', fontSize: 13 }}>
                  {allowedIps ? (
                    allowedIps
                  ) : (
                    <em className="text-muted">
                      {t('createShare.wizard.reviewNoIpWhitelist', { defaultValue: 'None (Public)' })}
                    </em>
                  )}
                </span>
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

  // ─── Success step (virtual step 10) ──────────────────────────────
  const renderSuccess = () => {
    const chatPending =
      enableChat &&
      shareResult &&
      'chat_status' in shareResult &&
      (shareResult as { chat_status?: string }).chat_status === 'pending';

    return (
      <div className="text-center py-3">
        <i className="bi bi-check-circle text-success" style={{ fontSize: '3rem' }} />
        <h5 className="mt-2 text-success">{t('createShare.shareLinkReady')}</h5>
        <p className="text-muted mb-3">{t('createShare.shareLinkReadyMessage')}</p>

        {chatPending && (
          <Alert variant="info" className="text-start mb-3">
            <i className="bi bi-hourglass-split me-1" />
            {t('createShare.chatPendingNote', {
              defaultValue:
                'Chat will be available once document processing completes. The document is viewable immediately.',
            })}
          </Alert>
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
  };

  // ===================================================================
  // Render
  // ===================================================================

  // Show step indicator: step 1 (file), step 2 (quick share), or steps 3-10 (customize wizard)
  const showStepIndicator = isCustomizing && wizardStep >= 3 && wizardStep <= 9;
  const showFooterNav = wizardStep >= 1 && wizardStep <= 9;

  return (
    <Modal show={show} onHide={handleClose} backdrop={submitting ? 'static' : true} size="lg">
      <Modal.Header closeButton={!submitting}>
        <Modal.Title>{t('createShare.title')}</Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ minHeight: wizardStep >= 1 && wizardStep <= 9 ? 420 : undefined }}>
        {/* Step indicator only shown during customize flow (steps 3-10, displayed as 1-8) */}
        {showStepIndicator && (
          <StepIndicator
            currentStep={wizardStep - 2}
            onStepClick={jumpToCustomizeStep}
            t={t}
            steps={CUSTOMIZE_WIZARD_STEPS}
          />
        )}

        {error && wizardStep !== 2 && wizardStep !== 10 && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {wizardStep >= 1 && wizardStep <= 9 && renderWizardStep()}
        {wizardStep === 10 && renderSuccess()}
      </Modal.Body>

      {showFooterNav && (
        <Modal.Footer>
          {/* Back button */}
          {wizardStep > 1 && wizardStep !== 2 && (
            <Button variant="secondary" onClick={goBack}>
              <i className="bi bi-arrow-left me-1" />
              {t('createShare.wizard.back')}
            </Button>
          )}
          {/* Quick Share step: back to file selection (only if no preSelectedFile) */}
          {wizardStep === 2 && !preSelectedFile && (
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

          {/* Quick Share step: two buttons */}
          {wizardStep === 2 && (
            <>
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setIsCustomizing(true);
                  setWizardStep(3);
                }}
              >
                {t('createShare.quickShare.customize')}
                <i className="bi bi-arrow-right ms-1" />
              </Button>
              <Button variant="primary" onClick={handleQuickShare} disabled={submitting || !selectedFile}>
                {submitting ? (
                  <>
                    <Spinner size="sm" className="me-1" /> {t('createShare.quickShare.creating')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-link-45deg me-1" />
                    {t('createShare.quickShare.createLink')}
                  </>
                )}
              </Button>
            </>
          )}

          {/* Normal next button (steps 3-9 in customize mode, step 1 for file selection) */}
          {wizardStep !== 2 && wizardStep < 10 && (
            <Button variant="primary" onClick={goNext} disabled={!canGoNext()}>
              {t('createShare.wizard.next')}
              <i className="bi bi-arrow-right ms-1" />
            </Button>
          )}

          {/* Review step: create share button */}
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

      {wizardStep === 10 && (
        <Modal.Footer>
          <Button variant="primary" onClick={handleClose}>
            {t('upload.done')}
          </Button>
        </Modal.Footer>
      )}
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Inline image preview helper (signs a GET URL against the user's My Files KB)
// ---------------------------------------------------------------------------

const ImagePreviewInline = ({
  file,
  buildSignedUrl,
}: {
  file: FileItem;
  buildSignedUrl: (file: FileItem) => Promise<string>;
}) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const downloadUrl = await buildSignedUrl(file);
        if (!cancelled) setUrl(downloadUrl);
      } catch {
        // Silently fail — preview is optional
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [file, buildSignedUrl]);

  if (!url) return <Spinner size="sm" />;

  return <img src={url} alt={file.name} style={{ maxHeight: 260, maxWidth: '100%', objectFit: 'contain' }} />;
};
