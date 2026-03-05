import { useState, useEffect, useCallback } from 'react';
import { Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { listFolder } from '../../Services/filesService';
import type { FileScope, FolderItem } from '../../Services/filesService';

interface MoveFileModalProps {
  show: boolean;
  scope: FileScope;
  onClose: () => void;
  onMove: (destinationPath: string) => void;
}

interface FolderNode {
  folder: FolderItem;
  children: FolderNode[] | null; // null = not loaded yet
  loading: boolean;
}

const MoveFileModal = ({ show, scope, onClose, onMove }: MoveFileModalProps) => {
  const { t } = useTranslation('files');
  const [rootFolders, setRootFolders] = useState<FolderNode[]>([]);
  const [rootLoading, setRootLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState('/');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Load root folders on open
  useEffect(() => {
    if (!show) return;
    setSelectedPath('/');
    setExpandedPaths(new Set());
    loadChildren('/');
  }, [show, scope]);

  const loadChildren = useCallback(
    async (path: string) => {
      if (path === '/') {
        setRootLoading(true);
        try {
          const contents = await listFolder(scope, '/');
          setRootFolders(contents.folders.map((f) => ({ folder: f, children: null, loading: false })));
        } catch {
          setRootFolders([]);
        } finally {
          setRootLoading(false);
        }
        return;
      }

      // Mark node as loading
      setRootFolders((prev) => updateNodeLoading(prev, path, true));

      try {
        const contents = await listFolder(scope, path);
        const childNodes = contents.folders.map((f) => ({
          folder: f,
          children: null as FolderNode[] | null,
          loading: false,
        }));
        setRootFolders((prev) => updateNodeChildren(prev, path, childNodes));
      } catch {
        setRootFolders((prev) => updateNodeChildren(prev, path, []));
      }
    },
    [scope]
  );

  const toggleExpand = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          // Load children if not yet loaded
          const node = findNode(rootFolders, path);
          if (node && node.children === null) {
            loadChildren(path);
          }
        }
        return next;
      });
    },
    [rootFolders, loadChildren]
  );

  return (
    <Modal show={show} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('moveModal.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small mb-2">{t('moveModal.destination')}</p>
        <div
          style={{
            border: '1px solid #dee2e6',
            borderRadius: 6,
            maxHeight: 300,
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {/* Root folder option */}
          <FolderRow
            label={t('moveModal.root')}
            icon="bi-house"
            depth={0}
            selected={selectedPath === '/'}
            expanded={true}
            onClick={() => setSelectedPath('/')}
            onToggle={() => {}}
          />

          {rootLoading ? (
            <div className="text-center py-3">
              <span className="spinner-border spinner-border-sm text-secondary" />
              <span className="ms-2 text-muted small">{t('moveModal.loading')}</span>
            </div>
          ) : (
            rootFolders.map((node) => (
              <FolderTreeNode
                key={node.folder.path}
                node={node}
                depth={1}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onSelect={setSelectedPath}
                onToggle={toggleExpand}
              />
            ))
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button className="btn btn-secondary" onClick={onClose}>
          {t('moveModal.cancel')}
        </button>
        <button className="btn btn-primary" onClick={() => onMove(selectedPath)}>
          {t('moveModal.move')}
        </button>
      </Modal.Footer>
    </Modal>
  );
};

// ─── Tree rendering ──────────────────────────────────────────────────────────

interface FolderTreeNodeProps {
  node: FolderNode;
  depth: number;
  selectedPath: string;
  expandedPaths: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

const FolderTreeNode = ({ node, depth, selectedPath, expandedPaths, onSelect, onToggle }: FolderTreeNodeProps) => {
  const expanded = expandedPaths.has(node.folder.path);

  return (
    <>
      <FolderRow
        label={node.folder.name}
        icon={expanded ? 'bi-folder2-open' : 'bi-folder2'}
        depth={depth}
        selected={selectedPath === node.folder.path}
        expanded={expanded}
        loading={node.loading}
        onClick={() => onSelect(node.folder.path)}
        onToggle={() => onToggle(node.folder.path)}
      />
      {expanded &&
        node.children &&
        node.children.length > 0 &&
        node.children.map((child) => (
          <FolderTreeNode
            key={child.folder.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  );
};

interface FolderRowProps {
  label: string;
  icon: string;
  depth: number;
  selected: boolean;
  expanded: boolean;
  loading?: boolean;
  onClick: () => void;
  onToggle: () => void;
}

const FolderRow = ({ label, icon, depth, selected, expanded, loading, onClick, onToggle }: FolderRowProps) => (
  <div
    role="treeitem"
    aria-selected={selected}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      paddingLeft: 8 + depth * 20,
      borderRadius: 4,
      cursor: 'pointer',
      backgroundColor: selected ? '#e7f1ff' : 'transparent',
      fontWeight: selected ? 600 : 400,
    }}
    onClick={onClick}
    onMouseEnter={(e) => {
      if (!selected) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f8f9fa';
    }}
    onMouseLeave={(e) => {
      if (!selected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
    }}
  >
    <span
      style={{ width: 16, textAlign: 'center', flexShrink: 0 }}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {loading ? (
        <span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} />
      ) : (
        <i className={`bi ${expanded ? 'bi-chevron-down' : 'bi-chevron-right'} small`} />
      )}
    </span>
    <i className={`bi ${icon}`} style={{ color: '#ffc107' }} />
    <span className="text-truncate" style={{ fontSize: 13 }}>
      {label}
    </span>
  </div>
);

// ─── Tree helpers ────────────────────────────────────────────────────────────

const findNode = (nodes: FolderNode[], path: string): FolderNode | null => {
  for (const n of nodes) {
    if (n.folder.path === path) return n;
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
};

const updateNodeLoading = (nodes: FolderNode[], path: string, loading: boolean): FolderNode[] =>
  nodes.map((n) => {
    if (n.folder.path === path) return { ...n, loading };
    if (n.children) return { ...n, children: updateNodeLoading(n.children, path, loading) };
    return n;
  });

const updateNodeChildren = (nodes: FolderNode[], path: string, children: FolderNode[]): FolderNode[] =>
  nodes.map((n) => {
    if (n.folder.path === path) return { ...n, children, loading: false };
    if (n.children) return { ...n, children: updateNodeChildren(n.children, path, children) };
    return n;
  });

export default MoveFileModal;
