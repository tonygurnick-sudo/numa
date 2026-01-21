/**
 * File Uploader Section Component
 * Reusable card wrapper for file upload functionality
 */

import React, { useState, useEffect } from 'react';
import { Card, Form, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { FileUploader } from '../FileUploader';
import { isFileTypeValidForBedrockKB } from '../../utils/fileUtils';
import { listFoldersInKB } from '../../utils/s3Utils';
import FolderSelector from './FolderSelector';
import { useAuth } from '../../Providers/AuthProvider';

interface FileUploaderSectionProps {
  kb_id: string;
  kbName?: string;
  onUploadSuccess: () => void;
  onFileSelect?: (files: File[]) => void;
  fileValidationError?: string | null;
  clearFiles?: boolean;
}

export function FileUploaderSection({
  kb_id,
  kbName,
  onUploadSuccess,
  onFileSelect,
  fileValidationError,
  clearFiles = false,
}: FileUploaderSectionProps): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const displayName = kbName || (kb_id === 'company' ? t('companyKnowledgeBase.title') : kb_id);
  const { getCredentials, region: authRegion } = useAuth();

  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState<boolean>(false);

  // Fetch folder options on mount
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        setLoadingFolders(true);
        const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
        const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
        const bucket = `numa-${CLIENT_NAME}-data`;

        const folders = await listFoldersInKB(kb_id, bucket, region, getCredentials);
        setFolderOptions(folders);
      } catch (error) {
        console.error('Error fetching folders:', error);
        setFolderOptions([]);
      } finally {
        setLoadingFolders(false);
      }
    };

    fetchFolders();
  }, [kb_id, getCredentials, authRegion]);

  return (
    <Card>
      <Card.Header>
        <Card.Title className="mb-0">{t('fileUploaderSection.title')}</Card.Title>
      </Card.Header>
      <Card.Body>
        <p className="small mt-2">{t('fileUploaderSection.description')}</p>

        <Form.Group className="mb-3">
          <Form.Label>
            <strong>{t('fileUploaderSection.destinationLabel')}</strong>
          </Form.Label>
          <Form.Control type="text" value={displayName} disabled />
          <Form.Text className="text-muted">{t('fileUploaderSection.destinationHint')}</Form.Text>
        </Form.Group>

        <FolderSelector
          selectedFolder={selectedFolder}
          onFolderChange={setSelectedFolder}
          folderOptions={folderOptions}
          disabled={loadingFolders}
        />

        {fileValidationError && (
          <Alert variant="danger" className="mb-3">
            <strong>{t('fileUploaderSection.validationTitle')}</strong>
            <p className="mb-0 mt-1">{fileValidationError}</p>
          </Alert>
        )}
        <FileUploader
          onUploadSuccess={onUploadSuccess}
          onFileSelect={onFileSelect}
          validateFile={isFileTypeValidForBedrockKB}
          clearFiles={clearFiles}
          kb_id={kb_id}
          selectedFolder={selectedFolder}
        />
      </Card.Body>
    </Card>
  );
}
