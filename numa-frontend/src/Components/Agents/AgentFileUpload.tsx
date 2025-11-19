import { useState, useRef, useEffect } from 'react';
import { Button, Form, Alert, ListGroup } from 'react-bootstrap';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { processFile } from '../../utils/fileProcessing';
import type { AgentReferenceFile } from '../../types/agents';

type AgentFileUploadProps = {
  onFilesUploaded: (files: AgentReferenceFile[]) => void;
  existingFiles?: AgentReferenceFile[];
  disabled?: boolean;
  maxFiles?: number;
};

const MAX_FILES_DEFAULT = 5;

export const AgentFileUpload = ({
  onFilesUploaded,
  existingFiles = [],
  disabled = false,
  maxFiles = MAX_FILES_DEFAULT,
}: AgentFileUploadProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [bucketName, setBucketName] = useState<string>();
  const [region, setRegion] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { user, getCredentials } = useAuth();
  const { numaPost } = useNumaRequest();
  const idToken = user?.decoded_tokens?.idToken ?? {};
  const sub = idToken.sub ?? 'anonymous';

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/config.json');
        if (!response.ok) {
          throw new Error(`Failed to load config.json (${response.status})`);
        }
        const config = await response.json();
        setBucketName(`numa-${config.CLIENT_NAME}-outputs`);
        setRegion(config.REGION);
      } catch (error) {
        console.warn('AgentFileUpload: falling back to session storage config', error);
        const clientName = window.sessionStorage.getItem('CLIENT_NAME');
        const sessionRegion = window.sessionStorage.getItem('REGION');
        if (clientName) {
          setBucketName(`numa-${clientName}-outputs`);
        }
        if (sessionRegion) {
          setRegion(sessionRegion);
        }
      }
    };
    loadConfig();
  }, []);

  const handleSelectFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    const totalFiles = existingFiles.length + files.length;
    if (totalFiles > maxFiles) {
      setUploadError(`Maximum ${maxFiles} files allowed per agent.`);
      return;
    }

    if (!bucketName || !region) {
      setUploadError('Configuration still loading. Please try again in a moment.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Unable to obtain AWS credentials');
      }

      const s3Client = new S3Client({
        region,
        credentials,
      });

      const uploadedFiles: AgentReferenceFile[] = [];

      for (const file of files) {
        try {
          const s3Key = await uploadFileToS3(file, s3Client, bucketName, sub);
          const processed = await processFile(
            { s3Key, s3Bucket: bucketName, fileName: file.name },
            { user },
            getCredentials,
            numaPost,
          );

          uploadedFiles.push({
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            s3Key,
            s3Bucket: bucketName,
            extractedContentS3Key: processed.extractedContentS3Key,
            uploadedAt: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Agent file upload failed', error);
          setUploadError(`Failed to upload "${file.name}": ${(error as Error)?.message ?? 'Unknown error'}`);
          break;
        }
      }

      if (uploadedFiles.length) {
        onFilesUploaded([...existingFiles, ...uploadedFiles]);
      }
    } catch (error) {
      console.error('AgentFileUpload error', error);
      setUploadError((error as Error)?.message ?? 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const uploadFileToS3 = async (file: File, s3Client: S3Client, bucket: string, userId: string): Promise<string> => {
    const randomId = Math.random().toString(36).slice(2, 10);
    const safeName = file.name.replace(/\s+/g, '_');
    const s3Key = `numa-chat/agents/${userId}/${Date.now()}_${randomId}_${safeName}`;

    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: file.type || 'application/octet-stream',
    });

    const url = await getSignedUrl(s3Client, putCommand, { expiresIn: 3600 });
    await axios.put(url, file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    return s3Key;
  };

  const handleRemoveFile = (index: number) => {
    const nextFiles = existingFiles.filter((_, idx) => idx !== index);
    onFilesUploaded(nextFiles);
  };

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex align-items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.html,.log,.ini,.cfg,.conf,.py,.js,.ts,.sh,.bash,.sql,.tex,.css,.scss,.less,.png,.jpg,.jpeg,.mp3,.mp4,.wav,.flac,.ogg,.amr,.webm,.m4a"
          style={{ display: 'none' }}
          onChange={handleSelectFiles}
          disabled={disabled || isUploading}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={disabled || isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Uploading...
            </>
          ) : (
            <>
              <i className="bi bi-upload me-1"></i> Upload Files
            </>
          )}
        </Button>
        <Form.Text muted>
          Supported: Documents (PDF, DOCX, XLSX), Images (PNG, JPG), Text/Code (TXT, MD, JSON, HTML, XML, YAML, Python,
          JavaScript, etc.), Audio/Video (MP3, MP4, WAV, etc.)
        </Form.Text>
      </div>

      {uploadError && (
        <Alert variant="danger" onClose={() => setUploadError(null)} dismissible>
          {uploadError}
        </Alert>
      )}

      {existingFiles.length > 0 && (
        <ListGroup variant="flush">
          {existingFiles.map((file, index) => (
            <ListGroup.Item
              key={`${file.s3Key}-${index}`}
              className="d-flex justify-content-between align-items-center"
            >
              <div>
                <div className="fw-semibold">{file.fileName}</div>
                <div className="text-muted small">{file.fileType || 'Unknown type'}</div>
              </div>
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => handleRemoveFile(index)}
                disabled={disabled || isUploading}
              >
                <i className="bi bi-x-lg"></i>
              </Button>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  );
};

export default AgentFileUpload;
