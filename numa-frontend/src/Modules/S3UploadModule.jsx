import { useState, useEffect } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Row, Col, Button, Form } from 'react-bootstrap';

function S3UploadModule({ task, onComplete, onNotComplete }) {
  const { taskInputValues, updateTaskInputValue } = useNumaApp();
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadedFilePath, setUploadedFilePath] = useState('');

  // Extracting task parameters
  const bucketName = task?.params.bucketName;

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus(null);

      // Only call onNotComplete if the task was previously marked as complete
      if (taskInputValues[task.id]) {
        onNotComplete();
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploadStatus('Uploading...');

      // Simulate an S3 upload (replace with actual S3 upload logic)
      const simulatedFileKey = selectedFile.name;
      console.log('Uploading to:', bucketName);
      console.log('File Key:', simulatedFileKey);

      // Simulated delay for the upload process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      setUploadStatus('Upload successful!');
      setUploadedFilePath(simulatedFileKey);

      // Update the global task input values with the file path
      updateTaskInputValue(task.id, simulatedFileKey);
      onComplete(); // Mark task as complete
    } catch (error) {
      console.error('Error during file upload:', error);
      setUploadStatus('Upload failed');
    }
  };

  return (
    <div className="card card-apps">
      <div className="card-header">
        <Row>
          <Col lg={12}>
            {task?.title}
            <br />
          </Col>
        </Row>
      </div>

      <div className="card-body">
        <Form.Group controlId={`file-upload-${task.id}`}>
          <Form.Label>Select a file to upload:</Form.Label>
          <Form.Control type="file" onChange={handleFileChange} />
        </Form.Group>

        <Button
          onClick={handleUpload}
          disabled={!selectedFile || uploadStatus === 'Uploading...'}
          className="mt-2"
        >
          Upload
        </Button>

        {uploadStatus && <p className="mt-2">{uploadStatus}</p>}
        {/* Display the selected file name or uploaded file path */}
        {taskInputValues[task.id] && !uploadStatus && (
          <p className="mt-2">
            File: <strong>{taskInputValues[task.id]}</strong>
          </p>
        )}
      </div>

      <div className="card-footer"></div>
    </div>
  );
}

export { S3UploadModule };
