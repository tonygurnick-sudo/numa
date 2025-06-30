import { useState, useEffect } from 'react';
import { Button, Alert } from 'react-bootstrap';
import axios from 'axios';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../Providers/AuthProvider';

const FileUploader = ({ onUploadSuccess }) => {
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [, setShowSuccess] = useState(false);
  const [, setShowProgress] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFileIndex, setUploadingFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [detailedError, setDetailedError] = useState(null);
  const [fileStructure, setFileStructure] = useState({
    files: [],
    folders: new Set(),
  });
  const [config, setConfig] = useState(null);
  const { getCredentials } = useAuth();

  useEffect(() => {
    fetch('/config.json')
      .then((response) => response.json())
      .then((data) => setConfig(data))
      .catch((error) => console.error('Error loading config:', error));
  }, []);

  const handleFileSelect = (event) => {
    const fileList = Array.from(event.target.files);
    console.log(
      'Files to be uploaded:',
      fileList.map((file) => ({
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        type: file.type || 'application/octet-stream',
      })),
    );

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
  };

  const handleUpload = async () => {
    if (!files.length) {
      setError('Please select files first');
      return;
    }

    setError(null);
    setDetailedError(null);
    setIsUploading(true);
    setShowSuccess(false);
    setShowProgress(true);

    try {
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
        });

        try {
          console.log('Requesting presigned URL for:', relativePath);

          const encodedPath = relativePath
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');

          const region = window.sessionStorage.getItem('REGION');

          // User generates a presigned URL
          const s3Client = new S3Client({ region: region, credentials: await getCredentials() });

          const command = new PutObjectCommand({
            Bucket: `numa-${config.CLIENT_NAME}-data`,
            Key: encodedPath,
          });

          const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600, // URL expiration time in seconds
          });

          console.log('Presigned URL:', presignedUrl);

          console.log('S3 Upload Details:', {
            destinationPath: relativePath,
            uploadUrl: presignedUrl.split('?')[0], // Show URL without query parameters
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

          console.log(`✅ Successfully uploaded to: ${relativePath}`);
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
      const fileInput = document.getElementById('file-upload');
      if (fileInput) {
        fileInput.value = '';
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

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const logItemStructure = (entry, depth = 0) => {
    const indent = '  '.repeat(depth);
    if (entry.isDirectory) {
      console.log(`${indent}📁 ${entry.fullPath}`);
    } else {
      console.log(`${indent}📄 ${entry.fullPath}`);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items);
    const files = [];

    console.log('Analyzing dropped items:');

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry.isDirectory) {
          console.log(`\n📁 Found directory: ${entry.fullPath}`);
          console.log('Scanning contents...');
          await readDirectory(entry, files);
        } else {
          console.log(`📄 Found file: ${entry.fullPath}`);
          files.push(item.getAsFile());
        }
      }
    }

    if (files.length) {
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

  const readDirectory = async (dirEntry, files) => {
    const reader = dirEntry.createReader();

    const entries = await new Promise((resolve) => {
      reader.readEntries((entries) => resolve(entries));
    });

    for (const entry of entries) {
      logItemStructure(entry, 1);

      if (entry.isFile) {
        const file = await new Promise((resolve) => {
          entry.file((file) => resolve(file));
        });
        file.customRelativePath = entry.fullPath.substring(1); // Remove leading slash
        files.push(file);
      } else if (entry.isDirectory) {
        await readDirectory(entry, files);
      }
    }
  };

  useEffect(() => {
    let timeoutId;
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

  const removeFile = (fileToRemove) => {
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
    const fileInput = document.getElementById('file-upload');
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const clearAllFiles = () => {
    setFiles([]);
    setFileStructure({
      files: [],
      folders: new Set(),
    });
    setTotalFiles(0);
    setError(null);
    setSuccess(false);

    // Reset file input to allow re-adding the same files
    const fileInput = document.getElementById('file-upload');
    if (fileInput) {
      fileInput.value = '';
    }
  };

  // State to track which folders are expanded/collapsed
  const [expandedFolders, setExpandedFolders] = useState({});

  // Toggle folder expanded/collapsed state
  const toggleFolder = (folderPath) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const renderFileTree = () => {
    if (!fileStructure.files.length) return null;

    // Group files by their folder path
    const groupedFiles = fileStructure.files.reduce((acc, file) => {
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
    }, {});

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
        <input style={{ display: 'none' }} id="file-upload" type="file" onChange={handleFileSelect} multiple />

        <div className="mb-3">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2">Drag and drop your files here, or</p>
          <Button variant="primary" as="label" htmlFor="file-upload" style={{ cursor: 'pointer' }}>
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
