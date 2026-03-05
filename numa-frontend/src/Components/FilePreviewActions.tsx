import React, { useState } from 'react';
import { Button, Dropdown, Spinner, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createDocxBlob } from '../Services/fileConverter';
import { downloadPdf, downloadDocx } from '../Services/documentConverterService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { withPRM } from '../utils/prmUtils';
import { buildS3Key, type FileScope } from '../Services/filesService';
import { fetchFileFromS3 } from '../utils/s3Utils';
import { CreateShareModal } from './Files/CreateShareModal';
import { FolderTreeSelector } from './FolderTreeSelector';
import type { FilePreview, FolderPreview } from '../hooks/useFilePreviewProcessor';

interface FilePreviewActionsProps {
  preview: FilePreview | FolderPreview;
  content?: string; // For markdown content
  onDownloadFile: () => void;
  onDownloadFolder?: () => void;
  onOpenInNewTab?: () => void; // For HTML files
  onOpenFullScreen?: () => void; // Open in full-screen new tab
}

/**
 * Smart download actions based on file type
 * - Markdown files: PDF/DOCX conversion options
 * - Folders: Download as ZIP
 * - Other files: Direct download
 */
export const FilePreviewActions: React.FC<FilePreviewActionsProps> = ({
  preview,
  content,
  onDownloadFile,
  onDownloadFolder,
  onOpenInNewTab,
  onOpenFullScreen,
}) => {
  const { t } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const { numaPost } = useNumaRequest();
  const { getCredentials, user } = useAuth();
  const [isConverting, setIsConverting] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharingFile, setSharingFile] = useState(false);
  const [sharedFilePath, setSharedFilePath] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState('/');
  const [savingToFiles, setSavingToFiles] = useState(false);

  // Helper to check if it's a markdown file
  const isMarkdown = preview.type === 'file' && ['md', 'markdown'].includes(preview.extension.toLowerCase());

  // Client-side PDF generation for markdown
  const createPdfClientSide = async (markdownContent: string, title: string): Promise<Blob> => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let currentY = margin;

    // Simple text rendering for PDF
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    const titleLines = pdf.splitTextToSize(title, maxWidth);
    titleLines.forEach((line: string, index: number) => {
      pdf.text(line, margin, currentY + index * 7);
    });
    currentY += titleLines.length * 7 + 10;

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');

    // Simple markdown to text conversion
    const plainText = markdownContent
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    const lines = pdf.splitTextToSize(plainText, maxWidth);
    const pageHeight = pdf.internal.pageSize.getHeight();

    lines.forEach((line: string) => {
      if (currentY > pageHeight - margin) {
        pdf.addPage();
        currentY = margin;
      }
      pdf.text(line, margin, currentY);
      currentY += 5;
    });

    return pdf.output('blob');
  };

  // Handle PDF download for markdown
  const handleDownloadPdf = async () => {
    if (!content || preview.type !== 'file') return;

    setIsConverting(true);
    try {
      // Try server-side conversion first
      await downloadPdf(numaPost, content, preview.filename.replace(/\.[^/.]+$/, ''));
    } catch (serverError) {
      console.warn('Server-side PDF conversion failed, falling back to client-side:', serverError);
      try {
        const pdfBlob = await createPdfClientSide(content, preview.filename.replace(/\.[^/.]+$/, ''));
        saveAs(pdfBlob, `${preview.filename.replace(/\.[^/.]+$/, '')}.pdf`);
      } catch (clientError) {
        console.error('Error generating PDF:', clientError);
      }
    } finally {
      setIsConverting(false);
    }
  };

  // Handle DOCX download for markdown
  const handleDownloadDocx = async () => {
    if (!content || preview.type !== 'file') return;

    setIsConverting(true);
    try {
      // Try server-side conversion first
      await downloadDocx(numaPost, content, preview.filename.replace(/\.[^/.]+$/, ''));
    } catch (serverError) {
      console.warn('Server-side DOCX conversion failed, falling back to client-side:', serverError);
      try {
        const docxBlob = await createDocxBlob(content, preview.filename.replace(/\.[^/.]+$/, ''));
        saveAs(docxBlob, `${preview.filename.replace(/\.[^/.]+$/, '')}.docx`);
      } catch (clientError) {
        console.error('Error generating DOCX:', clientError);
      }
    } finally {
      setIsConverting(false);
    }
  };

  // Handle saving to Files system
  const handleSaveToFiles = async () => {
    if (!selectedFolder || preview.type !== 'file') return;

    setSavingToFiles(true);
    try {
      // Get file data from the workspace
      const region = window.sessionStorage.getItem('REGION') || 'us-east-1';
      const credentials = await getCredentials();
      if (!credentials) throw new Error('No credentials');

      // For workspace files, fetch from workspace bucket
      // The preview.fullPath contains the S3 key
      const workspaceBucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
      if (!workspaceBucket) throw new Error('Workspace bucket not found');

      const blob = await fetchFileFromS3(preview.fullPath, workspaceBucket, region, getCredentials);
      const file = new File([blob], preview.filename, { type: blob.type || 'application/octet-stream' });

      // Upload to DATA_BUCKET in the user's Files system
      const dataBucket = window.sessionStorage.getItem('DATA_BUCKET');
      const userSub = user?.decoded_tokens?.idToken?.sub;

      if (!dataBucket) throw new Error('DATA_BUCKET not configured');
      if (!userSub) throw new Error('User not authenticated');

      // Build the S3 key for the user's files
      const scope: FileScope = { type: 'my' };
      const s3Key = buildS3Key(scope, preview.filename, selectedFolder, userSub);

      // Create S3 client and upload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s3Client = withPRM(S3Client as any, { region, credentials });

      const command = new PutObjectCommand({
        Bucket: dataBucket,
        Key: s3Key,
        ContentType: file.type || 'application/octet-stream',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const presignedUrl = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: ${xhr.status}`));
        });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      });

      setShowSaveModal(false);
      console.log('Successfully saved file to Files system:', selectedFolder, preview.filename);
    } catch (error) {
      console.error('Failed to save file:', error);
    } finally {
      setSavingToFiles(false);
    }
  };

  // Handle sharing: first copy file to Files system, then create share
  const handleShareFile = async () => {
    if (preview.type !== 'file') return;

    setSharingFile(true);
    try {
      // First, copy the file to Files system (root folder)
      const region = window.sessionStorage.getItem('REGION') || 'us-east-1';
      const credentials = await getCredentials();
      if (!credentials) throw new Error('No credentials');

      // For workspace files, fetch from workspace bucket
      const workspaceBucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
      if (!workspaceBucket) throw new Error('Workspace bucket not found');

      const blob = await fetchFileFromS3(preview.fullPath, workspaceBucket, region, getCredentials);
      const file = new File([blob], preview.filename, { type: blob.type || 'application/octet-stream' });

      // Upload to DATA_BUCKET in root folder
      const dataBucket = window.sessionStorage.getItem('DATA_BUCKET');
      const userSub = user?.decoded_tokens?.idToken?.sub;

      if (!dataBucket) throw new Error('DATA_BUCKET not configured');
      if (!userSub) throw new Error('User not authenticated');

      // Build the S3 key for the user's files (root folder)
      const scope: FileScope = { type: 'my' };
      const s3Key = buildS3Key(scope, preview.filename, '/', userSub);

      // Create S3 client and upload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s3Client = withPRM(S3Client as any, { region, credentials });

      const command = new PutObjectCommand({
        Bucket: dataBucket,
        Key: s3Key,
        ContentType: file.type || 'application/octet-stream',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const presignedUrl = await getSignedUrl(s3Client as any, command, { expiresIn: 3600 });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: ${xhr.status}`));
        });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      });

      // File is now in Files system, set the path for sharing
      setSharedFilePath(`/${preview.filename}`);
      setShowShareModal(true);
    } catch (error) {
      console.error('Failed to prepare file for sharing:', error);
    } finally {
      setSharingFile(false);
    }
  };

  // Folder - Download as ZIP
  if (preview.type === 'folder') {
    return (
      <div className="file-preview-actions p-3 border-top">
        <Button
          onClick={onDownloadFolder}
          style={{
            backgroundColor: 'var(--color-primary)',
            borderColor: 'var(--color-primary)',
            color: 'white',
          }}
        >
          <i className="bi bi-file-zip me-2"></i>
          {tChat('filePreview.actions.downloadZip')}
        </Button>
      </div>
    );
  }

  // Markdown files - Show format options
  if (isMarkdown && content) {
    return (
      <div className="file-preview-actions p-3 border-top d-flex gap-2">
        {onOpenFullScreen && (
          <Button
            onClick={onOpenFullScreen}
            style={{
              backgroundColor: 'var(--color-primary)',
              borderColor: 'var(--color-primary)',
              color: 'white',
              flex: '2',
            }}
          >
            <i className="bi bi-arrows-fullscreen me-2"></i>
            {t('filePreview.actions.openFullScreen')}
          </Button>
        )}
        <Dropdown>
          <Dropdown.Toggle
            disabled={isConverting}
            style={{
              backgroundColor: 'var(--color-primary)',
              borderColor: 'var(--color-primary)',
              color: 'white',
            }}
          >
            {isConverting ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                {tChat('filePreview.actions.converting')}
              </>
            ) : (
              <>
                <i className="bi bi-download me-2"></i>
                {tChat('filePreview.actions.download')}
              </>
            )}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={handleDownloadPdf}>
              <i className="bi bi-file-pdf me-2"></i>
              {tChat('filePreview.actions.pdf')}
            </Dropdown.Item>
            <Dropdown.Item onClick={handleDownloadDocx}>
              <i className="bi bi-file-earmark-word me-2"></i>
              {tChat('filePreview.actions.docx')}
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item onClick={onDownloadFile}>
              <i className="bi bi-file-text me-2"></i>
              {tChat('filePreview.actions.rawMarkdown')}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>
    );
  }

  // Other files - Direct download, save, and share
  return (
    <>
      <div className="file-preview-actions p-3 border-top d-flex gap-2">
        {onOpenFullScreen && (
          <Button
            onClick={onOpenFullScreen}
            style={{
              backgroundColor: 'var(--color-primary)',
              borderColor: 'var(--color-primary)',
              color: 'white',
              flex: '2',
            }}
          >
            <i className="bi bi-arrows-fullscreen me-2"></i>
            {t('filePreview.actions.openFullScreen')}
          </Button>
        )}
        {onOpenInNewTab && (
          <Button variant="outline-secondary" onClick={onOpenInNewTab}>
            <i className="bi bi-box-arrow-up-right me-2"></i>
            {tChat('filePreview.actions.openInNewTab')}
          </Button>
        )}
        <Button
          onClick={onDownloadFile}
          style={{
            borderColor: 'var(--color-primary)',
            color: 'var(--color-primary)',
            backgroundColor: 'transparent',
            flex: '1',
          }}
        >
          <i className="bi bi-download me-2"></i>
          {tChat('filePreview.actions.download')}
        </Button>

        <Button variant="outline-success" onClick={() => setShowSaveModal(true)} disabled={savingToFiles}>
          <i className="bi bi-folder-plus me-1"></i>
          {t('resultRenderer.actions.save')}
        </Button>

        <Button variant="outline-info" onClick={handleShareFile} disabled={sharingFile}>
          {sharingFile ? (
            <>
              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
              {t('resultRenderer.actions.preparing')}
            </>
          ) : (
            <>
              <i className="bi bi-share me-1"></i>
              {t('resultRenderer.actions.share')}
            </>
          )}
        </Button>
      </div>

      {/* Save to Files Modal */}
      <Modal show={showSaveModal} onHide={() => setShowSaveModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{t('resultRenderer.actions.saveToFilesTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <strong>{t('resultRenderer.actions.filename')}:</strong> {preview.filename}
          </div>
          <div className="mb-3">
            <FolderTreeSelector selectedPath={selectedFolder} onPathChange={setSelectedFolder} scope={{ type: 'my' }} />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSaveModal(false)} disabled={savingToFiles}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSaveToFiles} disabled={savingToFiles}>
            {savingToFiles ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                {t('resultRenderer.actions.saving')}
              </>
            ) : (
              <>
                <i className="bi bi-folder-plus me-1"></i>
                {t('resultRenderer.actions.saveToFiles')}
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Share Modal - using CreateShareModal with pre-selected file */}
      {showShareModal && sharedFilePath && (
        <CreateShareModal
          show={showShareModal}
          onHide={() => {
            setShowShareModal(false);
            setSharedFilePath(null);
          }}
          onCreated={() => {
            // Don't close modal here — let user see the success screen with the share link.
            // Modal closes when user clicks Done (onHide).
          }}
          preSelectedFile={{
            path: sharedFilePath,
            name: preview.filename,
            scope: { type: 'my' },
          }}
        />
      )}
    </>
  );
};
