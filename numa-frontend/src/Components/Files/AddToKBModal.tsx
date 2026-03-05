import { useState, useEffect, useCallback } from 'react';
import { Modal, ProgressBar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import type { UserKB } from '../../Services/knowledgeBaseService';
import { listFoldersInKB, copyItemsToKB } from '../../utils/s3Utils';
import type { CopyItemsToKBProgress } from '../../utils/s3Utils';

interface AddToKBModalProps {
  show: boolean;
  sourceKeys: string[];
  sourceLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Folder tree helpers ────────────────────────────────────────────────────

interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
}

const buildFolderTree = (flatPaths: string[]): FolderNode[] => {
  const root: FolderNode[] = [];
  for (const path of flatPaths) {
    const parts = path.split('/');
    let nodes = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const fullPath = parts.slice(0, i + 1).join('/');
      let node = nodes.find((n) => n.path === fullPath);
      if (!node) {
        node = { path: fullPath, name: segment, children: [] };
        nodes.push(node);
      }
      nodes = node.children;
    }
  }
  return root;
};

// ─── Selection key helpers ──────────────────────────────────────────────────

interface KBSelection {
  kbId: string;
  folder: string; // '' for root
}

const selectionKey = (sel: KBSelection) => `${sel.kbId}::${sel.folder}`;

// ─── Main Component ─────────────────────────────────────────────────────────

const AddToKBModal = ({ show, sourceKeys, sourceLabel, onClose, onSuccess }: AddToKBModalProps) => {
  const { t } = useTranslation('files');
  const { getCredentials, user } = useAuth();

  // KB list state
  const [kbs, setKbs] = useState<UserKB[]>([]);
  const [kbsLoading, setKbsLoading] = useState(false);

  // Per-KB folder data
  const [kbFolders, setKbFolders] = useState<Record<string, FolderNode[] | null>>({});
  const [kbFoldersLoading, setKbFoldersLoading] = useState<Record<string, boolean>>({});

  // Expansion and selection
  const [expandedKbs, setExpandedKbs] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<KBSelection | null>(null);

  // Copy operation
  const [copying, setCopying] = useState(false);
  const [progress, setProgress] = useState<CopyItemsToKBProgress | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Load KBs on open
  useEffect(() => {
    if (!show) return;
    setSelected(null);
    setExpandedKbs(new Set());
    setKbFolders({});
    setKbFoldersLoading({});
    setCopying(false);
    setProgress(null);
    setCopyError(null);

    const loadKBs = async () => {
      setKbsLoading(true);
      try {
        const allKbs = await knowledgeBaseService.listUserKBs();
        // Filter to EDITOR/OWNER, pin Company KB first
        const writable = allKbs.filter((kb) => kb.role === 'EDITOR' || kb.role === 'OWNER');
        writable.sort((a, b) => {
          if (a.kb_id === 'company') return -1;
          if (b.kb_id === 'company') return 1;
          return (a.kb_name ?? '').localeCompare(b.kb_name ?? '');
        });
        setKbs(writable);
      } catch {
        setKbs([]);
      } finally {
        setKbsLoading(false);
      }
    };
    loadKBs();
  }, [show]);

  const loadFoldersForKB = useCallback(
    async (kbId: string) => {
      if (kbFolders[kbId] !== undefined) return; // already loaded or loading
      const bucket = sessionStorage.getItem('DATA_BUCKET') ?? '';
      const region = sessionStorage.getItem('REGION') ?? 'us-east-1';
      setKbFoldersLoading((prev) => ({ ...prev, [kbId]: true }));
      try {
        const folders = await listFoldersInKB(kbId, bucket, region, getCredentials);
        setKbFolders((prev) => ({ ...prev, [kbId]: buildFolderTree(folders) }));
      } catch {
        setKbFolders((prev) => ({ ...prev, [kbId]: [] }));
      } finally {
        setKbFoldersLoading((prev) => ({ ...prev, [kbId]: false }));
      }
    },
    [kbFolders, getCredentials]
  );

  const toggleKB = useCallback(
    (kbId: string) => {
      setExpandedKbs((prev) => {
        const next = new Set(prev);
        if (next.has(kbId)) {
          next.delete(kbId);
        } else {
          next.add(kbId);
          loadFoldersForKB(kbId);
        }
        return next;
      });
    },
    [loadFoldersForKB]
  );

  const buildKbPrefix = (kbId: string): string => {
    if (kbId === 'company') return 'documents/company/';
    const normalized = kbId.replace(/^kb-/, '');
    return `documents/kb-${normalized}/`;
  };

  const handleAdd = useCallback(async () => {
    if (!selected || sourceKeys.length === 0) return;
    setCopying(true);
    setCopyError(null);
    setProgress(null);

    const bucket = sessionStorage.getItem('DATA_BUCKET') ?? '';
    const region = sessionStorage.getItem('REGION') ?? 'us-east-1';
    const tenantId = sessionStorage.getItem('CLIENT_NAME') ?? '';
    const uploaderSub = user?.decoded_tokens?.idToken?.sub ?? '';
    const uploaderEmail = user?.decoded_tokens?.idToken?.email ?? '';

    try {
      await copyItemsToKB(
        sourceKeys,
        buildKbPrefix(selected.kbId),
        selected.folder,
        {
          bucket,
          region,
          kbId: selected.kbId,
          tenantId,
          uploaderSub,
          uploaderEmail,
          getCredentials,
        },
        setProgress
      );
      onSuccess();
    } catch (err) {
      setCopyError(String(err instanceof Error ? err.message : err));
    } finally {
      setCopying(false);
    }
  }, [selected, sourceKeys, user, getCredentials, onSuccess]);

  const isSelected = (kbId: string, folder: string) =>
    selected !== null && selectionKey(selected) === selectionKey({ kbId, folder });

  return (
    <Modal show={show} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('addToKBModal.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small mb-2">{t('addToKBModal.subtitle')}</p>
        <p className="small mb-2 fw-semibold">{sourceLabel}</p>

        <div
          style={{
            border: '1px solid #dee2e6',
            borderRadius: 6,
            maxHeight: 320,
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {kbsLoading ? (
            <div className="text-center py-3">
              <span className="spinner-border spinner-border-sm text-secondary" />
              <span className="ms-2 text-muted small">{t('addToKBModal.loadingKBs')}</span>
            </div>
          ) : kbs.length === 0 ? (
            <div className="text-center py-3 text-muted small">{t('addToKBModal.noKBs')}</div>
          ) : (
            kbs.map((kb) => {
              const expanded = expandedKbs.has(kb.kb_id);
              return (
                <div key={kb.kb_id}>
                  {/* KB row */}
                  <TreeRow
                    label={kb.kb_id === 'company' ? t('addToKBModal.companyKB') : kb.kb_name}
                    icon="bi-book"
                    badge={kb.kb_id === 'company' ? t('addToKBModal.sharedBadge') : undefined}
                    depth={0}
                    expanded={expanded}
                    selected={isSelected(kb.kb_id, '')}
                    loading={kbFoldersLoading[kb.kb_id]}
                    onClick={() => setSelected({ kbId: kb.kb_id, folder: '' })}
                    onToggle={() => toggleKB(kb.kb_id)}
                  />

                  {/* Subfolders */}
                  {expanded && kbFoldersLoading[kb.kb_id] && (
                    <div className="text-center py-2">
                      <span
                        className="spinner-border spinner-border-sm text-secondary"
                        style={{ width: 12, height: 12 }}
                      />
                      <span className="ms-2 text-muted" style={{ fontSize: 12 }}>
                        {t('addToKBModal.loadingFolders')}
                      </span>
                    </div>
                  )}
                  {expanded &&
                    !kbFoldersLoading[kb.kb_id] &&
                    kbFolders[kb.kb_id] &&
                    renderFolderNodes(kbFolders[kb.kb_id]!, kb.kb_id, 1)}
                </div>
              );
            })
          )}
        </div>

        {/* Progress */}
        {copying && progress && (
          <div className="mt-3">
            <ProgressBar
              now={progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}
              label={`${progress.completed}/${progress.total}`}
              animated
              striped
            />
            {progress.currentFile && <div className="text-muted small mt-1">{progress.currentFile}</div>}
          </div>
        )}

        {/* Error */}
        {copyError && (
          <div className="alert alert-danger mt-3 mb-0 small py-2">
            {t('addToKBModal.error')}: {copyError}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <button className="btn btn-secondary" onClick={onClose} disabled={copying}>
          {t('moveModal.cancel')}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleAdd}
          disabled={!selected || copying || sourceKeys.length === 0}
        >
          {copying ? (
            <>
              <span className="spinner-border spinner-border-sm me-1" />
              {t('addToKBModal.adding')}
            </>
          ) : (
            t('addToKBModal.addButton')
          )}
        </button>
      </Modal.Footer>
    </Modal>
  );

  function renderFolderNodes(nodes: FolderNode[], kbId: string, depth: number): React.ReactNode {
    return nodes.map((node) => (
      <div key={`${kbId}::${node.path}`}>
        <TreeRow
          label={node.name}
          icon="bi-folder2"
          depth={depth}
          expanded={false}
          selected={isSelected(kbId, node.path)}
          onClick={() => setSelected({ kbId, folder: node.path })}
          onToggle={() => {}}
        />
        {node.children.length > 0 && renderFolderNodes(node.children, kbId, depth + 1)}
      </div>
    ));
  }
};

// ─── Tree row sub-component ─────────────────────────────────────────────────

interface TreeRowProps {
  label: string;
  icon: string;
  badge?: string;
  depth: number;
  expanded: boolean;
  selected: boolean;
  loading?: boolean;
  onClick: () => void;
  onToggle: () => void;
}

const TreeRow = ({ label, icon, badge, depth, expanded, selected, loading, onClick, onToggle }: TreeRowProps) => (
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
    {/* Chevron / spinner for expandable rows */}
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
    <i className={`bi ${icon}`} style={{ color: icon === 'bi-book' ? '#6f42c1' : '#ffc107' }} />
    <span className="text-truncate" style={{ fontSize: 13 }}>
      {label}
    </span>
    {badge && (
      <span className="badge bg-secondary ms-auto" style={{ fontSize: 10 }}>
        {badge}
      </span>
    )}
  </div>
);

export default AddToKBModal;
