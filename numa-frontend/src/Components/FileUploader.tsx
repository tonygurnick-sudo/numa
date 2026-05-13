import { useState, useEffect, useRef } from 'react';
import { Button, Alert } from 'react-bootstrap';
import axios from 'axios';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../Providers/AuthProvider';
import { withPRM } from '../utils/prmUtils';
import { useTranslation } from 'react-i18next';
import { sanitizeS3Path } from '../utils/sanitizeFilename';
import type { DroppedUploadBatch } from './UnifiedFiles/dropUploadUtils';

// Type definitions
interface Config {
  CLIENT_NAME: string;
}

interface ExtendedFile extends File {
  customRelativePath?: string;
}

interface FileStructure {
  files: ExtendedFile[];
  folders: Set<string>;
}

interface FileUploaderProps {
  onUploadSuccess: () => void;
  onFileSelect?: (files: File[]) => void;
  validateFile?: (file: File) => boolean;
  clearFiles?: boolean;
  kb_id?: string;
  selectedFolder?: string;
  enableFolderUpload?: boolean;
  /**
   * When true, the picker hides the "Select Folder" button and any directory
   * dragged into the drop zone is rejected with an inline alert. Loose files
   * in the same drop are still accepted. Used at the User Files root, where
   * folders correspond to knowledge bases and must be created explicitly.
   */
  rejectFolders?: boolean;
  /**
   * When true, folders can be added to the upload batch, but the Upload button
   * is disabled while any folder is in the selection. Used at the User Files
   * root: files-to-root are fine, but a folder upload first needs the caller
   * to pick a destination KB (which clears this flag by switching kb_id).
   */
  requireFolderDestination?: boolean;
  preloadedFiles?: DroppedUploadBatch | null;
  autoUploadPreloaded?: boolean;
}

/** System/OS files that should be excluded from folder uploads. */
const SYSTEM_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const SYSTEM_PATH_SEGMENTS = ['__MACOSX'];

const isSystemFile = (path: string, name: string): boolean => {
  if (SYSTEM_FILE_NAMES.has(name)) return true;
  return SYSTEM_PATH_SEGMENTS.some((seg) => path.includes(`${seg}/`) || path === seg);
};

/**
 * Detect false folder entries that macOS sometimes includes in file lists.
 * These have no MIME type, tiny size, and no file extension.
 */
const isFalseFolder = (file: File): boolean => {
  if (file.type !== '') return false;
  if (file.size > 512) return false;
  const hasExtension = file.name.includes('.') && !file.name.startsWith('.');
  return !hasExtension;
};

const FileUploader: React.FC<FileUploaderProps> = ({
  onUploadSuccess,
  onFileSelect,
  validateFile,
  clearFiles,
  kb_id,
  selectedFolder,
  enableFolderUpload = false,
  rejectFolders = false,
  requireFolderDestination = false,
  preloadedFiles = null,
  autoUploadPreloaded = false,
}) => {
  const showFolderPicker = enableFolderUpload && !rejectFolders;
  const { t } = useTranslation('common');
  const formatKB = (bytes: number, digits = 2) => t('fileSize.kb', { size: (bytes / 1024).toFixed(digits) });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<ExtendedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [, setShowSuccess] = useState<boolean>(false);
  const [, setShowProgress] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [uploadingFileIndex, setUploadingFileIndex] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [detailedError, setDetailedError] = useState<string | null>(null);
  const [folderRejection, setFolderRejection] = useState<'folders-only' | 'mixed' | null>(null);
  const [fileStructure, setFileStructure] = useState<FileStructure>({
    files: [],
    folders: new Set(),
  });
  const [config, setConfig] = useState<Config | null>(null);
  const { getCredentials, user } = useAuth();
  const lastPreloadedBatchId = useRef<number | null>(null);
  const autoUploadedBatchId = useRef<number | null>(null);
  const [pendingAutoUploadBatchId, setPendingAutoUploadBatchId] = useState<number | null>(null);

  useEffect(() => {
    fetch('/config.json')
      .then((response) => response.json())
      .then((data) => setConfig(data))
      .catch((error) => console.error('Error loading config:', error));
  }, []);

  // Clear files when clearFiles prop changes
  useEffect(() => {
    if (clearFiles) {
      setFiles([]);
      setFileStructure({
        files: [],
        folders: new Set(),
      });
      setError(null);
      setSuccess(false);
      setUploadProgress(0);
      setUploadingFileIndex(0);
      setTotalFiles(0);
      setCurrentFileName('');
      setDetailedError(null);
      setFolderRejection(null);
      setPendingAutoUploadBatchId(null);

      // Clear file input values
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (folderInputRef.current) {
        folderInputRef.current.value = '';
      }
    }
  }, [clearFiles]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const rawFileList = Array.from(event.target.files || []) as ExtendedFile[];

    // Always call onFileSelect first to allow parent to handle validation and warnings
    if (onFileSelect) {
      onFileSelect(rawFileList);
    }

    let validFiles = rawFileList;
    let invalidFileNames = '';

    // Validate files if validateFile function is provided
    if (validateFile) {
      const invalidFiles = rawFileList.filter((file) => !validateFile(file));
      if (invalidFiles.length > 0) {
        invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
        validFiles = rawFileList.filter((file) => validateFile(file));
        if (validFiles.length === 0) {
          setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
          return;
        }
      }
    }

    // Create a set of unique folder paths
    const combinedFiles = [...files, ...validFiles];
    const folders = new Set([...fileStructure.folders]);

    validFiles.forEach((file) => {
      const path = file.webkitRelativePath || file.name;
      const parts = path.split('/');
      // Add all parent folders
      for (let i = 0; i < parts.length - 1; i++) {
        folders.add(parts.slice(0, i + 1).join('/'));
      }
    });

    setFiles(combinedFiles);
    setFileStructure({
      files: combinedFiles,
      folders: folders,
    });
    setTotalFiles(combinedFiles.length);
    if (invalidFileNames) {
      setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
    } else {
      setError(null);
    }
    setSuccess(false);
    setUploadProgress(0);
    setFolderRejection(null);

    // Notify parent component about file selection
    if (onFileSelect) {
      onFileSelect(validFiles);
    }
  };

  const handleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>): void => {
    if (rejectFolders) {
      setFolderRejection('folders-only');
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }
    const rawFiles = Array.from(event.target.files || []) as ExtendedFile[];

    // Set customRelativePath from webkitRelativePath and filter out system/false-folder files
    const validFiles = rawFiles.filter((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      if (isFalseFolder(file) || isSystemFile(relativePath, file.name)) return false;
      file.customRelativePath = relativePath;
      return true;
    });

    if (!validFiles.length) return;

    // Let parent handle validation warnings (e.g. large file notices)
    if (onFileSelect) {
      onFileSelect(validFiles);
    }

    // Filter out invalid file types but don't reject the whole batch
    const filesToAdd = validateFile ? validFiles.filter((file) => validateFile(file)) : validFiles;
    const invalidFiles = validateFile ? validFiles.filter((file) => !validateFile(file)) : [];

    if (!filesToAdd.length) {
      if (invalidFiles.length > 0) {
        const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
        setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
      }
      return;
    }

    const combinedFiles = [...files, ...filesToAdd];
    const folders = new Set([...fileStructure.folders]);

    filesToAdd.forEach((file) => {
      const path = file.customRelativePath || file.name;
      const parts = path.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        folders.add(parts.slice(0, i + 1).join('/'));
      }
    });

    setFiles(combinedFiles);
    setFileStructure({ files: combinedFiles, folders });
    setTotalFiles(combinedFiles.length);
    if (invalidFiles.length > 0) {
      const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
      setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
    } else {
      setError(null);
    }
    setSuccess(false);
    setUploadProgress(0);
  };

  useEffect(() => {
    if (!preloadedFiles || lastPreloadedBatchId.current === preloadedFiles.id) return;
    lastPreloadedBatchId.current = preloadedFiles.id;

    const rawFiles = preloadedFiles.files as ExtendedFile[];
    if (preloadedFiles.folderRejection) {
      setFolderRejection(preloadedFiles.folderRejection);
    } else {
      setFolderRejection(null);
    }

    if (!rawFiles.length) {
      if (preloadedFiles.folderRejection) {
        setError(null);
        setSuccess(false);
        setUploadProgress(0);
      }
      return;
    }

    if (onFileSelect) {
      onFileSelect(rawFiles);
    }

    let validFiles = rawFiles;
    let invalidFileNames = '';
    if (validateFile) {
      const invalidFiles = rawFiles.filter((file) => !validateFile(file));
      if (invalidFiles.length > 0) {
        invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
        validFiles = rawFiles.filter((file) => validateFile(file));
        if (validFiles.length === 0) {
          setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
          return;
        }
      }
    }

    const combinedFiles = [...fileStructure.files, ...validFiles];
    const folders = new Set([...fileStructure.folders]);
    validFiles.forEach((file) => {
      const path = file.customRelativePath || file.webkitRelativePath || file.name;
      const parts = path.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        folders.add(parts.slice(0, i + 1).join('/'));
      }
    });

    setFiles(combinedFiles);
    setFileStructure({ files: combinedFiles, folders });
    setTotalFiles(combinedFiles.length);
    setError(invalidFileNames ? t('fileUploader.errors.invalidFiles', { files: invalidFileNames }) : null);
    setSuccess(false);
    setUploadProgress(0);
    if (autoUploadPreloaded) {
      setPendingAutoUploadBatchId(preloadedFiles.id);
    }
  }, [preloadedFiles, autoUploadPreloaded, fileStructure.files, fileStructure.folders, onFileSelect, validateFile, t]);

  const buildKbPrefix = (kbId: string | null | undefined): { prefix: string; sanitizedKbId: string } => {
    const rawId = typeof kbId === 'string' ? kbId.trim() : '';
    if (!rawId || rawId === 'company') {
      return { prefix: 'documents/company/', sanitizedKbId: 'company' };
    }
    const normalized = rawId.replace(/^kb-/, '');
    return { prefix: `documents/kb-${normalized}/`, sanitizedKbId: normalized };
  };

  const handleUpload = async (): Promise<void> => {
    if (!files.length) {
      setError(t('fileUploader.errors.selectFilesFirst'));
      return;
    }

    // Additional validation before upload if validateFile function is provided
    if (validateFile) {
      const invalidFiles = files.filter((file) => !validateFile(file));
      if (invalidFiles.length > 0) {
        const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
        const validFiles = files.filter((file) => validateFile(file));
        if (validFiles.length === 0) {
          setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
          return;
        }
      }
    }

    setError(null);
    setDetailedError(null);
    setIsUploading(true);
    setShowSuccess(false);
    setShowProgress(true);

    try {
      // Resolve kb_id for KB-prefixed uploads
      const { prefix: kbPrefix, sanitizedKbId } = buildKbPrefix(kb_id);
      const resolvedKbId = sanitizedKbId === 'company' ? 'company' : sanitizedKbId;
      const userUuid = user?.decoded_tokens?.idToken?.sub;

      for (let i = 0; i < files.length; i++) {
        setUploadingFileIndex(i);
        const file = files[i];
        const relativePath = file.customRelativePath || file.webkitRelativePath || file.name;
        setCurrentFileName(relativePath);

        try {
          // Build S3 key with KB prefix and optional folder prefix
          const sanitizedRelativePath = sanitizeS3Path((relativePath || file.name).replace(/^\/+/, ''));
          const folderPrefix = selectedFolder ? `${selectedFolder}/` : '';
          const s3Key = `${kbPrefix}${folderPrefix}${sanitizedRelativePath}`;

          const region = window.sessionStorage.getItem('REGION');

          // Build metadata for KB uploads
          const metadata: Record<string, string> = {
            kb_id: resolvedKbId,
            uploaded_at: new Date().toISOString(),
          };
          if (config?.CLIENT_NAME) {
            metadata.tenant_id = config.CLIENT_NAME;
          }
          if (userUuid) {
            metadata.uploader_id = userUuid;
          }

          // User generates a presigned URL
          const s3Client = withPRM(S3Client, { region: region, credentials: await getCredentials() });

          const command = new PutObjectCommand({
            Bucket: `numa-${config.CLIENT_NAME}-data`,
            Key: s3Key,
            Metadata: metadata,
          });

          const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600, // URL expiration time in seconds
          });

          await axios.put(presignedUrl, file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
            onUploadProgress: (progressEvent) => {
              const fileProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              const overallProgress = Math.round((i * 100 + fileProgress) / files.length);
              setUploadProgress(overallProgress);
            },
          });

          // Skip metadata sidecar for Q Business company KB (Q doesn't use sidecars)
          const preferredKb = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'bedrock';
          const shouldCreateMetadata = !(preferredKb === 'q' && resolvedKbId === 'company');

          if (shouldCreateMetadata) {
            try {
              const metadataAttributes: Record<string, string> = {
                kb_id: resolvedKbId,
                uploaded_at: metadata.uploaded_at,
              };
              if (config?.CLIENT_NAME) {
                metadataAttributes.tenant_id = config.CLIENT_NAME;
              }
              if (userUuid) {
                metadataAttributes.uploader_id = userUuid;
              }
              const userEmail = user?.decoded_tokens?.idToken?.email;
              if (userEmail) {
                metadataAttributes.uploader_email = userEmail;
              }

              const metadataPayload = {
                metadataAttributes,
              };

              await s3Client.send(
                new PutObjectCommand({
                  Bucket: `numa-${config.CLIENT_NAME}-data`,
                  Key: `${s3Key}.metadata.json`,
                  Body: JSON.stringify(metadataPayload),
                  ContentType: 'application/json',
                })
              );
            } catch (metadataError) {
              console.warn('Failed to upload metadata sidecar for S3 Vectors KB', {
                file: relativePath,
                error: metadataError instanceof Error ? metadataError.message : metadataError,
              });
            }
          }
        } catch (fileError) {
          console.error('❌ Error uploading file:', {
            file: relativePath,
            error: fileError.message,
            response: fileError.response?.data,
          });
          throw new Error(`Failed to upload ${relativePath}: ${fileError.message}`);
        }
      }

      setSuccess(true);

      // Clear all file-related state after successful upload
      setFiles([]);
      setFileStructure({
        files: [],
        folders: new Set(),
      });
      setTotalFiles(0);

      // Reset file inputs to allow re-adding the same files
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (folderInputRef.current) {
        folderInputRef.current.value = '';
      }

      onUploadSuccess();
    } catch (err) {
      console.error('Upload error:', err);
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        t('fileUploader.errors.uploadFailed');

      setError(errorMessage);
      setDetailedError(`Detailed error: ${JSON.stringify(err.response?.data || err.message, null, 2)}`);
    } finally {
      setIsUploading(false);
      setUploadingFileIndex(0);
      setCurrentFileName('');
    }
  };

  useEffect(() => {
    if (!autoUploadPreloaded || pendingAutoUploadBatchId === null) return;
    if (autoUploadedBatchId.current === pendingAutoUploadBatchId) return;
    if (isUploading || !fileStructure.files.length || !config?.CLIENT_NAME) return;

    autoUploadedBatchId.current = pendingAutoUploadBatchId;
    void handleUpload();
  }, [
    autoUploadPreloaded,
    pendingAutoUploadBatchId,
    isUploading,
    fileStructure.files.length,
    config?.CLIENT_NAME,
    handleUpload,
  ]);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items);
    const files: ExtendedFile[] = [];
    let droppedDirectory = false;
    let droppedLooseFile = false;

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry?.isDirectory) {
          droppedDirectory = true;
          if (!rejectFolders) {
            await readDirectory(entry as FileSystemDirectoryEntry, files);
          }
        } else if (entry?.isFile) {
          droppedLooseFile = true;
          const file = item.getAsFile();
          if (file) {
            files.push(file as ExtendedFile);
          }
        }
      }
    }

    if (rejectFolders && droppedDirectory) {
      setFolderRejection(droppedLooseFile ? 'mixed' : 'folders-only');
    } else if (!droppedDirectory) {
      // Clear any prior rejection on a clean drop
      setFolderRejection(null);
    }

    if (files.length) {
      // Always call onFileSelect first to allow parent to handle validation and warnings
      if (onFileSelect) {
        onFileSelect(files);
      }

      // Validate files if validateFile function is provided
      let validFiles = files;
      let invalidFileNames = '';
      if (validateFile) {
        const invalidFiles = files.filter((file) => !validateFile(file));
        if (invalidFiles.length > 0) {
          invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
          validFiles = files.filter((file) => validateFile(file));
          if (validFiles.length === 0) {
            setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
            return;
          }
        }
      }

      // Create a set of unique folder paths
      // Get existing files from state and combine with newly dropped files
      const stateFiles = [...fileStructure.files]; // Get existing files from state
      const combinedFiles = [...stateFiles, ...validFiles];
      const folders = new Set([...fileStructure.folders]);

      validFiles.forEach((file) => {
        const path = file.customRelativePath || file.webkitRelativePath || file.name;
        const parts = path.split('/');
        // Add all parent folders
        for (let i = 0; i < parts.length - 1; i++) {
          folders.add(parts.slice(0, i + 1).join('/'));
        }
      });

      setFileStructure({
        files: combinedFiles,
        folders: folders,
      });
      setFiles(combinedFiles);
      setTotalFiles(combinedFiles.length);
      if (invalidFileNames) {
        setError(t('fileUploader.errors.invalidFiles', { files: invalidFileNames }));
      } else {
        setError(null);
      }
      setSuccess(false);
      setUploadProgress(0);
    }
  };

  const readDirectory = async (dirEntry: FileSystemDirectoryEntry, files: ExtendedFile[]): Promise<void> => {
    const reader = dirEntry.createReader();

    // readEntries may return results in batches - must loop until empty
    let entries: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      entries = entries.concat(batch);
    } while (batch.length > 0);

    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject);
        });
        const relativePath = entry.fullPath.substring(1); // Remove leading slash
        if (isFalseFolder(file) || isSystemFile(relativePath, file.name)) continue;
        (file as ExtendedFile).customRelativePath = relativePath;
        files.push(file as ExtendedFile);
      } else if (entry.isDirectory) {
        await readDirectory(entry as FileSystemDirectoryEntry, files);
      }
    }
  };

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (success || uploadProgress === 100) {
      setShowSuccess(true);
      setShowProgress(true);
      timeoutId = setTimeout(() => {
        setShowSuccess(false);
        setShowProgress(false);
      }, 10000);
    }
    return () => clearTimeout(timeoutId);
  }, [success, uploadProgress]);

  const removeFile = (fileToRemove: ExtendedFile): void => {
    // Update files array
    setFiles((prev) => prev.filter((file) => file !== fileToRemove));

    // Update fileStructure
    setFileStructure((prev) => ({
      ...prev,
      files: prev.files.filter((file) => file !== fileToRemove),
    }));

    setTotalFiles((prev) => prev - 1);
    setError(null);

    // Reset file input to allow re-adding the same file
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const clearAllFiles = (): void => {
    setFiles([]);
    setFileStructure({
      files: [],
      folders: new Set(),
    });
    setTotalFiles(0);
    setError(null);
    setSuccess(false);
    setFolderRejection(null);

    // Reset file inputs to allow re-adding the same files
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  // State to track which folders are expanded/collapsed
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Toggle folder expanded/collapsed state
  const toggleFolder = (folderPath: string): void => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const renderFileTree = (): React.ReactElement | null => {
    if (!fileStructure.files.length) return null;

    // Group files by their folder path
    const groupedFiles: Record<string, ExtendedFile[]> = fileStructure.files.reduce(
      (acc: Record<string, ExtendedFile[]>, file) => {
        const path = file.customRelativePath || file.webkitRelativePath || file.name;
        const parts = path.split('/');

        // Create entries for each folder level
        for (let i = 0; i < parts.length - 1; i++) {
          const folderPath = parts.slice(0, i + 1).join('/');
          if (!acc[folderPath]) {
            acc[folderPath] = [];
          }
        }

        // Add the file to its immediate parent folder
        const parentPath = parts.slice(0, -1).join('/');
        if (!acc[parentPath]) {
          acc[parentPath] = [];
        }
        acc[parentPath].push(file);

        return acc;
      },
      {}
    );

    return (
      <div className="files-list">
        {/* Root files first */}
        {groupedFiles['']?.map((file) => (
          <div key={file.name} className="file-item">
            <div className="file-content">
              <div className="file-icon">
                <i className="bi bi-file-earmark-text" />
              </div>
              <span className="file-name" title={file.name}>
                {file.name}
              </span>
              <span className="file-size">{formatKB(file.size)}</span>
            </div>
            <button className="remove-btn" onClick={() => removeFile(file)}>
              <i className="bi bi-x"></i>
            </button>
          </div>
        ))}

        {/* Then folders with their files */}
        {Object.entries(groupedFiles)
          .filter(([folder]) => folder !== '')
          .sort(([pathA], [pathB]) => {
            const depthA = pathA.split('/').length;
            const depthB = pathB.split('/').length;
            return depthA - depthB || pathA.localeCompare(pathB);
          })
          .map(([folder, files]) => {
            const depth = folder.split('/').length;
            const folderName = folder.split('/').pop();
            const isExpanded = expandedFolders[folder] !== false; // Default to expanded if not set

            return (
              <div key={folder}>
                <div
                  className={`file-item folder-item tree-item`}
                  data-depth={Math.max(0, depth - 1)}
                  onClick={() => toggleFolder(folder)}
                >
                  <div className="file-content">
                    <div className="file-icon">
                      <i className={`bi ${isExpanded ? 'bi-folder-minus' : 'bi-folder-plus'}`} />
                    </div>
                    <span className="file-name">
                      {folderName}
                      <span className="folder-count">{t('fileUploader.folderCount', { count: files.length })}</span>
                    </span>
                  </div>
                  <button className="toggle-btn">
                    <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
                  </button>
                </div>
                {isExpanded &&
                  files.map((file) => {
                    const fileName = file.name.split('/').pop();
                    return (
                      <div key={file.name} className={`file-item tree-item`} data-depth={depth}>
                        <div className="file-content">
                          <div className="file-icon">
                            <i className="bi bi-file-earmark-text" />
                          </div>
                          <span className="file-name" title={fileName}>
                            {fileName}
                          </span>
                          <span className="file-size">{formatKB(file.size)}</span>
                        </div>
                        <button
                          className="remove-btn"
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent folder toggle when clicking remove
                            removeFile(file);
                          }}
                        >
                          <i className="bi bi-x"></i>
                        </button>
                      </div>
                    );
                  })}
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div
      className={`upload-container bg-light p-4 rounded ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {error && (
        <Alert variant="danger">
          <div>{error}</div>
          {detailedError && (
            <pre className="mt-2 p-2 bg-light" style={{ whiteSpace: 'pre-wrap' }}>
              {detailedError}
            </pre>
          )}
        </Alert>
      )}

      {folderRejection && (
        <Alert variant="warning" dismissible onClose={() => setFolderRejection(null)}>
          <div>{t('fileUploader.foldersRejected')}</div>
          {folderRejection === 'mixed' && <div className="mt-2">{t('fileUploader.foldersRejectedFilesAdded')}</div>}
        </Alert>
      )}

      <div className="text-center">
        <input style={{ display: 'none' }} ref={fileInputRef} type="file" onChange={handleFileSelect} multiple />
        {showFolderPicker && (
          <input
            style={{ display: 'none' }}
            ref={folderInputRef}
            type="file"
            onChange={handleFolderSelect}
            // @ts-expect-error webkitdirectory is a non-standard attribute
            webkitdirectory=""
            multiple
          />
        )}

        <div className="mb-3">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2">
            {showFolderPicker ? t('fileUploader.dragAndDropFilesOrFolders') : t('fileUploader.dragAndDrop')}
          </p>
          <div className="d-flex gap-2 justify-content-center">
            <Button
              variant="primary"
              type="button"
              style={{ cursor: 'pointer' }}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('fileUploader.selectFiles')}
            </Button>
            {showFolderPicker && (
              <Button
                variant="primary"
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() => folderInputRef.current?.click()}
              >
                <i className="bi bi-folder-plus me-1" />
                {t('fileUploader.selectFolder')}
              </Button>
            )}
          </div>
        </div>

        {fileStructure.files.length > 0 && (
          <div className="s3-files-section">
            <div className="files-header">
              <span className="files-count-label">
                {t('fileUploader.filesSelected', { count: fileStructure.files.length })}
              </span>
              <button className="clear-all-btn" onClick={clearAllFiles}>
                {t('fileUploader.clearAll')}
              </button>
            </div>

            {renderFileTree()}

            <div className="mt-4 text-center">
              {isUploading && (
                <div className="mb-3">
                  <p className="mb-2">
                    {t('fileUploader.uploadingProgress', {
                      current: uploadingFileIndex + 1,
                      total: totalFiles,
                    })}
                  </p>
                  {currentFileName && (
                    <p className="mb-2 text-muted small">{t('fileUploader.currentFile', { name: currentFileName })}</p>
                  )}
                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${uploadProgress}%` }} role="progressbar">
                      {uploadProgress}%
                    </div>
                  </div>
                </div>
              )}

              {requireFolderDestination && fileStructure.folders.size > 0 && (
                <Alert variant="warning" className="mb-3 text-start">
                  <i className="bi bi-exclamation-triangle me-2" />
                  {t('fileUploader.folderDestinationRequired')}
                </Alert>
              )}
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={
                  !fileStructure.files.length ||
                  isUploading ||
                  (requireFolderDestination && fileStructure.folders.size > 0)
                }
              >
                {isUploading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    {t('fileUploader.uploading')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-cloud-upload me-2"></i>
                    {t('fileUploader.uploadButton', { count: fileStructure.files.length })}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
      {success && (
        <Alert variant="success" className="mt-3">
          {t('fileUploader.success')}
        </Alert>
      )}
    </div>
  );
};

export { FileUploader };
