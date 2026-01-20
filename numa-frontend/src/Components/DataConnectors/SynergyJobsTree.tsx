import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import type { SynergyFolder, SynergyFolderItemsResponse, SynergyJob } from '../../types/synergySync';

type FolderMap = Record<string, SynergyFolder[]>;
type LoadingMap = Record<string, boolean>;
type ParentMap = Record<string, string | null>;

type SynergyJobsTreeProps = {
  job: SynergyJob;
  connected: boolean;
  selectedFolders: string[];
  includeAllFolders: boolean;
  onSelectionChange: (selectedFolders: string[], includeAllFolders: boolean) => void;
  actionLabel: string;
  onAction: () => void;
  actionVariant?: 'primary' | 'secondary';
  loadJobFolders: (jobId: string) => Promise<SynergyFolder[]>;
  loadFolderItems: (folderId: string) => Promise<SynergyFolderItemsResponse>;
  disabled?: boolean;
};

export const SynergyJobsTree = ({
  job,
  connected,
  selectedFolders,
  includeAllFolders,
  onSelectionChange,
  actionLabel,
  onAction,
  actionVariant = 'secondary',
  loadJobFolders,
  loadFolderItems,
  disabled,
}: SynergyJobsTreeProps) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [foldersByParent, setFoldersByParent] = useState<FolderMap>({});
  const [loadingByParent, setLoadingByParent] = useState<LoadingMap>({});
  const [parentById, setParentById] = useState<ParentMap>({});
  const [selection, setSelection] = useState<Set<string>>(new Set(selectedFolders));
  const [allFolders, setAllFolders] = useState(includeAllFolders);
  const [saveError, setSaveError] = useState<string | null>(null);

  const jobKey = useMemo(() => `job:${job.job_id}`, [job.job_id]);

  useEffect(() => {
    setSelection(new Set(selectedFolders));
  }, [selectedFolders]);

  useEffect(() => {
    setAllFolders(includeAllFolders);
  }, [includeAllFolders]);

  const toggleExpand = async (nodeId: string, loader: () => Promise<SynergyFolderItemsResponse | SynergyFolder[]>) => {
    const next = new Set(expandedNodes);
    if (next.has(nodeId)) {
      next.delete(nodeId);
      setExpandedNodes(next);
      return;
    }
    next.add(nodeId);
    setExpandedNodes(next);
    if (!foldersByParent[nodeId]) {
      setLoadingByParent((prev) => ({ ...prev, [nodeId]: true }));
      try {
        const result = await loader();
        const folders = Array.isArray(result) ? result : result.subfolders || [];
        setFoldersByParent((prev) => ({ ...prev, [nodeId]: folders }));
        if (nodeId !== jobKey) {
          setParentById((prev) => {
            const updated = { ...prev };
            folders.forEach((folder) => {
              updated[folder.folder_id] = nodeId;
            });
            return updated;
          });
        }
        if (selection.has(nodeId) && !allFolders) {
          setSelection((prev) => {
            const updated = new Set(prev);
            folders.forEach((folder) => updated.add(folder.folder_id));
            onSelectionChange(Array.from(updated), false);
            return updated;
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load folders.';
        setSaveError(message);
      } finally {
        setLoadingByParent((prev) => ({ ...prev, [nodeId]: false }));
      }
    }
  };

  const getDescendants = (folderId: string): string[] => {
    const result: string[] = [];
    const stack = [...(foldersByParent[folderId] || [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      result.push(current.folder_id);
      const children = foldersByParent[current.folder_id] || [];
      children.forEach((child) => stack.push(child));
    }
    return result;
  };

  const getAllKnownIds = (): string[] => {
    const result: string[] = [];
    const stack = [...(foldersByParent[jobKey] || [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      result.push(current.folder_id);
      const children = foldersByParent[current.folder_id] || [];
      children.forEach((child) => stack.push(child));
    }
    return result;
  };

  const getAncestors = (folderId: string): string[] => {
    const result: string[] = [];
    let current = parentById[folderId];
    while (current) {
      result.push(current);
      current = parentById[current] || null;
    }
    return result;
  };

  const getSelectionState = (folderId: string) => {
    if (allFolders) {
      return { checked: true };
    }
    const descendantIds = getDescendants(folderId);
    if (descendantIds.length === 0) {
      return { checked: selection.has(folderId) };
    }
    const allChildrenSelected = descendantIds.every((id) => selection.has(id));
    return { checked: selection.has(folderId) && allChildrenSelected };
  };

  const toggleFolder = (folderId: string) => {
    const descendantIds = getDescendants(folderId);
    const ids = [folderId, ...descendantIds];
    const state = getSelectionState(folderId);
    setSelection((prev) => {
      const next = new Set(prev);
      if (allFolders && state.checked) {
        const allKnown = getAllKnownIds();
        const seeded = new Set(allKnown);
        ids.forEach((id) => seeded.delete(id));
        onSelectionChange(Array.from(seeded), false);
        return seeded;
      }
      if (state.checked) {
        ids.forEach((id) => next.delete(id));
        getAncestors(folderId).forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      onSelectionChange(Array.from(next), false);
      return next;
    });
    setAllFolders(false);
  };

  const renderFolder = (folder: SynergyFolder, depth: number) => {
    const isExpanded = expandedNodes.has(folder.folder_id);
    const hasChildren = !!folder.has_subfolders;
    const isLoading = loadingByParent[folder.folder_id];
    const state = getSelectionState(folder.folder_id);

    return (
      <div key={folder.folder_id}>
        <div className="d-flex align-items-center gap-2 py-1" style={{ paddingLeft: `${depth * 16}px` }}>
          {hasChildren ? (
            <Button
              variant="link"
              size="sm"
              className="p-0 brand-link"
              onClick={() => toggleExpand(folder.folder_id, () => loadFolderItems(folder.folder_id))}
              disabled={disabled}
            >
              <i className={`bi ${isExpanded ? 'bi-caret-down-fill' : 'bi-caret-right-fill'}`} />
            </Button>
          ) : (
            <span className="text-muted" style={{ width: 14 }} />
          )}
          <Form.Check
            type="checkbox"
            id={`folder-${folder.folder_id}`}
            className="mb-0"
            checked={state.checked}
            onChange={() => toggleFolder(folder.folder_id)}
            disabled={disabled}
          />
          <span className="small fw-semibold">{folder.name}</span>
          {folder.no_of_subfolders !== undefined && (
            <span className="text-muted small">{folder.no_of_subfolders} subfolders</span>
          )}
          {isLoading && <Spinner size="sm" animation="border" className="ms-2" />}
        </div>
        {isExpanded && (foldersByParent[folder.folder_id] || []).map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="data-connector-card border rounded p-3 h-100">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <div>
          <div className="d-flex align-items-center gap-2">
            <strong>{job.name}</strong>
            <span
              className={`badge brand-status-badge ${
                connected ? 'brand-status-badge--active' : 'brand-status-badge--inactive'
              }`}
            >
              {connected ? 'Connected' : 'Available'}
            </span>
          </div>
          {job.description && <div className="text-muted small">{job.description}</div>}
        </div>
        <Button
          variant="link"
          className="text-decoration-none brand-link"
          onClick={() => toggleExpand(jobKey, () => loadJobFolders(job.job_id))}
          disabled={disabled}
        >
          <i className={`bi ${expandedNodes.has(jobKey) ? 'bi-folder2-open' : 'bi-folder2'}`} />{' '}
          {expandedNodes.has(jobKey) ? 'Hide folders' : 'Browse folders'}
        </Button>
      </div>

      {saveError && (
        <Alert variant="danger" className="py-2">
          {saveError}
        </Alert>
      )}

      {expandedNodes.has(jobKey) && (
        <div className="border rounded p-2 bg-light">
          <div className="d-flex flex-wrap gap-2 mb-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setAllFolders(true);
                setSelection(new Set());
                onSelectionChange([], true);
              }}
              disabled={disabled}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setAllFolders(false);
                setSelection(new Set());
                onSelectionChange([], false);
              }}
              disabled={disabled}
            >
              Unselect all
            </Button>
          </div>
          {(foldersByParent[jobKey] || []).map((folder) => renderFolder(folder, 1))}
          {loadingByParent[jobKey] && (
            <div className="text-muted small d-flex align-items-center gap-2">
              <Spinner size="sm" animation="border" />
              Loading folders...
            </div>
          )}
          {!loadingByParent[jobKey] && (foldersByParent[jobKey] || []).length === 0 && (
            <div className="text-muted small">No folders found.</div>
          )}
        </div>
      )}

      <div className="d-flex gap-2 mt-3">
        <Button variant={actionVariant} onClick={onAction} disabled={disabled}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
};
