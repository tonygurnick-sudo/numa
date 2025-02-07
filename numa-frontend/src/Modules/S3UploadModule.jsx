import { useState, useRef } from "react";
import { Button } from "react-bootstrap";
import config from "../../public/config.json";
import { useNumaApp } from "../Providers/NumaAppProvider";
import { useNumaRequest } from "../Providers/RequestProvider";
import { useAuth } from "../Providers/AuthProvider";
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import axios from "axios";

function S3UploadModule({ task, onComplete, onNotComplete, onChange }) {
  const { loading, numaAppId } = useNumaApp();
  const { numaGet } = useNumaRequest();
  const { getIdentityPoolCredentials } = useAuth();

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);


  // Extracting task parameters
  const taskId = task?.id;
  const taskTitle = task?.title;
  const bucketName = `numa-${config.CLIENT_NAME}-outputs`;

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus(null);
      setUploadProgress(0);
      setError(null);
      onNotComplete();
    }
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

    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus(null);
      setUploadProgress(0);
      setError(null);
      onNotComplete();
    }
  };

  const handleZoneClick = (e) => {
    // Only trigger file input if clicking directly on the upload zone or button
    if (!selectedFile && e.target === e.currentTarget) {
      fileInputRef.current.click();
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please select a file first");
      return;
    }

    try {
      setUploadStatus("Uploading...");
      setError(null);

      const relativePath = selectedFile.name;
      const encodedPath = relativePath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');

      console.log("Requesting presigned URL for:", {
        fileName: relativePath,
        bucketName: bucketName,
      });

      // User generates a presigned URL
      const s3Client = new S3Client({
        region: config.REGION,
        credentials: await getIdentityPoolCredentials()
      });

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${numaAppId}/${encodedPath}`,  // Put files under the numaAppId folder
      });

      const presignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600, // URL expiration time in seconds
      });

      console.log('Presigned URL:', presignedUrl);

      // Construct the S3 object URL (without query parameters)
      const s3ObjectUrl = `https://${command.input.Bucket}.s3.${s3Client.config.region}.amazonaws.com/${command.input.Key}`;

      console.log('S3 Upload Details:', {
        destinationPath: relativePath,
        uploadUrl: s3ObjectUrl,
      });

      // Upload file to S3
      await axios.put(presignedUrl, selectedFile, {
        headers: {
          "Content-Type": selectedFile.type || "application/octet-stream",
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(progress);
        },
      });

      setUploadStatus("Upload successful!");

      // Use the onChange prop to update the value
      onChange(s3ObjectUrl);
      onComplete();
    } catch (error) {
      console.error("Error during file upload:", error);

      // Determine user-friendly error message
      let errorMessage;
      if (error.response?.status === 403) {
        errorMessage = "Permission denied - please check your access rights";
      } else if (error.response?.status === 401) {
        errorMessage = "Session expired - please log in again";
      } else if (error.message.includes("Authentication error")) {
        errorMessage = error.message;
      } else if (error.message.includes("upload URL")) {
        errorMessage = "Server configuration error - please contact support";
      } else if (error.code === "ERR_NETWORK") {
        errorMessage = "Network error - please check your internet connection";
      } else {
        errorMessage = error.response?.data?.error ||
                      error.response?.data?.message ||
                      error.message ||
                      "Error uploading file";
      }

      setError(errorMessage);
      setUploadStatus("Upload failed");
      onNotComplete?.();
    }
  };

  return (
    <div className="task-container">
      {taskTitle && <h3>{taskTitle}</h3>}

      <div
        className={`upload-container bg-light p-4 rounded ${isDragging ? "dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleZoneClick}
      >
        <input
          type="file"
          onChange={handleFileChange}
          ref={fileInputRef}
          id={`file-upload-${taskId}`}
          style={{ display: "none" }}
        />
        <div className="text-center">
          <i className="bi bi-cloud-upload" style={{ fontSize: "2rem" }}></i>
          <p className="mt-2">Drag and drop your files here, or</p>
          <Button
            variant="primary"
            as="label"
            htmlFor={`file-upload-${taskId}`}
            style={{ cursor: "pointer", pointerEvents: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            Select Files
          </Button>
          {selectedFile && (
            <div className="selected-file mt-3">
              <p className="mb-2">Selected file: {selectedFile.name}</p>
            </div>
          )}
          {selectedFile && !uploadStatus && (
            <Button
              variant="primary"
              onClick={handleUpload}
              className="mt-3"
              disabled={loading}
            >
              Upload
            </Button>
          )}

          {error && <div className="alert alert-danger mt-3">{error}</div>}

          {uploadStatus && (
            <div className="mt-3">
              <p>{uploadStatus}</p>
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

export { S3UploadModule };
