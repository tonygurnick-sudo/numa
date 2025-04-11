import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { useAuth } from '../Providers/AuthProvider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { Preloader } from '../Components/Preloader';
import PropTypes from 'prop-types';
import { useJobsApi } from '../Services/jobsApi';

// Default no-op functions
const noop = () => {};

function S3UploadModule({ task, onComplete = noop, onNotComplete = noop, onChange = noop, value, disabled = false }) {
  const {
    loading,
    numaAppId,
    appRunning,
    numaTaskResponses,
    currentJobId,
    setCurrentJobId,
    numaAppData,
    taskInputValues,
  } = useNumaApp();
  const jobsApi = useJobsApi();
  const { getIdentityPoolCredentials } = useAuth();

  // Extract parameters from task with defaults
  const acceptedFileTypes = task?.parameters?.allowedFileTypes ?? [];
  const maxFileSize = task?.parameters?.maximumFileSize ?? null;
  const minFiles = task?.parameters?.minFiles ?? 0;
  const maxFiles = task?.parameters?.maxFiles ?? null;
  const userMessage = task?.parameters?.userMessage;

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [bucketName, setBucketName] = useState();
  const [region, setRegion] = useState();

  const fileInputRef = useRef(null);
  const taskResponse = numaTaskResponses?.find((response) => response?.taskId === task.id);

  // Handle value prop changes - extract file names from various input formats
  // This useEffect handles the value prop which can come in different formats
  // We support both the new standardized format (array of objects with name, key, id)
  // and legacy formats (string, single object, array of strings) for backward compatibility
  useEffect(() => {
    if (!value) return;

    if (process.env.NODE_ENV === 'development') {
      console.log('S3UploadModule received value:', value);
    }

    // Process the value based on its format
    if (Array.isArray(value)) {
      // Handle the standardized format (array of maps with name, key, id)
      if (value.length > 0 && typeof value[0] === 'object' && value[0].name && value[0].key) {
        // Already in the correct format
        setSelectedFiles(value.map((file) => ({ name: file.name })));
      } else {
        // Legacy format: array of strings or other objects
        setSelectedFiles(
          value.map((file) => ({
            name: typeof file === 'string' ? file.split('/').pop() : file.fileName || file.name || 'Unknown file',
          })),
        );
      }
    } else if (typeof value === 'string') {
      // Legacy format: string file path
      setSelectedFiles([{ name: value.split('/').pop() }]);
    } else if (typeof value === 'object' && value !== null) {
      // Legacy format: single object
      // Check if it's already in the new format
      if (value.name && value.key) {
        setSelectedFiles([{ name: value.name }]);
      } else {
        setSelectedFiles([{ name: value.fileName || value.name || 'Unknown file' }]);
      }
    }

    // Mark as uploaded since we have a value
    setUploadStatus('Upload successful!');
  }, [value]);

  const fetchConfig = useCallback(async () => {
    const config = await (await fetch('/config.json')).json();
    setBucketName(`numa-${config.CLIENT_NAME}-outputs`);
    setRegion(config.REGION);
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Handle initial completion status based on whether the upload is required
  useEffect(() => {
    // Check if this is a chat file upload (special case)
    const isChatFileUpload = task?.id === 'chatFileUpload';

    // For chat file uploads, don't automatically call onComplete
    if (isChatFileUpload) {
      return;
    }

    // For other cases, proceed with normal behavior
    // Check if the task is required (default to false for better user experience)
    const isRequired = task?.required !== undefined ? task.required : false;

    // If the upload is not required, mark as complete by default
    if (!isRequired) {
      // Always pass an empty array to onComplete to avoid undefined errors
      onComplete([]);
    } else {
      // For required uploads, check if there's already a value
      if (value) {
        // Pass the value as an array to onComplete
        onComplete(Array.isArray(value) ? value : [value]);
      } else {
        onNotComplete();
      }
    }
  }, []);

  const validateFileCount = (files) => {
    if (minFiles > 0 && files.length < minFiles) {
      return `At least ${minFiles} file${minFiles > 1 ? 's' : ''} required`;
    }
    if (maxFiles && files.length > maxFiles) {
      return `Maximum of ${maxFiles} file${maxFiles > 1 ? 's' : ''} allowed`;
    }
    return null;
  };

  const validateFile = (file) => {
    // Check file type if acceptedFileTypes is specified
    if (acceptedFileTypes && acceptedFileTypes.length > 0) {
      if (!acceptedFileTypes.includes(file.type)) {
        return {
          validFile: null,
          error: `${file.name}: Invalid file type. Accepted types: ${acceptedFileTypes.join(', ')}`,
        };
      }
    }

    // Check file size if maxFileSize is specified (convert MB to bytes)
    if (maxFileSize && file.size > maxFileSize * 1024 * 1024) {
      return {
        validFile: null,
        error: `${file.name}: File is too large. Maximum size allowed is ${maxFileSize.toFixed(2)} MB`,
      };
    }

    return { validFile: file, error: null };
  };

  const removeFile = (fileToRemove) => {
    setSelectedFiles((prev) => prev.filter((file) => file.name !== fileToRemove.name));
    setError(null);
    onNotComplete();
    onChange(null);
  };

  const handleFileSelection = (fileList) => {
    const newFiles = Array.from(fileList);
    const combinedFiles = [...selectedFiles, ...newFiles];

    // Check file count constraints with combined files
    const fileCountError = validateFileCount(combinedFiles);
    if (fileCountError) {
      setError(fileCountError);
      return;
    }

    const validFiles = [];
    const errors = [];

    newFiles.forEach((file) => {
      const { validFile, error: fileError } = validateFile(file);
      if (validFile) {
        validFiles.push(validFile);
      }
      if (fileError) {
        errors.push(fileError);
      }
    });

    if (errors.length > 0) {
      setError(errors.join('\n'));
      onNotComplete();
      return;
    }

    if (validFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...validFiles]);
      setUploadStatus(null);
      setUploadProgress(0);
      setError(null);
      onNotComplete();
      onChange(null);
    }
  };

  const handleFileChange = (e) => {
    handleFileSelection(e.target.files);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileSelection(e.dataTransfer.files);
  };

  const handleZoneClick = (e) => {
    if (!selectedFiles.length && e.target === e.currentTarget) {
      fileInputRef.current.click();
    }
  };

  const handleUpload = async () => {
    // Check if the task is required (default to false for better user experience)
    const isRequired = task?.required !== undefined ? task.required : false;

    if (!selectedFiles.length) {
      if (isRequired) {
        setError('Please select at least one file');
        return;
      } else {
        // If upload is not required and no file is selected, mark as complete and return
        setUploadStatus('No file uploaded');
        onChange('');
        onComplete();
        return;
      }
    }

    // Initialize results array at the beginning to ensure it's always available
    const results = [];

    try {
      setError(null);

      // Create a job if we don't have a job ID yet
      // This ensures we have a consistent job ID for all uploads
      let jobId = currentJobId;
      if (!jobId && numaAppData) {
        setUploadStatus('Creating job for file uploads...');
        try {
          // First create a job to get a job ID
          // We'll upload the files using this job ID, then update the job with the file paths
          const jobResponse = await jobsApi.createJob(numaAppData, {}, 'files-uploaded');
          jobId = jobResponse.jobID;
          setCurrentJobId(jobId);
        } catch (error) {
          console.error('Failed to create job for file uploads:', error);
          setError('Failed to create job for file uploads. Please try again.');

          // Call onComplete with empty array in case of error
          if (onComplete) {
            onComplete(results);
          }
          return;
        }
      }

      const s3Client = new S3Client({
        region,
        credentials: await getIdentityPoolCredentials(),
      });
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadStatus(`Uploading file ${i + 1} of ${selectedFiles.length}: ${file.name}`);
        setUploadProgress(0);

        // Generate a random string to prevent name clashes
        const randomId = Math.random().toString(36).substring(2, 15);

        // Split the filename and extension for better formatting
        const lastDotIndex = file.name.lastIndexOf('.');
        const fileName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
        const fileExt = lastDotIndex !== -1 ? file.name.substring(lastDotIndex) : '';

        // Create the S3 key with random string to prevent name clashes
        const s3Key = `${numaAppId}/${jobId}/${fileName}_${randomId}${fileExt}`;

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 3600,
        });

        await axios.put(presignedUrl, file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          onUploadProgress: (progressEvent) => {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(progress);
          },
        });

        results.push({
          filePath: s3Key,
          fileName: file.name,
          fileType: file.type,
          s3Bucket: bucketName,
          file,
          randomId,
        });
      }

      // Create the standardized format objects with id, name, s3_key
      // This is the new format required by the task system
      const fileObjects = results.map((r) => ({
        id: r.randomId,
        name: r.fileName,
        s3_key: r.filePath,
      }));

      // Keep the raw results for chat page compatibility
      // The chat page needs the full result objects with presignedUrl etc.

      // Update the job with the standardized file format
      try {
        // Create an object with just this task's input
        // ALWAYS store the standardized format (array of objects with id, name, s3_key)
        const fileInputs = {
          [task.id]: fileObjects,
        };

        // Merge with existing task input values
        const mergedInputs = { ...taskInputValues, ...fileInputs };

        // Update the job with the standardized format and status, but don't modify results
        await jobsApi.updateJob(numaAppData, jobId, undefined, mergedInputs, 'files-uploaded');
      } catch (updateError) {
        console.error('Failed to save file paths to job:', updateError);
        // Continue with the upload process even if the update fails
      }

      setUploadStatus(`Upload successful!`);

      // Pass the standardized format (array of objects with id, name, s3_key) to the task system
      onChange(fileObjects);

      // Store the file objects in the component state for UI display
      setSelectedFiles(fileObjects.map((obj) => ({ name: obj.name })));

      // Pass the raw results to onComplete for chat page compatibility
      // ALWAYS ensure we pass a valid array, even if results is undefined
      onComplete(results || []); // needed for numa chat

      // Indicate that files are uploaded and ready for processing
      console.log(`Files uploaded successfully to job ${jobId}`);
    } catch (error) {
      console.error('Error during file upload:', error);

      let errorMessage;
      if (error.response?.status === 403) {
        errorMessage = 'Permission denied - please check your access rights';
      } else if (error.response?.status === 401) {
        errorMessage = 'Session expired - please log in again';
      } else if (error.message.includes('Authentication error')) {
        errorMessage = error.message;
      } else if (error.message.includes('upload URL')) {
        errorMessage = 'Server configuration error - please contact support';
      } else if (error.code === 'ERR_NETWORK') {
        errorMessage = 'Network error - please check your internet connection';
      } else {
        errorMessage =
          error.response?.data?.error || error.response?.data?.message || error.message || 'Error uploading file';
      }

      setError(errorMessage);

      // Ensure onComplete is called with an empty array in case of errors
      // This prevents 'Cannot read properties of undefined (reading \'length\')' errors
      if (onComplete) {
        onComplete([]);
      }
    }
  };

  // Ensure selectedFiles is always an array
  useEffect(() => {
    if (selectedFiles && !Array.isArray(selectedFiles)) {
      setSelectedFiles([selectedFiles]);
    }
  }, [selectedFiles]);

  return (
    <div className="task-container">
      {task?.title && <h3>{task.title}</h3>}
      {userMessage && <div className="alert alert-info mb-3">{userMessage}</div>}

      <div
        className={`upload-container bg-light p-4 rounded  ${isDragging ? 'dragging' : ''} ${
          disabled ? 'disabled' : ''
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
            disabled={disabled}
          >
            Select Files
          </Button>
          {error && <div className="alert alert-danger mt-3">{error}</div>}

          {uploadStatus && (
            <div className="mt-3">
              <p>{uploadStatus}</p>
              {/* Show progress bar if between 0 and 100 */}
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="progress">
                  <div
                    className="progress-bar"
                    role="progressbar"
                    style={{ width: `${uploadProgress}%` }}
                    aria-valuenow={uploadProgress}
                    aria-valuemin="0"
                    aria-valuemax="100"
                  >
                    {uploadProgress}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {appRunning && !taskResponse?.result && <Preloader overlayParent={true} />}
        {selectedFiles.length > 0 && (
          <>
            <div className="selected-files mb-3">
              <h6 className="text-center">Selected Files:</h6>
              {selectedFiles.map((file, index) => (
                <div key={index} className="d-flex align-items-center justify-content-center mb-1">
                  <span className="me-2 text-center">{file.name}</span>
                  <Button
                    variant="link"
                    className="p-0 text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file);
                    }}
                  >
                    <i className="bi bi-x-circle"></i>
                  </Button>
                </div>
              ))}
              <Button
                variant="outline-secondary"
                size="sm"
                className="mt-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFiles([]);
                  setError(null);
                  onNotComplete();
                  onChange(null);
                }}
              >
                Clear All Files
              </Button>
            </div>
            {selectedFiles.length > 0 && !uploadStatus && (
              <Button variant="primary" onClick={handleUpload} className="mt-3" disabled={loading || disabled}>
                Upload
              </Button>
            )}
          </>
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
          disabled={disabled}
        />
      </div>
    </div>
  );
}

S3UploadModule.propTypes = {
  task: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string,
    required: PropTypes.bool,
    parameters: PropTypes.shape({
      allowedFileTypes: PropTypes.arrayOf(PropTypes.string),
      maximumFileSize: PropTypes.number,
    }),
  }),
  onComplete: PropTypes.func,
  onNotComplete: PropTypes.func,
  onChange: PropTypes.func,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.array, PropTypes.object]),
};

export { S3UploadModule };
