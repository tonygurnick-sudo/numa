import React, { useState, useMemo } from 'react';
import { Button, Dropdown, Spinner, Modal, Form, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { createDocxBlob } from '../Services/fileConverter';
import { downloadPdf, downloadDocx } from '../Services/documentConverterService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { fetchFileFromS3, uploadFileToS3 } from '../utils/s3Utils';
import type { FilePreview, FolderPreview } from '../hooks/useFilePreviewProcessor';
import type { UserKB } from '../Services/knowledgeBaseService';
import i18n from '../i18n';

interface FilePreviewActionsProps {
  preview: FilePreview | FolderPreview;
  content?: string; // For markdown content
  onDownloadFile: () => void;
  onDownloadFolder?: () => void;
  onOpenInNewTab?: () => void; // For HTML files
  onOpenFullScreen?: () => void; // Open in full-screen new tab
  onClose?: () => void; // For modal closing
}

// Helper function to build KB prefix for S3 paths
const buildKbPrefix = (kbId: string | null | undefined): string => {
  const rawId = typeof kbId === 'string' ? kbId.trim() : '';
  if (!rawId || rawId === 'company') {
    return 'documents/company/';
  }
  const normalized = rawId.replace(/^kb-/, '');
  return `documents/kb-${normalized}/`;
};

// Helper function to convert markdown to plain text for KB upload
const convertMarkdownToPlainText = (markdown: string): string => {
  let text = markdown
    .replace(/#{1,6}\s+(.+)/g, '$1\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*[-*+]\s+(.+)$/gm, '  - $1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
};

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
  onClose,
}) => {
  const { t } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const { numaPost } = useNumaRequest();
  const { getCredentials, user } = useAuth();
  const { availableKBs, isLoadingKBs } = useKnowledgeBase();
  const [isConverting, setIsConverting] = useState(false);

  // Share state
  const [showTruncationWarning, setShowTruncationWarning] = useState(false);

  // KB upload state
  const [showKbModal, setShowKbModal] = useState(false);
  const [kbModalStep, setKbModalStep] = useState<'confirm' | 'uploading' | 'success'>('confirm');
  const [selectedKB, setSelectedKB] = useState<UserKB | null>(null);
  const [kbDocName, setKbDocName] = useState('');
  const [kbSuccessMessage, setKbSuccessMessage] = useState('');

  const hasCompanyDataFeature = Boolean(user?.features?.includes('addToCompanyData'));
  const writableKBs = useMemo(() => {
    return availableKBs.filter((kb) => {
      if (kb.kb_id === 'company') return hasCompanyDataFeature;
      return kb.role === 'OWNER' || kb.role === 'EDITOR';
    });
  }, [availableKBs, hasCompanyDataFeature]);

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

  // KB upload handlers
  const handleSelectKBAndShowModal = (kb: UserKB) => {
    setSelectedKB(kb);
    setKbDocName(preview.type === 'file' ? preview.filename.replace(/\.[^/.]+$/, '') : 'Document');
    setKbModalStep('confirm');
    setShowKbModal(true);
  };

  const handleKbUpload = async () => {
    if (!selectedKB) return;
    try {
      setKbModalStep('uploading');

      const region = window.sessionStorage.getItem('REGION') || 'us-east-1';
      const bucketName = window.sessionStorage.getItem('DATA_BUCKET');
      const clientName = window.sessionStorage.getItem('CLIENT_NAME');
      const currentDate = new Date();
      const dateStr = currentDate.toLocaleDateString(i18n.language).replace(/\//g, '-');
      const timeStr = currentDate.toLocaleTimeString(i18n.language);

      let arrayBuffer: ArrayBuffer;
      let contentType: string;
      let fileName: string;

      if (preview.type === 'file' && preview.fullPath) {
        // Real file — upload original binary with original extension
        const workspaceBucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
        if (!workspaceBucket) throw new Error('Workspace bucket not found');
        const blob = await fetchFileFromS3(preview.fullPath, workspaceBucket, region, getCredentials);
        arrayBuffer = await blob.arrayBuffer();
        contentType = blob.type || 'application/octet-stream';
        const ext = preview.extension || preview.filename.split('.').pop() || 'bin';
        fileName = `${kbDocName}-${dateStr}-${timeStr}.${ext}`;
      } else if (content) {
        // Inline document — convert markdown to plain text
        const plainText = convertMarkdownToPlainText(content);
        const blob = new Blob([plainText], { type: 'text/plain' });
        arrayBuffer = await blob.arrayBuffer();
        contentType = 'text/plain';
        fileName = `${kbDocName}-${dateStr}-${timeStr}.txt`;
      } else {
        throw new Error('No content available');
      }

      const prefix = buildKbPrefix(selectedKB.kb_id);
      const s3Key = `${prefix}${fileName}`;

      await uploadFileToS3(arrayBuffer, contentType, bucketName, s3Key, region, getCredentials);

      // Upload metadata sidecar for Bedrock indexing
      const resolvedKbId = selectedKB.kb_id || 'company';
      const preferredKb = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'bedrock';
      const shouldCreateMetadata = !(preferredKb === 'q' && resolvedKbId === 'company');

      if (shouldCreateMetadata) {
        const metadataAttributes: Record<string, string> = {
          kb_id: resolvedKbId,
          tenant_id: clientName || '',
          uploaded_at: currentDate.toISOString(),
          uploader_id: user?.sub || 'unknown',
        };
        const userEmail = user?.decoded_tokens?.idToken?.email;
        if (userEmail) metadataAttributes.uploader_email = userEmail;

        const metadataKey = `${s3Key}.metadata.json`;
        const metadataBlob = new Blob([JSON.stringify({ metadataAttributes })], { type: 'application/json' });
        const metadataBuffer = await metadataBlob.arrayBuffer();
        await uploadFileToS3(metadataBuffer, 'application/json', bucketName, metadataKey, region, getCredentials);
      }

      setKbSuccessMessage(
        t('resultActions.kbUploadSuccess', {
          fileName,
          kbName: selectedKB.kb_name || t('resultActions.yourKnowledgeBase'),
        })
      );
      setKbModalStep('success');
    } catch (err: unknown) {
      console.error('Failed to upload to KB:', err);
      setKbSuccessMessage(
        t('resultActions.kbUploadFailed', { error: err instanceof Error ? err.message : String(err) })
      );
      setKbModalStep('success');
    }
  };

  // Share handlers (Email, Copy, Print)
  const getShareableText = async (): Promise<string> => {
    if (content) return convertMarkdownToPlainText(content);
    if (preview.type === 'file' && preview.fullPath) {
      const workspaceBucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
      const region = window.sessionStorage.getItem('REGION') || 'us-east-1';
      if (!workspaceBucket) return '';
      const blob = await fetchFileFromS3(preview.fullPath, workspaceBucket, region, getCredentials);
      return blob.text();
    }
    return '';
  };

  const shareTitle = preview.type === 'file' ? preview.filename : '';

  const handleEmailShare = async () => {
    const MAX_BODY_LENGTH = 8000;
    const plainText = await getShareableText();
    if (plainText.length > MAX_BODY_LENGTH) {
      setShowTruncationWarning(true);
      return;
    }
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(plainText)}`;
    window.open(mailtoUrl, '_blank', 'noopener,noreferrer');
  };

  const handleTruncatedEmailContinue = async () => {
    const MAX_BODY_LENGTH = 8000;
    const plainText = await getShareableText();
    try {
      await navigator.clipboard.writeText(plainText);
    } catch (err) {
      console.error('Failed to copy full content to clipboard:', err);
    }
    const truncated = plainText.substring(0, MAX_BODY_LENGTH) + t('resultActions.emailTruncated.bodyNotice');
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(truncated)}`;
    window.open(mailtoUrl, '_blank', 'noopener,noreferrer');
    setShowTruncationWarning(false);
  };

  const handleCopyToClipboard = async () => {
    try {
      const plainText = await getShareableText();
      await navigator.clipboard.writeText(plainText);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handlePrint = async () => {
    const plainText = await getShareableText();
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>${shareTitle}</title>
          <style>
            @media print { @page { margin: 15mm; } }
            body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; white-space: pre-wrap; }
          </style>
        </head>
        <body>${plainText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  // Folder - Download as ZIP
  if (preview.type === 'folder') {
    return (
      <div className="file-preview-actions p-3 border-top d-flex gap-2">
        {onClose && (
          <Button variant="outline-secondary" onClick={onClose}>
            <i className="bi bi-x-lg me-2"></i>
            {t('common.close')}
          </Button>
        )}
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

  // All files - unified action bar
  return (
    <>
      <div className="file-preview-actions p-3 border-top d-flex gap-2 flex-wrap">
        {onClose && (
          <Button variant="outline-secondary" onClick={onClose} style={{ flex: '1 0 auto' }}>
            <i className="bi bi-x-lg me-1"></i>
            {t('common.close')}
          </Button>
        )}
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

        {/* Markdown files get a format dropdown; other files get a plain download button */}
        {isMarkdown && content ? (
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
        ) : (
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
        )}

        <Dropdown>
          <Dropdown.Toggle variant="btn btn-secondary" disabled={writableKBs.length === 0 || isLoadingKBs}>
            <i className="bi bi-database me-2"></i>
            {t('resultActions.addToKnowledgeBase')}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {writableKBs.map((kb) => (
              <Dropdown.Item key={kb.kb_id} onClick={() => handleSelectKBAndShowModal(kb)}>
                {kb.kb_name}
                {kb.kb_id === 'company' && (
                  <Badge bg="secondary" className="ms-2">
                    {t('resultActions.badges.default')}
                  </Badge>
                )}
                {kb.role && kb.kb_id !== 'company' && (
                  <Badge bg="info" className="ms-2">
                    {t('resultActions.badges.role', { role: kb.role })}
                  </Badge>
                )}
              </Dropdown.Item>
            ))}
            {writableKBs.length === 0 && !isLoadingKBs && (
              <Dropdown.Item disabled>{t('resultActions.noKnowledgeBases')}</Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown>

        <Dropdown>
          <Dropdown.Toggle variant="btn btn-primary" id="share-dropdown">
            <i className="bi bi-share me-2"></i>
            {t('resultActions.share')}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={handleEmailShare}>
              <i className="bi bi-envelope me-2"></i>
              {t('resultActions.shareOptions.email')}
            </Dropdown.Item>
            <Dropdown.Item onClick={handleCopyToClipboard}>
              <i className="bi bi-clipboard me-2"></i>
              {t('resultActions.shareOptions.copy')}
            </Dropdown.Item>
            <Dropdown.Item onClick={handlePrint}>
              <i className="bi bi-printer me-2"></i>
              {t('resultActions.shareOptions.print')}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>

      {/* Email truncation warning */}
      <Modal show={showTruncationWarning} onHide={() => setShowTruncationWarning(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('resultActions.emailTruncated.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{t('resultActions.emailTruncated.message')}</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowTruncationWarning(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleTruncatedEmailContinue}>
            {t('resultActions.emailTruncated.continue')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Add to Knowledge Base Modal */}
      <Modal show={showKbModal} onHide={() => setShowKbModal(false)} backdrop="static" centered>
        {kbModalStep === 'confirm' && (
          <>
            <Modal.Header closeButton>
              <Modal.Title>
                {t('resultActions.modal.addTitle', { kbName: selectedKB?.kb_name || t('resultActions.knowledgeBase') })}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <p>
                {t('resultActions.modal.addDescriptionPrefix')}
                <strong>{selectedKB?.kb_name || t('resultActions.yourKnowledgeBase')}</strong>
                {t('resultActions.modal.addDescriptionSuffix')}
              </p>
              <p>{t('resultActions.modal.confirmEdit')}</p>
              <Form.Group className="mb-3">
                <Form.Label>{t('resultActions.modal.documentTitle')}</Form.Label>
                <Form.Control type="text" value={kbDocName} onChange={(e) => setKbDocName(e.target.value)} />
              </Form.Group>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={() => setShowKbModal(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={handleKbUpload}>
                {t('resultActions.modal.addButton', {
                  kbName: selectedKB?.kb_name || t('resultActions.knowledgeBase'),
                })}
              </Button>
            </Modal.Footer>
          </>
        )}

        {kbModalStep === 'uploading' && (
          <>
            <Modal.Header>
              <Modal.Title>{t('resultActions.modal.processing')}</Modal.Title>
            </Modal.Header>
            <Modal.Body className="text-center">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">{t('resultActions.modal.uploading')}</span>
              </Spinner>
              <p style={{ marginTop: '1rem' }}>
                {t('resultActions.modal.uploadingTo', {
                  kbName: selectedKB?.kb_name || t('resultActions.yourKnowledgeBase'),
                })}
              </p>
            </Modal.Body>
          </>
        )}

        {kbModalStep === 'success' && (
          <>
            <Modal.Header>
              <Modal.Title>{t('resultActions.modal.success')}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <p>{kbSuccessMessage}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="primary" onClick={() => setShowKbModal(false)}>
                {t('common.close')}
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </>
  );
};
