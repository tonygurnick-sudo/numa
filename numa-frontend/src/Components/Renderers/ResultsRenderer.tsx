import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from 'react-bootstrap';

import { useAuth } from '../../Providers/AuthProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';
import {
  downloadFileFromS3,
  downloadFileWithSignedUrl,
  openFileWithSignedUrl,
  fetchFileFromS3,
} from '../../utils/s3Utils';
import { MarkdownContent } from './MarkdownContent';
import { ResultActions } from '../ResultActions';
import { DataAnalysisMarkdown } from './DataAnalysisMarkdown';
import { CreateShareModal } from '../Files/CreateShareModal';
import { Form } from 'react-bootstrap';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withPRM } from '../../utils/prmUtils';
import { buildS3Key, type FileScope } from '../../Services/filesService';

// Shared tab navigation component for both JSON and CSV renderers
const TabNavigation = ({ items, activeIndex, setActiveIndex, getLabel, alwaysShow = false }) => {
  if (!alwaysShow && items.length <= 1) return null;

  // For many items, show a subset with pagination
  const maxVisibleTabs = 5;
  const startIndex = Math.max(0, Math.min(activeIndex - Math.floor(maxVisibleTabs / 2), items.length - maxVisibleTabs));
  const endIndex = Math.min(startIndex + maxVisibleTabs, items.length);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div className="mb-4">
      <div className="d-flex flex-wrap align-items-baseline mb-2">
        {visibleItems.map((item, index) => {
          const actualIndex = startIndex + index;
          const label = getLabel(item, actualIndex);

          return (
            <div key={actualIndex} className="step-container mr-1">
              <div
                className={`step-indicator ${activeIndex === actualIndex ? 'active' : ''}`}
                onClick={() => setActiveIndex(actualIndex)}
              >
                <span className="step-label">{label}</span>
              </div>
              {index < visibleItems.length - 1 && <div className="step-connector" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Shared file action buttons component
const FileActionButtons = ({ filePath, onDownload, onOpen, loadingStates }) => {
  const { t } = useTranslation('common');
  const isDownloading = loadingStates[filePath + '-download'];
  const isOpening = loadingStates[filePath + '-open'];

  return (
    <div className="btn-group">
      <button
        className="btn btn-sm btn-outline-primary"
        onClick={onDownload}
        title={t('resultRenderer.actions.downloadFile')}
        disabled={isDownloading || isOpening}
      >
        {isDownloading ? (
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        ) : (
          <i className="bi bi-download"></i>
        )}
      </button>
      <button
        className="btn btn-sm btn-outline-secondary"
        onClick={onOpen}
        title={t('resultRenderer.actions.openInNewTab')}
        disabled={isDownloading || isOpening}
      >
        {isOpening ? (
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        ) : (
          <i className="bi bi-box-arrow-up-right"></i>
        )}
      </button>
    </div>
  );
};

// Component for rendering structured data in a user-friendly way
const JsonRenderer = ({ data }) => {
  const { t } = useTranslation('common');
  // Parse string data if needed
  const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
  const [activeTab, setActiveTab] = useState(null);

  // Helper function to determine if a value should be rendered as a block
  const isComplexValue = (value) => {
    return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
  };

  // Format key for display (capitalize and replace underscores with spaces)
  const formatKey = (key) => {
    return key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Render a simple key-value pair
  const renderSimpleValue = (value) => {
    if (typeof value === 'string') {
      return <MarkdownContent content={value} />;
    } else if (typeof value === 'number') {
      return <span className="text-dark">{value}</span>;
    } else if (typeof value === 'boolean') {
      return <span className="text-dark">{value.toString()}</span>;
    } else if (value === null) {
      return <span className="text-muted">{t('resultRenderer.emptyValue')}</span>;
    } else {
      return <span>{String(value)}</span>;
    }
  };

  // Check if key should be hidden
  const shouldHideKey = (key) => {
    return ['metadata', 'document_analysis'].includes(key);
  };

  // Get top-level keys for tabs
  useEffect(() => {
    if (jsonData && typeof jsonData === 'object') {
      const topLevelKeys = Object.keys(jsonData).filter((key) => !shouldHideKey(key));
      if (topLevelKeys.length > 0 && !activeTab) {
        setActiveTab(topLevelKeys[0]);
      }
    }
  }, [jsonData, activeTab]);

  // Get top-level keys for tabs
  const getTopLevelKeys = () => {
    if (!jsonData || typeof jsonData !== 'object') return [];
    return Object.keys(jsonData).filter((key) => !shouldHideKey(key));
  };

  // Recursively render an object
  const renderObject = (obj, level = 0, path = '', parentKey = null) => {
    // Safety check to prevent infinite recursion
    if (!obj || typeof obj !== 'object') {
      return <div>{t('resultRenderer.invalidData')}</div>;
    }

    // If we're at the top level and have tabs, only show the active tab
    if (level === 0 && activeTab && obj[activeTab]) {
      return (
        <div>
          <div className="mb-3">
            {typeof obj[activeTab] === 'string' ? (
              <MarkdownContent content={obj[activeTab]} />
            ) : isComplexValue(obj[activeTab]) ? (
              renderObject(obj[activeTab], level + 1, activeTab, activeTab)
            ) : (
              renderSimpleValue(obj[activeTab])
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={parentKey ? 'ms-3 ps-2 border-start border-light' : ''}>
        {Object.entries(obj)
          .filter(([key]) => !shouldHideKey(key))
          .map(([key, value], index) => {
            const currentPath = path ? `${path}.${key}` : key;
            const isComplex = isComplexValue(value);
            const displayKey = formatKey(key);
            const isTopLevel = level === 0;

            return (
              <div key={index} className="mb-4">
                {isComplex ? (
                  <div>
                    <div className="d-flex flex-wrap align-items-baseline mb-2">
                      <h6
                        className="mb-1 me-2"
                        style={{
                          color: isTopLevel ? 'var(--brand-primary, var(--color-primary))' : 'var(--bs-secondary)',
                          fontWeight: '600',
                          minWidth: '150px',
                        }}
                      >
                        {displayKey}:
                      </h6>
                    </div>
                    <div>
                      {Array.isArray(value) ? (
                        <div className="ms-3">
                          {value.length === 0 ? (
                            <span className="text-muted">{t('resultRenderer.noItems')}</span>
                          ) : (
                            value.map((item, i) => (
                              <div key={i} className="mb-2 pb-2 border-bottom border-light">
                                {isComplexValue(item) ? (
                                  renderObject(item, level + 1, `${currentPath}[${i}]`, null)
                                ) : (
                                  <div>
                                    <strong>{t('resultRenderer.itemLabel', { index: i + 1 })}</strong>{' '}
                                    {renderSimpleValue(item)}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      ) : (
                        renderObject(value, level + 1, currentPath, key)
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="d-flex flex-wrap align-items-baseline mb-2">
                      <h6
                        className="mb-1 me-2"
                        style={{
                          color: isTopLevel ? 'var(--brand-primary, var(--color-primary))' : 'var(--bs-secondary)',
                          fontWeight: '600',
                          minWidth: '150px',
                        }}
                      >
                        {displayKey}:
                      </h6>
                      <div className="flex-grow-1">{renderSimpleValue(value)}</div>
                    </div>
                    {index < Object.entries(obj).length - 1 && <hr className="my-3 opacity-25" />}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    );
  };

  const topLevelKeys = getTopLevelKeys();

  return (
    <>
      <TabNavigation
        items={topLevelKeys}
        activeIndex={topLevelKeys.indexOf(activeTab)}
        setActiveIndex={(index) => setActiveTab(topLevelKeys[index])}
        getLabel={(key) => formatKey(key)}
      />
      <div className="structured-data-view p-3 bg-white rounded border">
        <div className="overflow-auto" style={{ maxHeight: '500px' }}>
          {renderObject(jsonData)}
        </div>
        <div className="mt-3 text-end">
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2))}
          >
            {t('resultRenderer.actions.copyData')}
          </button>
        </div>
      </div>
    </>
  );
};

// Component for rendering CSV data in a table format
const CsvRenderer = ({ data }) => {
  const { t } = useTranslation('common');
  // Parse CSV string into rows and columns
  const parseCSV = (csvString) => {
    if (!csvString || typeof csvString !== 'string') {
      return { headers: [], rows: [] };
    }

    try {
      // Split by newlines and filter out empty rows
      const lines = csvString.split(/\r?\n/).filter((row) => row.trim().length > 0);

      if (lines.length === 0) {
        return { headers: [], rows: [] };
      }

      // More robust CSV parsing that handles quoted values with commas and newlines
      const parseRow = (rowStr) => {
        const result = [];
        let cell = '';
        let inQuotes = false;

        for (let i = 0; i < rowStr.length; i++) {
          const char = rowStr[i];

          if (char === '"') {
            if (inQuotes && i + 1 < rowStr.length && rowStr[i + 1] === '"') {
              // Handle escaped quotes (double quotes)
              cell += '"';
              i++; // Skip the next quote
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            // End of cell
            result.push(cell);
            cell = '';
          } else {
            cell += char;
          }
        }

        // Add the last cell
        result.push(cell);

        // Clean up quotes from cells
        return result.map((cell) => {
          // Remove surrounding quotes if they exist
          if (cell.startsWith('"') && cell.endsWith('"')) {
            return cell.substring(1, cell.length - 1);
          }
          return cell;
        });
      };

      // For complex CSVs, we need to handle rows that might span multiple lines
      let processedCSV = '';
      let inQuotes = false;

      // Pre-process to handle newlines within quoted fields
      for (let i = 0; i < csvString.length; i++) {
        const char = csvString[i];

        if (char === '"') {
          inQuotes = !inQuotes;
        }

        // Replace newlines within quotes with a placeholder
        if ((char === '\n' || char === '\r') && inQuotes) {
          processedCSV += ' '; // Replace with space
        } else {
          processedCSV += char;
        }
      }

      const processedLines = processedCSV.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const headers = parseRow(processedLines[0]);
      const rows = processedLines.slice(1).map((line) => parseRow(line));

      return { headers, rows };
    } catch (error) {
      console.error('Error parsing CSV:', error);
      return { headers: [], rows: [] };
    }
  };

  const { headers, rows } = parseCSV(data);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const { getCredentials } = useAuth();
  const [loadingFiles, setLoadingFiles] = useState({});

  if (headers.length === 0) {
    return <div className="alert alert-warning">{t('resultRenderer.noValidCsv')}</div>;
  }

  // Find the "Full Name" column or a good alternative
  const getNameColumnIndex = () => {
    const nameColumnOptions = ['full name', 'name', 'candidate', 'person'];
    const headerLower = headers.map((h) => h.toLowerCase());

    for (const option of nameColumnOptions) {
      const index = headerLower.findIndex((h) => h.includes(option));
      if (index !== -1) return index;
    }

    // If no name column found, use the first column
    return 0;
  };

  const nameColumnIndex = getNameColumnIndex();

  const handleFileDownload = (filePath) => {
    try {
      const bucketName = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
      if (!bucketName || bucketName === 'undefined') {
        throw new Error(t('resultRenderer.errors.outputsBucketMissing'));
      }

      // Set loading state for this file path
      setLoadingFiles((prev) => ({ ...prev, [filePath + '-download']: true }));

      const region = window.sessionStorage.getItem('REGION');

      downloadFileFromS3(filePath, bucketName, region, getCredentials).finally(() => {
        // Clear loading state when done
        setLoadingFiles((prev) => ({ ...prev, [filePath + '-download']: false }));
      });
    } catch (err) {
      console.error('Error downloading file:', err);
      // Clear loading state on error
      setLoadingFiles((prev) => ({ ...prev, [filePath + '-download']: false }));
    }
  };

  const handleFileOpen = (filePath) => {
    try {
      const bucketName = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
      if (!bucketName || bucketName === 'undefined') {
        throw new Error(t('resultRenderer.errors.outputsBucketMissing'));
      }

      // Set loading state for this file path
      setLoadingFiles((prev) => ({ ...prev, [filePath + '-open']: true }));

      const region = window.sessionStorage.getItem('REGION');

      openFileWithSignedUrl(filePath, bucketName, region, getCredentials).finally(() => {
        // Clear loading state when done
        setLoadingFiles((prev) => ({ ...prev, [filePath + '-open']: false }));
      });
    } catch (err) {
      console.error('Error opening file:', err);
      // Clear loading state on error
      setLoadingFiles((prev) => ({ ...prev, [filePath + '-open']: false }));
    }
  };

  // Render the active row as a structured view
  const renderActiveRow = () => {
    if (activeRowIndex >= rows.length) return null;

    const activeRow = rows[activeRowIndex];

    // New function to detect and render file paths
    const renderValue = (value) => {
      if (value.trim() === '') {
        return <span className="text-muted fst-italic">{t('resultRenderer.emptyCell')}</span>;
      } else if (value.includes('\n')) {
        return <MarkdownContent content={value} />;
      } else if (isLikelyFilePath(value)) {
        // Extract just the filename from the path
        const fileName = value.split('/').pop();

        return (
          <div className="d-flex align-items-center">
            <span className="text-dark me-2">{fileName}</span>
            <FileActionButtons
              filePath={value}
              onDownload={() => handleFileDownload(value)}
              onOpen={() => handleFileOpen(value)}
              loadingStates={loadingFiles}
            />
          </div>
        );
      } else {
        return <span className="text-dark">{value}</span>;
      }
    };

    return (
      <div className="structured-data-view p-3 bg-white rounded border">
        <div className="overflow-auto">
          {headers.map((header, index) => {
            const value = index < activeRow.length ? activeRow[index] : '';
            const hasMultilineContent = value.includes('\n');

            return (
              <div key={index} className="mb-4">
                <div className="d-flex flex-wrap align-items-baseline mb-2">
                  <h6
                    className="mb-1 me-2"
                    style={{
                      color: 'var(--brand-primary, var(--color-primary))',
                      fontWeight: '600',
                      minWidth: '150px',
                      marginBottom: hasMultilineContent ? '0.5rem' : '0',
                    }}
                  >
                    {header}:
                  </h6>
                  <div className="flex-grow-1">{renderValue(value)}</div>
                </div>
                {index < headers.length - 1 && <hr className="my-3 opacity-25" />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Helper function to detect if a string looks like a file path
  const isLikelyFilePath = (str) => {
    // Check if the string contains a file extension
    const hasFileExtension = /\.\w{2,4}$/.test(str);

    // Check if the string has path-like structure with slashes
    const hasPathStructure = /\//.test(str);

    // Check for common file extensions
    const commonExtensions = /\.(txt|pdf|doc|docx|csv|xlsx|jpg|jpeg|png|gif)$/i.test(str);

    // Return true if it has a path structure and either a file extension or a common extension
    return hasPathStructure && (hasFileExtension || commonExtensions);
  };

  return (
    <div className="csv-renderer">
      <TabNavigation
        items={rows}
        activeIndex={activeRowIndex}
        setActiveIndex={setActiveRowIndex}
        getLabel={(row, index) => {
          const label = row[nameColumnIndex] || t('resultRenderer.rowLabel', { index: index + 1 });
          return label;
        }}
        alwaysShow={true}
      />
      {renderActiveRow()}
      <div className="mt-3 d-flex justify-content-between align-items-center">
        <p className="text-muted small mb-0">
          {t('resultRenderer.summary', { rows: rows.length, columns: headers.length })}
        </p>
        <div>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              const tableView = document.createElement('div');
              tableView.innerHTML = `
                <table border="1" style="border-collapse: collapse; width: 100%;">
                  <thead>
                    <tr>${headers.map((h) => `<th style="padding: 8px;">${h}</th>`).join('')}</tr>
                  </thead>
                  <tbody>
                    ${rows
                      .map(
                        (row) => `
                      <tr>${row.map((cell) => `<td style="padding: 8px;">${cell}</td>`).join('')}</tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              `;

              const blob = new Blob([tableView.innerHTML], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = t('resultRenderer.exportFilename');
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            {t('resultRenderer.actions.exportTable')}
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper function to detect if content is likely CSV
const isCSVContent = (content, contentType) => {
  // Check if content type indicates CSV
  if (contentType === 'text/csv' || contentType === 'application/csv') {
    return true;
  }

  // If content type doesn't help, try to detect based on content
  if (typeof content === 'string') {
    // Simple heuristic: Check if it has multiple lines and commas
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length > 1) {
      // Check if first line has commas and all lines have roughly similar number of commas
      const firstLineCommas = (lines[0].match(/,/g) || []).length;
      if (firstLineCommas > 0) {
        // Check a few more lines to confirm consistent comma count
        const sampleSize = Math.min(5, lines.length);
        let consistentFormat = true;

        for (let i = 1; i < sampleSize; i++) {
          const commaCount = (lines[i].match(/,/g) || []).length;
          // Allow some variation in comma count (for trailing commas, etc.)
          if (Math.abs(commaCount - firstLineCommas) > 1) {
            consistentFormat = false;
            break;
          }
        }

        return consistentFormat;
      }
    }
  }

  return false;
};

// Shared component for file download/open/save/share buttons in ResultsRenderer
const FileDownloadButtons = ({ output, getCredentials, loadingActions, setLoadingActions }) => {
  const { t } = useTranslation('common');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('/');
  const [savingToFiles, setSavingToFiles] = useState(false);

  // Extract filename from output
  const filename = output.title || output.data.key?.split('/').pop() || 'artifact.file';

  const handleSaveToFiles = async () => {
    if (!selectedFolder) return;

    setSavingToFiles(true);
    try {
      // First download the file content from workspace output
      const region = window.sessionStorage.getItem('REGION') || 'us-east-1';
      const credentials = await getCredentials();
      if (!credentials) throw new Error('No credentials');

      // Download the file content from the workspace output bucket
      const blob = await fetchFileFromS3(output.data.key, output.data.bucket, region, getCredentials);
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });

      // Now upload to DATA_BUCKET in the user's Files system
      const dataBucket = window.sessionStorage.getItem('DATA_BUCKET');
      type WindowWithUser = typeof window & { user?: { decoded_tokens?: { idToken?: { sub?: string } } } };
      const userSub = (window as WindowWithUser).user?.decoded_tokens?.idToken?.sub;

      if (!dataBucket) {
        throw new Error('DATA_BUCKET not configured');
      }
      if (!userSub) {
        throw new Error('User not authenticated');
      }

      // Build the S3 key for the user's files
      const scope: FileScope = { type: 'my' };
      const s3Key = buildS3Key(scope, filename, selectedFolder, userSub);

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
    } catch (error) {
      console.error('Failed to save file:', error);
      // TODO: Show error toast
    } finally {
      setSavingToFiles(false);
    }
  };

  const handleShare = () => {
    setShowShareModal(true);
  };

  return (
    <>
      <div className="btn-group">
        <button
          className="btn btn-primary"
          style={{
            backgroundColor: 'var(--color-primary)',
            borderColor: 'var(--color-primary)',
            color: 'white',
          }}
          onClick={() => {
            setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-download`]: true }));
            const region = window.sessionStorage.getItem('REGION');
            downloadFileWithSignedUrl(
              output.data.key,
              output.data.bucket,
              region,
              getCredentials,
              output.title || null
            ).finally(() => {
              setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-download`]: false }));
            });
          }}
          disabled={loadingActions[`${output.data.key}-download`] || loadingActions[`${output.data.key}-open`]}
        >
          {loadingActions[`${output.data.key}-download`] ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              {t('resultRenderer.actions.downloading')}
            </>
          ) : (
            <>
              <i className="bi bi-download me-1"></i>
              {t('resultRenderer.actions.downloadLabel', { title: output.title || t('resultRenderer.actions.file') })}
            </>
          )}
        </button>

        <button
          className="btn btn-outline-success"
          onClick={() => setShowSaveModal(true)}
          disabled={loadingActions[`${output.data.key}-download`] || loadingActions[`${output.data.key}-open`]}
          title={t('resultRenderer.actions.saveToFiles')}
        >
          <i className="bi bi-folder-plus me-1"></i>
          {t('resultRenderer.actions.save')}
        </button>

        <button
          className="btn btn-outline-info"
          onClick={handleShare}
          disabled={loadingActions[`${output.data.key}-download`] || loadingActions[`${output.data.key}-open`]}
          title={t('resultRenderer.actions.shareFile')}
        >
          <i className="bi bi-share me-1"></i>
          {t('resultRenderer.actions.share')}
        </button>

        <button
          className="btn btn-outline-secondary"
          onClick={() => {
            setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-open`]: true }));
            const region = window.sessionStorage.getItem('REGION');
            openFileWithSignedUrl(output.data.key, output.data.bucket, region, getCredentials).finally(() => {
              setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-open`]: false }));
            });
          }}
          disabled={loadingActions[`${output.data.key}-download`] || loadingActions[`${output.data.key}-open`]}
        >
          {loadingActions[`${output.data.key}-open`] ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              {t('resultRenderer.actions.opening')}
            </>
          ) : (
            <>
              <i className="bi bi-box-arrow-up-right me-1"></i>
              {t('resultRenderer.actions.openInNewTab')}
            </>
          )}
        </button>
      </div>

      {/* Save to Files Modal */}
      <Modal show={showSaveModal} onHide={() => setShowSaveModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{t('resultRenderer.actions.saveToFilesTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <strong>{t('resultRenderer.actions.filename')}:</strong> {filename}
          </div>
          <div className="mb-3">
            <Form.Label htmlFor="folder-path-input">{t('resultRenderer.actions.selectFolder')}:</Form.Label>
            <Form.Control
              id="folder-path-input"
              type="text"
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              placeholder={t('resultRenderer.actions.chooseFolderPlaceholder')}
            />
            <Form.Text className="text-muted">{t('resultRenderer.actions.folderPathHelp')}</Form.Text>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSaveModal(false)} disabled={savingToFiles}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSaveToFiles} disabled={!selectedFolder || savingToFiles}>
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
      {showShareModal && (
        <CreateShareModal
          show={showShareModal}
          onHide={() => setShowShareModal(false)}
          onCreated={() => setShowShareModal(false)}
          preSelectedFile={{
            path: `/${filename}`,
            name: filename,
            scope: { type: 'my' },
          }}
        />
      )}
    </>
  );
};

export const ResultsRenderer = ({ results }) => {
  const { t } = useTranslation('common');
  const [contents, setContents] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const { getCredentials } = useAuth();
  const { fetchS3Content, numaAppData } = useNumaApp();
  const pendingRequests = useRef({});
  const loadedKeysRef = useRef<Set<string>>(new Set());
  const [loadingActions, setLoadingActions] = useState({});
  const [selectedOutputIndex, setSelectedOutputIndex] = useState(0);

  // Check if this is the data-analysis app (multiple sources for robustness)
  const isDataAnalysisApp = useMemo(() => {
    // Check numaAppData first
    if (numaAppData?.id === 'data-analysis') return true;

    // Fallback: Check if S3 key indicates data-analysis
    // Parse results if needed to check the key
    let parsedResults = results;
    if (typeof results === 'string') {
      try {
        parsedResults = JSON.parse(results);
      } catch {
        return false;
      }
    }

    const firstOutput = parsedResults?.[0]?.outputs?.[0];
    if (firstOutput?.data?.key?.includes('data-analysis/')) return true;

    return false;
  }, [numaAppData?.id, results]);

  useEffect(() => {
    // Parse results if it's a JSON string
    let parsedResults = results;
    if (typeof results === 'string') {
      try {
        parsedResults = JSON.parse(results);
      } catch (error) {
        console.error('Error parsing results JSON:', error);
        return;
      }
    }

    // Extract the actual results array from the nested structure
    let actualResults = parsedResults;

    // Check for a nested results array THIS IS A HACK AND SHOULD BE REMOVED
    if (parsedResults && parsedResults.results) {
      // Handle case where results.results is a JSON string
      if (typeof parsedResults.results === 'string') {
        try {
          const nestedResults = JSON.parse(parsedResults.results);
          if (nestedResults && nestedResults.results && Array.isArray(nestedResults.results)) {
            actualResults = nestedResults.results;
          } else if (Array.isArray(nestedResults)) {
            actualResults = nestedResults;
          }
        } catch (error) {
          console.error('Error parsing nested results JSON:', error);
          return;
        }
      } else if (Array.isArray(parsedResults.results)) {
        // Handle case where results.results is already an array
        actualResults = parsedResults.results;
      }
    }

    if (!actualResults || !Array.isArray(actualResults)) {
      return;
    }

    // Reset selected output index when results change
    // Prefer S3 output (full report) over INLINE (summary)
    const firstResult = actualResults[0];
    if (firstResult?.outputs && Array.isArray(firstResult.outputs)) {
      const s3OutputIndex = firstResult.outputs.findIndex((o) => o.location?.toLowerCase() === 's3');
      setSelectedOutputIndex(s3OutputIndex !== -1 ? s3OutputIndex : 0);
    } else {
      setSelectedOutputIndex(0);
    }

    const fetchContents = async () => {
      for (const result of actualResults) {
        if (!result.outputs || !Array.isArray(result.outputs)) {
          continue;
        }

        for (const output of result.outputs) {
          const key = `${result.input_reference}-${output.content_type}-${output.data.key}`;

          // Skip if we've already loaded this content
          if (loadedKeysRef.current.has(key) || contents[key] !== undefined) {
            continue;
          }

          // Skip if there's already a request in progress for this key
          if (pendingRequests.current[key]) {
            continue;
          }

          // For inline content, set it directly
          if (output.location?.toLowerCase() === 'inline') {
            const inlineData: unknown = output.data;
            const text =
              typeof inlineData === 'string' ? inlineData : (inlineData as { content?: string } | null)?.content;
            if (typeof text === 'string') {
              setContents((prev) => ({ ...prev, [key]: text }));
            } else {
              console.warn('Inline output provided without string content.');
            }
            continue;
          }

          // For S3 content, fetch it
          if (output.location?.toLowerCase() === 's3' && output.data?.bucket && output.data?.key) {
            try {
              // Mark this request as in progress
              pendingRequests.current[key] = true;

              setLoading((prev) => ({ ...prev, [key]: true }));
              setErrors((prev) => ({ ...prev, [key]: null }));

              const credentials = await getCredentials();
              if (!credentials) {
                throw new Error('Failed to get credentials');
              }

              const content = await fetchS3Content(output.data.bucket, output.data.key, credentials);
              setContents((prev) => ({ ...prev, [key]: content }));
              loadedKeysRef.current.add(key);
            } catch (err) {
              console.error('Error fetching S3 content:', err);
              setErrors((prev) => ({
                ...prev,
                [key]: t('resultRenderer.errors.loadingContent', { message: err.message }),
              }));
            } finally {
              setLoading((prev) => ({ ...prev, [key]: false }));
              // Clear the pending request flag
              delete pendingRequests.current[key];
            }
          } else {
            console.warn('Invalid output location or missing S3 data:', output);
          }
        }
      }
    };

    fetchContents();
  }, [results, getCredentials, fetchS3Content]);

  // Extract the actual results array for rendering
  let parsedResults = results;
  if (typeof results === 'string') {
    try {
      parsedResults = JSON.parse(results);
    } catch (error) {
      console.error('Error parsing results JSON for rendering:', error);
      return <div>{t('resultRenderer.errors.parseResults')}</div>;
    }
  }

  let actualResults = parsedResults;
  if (parsedResults && parsedResults.results) {
    // Handle case where results.results is a JSON string
    if (typeof parsedResults.results === 'string') {
      try {
        const nestedResults = JSON.parse(parsedResults.results);
        if (nestedResults && nestedResults.results && Array.isArray(nestedResults.results)) {
          actualResults = nestedResults.results;
        } else if (Array.isArray(nestedResults)) {
          actualResults = nestedResults;
        }
      } catch (error) {
        console.error('Error parsing nested results JSON for rendering:', error);
        return <div>{t('resultRenderer.errors.parseNested')}</div>;
      }
    } else if (Array.isArray(parsedResults.results)) {
      // Handle case where results.results is already an array
      actualResults = parsedResults.results;
    }
  }

  if (!actualResults || !Array.isArray(actualResults) || actualResults.length === 0) {
    return <div>{t('resultRenderer.emptyResults')}</div>;
  }

  // Get the first result
  const result = actualResults[0];
  if (!result.outputs || !Array.isArray(result.outputs) || result.outputs.length === 0) {
    return <div>{t('resultRenderer.emptyOutputs')}</div>;
  }

  // The selected output
  const selectedOutput = result.outputs[selectedOutputIndex];
  if (!selectedOutput) return null;

  // Create unique key for this output
  const key = `${result.input_reference}-${selectedOutput.content_type}-${selectedOutput.data.key}`;
  const content = contents[key];
  const isLoading = loading[key] && !content;
  const error = errors[key];

  // Render tabs for all outputs
  const renderOutputTabs = () => {
    if (result.outputs.length <= 1) return null;

    return (
      <div className="mb-4">
        <ul className="nav nav-tabs">
          {result.outputs.map((output, index) => (
            <li className="nav-item" key={index}>
              <button
                className={`nav-link ${selectedOutputIndex === index ? 'active' : ''}`}
                onClick={() => setSelectedOutputIndex(index)}
              >
                {output.title || t('resultRenderer.outputLabel', { index: index + 1 })}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="result-section mb-4">
      {renderOutputTabs()}

      {isLoading ? (
        <div className="text-center mb-3">
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
          <span className="ms-2">{t('resultRenderer.loadingContent')}</span>
        </div>
      ) : error ? (
        <div className="mb-3">
          <div className="text-danger">{error}</div>
          <div className="mt-2">
            <strong>{t('resultRenderer.debugInfo')}</strong>
            <pre>{JSON.stringify(selectedOutput, null, 2)}</pre>
          </div>
        </div>
      ) : !content ? (
        <div className="s3-link mb-3">
          <FileDownloadButtons
            output={selectedOutput}
            getCredentials={getCredentials}
            loadingActions={loadingActions}
            setLoadingActions={setLoadingActions}
          />
        </div>
      ) : // Data Analysis: Always use DataAnalysisMarkdown for data-analysis apps (regardless of content_type)
      isDataAnalysisApp && selectedOutput.data?.key ? (
        <div className="mb-3">
          <div className="markdown-content p-3 bg-white rounded border">
            <DataAnalysisMarkdown
              content={typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
              baseS3Key={selectedOutput.data.key}
              bucket={selectedOutput.data.bucket || window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || ''}
              region={window.sessionStorage.getItem('REGION') || ''}
            />
          </div>
        </div>
      ) : // Render content based on type
      isCSVContent(content, selectedOutput.content_type) ? (
        <div className="mb-3">
          <div className="csv-content p-3 bg-white rounded border">
            <CsvRenderer data={content} />
          </div>
          {!isLoading && !error && content && (
            <ResultActions
              content={typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
              title={selectedOutput.title || t('resultRenderer.resultLabel', { index: selectedOutputIndex + 1 })}
            />
          )}
        </div>
      ) : selectedOutput.content_type === 'text/markdown' || selectedOutput.content_type === 'text/plain' ? (
        <div className="mb-3">
          <div className="markdown-content p-3 bg-white rounded border">
            <MarkdownContent content={typeof content === 'string' ? content : JSON.stringify(content, null, 2)} />
          </div>
          {!isLoading && !error && content && (
            <ResultActions
              content={typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
              title={selectedOutput.title || t('resultRenderer.resultLabel', { index: selectedOutputIndex + 1 })}
            />
          )}
        </div>
      ) : selectedOutput.content_type === 'application/json' ? (
        <div className="mb-3">
          <JsonRenderer data={content} />
          {!isLoading && !error && content && (
            <ResultActions
              content={typeof content === 'object' ? JSON.stringify(content, null, 2) : content}
              title={selectedOutput.title || t('resultRenderer.resultLabel', { index: selectedOutputIndex + 1 })}
            />
          )}
        </div>
      ) : (
        <div className="s3-link mb-3">
          <FileDownloadButtons
            output={selectedOutput}
            getCredentials={getCredentials}
            loadingActions={loadingActions}
            setLoadingActions={setLoadingActions}
          />
        </div>
      )}
    </div>
  );
};

export { JsonRenderer, CsvRenderer };
