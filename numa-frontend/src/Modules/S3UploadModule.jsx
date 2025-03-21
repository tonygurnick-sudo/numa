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
      console.log('value is an array', value);
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
      console.log('value is a string', value);
      setSelectedFiles([{ name: value.split('/').pop() }]);
    } else if (typeof value === 'object' && value !== null) {
      // Legacy format: single object
      console.log('value is an object', value);
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

  const handleFileSelection = (fileList) => {
    const files = Array.from(fileList);
    const validFiles = [];
    const errors = [];

    files.forEach((file) => {
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

    setSelectedFiles(validFiles);
    setUploadStatus(null);
    setUploadProgress(0);
    setError(null);
    onNotComplete();
    onChange(null);
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

        const relativePath = file.name;
        const encodedPath = relativePath
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/');

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: `${numaAppId}/${jobId}/${encodedPath}`,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 3600,
        });
        const filePath = command.input.Key;

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
          filePath,
          fileName: file.name,
          fileType: file.type,
          s3Bucket: bucketName,
          file,
        });
      }

      // Format the results for the task input value
      // IMPORTANT: For backend compatibility, we need to follow the original format:
      // - For single file uploads: use the file path as a string (not in an array)
      // - For multiple file uploads: use an array of file paths
      // This is required by the state machine which expects $.uploaded_files to be an array of strings

      // For backend compatibility
      // ALWAYS use an array of file paths for the meeting analyzer app
      // This ensures the state machine receives $.uploaded_files as an array
      const finalResults = results.map((r) => r.filePath);

      // For UI display and future use, we also create a standardized format
      // This isn't used by the backend but is useful for the frontend
      const fileObjects = results.map((r) => ({
        name: r.fileName,
        key: r.filePath,
        id: null, // Currently unused, but added for future compatibility
      }));

      // Update the job with the final file paths
      try {
        // Create an object with just this task's input
        // ALWAYS store as an array in the job history for consistency
        const fileInputs = {
          [task.id]: Array.isArray(finalResults) ? finalResults : [finalResults],
        };

        // Merge with existing task input values
        const mergedInputs = { ...taskInputValues, ...fileInputs };

        // Update the job with the final file paths and status, but don't modify results
        await jobsApi.updateJob(numaAppData, jobId, undefined, mergedInputs, 'files-uploaded');
      } catch (updateError) {
        console.error('Failed to save file paths to job:', updateError);
        // Continue with the upload process even if the update fails
      }

      setUploadStatus(`Upload successful!`);

      // Pass the array of file paths to the backend (for state machine compatibility)
      onChange(finalResults);

      // Store the file objects in the component state for UI display
      setSelectedFiles(fileObjects.map((obj) => ({ name: obj.name })));

      // Pass the complete file info to the onComplete callback
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
      setUploadStatus('Upload failed');
      onNotComplete();

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

      <div
        className={`upload-container bg-light p-4 rounded ${isDragging ? 'dragging' : ''} ${
          disabled ? 'disabled' : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleZoneClick}
      >
        {appRunning && !taskResponse?.result && <Preloader overlayParent={true} />}
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
        <div className="text-center">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2">Drag and drop your files here, or</p>
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
          {selectedFiles.length > 0 && (
            <div className="selected-file mt-3" style={{ textAlign: 'left' }}>
              <p className="mb-2">Selected {selectedFiles.length === 1 ? 'file:' : 'files:'}</p>
              <ul style={{ listStyleType: 'none', listStylePosition: 'inside' }}>
                {selectedFiles.map((f, index) => (
                  <li key={index}>{f.name || 'Unknown file'}</li>
                ))}
              </ul>
            </div>
          )}
          {selectedFiles.length > 0 && !uploadStatus && (
            <Button variant="primary" onClick={handleUpload} className="mt-3" disabled={loading || disabled}>
              Upload
            </Button>
          )}

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
