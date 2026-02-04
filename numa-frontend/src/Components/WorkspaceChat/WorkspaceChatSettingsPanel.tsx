import React, { useState, useMemo, Dispatch, SetStateAction } from 'react';
import { Button, Form, Spinner, Collapse } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Search, Robot } from 'react-bootstrap-icons';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../config/integrationsConfig';
import { getFileIconClass, formatFileSize } from '../../utils/fileUtils';
import type { WorkspaceChatFileInfo } from '../../types/workspaceChatTypes';

// =============================================================================
// FILE TREE TYPES AND HELPERS
// =============================================================================

/** Represents a node in the file tree (either a folder or a file) */
interface FileTreeNode {
  name: string;
  isFolder: boolean;
  children: FileTreeNode[];
  file?: WorkspaceChatFileInfo; // Only for leaf nodes (files)
}

/** Internal type for building the tree */
interface TreeBuildNode extends FileTreeNode {
  _childMap?: Record<string, TreeBuildNode>;
}

/**
 * Build a tree structure from a flat list of files.
 *
 * E.g., ["uploads/a/b.pdf", "uploads/a/c.pdf"] becomes:
 * [{ name: "a", isFolder: true, children: [
 *   { name: "b.pdf", isFolder: false, file: {...} },
 *   { name: "c.pdf", isFolder: false, file: {...} }
 * ]}]
 *
 * @param files - Flat list of files with paths
 * @param rootPrefix - Prefix to strip from paths (e.g., "uploads/", "session/")
 * @returns Array of tree nodes representing the folder structure
 */
function buildFileTree(files: WorkspaceChatFileInfo[], rootPrefix: string): FileTreeNode[] {
  const root: Record<string, TreeBuildNode> = {};

  for (const file of files) {
    // Remove the root prefix (e.g., "uploads/" or "session/")
    const relativePath = file.path.startsWith(rootPrefix) ? file.path.slice(rootPrefix.length) : file.path;

    const parts = relativePath.split('/').filter((p) => p.length > 0);

    // Navigate/build the tree structure
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (!currentLevel[part]) {
        currentLevel[part] = {
          name: part,
          isFolder: !isLast,
          children: [],
          file: isLast ? file : undefined,
          _childMap: isLast ? undefined : {},
        };
      }

      if (!isLast) {
        // Navigate into this folder's children
        const node = currentLevel[part];
        if (!node._childMap) {
          node._childMap = {};
        }
        currentLevel = node._childMap;
      }
    }
  }

  // Convert the nested map structure to arrays
  function convertToArray(level: Record<string, TreeBuildNode>): FileTreeNode[] {
    return Object.values(level)
      .map((node) => {
        const result: FileTreeNode = {
          name: node.name,
          isFolder: node.isFolder,
          children: node._childMap ? convertToArray(node._childMap) : [],
          file: node.file,
        };
        return result;
      })
      .sort((a, b) => {
        // Sort folders first, then alphabetically
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  return convertToArray(root);
}

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
  role?: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
};

export interface WorkspaceChatSettingsPanelProps {
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Whether this is a new chat (no conversation started yet) - hides file sections */
  isNewChat?: boolean;

  // Files
  /** Files in the uploads folder */
  uploadsFiles: WorkspaceChatFileInfo[];
  /** Files in the session folder */
  sessionFiles: WorkspaceChatFileInfo[];
  /** Whether files are loading */
  filesLoading: boolean;
  /** Error loading files */
  filesError?: string | null;
  /** Refresh file list */
  onRefreshFiles: () => void;
  /** Open a file preview */
  onOpenFile?: (file: WorkspaceChatFileInfo) => void;
  /** Download a file */
  onDownloadFile?: (file: WorkspaceChatFileInfo) => void;

  // Tools
  autoToolsEnabled: boolean;
  setAutoToolsEnabled: Dispatch<SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  createAgentEnabled: boolean;
  setCreateAgentEnabled: Dispatch<SetStateAction<boolean>>;
  agentsFeatureEnabled: boolean;

  // Knowledge Bases
  enabledKBIds: string[];
  setEnabledKBIds: Dispatch<SetStateAction<string[]>>;
  availableKBs: KnowledgeBase[];
  isLoadingKBs: boolean;

  // Integrations
  enabledConnections: string[];
  setEnabledConnections: Dispatch<SetStateAction<string[]>>;
  availableConnections: ConnectionOption[];
  connectionsLoading: boolean;
  hasPipedreamFeature: boolean;

  // Control disabled state (during streaming)
  isDisabled: boolean;
}

/**
 * Right-side settings panel for Workspace Chat V2.
 *
 * Consolidates:
 * - Chat Uploads (user uploaded files)
 * - Session Files (Claude-generated files)
 * - Settings (KB, tools, integrations toggles)
 */
export const WorkspaceChatSettingsPanel: React.FC<WorkspaceChatSettingsPanelProps> = ({
  isOpen,
  isNewChat = false,
  uploadsFiles,
  sessionFiles,
  filesLoading,
  filesError,
  onRefreshFiles,
  onOpenFile,
  onDownloadFile,
  autoToolsEnabled,
  setAutoToolsEnabled,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
  agentsFeatureEnabled,
  enabledKBIds,
  setEnabledKBIds,
  availableKBs,
  isLoadingKBs,
  enabledConnections,
  setEnabledConnections,
  availableConnections,
  connectionsLoading,
  hasPipedreamFeature,
  isDisabled,
}) => {
  const { t } = useTranslation('chat');
  // Section collapse states
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);

  // Connected integrations only
  const connectedIntegrations = availableConnections.filter((conn) => conn.isConnected);

  // Handlers
  const handleKBToggle = (kbId: string, checked: boolean) => {
    if (checked) {
      setEnabledKBIds((prev) => [...prev, kbId]);
    } else {
      setEnabledKBIds((prev) => prev.filter((id) => id !== kbId));
    }
  };

  const handleIntegrationToggle = (connectionId: string, checked: boolean) => {
    if (checked) {
      setEnabledConnections((prev) => [...prev, connectionId]);
    } else {
      setEnabledConnections((prev) => prev.filter((id) => id !== connectionId));
    }
  };

  const handleAutoToolsToggle = (checked: boolean) => {
    setAutoToolsEnabled(checked);
    if (checked) {
      setWebSearchEnabled(true);
      if (agentsFeatureEnabled) {
        setCreateAgentEnabled(true);
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="workspace-chat-settings-panel">
      <div className="workspace-chat-settings-panel-body">
        {/* Files Section - only show when chat has started */}
        {!isNewChat && (
          <div className="panel-files-section">
            {/* Chat Uploads */}
            <div className="settings-section">
              <div className="section-header-row">
                <button
                  className="section-header"
                  onClick={() => setUploadsOpen(!uploadsOpen)}
                  aria-expanded={uploadsOpen}
                  type="button"
                >
                  <i className={`bi bi-chevron-${uploadsOpen ? 'down' : 'right'} me-2`}></i>
                  <i className="bi bi-upload me-2"></i>
                  <span>{t('workspaceSettings.chatUploads')}</span>
                  {uploadsFiles.length > 0 && <span className="badge bg-secondary ms-2">{uploadsFiles.length}</span>}
                </button>
                <Button
                  variant="link"
                  size="sm"
                  className="section-refresh-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshFiles();
                  }}
                  disabled={filesLoading}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <i className={`bi bi-arrow-clockwise ${filesLoading ? 'spinning' : ''}`}></i>
                </Button>
              </div>
              <Collapse in={uploadsOpen}>
                <div className="section-content">
                  {filesLoading ? (
                    <div className="text-muted small d-flex align-items-center gap-2 py-2">
                      <Spinner animation="border" size="sm" />
                      {t('workspaceSettings.loadingFiles')}
                    </div>
                  ) : filesError ? (
                    <div className="text-danger small py-2">
                      <i className="bi bi-exclamation-triangle me-1"></i>
                      {filesError}
                      <Button variant="link" size="sm" onClick={onRefreshFiles} className="ms-2 p-0">
                        {t('workspaceSettings.retry')}
                      </Button>
                    </div>
                  ) : uploadsFiles.length === 0 ? (
                    <div className="text-muted small fst-italic py-2">{t('workspaceSettings.noUploads')}</div>
                  ) : (
                    <FileTree
                      files={uploadsFiles}
                      rootPrefix="uploads/"
                      onOpen={onOpenFile}
                      onDownload={onDownloadFile}
                    />
                  )}
                </div>
              </Collapse>
            </div>

            {/* Session Files */}
            <div className="settings-section">
              <div className="section-header-row">
                <button
                  className="section-header"
                  onClick={() => setSessionOpen(!sessionOpen)}
                  aria-expanded={sessionOpen}
                  type="button"
                >
                  <i className={`bi bi-chevron-${sessionOpen ? 'down' : 'right'} me-2`}></i>
                  <i className="bi bi-file-earmark-code me-2"></i>
                  <span>{t('workspaceSettings.sessionFiles')}</span>
                  {sessionFiles.length > 0 && <span className="badge bg-secondary ms-2">{sessionFiles.length}</span>}
                </button>
                <Button
                  variant="link"
                  size="sm"
                  className="section-refresh-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshFiles();
                  }}
                  disabled={filesLoading}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <i className={`bi bi-arrow-clockwise ${filesLoading ? 'spinning' : ''}`}></i>
                </Button>
              </div>
              <Collapse in={sessionOpen}>
                <div className="section-content">
                  {filesLoading ? (
                    <div className="text-muted small d-flex align-items-center gap-2 py-2">
                      <Spinner animation="border" size="sm" />
                      {t('workspaceSettings.loadingFiles')}
                    </div>
                  ) : filesError ? (
                    <div className="text-danger small py-2">
                      <i className="bi bi-exclamation-triangle me-1"></i>
                      {filesError}
                    </div>
                  ) : sessionFiles.length === 0 ? (
                    <div className="text-muted small fst-italic py-2">{t('workspaceSettings.noSessionFiles')}</div>
                  ) : (
                    <FileTree
                      files={sessionFiles}
                      rootPrefix="session/"
                      onOpen={onOpenFile}
                      onDownload={onDownloadFile}
                    />
                  )}
                </div>
              </Collapse>
            </div>
          </div>
        )}

        {/* Settings Section - always visible, no collapse wrapper */}
        <div className="panel-settings-section">
          {/* Knowledge Bases */}
          <div className="settings-group">
            <button
              className="settings-group-header"
              onClick={() => setKbOpen(!kbOpen)}
              aria-expanded={kbOpen}
              type="button"
            >
              <i className={`bi bi-chevron-${kbOpen ? 'down' : 'right'} me-2 chevron-icon`}></i>
              <i className="bi bi-folder2-open me-2" />
              <span>{t('workspaceSettings.knowledgeBases')}</span>
              {!kbOpen && (
                <span className="settings-group-summary">
                  {enabledKBIds.length > 0
                    ? t('workspaceSettings.kbSelected', { count: enabledKBIds.length })
                    : t('workspaceSettings.noneSelected')}
                </span>
              )}
            </button>
            <Collapse in={kbOpen}>
              <div className="settings-group-content">
                <div className="settings-helper-text">{t('workspaceSettings.selectKBs')}</div>
                {isLoadingKBs ? (
                  <div className="text-muted small d-flex align-items-center gap-2">
                    <Spinner animation="border" size="sm" />
                    {t('workspaceSettings.loading')}
                  </div>
                ) : availableKBs.length === 0 ? (
                  <div className="text-muted small fst-italic">{t('workspaceSettings.noKBs')}</div>
                ) : (
                  <div className="kb-list">
                    {availableKBs.map((kb) => (
                      <Form.Check
                        key={kb.kb_id}
                        type="checkbox"
                        id={`panel-kb-${kb.kb_id}`}
                        label={
                          <span>
                            {kb.kb_name}
                            {kb.role && <span className="text-muted small ms-2">({kb.role.toLowerCase()})</span>}
                          </span>
                        }
                        checked={enabledKBIds.includes(kb.kb_id)}
                        onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                        disabled={isDisabled}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Collapse>
          </div>

          {/* Tools */}
          <div className="settings-group">
            <button
              className="settings-group-header"
              onClick={() => setToolsOpen(!toolsOpen)}
              aria-expanded={toolsOpen}
              type="button"
            >
              <i className={`bi bi-chevron-${toolsOpen ? 'down' : 'right'} me-2 chevron-icon`}></i>
              <i className="bi bi-tools me-2" />
              <span>{t('workspaceSettings.tools')}</span>
              {!toolsOpen && (
                <span className="settings-group-summary">
                  {autoToolsEnabled ? (
                    t('workspaceSettings.allToolsEnabledSummary')
                  ) : (
                    <span className="d-flex align-items-center gap-1">
                      {webSearchEnabled && <Search size={14} />}
                      {createAgentEnabled && agentsFeatureEnabled && <Robot size={14} />}
                      {!webSearchEnabled &&
                        !(createAgentEnabled && agentsFeatureEnabled) &&
                        t('workspaceSettings.noneEnabled')}
                    </span>
                  )}
                </span>
              )}
            </button>
            <Collapse in={toolsOpen}>
              <div className="settings-group-content">
                <div className="settings-helper-text">{t('workspaceSettings.toolsHelper')}</div>
                <div className="tools-list">
                  {/* All Tools toggle - master switch */}
                  <div className="tool-item all-tools-toggle">
                    <Form.Check
                      type="switch"
                      id="panel-auto-tools"
                      label=""
                      checked={autoToolsEnabled}
                      onChange={(e) => handleAutoToolsToggle(e.target.checked)}
                      disabled={isDisabled}
                    />
                    <div className="tool-info">
                      <span className="fw-semibold">{t('workspaceSettings.allTools')}</span>
                      <span className="text-muted small">{t('workspaceSettings.allToolsHelper')}</span>
                    </div>
                  </div>

                  {/* Individual tools as checkboxes */}
                  <Form.Check
                    type="checkbox"
                    id="panel-web-search"
                    checked={webSearchEnabled}
                    onChange={(e) => setWebSearchEnabled(e.target.checked)}
                    disabled={isDisabled || autoToolsEnabled}
                    label={
                      <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                        <Search size={14} />
                        {t('workspaceSettings.webSearch')}
                      </span>
                    }
                  />

                  {agentsFeatureEnabled && (
                    <Form.Check
                      type="checkbox"
                      id="panel-create-agent"
                      checked={createAgentEnabled}
                      onChange={(e) => setCreateAgentEnabled(e.target.checked)}
                      disabled={isDisabled || autoToolsEnabled}
                      label={
                        <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                          <Robot size={14} />
                          {t('workspaceSettings.agentCreation')}
                        </span>
                      }
                    />
                  )}
                </div>
              </div>
            </Collapse>
          </div>

          {/* Integrations */}
          {hasPipedreamFeature && (
            <div className="settings-group">
              <button
                className="settings-group-header"
                onClick={() => setIntegrationsOpen(!integrationsOpen)}
                aria-expanded={integrationsOpen}
                type="button"
              >
                <i className={`bi bi-chevron-${integrationsOpen ? 'down' : 'right'} me-2 chevron-icon`}></i>
                <i className="bi bi-link-45deg me-2" />
                <span>{t('workspaceSettings.integrations')}</span>
                {!integrationsOpen && (
                  <span className="settings-group-summary">
                    {enabledConnections.length > 0 ? (
                      <span className="d-flex align-items-center gap-1">
                        {connectedIntegrations
                          .filter((conn) => enabledConnections.includes(conn.id))
                          .map((conn) => {
                            const iconSrc = getConnectionIcon(conn.id);
                            const fallbackIcon = getConnectionFallbackIcon(conn.id);
                            const displayName = getConnectionDisplayName(conn.id);
                            return iconSrc ? (
                              <img
                                key={conn.id}
                                src={iconSrc}
                                alt={displayName}
                                style={{ width: 16, height: 16, objectFit: 'contain' }}
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <i key={conn.id} className={fallbackIcon} style={{ fontSize: 14 }} />
                            );
                          })}
                      </span>
                    ) : (
                      t('workspaceSettings.noneEnabled')
                    )}
                  </span>
                )}
              </button>
              <Collapse in={integrationsOpen}>
                <div className="settings-group-content">
                  <div className="settings-helper-text">{t('workspaceSettings.integrationsHelper')}</div>
                  {connectionsLoading ? (
                    <div className="text-muted small d-flex align-items-center gap-2">
                      <Spinner animation="border" size="sm" />
                      {t('workspaceSettings.loading')}
                    </div>
                  ) : connectedIntegrations.length === 0 ? (
                    <div className="text-muted small fst-italic">
                      <i className="bi bi-info-circle me-1" />
                      {t('workspaceSettings.noIntegrations')}
                    </div>
                  ) : (
                    <div className="integrations-list">
                      {connectedIntegrations
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((conn) => {
                          const iconSrc = getConnectionIcon(conn.id);
                          const fallbackIcon = getConnectionFallbackIcon(conn.id);
                          const displayName = getConnectionDisplayName(conn.id);

                          return (
                            <Form.Check
                              key={conn.id}
                              type="checkbox"
                              id={`panel-integration-${conn.id}`}
                              label={
                                <span className="d-flex align-items-center gap-2">
                                  {iconSrc ? (
                                    <img
                                      src={iconSrc}
                                      alt={displayName}
                                      style={{ width: 18, height: 18, objectFit: 'contain' }}
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                  ) : (
                                    <i className={fallbackIcon} />
                                  )}
                                  {displayName}
                                </span>
                              }
                              checked={enabledConnections.includes(conn.id)}
                              onChange={(e) => handleIntegrationToggle(conn.id, e.target.checked)}
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              </Collapse>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// FILE TREE NODE COMPONENT
// =============================================================================

interface FileTreeNodeComponentProps {
  node: FileTreeNode;
  onOpen?: (file: WorkspaceChatFileInfo) => void;
  onDownload?: (file: WorkspaceChatFileInfo) => void;
  depth?: number;
}

/** Recursive component to render a file tree node */
const FileTreeNodeComponent: React.FC<FileTreeNodeComponentProps> = ({ node, onOpen, onDownload, depth = 0 }) => {
  const { t } = useTranslation('chat');
  // Auto-expand first level
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.isFolder) {
    return (
      <div className="file-tree-folder" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
        <button className="folder-header" onClick={() => setExpanded(!expanded)} type="button">
          <i className={`bi bi-chevron-${expanded ? 'down' : 'right'} me-1`}></i>
          <i className="bi bi-folder me-2 text-warning"></i>
          <span>{node.name}</span>
          <span className="folder-count text-muted ms-2">({node.children.length})</span>
        </button>
        {expanded && (
          <div className="folder-children">
            {node.children.map((child) => (
              <FileTreeNodeComponent
                key={child.name}
                node={child}
                onOpen={onOpen}
                onDownload={onDownload}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  const iconClass = getFileIconClass(node.name);
  return (
    <div className="file-tree-file" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <i className={iconClass + ' file-icon me-2'}></i>
      <span className="file-name" title={node.file?.path}>
        {node.name}
      </span>
      <span className="file-size text-muted ms-2">{node.file && formatFileSize(node.file.size)}</span>
      <div className="file-actions ms-auto">
        {onOpen && node.file && (
          <Button variant="link" size="sm" onClick={() => onOpen(node.file!)} title={t('workspaceSettings.preview')}>
            <i className="bi bi-eye"></i>
          </Button>
        )}
        {onDownload && node.file && (
          <Button
            variant="link"
            size="sm"
            onClick={() => onDownload(node.file!)}
            title={t('workspaceSettings.download')}
          >
            <i className="bi bi-download"></i>
          </Button>
        )}
      </div>
    </div>
  );
};

/** Wrapper component that renders a file tree from a flat file list */
interface FileTreeProps {
  files: WorkspaceChatFileInfo[];
  rootPrefix: string;
  onOpen?: (file: WorkspaceChatFileInfo) => void;
  onDownload?: (file: WorkspaceChatFileInfo) => void;
}

const FileTree: React.FC<FileTreeProps> = ({ files, rootPrefix, onOpen, onDownload }) => {
  const tree = useMemo(() => buildFileTree(files, rootPrefix), [files, rootPrefix]);

  if (tree.length === 0) {
    return null;
  }

  return (
    <div className="file-tree">
      {tree.map((node) => (
        <FileTreeNodeComponent key={node.name} node={node} onOpen={onOpen} onDownload={onDownload} />
      ))}
    </div>
  );
};

export default WorkspaceChatSettingsPanel;
