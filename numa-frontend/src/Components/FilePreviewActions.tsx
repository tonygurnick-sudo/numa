import React, { useState } from 'react';
import { Button, Dropdown, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { createDocxBlob } from '../Services/fileConverter';
import { downloadPdf, downloadDocx } from '../Services/documentConverterService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
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
  const { t } = useTranslation('chat');
  const { numaPost } = useNumaRequest();
  const [isConverting, setIsConverting] = useState(false);

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
          {t('filePreview.actions.downloadZip')}
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
                {t('filePreview.actions.converting')}
              </>
            ) : (
              <>
                <i className="bi bi-download me-2"></i>
                {t('filePreview.actions.download')}
              </>
            )}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={handleDownloadPdf}>
              <i className="bi bi-file-pdf me-2"></i>
              {t('filePreview.actions.pdf')}
            </Dropdown.Item>
            <Dropdown.Item onClick={handleDownloadDocx}>
              <i className="bi bi-file-earmark-word me-2"></i>
              {t('filePreview.actions.docx')}
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item onClick={onDownloadFile}>
              <i className="bi bi-file-text me-2"></i>
              {t('filePreview.actions.rawMarkdown')}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>
    );
  }

  // Other files - Direct download
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
      {onOpenInNewTab && (
        <Button variant="outline-secondary" onClick={onOpenInNewTab}>
          <i className="bi bi-box-arrow-up-right me-2"></i>
          {t('filePreview.actions.openInNewTab')}
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
        {t('filePreview.actions.download')}
      </Button>
    </div>
  );
};
