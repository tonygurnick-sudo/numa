import { useState, useEffect, useRef } from 'react';

import ReactMarkdown from 'react-markdown';
import { useAuth } from '../Providers/AuthProvider';
import { useNumaApp } from '../Providers/NumaAppContext';
import { downloadFileFromS3, downloadFileWithSignedUrl, openFileWithSignedUrl } from '../utils/s3Utils';

// Shared tab navigation component for both JSON and CSV renderers
const TabNavigation = ({ items, activeIndex, setActiveIndex, getLabel }) => {
  if (items.length <= 1) return null;

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
  const isDownloading = loadingStates[filePath + '-download'];
  const isOpening = loadingStates[filePath + '-open'];

  return (
    <div className="btn-group">
      <button
        className="btn btn-sm btn-outline-primary"
        onClick={onDownload}
        title="Download file"
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
        title="Open in new tab"
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
      return <ReactMarkdown>{value}</ReactMarkdown>;
    } else if (typeof value === 'number') {
      return <span className="text-dark">{value}</span>;
    } else if (typeof value === 'boolean') {
      return <span className="text-dark">{value.toString()}</span>;
    } else if (value === null) {
      return <span className="text-muted">-</span>;
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
      return <div>Invalid data structure</div>;
    }

    // If we're at the top level and have tabs, only show the active tab
    if (level === 0 && activeTab && obj[activeTab]) {
      return (
        <div>
          <div className="mb-3">
            {typeof obj[activeTab] === 'string' ? (
              <ReactMarkdown>{obj[activeTab]}</ReactMarkdown>
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
                          color: isTopLevel ? 'var(--color-primary)' : 'var(--bs-secondary)',
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
                            <span className="text-muted">No items</span>
                          ) : (
                            value.map((item, i) => (
                              <div key={i} className="mb-2 pb-2 border-bottom border-light">
                                {isComplexValue(item) ? (
                                  renderObject(item, level + 1, `${currentPath}[${i}]`, null)
                                ) : (
                                  <div>
                                    <strong>Item {i + 1}:</strong> {renderSimpleValue(item)}
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
                          color: isTopLevel ? 'var(--color-primary)' : 'var(--bs-secondary)',
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
            Copy Data
          </button>
        </div>
      </div>
    </>
  );
};

// Component for rendering CSV data in a table format
const CsvRenderer = ({ data }) => {
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
  const { getIdentityPoolCredentials } = useAuth();
  const [loadingFiles, setLoadingFiles] = useState({});

  if (headers.length === 0) {
    return <div className="alert alert-warning">No valid CSV data found</div>;
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
        throw new Error('Outputs bucket not found in session storage');
      }

      // Set loading state for this file path
      setLoadingFiles((prev) => ({ ...prev, [filePath + '-download']: true }));

      downloadFileFromS3(filePath, bucketName, 'us-east-1', getIdentityPoolCredentials).finally(() => {
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
        throw new Error('Outputs bucket not found in session storage');
      }

      // Set loading state for this file path
      setLoadingFiles((prev) => ({ ...prev, [filePath + '-open']: true }));

      openFileWithSignedUrl(filePath, bucketName, 'us-east-1', getIdentityPoolCredentials).finally(() => {
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
        return <span className="text-muted fst-italic">Empty</span>;
      } else if (value.includes('\n')) {
        return <ReactMarkdown>{value}</ReactMarkdown>;
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
                      color: 'var(--color-primary)',
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
        getLabel={(row, index) => row[nameColumnIndex] || `Row ${index + 1}`}
      />
      {renderActiveRow()}
      <div className="mt-3 d-flex justify-content-between align-items-center">
        <p className="text-muted small mb-0">
          Total: {rows.length} rows and {headers.length} columns
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
                    `,
                      )
                      .join('')}
                  </tbody>
                </table>
              `;

              const blob = new Blob([tableView.innerHTML], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'table-view.html';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export Table View
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

// Shared component for file download/open buttons in ResultsRenderer
const FileDownloadButtons = ({ output, getIdentityPoolCredentials, loadingActions, setLoadingActions }) => {
  return (
    <div className="btn-group">
      <button
        className="btn btn-primary"
        onClick={() => {
          setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-download`]: true }));
          downloadFileWithSignedUrl(
            output.data.key,
            output.data.bucket,
            'us-east-1',
            getIdentityPoolCredentials,
            output.title || null,
          ).finally(() => {
            setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-download`]: false }));
          });
        }}
        disabled={loadingActions[`${output.data.key}-download`] || loadingActions[`${output.data.key}-open`]}
      >
        {loadingActions[`${output.data.key}-download`] ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Downloading...
          </>
        ) : (
          <>Download {output.title || 'File'}</>
        )}
      </button>
      <button
        className="btn btn-outline-secondary"
        onClick={() => {
          setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-open`]: true }));
          openFileWithSignedUrl(output.data.key, output.data.bucket, 'us-east-1', getIdentityPoolCredentials).finally(
            () => {
              setLoadingActions((prev) => ({ ...prev, [`${output.data.key}-open`]: false }));
            },
          );
        }}
        disabled={loadingActions[`${output.data.key}-download`] || loadingActions[`${output.data.key}-open`]}
      >
        {loadingActions[`${output.data.key}-open`] ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Opening...
          </>
        ) : (
          <>Open in New Tab</>
        )}
      </button>
    </div>
  );
};

export const ResultsRenderer = ({ results, activeResultIndex = 0 }) => {
  const [contents, setContents] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const { getIdentityPoolCredentials } = useAuth();
  const { fetchS3Content } = useNumaApp();
  const pendingRequests = useRef({});
  const [loadingActions, setLoadingActions] = useState({});

  useEffect(() => {
    if (!results || !Array.isArray(results)) {
      console.log('No results or results is not an array:', results);
      return;
    }

    const fetchContents = async () => {
      for (const result of results) {
        if (!result.outputs || !Array.isArray(result.outputs)) {
          continue;
        }

        for (const output of result.outputs) {
          const key = `${result.input_reference}-${output.content_type}`;

          // Skip if we've already loaded this content
          if (contents[key] !== undefined) {
            continue;
          }

          // Skip if there's already a request in progress for this key
          if (pendingRequests.current[key]) {
            continue;
          }

          // For inline content, set it directly
          if (output.location?.toLowerCase() === 'inline') {
            setContents((prev) => ({ ...prev, [key]: output.data }));
            continue;
          }

          // For S3 content, fetch it
          if (output.location?.toLowerCase() === 's3' && output.data?.bucket && output.data?.key) {
            try {
              // Mark this request as in progress
              pendingRequests.current[key] = true;

              setLoading((prev) => ({ ...prev, [key]: true }));
              setErrors((prev) => ({ ...prev, [key]: null }));

              const credentials = await getIdentityPoolCredentials();
              if (!credentials) {
                throw new Error('Failed to get credentials');
              }

              const content = await fetchS3Content(output.data.bucket, output.data.key, credentials);
              setContents((prev) => ({ ...prev, [key]: content }));
            } catch (err) {
              console.error('Error fetching S3 content:', err);
              setErrors((prev) => ({
                ...prev,
                [key]: `Error loading content: ${err.message}`,
              }));
            } finally {
              setLoading((prev) => ({ ...prev, [key]: false }));
              // Clear the pending request flag
              delete pendingRequests.current[key];
            }
          } else {
            console.log('Invalid output location or missing S3 data:', output);
          }
        }
      }
    };

    fetchContents();
  }, [results, getIdentityPoolCredentials, fetchS3Content, contents]);

  if (!results || !Array.isArray(results)) {
    return <div>No results to display</div>;
  }

  // Calculate which result and output to show based on activeResultIndex
  let currentResultIndex = 0;
  let targetResult = null;
  let targetOutputIndex = 0;

  // Find the result and output that corresponds to the activeResultIndex
  for (const result of results) {
    const outputCount = result.outputs?.length || 0;
    if (activeResultIndex < currentResultIndex + outputCount) {
      targetResult = result;
      targetOutputIndex = activeResultIndex - currentResultIndex;
      break;
    }
    currentResultIndex += outputCount;
  }

  if (!targetResult) {
    return <div>No result found for index {activeResultIndex}</div>;
  }

  const output = targetResult.outputs[targetOutputIndex];
  if (!output) return null;

  const key = `${targetResult.input_reference}-${output.content_type}`;
  const isLoading = loading[key];
  const error = errors[key];
  const content = contents[key];

  return (
    <div className="result-section mb-4">
      {output.title && <h4 className="mb-3">{output.title}</h4>}

      {isLoading ? (
        <div className="text-center mb-3">
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
          <span className="ms-2">Loading content...</span>
        </div>
      ) : error ? (
        <div className="mb-3">
          <div className="text-danger">{error}</div>
          <div className="mt-2">
            <strong>Debug info:</strong>
            <pre>{JSON.stringify(output, null, 2)}</pre>
          </div>
        </div>
      ) : !content ? (
        <div className="s3-link mb-3">
          <FileDownloadButtons
            output={output}
            getIdentityPoolCredentials={getIdentityPoolCredentials}
            loadingActions={loadingActions}
            setLoadingActions={setLoadingActions}
          />
        </div>
      ) : // Render content based on type
      isCSVContent(content, output.content_type) ? (
        <div className="mb-3">
          <div className="csv-content p-3 bg-white rounded border">
            <CsvRenderer data={content} />
          </div>
        </div>
      ) : output.content_type === 'text/markdown' || output.content_type === 'text/plain' ? (
        <div className="mb-3">
          <div className="markdown-content p-3 bg-white rounded border">
            <ReactMarkdown style={{ whiteSpace: 'pre-wrap' }}>
              {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
            </ReactMarkdown>
          </div>
        </div>
      ) : output.content_type === 'application/json' ? (
        <div className="mb-3">
          <JsonRenderer data={content} />
        </div>
      ) : (
        <div className="s3-link mb-3">
          <FileDownloadButtons
            output={output}
            getIdentityPoolCredentials={getIdentityPoolCredentials}
            loadingActions={loadingActions}
            setLoadingActions={setLoadingActions}
          />
        </div>
      )}
    </div>
  );
};

export { JsonRenderer, CsvRenderer };
