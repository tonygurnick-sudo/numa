import { useState } from 'react';
import { Modal, Button } from 'react-bootstrap';

// Supported file extensions and MIME types
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
const SUPPORTED_EXTENSIONS = ['.txt', '.csv', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
const SUPPORTED_MIME_TYPES = {
  'text/plain': '.txt',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'application/msword': '.doc',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

const getFileExtension = (filename) => {
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex > -1 ? filename.slice(lastDotIndex).toLowerCase() : '';
};

const ChatFileUpload = ({ show, onHide, onUploadSuccess }) => {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);

  const validateFile = (file) => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        `File size exceeds 10MB limit. File "${file.name}" is ${(file.size / (1024 * 1024)).toFixed(2)}MB`,
      );
    }

    // Check file type by both extension and MIME type
    const extension = getFileExtension(file.name);
    const mimeType = file.type;

    const isValidExtension = SUPPORTED_EXTENSIONS.includes(extension);
    const isValidMimeType = Object.keys(SUPPORTED_MIME_TYPES).includes(mimeType);

    if (!isValidExtension && !isValidMimeType) {
      throw new Error(`Invalid file type: "${file.name}". Please upload PDF, DOCX, or TXT files only.`);
    }

    return true;
  };

  const handleFileChange = (event) => {
    try {
      const selectedFiles = Array.from(event.target.files);

      // Validate each file
      const validationErrors = [];
      const validFiles = [];

      selectedFiles.forEach((file) => {
        try {
          validateFile(file);
          validFiles.push(file);
        } catch (error) {
          validationErrors.push(error.message);
        }
      });

      if (validationErrors.length > 0) {
        setError(validationErrors.join('\n'));
        return;
      }

      // Append new files to existing ones
      setFiles((prevFiles) => [
        ...prevFiles,
        ...validFiles.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type || 'text/plain',
          file: file,
        })),
      ]);
      setError(null);
    } catch (error) {
      console.error('Error selecting files:', error);
      setError('Failed to select files. Please try again.');
    }
  };

  const handleRemoveFile = (index) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
  };

  const readFileContent = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result;
        // Check content size before encoding
        const contentSize = new Blob([text]).size;
        if (contentSize > MAX_FILE_SIZE) {
          reject(
            new Error(
              `File content size exceeds 10MB limit. File "${file.name}" content is ${(
                contentSize /
                (1024 * 1024)
              ).toFixed(2)}MB`,
            ),
          );
          return;
        }
        // Convert to base64
        try {
          const base64Data = btoa(unescape(encodeURIComponent(text)));
          resolve(base64Data);
        } catch (error) {
          reject(new Error(`Error encoding file "${file.name}": ${error.message}`));
        }
      };
      reader.onerror = () => reject(new Error(`Error reading file: ${file.name}`));
      reader.readAsText(file);
    });
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      setError('Please select at least one file.');
      return;
    }

    try {
      // Process files and read their content
      const processedFiles = await Promise.all(
        files.map(async (fileInfo) => {
          try {
            const base64Data = await readFileContent(fileInfo.file);
            return {
              name: fileInfo.name,
              size: fileInfo.size,
              type: fileInfo.type || 'text/plain',
              data: base64Data,
            };
          } catch (error) {
            throw new Error(`Error processing file "${fileInfo.name}": ${error.message}`);
          }
        }),
      );

      onUploadSuccess(processedFiles);
      setFiles([]);
      setError(null);
      onHide();
    } catch (error) {
      console.error('Error submitting files:', error);
      setError(error.message || 'Failed to upload files. Please try again.');
    }
  };

  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>Upload Files for Chat</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="chat-file-upload">
          <input
            type="file"
            className="form-control"
            multiple
            accept={SUPPORTED_EXTENSIONS.join(',')}
            onChange={handleFileChange}
            data-testid="file-input"
          />
          <p className="text-muted small mt-2">
            Accepts {SUPPORTED_EXTENSIONS.join(', ').replace(/\./g, '').toUpperCase()} files up to 10MB each
          </p>
          {files.length > 0 && (
            <div className="uploaded-files mt-3">
              <h6>Selected Files:</h6>
              <ul className="file-list list-unstyled">
                {files.map((file, index) => (
                  <li key={index} className="file-item">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size text-muted ms-2">({(file.size / 1024).toFixed(1)} KB)</span>
                    <button
                      type="button"
                      className="btn btn-sm ms-2 remove-file-btn"
                      onClick={() => handleRemoveFile(index)}
                      aria-label={`Remove ${file.name}`}
                      data-testid={`remove-file-${file.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className="alert alert-danger mt-2">{error}</div>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit}>
          Upload
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export { ChatFileUpload };
