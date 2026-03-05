import { useState, useMemo } from 'react';
import { Dropdown, Button, Modal, Form, Spinner, Badge } from 'react-bootstrap';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import ReactDOMServer from 'react-dom/server';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { MarkdownContent } from './Renderers/MarkdownContent';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { UserKB } from '../Services/knowledgeBaseService';
import { uploadFileToS3 } from '../utils/s3Utils';
import { createDocxBlob } from '../Services/fileConverter';
import { downloadDocx, downloadPdf } from '../Services/documentConverterService';
import { getExportOptionsForApp } from '../config/exportConfig';

// Helper function to convert markdown to formatted plain text
const convertMarkdownToPlainText = (markdown: string): string => {
  // New Line for <br> tags
  let plainText = markdown.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining HTML tags
  plainText = plainText.replace(/<[^>]+>/g, '');

  // Lists
  plainText = plainText.replace(/^\s*[-*+]\s+(.+)$/gm, '• $1');
  plainText = plainText.replace(/^\s*(\d+)\.?\s+(.+)$/gm, '$1. $2');

  // Add newline after the end of a list
  plainText = plainText.replace(/^((?:•|\d+\.)[^\n]+)$(?!\n^(?:•|\d+\.))/gm, '$1\n');

  // Give 4 spaces at the beginning of each line of a dotted list
  plainText = plainText.replace(/^(\s*•\s+.*)$/gm, '    $1');

  // Headers
  plainText = plainText.replace(/^#{1,6}\s+(.+)$/gm, '$1\n');

  // Remove text styles
  plainText = plainText.replace(/\*\*(.+?)\*\*/g, '$1'); // Bold
  plainText = plainText.replace(/\*(.+?)\*/g, '$1'); // Italic
  plainText = plainText.replace(/__(.+?)__/g, '$1'); // Bold (alt)
  plainText = plainText.replace(/_(.+?)_/g, '$1'); // Italic (alt)
  plainText = plainText.replace(/~~(.+?)~~/g, '$1'); // Strikethrough
  plainText = plainText.replace(/`(.+?)`/g, '$1'); // Inline code

  // Preserve code blocks indentation
  plainText = plainText.replace(/```(?:\w+)?\n([\s\S]*?)\n```/g, '\n$1\n');

  // Make sure paragraphs are separated
  plainText = plainText.replace(/\n{3,}/g, '\n\n');

  return plainText.trim();
};

interface ResultActionsProps {
  content: string;
  title?: string;
  appType?: string | null;
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

const ResultActions: React.FC<ResultActionsProps> = ({ content, title, appType = null }) => {
  const { t } = useTranslation('common');
  const resolvedTitle = title || t('resultActions.defaultTitle');
  const { getCredentials, user } = useAuth();
  const { numaPost } = useNumaRequest();
  const { availableKBs, isLoadingKBs } = useKnowledgeBase();

  const exportOptions = getExportOptionsForApp(appType);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState('confirm');
  const [docName, setDocName] = useState(resolvedTitle);
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedKB, setSelectedKB] = useState<UserKB | null>(null);

  // Download loading state
  const [isDownloading, setIsDownloading] = useState(false);

  // Check if user has feature flag for company KB
  const hasCompanyDataFeature = Boolean(user?.features?.includes('addToCompanyData'));

  // Filter KBs to only show writable ones
  const writableKBs = useMemo(() => {
    return availableKBs.filter((kb) => {
      // Company KB: show if user has feature flag (regardless of role)
      if (kb.kb_id === 'company') {
        return hasCompanyDataFeature;
      }
      // User KBs: must be OWNER or EDITOR
      return kb.role === 'OWNER' || kb.role === 'EDITOR';
    });
  }, [availableKBs, hasCompanyDataFeature]);

  // ─────────────────────────────────────────────────────────────
  // PDF Creation Constants
  const PDF_CONSTANTS = {
    FONT_FAMILY: 'helvetica' as const,
    LINE_HEIGHT: 4.5,
    PARAGRAPH_SPACING: 8,
    HEADER_FONT_SIZES: [16, 14, 13, 12, 11, 10] as const,
    COLORS: {
      BLACK: [0, 0, 0] as const,
      DARK_GRAY: [20, 20, 20] as const,
      MEDIUM_GRAY: [51, 51, 51] as const,
      LIGHT_GRAY: [100, 100, 100] as const,
      BORDER_GRAY: [128, 128, 128] as const,
      TABLE_HEADER_BG: [240, 240, 240] as const,
      TABLE_BORDER: [180, 180, 180] as const,
    },
  } as const;

  const createStyledPdfBlob = async (markdownString: string, title: string): Promise<Blob> => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let currentY = margin;
    const checkPageBreak = (nextHeight: number): boolean => {
      if (currentY + nextHeight > pageHeight - margin) {
        pdf.addPage();
        currentY = margin;
        return true;
      }
      return false;
    };

    const { FONT_FAMILY, LINE_HEIGHT, PARAGRAPH_SPACING, HEADER_FONT_SIZES, COLORS } = PDF_CONSTANTS;

    // Helper function to split text into words while preserving whitespace
    const splitTextIntoWords = (text: string): Array<{ text: string; bold: boolean; isSpace: boolean }> => {
      const words = text.split(/(\s+)/);
      return words
        .filter((word) => word.length > 0)
        .map((word) => ({
          text: word,
          bold: false,
          isSpace: /^\s+$/.test(word),
        }));
    };

    // Helper function to parse markdown sections
    const parseMarkdownSections = (text: string): Array<{ type: string; content: string; level: number }> => {
      let content = text.replace(/<[^>]*>/g, '');
      const sections: Array<{ type: string; content: string; level: number }> = [];
      const lines = content.split('\n').filter((line) => line.trim());

      let currentSection = { type: 'text', content: '', level: 0 };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
        if (headerMatch) {
          if (currentSection.content) {
            sections.push(currentSection);
          }
          currentSection = {
            type: 'header',
            content: headerMatch[2],
            level: headerMatch[1].length,
          };
          sections.push(currentSection);
          currentSection = { type: 'text', content: '', level: 0 };
          continue;
        }

        if (trimmed.includes('|') && trimmed.split('|').length > 2) {
          if (currentSection.type !== 'table') {
            if (currentSection.content) {
              sections.push(currentSection);
            }
            currentSection = { type: 'table', content: '', level: 0 };
          }
          currentSection.content += trimmed + '\n';
          continue;
        }

        if (trimmed.match(/^[-*+]\s+/) || trimmed.match(/^\d+\.\s+/)) {
          if (currentSection.type !== 'list') {
            if (currentSection.content) {
              sections.push(currentSection);
            }
            currentSection = { type: 'list', content: '', level: 0 };
          }
          currentSection.content += trimmed + '\n';
          continue;
        }

        if (currentSection.type === 'list' || currentSection.type === 'table') {
          sections.push(currentSection);
          currentSection = { type: 'text', content: '', level: 0 };
        }
        currentSection.content += trimmed + ' ';
      }

      if (currentSection.content) {
        sections.push(currentSection);
      }

      return sections;
    };

    // Helper function to render text with bold formatting
    const renderTextWithBold = (text: string, x: number, y: number, maxWidth: number): number => {
      // Check if text contains bold formatting
      const hasBoldFormatting = /\*\*(.*?)\*\*/g.test(text);

      if (!hasBoldFormatting) {
        // No bold formatting, use regular text rendering
        pdf.setFont(FONT_FAMILY, 'normal');
        const lines = pdf.splitTextToSize(text, maxWidth);
        lines.forEach((line: string, index: number) => {
          pdf.text(line, x, y + index * LINE_HEIGHT);
        });
        return lines.length;
      }

      // Parse bold patterns and create word-level parts
      const parts: Array<{ text: string; bold: boolean; isSpace: boolean }> = [];
      const boldPattern = /\*\*(.*?)\*\*/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = boldPattern.exec(text)) !== null) {
        // Add normal text before bold
        if (match.index > lastIndex) {
          const normalText = text.substring(lastIndex, match.index);
          parts.push(...splitTextIntoWords(normalText));
        }

        // Add bold text
        const boldText = match[1];
        const boldWords = splitTextIntoWords(boldText);
        parts.push(...boldWords.map((word) => ({ ...word, bold: true })));

        lastIndex = match.index + match[0].length;
      }

      // Add remaining normal text
      if (lastIndex < text.length) {
        const remainingText = text.substring(lastIndex);
        parts.push(...splitTextIntoWords(remainingText));
      }

      // Render with proper word wrapping
      let currentX = x;
      let currentY = y;
      let lineCount = 1;

      for (const part of parts) {
        if (!part.text) continue;

        pdf.setFont(FONT_FAMILY, part.bold ? 'bold' : 'normal');
        const partWidth = pdf.getTextWidth(part.text);

        // Check if we need to wrap to next line
        if (!part.isSpace && currentX + partWidth > x + maxWidth && currentX > x) {
          // Move to next line, maintaining the same X position as the first line
          currentY += LINE_HEIGHT;
          currentX = x;
          lineCount++;
        }

        // Don't render leading spaces at start of new line
        if (!(part.isSpace && currentX === x)) {
          pdf.text(part.text, currentX, currentY);
          currentX += partWidth;
        }
      }

      return lineCount;
    };

    pdf.setFont(FONT_FAMILY);
    pdf.setFontSize(18);
    pdf.setTextColor(...COLORS.BLACK);
    pdf.setFont(FONT_FAMILY, 'bold');

    const titleLines = pdf.splitTextToSize(title, maxWidth);
    titleLines.forEach((line: string, index: number) => {
      pdf.text(line, margin, currentY + index * 7);
    });

    currentY += titleLines.length * 7 + 8;

    pdf.setDrawColor(...COLORS.BORDER_GRAY);
    pdf.setLineWidth(0.3);
    pdf.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 12;

    // Process content sections
    const sections = parseMarkdownSections(markdownString);

    sections.forEach((section: { type: string; content: string; level: number }) => {
      pdf.setTextColor(...COLORS.MEDIUM_GRAY); // Dark gray text

      if (section.type === 'header') {
        // Add minimal spacing before headers (except first one)
        if (currentY > margin + 20) {
          currentY += 3;
        }

        checkPageBreak(20);

        // Professional header hierarchy with Helvetica
        const fontSize = HEADER_FONT_SIZES[Math.min(section.level - 1, 5)];
        const lineHeight = fontSize * 0.5;

        pdf.setFontSize(fontSize);
        pdf.setFont(FONT_FAMILY, section.level <= 2 ? 'bold' : 'normal');
        pdf.setTextColor(...COLORS.BLACK);

        const headerLines = pdf.splitTextToSize(section.content, maxWidth);
        headerLines.forEach((line: string, index: number) => {
          pdf.text(line, margin, currentY + index * lineHeight);
        });

        currentY += headerLines.length * lineHeight + (section.level <= 2 ? 4 : 3);
      } else if (section.type === 'list') {
        checkPageBreak(20);

        pdf.setFontSize(11);
        pdf.setFont(FONT_FAMILY, 'normal');
        pdf.setTextColor(...COLORS.DARK_GRAY); // Very dark gray for body text

        const listItems = section.content.split('\n').filter((item) => item.trim());

        listItems.forEach((item: string) => {
          const cleanItem = item.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '');

          checkPageBreak(20); // Conservative estimate for page break

          // Render bullet point with proper alignment
          pdf.setFont(FONT_FAMILY, 'normal');
          pdf.text('•', margin, currentY);

          // Calculate indent for text after bullet
          const bulletWidth = pdf.getTextWidth('• ');
          const textIndent = margin + bulletWidth;

          // Use the bold formatting function for list item text with proper indentation
          const linesRendered = renderTextWithBold(cleanItem.trim(), textIndent, currentY, maxWidth - bulletWidth);
          currentY += linesRendered * LINE_HEIGHT + 1.5;
        });

        currentY += 4;
      } else if (section.type === 'table') {
        checkPageBreak(30);

        // Parse table content
        const tableRows = section.content
          .split('\n')
          .filter((row) => row.trim() && !row.match(/^[\s\-|]+$/)) // Remove separator rows
          .map((row) =>
            row
              .split('|')
              .map((cell) => cell.trim())
              .filter((cell) => cell)
          );

        if (tableRows.length > 0) {
          const colCount = Math.max(...tableRows.map((row) => row.length));
          const colWidth = (maxWidth - 10) / colCount;

          pdf.setFontSize(10);
          pdf.setFont(FONT_FAMILY, 'normal');
          pdf.setTextColor(...COLORS.DARK_GRAY);

          tableRows.forEach((row: string[], rowIndex: number) => {
            const isHeader = rowIndex === 0;

            // Calculate the actual row height needed based on cell content
            let maxLines = 1;
            const cellTextArrays = row.map((cell) => pdf.splitTextToSize(cell, colWidth - 4));
            cellTextArrays.forEach((cellLines: string[]) => {
              maxLines = Math.max(maxLines, cellLines.length);
            });

            const lineHeight = 4.5;
            const rowHeight = maxLines * lineHeight + 2; // Padding for multi-line content

            checkPageBreak(rowHeight + 2);

            if (isHeader) {
              pdf.setFont(FONT_FAMILY, 'bold');
              // Header background
              pdf.setFillColor(...COLORS.TABLE_HEADER_BG);
              pdf.rect(margin, currentY - 1, maxWidth - 10, rowHeight, 'F');
            } else {
              pdf.setFont(FONT_FAMILY, 'normal');
            }

            // Draw borders
            pdf.setDrawColor(...COLORS.TABLE_BORDER);
            pdf.setLineWidth(0.2);
            pdf.rect(margin, currentY - 1, maxWidth - 10, rowHeight);

            // Render all cell content with proper multi-line support
            cellTextArrays.forEach((cellLines: string[], colIndex: number) => {
              const x = margin + colIndex * colWidth + 2;

              // Render each line of the cell
              cellLines.forEach((line: string, lineIndex: number) => {
                const y = currentY + 3 + lineIndex * lineHeight;
                pdf.text(line, x, y);
              });

              // Vertical borders
              if (colIndex < row.length - 1) {
                pdf.line(
                  margin + (colIndex + 1) * colWidth,
                  currentY - 1,
                  margin + (colIndex + 1) * colWidth,
                  currentY + rowHeight - 1
                );
              }
            });

            currentY += rowHeight;
          });

          currentY += 6;
        }
      } else if (section.content.trim()) {
        // Regular paragraph text with professional formatting
        checkPageBreak(20);

        pdf.setFontSize(11);
        pdf.setFont(FONT_FAMILY, 'normal');
        pdf.setTextColor(...COLORS.DARK_GRAY); // Very dark gray for readability

        // Enhanced text processing for better paragraph formatting
        const cleanText = section.content
          .trim()
          .replace(/\s+/g, ' ') // Normalize whitespace
          .replace(/([.!?])\s+/g, '$1  '); // Double space after sentences

        checkPageBreak(20); // Conservative estimate for page break

        // Use the bold formatting function for paragraphs
        const linesRendered = renderTextWithBold(cleanText, margin, currentY, maxWidth);
        currentY += linesRendered * 5.5 + PARAGRAPH_SPACING; // Line height + paragraph spacing
      }
    });

    // Add footer with page numbers on all pages
    const totalPages = pdf.getNumberOfPages();
    const footerY = pageHeight - 12;

    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);

      // Footer styling
      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.LIGHT_GRAY);
      pdf.setFont(FONT_FAMILY, 'normal');

      // Left side: Generation date
      const dateText = t('resultActions.pdfFooter.generated', { date: new Date().toLocaleDateString(i18n.language) });
      pdf.text(dateText, margin, footerY);

      // Right side: Page numbers
      if (totalPages > 1) {
        const pageText = t('resultActions.pdfFooter.pageCount', { current: i, total: totalPages });
        const pageTextWidth = pdf.getTextWidth(pageText);
        pdf.text(pageText, pageWidth - margin - pageTextWidth, footerY);
      }

      // Center: Document title (truncated if too long)
      const centerText = title.length > 40 ? title.substring(0, 37) + '...' : title;
      const centerWidth = pdf.getTextWidth(centerText);
      const centerX = (pageWidth - centerWidth) / 2;
      pdf.text(centerText, centerX, footerY);
    }

    return pdf.output('blob');
  };

  // ─────────────────────────────────────────────────────────────
  // DOWNLOAD Handlers (PDF, CSV, JSON, DOCX)

  // Client-side fallback for PDF generation
  const createPdfClientSide = async (): Promise<void> => {
    const pdfBlob = await createStyledPdfBlob(content, resolvedTitle);
    saveAs(pdfBlob, `${resolvedTitle}.pdf`);
  };

  // Client-side fallback for DOCX generation
  const createDocxClientSide = async (): Promise<void> => {
    const docxBlob = await createDocxBlob(content, resolvedTitle);
    saveAs(docxBlob, `${resolvedTitle}.docx`);
  };

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      // Try server-side conversion first
      await downloadPdf(numaPost, content, resolvedTitle);
    } catch (serverError) {
      console.warn('Server-side PDF conversion failed, falling back to client-side:', serverError);
      try {
        await createPdfClientSide();
      } catch (clientError) {
        console.error('Error generating PDF:', clientError);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadCSV = () => {
    const plainText = convertMarkdownToPlainText(content);
    const blob = new Blob([plainText], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, `${resolvedTitle}.csv`);
  };

  const handleDownloadJSON = () => {
    const data = {
      title: resolvedTitle,
      content: convertMarkdownToPlainText(content),
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    saveAs(blob, `${resolvedTitle}.json`);
  };

  const handleDownloadDocx = async () => {
    setIsDownloading(true);
    try {
      // Try server-side conversion first
      await downloadDocx(numaPost, content, resolvedTitle);
    } catch (serverError) {
      console.warn('Server-side DOCX conversion failed, falling back to client-side:', serverError);
      try {
        await createDocxClientSide();
      } catch (clientError) {
        console.error('Error generating DOCX:', clientError);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // KB Selection -> Upload as TEXT file to Knowledge Base
  const handleSelectKBAndShowModal = (kb: UserKB) => {
    setSelectedKB(kb);
    setDocName(resolvedTitle);
    setModalStep('confirm');
    setShowModal(true);
  };

  const doUploadToS3 = async () => {
    try {
      setModalStep('uploading');
      const plainText = convertMarkdownToPlainText(content);
      const blob = new Blob([plainText], { type: 'text/plain' });
      const contentType = 'text/plain';
      const extension = 'txt';

      const bucketName = window.sessionStorage.getItem('DATA_BUCKET');
      const clientName = window.sessionStorage.getItem('CLIENT_NAME');
      const currentDate = new Date();
      const dateStr = currentDate.toLocaleDateString(i18n.language).replace(/\//g, '-');
      const timeStr = currentDate.toLocaleTimeString(i18n.language);
      const fileName = `${docName}-${dateStr}-${timeStr}.${extension}`;
      const region = window.sessionStorage.getItem('REGION');

      // Build S3 key with KB prefix
      const prefix = buildKbPrefix(selectedKB?.kb_id);
      const s3Key = `${prefix}${fileName}`;

      const arrayBuffer = await blob.arrayBuffer();

      // Upload the file
      await uploadFileToS3(arrayBuffer, contentType, bucketName, s3Key, region, getCredentials);

      // Upload metadata sidecar for Bedrock indexing
      // Skip for Q Business company KB (Q doesn't use sidecars)
      const resolvedKbId = selectedKB?.kb_id || 'company';
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
        if (userEmail) {
          metadataAttributes.uploader_email = userEmail;
        }
        const metadata = {
          metadataAttributes,
        };
        const metadataKey = `${s3Key}.metadata.json`;
        const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
        const metadataBuffer = await metadataBlob.arrayBuffer();
        await uploadFileToS3(metadataBuffer, 'application/json', bucketName, metadataKey, region, getCredentials);
      }

      setSuccessMessage(
        t('resultActions.kbUploadSuccess', {
          fileName,
          kbName: selectedKB?.kb_name || t('resultActions.yourKnowledgeBase'),
        })
      );
      setModalStep('success');
    } catch (err: unknown) {
      console.error('Failed to upload file:', err);
      setSuccessMessage(t('resultActions.kbUploadFailed', { error: err instanceof Error ? err.message : String(err) }));
      setModalStep('success');
    }
  };

  const handleModalYes = async () => {
    await doUploadToS3();
  };

  const handleModalCancel = () => {
    setShowModal(false);
  };

  // ─────────────────────────────────────────────────────────────
  // 5) SHARE Handlers (Email, Copy, Print)
  const handleEmailShare = () => {
    const plainText = convertMarkdownToPlainText(content);
    const emailSubject = encodeURIComponent(resolvedTitle);
    const emailBody = encodeURIComponent(plainText);
    const mailtoUrl = `mailto:?subject=${emailSubject}&body=${emailBody}`;
    window.open(mailtoUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyToClipboard = async () => {
    try {
      const plainText = convertMarkdownToPlainText(content);
      await navigator.clipboard.writeText(plainText);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    const markdownHtml = ReactDOMServer.renderToString(<MarkdownContent content={content} />);
    printWindow.document.write(`
      <html>
        <head>
          <title>${resolvedTitle}</title>
          <style>
            @media print {
              @page {
                margin: 15mm;
              }
            }
            body {
              font-family: Arial, sans-serif;
              color: #333;
              line-height: 1.6;
              max-width: 210mm;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              border-bottom: 2px solid var(--brand-primary, var(--color-primary));
              margin-bottom: 20px;
            }
            h1 {
              color: var(--brand-primary, var(--color-primary));
              margin: 0;
              padding: 10px 0;
            }
            pre, code {
              background-color: #f5f5f5;
              border-radius: 4px;
              padding: 8px;
              overflow-x: auto;
            }
            table {
              border-collapse: collapse;
              width: 100%;
              margin: 16px 0;
            }
            th, td {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: left;
            }
            th {
              background-color: #f5f5f5;
            }
            .footer {
              margin-top: 20px;
              padding-top: 10px;
              border-top: 1px solid #eee;
              font-size: 12px;
              color: #666;
            }
            @media print {
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${resolvedTitle}</h1>
          </div>
          <div class="content">
            ${markdownHtml}
          </div>
          <div class="footer">
            ${t('resultActions.print.generatedOn', {
              date: new Date().toLocaleDateString(i18n.language),
              time: new Date().toLocaleTimeString(i18n.language),
            })}
          </div>
          <div class="no-print" style="position: fixed; top: 20px; right: 20px;">
            <button onclick="window.print()" style="
              padding: 8px 16px;
              background: var(--brand-primary, var(--color-primary));
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">${t('resultActions.print.button')}</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  return (
    <div className="result-actions d-flex gap-2 mt-3">
      <Dropdown>
        <Dropdown.Toggle variant="btn btn-primary" id="download-dropdown" disabled={isDownloading}>
          {isDownloading ? (
            <>
              <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
              {t('resultActions.converting')}
            </>
          ) : (
            <>
              <i className="bi bi-download me-2"></i>
              {t('resultActions.download')}
            </>
          )}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          {exportOptions.pdf && (
            <Dropdown.Item onClick={handleDownloadPDF}>
              <i className="bi bi-file-pdf me-2"></i>
              {t('resultActions.formats.pdf')}
            </Dropdown.Item>
          )}
          {exportOptions.csv && (
            <Dropdown.Item onClick={handleDownloadCSV}>
              <i className="bi bi-file-spreadsheet me-2"></i>
              {t('resultActions.formats.csv')}
            </Dropdown.Item>
          )}
          {exportOptions.json && (
            <Dropdown.Item onClick={handleDownloadJSON}>
              <i className="bi bi-file-code me-2"></i>
              {t('resultActions.formats.json')}
            </Dropdown.Item>
          )}
          {exportOptions.docx && (
            <Dropdown.Item onClick={handleDownloadDocx}>
              <i className="bi bi-file-earmark-word me-2"></i>
              {t('resultActions.formats.docx')}
            </Dropdown.Item>
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

      <Dropdown>
        <Dropdown.Toggle
          variant="btn btn-secondary"
          id="kb-dropdown"
          disabled={writableKBs.length === 0 || isLoadingKBs}
        >
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

      <Modal show={showModal} onHide={handleModalCancel} backdrop="static" centered>
        {modalStep === 'confirm' && (
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
                <Form.Control type="text" value={docName} onChange={(e) => setDocName(e.target.value)} />
              </Form.Group>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={handleModalCancel}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={handleModalYes}>
                {t('resultActions.modal.addButton', {
                  kbName: selectedKB?.kb_name || t('resultActions.knowledgeBase'),
                })}
              </Button>
            </Modal.Footer>
          </>
        )}

        {modalStep === 'uploading' && (
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

        {modalStep === 'success' && (
          <>
            <Modal.Header>
              <Modal.Title>{t('resultActions.modal.success')}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <p>{successMessage}</p>
              <p>
                <a href="/upload" target="_blank" rel="noreferrer">
                  {t('resultActions.modal.goToUpload')}
                </a>
              </p>
              <p className="text-muted" style={{ fontSize: '0.9rem' }}>
                {t('resultActions.modal.timestampNote')}
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="primary" onClick={handleModalCancel}>
                {t('common.close')}
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </div>
  );
};

export { ResultActions };
