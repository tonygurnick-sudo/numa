import React, { useState, useEffect, useMemo } from 'react';
import { Spinner, Button } from 'react-bootstrap';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { getFileIconClass } from '../../utils/fileUtils';
import { downloadFileFromS3, downloadFolderAsZip, listObjectsInFolder } from '../../utils/s3Utils';
import { buildFileTree, buildRowsForTree, flattenRows } from '../../utils/fileTreeUtils';
import { MarkdownContent } from './MarkdownContent';
import { TraceViewer } from './ClaudeCodeTraceViewer';
import { FileTreeTable } from '../FileTreeTable';

interface NoliaMarkdownProps {
  content: string;
  baseS3Key: string; // e.g., "nolia/{userId}/{jobId}/outputs/results.md"
  bucket: string;
  region: string;
}

interface FileReference {
  // Display name shown in UI (basename)
  filename: string;
  // Full S3 key to fetch
  fullPath: string;
  // Original relative path under outputs (may include subfolders)
  relativePath: string;
  extension: string;
}

interface FolderReference {
  // Display name (folder basename)
  name: string;
  // Full S3 key prefix for the folder
  fullPath: string;
  // Original relative path under outputs
  relativePath: string;
}

interface FolderContents {
  s3Keys: string[]; // Store original relative S3 keys for proper tree building
  loading: boolean;
  error: string | null;
}

export const NoliaMarkdown: React.FC<NoliaMarkdownProps> = ({ content, baseS3Key, bucket, region }) => {
  const { getCredentials } = useAuth();
  const { fetchS3Content } = useNumaApp();

  // Result content state
  const [resultContent, setResultContent] = useState<string>('');
  const [loadingResult, setLoadingResult] = useState(true);

  // File preview state
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<Record<string, boolean>>({});

  // Folder state
  const [folderContents, setFolderContents] = useState<Record<string, FolderContents>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedTreeFolders, setExpandedTreeFolders] = useState<Record<string, Set<string>>>({});

  // Derive the S3 outputs/ prefix from the base key
  // baseS3Key example: nolia/{userId}/{jobId}/outputs/<anything>
  const getOutputsPrefix = (baseKey: string): string => {
    const parts = baseKey.split('/');
    // Ensure we always return .../outputs
    const idx = parts.findIndex((p) => p === 'outputs');
    if (idx !== -1) {
      return parts.slice(0, idx + 1).join('/');
    }
    // Fallback: assume last two removals lead to app/user/job
    return parts.slice(0, -1).concat('outputs').join('/');
  };

  // Normalize a file path referenced in <file:path> by stripping leading slashes and optional 'outputs/'
  const normalizeRelativePath = (raw: string): string => {
    let p = raw.trim();
    if (p.toLowerCase().startsWith('file:')) p = p.slice(5);
    p = p.replace(/^\/*/, ''); // drop any leading '/'
    if (p.startsWith('outputs/')) p = p.slice('outputs/'.length);
    return p;
  };

  // Build full S3 key from a relative path (relative to outputs/)
  const buildS3KeyForRelativePath = (relativePath: string, baseKey: string): string => {
    const prefix = getOutputsPrefix(baseKey);
    const cleaned = normalizeRelativePath(relativePath);
    return `${prefix}/${cleaned}`;
  };

  // Parse file references present in the result content
  const parseFileReferencesInContent = (text: string): FileReference[] => {
    const refs: FileReference[] = [];

    // New format: <file:path>
    const fileTagPattern = /<file:([^>]+)>/gi;
    let match: RegExpExecArray | null;
    while ((match = fileTagPattern.exec(text)) !== null) {
      const rel = normalizeRelativePath(match[1]);
      const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
      const filename = rel.split('/').pop() || rel;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      refs.push({ filename, fullPath, relativePath: rel, extension });
    }

    // Back-compat: old format <filename.ext>
    const oldAnglePattern = /<([^>]+\.\w+)>/g;
    while ((match = oldAnglePattern.exec(text)) !== null) {
      const rel = normalizeRelativePath(match[1]);
      const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
      const filename = rel.split('/').pop() || rel;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      refs.push({ filename, fullPath, relativePath: rel, extension });
    }

    // Optional: [text](file:path) or [text](filename.ext)
    const linkPattern = /\[[^\]]*\]\((?:file:)?([^\s)]+)\)/gi;
    while ((match = linkPattern.exec(text)) !== null) {
      const rel = normalizeRelativePath(match[1]);
      const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
      const filename = rel.split('/').pop() || rel;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      refs.push({ filename, fullPath, relativePath: rel, extension });
    }

    // De-duplicate by fullPath
    const seen = new Set<string>();
    return refs.filter((r) => (seen.has(r.fullPath) ? false : (seen.add(r.fullPath), true)));
  };

  // Parse folder references present in the result content
  const parseFolderReferencesInContent = (text: string): FolderReference[] => {
    const refs: FolderReference[] = [];

    // Format: <folder:path>
    const folderTagPattern = /<folder:([^>]+)>/gi;
    let match: RegExpExecArray | null;
    while ((match = folderTagPattern.exec(text)) !== null) {
      let rel = normalizeRelativePath(match[1]);
      // Ensure folder path doesn't end with /
      rel = rel.replace(/\/+$/, '');
      const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
      const name = rel.split('/').pop() || rel;
      refs.push({ name, fullPath, relativePath: rel });
    }

    // De-duplicate by fullPath
    const seen = new Set<string>();
    return refs.filter((r) => (seen.has(r.fullPath) ? false : (seen.add(r.fullPath), true)));
  };

  // Extract folder references from result content
  const folderReferences = useMemo(() => {
    if (!resultContent) return [];
    const allRefs = parseFolderReferencesInContent(resultContent);

    // Filter out folders that are children of other referenced folders
    // This prevents showing nested folders at the top level in Generated Files
    return allRefs.filter((ref) => {
      const isChildOfAnother = allRefs.some(
        (other) => other.fullPath !== ref.fullPath && ref.fullPath.startsWith(other.fullPath + '/'),
      );
      return !isChildOfAnother;
    });
  }, [resultContent, baseS3Key]);

  // Load folder contents from S3
  const loadFolderContents = async (folderRef: FolderReference) => {
    const key = folderRef.fullPath;
    if (folderContents[key]?.s3Keys.length > 0 || folderContents[key]?.loading) return;

    setFolderContents((prev) => ({
      ...prev,
      [key]: { s3Keys: [], loading: true, error: null },
    }));

    try {
      // List all objects in the folder
      const objectKeys = await listObjectsInFolder(`${key}/`, bucket, region, getCredentials);

      // Store relative S3 keys (strip folder prefix)
      const relativeKeys = objectKeys
        .filter((objKey) => !objKey.endsWith('/')) // Skip folder markers
        .map((objKey) => objKey.substring(key.length + 1)); // Make relative to folder

      setFolderContents((prev) => ({
        ...prev,
        [key]: { s3Keys: relativeKeys, loading: false, error: null },
      }));

      // Initialize tree expansion state for this folder
      setExpandedTreeFolders((prev) => ({
        ...prev,
        [key]: new Set(),
      }));
    } catch (err) {
      console.error(`Error loading folder ${folderRef.name}:`, err);
      setFolderContents((prev) => ({
        ...prev,
        [key]: {
          s3Keys: [],
          loading: false,
          error: `Failed to load folder contents: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      }));
    }
  };

  // Toggle folder expansion (inline folder reference)
  const toggleFolderExpansion = (folderRef: FolderReference) => {
    const key = folderRef.fullPath;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Load contents if not already loaded
        loadFolderContents(folderRef);
      }
      return next;
    });
  };

  // Toggle tree folder expansion within a folder reference
  const toggleTreeFolder = (folderKey: string, folderId: string) => {
    setExpandedTreeFolders((prev) => {
      const current = prev[folderKey] || new Set();
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return { ...prev, [folderKey]: next };
    });
  };

  // Handle folder download
  const handleFolderDownload = async (folderRef: FolderReference) => {
    try {
      await downloadFolderAsZip(`${folderRef.fullPath}/`, bucket, region, getCredentials);
    } catch (err) {
      console.error('Error downloading folder:', err);
    }
  };

  // Extract file references from result content
  const fileReferences = useMemo(() => {
    if (!resultContent) return [];
    const allFileRefs = parseFileReferencesInContent(resultContent);

    // Filter out files that are inside referenced folders
    // This prevents showing nested files at the top level in Generated Files
    return allFileRefs.filter((fileRef) => {
      const isInsideReferencedFolder = folderReferences.some((folderRef) =>
        fileRef.fullPath.startsWith(folderRef.fullPath + '/'),
      );
      return !isInsideReferencedFolder;
    });
  }, [resultContent, baseS3Key, folderReferences]);

  // Load file content for inline rendering
  const loadFileContent = async (filePath: string, filename: string) => {
    if (fileContents[filename] || loadingFiles[filename]) return;

    setLoadingFiles((prev) => ({ ...prev, [filename]: true }));

    try {
      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get credentials');
      }

      const content = await fetchS3Content(bucket, filePath, credentials);
      setFileContents((prev) => ({ ...prev, [filename]: content }));
    } catch (err) {
      console.error(`Error loading file ${filename}:`, err);
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

  // Load result content from S3
  useEffect(() => {
    const loadResult = async () => {
      try {
        setLoadingResult(true);
        const credentials = await getCredentials();
        if (!credentials) {
          throw new Error('Failed to get credentials');
        }

        const resultData = await fetchS3Content(bucket, baseS3Key, credentials);
        setResultContent(resultData);
      } catch (err) {
        console.error('Error loading result from S3:', err);
        // Use content prop as fallback
        setResultContent(content || 'No results available.');
      } finally {
        setLoadingResult(false);
      }
    };

    if (baseS3Key) {
      loadResult();
    } else {
      setResultContent(content || 'No results available.');
      setLoadingResult(false);
    }
  }, [baseS3Key, bucket, content, fetchS3Content, getCredentials]);

  // Handle file download
  const handleDownload = async (filePath: string, filename: string) => {
    try {
      await downloadFileFromS3(filePath, bucket, region, getCredentials, filename);
    } catch (err) {
      console.error('Error downloading file:', err);
    }
  };

  return (
    <div className="nolia-markdown">
      {/* Loading state */}
      {loadingResult ? (
        <div className="text-center py-5">
          <Spinner animation="border" role="status" variant="primary">
            <span className="visually-hidden">Loading results...</span>
          </Spinner>
          <p className="text-muted mt-3">Loading results...</p>
        </div>
      ) : (
        <>
          {/* Main result content */}
          <div className="result-content markdown-body">
            <MarkdownContent content={resultContent} />
          </div>

          {/* Generated Files Summary Section */}
          {(fileReferences.length > 0 || folderReferences.length > 0) && (
            <div className="generated-files-section mt-5 pt-4 border-top">
              <h4 className="mb-3">Generated Files</h4>
              <div className="vstack gap-2">
                {/* Render folders first */}
                {folderReferences.map((ref) => (
                  <div
                    key={ref.fullPath}
                    className="card"
                    style={{
                      borderLeft: '3px solid var(--color-warning)',
                    }}
                  >
                    <div className="card-body d-flex align-items-center justify-content-between py-3">
                      <div className="d-flex align-items-center">
                        <i
                          className="bi bi-folder-fill me-3"
                          style={{ fontSize: '1.5rem', color: 'var(--color-warning)' }}
                        ></i>
                        <span className="fw-semibold">{ref.name}/</span>
                      </div>
                      <div className="d-flex gap-2">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => toggleFolderExpansion(ref)}
                          title={expandedFolders.has(ref.fullPath) ? 'Collapse folder' : 'Expand folder'}
                        >
                          <i className={`bi bi-chevron-${expandedFolders.has(ref.fullPath) ? 'up' : 'down'} me-1`}></i>
                          {expandedFolders.has(ref.fullPath) ? 'Collapse' : 'Browse'}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleFolderDownload(ref)}
                          style={{
                            backgroundColor: 'var(--color-primary)',
                            borderColor: 'var(--color-primary)',
                            color: 'white',
                          }}
                        >
                          <i className="bi bi-file-zip me-1"></i>
                          Download ZIP
                        </Button>
                      </div>
                    </div>
                    {/* Expandable folder contents */}
                    {expandedFolders.has(ref.fullPath) && (
                      <div className="card-footer p-0">
                        {folderContents[ref.fullPath]?.loading && (
                          <div className="text-center py-3">
                            <Spinner animation="border" size="sm" />
                            <span className="ms-2">Loading folder contents...</span>
                          </div>
                        )}
                        {folderContents[ref.fullPath]?.error && (
                          <div className="p-3">
                            <div className="alert alert-warning mb-0">{folderContents[ref.fullPath].error}</div>
                          </div>
                        )}
                        {!folderContents[ref.fullPath]?.loading &&
                          !folderContents[ref.fullPath]?.error &&
                          folderContents[ref.fullPath]?.s3Keys.length > 0 && (
                            <FileTreeTable
                              rows={flattenRows(
                                buildRowsForTree(
                                  buildFileTree(
                                    folderContents[ref.fullPath].s3Keys.map((relKey) => ({
                                      Key: relKey,
                                      LastModified: new Date(),
                                      Size: 0,
                                    })),
                                  ),
                                  0,
                                  '',
                                ),
                                expandedTreeFolders[ref.fullPath] || new Set(),
                              )}
                              expandedFolders={expandedTreeFolders[ref.fullPath] || new Set()}
                              onToggleFolder={(folderId) => toggleTreeFolder(ref.fullPath, folderId)}
                              showDateColumn={false}
                              showSizeColumn={false}
                              enableDownload={true}
                              s3Bucket={bucket}
                              region={region}
                              getCredentials={getCredentials}
                              getFullS3Key={(row) => `${ref.fullPath}/${row.originalKey || row.id}`}
                              compact={true}
                            />
                          )}
                      </div>
                    )}
                  </div>
                ))}
                {/* Render files */}
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Execution Trace Section */}
      <TraceViewer traceS3Key={constructTraceFilePath(baseS3Key)} bucket={bucket} region={region} />
    </div>
  );
};

// Helper function to construct trace file path from base S3 key
const constructTraceFilePath = (baseS3Key: string): string => {
  // baseS3Key example: "nolia/{userId}/{jobId}/outputs/results-timestamp.md"
  // Extract the prefix (app/user/job) and append trace/trace.jsonl
  const pathParts = baseS3Key.split('/');
  const prefix = pathParts.slice(0, -2).join('/'); // Remove "outputs/results-timestamp.md"
  return `${prefix}/trace/trace.jsonl`;
};
