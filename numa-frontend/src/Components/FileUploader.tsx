import { useState, useEffect, useRef } from 'react';
import { Button, Alert } from 'react-bootstrap';
import axios from 'axios';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../Providers/AuthProvider';
import { withPRM } from '../utils/prmUtils';

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
}

const FileUploader: React.FC<FileUploaderProps> = ({
  onUploadSuccess,
  onFileSelect,
  validateFile,
  clearFiles,
  kb_id,
  selectedFolder,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const [fileStructure, setFileStructure] = useState<FileStructure>({
    files: [],
    folders: new Set(),
  });
  const [config, setConfig] = useState<Config | null>(null);
  const { getCredentials, user } = useAuth();

  useEffect(() => {
    fetch('/config.json')
      .then((response) => response.json())
      .then((data) => setConfig(data))
      .catch((error) => console.error('Error loading config:', error));
  }, []);

  // Clear files when clearFiles prop changes
  useEffect(() => {
    if (clearFiles) {
      console.log('Clearing files due to clearFiles prop');
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

      // Clear file input value
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [clearFiles]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const fileList = Array.from(event.target.files || []) as ExtendedFile[];
    console.log(
      'Files to be uploaded:',
      fileList.map((file) => ({
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        type: file.type || 'application/octet-stream',
      })),
    );

    // Always call onFileSelect first to allow parent to handle validation and warnings
    if (onFileSelect) {
      onFileSelect(fileList);
    }

    // Validate files if validateFile function is provided
    if (validateFile) {
      const invalidFiles = fileList.filter((file) => !validateFile(file));
      if (invalidFiles.length > 0) {
        // Don't add invalid files to the list
        return; // Stop processing if there are invalid files
      }
    }

    // Create a set of unique folder paths
    const combinedFiles = [...files, ...fileList];
    const folders = new Set([...fileStructure.folders]);

    fileList.forEach((file) => {
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
    setError(null);
    setSuccess(false);
    setUploadProgress(0);

    // Notify parent component about file selection
    if (onFileSelect) {
      onFileSelect(fileList);
    }
  };

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
      setError('Please select files first');
      return;
    }

    // Additional validation before upload if validateFile function is provided
    if (validateFile) {
      const invalidFiles = files.filter((file) => !validateFile(file));
      if (invalidFiles.length > 0) {
        const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
        setError(`Cannot upload invalid files: ${invalidFileNames}`);
        return;
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

        console.log('File details:', {
          name: file.name,
          relativePath,
          type: file.type || 'application/octet-stream',
          size: `${(file.size / 1024).toFixed(2)} KB`,
          kb_id: resolvedKbId,
        });

        try {
          console.log('Requesting presigned URL for:', relativePath);

          // Build S3 key with KB prefix and optional folder prefix
          const sanitizedRelativePath = (relativePath || file.name).replace(/^\/+/, '');
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

          console.log('Presigned URL:', presignedUrl);

          console.log('S3 Upload Details:', {
            destinationPath: s3Key,
            uploadUrl: presignedUrl.split('?')[0], // Show URL without query parameters
            metadata,
          });

          await axios.put(presignedUrl, file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
            onUploadProgress: (progressEvent) => {
              const fileProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              const overallProgress = Math.round((i * 100 + fileProgress) / files.length);
              setUploadProgress(overallProgress);
              console.log(`File progress: ${fileProgress}%, Overall: ${overallProgress}%`);
            },
          });

          console.log(`✅ Successfully uploaded to: ${s3Key}`);

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

            const metadataPayload = {
              metadataAttributes,
            };

            await s3Client.send(
              new PutObjectCommand({
                Bucket: `numa-${config.CLIENT_NAME}-data`,
                Key: `${s3Key}.metadata.json`,
                Body: JSON.stringify(metadataPayload),
                ContentType: 'application/json',
              }),
            );
          } catch (metadataError) {
            console.warn('Failed to upload metadata sidecar for S3 Vectors KB', {
              file: relativePath,
              error: metadataError instanceof Error ? metadataError.message : metadataError,
            });
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

      console.log('All files uploaded successfully');
      setSuccess(true);

      // Clear all file-related state after successful upload
      setFiles([]);
      setFileStructure({
        files: [],
        folders: new Set(),
      });
      setTotalFiles(0);

      // Reset file input to allow re-adding the same files
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      onUploadSuccess();
    } catch (err) {
      console.error('Upload error:', err);
      const errorMessage =
        err.response?.data?.error || err.response?.data?.message || err.message || 'Error uploading files';

      setError(errorMessage);
      setDetailedError(`Detailed error: ${JSON.stringify(err.response?.data || err.message, null, 2)}`);
    } finally {
      setIsUploading(false);
      setUploadingFileIndex(0);
      setCurrentFileName('');
    }
  };

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

  const logItemStructure = (entry: FileSystemEntry, depth: number = 0): void => {
    const indent = '  '.repeat(depth);
    if (entry.isDirectory) {
      console.log(`${indent}📁 ${entry.fullPath}`);
    } else {
      console.log(`${indent}📄 ${entry.fullPath}`);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items);
    const files: ExtendedFile[] = [];

    console.log('Analyzing dropped items:');

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry?.isDirectory) {
          console.log(`\n📁 Found directory: ${entry.fullPath}`);
          console.log('Scanning contents...');
          await readDirectory(entry as FileSystemDirectoryEntry, files);
        } else if (entry?.isFile) {
          console.log(`📄 Found file: ${entry.fullPath}`);
          const file = item.getAsFile();
          if (file) {
            files.push(file as ExtendedFile);
          }
        }
      }
    }

    if (files.length) {
      // Always call onFileSelect first to allow parent to handle validation and warnings
      if (onFileSelect) {
        onFileSelect(files);
      }

      // Validate files if validateFile function is provided
      if (validateFile) {
        const invalidFiles = files.filter((file) => !validateFile(file));
        if (invalidFiles.length > 0) {
          // Don't add invalid files to the list
          return; // Stop processing if there are invalid files
        }
      }

      // Create a set of unique folder paths
      // Get existing files from state and combine with newly dropped files
      const stateFiles = [...fileStructure.files]; // Get existing files from state
      const combinedFiles = [...stateFiles, ...files];
      const folders = new Set([...fileStructure.folders]);

      files.forEach((file) => {
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
      setError(null);
      setSuccess(false);
      setUploadProgress(0);
    }
  };

  const readDirectory = async (dirEntry: FileSystemDirectoryEntry, files: ExtendedFile[]): Promise<void> => {
    const reader = dirEntry.createReader();

    const entries = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries((entries) => resolve(entries));
    });

    for (const entry of entries) {
      logItemStructure(entry, 1);

      if (entry.isFile) {
        const file = await new Promise<File>((resolve) => {
          (entry as FileSystemFileEntry).file((file) => resolve(file));
        });
        (file as ExtendedFile).customRelativePath = entry.fullPath.substring(1); // Remove leading slash
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

    // Reset file input to allow re-adding the same files
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
      {},
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
              <span className="file-size">{(file.size / 1024).toFixed(2)} KB</span>
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
                      <span className="folder-count">({files.length} files)</span>
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
                          <span className="file-size">{(file.size / 1024).toFixed(2)} KB</span>
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

      <div className="text-center">
        <input style={{ display: 'none' }} ref={fileInputRef} type="file" onChange={handleFileSelect} multiple />

        <div className="mb-3">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2">Drag and drop your files here, or</p>
          <Button
            variant="primary"
            type="button"
            style={{ cursor: 'pointer' }}
            onClick={() => fileInputRef.current?.click()}
          >
            Select Files
          </Button>
        </div>

        {fileStructure.files.length > 0 && (
          <div className="s3-files-section">
            <div className="files-header">
              <span className="files-count-label">
                {fileStructure.files.length} File{fileStructure.files.length !== 1 ? 's' : ''} Selected
              </span>
              <button className="clear-all-btn" onClick={clearAllFiles}>
                Clear all
              </button>
            </div>

            {renderFileTree()}

            <div className="mt-4 text-center">
              {isUploading && (
                <div className="mb-3">
                  <p className="mb-2">
                    Uploading file {uploadingFileIndex + 1} of {totalFiles}
                  </p>
                  {currentFileName && <p className="mb-2 text-muted small">Current file: {currentFileName}</p>}
                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${uploadProgress}%` }} role="progressbar">
                      {uploadProgress}%
                    </div>
                  </div>
                </div>
              )}

              <Button variant="primary" onClick={handleUpload} disabled={!fileStructure.files.length || isUploading}>
                {isUploading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <i className="bi bi-cloud-upload me-2"></i>
                    Upload {fileStructure.files.length} Files
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
      {success && (
        <Alert variant="success" className="mt-3">
          Your files have been uploaded successfully!
        </Alert>
      )}
    </div>
  );
};

export { FileUploader };
