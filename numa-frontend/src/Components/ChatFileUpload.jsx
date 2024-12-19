import React, { useState } from 'react';
import { Modal, Button } from 'react-bootstrap';

// Supported file extensions
const SUPPORTED_EXTENSIONS = [
  '.txt', '.csv', '.md', '.pdf',
  '.doc', '.docx', '.xls', '.xlsx',
  '.ppt', '.pptx'
];

const getFileExtension = (filename) => {
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex > -1 ? filename.slice(lastDotIndex).toLowerCase() : '';
};

const ChatFileUpload = ({ show, onHide, onUploadSuccess }) => {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    try {
      const selectedFiles = Array.from(event.target.files);

      // Validate file types
      const unsupportedFiles = selectedFiles.filter(file =>
        !SUPPORTED_EXTENSIONS.includes(getFileExtension(file.name))
      );

      if (unsupportedFiles.length > 0) {
        setError(`Unsupported file type(s): ${unsupportedFiles.map(f => f.name).join(', ')}\nSupported types: ${SUPPORTED_EXTENSIONS.join(', ')}`);
        return;
      }

      // Store files with original File object
      setFiles(selectedFiles.map(file => ({
        name: file.name,
        size: file.size,
        type: file.type || 'text/plain',
        file: file
      })));
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

  const handleSubmit = async () => {
    if (files.length === 0) {
      setError('Please select at least one file.');
      return;
    }

    try {
      // Process files and read their content
      const processedFiles = await Promise.all(files.map(async (fileInfo) => {
        // Read file content as text
        const text = await fileInfo.file.text();
        // Convert to base64
        const base64Data = btoa(unescape(encodeURIComponent(text)));

        return {
          name: fileInfo.name,
          size: fileInfo.size,
          type: fileInfo.type || 'text/plain',
          data: base64Data // Send base64 encoded content
        };
      }));

      console.log('Files being sent to NumaChat:', processedFiles.map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
        dataLength: f.data?.length
      })));

      onUploadSuccess(processedFiles);
      setFiles([]);
      setError(null);
    } catch (error) {
      console.error('Error submitting files:', error);
      setError('Failed to upload files. Please try again.');
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
            onChange={handleFileChange}
            multiple
            className="form-control"
            accept=".txt,.csv,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          />
          {files.length > 0 && (
            <div className="uploaded-files mt-3">
              <h6>Selected Files:</h6>
              <ul className="file-list list-unstyled">
                {files.map((file, index) => (
                  <li key={index} className="file-item">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size text-muted ms-2">({(file.size / 1024).toFixed(1)} KB)</span>
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="remove-file btn btn-link p-0 ms-2"
                      title="Remove file"
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
