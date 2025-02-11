import React from 'react';
import { Button, Dropdown } from 'react-bootstrap';
import html2pdf from 'html2pdf.js';
import { saveAs } from 'file-saver';
import ReactDOMServer from 'react-dom/server';
import { MarkdownContent } from './MarkdownContent';

const ResultActions = ({ content, title = 'Result' }) => {
  const handleDownloadPDF = async () => {
    // Create a styled container for the PDF content
    const element = document.createElement('div');

    // Render the markdown content using our MarkdownContent component
    const markdownHtml = ReactDOMServer.renderToString(<MarkdownContent content={content} />);

    // Add the HTML content with proper styling
    element.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <div style="border-bottom: 2px solid #8e50a7; margin-bottom: 20px;">
          <h1 style="color: #8e50a7; margin: 0; padding: 10px 0;">${title}</h1>
        </div>
        <div style="line-height: 1.6;">
          ${markdownHtml}
        </div>
        <div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
          Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
        </div>
      </div>
    `;

    const opt = {
      margin: [15, 15],
      filename: `${title}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
      },
      pagebreak: { mode: 'avoid-all' },
    };

    try {
      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  };

  const handleDownloadCSV = () => {
    // Convert content to CSV format
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

  const handleEmailShare = () => {
    const plainText = content.replace(/<[^>]+>/g, '');
    const emailSubject = encodeURIComponent(title);
    const emailBody = encodeURIComponent(plainText);
    const mailtoUrl = `mailto:?subject=${emailSubject}&body=${emailBody}`;

    // Open in a new window
    window.open(mailtoUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyToClipboard = async () => {
    try {
      const plainText = content.replace(/<[^>]+>/g, '');
      await navigator.clipboard.writeText(plainText);
      // You might want to add a toast notification here
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');

    // Render the markdown content using our MarkdownContent component
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
              max-width: 210mm; /* A4 width */
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
            /* Hide footer when printing */
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
    </div>
  );
};

export { ResultActions };
