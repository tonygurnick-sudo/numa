import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Spinner, Button, Dropdown } from 'react-bootstrap';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { getFileIconClass } from '../../utils/fileUtils';
import { downloadFileFromS3 } from '../../utils/s3Utils';
import { MarkdownContent } from './MarkdownContent';
import { ResultActions } from '../ResultActions';
import { TraceViewer } from './ClaudeCodeTraceViewer';

interface DataAnalysisMarkdownProps {
  content: string;
  baseS3Key: string; // e.g., "data-analysis/{userId}/{jobId}/outputs/results.md"
  bucket: string;
  region: string;
}

interface FileReference {
  filename: string;
  fullPath: string;
  extension: string;
}

export const DataAnalysisMarkdown: React.FC<DataAnalysisMarkdownProps> = ({ content, baseS3Key, bucket, region }) => {
  const { getCredentials } = useAuth();
  const { fetchS3Content } = useNumaApp();
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  // Construct full S3 path for a referenced file
  const constructFilePath = (filename: string, baseKey: string): string => {
    const pathParts = baseKey.split('/');
    pathParts[pathParts.length - 1] = filename;
    return pathParts.join('/');
  };

  // Extract file references from markdown content
  const fileReferences = useMemo(() => {
    const refs: FileReference[] = [];
    // Match patterns like <filename.ext> or [text](filename.ext)
    const anglePattern = /<([^>]+\.\w+)>/g;
    const linkPattern = /\[([^\]]+)\]\(([^)]+\.\w+)\)/g;

    let match;
    while ((match = anglePattern.exec(content)) !== null) {
      const filename = match[1];
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      const fullPath = constructFilePath(filename, baseS3Key);
      refs.push({ filename, fullPath, extension });
    }

    while ((match = linkPattern.exec(content)) !== null) {
      const filename = match[2];
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      const fullPath = constructFilePath(filename, baseS3Key);
      refs.push({ filename, fullPath, extension });
    }

    // Remove duplicates
    return refs.filter((ref, index, self) => index === self.findIndex((r) => r.filename === ref.filename));
  }, [content, baseS3Key]);

  // Load file content for inline rendering
  const loadFileContent = async (filePath: string, filename: string) => {
    if (fileContents[filename] || loadingFiles[filename]) return;

    setLoadingFiles((prev) => ({ ...prev, [filename]: true }));
    setFileErrors((prev) => ({ ...prev, [filename]: '' }));

    try {
      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get credentials');
      }

      const content = await fetchS3Content(bucket, filePath, credentials);
      setFileContents((prev) => ({ ...prev, [filename]: content }));
    } catch (err) {
      console.error(`Error loading file ${filename}:`, err);
      setFileErrors((prev) => ({
        ...prev,
        [filename]: `Failed to load file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }));
    } finally {
      setLoadingFiles((prev) => ({ ...prev, [filename]: false }));
    }
  };

  // Auto-load HTML, CSV, and MD files for inline preview
  useEffect(() => {
    fileReferences.forEach((ref) => {
      if (['html', 'csv', 'md', 'markdown'].includes(ref.extension)) {
        loadFileContent(ref.fullPath, ref.filename);
      }
    });
  }, [fileReferences]);

  // Handle file download
  const handleDownload = async (filePath: string, filename: string) => {
    try {
      await downloadFileFromS3(filePath, bucket, region, getCredentials, filename);
    } catch (err) {
      console.error('Error downloading file:', err);
    }
  };

  // Handle opening HTML file in new tab
  const handleOpenInNewTab = async (filePath: string) => {
    try {
      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get credentials');
      }

      // Generate a signed URL and open in new tab
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

      const s3Client = new S3Client({
        region,
        credentials,
      });

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: filePath,
      });

      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      window.open(signedUrl, '_blank');
    } catch (err) {
      console.error('Error opening file in new tab:', err);
    }
  };

  // Handle markdown file downloads (using ResultActions logic)
  const handleMarkdownDownloadPDF = async (content: string, filename: string) => {
    // Import these dynamically to avoid loading them upfront
    const { jsPDF } = await import('jspdf');
    const { saveAs } = await import('file-saver');

    // Simple PDF generation (can enhance later)
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;

    pdf.setFontSize(16);
    pdf.text(filename, margin, margin);

    pdf.setFontSize(11);
    const lines = pdf.splitTextToSize(content, maxWidth);
    pdf.text(lines, margin, margin + 10);

    saveAs(pdf.output('blob'), `${filename}.pdf`);
  };

  const handleMarkdownDownloadDOCX = async (content: string, filename: string) => {
    const { saveAs } = await import('file-saver');
    const { createDocxBlob } = await import('../../Services/fileConverter');

    const docxBlob = await createDocxBlob(content, filename);
    saveAs(docxBlob, `${filename}.docx`);
  };

  // Render file reference bubble and inline content
  const renderFileReference = (ref: FileReference) => {
    const iconClass = getFileIconClass(ref.filename);
    const isLoading = loadingFiles[ref.filename];
    const error = fileErrors[ref.filename];
    const fileContent = fileContents[ref.filename];
    const isExpanded = expandedFiles[ref.filename] ?? false;
    const isMarkdown = ref.extension === 'md' || ref.extension === 'markdown';

    const toggleExpanded = () => {
      setExpandedFiles((prev) => ({ ...prev, [ref.filename]: !prev[ref.filename] }));
    };

    return (
      <div
        key={ref.filename}
        className="file-reference-container mb-4 bg-white border rounded overflow-hidden"
        style={{
          borderLeft: '4px solid var(--color-primary)',
          boxShadow: '0 1px 3px rgba(142, 80, 167, 0.1)',
        }}
      >
        {/* File header bubble */}
        <div className="file-reference-header d-flex align-items-center justify-content-between p-3 bg-light border-bottom">
          <div className="d-flex align-items-center">
            <i className={`${iconClass} me-3`} style={{ fontSize: '1.5rem', color: 'var(--color-primary)' }}></i>
            <span className="fw-semibold" style={{ fontSize: '1.05rem' }}>
              {ref.filename}
            </span>
          </div>
          <div className="d-flex gap-2">
            {isMarkdown && fileContent ? (
              <Dropdown>
                <Dropdown.Toggle
                  size="sm"
                  id={`download-${ref.filename}`}
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    borderColor: 'var(--color-primary)',
                    color: 'white',
                  }}
                >
                  <i className="bi bi-download me-1"></i>
                  Download
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item
                    onClick={() => handleMarkdownDownloadPDF(fileContent, ref.filename.replace(/\.(md|markdown)$/, ''))}
                  >
                    <i className="bi bi-file-pdf me-2"></i>
                    PDF
                  </Dropdown.Item>
                  <Dropdown.Item
                    onClick={() =>
                      handleMarkdownDownloadDOCX(fileContent, ref.filename.replace(/\.(md|markdown)$/, ''))
                    }
                  >
                    <i className="bi bi-file-earmark-word me-2"></i>
                    DOCX
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            ) : (
              <Button
                size="sm"
                onClick={() => handleDownload(ref.fullPath, ref.filename)}
                style={{
                  backgroundColor: 'var(--color-primary)',
                  borderColor: 'var(--color-primary)',
                  color: 'white',
                }}
              >
                <i className="bi bi-download me-1"></i>
                Download
              </Button>
            )}
          </div>
        </div>

        {/* Content preview area */}
        <div className="file-preview-content">
          {isLoading && (
            <div className="text-center py-4">
              <Spinner animation="border" size="sm" />
              <span className="ms-2">Loading preview...</span>
            </div>
          )}

          {error && (
            <div className="p-3">
              <div className="alert alert-warning mb-0">{error}</div>
            </div>
          )}

          {!isLoading && !error && fileContent && (
            <>
              {isMarkdown && (
                <div className="markdown-file-preview">
                  <div
                    className="markdown-preview-content p-3"
                    style={{
                      maxHeight: isExpanded ? 'none' : '300px',
                      overflow: 'hidden',
                      transition: 'max-height 0.3s ease',
                      position: 'relative',
                    }}
                  >
                    <MarkdownContent content={fileContent} />
                    {!isExpanded && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: '60px',
                          background: 'linear-gradient(to bottom, transparent, white)',
                        }}
                      />
                    )}
                  </div>
                  <div className="text-center border-top" style={{ borderTopWidth: '1px' }}>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={toggleExpanded}
                      className="text-decoration-none py-2"
                      style={{ color: 'var(--color-primary)', fontWeight: 500 }}
                    >
                      {isExpanded ? (
                        <>
                          <i className="bi bi-chevron-up me-1"></i>
                          Show Less
                        </>
                      ) : (
                        <>
                          <i className="bi bi-chevron-down me-1"></i>
                          Show More
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {ref.extension === 'html' && (
                <div className="html-preview-container">
                  <iframe
                    srcDoc={fileContent}
                    title={ref.filename}
                    sandbox="allow-same-origin allow-scripts"
                    style={{ width: '100%', height: '500px', border: 'none' }}
                  />
                  <div className="text-center border-top py-2">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => handleOpenInNewTab(ref.fullPath)}
                      className="text-decoration-none"
                      style={{ color: 'var(--color-primary)', fontWeight: 500 }}
                    >
                      <i className="bi bi-arrows-fullscreen me-1"></i>
                      Open in Full Screen
                    </Button>
                  </div>
                </div>
              )}

              {ref.extension === 'csv' && (
                <div className="csv-preview-container p-3">
                  <CsvPreviewTable csvContent={fileContent} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // Split content into sections with file references
  const contentSections = useMemo(() => {
    const sections: Array<{ type: 'markdown' | 'file'; content: string; fileRef?: FileReference }> = [];
    let remainingContent = content;

    // Sort file references by their position in the content
    const sortedRefs = [...fileReferences].sort((a, b) => {
      const aPos = content.indexOf(`<${a.filename}>`);
      const bPos = content.indexOf(`<${b.filename}>`);
      return aPos - bPos;
    });

    sortedRefs.forEach((ref) => {
      const pattern = `<${ref.filename}>`;
      const index = remainingContent.indexOf(pattern);

      if (index !== -1) {
        // Add markdown content before this file reference, replacing the <filename> with `filename`
        const beforeContent = remainingContent.substring(0, index);
        const codeWrappedFilename = `\`${ref.filename}\``;

        sections.push({ type: 'markdown', content: beforeContent + codeWrappedFilename });

        // Add the file reference
        sections.push({ type: 'file', content: '', fileRef: ref });

        // Update remaining content
        remainingContent = remainingContent.substring(index + pattern.length);
      }
    });

    // Add any remaining markdown content
    if (remainingContent.trim()) {
      sections.push({ type: 'markdown', content: remainingContent });
    }

    return sections;
  }, [content, fileReferences]);

  return (
    <div className="data-analysis-markdown">
      {/* Main content with inline file references */}
      <div className="markdown-body">
        {contentSections.map((section, index) => {
          if (section.type === 'markdown') {
            return (
              <ReactMarkdown key={`md-${index}`} remarkPlugins={[remarkGfm]}>
                {section.content}
              </ReactMarkdown>
            );
          } else if (section.type === 'file' && section.fileRef) {
            return <div key={`file-${index}`}>{renderFileReference(section.fileRef)}</div>;
          }
          return null;
        })}
      </div>

      {/* Generated Files Summary Section */}
      {fileReferences.length > 0 && (
        <div className="generated-files-section mt-5 pt-4 border-top">
          <h4 className="mb-3">Generated Files</h4>
          <div className="vstack gap-2">
            {fileReferences.map((ref) => (
              <div
                key={ref.filename}
                className="card"
                style={{
                  borderLeft: '3px solid var(--color-primary)',
                }}
              >
                <div className="card-body d-flex align-items-center justify-content-between py-3">
                  <div className="d-flex align-items-center">
                    <i
                      className={`${getFileIconClass(ref.filename)} me-3`}
                      style={{ fontSize: '1.5rem', color: 'var(--color-primary)' }}
                    ></i>
                    <span className="fw-semibold">{ref.filename}</span>
                  </div>
                  <div className="d-flex gap-2">
                    {(ref.extension === 'md' || ref.extension === 'markdown') && fileContents[ref.filename] ? (
                      <ResultActions
                        content={fileContents[ref.filename]}
                        title={ref.filename.replace(/\.(md|markdown)$/, '')}
                        appType="data-analysis"
                      />
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleDownload(ref.fullPath, ref.filename)}
                        style={{
                          backgroundColor: 'var(--color-primary)',
                          borderColor: 'var(--color-primary)',
                          color: 'white',
                        }}
                      >
                        <i className="bi bi-download me-1"></i>
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Trace Section */}
      <TraceViewer traceS3Key={constructTraceFilePath(baseS3Key)} bucket={bucket} region={region} />
    </div>
  );
};

// Helper function to construct trace file path from base S3 key
const constructTraceFilePath = (baseS3Key: string): string => {
  // baseS3Key example: "data-analysis/{userId}/{jobId}/outputs/results-timestamp.md"
  // Extract the prefix (app/user/job) and append trace/trace.jsonl
  const pathParts = baseS3Key.split('/');
  const prefix = pathParts.slice(0, -2).join('/'); // Remove "outputs/results-timestamp.md"
  return `${prefix}/trace/trace.jsonl`;
};

// Simple CSV preview table component
const CsvPreviewTable: React.FC<{ csvContent: string }> = ({ csvContent }) => {
  const { headers, rows, totalRows } = useMemo(() => {
    const lines = csvContent.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length === 0) return { headers: [], rows: [], totalRows: 0 };

    const parseRow = (row: string) => row.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));

    const headers = parseRow(lines[0]);
    const totalRows = lines.length - 1; // Exclude header
    const rows = lines.slice(1, 101).map(parseRow); // Preview first 100 rows

    return { headers, rows, totalRows };
  }, [csvContent]);

  if (headers.length === 0) {
    return <div className="text-muted">No CSV data to preview</div>;
  }

  return (
    <>
      <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
        <table className="table table-sm table-bordered table-hover">
          <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              {headers.map((header, idx) => (
                <th key={idx}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > 100 && (
        <div className="text-muted small mt-2">
          <i className="bi bi-info-circle me-1"></i>
          Showing first 100 of {totalRows} rows. Download the file to see all data.
        </div>
      )}
    </>
  );
};
