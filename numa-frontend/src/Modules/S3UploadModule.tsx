import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type ForwardRefRenderFunction,
} from 'react';
import { Button } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { useAuth } from '../Providers/AuthProvider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { Preloader } from '../Components/Preloader';
import { UploadStatusRow } from '../Components/Status/UploadStatusRow';
import PropTypes from 'prop-types';
import { useJobsApi } from '../Services/jobsApi';
import { withPRM } from '../utils/prmUtils';

// ---------- Types ----------
type NumaAppWithTasks = { tasks?: Array<{ id: string }> };
type TaskInputMap = Record<string, unknown>;

export interface StandardizedFile {
  id: string;
  name: string;
  s3_key: string;
  filePath?: string;
  fileName?: string;
  fileType?: string;
  s3Bucket?: string;
  file?: File;
}

export interface TaskParameters {
  allowedFileTypes?: string[];
  maximumFileSize?: number;
  minFiles?: number;
  maxFiles?: number;
  userMessage?: string;
}

export interface ManifestTask {
  id: string;
  title?: string;
  required?: boolean;
  parameters?: TaskParameters;
}

export interface S3UploadModuleProps {
  task: ManifestTask;
  onComplete?: (results?: StandardizedFile[] | []) => void;
  onNotComplete?: (results?: StandardizedFile[] | []) => void;
  onChange?: (value: StandardizedFile[] | null | string) => void;
  onSelectFiles?: (files: File[]) => void;
  value?: StandardizedFile | StandardizedFile[] | string;
  disabled?: boolean;
  kb_id?: string | null;
}

type TaskResponse = {
  taskId: string;
  result?: unknown;
};

type MaybeIdToken = { sub?: string };
type MaybeDecodedTokens = { idToken?: MaybeIdToken };
type MaybeUser = { decoded_tokens?: MaybeDecodedTokens };

type JobCreateResult = { jobId: string; name?: string };

type UploaderHandle = {
  acceptUserSelection?: (files: File[], opts?: { autoStart?: boolean }) => Promise<void> | void;
  startUpload?: () => Promise<void> | void;
};

// Default no-op functions
const noop: (..._args: unknown[]) => void = () => {};

// Safe getter for simple config values
const safeGet = (obj: Record<string, unknown> | null, key: string): string =>
  obj && typeof obj[key] === 'string' ? (obj[key] as string) : '';

/** Convert assorted inputs to a StandardizedFile */
const standardizeFileFormat = (file: unknown): StandardizedFile | null => {
  if (!file) return null;

  if (typeof file === 'string') {
    const name = file.split('/').pop() || 'Unknown';
    return {
      id: Math.random().toString(36).slice(2),
      name,
      s3_key: file,
    };
  }

  if (typeof file === 'object') {
    const f = file as Record<string, unknown>;
    if (typeof f.id === 'string' && typeof f.name === 'string' && typeof f.s3_key === 'string') {
      return f as unknown as StandardizedFile;
    }

    const filePath = (f.filePath ?? f.s3_key ?? f.key ?? '') as string;
    const nameFromPath = filePath.split('/').pop() || 'Unknown file';
    const name = (f.fileName as string | undefined) ?? (f.name as string | undefined) ?? nameFromPath;

    return {
      id: (f.randomId as string | undefined) ?? (typeof f.id === 'string' ? f.id : Math.random().toString(36).slice(2)),
      name,
      s3_key: filePath,
    };
  }

  return null;
};

const resolveKbIdForMetadata = (kbId?: string | null): string => {
  if (typeof kbId === 'string' && kbId.trim().length > 0) {
    return kbId.trim();
  }
  return 'company';
};

const S3UploadModuleInner: ForwardRefRenderFunction<UploaderHandle, S3UploadModuleProps> = (
  {
    task,
    onComplete = noop,
    onNotComplete = noop,
    onChange = noop,
    onSelectFiles = noop,
    value,
    disabled = false,
    kb_id = null,
  },
  ref,
) => {
  const {
    numaAppId,
    appRunning,
    numaTaskResponses,
    currentJobId,
    setCurrentJobId,
    numaAppData,
    taskInputValues,
    runName,
    setRunName,
  } = useNumaApp();
  const jobsApi = useJobsApi();
  const { getCredentials, user } = useAuth();
  const normalizedRunName = (runName || '').trim();

  // ---- Config (region/bucket) with race-proofing ----
  const [bucketName, setBucketName] = useState('');
  const [region, setRegion] = useState<string | undefined>();
  const [isConfigReady, setIsConfigReady] = useState(false);
  const configPromiseRef = useRef<Promise<void> | null>(null);
  const pendingUploadsRef = useRef<File[] | null>(null);

  const fetchConfigOnce = useCallback((): Promise<void> => {
    if (configPromiseRef.current) return configPromiseRef.current;

    configPromiseRef.current = (async () => {
      try {
        const res = await fetch('/config.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`config.json HTTP ${res.status}`);
        const cfg = (await res.json()) as Record<string, unknown>;

        // Fallbacks allow multiple deployment styles
        const cfgRegion =
          safeGet(cfg, 'REGION') ||
          safeGet(cfg, 'awsRegion') ||
          (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__NUMA_REGION
            ? String((window as unknown as Record<string, unknown>).__NUMA_REGION)
            : '') ||
          process.env.NEXT_PUBLIC_AWS_REGION ||
          '';

        const explicitBucket =
          safeGet(cfg, 'OUTPUT_BUCKET') ||
          (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__NUMA_OUTPUT_BUCKET
            ? String((window as unknown as Record<string, unknown>).__NUMA_OUTPUT_BUCKET)
            : '') ||
          process.env.NEXT_PUBLIC_AWS_OUTPUT_BUCKET ||
          '';

        const clientName =
          safeGet(cfg, 'CLIENT_NAME') ||
          (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__NUMA_CLIENT_NAME
            ? String((window as unknown as Record<string, unknown>).__NUMA_CLIENT_NAME)
            : '') ||
          process.env.NEXT_PUBLIC_NUMA_CLIENT_NAME ||
          'unknown';

        const bucket = explicitBucket || (clientName ? `numa-${clientName}-outputs` : '');

        if (!cfgRegion) throw new Error('Missing REGION in config/environment');
        if (!bucket) throw new Error('Missing OUTPUT_BUCKET/CLIENT_NAME for S3 bucket');

        setRegion(cfgRegion);
        setBucketName(bucket);
        setIsConfigReady(true);
      } catch (err) {
        console.error('[S3UploadModule] Failed to load config:', err);
        setIsConfigReady(false);
        throw err;
      }
    })();

    return configPromiseRef.current;
  }, []);

  useEffect(() => {
    fetchConfigOnce().catch(() => {
      // visible error will be shown if user tries to upload before ready
    });
  }, [fetchConfigOnce]);

  // If files arrived before config was ready, flush them now
  useEffect(() => {
    if (isConfigReady && pendingUploadsRef.current && pendingUploadsRef.current.length) {
      const files = pendingUploadsRef.current.slice();
      pendingUploadsRef.current = null;
      void handleFileSelection(files);
    }
  }, [isConfigReady]);

  // ---- Uploader state ----
  const acceptedFileTypes = task?.parameters?.allowedFileTypes ?? [];
  const maxFileSize = task?.parameters?.maximumFileSize ?? null;
  const minFiles = task?.parameters?.minFiles ?? 0;
  const maxFiles = task?.parameters?.maxFiles ?? null;
  const userMessage = task?.parameters?.userMessage;

  const [selectedFiles, setSelectedFiles] = useState<StandardizedFile[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobCreationPromiseRef = useRef<Promise<JobCreateResult> | null>(null);

  const taskResponse = Array.isArray(numaTaskResponses)
    ? (numaTaskResponses as TaskResponse[]).find((r) => r?.taskId === task.id)
    : undefined;

  const userUuid = (user as MaybeUser | undefined)?.decoded_tokens?.idToken?.sub;

  // Handle value prop changes
  useEffect(() => {
    if (!value) return;
    let processedFiles: StandardizedFile[] | undefined;

    if (Array.isArray(value)) {
      const arr = value as (StandardizedFile | string)[];
      processedFiles = arr.map((v) => standardizeFileFormat(v)).filter((v): v is StandardizedFile => Boolean(v));
    } else if (value) {
      const standardized = standardizeFileFormat(value as StandardizedFile | string);
      processedFiles = standardized ? [standardized] : [];
    }

    if (processedFiles && processedFiles.length > 0) {
      setSelectedFiles(processedFiles);
      const fileNames = processedFiles.map((f) => f.name).join(', ');
      setUploadStatus(`Files uploaded: ${fileNames}`);
    } else {
      setSelectedFiles([]);
      setUploadStatus(null);
    }
  }, [value]);

  useEffect(() => {
    const isChatFileUpload = task?.id === 'chatFileUpload';
    if (isChatFileUpload) return;

    const isRequired = task?.required !== undefined ? task.required : false;

    if (!isRequired) {
      onComplete([]);
    } else {
      if (value) {
        onComplete(Array.isArray(value) ? (value as StandardizedFile[]) : [value as StandardizedFile]);
      } else {
        onNotComplete();
      }
    }
  }, []);

  const warning =
    minFiles > 0 && selectedFiles.length > 0 && selectedFiles.length < minFiles
      ? `At least ${minFiles} file${minFiles > 1 ? 's' : ''} required`
      : null;

  const validateFile = (file: File) => {
    if (acceptedFileTypes && acceptedFileTypes.length > 0) {
      if (!acceptedFileTypes.includes(file.type)) {
        return {
          validFile: null as File | null,
          error: `${file.name}: Invalid file type. Accepted types: ${acceptedFileTypes.join(', ')}`,
        };
      }
    }

    if (maxFileSize && file.size > maxFileSize * 1024 * 1024) {
      return {
        validFile: null as File | null,
        error: `${file.name}: File is too large. Maximum size allowed is ${maxFileSize.toFixed(2)} MB`,
      };
    }

    return { validFile: file, error: null as string | null };
  };

  const removeFile = (fileToRemove: StandardizedFile) => {
    setSelectedFiles((prev) => {
      const updated = prev.filter((file) => file.name !== fileToRemove.name);
      onChange(updated);
      return updated;
    });
    setError(null);
    onNotComplete();
  };

  // ---- Selection / Drag handlers ----
  const handleFileSelection = async (fileList: FileList | File[]) => {
    // Ensure config is ready
    if (!isConfigReady) {
      try {
        await fetchConfigOnce();
      } catch {
        setError('Storage config failed to load (missing REGION/BUCKET). Please refresh or contact support.');
        onNotComplete();
        return;
      }
      if (!isConfigReady) {
        // queue files until config is ready
        pendingUploadsRef.current = Array.from(fileList instanceof FileList ? Array.from(fileList) : fileList);
        setUploadStatus('Preparing storage…');
        return;
      }
    }

    const newFiles = fileList instanceof FileList ? Array.from(fileList) : fileList;
    const totalFileCount = selectedFiles.length + newFiles.length;

    // Surface raw selection to consumers (e.g., to show warnings) without blocking uploads
    onSelectFiles(newFiles.filter((f): f is File => f instanceof File));

    if (maxFiles && totalFileCount > maxFiles) {
      setError(`Maximum of ${maxFiles} file${maxFiles > 1 ? 's' : ''} allowed`);
      onNotComplete();
      return;
    }

    const validFiles: File[] = [];
    const errors: string[] = [];

    newFiles.forEach((file) => {
      const { validFile, error: fileError } = validateFile(file);
      if (validFile) validFiles.push(validFile);
      if (fileError) errors.push(fileError);
    });

    if (errors.length > 0) {
      setError(errors.join('\n'));
      onNotComplete();
      return;
    }

    if (validFiles.length > 0) {
      setUploadStatus(null);
      setUploadProgress(0);
      setError(null);
      onNotComplete();
      onChange(null);
      await handleUpload(validFiles);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void handleFileSelection(e.target.files);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isCreatingJob) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isCreatingJob) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!disabled && !isCreatingJob) {
      void handleFileSelection(e.dataTransfer.files);
    }
  };

  const handleZoneClick = (e: React.MouseEvent) => {
    if (!selectedFiles.length && e.target === e.currentTarget && !disabled && !isCreatingJob) {
      fileInputRef.current?.click();
    }
  };

  // ---- Upload core ----
  const handleUpload = async (filesToUpload: File[] | StandardizedFile[] = selectedFiles) => {
    const isChatFileUpload = task?.id === 'chatFileUpload';

    if (!userUuid) {
      setError('Authentication required for file uploads');
      onNotComplete();
      return;
    }

    const isRequired = task?.required !== undefined ? task.required : false;

    if (!filesToUpload.length) {
      if (isRequired) {
        setError('Please select at least one file');
        return;
      } else {
        setUploadStatus('No file uploaded');
        onChange('');
        onComplete();
        return;
      }
    }

    if (!isConfigReady || !region || !bucketName) {
      setError('Storage not configured (missing region/bucket). Please refresh or contact support.');
      onNotComplete();
      return;
    }

    let jobId = typeof currentJobId === 'string' ? currentJobId : undefined;

    const results: StandardizedFile[] = [];

    try {
      setError(null);

      // For non-chat uploads, ensure we have a job ID
      if (!isChatFileUpload && numaAppData) {
        if (!jobId) {
          if (!jobCreationPromiseRef.current) {
            setIsCreatingJob(true);
            setUploadStatus('Creating job...');
            const createOptions = normalizedRunName ? { name: normalizedRunName } : undefined;
            jobCreationPromiseRef.current = jobsApi.createJob(
              numaAppData,
              {},
              'uploading',
              createOptions,
            ) as Promise<JobCreateResult>;
          }

          try {
            const jobCreationResult = await jobCreationPromiseRef.current;
            jobId = jobCreationResult.jobId;
            if (jobCreationResult?.name) {
              setRunName(jobCreationResult.name);
            }
            setCurrentJobId(jobId);
          } catch (error) {
            jobCreationPromiseRef.current = null;
            setIsCreatingJob(false);
            throw error;
          } finally {
            setIsCreatingJob(false);
          }
        }
        setUploadStatus('Uploading files...');
      }

      const credentials = await getCredentials().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Authentication error: ${msg}`);
      });

      const resolvedRegion = region || window.sessionStorage.getItem('REGION');
      if (!resolvedRegion) {
        throw new Error('AWS region is not configured for uploads');
      }

      const bucketForUpload = bucketName;

      if (!bucketForUpload) {
        throw new Error('No S3 bucket configured for uploads');
      }

      const resolvedKbIdForUpload = resolveKbIdForMetadata(kb_id);
      const resolvedTenantName = (typeof window !== 'undefined' && window.sessionStorage.getItem('CLIENT_NAME')) || '';

      const s3Client = withPRM(S3Client, {
        region: resolvedRegion,
        credentials,
      });

      // Only raw File objects should be uploaded here
      const rawFiles: File[] = (filesToUpload as unknown[]).filter((f): f is File => f instanceof File);

      for (let i = 0; i < rawFiles.length; i++) {
        const file = rawFiles[i];
        setUploadStatus(`Uploading file ${i + 1} of ${rawFiles.length}: ${file.name}`);
        setUploadProgress(0);

        const randomId = Math.random().toString(36).slice(2);
        const lastDotIndex = file.name.lastIndexOf('.');
        const fileName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
        const fileExt = lastDotIndex !== -1 ? file.name.substring(lastDotIndex) : '';

        let s3Key: string;
        if (isChatFileUpload) {
          const chatId = Math.random().toString(36).slice(2, 10);
          const uploaderFolder = userUuid ? `${userUuid}/` : 'anonymous/';
          s3Key = `numa-chat/uploads/${uploaderFolder}${chatId}/${fileName}_${randomId}${fileExt}`;
        } else {
          s3Key = `${numaAppId}/${userUuid}/${jobId}/${fileName}_${randomId}${fileExt}`;
        }

        const metadata = isChatFileUpload
          ? {
              kb_id: resolvedKbIdForUpload,
              uploaded_at: new Date().toISOString(),
              ...(resolvedTenantName ? { tenant_id: resolvedTenantName } : {}),
              ...(userUuid ? { uploader_id: userUuid } : {}),
            }
          : undefined;

        const command = new PutObjectCommand({
          Bucket: bucketForUpload,
          Key: s3Key,
          Metadata: metadata,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        await axios.put(presignedUrl, file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          onUploadProgress: (progressEvent) => {
            const total = progressEvent.total || 1;
            const progress = Math.round((progressEvent.loaded * 100) / total);
            setUploadProgress(progress);
          },
        });

        if (isChatFileUpload) {
          try {
            const metadataAttributes: Record<string, string> = {
              kb_id: resolvedKbIdForUpload,
              uploaded_at: new Date().toISOString(),
            };
            if (resolvedTenantName) metadataAttributes.tenant_id = resolvedTenantName;
            if (userUuid) metadataAttributes.uploader_id = userUuid;

            await s3Client.send(
              new PutObjectCommand({
                Bucket: bucketForUpload,
                Key: `${s3Key}.metadata.json`,
                Body: JSON.stringify({ metadataAttributes }),
                ContentType: 'application/json',
              }),
            );
          } catch (metadataError) {
            console.warn('Failed to upload metadata sidecar for chat file', metadataError);
          }
        }

        // Create standardized file object
        const standardizedFile = standardizeFileFormat({
          id: randomId,
          name: file.name,
          s3_key: s3Key,
          filePath: s3Key,
          fileName: file.name,
          fileType: file.type,
          s3Bucket: bucketForUpload,
          file, // Keep the original file for chat compatibility
        }) as StandardizedFile;

        results.push(standardizedFile);
      }

      const fileObjects = results.map((r) => ({
        id: r.id,
        name: r.name,
        s3_key: r.s3_key,
      }));

      if (!isChatFileUpload) {
        try {
          const fileInputs = { [task.id]: fileObjects };

          const filteredTaskInputValues: TaskInputMap = {};
          const appWithTasks = numaAppData as NumaAppWithTasks | null;
          if (appWithTasks?.tasks && Array.isArray(appWithTasks.tasks)) {
            const taskIds = new Set(appWithTasks.tasks.map((t) => t.id));
            Object.entries(taskInputValues as TaskInputMap).forEach(([key, val]) => {
              if (taskIds.has(key)) filteredTaskInputValues[key] = val;
            });
          }
          const mergedInputs = { ...filteredTaskInputValues, ...fileInputs };
          const updateOptions = normalizedRunName ? { name: normalizedRunName } : undefined;
          await jobsApi.updateJob(numaAppData, jobId, undefined, mergedInputs, 'files-uploaded', updateOptions);
        } catch (updateError) {
          console.error('Failed to save file paths to job:', updateError);
          const msg = updateError instanceof Error ? updateError.message : String(updateError);
          throw new Error(`Upload completed but failed to update job status: ${msg}`);
        }
      }

      setUploadStatus('Upload successful!');
      setSelectedFiles((prev) => {
        const updatedFiles = [...prev, ...fileObjects];
        onChange(updatedFiles);
        return updatedFiles;
      });
      onComplete(results || []);
    } catch (err) {
      console.error('Error during file upload:', err);

      if (!isChatFileUpload && typeof currentJobId === 'string' && currentJobId) {
        try {
          const updateOptions = normalizedRunName ? { name: normalizedRunName } : undefined;
          await jobsApi.updateJob(numaAppData, currentJobId, null, {}, 'upload-failed', updateOptions);
        } catch (jobError) {
          console.error('Failed to mark job:', jobError);
        }
      }

      const e = err as unknown;
      const anyLike = e as Record<string, unknown>;
      let errorMessage = '';

      const message = typeof anyLike.message === 'string' ? anyLike.message : '';
      const response = anyLike.response as { status?: number; data?: { error?: string; message?: string } } | undefined;
      const code = typeof anyLike.code === 'string' ? anyLike.code : '';

      if (message.includes('Missing REGION') || message.includes('region/bucket')) {
        errorMessage = 'Storage not configured (region/bucket). Check /config.json or environment.';
      } else if (response?.status === 403) {
        errorMessage = 'Permission denied — check IAM & bucket policy for PUT Object.';
      } else if (response?.status === 401) {
        errorMessage = 'Session expired — please log in again.';
      } else if (message.includes('Authentication error')) {
        errorMessage = message;
      } else if (message.includes('upload URL')) {
        errorMessage = 'Server configuration error (presign).';
      } else if (code === 'ERR_NETWORK') {
        errorMessage = 'Network error — please check your internet connection.';
      } else {
        errorMessage = response?.data?.error || response?.data?.message || message || 'Error uploading file';
      }

      setError(errorMessage);
      onComplete?.([]);
    }
  };

  // --------- Imperative API for ChatFileUpload bridge ----------
  useImperativeHandle(ref, () => ({
    acceptUserSelection: async (files: File[]) => {
      if (!isConfigReady) {
        pendingUploadsRef.current = files;
        setUploadStatus('Preparing storage…');
        try {
          await fetchConfigOnce();
        } catch {
          // error shown by guards
        }
        if (isConfigReady) {
          await handleFileSelection(files);
        }
        return;
      }
      await handleFileSelection(files);
    },
    startUpload: async () => {
      await handleUpload();
    },
  }));
  // -------------------------------------------------------------

  return (
    <div className="task-container">
      {task?.title && <h3>{task.title}</h3>}
      {userMessage && <div className="alert alert-info mb-3">{userMessage}</div>}

      <div
        className={`upload-container bg-light p-4 rounded  ${isDragging ? 'dragging' : ''} ${
          disabled || isCreatingJob ? 'disabled' : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleZoneClick}
      >
        <div className="text-center">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2">Drag and drop your file(s) here, or</p>
          <Button
            variant="primary"
            as="label"
            htmlFor={`file-upload-${task?.id}`}
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            onClick={(e) => e.stopPropagation()}
            disabled={disabled || isCreatingJob}
          >
            Select Files
          </Button>

          {/* Config readiness hint */}
          {!isConfigReady && !error && (
            <div className="mt-3">
              <UploadStatusRow text="Preparing storage…" showSpinner className="mb-2" />
            </div>
          )}

          {error && (
            <div className="mt-3">
              <UploadStatusRow text={error} variant="error" className="mb-2" />
            </div>
          )}
          {!error && warning && (
            <div className="mt-3">
              <UploadStatusRow text={warning} variant="warning" className="mb-2" />
            </div>
          )}

          {uploadStatus && (
            <div className="mt-3">
              <UploadStatusRow
                text={uploadStatus}
                showSpinner={
                  uploadStatus.includes('Uploading') ||
                  uploadStatus.includes('Finalising') ||
                  uploadStatus.includes('Creating job') ||
                  uploadStatus.includes('Preparing storage')
                }
                showCheckmark={uploadStatus.includes('successful') || uploadStatus.includes('uploaded:')}
                className="mb-2"
              />
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="progress">
                  <div
                    className="progress-bar"
                    role="progressbar"
                    style={{ width: `${uploadProgress}%` }}
                    aria-valuenow={uploadProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    {uploadProgress}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {appRunning && !taskResponse?.result && <Preloader smallscreen={true} overlayParent={true} />}

        {selectedFiles.length > 0 && (
          <div className="s3-files-section">
            <div className="files-header">
              <span className="files-count-label">
                {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''} Selected
              </span>
              <button
                className="clear-all-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  const clearedFiles: StandardizedFile[] = [];
                  setSelectedFiles(clearedFiles);
                  setError(null);
                  onNotComplete();
                  onChange(clearedFiles);
                }}
              >
                Clear all
              </button>
            </div>

            <div className="files-list">
              {selectedFiles.map((file, index) => (
                <div key={index} className="file-item">
                  <div className="file-content">
                    <div className="file-icon">
                      <i className="bi bi-file-earmark-text" />
                    </div>
                    <span className="file-name" title={file.name}>
                      {file.name}
                    </span>
                  </div>

                  <button
                    className="remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file);
                    }}
                  >
                    <i className="bi bi-x"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <input
          type="file"
          onChange={handleFileChange}
          ref={fileInputRef}
          id={`file-upload-${task?.id}`}
          data-testid="file-upload-input"
          style={{ display: 'none' }}
          multiple
          accept={acceptedFileTypes?.join(',')}
          disabled={disabled || isCreatingJob}
        />
      </div>
    </div>
  );
};

export const S3UploadModule = forwardRef(S3UploadModuleInner) as unknown as React.ForwardRefExoticComponent<
  React.PropsWithoutRef<S3UploadModuleProps> & React.RefAttributes<UploaderHandle>
>;

S3UploadModule.propTypes = {
  task: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string,
    required: PropTypes.bool,
    parameters: PropTypes.shape({
      allowedFileTypes: PropTypes.arrayOf(PropTypes.string),
      maximumFileSize: PropTypes.number,
      minFiles: PropTypes.number,
      maxFiles: PropTypes.number,
      userMessage: PropTypes.string,
    }),
  }).isRequired,
  onComplete: PropTypes.func,
  onNotComplete: PropTypes.func,
  onChange: PropTypes.func,
  onSelectFiles: PropTypes.func,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.array, PropTypes.object]),
  disabled: PropTypes.bool,
};
