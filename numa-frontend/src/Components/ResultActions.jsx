import { useState } from 'react';
import { Dropdown, Button, Modal, Form, Spinner } from 'react-bootstrap';
import { saveAs } from 'file-saver';
import html2pdf from 'html2pdf.js';
import ReactDOMServer from 'react-dom/server';
import { MarkdownContent } from './MarkdownContent';
import { useAuth } from '../Providers/AuthProvider';
import { uploadFileToS3 } from '../utils/s3Utils';
import { createDocxBlob } from '../Services/fileConverter';
import { FeatureWrapper } from './RequiredFeaturesWrapper';

// Helper function to convert markdown to formatted plain text
const convertMarkdownToPlainText = (markdown) => {
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

const ResultActions = ({ content, title = 'Result' }) => {
  const { getCredentials } = useAuth();

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState('confirm');
  const [docName, setDocName] = useState(title);
  const [successMessage, setSuccessMessage] = useState('');

  // ─────────────────────────────────────────────────────────────
  // PDF Creation
  const createStyledPdfBlob = async (markdownString, title) => {
    const markdownHtml = ReactDOMServer.renderToString(<MarkdownContent content={markdownString} />);

    const element = document.createElement('div');

    element.innerHTML = `
      <html>
        <head>
          <style>
            @page {
              margin: 25mm;
              size: A4;
            }
            body {
              font-family: 'Helvetica', 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              font-size: 10.5pt;
              margin: 0;
              padding: 0;
              background-color: white;
            }
            .container {
              max-width: 100%;
              width: 100%;
              padding: 12px;
              box-sizing: border-box;
              background-color: white;
            }
            .header {
              border-bottom: 2px solid #8e50a7;
              margin-bottom: 20px;
              padding-bottom: 10px;
              width: 95%;
              margin-left: auto;
              margin-right: auto;
            }
            h1 {
              color: #8e50a7;
              margin: 0 0 10px 0;
              padding: 0;
              font-size: 24pt;
              page-break-after: avoid;
            }
            h2, h3, h4, h5, h6 {
              margin-top: 20px;
              margin-bottom: 10px;
              page-break-after: avoid;
            }
            p {
              margin: 0 0 12px 0;
              max-width: 95%;
              width: 95%;
              margin-left: auto;
              margin-right: auto;
              word-wrap: break-word;
            }
            table {
              width: 95%;
              max-width: 95%;
              table-layout: fixed;
              border-collapse: collapse;
              margin: 16px auto;
              page-break-inside: avoid;
              font-size: 9.5pt;
            }
            th, td {
              border: 1px solid #ddd;
              padding: 5px;
              text-align: left;
              word-wrap: break-word;
              overflow-wrap: break-word;
              vertical-align: top;
              overflow: hidden;
            }
            th {
              background-color: #f5f5f5;
              font-weight: bold;
            }
            pre, code {
              background-color: #f8f8f8;
              border-radius: 3px;
              border: 1px solid #eaeaea;
              font-family: 'Courier New', Courier, monospace;
              font-size: 9pt;
              padding: 10px;
              white-space: pre-wrap;
              word-wrap: break-word;
              overflow-x: hidden;
              max-width: 95%;
              width: 95%;
              margin: 16px auto;
              display: block;
              page-break-inside: avoid;
            }
            ul, ol {
              margin-bottom: 12px;
              padding-left: 20px;
            }
            li {
              margin-bottom: 6px;
            }
            .footer {
              margin-top: 30px;
              padding-top: 10px;
              border-top: 1px solid #eee;
              font-size: 9pt;
              color: #666;
              text-align: center;
              width: 95%;
              margin-left: auto;
              margin-right: auto;
            }
            img {
              max-width: 100%;
              height: auto;
            }
            a {
              color: #0366d6;
              text-decoration: none;
            }
            blockquote {
              margin: 16px 0;
              padding: 0 16px;
              color: #6a737d;
              border-left: 4px solid #dfe2e5;
            }
            .content {
              min-height: 500px;
              width: 95%;
              margin: 0 auto;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${title}</h1>
            </div>
            <div class="content">
              ${markdownHtml}
            </div>
            <div class="footer">
              Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
            </div>
          </div>
        </body>
      </html>
    `;

    // PDF generation settings
    const opt = {
      margin: [0, 0],
      filename: `${title}.pdf`,
      image: {
        type: 'jpeg',
        quality: 0.98,
      },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        letterRendering: true,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
        compress: true,
        hotfixes: ['px_scaling'],
      },
      pagebreak: {
        mode: 'css',
        avoid: ['table', 'img', 'pre', 'h1, h2, h3, h4, h5, h6'],
      },
    };

    const worker = html2pdf().set(opt).from(element);
    const pdfBlob = await worker.outputPdf('blob');
    return pdfBlob;
  };

  // ─────────────────────────────────────────────────────────────
  // DOWNLOAD Handlers (PDF, CSV, JSON, DOCX)
  const handleDownloadPDF = async () => {
    try {
      const pdfBlob = await createStyledPdfBlob(content, title);
      saveAs(pdfBlob, `${title}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  };

  const handleDownloadCSV = () => {
    const plainText = content.replace(/<[^>]+>/g, '');
    const csv = plainText
      .split('\n')
      .map((line) => line.trim())
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, `${title}.csv`);
  };

  const handleDownloadJSON = () => {
    const data = {
      title,
      content: content.replace(/<[^>]+>/g, ''),
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    saveAs(blob, `${title}.json`);
  };

  const handleDownloadDocx = async () => {
    try {
      const docxBlob = await createDocxBlob(content, title);
      saveAs(docxBlob, `${title}.docx`);
    } catch (err) {
      console.error('Error generating DOCX:', err);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // SINGLE Button -> Upload as TEXT file to Knowledge Base
  const handleShowModal = () => {
    setDocName(title);
    setModalStep('confirm');
    setShowModal(true);
  };

  const doUploadToS3 = async () => {
    try {
      setModalStep('uploading');
      const plainText = content.replace(/<[^>]+>/g, '');
      const blob = new Blob([plainText], { type: 'text/plain' });
      const contentType = 'text/plain';
      const extension = 'txt';

      const bucketName = window.sessionStorage.getItem('DATA_BUCKET');
      const fileName = `${docName}-${new Date()
        .toLocaleDateString()
        .replace(/\//g, '-')}-${new Date().toLocaleTimeString()}.${extension}`;
      const region = window.sessionStorage.getItem('REGION');

      const arrayBuffer = await blob.arrayBuffer();

      await uploadFileToS3(arrayBuffer, contentType, bucketName, fileName, region, getCredentials);

      setSuccessMessage(
        `Text file "${fileName}" has been added and will be searchable in your Company Knowledge after the next scheduled sync.`,
      );
      setModalStep('success');
    } catch (err) {
      console.error('Failed to upload file:', err);
      setSuccessMessage(`Failed to upload: ${err.message}`);
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
    const emailSubject = encodeURIComponent(title);
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
          <title>${title}</title>
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
              border-bottom: 2px solid #8e50a7;
              margin-bottom: 20px;
            }
            h1 {
              color: #8e50a7;
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
            <h1>${title}</h1>
          </div>
          <div class="content">
            ${markdownHtml}
          </div>
          <div class="footer">
            Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
          </div>
          <div class="no-print" style="position: fixed; top: 20px; right: 20px;">
            <button onclick="window.print()" style="
              padding: 8px 16px;
              background: #8e50a7;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">Print</button>
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
        <Dropdown.Toggle variant="btn btn-primary" id="download-dropdown">
          <i className="bi bi-download me-2"></i>
          Download
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Item onClick={handleDownloadPDF}>
            <i className="bi bi-file-pdf me-2"></i>
            PDF
          </Dropdown.Item>
          <Dropdown.Item onClick={handleDownloadCSV}>
            <i className="bi bi-file-spreadsheet me-2"></i>
            CSV
          </Dropdown.Item>
          <Dropdown.Item onClick={handleDownloadJSON}>
            <i className="bi bi-file-code me-2"></i>
            JSON
          </Dropdown.Item>
          <Dropdown.Item onClick={handleDownloadDocx}>
            <i className="bi bi-file-earmark-word me-2"></i>
            DOCX
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <Dropdown>
        <Dropdown.Toggle variant="btn btn-primary" id="share-dropdown">
          <i className="bi bi-share me-2"></i>
          Share
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Item onClick={handleEmailShare}>
            <i className="bi bi-envelope me-2"></i>
            Email
          </Dropdown.Item>
          <Dropdown.Item onClick={handleCopyToClipboard}>
            <i className="bi bi-clipboard me-2"></i>
            Copy to Clipboard
          </Dropdown.Item>
          <Dropdown.Item onClick={handlePrint}>
            <i className="bi bi-printer me-2"></i>
            Print
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <FeatureWrapper feature="addToCompanyData">
        <Button variant="btn btn-secondary" onClick={handleShowModal}>
          <i className="bi bi-database me-2"></i>
          Add to Company Knowledge
        </Button>
      </FeatureWrapper>

      <Modal show={showModal} onHide={handleModalCancel} backdrop="static" centered>
        {modalStep === 'confirm' && (
          <>
            <FeatureWrapper feature="addToCompanyData">
              <Modal.Header closeButton>
                <Modal.Title>Add to Company Knowledge</Modal.Title>
              </Modal.Header>
            </FeatureWrapper>
            <Modal.Body>
              <p>
                You are about to add this to your <strong>company knowledge</strong>. It will be searchable after the
                next scheduled sync.
              </p>
              <p>Please confirm and/or edit the title:</p>
              <Form.Group className="mb-3">
                <Form.Label>Document Title</Form.Label>
                <Form.Control type="text" value={docName} onChange={(e) => setDocName(e.target.value)} />
              </Form.Group>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={handleModalCancel}>
                Cancel
              </Button>
              <FeatureWrapper feature="addToCompanyData">
                <Button variant="primary" onClick={handleModalYes}>
                  Add to Company Knowledge
                </Button>
              </FeatureWrapper>
            </Modal.Footer>
          </>
        )}

        {modalStep === 'uploading' && (
          <>
            <Modal.Header>
              <Modal.Title>Processing...</Modal.Title>
            </Modal.Header>
            <Modal.Body className="text-center">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">Uploading...</span>
              </Spinner>
              <p style={{ marginTop: '1rem' }}>Uploading to your company knowledge, please wait...</p>
            </Modal.Body>
          </>
        )}

        {modalStep === 'success' && (
          <>
            <Modal.Header>
              <Modal.Title>Success</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <p>{successMessage}</p>
              <p>
                <a href="/upload" target="_blank" rel="noreferrer">
                  Go to File Upload Page
                </a>
              </p>
              <p className="text-muted" style={{ fontSize: '0.9rem' }}>
                * We add a timestamp to the filename to ensure uniqueness
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="primary" onClick={handleModalCancel}>
                Close
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </div>
  );
};

export { ResultActions };
