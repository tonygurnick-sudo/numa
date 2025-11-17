import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Spinner, Button, Dropdown, Accordion } from 'react-bootstrap';
import * as Papa from 'papaparse';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { getFileIconClass } from '../../utils/fileUtils';
import { downloadFileFromS3, downloadFolderAsZip, listObjectsInFolder } from '../../utils/s3Utils';
import { buildFileTree, buildRowsForTree, flattenRows } from '../../utils/fileTreeUtils';
import { MarkdownContent } from './MarkdownContent';
import { ResultActions } from '../ResultActions';
import { TraceViewer } from './ClaudeCodeTraceViewer';
import { FollowUpModal } from '../FollowUpModal';
import { FileTreeTable } from '../FileTreeTable';
import numaLogo from '/numa-logo.svg?url';

interface DataAnalysisMarkdownProps {
  content: string;
  baseS3Key: string; // e.g., "data-analysis/{userId}/{jobId}/outputs/results.md"
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

interface ConversationMessage {
  id: string;
  ts: string;
  role: 'user' | 'assistant';
  textMd: string;
}

export const DataAnalysisMarkdown: React.FC<DataAnalysisMarkdownProps> = ({ content, baseS3Key, bucket, region }) => {
  const { getCredentials } = useAuth();
  const { fetchS3Content, startFollowUp } = useNumaApp();
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  // Folder state
  const [folderContents, setFolderContents] = useState<Record<string, FolderContents>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedTreeFolders, setExpandedTreeFolders] = useState<Record<string, Set<string>>>({});

  // Conversation state
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(true);

  // Follow-up modal state
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);

  // Extract job_id from baseS3Key
  // baseS3Key format: "data-analysis/{userId}/{jobId}/outputs/results-timestamp.md"
  const jobId = useMemo(() => {
    const parts = baseS3Key.split('/');
    return parts[2]; // job_id is the 3rd segment (index 2)
  }, [baseS3Key]);

  // Derive the S3 outputs/ prefix from the base key
  // baseS3Key example: data-analysis/{userId}/{jobId}/outputs/<anything>
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

  // Parse file references present in a single message
  const parseFileReferencesInMessage = (messageText: string): FileReference[] => {
    const refs: FileReference[] = [];

    // New format: <file:path>
    const fileTagPattern = /<file:([^>]+)>/gi;
    let match: RegExpExecArray | null;
    while ((match = fileTagPattern.exec(messageText)) !== null) {
      const rel = normalizeRelativePath(match[1]);
      const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
      const filename = rel.split('/').pop() || rel;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      refs.push({ filename, fullPath, relativePath: rel, extension });
    }

    // Back-compat: old format <filename.ext>
    const oldAnglePattern = /<([^>]+\.\w+)>/g;
    while ((match = oldAnglePattern.exec(messageText)) !== null) {
      const rel = normalizeRelativePath(match[1]);
      const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
      const filename = rel.split('/').pop() || rel;
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      refs.push({ filename, fullPath, relativePath: rel, extension });
    }

    // Optional: [text](file:path) or [text](filename.ext)
    const linkPattern = /\[[^\]]*\]\((?:file:)?([^\s)]+)\)/gi;
    while ((match = linkPattern.exec(messageText)) !== null) {
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

  // Parse folder references present in a single message
  const parseFolderReferencesInMessage = (messageText: string): FolderReference[] => {
    const refs: FolderReference[] = [];

    // Format: <folder:path>
    const folderTagPattern = /<folder:([^>]+)>/gi;
    let match: RegExpExecArray | null;
    while ((match = folderTagPattern.exec(messageText)) !== null) {
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

  // Extract folder references from all assistant messages in conversation
  const folderReferences = useMemo(() => {
    const merged: Record<string, FolderReference> = {};
    conversationMessages
      .filter((msg) => msg.role === 'assistant')
      .forEach((msg) => {
        parseFolderReferencesInMessage(msg.textMd).forEach((ref) => {
          if (!merged[ref.fullPath]) merged[ref.fullPath] = ref;
        });
      });
    const allRefs = Object.values(merged);

    // Filter out folders that are children of other referenced folders
    // This prevents showing nested folders at the top level in Generated Files
    return allRefs.filter((ref) => {
      const isChildOfAnother = allRefs.some(
        (other) => other.fullPath !== ref.fullPath && ref.fullPath.startsWith(other.fullPath + '/'),
      );
      return !isChildOfAnother;
    });
  }, [conversationMessages, baseS3Key]);

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

  // Extract file references from all assistant messages in conversation
  const fileReferences = useMemo(() => {
    const merged: Record<string, FileReference> = {};
    conversationMessages
      .filter((msg) => msg.role === 'assistant')
      .forEach((msg) => {
        parseFileReferencesInMessage(msg.textMd).forEach((ref) => {
          if (!merged[ref.fullPath]) merged[ref.fullPath] = ref;
        });
      });
    const allFileRefs = Object.values(merged);

    // Filter out files that are inside referenced folders
    // This prevents showing nested files at the top level in Generated Files
    return allFileRefs.filter((fileRef) => {
      const isInsideReferencedFolder = folderReferences.some((folderRef) =>
        fileRef.fullPath.startsWith(folderRef.fullPath + '/'),
      );
      return !isInsideReferencedFolder;
    });
  }, [conversationMessages, baseS3Key, folderReferences]);

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

  // Load conversation.json to display full conversation history
  useEffect(() => {
    const loadConversation = async () => {
      try {
        setLoadingConversation(true);

        // Extract userId and jobId from baseS3Key
        // baseS3Key format: "data-analysis/{userId}/{jobId}/outputs/results-timestamp.md"
        const parts = baseS3Key.split('/');
        const userId = parts[1];
        const jobIdFromPath = parts[2];

        const conversationPath = `data-analysis/${userId}/${jobIdFromPath}/history/conversation.json`;

        const credentials = await getCredentials();
        if (!credentials) {
          throw new Error('Failed to get credentials');
        }

        const conversationContent = await fetchS3Content(bucket, conversationPath, credentials);
        const conversationData = JSON.parse(conversationContent);

        if (conversationData.messages && Array.isArray(conversationData.messages)) {
          setConversationMessages(conversationData.messages);
        } else {
          // Fallback to single message with content prop
          setConversationMessages([
            {
              id: 'fallback',
              ts: new Date().toISOString(),
              role: 'assistant',
              textMd: content,
            },
          ]);
        }
      } catch (err) {
        console.error('Error loading conversation:', err);
        // Fallback to single message with content prop
        setConversationMessages([
          {
            id: 'fallback',
            ts: new Date().toISOString(),
            role: 'assistant',
            textMd: content,
          },
        ]);
      } finally {
        setLoadingConversation(false);
      }
    };

    loadConversation();
  }, [baseS3Key, bucket, content, fetchS3Content, getCredentials]);

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

  // Handle follow-up modal submit
  const handleFollowUpSubmit = async (prompt: string) => {
    if (!startFollowUp) {
      console.error('startFollowUp not available from NumaAppProvider');
      return;
    }

    try {
      setIsSubmittingFollowUp(true);
      setShowFollowUpModal(false);

      // Call startFollowUp with the same jobId and new prompt
      await startFollowUp(jobId, prompt);

      // Note: The page will navigate/refresh when the new run starts,
      // so we don't need to handle state cleanup here
    } catch (err) {
      console.error('Error submitting follow-up:', err);
      setIsSubmittingFollowUp(false);
      // Could show an error notification here
    }
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
        className="file-reference-container mb-4 bg-white border rounded"
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

  // Render folder reference with expandable tree
  const renderFolderReference = (ref: FolderReference) => {
    const key = ref.fullPath;
    const isExpanded = expandedFolders.has(key);
    const contents = folderContents[key];
    const treeExpanded = expandedTreeFolders[key] || new Set();

    // Build tree from S3 keys and flatten based on current expansion state
    const displayRows = (() => {
      if (!contents?.s3Keys.length) return [];
      // Build tree structure from S3 keys - this properly identifies folders
      const s3Objects = contents.s3Keys.map((relKey) => ({
        Key: relKey,
        LastModified: new Date(),
        Size: 0,
      }));
      const tree = buildFileTree(s3Objects);
      const nestedRows = buildRowsForTree(tree, 0, '');
      return flattenRows(nestedRows, treeExpanded);
    })();

    return (
      <div key={key} className="inline-folder-reference mb-4">
        <div className="folder-header">
          <div className="folder-title">
            <i className="bi bi-folder-fill"></i>
            <span>{ref.name}</span>
          </div>
          <div className="folder-actions">
            <Button
              variant="outline-primary"
              size="sm"
              onClick={() => toggleFolderExpansion(ref)}
              title={isExpanded ? 'Collapse folder' : 'Expand folder'}
            >
              <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} me-1`}></i>
              {isExpanded ? 'Collapse' : 'Expand'}
            </Button>
            <Button
              variant="outline-success"
              size="sm"
              onClick={() => handleFolderDownload(ref)}
              title="Download as ZIP"
            >
              <i className="bi bi-file-zip me-1"></i>
              Download ZIP
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="folder-content">
            {contents?.loading && (
              <div className="folder-loading">
                <Spinner animation="border" size="sm" />
                <span className="ms-2">Loading folder contents...</span>
              </div>
            )}

            {contents?.error && (
              <div className="p-3">
                <div className="alert alert-warning mb-0">{contents.error}</div>
              </div>
            )}

            {!contents?.loading && !contents?.error && displayRows.length === 0 && (
              <div className="folder-empty">No files found in this folder</div>
            )}

            {!contents?.loading && !contents?.error && displayRows.length > 0 && (
              <FileTreeTable
                rows={displayRows}
                expandedFolders={treeExpanded}
                onToggleFolder={(folderId) => toggleTreeFolder(key, folderId)}
                showDateColumn={false}
                showSizeColumn={false}
                enableDownload={true}
                s3Bucket={bucket}
                region={region}
                getCredentials={getCredentials}
                getFullS3Key={(row) => `${key}/${row.originalKey || row.id}`}
                compact={true}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  // Helper function to split message content into sections with file and folder references
  const createContentSections = (
    messageText: string,
  ): Array<{
    type: 'markdown' | 'file' | 'folder';
    content: string;
    fileRef?: FileReference;
    folderRef?: FolderReference;
  }> => {
    const sections: Array<{
      type: 'markdown' | 'file' | 'folder';
      content: string;
      fileRef?: FileReference;
      folderRef?: FolderReference;
    }> = [];

    // Match both file and folder tags
    const splitPattern = /<(?:file:([^>]+)|folder:([^>]+)|([^>]+\.[a-zA-Z0-9]+))>/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = splitPattern.exec(messageText)) !== null) {
      const matchStart = m.index;
      const matchEnd = splitPattern.lastIndex;

      // Push markdown before this tag
      const before = messageText.substring(lastIndex, matchStart);
      if (before) sections.push({ type: 'markdown', content: before + '' });

      // Check if this is a folder or file reference
      if (m[2]) {
        // Folder reference: <folder:path>
        let rel = normalizeRelativePath(m[2]);
        rel = rel.replace(/\/+$/, ''); // Remove trailing slashes
        const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
        const name = rel.split('/').pop() || rel;
        const folderRef: FolderReference = { name, fullPath, relativePath: rel };

        // Replace the tag in text with code-wrapped folder name for readability
        const codeWrappedName = `\`${name}/\``;
        sections.push({ type: 'markdown', content: codeWrappedName });
        sections.push({ type: 'folder', content: '', folderRef });
      } else {
        // File reference: <file:path> or <filename.ext>
        const rawPath = m[1] || m[3] || '';
        const rel = normalizeRelativePath(rawPath);
        const fullPath = buildS3KeyForRelativePath(rel, baseS3Key);
        const filename = rel.split('/').pop() || rel;
        const extension = filename.split('.').pop()?.toLowerCase() || '';
        const ref: FileReference = { filename, fullPath, relativePath: rel, extension };

        // Replace the tag in text with code-wrapped filename for readability
        const codeWrappedFilename = `\`${filename}\``;
        sections.push({ type: 'markdown', content: codeWrappedFilename });
        sections.push({ type: 'file', content: '', fileRef: ref });
      }

      lastIndex = matchEnd;
    }

    // Add any remaining markdown content
    const tail = messageText.substring(lastIndex);
    if (tail.trim()) sections.push({ type: 'markdown', content: tail });

    return sections.length ? sections : [{ type: 'markdown', content: messageText }];
  };

  // Render a single conversation message
  // Render a user message (always visible, not collapsible)
  const renderUserMessage = (message: ConversationMessage) => {
    return (
      <div key={message.id} className="message user-message mb-3">
        <div className="d-flex align-items-center mb-2">
          <span className="fw-semibold me-2">You</span>
          <span className="text-muted small">{new Date(message.ts).toLocaleString()}</span>
        </div>
        <div className="user-message-bubble rounded p-3">
          <MarkdownContent content={message.textMd} />
        </div>
      </div>
    );
  };

  // Render an assistant message (collapsible accordion)
  const renderAssistantMessage = (message: ConversationMessage, index: number, isLastAssistant: boolean) => {
    const sections = createContentSections(message.textMd);
    const eventKey = `assistant-${index}`;

    return (
      <Accordion
        key={message.id}
        className="assistant-message-accordion mb-3"
        defaultActiveKey={isLastAssistant ? eventKey : undefined}
      >
        <Accordion.Item eventKey={eventKey}>
          <Accordion.Header>
            <div className="d-flex align-items-center w-100">
              <div className="flex-shrink-0 me-2">
                <img src={numaLogo} alt="Numa" style={{ width: '24px', height: '24px' }} />
              </div>
              <div className="flex-grow-1 me-2">
                <span className="fw-semibold">Numa</span>
                <span className="text-muted small ms-2">{new Date(message.ts).toLocaleString()}</span>
                <span className="expand-hint text-muted small ms-3">
                  <i className="bi bi-chevron-down me-1"></i>
                  Click to expand and see full response
                </span>
              </div>
            </div>
          </Accordion.Header>
          <Accordion.Body>
            <div className="assistant-message-content markdown-body">
              {sections.map((section, sectionIndex) => {
                if (section.type === 'markdown') {
                  return (
                    <ReactMarkdown key={`md-${index}-${sectionIndex}`} remarkPlugins={[remarkGfm]}>
                      {section.content}
                    </ReactMarkdown>
                  );
                } else if (section.type === 'file' && section.fileRef) {
                  return <div key={`file-${index}-${sectionIndex}`}>{renderFileReference(section.fileRef)}</div>;
                } else if (section.type === 'folder' && section.folderRef) {
                  return <div key={`folder-${index}-${sectionIndex}`}>{renderFolderReference(section.folderRef)}</div>;
                }
                return null;
              })}
            </div>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    );
  };

  return (
    <div className="data-analysis-markdown">
      {/* Loading state */}
      {loadingConversation ? (
        <div className="text-center py-5">
          <Spinner animation="border" role="status" variant="primary">
            <span className="visually-hidden">Loading conversation...</span>
          </Spinner>
          <p className="text-muted mt-3">Loading conversation history...</p>
        </div>
      ) : (
        <>
          {/* Render all conversation messages */}
          <div className="conversation-messages">
            {(() => {
              // Find the index of the last assistant message
              const lastAssistantIndex = conversationMessages.reduce(
                (lastIdx, msg, idx) => (msg.role === 'assistant' ? idx : lastIdx),
                -1,
              );

              return conversationMessages.map((message, index) => {
                if (message.role === 'user') {
                  return renderUserMessage(message);
                } else {
                  const isLastAssistant = index === lastAssistantIndex;
                  return renderAssistantMessage(message, index, isLastAssistant);
                }
              });
            })()}
          </div>
        </>
      )}

      {/* Ask Follow-Up Question Section */}
      {!loadingConversation && conversationMessages.length > 0 && (
        <div className="follow-up-button-container">
          <div className="border-top">
            <div className="text-center">
              <h5 className="follow-up-header mb-3">
                <i className="bi bi-chat-dots me-2"></i>
                Have more questions about this analysis?
              </h5>
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setShowFollowUpModal(true)}
              disabled={isSubmittingFollowUp}
              className="btn-follow-up w-100"
            >
              <i className="bi bi-plus-circle me-2"></i>
              Ask Follow-Up Question
            </Button>

            {/* Document Actions below */}
            <div className="d-flex justify-content-center gap-3 mt-4">
              <ResultActions
                content={conversationMessages[conversationMessages.length - 1]?.textMd || ''}
                title="Data Analysis Results"
                appType="data-analysis"
              />
            </div>
          </div>
        </div>
      )}

      {/* Follow-Up Modal */}
      <FollowUpModal
        show={showFollowUpModal}
        onHide={() => setShowFollowUpModal(false)}
        onSubmit={handleFollowUpSubmit}
        isLoading={isSubmittingFollowUp}
      />

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
    // Use papaparse to correctly handle CSV with quoted fields, commas, and newlines
    const result = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false, // Keep all values as strings
    });

    if (result.errors.length > 0) {
      console.warn('CSV parsing errors:', result.errors);
    }

    const headers = result.meta.fields || [];
    const totalRows = result.data.length;
    const rows = result.data
      .slice(0, 100)
      .map((row: Record<string, string>) => headers.map((header) => row[header] || ''));

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
                  <td
                    key={cellIdx}
                    style={{
                      whiteSpace: 'pre-wrap',
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {cell}
                  </td>
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
