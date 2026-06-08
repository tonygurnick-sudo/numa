import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Spinner, Alert, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import {
  buildFileTree,
  buildRowsForTree,
  unwrapSingleRootFolders,
  flattenRows,
  sortTree,
  formatDateSafe,
  formatSizeSafe,
  filterTree,
  filterTreeByPredicate,
  collectFoldersToExpand,
} from './KBFileExplorer';
import type { S3Object, TableRow, SortColumn, SortDirection } from './KBFileExplorer';
import { FileUploader } from '../FileUploader';
import { NotificationModal } from '../NotificationModal';
import DestinationFolderPicker, { type DestinationFolderPickerValue } from './DestinationFolderPicker';
import DestinationFolderPickerModal from './DestinationFolderPickerModal';
import FilesBulkActionBar from './FilesBulkActionBar';
import {
  shouldShowLargeDataFileWarning,
  formatFileSize,
  getFileTypeCategory,
  getFileIconClass,
  getFileIconColorClass,
} from '../../utils/fileUtils';
import type { FileTypeCategory } from '../../utils/fileUtils';
import {
  listFoldersInKB,
  downloadFileFromS3,
  downloadFolderAsZip,
  downloadKeysAsZip,
  listObjectsInFolder,
  zipPathFromKbKey,
} from '../../utils/s3Utils';
import { useAuth } from '../../Providers/AuthProvider';
import { useToast } from '../../Providers/ToastContext';
import { useFilePreviewProcessor } from '../../hooks/useFilePreviewProcessor';
import type { FileReference } from '../../hooks/useFilePreviewProcessor';
import ResizableSplitView from '../ResizableSplitView';
import { FilePreviewPanel } from '../FilePreviewPanel';
import { SYSTEM_KB_IDS, isRootKB } from '../../constants/knowledgeBase';
import type { UserKB } from '../../Services/knowledgeBaseService';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import type { S3FileInfo } from '../../Services/knowledgeBaseService';
import { CreateFolderModal } from './CreateFolderModal';
import { CreateSubfolderModal } from './CreateSubfolderModal';
import { FolderContextMenu, type FolderContextAction, type FolderContextTarget } from './FolderContextMenu';
import { FolderSettingsDrawer } from './FolderSettingsDrawer';
import { extractDroppedUploadBatch, isExternalFileDrag, type DroppedUploadBatch } from './dropUploadUtils';
import { useConnectedIntegrations, type ConnectedIntegration } from '../../hooks/useConnectedIntegrations';
import { RemoteProviderBrowser, type SubFolderBreadcrumb } from './Remote/RemoteProviderBrowser';
import { RemoteProviderInlineRows } from './Remote/RemoteProviderInlineRows';
import { ComposeEmailModal } from '../Files/ComposeEmailModal';
import { ConnectorStatusBadge, type ConnectorStatus } from '../DataConnectors/ConnectorStatusBadge';
import { getFlag } from '../../utils/featureFlags';
import { Link } from 'react-router-dom';

interface UserFilesTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

interface KBFileState {
  files: S3Object[];
  isLoading: boolean;
  expandedFolders: Set<string>;
  loadedFolders: Set<string>;
  loadingFolders: Set<string>;
  /** True once a recursive listing has been merged in for this KB. */
  deepLoaded: boolean;
  /** True if the last recursive fetch hit the backend's 50k cap. */
  truncated: boolean;
}

/** Where we are navigated to. null = root (all KBs). Set = inside a specific KB. */
interface NavigationState {
  kbId: string;
  kbName: string;
  role: 'VIEWER' | 'EDITOR' | 'OWNER';
  /** Stack of subfolder IDs we've navigated into within this KB */
  subfolderPath: { id: string; name: string }[];
}

function apiToS3Objects(fileInfos: S3FileInfo[], folderNames: string[], parentPrefix: string): S3Object[] {
  const s3Files: S3Object[] = fileInfos.map((f) => ({
    Key: f.key,
    LastModified: f.lastModified ? new Date(f.lastModified) : new Date(),
    Size: f.size,
    urlTag: f.urlTag,
    uploadedBy: f.uploadedBy,
    uploadedAt: f.uploadedAt,
  }));
  for (const folder of folderNames) {
    s3Files.push({ Key: `${parentPrefix}${folder}/`, LastModified: new Date(), Size: 0 });
  }
  return s3Files;
}

/** S3 prefix for a KB's root (where its top-level files/folders live). */
function kbRootPrefix(kbId: string): string {
  return `documents/kb-${kbId}/`;
}

/**
 * True if a selection key points at a whole KB root (nothing after the KB
 * segment) rather than a subfolder inside it. Whole-KB selections are allowed
 * for download but kept out of bulk move/delete so a checkbox can't wipe a KB.
 */
function isKbRootKey(key: string): boolean {
  return /^documents\/(?:kb-[^/]+|company|numa-support)\/$/u.test(key);
}

export function UserFilesTab({ onActionChange }: UserFilesTabProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKb } = useTranslation('knowledgeBase');
  const { availableKBs, isLoadingKBs, refreshKBs, fetchKBDetails } = useKnowledgeBase();
  const { getCredentials, region: authRegion, user } = useAuth();
  const { showToast } = useToast();

  // Navigation: null = root, set = inside a KB
  const [currentFolder, setCurrentFolder] = useState<NavigationState | null>(null);

  // Parallel nav track for an integration drilled into from the User Files
  // root (Gmail, Google Drive, Synergy, etc.). Mutually exclusive with
  // `currentFolder` — root → KB and root → integration are sibling moves.
  // `integrationSubPath` is the breadcrumb path WITHIN that integration; the
  // page toolbar renders the full crumbs as one bar.
  const [currentIntegration, setCurrentIntegration] = useState<ConnectedIntegration | null>(null);
  const [integrationSubPath, setIntegrationSubPath] = useState<SubFolderBreadcrumb[]>([]);
  // Open the Compose Email modal from the toolbar when browsing the Gmail
  // integration. Gmail is the only integration with a write action exposed
  // here today; other providers don't get a compose button.
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);

  const dataConnectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');
  const { integrations, isLoading: integrationsLoading } = useConnectedIntegrations(dataConnectorsEnabled);
  const [expandedIntegrations, setExpandedIntegrations] = useState<Set<string>>(new Set());
  const toggleIntegrationExpansion = useCallback((id: string) => {
    setExpandedIntegrations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Inline expansion at root level
  const [expandedKbs, setExpandedKbs] = useState<Set<string>>(new Set());
  // Per-KB file state
  const [kbFileStates, setKbFileStates] = useState<Map<string, KBFileState>>(new Map());
  // Mirror of kbFileStates for async reads (e.g. skip-if-already-loaded guards)
  // without pulling the value into useCallback deps.
  const kbFileStatesRef = useRef(kbFileStates);
  useEffect(() => {
    kbFileStatesRef.current = kbFileStates;
  }, [kbFileStates]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalVisibility, setCreateModalVisibility] = useState<'personal' | 'shared' | undefined>(undefined);
  const openCreateModal = useCallback((visibility?: 'personal' | 'shared') => {
    setCreateModalVisibility(visibility);
    setShowCreateModal(true);
  }, []);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [settingsKb, setSettingsKb] = useState<UserKB | null>(null);

  // Subfolder creation
  const [subfolderTarget, setSubfolderTarget] = useState<{
    kbId: string;
    parentPath: string;
    parentDisplayName: string;
  } | null>(null);

  // Folder right-click context menu
  const [folderContextMenu, setFolderContextMenu] = useState<{
    show: boolean;
    position: { x: number; y: number };
    target: FolderContextTarget;
  } | null>(null);

  // Top-level folder delete confirmation (via context menu)
  const [topLevelDeleteConfirm, setTopLevelDeleteConfirm] = useState<UserKB | null>(null);
  const [isDeletingTopLevel, setIsDeletingTopLevel] = useState(false);

  const [searchValue, setSearchValue] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Drag-and-drop + multi-select for file moves
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // Items the user explicitly un-ticked *within* a selected folder. The folder
  // stays selected (its marker is in selectedKeys); these keys (and anything
  // beneath them) are carved back out. Lets you "select a folder, then drop a
  // few items, keep the rest" without exploding the whole folder into the set.
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  // Filters
  const [typeFilter, setTypeFilter] = useState<FileTypeCategory | 'all'>('all');
  const [uploaderFilter, setUploaderFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');

  // Upload
  const [uploadTargetKb, setUploadTargetKb] = useState<UserKB | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [pendingLargeFiles, setPendingLargeFiles] = useState<File[]>([]);
  const [clearFileUploader, setClearFileUploader] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadInitialFolder, setUploadInitialFolder] = useState('');
  const [droppedUploadBatch, setDroppedUploadBatch] = useState<DroppedUploadBatch | null>(null);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  // Combined destination from the tree picker shown inside the upload modal.
  // null means "use the upload target KB's root".
  const [uploadDestination, setUploadDestination] = useState<DestinationFolderPickerValue | null>(null);

  // Bulk actions
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  // Folder key currently being zipped via its per-row download button (for a
  // spinner on that row); null when no per-row folder download is in flight.
  const [downloadingFolderKey, setDownloadingFolderKey] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<{
    kbId: string;
    fileKeys: string[];
    folderPaths: string[];
    label: string;
  } | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Delete (files or subfolders — discriminated by `kind`)
  type DeleteConfirmState =
    | { kind: 'files'; kbId: string; keys: string[]; label: string }
    | { kind: 'subfolder'; kbId: string; path: string; label: string };
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Rename
  const [renameTarget, setRenameTarget] = useState<{ kbId: string; key: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // File preview
  const {
    filePreview,
    showFilePreview,
    leftFraction: filePreviewLeftFraction,
    setLeftFraction: setFilePreviewLeftFraction,
    openFilePreview,
    closeFilePreview,
  } = useFilePreviewProcessor();
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const dataBucket = `numa-${CLIENT_NAME}-data`;
  const emptyValue = tKb('fileExplorer.emptyValue');
  const formatDate = useCallback((date: Date | undefined) => formatDateSafe(date, emptyValue), [emptyValue]);
  const formatSize = useCallback((size: number | undefined) => formatSizeSafe(size, emptyValue), [emptyValue]);

  const userSub = user?.decoded_tokens?.idToken?.sub ?? '';

  // Separate root KB from regular folder KBs
  const rootKB = useMemo(
    () => availableKBs.find((kb) => kb.is_root || (userSub && isRootKB(kb.kb_id, userSub))),
    [availableKBs, userSub]
  );
  const allUserKBs = useMemo(
    () =>
      availableKBs.filter(
        (kb) => !SYSTEM_KB_IDS.has(kb.kb_id) && !(kb.is_root || (userSub && isRootKB(kb.kb_id, userSub)))
      ),
    [availableKBs, userSub]
  );

  // Defensive: backend returns "Personal" for the root KB, but if any legacy
  // record / synthesis path returns something else we still want to surface
  // the consistent "Personal" label in the UI.
  const displayKbName = useCallback(
    (kb: { kb_name: string; is_root?: boolean }) => (kb.is_root ? t('rootFiles.displayName') : kb.kb_name),
    [t]
  );

  // Hide parent page actions -- we handle them in the toolbar
  useEffect(() => {
    onActionChange?.(null);
  }, [onActionChange]);

  // ── Data fetching ──────────────────────────────────────────

  const fetchKbFiles = useCallback(async (kbId: string) => {
    setKbFileStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(kbId);
      // First load this session: seed from both the shallow cache AND the
      // deep cache. Deep entries are thin (no uploader/urlTag); shallow
      // entries overwrite them for matching keys so enrichment wins.
      let files: S3Object[] = existing?.files ?? [];
      let deepLoaded = existing?.deepLoaded ?? false;
      let truncated = existing?.truncated ?? false;
      if (!existing) {
        const deepCache = knowledgeBaseService.getCachedKBFilesRecursive(kbId);
        if (deepCache?.files?.length) {
          files = apiToS3Objects(deepCache.files, [], `documents/kb-${kbId}/`);
          deepLoaded = true;
          truncated = deepCache.truncated;
        }
        const shallowCache = knowledgeBaseService.getCachedKBFiles(kbId);
        if (shallowCache?.files?.length) {
          const shallowFiles = apiToS3Objects(shallowCache.files, shallowCache.folders ?? [], `documents/kb-${kbId}/`);
          const shallowKeys = new Set(shallowFiles.map((f) => f.Key));
          files = [...shallowFiles, ...files.filter((f) => !shallowKeys.has(f.Key))];
        }
      }
      next.set(kbId, {
        files,
        isLoading: true,
        expandedFolders: existing?.expandedFolders ?? new Set(),
        loadedFolders: new Set(),
        loadingFolders: new Set(),
        deepLoaded,
        truncated,
      });
      return next;
    });

    try {
      const { files: fileInfos, folders: folderNames = [] } = await knowledgeBaseService.listKBFiles(kbId);
      const parentPrefix = `documents/kb-${kbId}/`;
      const s3Files = apiToS3Objects(fileInfos, folderNames, parentPrefix);
      setKbFileStates((prev) => {
        const next = new Map(prev);
        const existing = prev.get(kbId);
        // Shallow fetch is authoritative for the root level. Keep deep entries
        // (inside subfolders) the shallow call doesn't list — but only if their
        // root folder is still in the fresh response. A stale root-level entry
        // (file or folder marker) whose key has gone from the shallow response
        // must be dropped, or e.g. a folder deleted server-side will linger in
        // the UI and surface "Folder not found" 404s on delete.
        const shallowKeys = new Set(s3Files.map((f) => f.Key));
        const liveFolderPrefixes = folderNames.map((name) => `${parentPrefix}${name}/`);
        const preserved = (existing?.files ?? []).filter((f) => {
          // Already in fresh response → fresh wins, drop here to avoid dupes.
          if (shallowKeys.has(f.Key)) return false;
          // Keep deep entries whose root folder is still live.
          return liveFolderPrefixes.some((p) => f.Key.startsWith(p));
        });
        next.set(kbId, {
          files: [...s3Files, ...preserved],
          isLoading: false,
          expandedFolders: existing?.expandedFolders ?? new Set(),
          loadedFolders: new Set(),
          loadingFolders: new Set(),
          deepLoaded: existing?.deepLoaded ?? false,
          truncated: existing?.truncated ?? false,
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch KB files:', kbId, err);
      setKbFileStates((prev) => {
        const next = new Map(prev);
        const existing = prev.get(kbId);
        next.set(kbId, {
          files: existing?.files ?? [],
          isLoading: false,
          expandedFolders: existing?.expandedFolders ?? new Set(),
          loadedFolders: existing?.loadedFolders ?? new Set(),
          loadingFolders: new Set(),
          deepLoaded: existing?.deepLoaded ?? false,
          truncated: existing?.truncated ?? false,
        });
        return next;
      });
    }
  }, []);

  const [deepLoadingKbs, setDeepLoadingKbs] = useState<Set<string>>(new Set());

  const fetchDeepKbFiles = useCallback(async (kbId: string, force = false) => {
    // Skip if already deep-loaded this session, unless the caller is the
    // Refresh button (force=true) asking for a fresh copy.
    const existing = kbFileStatesRef.current.get(kbId);
    if (!force && existing?.deepLoaded) return;
    setDeepLoadingKbs((prev) => new Set(prev).add(kbId));
    try {
      const result = await knowledgeBaseService.listKBFilesRecursive(kbId);
      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = prev.get(kbId);
        const existingFiles = s?.files ?? [];
        const existingKeys = new Set(existingFiles.map((f) => f.Key));
        // Add only keys not already present — shallow enrichment wins.
        const additions: S3Object[] = [];
        for (const f of result.files) {
          if (existingKeys.has(f.key)) continue;
          additions.push({
            Key: f.key,
            LastModified: f.lastModified ? new Date(f.lastModified) : new Date(),
            Size: f.size,
          });
        }
        next.set(kbId, {
          files: [...existingFiles, ...additions],
          isLoading: s?.isLoading ?? false,
          expandedFolders: s?.expandedFolders ?? new Set(),
          loadedFolders: s?.loadedFolders ?? new Set(),
          loadingFolders: s?.loadingFolders ?? new Set(),
          deepLoaded: true,
          truncated: result.truncated,
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to deep-fetch KB', kbId, err);
    } finally {
      setDeepLoadingKbs((prev) => {
        const next = new Set(prev);
        next.delete(kbId);
        return next;
      });
    }
  }, []);

  const ensureKbLoaded = useCallback(
    (kbId: string) => {
      // Always fire a background shallow refresh on expansion (SWR pattern).
      // Hydration seeds kbFileStates from localStorage on mount, so a cache-miss
      // guard would skip the fetch and never pick up server-side changes (e.g.
      // a folder created from chat or another session would stay invisible).
      // fetchKbFiles uses a functional setter that merges cleanly with existing
      // state, so this is safe to call unconditionally.
      fetchKbFiles(kbId);
      if (!kbFileStates.has(kbId)) {
        fetchKBDetails(kbId);
      }
    },
    [kbFileStates, fetchKbFiles, fetchKBDetails]
  );

  // Hydrate state for every KB from localStorage on mount. No network calls
  // — just makes the cached counts and deep-search data visible instantly
  // after a page refresh. SWR refresh for the root KB still runs below.
  useEffect(() => {
    const kbIds: string[] = [];
    if (rootKB) kbIds.push(rootKB.kb_id);
    for (const kb of allUserKBs) kbIds.push(kb.kb_id);

    setKbFileStates((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const kbId of kbIds) {
        if (next.has(kbId)) continue;
        const deepCache = knowledgeBaseService.getCachedKBFilesRecursive(kbId);
        const shallowCache = knowledgeBaseService.getCachedKBFiles(kbId);
        if (!deepCache?.files?.length && !shallowCache?.files?.length) continue;

        let files: S3Object[] = [];
        let deepLoaded = false;
        let truncated = false;
        if (deepCache?.files?.length) {
          files = apiToS3Objects(deepCache.files, [], `documents/kb-${kbId}/`);
          deepLoaded = true;
          truncated = deepCache.truncated;
        }
        if (shallowCache?.files?.length) {
          const shallowFiles = apiToS3Objects(shallowCache.files, shallowCache.folders ?? [], `documents/kb-${kbId}/`);
          const shallowKeys = new Set(shallowFiles.map((f) => f.Key));
          files = [...shallowFiles, ...files.filter((f) => !shallowKeys.has(f.Key))];
        }
        next.set(kbId, {
          files,
          isLoading: false,
          expandedFolders: new Set(),
          loadedFolders: new Set(),
          loadingFolders: new Set(),
          deepLoaded,
          truncated,
        });
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [allUserKBs, rootKB]);

  // SWR refresh for the root KB — always fetch on mount so any stale cache
  // gets reconciled with current server state. fetchKbFiles preserves hydrated
  // state via functional setter, so there's no flicker.
  useEffect(() => {
    if (rootKB) {
      fetchKbFiles(rootKB.kb_id);
    }
  }, [rootKB?.kb_id]);

  // When a search or filter is active, fire the recursive listing for every
  // KB whose deep data we haven't loaded yet. Deep fetch is the only thing
  // that can give comprehensive search — shallow only covers one level per
  // KB. The internal ref guard in fetchDeepKbFiles prevents duplicate calls.
  const isFilterOrSearchActive =
    searchValue.trim().length > 0 || typeFilter !== 'all' || uploaderFilter !== 'all' || dateFilter !== 'all';
  useEffect(() => {
    if (!isFilterOrSearchActive) return;
    const targets: string[] = [];
    if (rootKB) targets.push(rootKB.kb_id);
    for (const kb of allUserKBs) targets.push(kb.kb_id);
    for (const kbId of targets) {
      const state = kbFileStates.get(kbId);
      if (!state?.deepLoaded) {
        fetchDeepKbFiles(kbId);
      }
    }
  }, [isFilterOrSearchActive, allUserKBs, rootKB, kbFileStates, fetchDeepKbFiles]);

  // ── Interactions ───────────────────────────────────────────

  /** Chevron click: expand/collapse inline */
  const toggleKbExpansion = useCallback(
    (kbId: string) => {
      setExpandedKbs((prev) => {
        const next = new Set(prev);
        if (next.has(kbId)) {
          next.delete(kbId);
        } else {
          next.add(kbId);
          ensureKbLoaded(kbId);
        }
        return next;
      });
    },
    [ensureKbLoaded]
  );

  /** Double-click: navigate into KB folder */
  const navigateIntoKb = useCallback(
    (kb: UserKB) => {
      setCurrentFolder({ kbId: kb.kb_id, kbName: displayKbName(kb), role: kb.role, subfolderPath: [] });
      setSearchValue('');
      setSelectedKeys(new Set());
      ensureKbLoaded(kb.kb_id);
    },
    [ensureKbLoaded, displayKbName]
  );

  const navigateBack = useCallback(() => {
    setCurrentFolder((prev) => {
      if (!prev) return null;
      if (prev.subfolderPath.length > 0) {
        // Go up one subfolder level
        return { ...prev, subfolderPath: prev.subfolderPath.slice(0, -1) };
      }
      // Back to root
      return null;
    });
    setSearchValue('');
    setSelectedKeys(new Set());
    closeFilePreview();
  }, [closeFilePreview]);

  // ── Drag-and-drop move ─────────────────────────────────────

  const getKbRole = useCallback(
    (kbId: string): 'VIEWER' | 'EDITOR' | 'OWNER' => {
      if (rootKB && kbId === rootKB.kb_id) return 'OWNER';
      return allUserKBs.find((k) => k.kb_id === kbId)?.role ?? 'VIEWER';
    },
    [rootKB, allUserKBs]
  );

  const canEditKb = useCallback((kbId: string) => getKbRole(kbId) !== 'VIEWER', [getKbRole]);

  const parseDragPayload = (e: React.DragEvent): { sourceKbId: string; keys: string[] } | null => {
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.sourceKbId === 'string' && Array.isArray(p.keys) && p.keys.length > 0) return p;
    } catch {
      /* noop */
    }
    return null;
  };

  const handleFileClick = useCallback((originalKey: string, e: React.MouseEvent) => {
    // Ignore clicks that originated on the row's action buttons (preview, download).
    if ((e.target as HTMLElement).closest('button')) return;
    if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(originalKey)) next.delete(originalKey);
        else next.add(originalKey);
        return next;
      });
    } else {
      setSelectedKeys((prev) => (prev.size === 1 && prev.has(originalKey) ? new Set() : new Set([originalKey])));
    }
  }, []);

  /** Cmd/Ctrl click on a subfolder body toggles it in the selection. */
  const handleFolderModifierClick = useCallback((folderId: string, e: React.MouseEvent): boolean => {
    if ((e.target as HTMLElement).closest('button')) return false;
    if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return false;
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) return false;
    const folderKey = folderId.endsWith('/') ? folderId : `${folderId}/`;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
    return true;
  }, []);

  const onFileDragStart = useCallback(
    (e: React.DragEvent, sourceKbId: string, originalKey: string) => {
      if (!canEditKb(sourceKbId)) {
        e.preventDefault();
        return;
      }
      const keys = selectedKeys.has(originalKey) && selectedKeys.size > 1 ? Array.from(selectedKeys) : [originalKey];
      e.dataTransfer.setData('application/json', JSON.stringify({ sourceKbId, keys }));
      e.dataTransfer.effectAllowed = 'move';
      setIsDragging(true);
    },
    [canEditKb, selectedKeys]
  );

  const onFolderDragStart = useCallback(
    (e: React.DragEvent, sourceKbId: string, folderId: string) => {
      if (!canEditKb(sourceKbId)) {
        e.preventDefault();
        return;
      }
      const folderKey = folderId.endsWith('/') ? folderId : `${folderId}/`;
      e.dataTransfer.setData('application/json', JSON.stringify({ sourceKbId, keys: [folderKey] }));
      e.dataTransfer.effectAllowed = 'move';
      setIsDragging(true);
    },
    [canEditKb]
  );

  const onFileDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragOverTarget(null);
  }, []);

  const executeMove = useCallback(
    async (sourceKbId: string, keys: string[], destKbId: string, destPath: string) => {
      if (!canEditKb(sourceKbId)) return;
      if (!canEditKb(destKbId)) {
        showToast({ message: t('move.cannotEditDest'), variant: 'error' });
        return;
      }
      // Reject no-op: dropping a file into its current parent folder.
      const destFolderPrefix = destPath
        ? `documents/kb-${destKbId}/${destPath}/`.replace(/\/{2,}/g, '/')
        : `documents/kb-${destKbId}/`;
      const toMove = keys.filter((k) => {
        const parent = k.substring(0, k.lastIndexOf('/') + 1);
        return parent !== destFolderPrefix;
      });
      if (toMove.length === 0) return;

      setIsMoving(true);
      try {
        const result = await knowledgeBaseService.moveKBFiles(sourceKbId, toMove, destKbId, destPath);
        // Optimistically rewrite source -> dest keys so the moved entries
        // jump folders (or jump to a sibling KB) immediately. Without this,
        // the old keys linger until the refetch completes and the
        // preserve-deep-entries branch in `fetchKbFiles` keeps them.
        const mapping = new Map(result.successful.map((s) => [s.sourceKey, s.destKey]));
        const movedFolderPrefixes = toMove.filter((k) => k.endsWith('/'));
        const isMovedFolderMarker = (key: string) =>
          key.endsWith('/') && movedFolderPrefixes.some((prefix) => key === prefix || key.startsWith(prefix));
        const keepFolderState = (id: string) =>
          !movedFolderPrefixes.some((prefix) => id === prefix || id.startsWith(prefix));
        if (mapping.size > 0) {
          setKbFileStates((prev) => {
            const next = new Map(prev);
            const source = prev.get(sourceKbId);
            if (!source) return next;
            if (sourceKbId === destKbId) {
              next.set(sourceKbId, {
                ...source,
                files: source.files.flatMap((f) => {
                  const dest = mapping.get(f.Key);
                  if (dest) return [{ ...f, Key: dest }];
                  return isMovedFolderMarker(f.Key) ? [] : [f];
                }),
                expandedFolders: new Set([...source.expandedFolders].filter(keepFolderState)),
                loadedFolders: new Set([...source.loadedFolders].filter(keepFolderState)),
              });
            } else {
              const moved: S3Object[] = [];
              const remaining = source.files.filter((f) => {
                const dest = mapping.get(f.Key);
                if (dest) {
                  moved.push({ ...f, Key: dest });
                  return false;
                }
                return !isMovedFolderMarker(f.Key);
              });
              next.set(sourceKbId, {
                ...source,
                files: remaining,
                expandedFolders: new Set([...source.expandedFolders].filter(keepFolderState)),
                loadedFolders: new Set([...source.loadedFolders].filter(keepFolderState)),
              });
              const destState = prev.get(destKbId);
              if (destState && moved.length > 0) {
                next.set(destKbId, { ...destState, files: [...destState.files, ...moved] });
              }
            }
            return next;
          });
        }
        if (result.failed.length > 0) {
          showToast({
            message: t('move.partial', { succeeded: result.successful.length, failed: result.failed.length }),
            variant: 'warning',
          });
        } else {
          showToast({
            message: t('move.success', { count: result.successful.length }),
            variant: 'success',
          });
        }
        setSelectedKeys(new Set());
        fetchKbFiles(sourceKbId);
        if (destKbId !== sourceKbId) fetchKbFiles(destKbId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/collision|409/i.test(msg)) {
          showToast({ message: t('move.collision'), variant: 'error' });
        } else {
          showToast({ message: t('move.error', { error: msg }), variant: 'error' });
        }
      } finally {
        setIsMoving(false);
      }
    },
    [canEditKb, showToast, t, fetchKbFiles]
  );

  /** Onto a KB folder at root — drops into that KB's root. */
  const onDropOnKb = useCallback(
    (e: React.DragEvent, kb: UserKB) => {
      e.preventDefault();
      setDragOverTarget(null);
      const payload = parseDragPayload(e);
      if (!payload) return;
      executeMove(payload.sourceKbId, payload.keys, kb.kb_id, '');
    },
    [executeMove]
  );

  /** Onto a subfolder row — drops into that subfolder. */
  const onDropOnSubfolder = useCallback(
    (e: React.DragEvent, destKbId: string, folderId: string) => {
      e.preventDefault();
      setDragOverTarget(null);
      const payload = parseDragPayload(e);
      if (!payload) return;
      const basePrefix = `documents/kb-${destKbId}/`;
      const destPath = folderId.startsWith(basePrefix) ? folderId.slice(basePrefix.length) : folderId;
      executeMove(payload.sourceKbId, payload.keys, destKbId, destPath);
    },
    [executeMove]
  );

  /** Onto the back button — moves files up one level (or out of a KB to the root files). */
  const onDropOnBack = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverTarget(null);
      if (!currentFolder) return;
      const payload = parseDragPayload(e);
      if (!payload) return;
      const { kbId, subfolderPath } = currentFolder;
      if (subfolderPath.length > 1) {
        const parentFolderId = subfolderPath[subfolderPath.length - 2].id;
        const basePrefix = `documents/kb-${kbId}/`;
        const destPath = parentFolderId.startsWith(basePrefix)
          ? parentFolderId.slice(basePrefix.length)
          : parentFolderId;
        executeMove(payload.sourceKbId, payload.keys, kbId, destPath);
      } else if (subfolderPath.length === 1) {
        executeMove(payload.sourceKbId, payload.keys, kbId, '');
      } else if (rootKB) {
        // At the KB-level — back goes to the root view; move files out to the root KB.
        executeMove(payload.sourceKbId, payload.keys, rootKB.kb_id, '');
      }
    },
    [currentFolder, rootKB, executeMove]
  );

  const onTargetDragOver = useCallback((e: React.DragEvent, targetId: string, enabled: boolean) => {
    if (!enabled) return;
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes('application/json')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetId);
  }, []);

  const onTargetDragLeave = useCallback((targetId: string) => {
    setDragOverTarget((prev) => (prev === targetId ? null : prev));
  }, []);

  /** Toggle subfolder within a KB */
  const toggleSubfolder = useCallback(
    (kbId: string, folderId: string) => {
      const state = kbFileStates.get(kbId);
      if (!state) return;

      const isExpanding = !state.expandedFolders.has(folderId);

      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = { ...prev.get(kbId)! };
        const newExpanded = new Set(s.expandedFolders);
        isExpanding ? newExpanded.add(folderId) : newExpanded.delete(folderId);
        next.set(kbId, { ...s, expandedFolders: newExpanded });
        return next;
      });

      if (!isExpanding || state.loadedFolders.has(folderId)) return;

      const basePrefix = `documents/kb-${kbId}/`;
      const basePrefixNoSlash = basePrefix.replace(/\/$/, '');
      const subpath = folderId.startsWith(basePrefixNoSlash) ? folderId.slice(basePrefixNoSlash.length + 1) : folderId;

      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = { ...prev.get(kbId)! };
        s.loadingFolders = new Set(s.loadingFolders).add(folderId);
        next.set(kbId, s);
        return next;
      });

      knowledgeBaseService
        .listKBFiles(kbId, subpath)
        .then(({ files: fileInfos, folders: folderNames = [] }) => {
          const folderPrefix = `${basePrefix}${subpath}/`.replace(/\/{2,}/g, '/');
          const s3Files = apiToS3Objects(fileInfos, folderNames, folderPrefix);

          setKbFileStates((prev) => {
            const next = new Map(prev);
            const s = { ...prev.get(kbId)! };
            // Shallow entries carry uploader + urlTag enrichment; overwrite
            // any thin deep-only entries for the same keys so enrichment wins.
            const shallowKeys = new Set(s3Files.map((f) => f.Key));
            const merged = [...s3Files, ...s.files.filter((f) => !shallowKeys.has(f.Key))];
            const newLoading = new Set(s.loadingFolders);
            newLoading.delete(folderId);
            next.set(kbId, {
              ...s,
              files: merged,
              loadedFolders: new Set(s.loadedFolders).add(folderId),
              loadingFolders: newLoading,
            });
            return next;
          });
        })
        .catch((err) => {
          console.error('Failed to load subfolder', folderId, err);
          setKbFileStates((prev) => {
            const next = new Map(prev);
            const s = { ...prev.get(kbId)! };
            const newLoading = new Set(s.loadingFolders);
            newLoading.delete(folderId);
            next.set(kbId, { ...s, loadingFolders: newLoading });
            return next;
          });
        });
    },
    [kbFileStates]
  );

  /** Double-click: navigate into a subfolder within a KB */
  const navigateIntoSubfolder = useCallback(
    (kbId: string, folderId: string, folderName: string) => {
      // Ensure the folder is expanded and loaded
      const state = kbFileStates.get(kbId);
      if (state && !state.expandedFolders.has(folderId)) {
        toggleSubfolder(kbId, folderId);
      }
      setCurrentFolder((prev) => {
        if (!prev) return prev;
        return { ...prev, subfolderPath: [...prev.subfolderPath, { id: folderId, name: folderName }] };
      });
      setSearchValue('');
      setSelectedKeys(new Set());
    },
    [kbFileStates, toggleSubfolder]
  );

  // Structural filter predicate. Applied to every non-folder file in the tree.
  const filterPredicate = useMemo(() => {
    const dateCutoff = (() => {
      const now = Date.now();
      if (dateFilter === 'today') return now - 24 * 60 * 60 * 1000;
      if (dateFilter === '7d') return now - 7 * 24 * 60 * 60 * 1000;
      if (dateFilter === '30d') return now - 30 * 24 * 60 * 60 * 1000;
      return 0;
    })();
    const isActive = typeFilter !== 'all' || uploaderFilter !== 'all' || dateFilter !== 'all';
    return {
      isActive,
      predicate: (f: S3Object): boolean => {
        if (typeFilter !== 'all') {
          const filename = f.Key.split('/').pop() ?? '';
          if (getFileTypeCategory(filename) !== typeFilter) return false;
        }
        if (uploaderFilter !== 'all' && (f.uploadedBy ?? '') !== uploaderFilter) return false;
        if (dateCutoff > 0) {
          const ts = f.LastModified ? f.LastModified.getTime() : 0;
          if (ts < dateCutoff) return false;
        }
        return true;
      },
    };
  }, [typeFilter, uploaderFilter, dateFilter]);

  const uploaderOptions = useMemo(() => {
    const set = new Set<string>();
    kbFileStates.forEach((s) => s.files.forEach((f) => f.uploadedBy && set.add(f.uploadedBy)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [kbFileStates]);

  /** Build child rows for a KB */
  const buildKbChildRows = useCallback(
    (kbId: string, startDepth: number): TableRow[] => {
      const state = kbFileStates.get(kbId);
      if (!state || state.files.length === 0) return [];
      const trimmedSearch = searchValue.trim();
      let tree = buildFileTree(state.files);
      if (filterPredicate.isActive) {
        tree = filterTreeByPredicate(tree, filterPredicate.predicate);
      }
      if (trimmedSearch) {
        tree = filterTree(tree, trimmedSearch);
      }
      sortTree(tree, sortColumn, sortDirection);
      const nested = unwrapSingleRootFolders(buildRowsForTree(tree, startDepth, '', formatDate, formatSize));
      // During search or active filters, auto-expand every folder with a hit so matches aren't hidden behind collapsed parents.
      const effectiveExpanded =
        trimmedSearch || filterPredicate.isActive
          ? new Set([...state.expandedFolders, ...collectFoldersToExpand(tree)])
          : state.expandedFolders;
      return flattenRows(nested, effectiveExpanded);
    },
    [kbFileStates, sortColumn, sortDirection, formatDate, formatSize, searchValue, filterPredicate]
  );

  // ── File preview / download ────────────────────────────────

  const handleOpenFilePreview = useCallback(
    (ref: FileReference) => {
      openFilePreview(ref);
      if (isMobile) setShowFilePreviewModal(true);
    },
    [openFilePreview, isMobile]
  );

  const handleDownloadFile = useCallback(
    async (s3Key: string, filename: string) => {
      try {
        await downloadFileFromS3(s3Key, dataBucket, region, getCredentials, filename);
      } catch (err) {
        console.error('Error downloading file:', err);
      }
    },
    [dataBucket, region, getCredentials]
  );

  /** Download a whole folder (or KB root) as a zip via its per-row button. */
  const handleDownloadFolder = useCallback(
    async (folderKey: string, folderName: string) => {
      if (downloadingFolderKey) return; // one folder zip at a time
      setDownloadingFolderKey(folderKey);
      try {
        await downloadFolderAsZip(folderKey, dataBucket, region, getCredentials, `${folderName}.zip`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast({
          message: t('bulk.downloadError', { defaultValue: 'Download failed: {{error}}', error: msg }),
          variant: 'error',
        });
      } finally {
        setDownloadingFolderKey(null);
      }
    },
    [downloadingFolderKey, dataBucket, region, getCredentials, showToast, t]
  );

  // ── Upload handlers ────────────────────────────────────────

  // Lazy folder loader handed to the destination picker. The picker caches
  // results per-KB internally, so we don't pre-fetch on modal open anymore.
  const loadFoldersForKB = useCallback(
    (kbId: string) => listFoldersInKB(kbId, `numa-${CLIENT_NAME}-data`, region, getCredentials),
    [CLIENT_NAME, region, getCredentials]
  );

  // Initialise the picker's destination whenever the upload modal opens with
  // a fresh target.
  //
  // - Opened from My Files root with no specific subfolder → leave the
  //   picker at the KB-list view so the user explicitly picks a destination
  //   (the previous behaviour silently dumped files into Personal which
  //   surprised people).
  // - Opened from a per-row Upload button or an external drop into a folder
  //   → preselect that KB + subfolder so the user can upload immediately.
  useEffect(() => {
    if (!showUploadModal || !uploadTargetKb) return;
    const isFromRoot = !!rootKB && uploadTargetKb.kb_id === rootKB.kb_id && !uploadInitialFolder && !droppedUploadBatch;
    if (isFromRoot) {
      setUploadDestination(null);
    } else {
      setUploadDestination({ kbId: uploadTargetKb.kb_id, folderPath: uploadInitialFolder });
    }
  }, [showUploadModal, uploadTargetKb, uploadInitialFolder, rootKB, droppedUploadBatch]);

  useEffect(() => {
    if (clearFileUploader) {
      const timer = setTimeout(() => setClearFileUploader(false), 100);
      return () => clearTimeout(timer);
    }
  }, [clearFileUploader]);

  function handleFileSelect(selectedFiles: File[]): void {
    const largeDataFiles = selectedFiles.filter((file) => shouldShowLargeDataFileWarning(file));
    if (largeDataFiles.length > 0) {
      setPendingLargeFiles(largeDataFiles);
      setShowNotificationModal(true);
    }
  }

  const closeUploadModal = useCallback(() => {
    setShowUploadModal(false);
    setUploadDestination(null);
  }, []);

  function handleUploadSuccess(): void {
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
    const kbIdToRefresh = uploadDestination?.kbId ?? uploadTargetKb?.kb_id;
    closeUploadModal();
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);
    if (kbIdToRefresh) fetchKbFiles(kbIdToRefresh);
  }

  const handleFolderCreated = useCallback(() => refreshKBs(), [refreshKBs]);
  const handleFolderDeleted = useCallback(() => {
    if (settingsKb) {
      setExpandedKbs((prev) => {
        const n = new Set(prev);
        n.delete(settingsKb.kb_id);
        return n;
      });
      if (currentFolder?.kbId === settingsKb.kb_id) setCurrentFolder(null);
    }
    refreshKBs();
  }, [refreshKBs, settingsKb, currentFolder]);

  const openSettings = useCallback((kb: UserKB, e: React.MouseEvent) => {
    e.stopPropagation();
    setSettingsKb(kb);
    setShowSettingsDrawer(true);
  }, []);

  const openUploadForKb = useCallback((kb: UserKB, e: React.MouseEvent, initialFolder = '') => {
    e.stopPropagation();
    setUploadTargetKb(kb);
    setUploadInitialFolder(initialFolder);
    setDroppedUploadBatch(null);
    setUploadDestination(null);
    setShowUploadModal(true);
  }, []);

  const handleExternalUploadDrop = useCallback(
    async (e: React.DragEvent, kb: UserKB, folderPath: string, rejectFoldersForDrop: boolean) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setIsExternalDragOver(false);

      const batch = await extractDroppedUploadBatch(e.dataTransfer, rejectFoldersForDrop);
      if (!batch.files.length && !batch.folderRejection) return;

      setUploadTargetKb(kb);
      setUploadInitialFolder(folderPath);
      setUploadDestination({ kbId: kb.kb_id, folderPath });
      setDroppedUploadBatch({ id: Date.now(), ...batch });
      setShowUploadModal(true);
    },
    []
  );

  // ── Subfolder creation ──────────────────────────────────────

  /** Path of the current location relative to the KB root (no trailing slash). Empty when at the KB root. */
  const subfolderRelativePath = useCallback((kbId: string, folderId: string): string => {
    const basePrefix = `documents/kb-${kbId}/`;
    if (!folderId.startsWith(basePrefix)) return '';
    return folderId.slice(basePrefix.length).replace(/\/$/, '');
  }, []);

  const currentUploadFolderPath = useMemo(() => {
    if (!currentFolder || currentFolder.subfolderPath.length === 0) return '';
    return subfolderRelativePath(
      currentFolder.kbId,
      currentFolder.subfolderPath[currentFolder.subfolderPath.length - 1].id
    );
  }, [currentFolder, subfolderRelativePath]);

  const openAddSubfolder = useCallback((kbId: string, parentPath: string, parentDisplayName: string) => {
    setSubfolderTarget({ kbId, parentPath, parentDisplayName });
  }, []);

  const handleSubfolderCreated = useCallback(
    (newPath: string) => {
      const target = subfolderTarget;
      setSubfolderTarget(null);
      if (!target) return;

      const basePrefix = `documents/kb-${target.kbId}/`;
      const newFolderKey = `${basePrefix}${newPath}/`;

      // Optimistically add the marker so the new folder shows up immediately.
      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = prev.get(target.kbId);
        if (s) {
          if (!s.files.some((f) => f.Key === newFolderKey)) {
            next.set(target.kbId, {
              ...s,
              files: [...s.files, { Key: newFolderKey, LastModified: new Date(), Size: 0 }],
            });
          }
        }
        return next;
      });

      fetchKbFiles(target.kbId);
      fetchDeepKbFiles(target.kbId, true);
      showToast({
        message: t('createSubfolder.success', { defaultValue: 'Folder created' }),
        variant: 'success',
      });
    },
    [subfolderTarget, fetchKbFiles, fetchDeepKbFiles, showToast, t]
  );

  // ── Folder context menu ─────────────────────────────────────

  const openFolderContextMenu = useCallback((e: React.MouseEvent, target: FolderContextTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderContextMenu({
      show: true,
      position: { x: e.clientX, y: e.clientY },
      target,
    });
  }, []);

  const closeFolderContextMenu = useCallback(() => {
    setFolderContextMenu(null);
  }, []);

  // ── Delete handlers ─────────────────────────────────────────

  const confirmDeleteFiles = useCallback(
    (kbId: string, keys: string[], label?: string) => {
      const withMeta = keys.flatMap((k) => [k, `${k}.metadata.json`]);
      setDeleteConfirm({
        kind: 'files',
        kbId,
        keys: withMeta,
        label: label ?? t('delete.confirm', { count: keys.length }),
      });
    },
    [t]
  );

  const confirmDeleteSubfolder = useCallback(
    (kbId: string, folderId: string, folderName: string) => {
      const folderPrefix = folderId.endsWith('/') ? folderId : `${folderId}/`;
      const basePrefix = `documents/kb-${kbId}/`;
      if (!folderPrefix.startsWith(basePrefix)) return;
      const path = folderPrefix.slice(basePrefix.length).replace(/\/$/, '');
      if (!path) return;
      const state = kbFileStates.get(kbId);
      const childCount = state
        ? state.files.filter((f) => f.Key.startsWith(folderPrefix) && !f.Key.endsWith('/')).length
        : 0;
      setDeleteConfirm({
        kind: 'subfolder',
        kbId,
        path,
        label:
          childCount > 0
            ? t('delete.confirmFolder', { name: folderName, count: childCount })
            : t('delete.confirmEmptyFolder', {
                name: folderName,
                defaultValue: `Delete empty folder "${folderName}"?`,
              }),
      });
    },
    [kbFileStates, t]
  );

  const executeDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    setIsDeleting(true);
    try {
      if (deleteConfirm.kind === 'subfolder') {
        await knowledgeBaseService.deleteSubfolder(deleteConfirm.kbId, deleteConfirm.path, true);
        // Optimistically drop everything under the prefix.
        const folderPrefix = `documents/kb-${deleteConfirm.kbId}/${deleteConfirm.path}/`.replace(/\/{2,}/g, '/');
        setKbFileStates((prev) => {
          const next = new Map(prev);
          const s = prev.get(deleteConfirm.kbId);
          if (s) {
            next.set(deleteConfirm.kbId, {
              ...s,
              files: s.files.filter((f) => !f.Key.startsWith(folderPrefix)),
              expandedFolders: new Set([...s.expandedFolders].filter((id) => !id.startsWith(folderPrefix))),
              loadedFolders: new Set([...s.loadedFolders].filter((id) => !id.startsWith(folderPrefix))),
            });
          }
          return next;
        });
        showToast({
          message: t('delete.folderSuccess', { defaultValue: 'Folder deleted' }),
          variant: 'success',
        });
        setSelectedKeys(new Set());
        fetchKbFiles(deleteConfirm.kbId);
      } else {
        const result = await knowledgeBaseService.deleteKBFiles(deleteConfirm.kbId, deleteConfirm.keys);
        const realSucceeded = result.successful.filter((k) => !k.endsWith('.metadata.json')).length;
        const realFailed = result.failed.filter((f) => !f.key.endsWith('.metadata.json')).length;
        // Optimistically remove deleted files from state immediately.
        const deletedSet = new Set(result.successful);
        setKbFileStates((prev) => {
          const next = new Map(prev);
          const s = prev.get(deleteConfirm.kbId);
          if (s) {
            next.set(deleteConfirm.kbId, {
              ...s,
              files: s.files.filter((f) => !deletedSet.has(f.Key)),
            });
          }
          return next;
        });
        if (realFailed > 0) {
          showToast({
            message: t('delete.partial', { succeeded: realSucceeded, failed: realFailed }),
            variant: 'warning',
          });
        } else {
          showToast({ message: t('delete.success', { count: realSucceeded }), variant: 'success' });
        }
        setSelectedKeys(new Set());
        fetchKbFiles(deleteConfirm.kbId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast({ message: t('delete.error', { error: msg }), variant: 'error' });
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, showToast, t, fetchKbFiles]);

  // ── Bulk selection helpers ─────────────────────────────────

  /**
   * Extract the KB id encoded in an S3 key. Returns null when the key does
   * not live under a known prefix (eg synthetic state markers).
   */
  const kbIdFromKey = useCallback((key: string): string | null => {
    const match = key.match(/^documents\/kb-([^/]+)\//);
    return match ? match[1] : null;
  }, []);

  /**
   * Split the current selection into files vs folders and identify the
   * single source KB. When the selection spans multiple KBs we report it
   * as mixed so bulk actions can be disabled with a clear hint.
   */
  const selectionStats = useMemo(() => {
    const fileKeys: string[] = [];
    const folderKeys: string[] = [];
    const kbIds = new Set<string>();
    for (const key of selectedKeys) {
      const owningKb = kbIdFromKey(key);
      if (owningKb) kbIds.add(owningKb);
      if (key.endsWith('/')) folderKeys.push(key);
      else fileKeys.push(key);
    }
    return {
      fileKeys,
      folderKeys,
      kbIds,
      sourceKbId: kbIds.size === 1 ? Array.from(kbIds)[0] : null,
      isMixedKb: kbIds.size > 1,
      // A whole-KB root is in the selection — downloadable, but excluded from
      // bulk move/delete so a single checkbox can't relocate or wipe a KB.
      hasRootSelection: folderKeys.some(isKbRootKey),
    };
  }, [selectedKeys, kbIdFromKey]);

  const selectionSourceKb = useMemo(() => {
    const id = selectionStats.sourceKbId;
    if (!id) return null;
    if (rootKB && id === rootKB.kb_id) return rootKB;
    return allUserKBs.find((k) => k.kb_id === id) ?? null;
  }, [selectionStats.sourceKbId, rootKB, allUserKBs]);

  const canBulkAct = !!selectionSourceKb && !selectionStats.isMixedKb && canEditKb(selectionSourceKb.kb_id);

  /** Keys carved out of a selected folder (the key itself or any ancestor exclusion). */
  const isKeyExcluded = useCallback(
    (key: string) => excludedKeys.has(key) || [...excludedKeys].some((e) => key.startsWith(e)),
    [excludedKeys]
  );

  /** An exclusion is live only while its covering folder is still selected. */
  const hasActiveExclusions = useMemo(
    () =>
      excludedKeys.size > 0 && [...excludedKeys].some((e) => selectionStats.folderKeys.some((fk) => e.startsWith(fk))),
    [excludedKeys, selectionStats.folderKeys]
  );

  // Drop exclusions once the selection is cleared so they can't leak into a
  // later selection.
  useEffect(() => {
    if (selectedKeys.size === 0 && excludedKeys.size > 0) setExcludedKeys(new Set());
  }, [selectedKeys, excludedKeys]);

  /**
   * Toggle a row's selection. A file/folder toggled at the top level moves in or
   * out of `selectedKeys`. A row sitting *inside* an already-selected folder
   * instead flips its exclusion — the folder stays selected and its other items
   * ride along, so you can "select a folder, untick a few, keep the rest".
   */
  const toggleRowSelection = useCallback(
    (key: string) => {
      if (selectedKeys.has(key)) {
        // Directly selected → deselect it and drop any exclusions beneath it.
        setSelectedKeys((p) => {
          const n = new Set(p);
          n.delete(key);
          return n;
        });
        setExcludedKeys((p) => {
          if (p.size === 0) return p;
          const n = new Set([...p].filter((e) => !e.startsWith(key)));
          return n.size === p.size ? p : n;
        });
        return;
      }
      const coveringFolder = [...selectedKeys].find((fk) => fk.endsWith('/') && key !== fk && key.startsWith(fk));
      if (coveringFolder) {
        // Inside a selected folder → flip this item's exclusion.
        setExcludedKeys((p) => {
          const n = new Set(p);
          const excluded = p.has(key) || [...p].some((e) => key.startsWith(e));
          if (excluded) {
            for (const e of [...n]) if (e === key || e.startsWith(key)) n.delete(e);
          } else {
            for (const e of [...n]) if (e.startsWith(key)) n.delete(e); // prune redundant deeper excludes
            n.add(key);
          }
          return n;
        });
        return;
      }
      // Brand-new selection.
      setSelectedKeys((p) => {
        const n = new Set(p);
        n.add(key);
        return n;
      });
      setExcludedKeys((p) => {
        if (!p.has(key)) return p;
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    },
    [selectedKeys]
  );

  // ── Bulk actions ────────────────────────────────────────────

  const openBulkMove = useCallback(() => {
    if (!canBulkAct) return;
    setShowBulkMoveModal(true);
  }, [canBulkAct]);

  const executeBulkMove = useCallback(
    async (target: DestinationFolderPickerValue) => {
      if (!selectionSourceKb) return;
      const keys = Array.from(selectedKeys);
      if (keys.length === 0) return;
      setShowBulkMoveModal(false);
      await executeMove(selectionSourceKb.kb_id, keys, target.kbId, target.folderPath);
    },
    [executeMove, selectedKeys, selectionSourceKb]
  );

  const executeBulkDownload = useCallback(async () => {
    const { fileKeys, folderKeys, kbIds } = selectionStats;
    // Loose files the user explicitly carved out don't get downloaded.
    const looseFiles = fileKeys.filter((k) => !isKeyExcluded(k));
    if (looseFiles.length === 0 && folderKeys.length === 0) {
      showToast({
        message: t('bulk.downloadNothing', { defaultValue: 'Nothing selected to download.' }),
        variant: 'warning',
      });
      return;
    }
    setIsBulkDownloading(true);
    try {
      const folderHasExclusion = (fk: string): boolean => [...excludedKeys].some((e) => e.startsWith(fk));
      // A single whole, intact folder → structured zip listed straight from S3
      // (works even if no recursive listing is loaded in the UI).
      if (folderKeys.length === 1 && looseFiles.length === 0 && !folderHasExclusion(folderKeys[0])) {
        const folderKey = folderKeys[0];
        const folderName = folderKey.replace(/\/+$/u, '').split('/').pop() || 'folder';
        await downloadFolderAsZip(folderKey, dataBucket, region, getCredentials, `${folderName}.zip`);
        return;
      }
      // A single loose file → plain file download.
      if (looseFiles.length === 1 && folderKeys.length === 0) {
        const onlyKey = looseFiles[0];
        const filename = onlyKey.split('/').pop() || onlyKey;
        await downloadFileFromS3(onlyKey, dataBucket, region, getCredentials, filename);
        return;
      }
      // Mixed / multiple / partially-excluded → expand each selected folder to its
      // objects, drop excluded items, and zip everything, preserving paths relative
      // to each item's KB folder. When the selection spans KBs, prefix with the KB
      // segment so names can't collide.
      const mixedKb = kbIds.size > 1;
      const pathFor = (key: string): string => {
        const rel = zipPathFromKbKey(key);
        if (!mixedKb) return rel;
        const seg = key.match(/^documents\/([^/]+)\//u)?.[1] ?? 'files';
        return `${seg}/${rel}`;
      };
      const entries: { key: string; zipPath: string }[] = looseFiles.map((key) => ({ key, zipPath: pathFor(key) }));
      for (const folderKey of folderKeys) {
        const objs = await listObjectsInFolder(folderKey, dataBucket, region, getCredentials);
        for (const objKey of objs) {
          if (objKey.endsWith('/')) continue; // skip folder markers
          if (isKeyExcluded(objKey)) continue; // carved out by the user
          entries.push({ key: objKey, zipPath: pathFor(objKey) });
        }
      }
      if (entries.length === 0) {
        showToast({
          message: t('bulk.downloadEmpty', { defaultValue: 'The selected folders are empty.' }),
          variant: 'info',
        });
        return;
      }
      await downloadKeysAsZip(entries, dataBucket, region, getCredentials, 'numa-files.zip');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast({
        message: t('bulk.downloadError', { defaultValue: 'Download failed: {{error}}', error: msg }),
        variant: 'error',
      });
    } finally {
      setIsBulkDownloading(false);
    }
  }, [dataBucket, region, getCredentials, selectionStats, excludedKeys, isKeyExcluded, showToast, t]);

  const openBulkDeleteConfirm = useCallback(() => {
    if (!selectionSourceKb) return;
    const sourceKbId = selectionSourceKb.kb_id;
    const basePrefix = `documents/kb-${sourceKbId}/`;
    const folderPaths = selectionStats.folderKeys
      .map((k) => (k.startsWith(basePrefix) ? k.slice(basePrefix.length).replace(/\/$/, '') : ''))
      .filter((p) => p.length > 0);
    const fileKeys = selectionStats.fileKeys;
    if (fileKeys.length === 0 && folderPaths.length === 0) return;
    const labelKey =
      fileKeys.length > 0 && folderPaths.length > 0
        ? 'bulk.confirmDeleteMixed'
        : folderPaths.length > 0
          ? 'bulk.confirmDeleteFolders'
          : 'bulk.confirmDeleteFiles';
    setBulkConfirm({
      kbId: sourceKbId,
      fileKeys,
      folderPaths,
      label: t(labelKey, {
        defaultValue:
          fileKeys.length > 0 && folderPaths.length > 0
            ? 'Delete {{files}} file(s) and {{folders}} folder(s)?'
            : folderPaths.length > 0
              ? 'Delete {{folders}} folder(s) and everything inside?'
              : 'Delete {{files}} file(s)?',
        files: fileKeys.length,
        folders: folderPaths.length,
      }),
    });
  }, [selectionSourceKb, selectionStats, t]);

  const executeBulkDelete = useCallback(async () => {
    if (!bulkConfirm) return;
    setIsBulkDeleting(true);
    const { kbId, fileKeys, folderPaths } = bulkConfirm;
    let succeededFiles = 0;
    let failedFiles = 0;
    let succeededFolders = 0;
    let failedFolders = 0;
    try {
      if (fileKeys.length > 0) {
        const withMeta = fileKeys.flatMap((k) => [k, `${k}.metadata.json`]);
        const result = await knowledgeBaseService.deleteKBFiles(kbId, withMeta);
        succeededFiles = result.successful.filter((k) => !k.endsWith('.metadata.json')).length;
        failedFiles = result.failed.filter((f) => !f.key.endsWith('.metadata.json')).length;
        const deletedSet = new Set(result.successful);
        setKbFileStates((prev) => {
          const next = new Map(prev);
          const s = prev.get(kbId);
          if (s) {
            next.set(kbId, { ...s, files: s.files.filter((f) => !deletedSet.has(f.Key)) });
          }
          return next;
        });
      }
      for (const path of folderPaths) {
        try {
          await knowledgeBaseService.deleteSubfolder(kbId, path, true);
          succeededFolders += 1;
          const folderPrefix = `documents/kb-${kbId}/${path}/`.replace(/\/{2,}/g, '/');
          setKbFileStates((prev) => {
            const next = new Map(prev);
            const s = prev.get(kbId);
            if (s) {
              next.set(kbId, {
                ...s,
                files: s.files.filter((f) => !f.Key.startsWith(folderPrefix)),
                expandedFolders: new Set([...s.expandedFolders].filter((id) => !id.startsWith(folderPrefix))),
                loadedFolders: new Set([...s.loadedFolders].filter((id) => !id.startsWith(folderPrefix))),
              });
            }
            return next;
          });
        } catch (folderErr) {
          failedFolders += 1;
          console.error('Bulk subfolder delete failed for', path, folderErr);
        }
      }
      const totalFailed = failedFiles + failedFolders;
      const totalSucceeded = succeededFiles + succeededFolders;
      if (totalFailed > 0) {
        showToast({
          message: t('bulk.deletePartial', {
            defaultValue: 'Deleted {{succeeded}} item(s); {{failed}} failed',
            succeeded: totalSucceeded,
            failed: totalFailed,
          }),
          variant: 'warning',
        });
      } else {
        showToast({
          message: t('bulk.deleteSuccess', {
            defaultValue: 'Deleted {{count}} item(s)',
            count: totalSucceeded,
          }),
          variant: 'success',
        });
      }
      setSelectedKeys(new Set());
      fetchKbFiles(kbId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast({ message: t('delete.error', { error: msg }), variant: 'error' });
    } finally {
      setIsBulkDeleting(false);
      setBulkConfirm(null);
    }
  }, [bulkConfirm, fetchKbFiles, showToast, t]);

  // ── Folder context menu actions ─────────────────────────────

  const handleContextMenuAction = useCallback(
    (action: FolderContextAction) => {
      const ctx = folderContextMenu;
      if (!ctx) return;
      const { target } = ctx;
      if (target.kind === 'integration') {
        // All integration actions are disabled in the menu, so a dispatch
        // shouldn't fire — guard explicitly in case that ever changes.
        return;
      }
      if (target.kind === 'topLevel') {
        const { kb } = target;
        if (action === 'addSubfolder') {
          openAddSubfolder(kb.kb_id, '', displayKbName(kb));
        } else if (action === 'upload') {
          setUploadTargetKb(kb);
          setShowUploadModal(true);
        } else if (action === 'settings') {
          // My Files is virtual (no DDB record) — sharing/permissions don't apply.
          if (kb.is_root) return;
          setSettingsKb(kb);
          setShowSettingsDrawer(true);
        } else if (action === 'delete') {
          // My Files cannot be deleted — it is auto-provisioned per user.
          if (kb.is_root) return;
          if (kb.role === 'OWNER') setTopLevelDeleteConfirm(kb);
        }
      } else {
        const { kbId, folderId, folderName } = target;
        if (action === 'addSubfolder') {
          const parentPath = subfolderRelativePath(kbId, folderId);
          openAddSubfolder(kbId, parentPath, folderName);
        } else if (action === 'delete') {
          confirmDeleteSubfolder(kbId, folderId, folderName);
        }
      }
    },
    [folderContextMenu, openAddSubfolder, confirmDeleteSubfolder, subfolderRelativePath, displayKbName]
  );

  const executeTopLevelDelete = useCallback(async () => {
    if (!topLevelDeleteConfirm) return;
    setIsDeletingTopLevel(true);
    try {
      await knowledgeBaseService.deleteKB(topLevelDeleteConfirm.kb_id);
      if (currentFolder?.kbId === topLevelDeleteConfirm.kb_id) setCurrentFolder(null);
      setExpandedKbs((prev) => {
        const n = new Set(prev);
        n.delete(topLevelDeleteConfirm.kb_id);
        return n;
      });
      showToast({
        message: t('delete.folderSuccess', { defaultValue: 'Folder deleted' }),
        variant: 'success',
      });
      refreshKBs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast({ message: t('delete.error', { error: msg }), variant: 'error' });
    } finally {
      setIsDeletingTopLevel(false);
      setTopLevelDeleteConfirm(null);
    }
  }, [topLevelDeleteConfirm, currentFolder, refreshKBs, showToast, t]);

  // ── Rename handlers ────────────────────────────────────────

  const openRename = useCallback((kbId: string, key: string, currentName: string) => {
    setRenameTarget({ kbId, key, currentName });
    setRenameValue(currentName);
  }, []);

  const executeRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const trimmed = renameValue.trim();
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      showToast({ message: t('rename.invalidName'), variant: 'error' });
      return;
    }
    setIsRenaming(true);
    try {
      const result = await knowledgeBaseService.renameKBFile(renameTarget.kbId, renameTarget.key, trimmed);
      // Optimistically swap old key for new key in state.
      setKbFileStates((prev) => {
        const next = new Map(prev);
        const s = prev.get(renameTarget.kbId);
        if (s) {
          next.set(renameTarget.kbId, {
            ...s,
            files: s.files.map((f) => (f.Key === result.sourceKey ? { ...f, Key: result.destKey } : f)),
          });
        }
        return next;
      });
      showToast({ message: t('rename.success', { name: trimmed }), variant: 'success' });
      fetchKbFiles(renameTarget.kbId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409|collision/i.test(msg)) {
        showToast({ message: t('rename.collision'), variant: 'error' });
      } else {
        showToast({ message: t('rename.error', { error: msg }), variant: 'error' });
      }
    } finally {
      setIsRenaming(false);
      setRenameTarget(null);
    }
  }, [renameTarget, renameValue, showToast, t, fetchKbFiles]);

  function handleSortToggle(column: SortColumn): void {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  // ── Loading / empty states ─────────────────────────────────

  const isInitialLoad = isLoadingKBs;
  const isRootKbLoading = rootKB ? (kbFileStates.get(rootKB.kb_id)?.isLoading ?? false) : false;

  // ── Build rows ─────────────────────────────────────────────

  const isInsideFolder = currentFolder !== null;
  const isInsideIntegration = currentIntegration !== null;
  const currentKb = isInsideFolder
    ? (allUserKBs.find((kb) => kb.kb_id === currentFolder.kbId) ??
      (rootKB && currentFolder.kbId === rootKB.kb_id ? rootKB : null))
    : null;
  const canEditCurrent = currentKb && (currentKb.role === 'OWNER' || currentKb.role === 'EDITOR');

  const currentDropTarget = useMemo(() => {
    if (currentFolder && currentKb && canEditCurrent) {
      return {
        kb: currentKb,
        folderPath: currentUploadFolderPath,
        // My Files now supports subfolders, so accept folder drops everywhere
        // a user can edit. The backend creates the S3 prefix on first object.
        rejectFolders: false,
      };
    }
    if (!currentFolder && rootKB) {
      return { kb: rootKB, folderPath: '', rejectFolders: false };
    }
    return null;
  }, [currentFolder, currentKb, canEditCurrent, currentUploadFolderPath, rootKB]);

  const handleFinderExternalDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!currentDropTarget || !isExternalFileDrag(e)) return;
      e.preventDefault();
      setIsExternalDragOver(true);
    },
    [currentDropTarget]
  );

  const handleFinderExternalDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!currentDropTarget || !isExternalFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsExternalDragOver(true);
    },
    [currentDropTarget]
  );

  const handleFinderExternalDragLeave = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsExternalDragOver(false);
    }
  }, []);

  const handleFinderExternalDrop = useCallback(
    (e: React.DragEvent) => {
      if (!currentDropTarget || !isExternalFileDrag(e)) return;
      void handleExternalUploadDrop(
        e,
        currentDropTarget.kb,
        currentDropTarget.folderPath,
        currentDropTarget.rejectFolders
      );
    },
    [currentDropTarget, handleExternalUploadDrop]
  );

  type RowEntry = {
    row: TableRow;
    kbId: string;
    isKbFolder: boolean;
    kb?: UserKB;
    special?: 'loading' | 'empty' | 'section' | 'createFolder' | 'connectIntegration';
    sectionTitle?: string;
    sectionBadge?: 'private' | 'shared' | 'remote';
    createFolderVisibility?: 'personal' | 'shared';
    /** Set on rows that represent a connected integration (rendered as a
     *  top-level folder inside the Remote Files section). Mutually exclusive
     *  with `kb` / `isKbFolder`. */
    integration?: ConnectedIntegration;
  };

  const rows: RowEntry[] = [];

  if (isInsideFolder) {
    // Inside a specific KB -- show its contents at depth 0
    const kbState = kbFileStates.get(currentFolder.kbId);
    const targetSubfolderId =
      currentFolder.subfolderPath.length > 0
        ? currentFolder.subfolderPath[currentFolder.subfolderPath.length - 1].id
        : null;
    const isSubfolderLoading = !!targetSubfolderId && !!kbState?.loadingFolders.has(targetSubfolderId);

    if (kbState?.isLoading || isSubfolderLoading) {
      rows.push({
        row: { id: 'loading', type: 'file', name: '', depth: 0, uploadDate: '', size: '', status: 'pending' },
        kbId: currentFolder.kbId,
        isKbFolder: false,
        special: 'loading',
      });
    } else {
      let childRows = buildKbChildRows(currentFolder.kbId, 0);

      // If we've navigated into subfolders, drill down to the target
      if (targetSubfolderId) {
        const allFlat = childRows;
        const folderIdx = allFlat.findIndex((r) => r.id === targetSubfolderId);
        if (folderIdx !== -1) {
          const folderDepth = allFlat[folderIdx].depth;
          const children: TableRow[] = [];
          for (let i = folderIdx + 1; i < allFlat.length; i++) {
            if (allFlat[i].depth <= folderDepth) break;
            children.push({ ...allFlat[i], depth: allFlat[i].depth - folderDepth - 1 });
          }
          childRows = children;
        }
      }

      if (childRows.length === 0 && kbState) {
        rows.push({
          row: { id: 'empty', type: 'file', name: '', depth: 0, uploadDate: '', size: '', status: 'indexed' },
          kbId: currentFolder.kbId,
          isKbFolder: false,
          special: 'empty',
        });
      } else {
        for (const r of childRows) rows.push({ row: r, kbId: currentFolder.kbId, isKbFolder: false });
      }
    }
  } else {
    // Root view — KBs are grouped into "My Files" (root + owned KBs) and
    // "Shared Files" (KBs shared with the user by others). The root KB
    // renders as "Personal" and is pinned first inside My Files. The "loose
    // files" surface at the root has been collapsed into the root KB so
    // files only appear in one place.
    const trimmedSearch = searchValue.trim();
    const anyFilterActive = !!trimmedSearch || filterPredicate.isActive;
    // Split rule: shared with other users (visible SHARED badge) → Shared
    // Files; otherwise → My Files. This matches the per-row badge so what
    // the user sees in the row aligns with which section it's grouped under.
    // The root KB is never shared so it always lands in My Files.
    const privateKBs = allUserKBs.filter((kb) => !kb.is_shared);
    const sharedSectionKBs = allUserKBs.filter((kb) => kb.is_shared);
    const myFilesKBs: UserKB[] = rootKB ? [rootKB, ...privateKBs] : privateKBs;

    const pushKbRows = (kb: UserKB) => {
      const kbState = kbFileStates.get(kb.kb_id);
      const isLoaded = !!kbState && !kbState.isLoading;
      const childRows = isLoaded ? buildKbChildRows(kb.kb_id, 1) : [];

      // When a search or filter is active, hide KBs that have no matching
      // content. Unloaded / loading KBs are hidden too (we eager-fetch them
      // via useEffect) so the list only shows KBs that genuinely match.
      if (anyFilterActive && childRows.length === 0) {
        return;
      }

      const isExpanded = anyFilterActive ? true : expandedKbs.has(kb.kb_id);
      rows.push({
        row: {
          id: `kb-${kb.kb_id}`,
          type: 'folder',
          name: displayKbName(kb),
          depth: 0,
          uploadDate: '\u2014',
          size: '\u2014',
          status: 'indexed',
        },
        kbId: kb.kb_id,
        isKbFolder: true,
        kb,
      });

      if (isExpanded) {
        if (kbState?.isLoading) {
          rows.push({
            row: {
              id: `kb-${kb.kb_id}-loading`,
              type: 'file',
              name: '',
              depth: 1,
              uploadDate: '',
              size: '',
              status: 'pending',
            },
            kbId: kb.kb_id,
            isKbFolder: false,
            special: 'loading',
          });
        } else {
          if (childRows.length === 0 && kbState) {
            rows.push({
              row: {
                id: `kb-${kb.kb_id}-empty`,
                type: 'file',
                name: '',
                depth: 1,
                uploadDate: '',
                size: '',
                status: 'indexed',
              },
              kbId: kb.kb_id,
              isKbFolder: false,
              special: 'empty',
            });
          } else {
            for (const r of childRows) rows.push({ row: r, kbId: kb.kb_id, isKbFolder: false });
          }
        }
      }
    };

    const sectionHeaderRow = (key: string, title: string, badge: 'private' | 'shared' | 'remote'): RowEntry => ({
      row: {
        id: `section-${key}`,
        type: 'file',
        name: title,
        depth: 0,
        uploadDate: '',
        size: '',
        status: 'indexed',
      },
      kbId: `section-${key}`,
      isKbFolder: false,
      special: 'section',
      sectionTitle: title,
      sectionBadge: badge,
    });

    const createFolderRow = (visibility: 'personal' | 'shared'): RowEntry => ({
      row: {
        id: `create-folder-${visibility}`,
        type: 'file',
        name: '',
        depth: 0,
        uploadDate: '',
        size: '',
        status: 'indexed',
      },
      kbId: `create-folder-${visibility}`,
      isKbFolder: false,
      special: 'createFolder',
      createFolderVisibility: visibility,
    });

    const connectIntegrationRow = (): RowEntry => ({
      row: {
        id: 'connect-integration',
        type: 'file',
        name: '',
        depth: 0,
        uploadDate: '',
        size: '',
        status: 'indexed',
      },
      kbId: 'connect-integration',
      isKbFolder: false,
      special: 'connectIntegration',
    });

    const pushIntegrationRow = (integration: ConnectedIntegration) => {
      rows.push({
        row: {
          id: `integration-${integration.id}`,
          type: 'folder',
          name: integration.displayName,
          depth: 0,
          uploadDate: '—',
          size: '—',
          status: 'indexed',
        },
        kbId: `integration-${integration.id}`,
        isKbFolder: false,
        integration,
      });
    };

    // Search/filter mode hides the create-folder affordance — it would just
    // be noise alongside filtered results.
    const showCreateRows = !anyFilterActive;

    // "My Files" section: header emitted only if at least one row landed.
    const myFilesStart = rows.length;
    for (const kb of myFilesKBs) pushKbRows(kb);
    if (rows.length > myFilesStart) {
      rows.splice(myFilesStart, 0, sectionHeaderRow('myFiles', t('sections.myFiles'), 'private'));
      if (showCreateRows) rows.push(createFolderRow('personal'));
    }

    // "Shared Files" section: only if there's at least one shared KB visible
    // after the search/filter pass.
    if (sharedSectionKBs.length > 0) {
      const sharedStart = rows.length;
      for (const kb of sharedSectionKBs) pushKbRows(kb);
      if (rows.length > sharedStart) {
        rows.splice(sharedStart, 0, sectionHeaderRow('sharedFiles', t('sections.sharedFiles'), 'shared'));
        if (showCreateRows) rows.push(createFolderRow('shared'));
      }
    } else if (showCreateRows) {
      // No shared KBs yet — still surface a "Shared Files" section with an
      // inline create row so the user can spin one up without using the
      // toolbar.
      rows.push(sectionHeaderRow('sharedFiles', t('sections.sharedFiles'), 'shared'));
      rows.push(createFolderRow('shared'));
    }

    // "Remote Files" section: connected integrations that expose a navigable
    // file tree (Google Drive, Dropbox, Synergy, …). Chat-only integrations
    // (Slack, simPRO, …) are excluded via the registry-derived isFileStore
    // flag — they don't belong in a file browser. Hidden when a search/filter
    // is active because their contents aren't part of the User Files index
    // and would silently miss matches. The trailing "+" row routes to the
    // Integrations page rather than creating a folder.
    if (dataConnectorsEnabled && !anyFilterActive) {
      const fileStoreIntegrations = integrations.filter((i) => i.isFileStore);
      const remoteStart = rows.length;
      for (const integration of fileStoreIntegrations) pushIntegrationRow(integration);
      if (rows.length > remoteStart) {
        rows.splice(remoteStart, 0, sectionHeaderRow('remoteFiles', t('sections.remoteFiles'), 'remote'));
        if (showCreateRows) rows.push(connectIntegrationRow());
      } else if (showCreateRows && !integrationsLoading) {
        // No file-store integrations connected yet — still surface the
        // section with the "Connect Integration" affordance so the user can
        // wire one up.
        rows.push(sectionHeaderRow('remoteFiles', t('sections.remoteFiles'), 'remote'));
        rows.push(connectIntegrationRow());
      }
    }
  }

  // Selectable rows in the current visible row set — used by the header
  // "select all" checkbox + the bulk bar's deselect action.
  const selectableRowKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of rows) {
      if (entry.special) continue;
      if (entry.isKbFolder) {
        // The whole-KB root row is selectable (for download); its key is the
        // KB's root prefix.
        if (entry.kb) keys.push(kbRootPrefix(entry.kb.kb_id));
        continue;
      }
      const isSubfolder = entry.row.type === 'folder';
      if (isSubfolder) {
        const folderKey = entry.row.id.endsWith('/') ? entry.row.id : `${entry.row.id}/`;
        keys.push(folderKey);
      } else if (entry.row.originalKey) {
        keys.push(entry.row.originalKey);
      }
    }
    return keys;
  }, [rows]);

  const selectedVisibleCount = useMemo(
    () => selectableRowKeys.reduce((count, k) => (selectedKeys.has(k) ? count + 1 : count), 0),
    [selectableRowKeys, selectedKeys]
  );
  const allVisibleSelected = selectableRowKeys.length > 0 && selectedVisibleCount === selectableRowKeys.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedKeys((prev) => {
      if (selectableRowKeys.length === 0) return prev;
      const fullyContained = selectableRowKeys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (fullyContained) {
        for (const k of selectableRowKeys) next.delete(k);
      } else {
        for (const k of selectableRowKeys) next.add(k);
      }
      return next;
    });
  }, [selectableRowKeys]);

  // ── Render ─────────────────────────────────────────────────

  const mainContent = (
    <div
      className={`finder-files ${isExternalDragOver ? 'finder-files--external-drop-over' : ''}`}
      onDragEnter={handleFinderExternalDragEnter}
      onDragOver={handleFinderExternalDragOver}
      onDragLeave={handleFinderExternalDragLeave}
      onDrop={handleFinderExternalDrop}
    >
      {uploadSuccess && (
        <Alert variant="success" dismissible onClose={() => setUploadSuccess(false)} className="mx-3 mt-2 mb-0">
          <i className="bi bi-check-circle me-2" />
          {t('upload.success')}
        </Alert>
      )}

      {/* Toolbar */}
      <div className="finder-toolbar">
        <div className="finder-toolbar__left">
          <div className="finder-toolbar__location">
            {isInsideIntegration && currentIntegration ? (
              <>
                <button
                  className="finder-toolbar__back"
                  onClick={() => {
                    if (integrationSubPath.length > 0) {
                      setIntegrationSubPath((prev) => prev.slice(0, -1));
                    } else {
                      setCurrentIntegration(null);
                      setIntegrationSubPath([]);
                    }
                  }}
                >
                  <i className="bi bi-chevron-left" />
                  {integrationSubPath.length > 0
                    ? integrationSubPath.length === 1
                      ? currentIntegration.displayName
                      : integrationSubPath[integrationSubPath.length - 2].name
                    : t('breadcrumb.userFiles')}
                </button>
                <span className="finder-toolbar__title">
                  <i className={`${currentIntegration.icon} me-2`} aria-hidden />
                  {integrationSubPath.length > 0
                    ? integrationSubPath[integrationSubPath.length - 1].name
                    : currentIntegration.displayName}
                </span>
              </>
            ) : isInsideFolder ? (
              <>
                <button
                  className={`finder-toolbar__back ${dragOverTarget === 'back' ? 'finder-toolbar__back--drop-over' : ''}`}
                  onClick={navigateBack}
                  onDragOver={(e) => onTargetDragOver(e, 'back', true)}
                  onDragLeave={() => onTargetDragLeave('back')}
                  onDrop={onDropOnBack}
                >
                  <i className="bi bi-chevron-left" />
                  {currentFolder.subfolderPath.length > 0
                    ? currentFolder.subfolderPath.length === 1
                      ? currentFolder.kbName
                      : currentFolder.subfolderPath[currentFolder.subfolderPath.length - 2].name
                    : t('breadcrumb.userFiles')}
                </button>
                <span className="finder-toolbar__title">
                  {currentFolder.subfolderPath.length > 0
                    ? currentFolder.subfolderPath[currentFolder.subfolderPath.length - 1].name
                    : currentFolder.kbName}
                  {isMoving && (
                    <Spinner
                      animation="border"
                      size="sm"
                      variant="secondary"
                      className="ms-2"
                      title={t('move.inProgress')}
                      style={{ width: '0.75rem', height: '0.75rem', verticalAlign: 'middle' }}
                    />
                  )}
                </span>
              </>
            ) : (
              (isInitialLoad || isRootKbLoading || isMoving || integrationsLoading) && (
                <Spinner
                  animation="border"
                  size="sm"
                  variant="secondary"
                  title={isMoving ? t('move.inProgress') : undefined}
                  style={{ width: '0.75rem', height: '0.75rem', verticalAlign: 'middle' }}
                />
              )
            )}
          </div>
          {/* Primary actions pinned to the left. Upload is the prominent
              primary purple button; New Folder is a subtle secondary next to
              it. Inside a folder these become Upload + New Subfolder. Hidden
              entirely while browsing an integration — those actions target
              the user's KBs and would be confusing in that context. */}
          <div className="finder-toolbar__primary">
            {isInsideIntegration && currentIntegration?.id === 'gmail' && (
              <button
                className="finder-btn finder-btn--primary finder-btn--labelled"
                onClick={() => setComposeEmailOpen(true)}
                title={t('compose.title', 'Compose')}
              >
                <i className="bi bi-pencil-square" />
                <span className="finder-btn__label">{t('compose.title', 'Compose')}</span>
              </button>
            )}
            {isInsideIntegration ? null : !isInsideFolder && rootKB ? (
              <button
                className="finder-btn finder-btn--primary finder-btn--labelled"
                onClick={(e) => openUploadForKb(rootKB, e)}
                title={t('rootFiles.uploadTooltip')}
              >
                <i className="bi bi-upload" />
                <span className="finder-btn__label">{t('actions.upload')}</span>
              </button>
            ) : isInsideFolder && canEditCurrent && currentKb ? (
              <button
                className="finder-btn finder-btn--primary finder-btn--labelled"
                onClick={(e) => openUploadForKb(currentKb, e, currentUploadFolderPath)}
                title={t('actions.upload')}
              >
                <i className="bi bi-upload" />
                <span className="finder-btn__label">{t('actions.upload')}</span>
              </button>
            ) : null}
            {isInsideIntegration ? null : !isInsideFolder ? (
              <button
                className="finder-btn finder-btn--labelled"
                onClick={() => openCreateModal()}
                title={t('actions.newFolderRootTooltip')}
              >
                <i className="bi bi-folder-plus" />
                <span className="finder-btn__label">{t('actions.newFolder')}</span>
              </button>
            ) : canEditCurrent && currentKb ? (
              <button
                className="finder-btn finder-btn--labelled"
                onClick={() =>
                  openAddSubfolder(
                    currentKb.kb_id,
                    currentFolder!.subfolderPath.length > 0
                      ? subfolderRelativePath(
                          currentKb.kb_id,
                          currentFolder!.subfolderPath[currentFolder!.subfolderPath.length - 1].id
                        )
                      : '',
                    currentFolder!.subfolderPath.length > 0
                      ? currentFolder!.subfolderPath[currentFolder!.subfolderPath.length - 1].name
                      : displayKbName(currentKb)
                  )
                }
                title={t('actions.newSubfolder')}
              >
                <i className="bi bi-folder-plus" />
                <span className="finder-btn__label">{t('actions.newSubfolder')}</span>
              </button>
            ) : null}
          </div>
        </div>
        {!isInsideIntegration && (
          <div className="finder-toolbar__actions">
            <div className="finder-search">
              <i className="bi bi-search finder-search__icon" />
              <input
                type="text"
                placeholder={tKb('fileExplorer.searchPlaceholder')}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </div>
            <select
              className="finder-filter-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as FileTypeCategory | 'all')}
              title={t('filters.type')}
            >
              <option value="all">
                {t('filters.type')}: {t('filters.all')}
              </option>
              <option value="pdf">{t('filters.types.pdf')}</option>
              <option value="document">{t('filters.types.document')}</option>
              <option value="spreadsheet">{t('filters.types.spreadsheet')}</option>
              <option value="presentation">{t('filters.types.presentation')}</option>
              <option value="text">{t('filters.types.text')}</option>
              <option value="image">{t('filters.types.image')}</option>
              <option value="other">{t('filters.types.other')}</option>
            </select>
            {uploaderOptions.length > 0 && (
              <select
                className="finder-filter-select"
                value={uploaderFilter}
                onChange={(e) => setUploaderFilter(e.target.value)}
                title={t('filters.uploadedBy')}
              >
                <option value="all">
                  {t('filters.uploadedBy')}: {t('filters.all')}
                </option>
                {uploaderOptions.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
            <select
              className="finder-filter-select"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as 'all' | 'today' | '7d' | '30d')}
            >
              <option value="all">
                {t('filters.date')}: {t('filters.all')}
              </option>
              <option value="today">{t('filters.dateOptions.today')}</option>
              <option value="7d">{t('filters.dateOptions.last7')}</option>
              <option value="30d">{t('filters.dateOptions.last30')}</option>
            </select>
            {selectedKeys.size > 0 && isInsideFolder && canEditCurrent && (
              <button
                className="finder-btn finder-btn--danger"
                onClick={() => confirmDeleteFiles(currentFolder!.kbId, Array.from(selectedKeys))}
                title={t('delete.confirm', { count: selectedKeys.size })}
              >
                <i className="bi bi-trash" />
                <span className="d-none d-sm-inline ms-1">{selectedKeys.size}</span>
              </button>
            )}
            <button
              className="finder-btn"
              onClick={() => {
                if (isInsideFolder) {
                  fetchKbFiles(currentFolder!.kbId);
                  fetchDeepKbFiles(currentFolder!.kbId, true);
                } else {
                  // Root view: force-refresh deep data for every KB — same scope
                  // as what a search activation does, just forced. Also shallow-
                  // refresh the root KB (the only one that renders inline files).
                  if (rootKB) fetchKbFiles(rootKB.kb_id);
                  const targets: string[] = [];
                  if (rootKB) targets.push(rootKB.kb_id);
                  for (const kb of allUserKBs) targets.push(kb.kb_id);
                  for (const kbId of targets) {
                    fetchDeepKbFiles(kbId, true);
                  }
                }
              }}
            >
              <i className="bi bi-arrow-clockwise" />
            </button>
          </div>
        )}
      </div>

      {isInsideIntegration && currentIntegration ? (
        <RemoteProviderBrowser
          providerId={currentIntegration.id}
          providerName={currentIntegration.displayName}
          providerIcon={currentIntegration.icon}
          subFolderPath={integrationSubPath}
          onSubFolderPathChange={setIntegrationSubPath}
        />
      ) : (
        <>
          {/* Column headers — only shown inside a folder. At root view, each
          section header row (MY FILES / SHARED FILES / REMOTE FILES) carries
          the column labels via grid cells to save a row of vertical space. */}
          {isInsideFolder && (
            <div className="finder-columns finder-grid-6">
              <div
                className={`finder-col finder-col--name ${sortColumn === 'name' ? 'finder-col--active' : ''}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                  handleSortToggle('name');
                }}
              >
                <input
                  type="checkbox"
                  className="finder-col__checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={toggleSelectAllVisible}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t('bulk.selectAllVisible', { defaultValue: 'Select all visible items' })}
                  disabled={selectableRowKeys.length === 0}
                />
                {tKb('fileExplorer.table.name')}
                {sortColumn === 'name' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
              </div>
              <div
                className={`finder-col ${sortColumn === 'type' ? 'finder-col--active' : ''}`}
                onClick={() => handleSortToggle('type')}
              >
                {tKb('fileExplorer.table.type')}
                {sortColumn === 'type' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
              </div>
              <div className="finder-col d-none d-lg-flex">{tKb('fileExplorer.table.addedBy')}</div>
              <div
                className={`finder-col d-none d-md-flex ${sortColumn === 'date' ? 'finder-col--active' : ''}`}
                onClick={() => handleSortToggle('date')}
              >
                {tKb('fileExplorer.table.modified')}
                {sortColumn === 'date' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
              </div>
              <div
                className={`finder-col d-none d-sm-flex ${sortColumn === 'size' ? 'finder-col--active' : ''}`}
                onClick={() => handleSortToggle('size')}
              >
                {tKb('fileExplorer.table.size')}
                {sortColumn === 'size' && <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />}
              </div>
              <div className="finder-col"></div>
            </div>
          )}

          {/* Search status hints */}
          {isFilterOrSearchActive && deepLoadingKbs.size > 0 && (
            <div className="finder-search-hint">
              <Spinner
                animation="border"
                size="sm"
                variant="secondary"
                style={{ width: '0.65rem', height: '0.65rem' }}
              />
              <span className="text-muted small">{t('search.loadingDeep')}</span>
            </div>
          )}
          {isFilterOrSearchActive && deepLoadingKbs.size === 0 && (
            <div className="finder-search-hint">
              <i className="bi bi-info-circle text-muted" style={{ fontSize: '0.75rem' }} />
              <span className="text-muted small">{t('search.cachedHint')}</span>
            </div>
          )}

          {/* File list */}
          <div className="finder-list">
            {rows.length === 0 ? (
              <div className="finder-empty">
                <i className="bi bi-folder" />
                <span>{allUserKBs.length === 0 ? t('folderList.empty.title') : tKb('fileExplorer.empty')}</span>
                {allUserKBs.length === 0 && (
                  <div className="d-flex gap-2 mt-2">
                    <button className="finder-btn finder-btn--primary" onClick={() => setShowCreateModal(true)}>
                      <i className="bi bi-folder-plus" /> {t('actions.newFolder')}
                    </button>
                    {rootKB && (
                      <button className="finder-btn finder-btn--primary" onClick={(e) => openUploadForKb(rootKB, e)}>
                        <i className="bi bi-upload" /> {t('rootFiles.upload')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              rows.map(
                ({
                  row,
                  kbId,
                  isKbFolder,
                  kb,
                  special,
                  sectionTitle,
                  sectionBadge,
                  createFolderVisibility,
                  integration,
                }) => {
                  if (special === 'createFolder') {
                    return (
                      <button
                        key={row.id}
                        type="button"
                        className="finder-create-folder-row"
                        onClick={() => openCreateModal(createFolderVisibility)}
                      >
                        <i className="bi bi-plus-lg" />
                        <span>
                          {createFolderVisibility === 'shared'
                            ? t('actions.newSharedFolder')
                            : t('actions.newPrivateFolder')}
                        </span>
                      </button>
                    );
                  }
                  if (special === 'connectIntegration') {
                    return (
                      <Link key={row.id} to="/integrations" className="finder-create-folder-row">
                        <i className="bi bi-plus-lg" />
                        <span>{t('sections.connectIntegration')}</span>
                      </Link>
                    );
                  }
                  if (special === 'section') {
                    return (
                      <div key={row.id} className="finder-section-header finder-grid-6">
                        <div className="finder-section-header__label">
                          <span className="finder-section-header__title">{sectionTitle}</span>
                          {sectionBadge === 'private' && (
                            <span
                              className="finder-row__visibility-badge finder-row__visibility-badge--private"
                              title={t('folderList.privateTooltip')}
                            >
                              <i className="bi bi-shield-lock-fill" />
                              {t('folderList.private')}
                            </span>
                          )}
                          {sectionBadge === 'shared' && (
                            <span
                              className="finder-row__visibility-badge finder-row__visibility-badge--shared"
                              title={t('folderList.sharing')}
                            >
                              <i className="bi bi-people-fill" />
                              {t('folderList.shared')}
                            </span>
                          )}
                          {sectionBadge === 'remote' && (
                            <span
                              className="finder-row__visibility-badge finder-row__visibility-badge--remote"
                              title={t('folderList.remoteTooltip', 'Connected integrations')}
                            >
                              <i className="bi bi-cloud-arrow-down-fill" />
                              {t('folderList.remote', 'Remote')}
                            </span>
                          )}
                        </div>
                        <div
                          className={`finder-col ${sortColumn === 'type' ? 'finder-col--active' : ''}`}
                          onClick={() => handleSortToggle('type')}
                        >
                          {tKb('fileExplorer.table.type')}
                          {sortColumn === 'type' && (
                            <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />
                          )}
                        </div>
                        <div className="finder-col d-none d-lg-flex">{tKb('fileExplorer.table.addedBy')}</div>
                        <div
                          className={`finder-col d-none d-md-flex ${sortColumn === 'date' ? 'finder-col--active' : ''}`}
                          onClick={() => handleSortToggle('date')}
                        >
                          {tKb('fileExplorer.table.modified')}
                          {sortColumn === 'date' && (
                            <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />
                          )}
                        </div>
                        <div
                          className={`finder-col d-none d-sm-flex ${sortColumn === 'size' ? 'finder-col--active' : ''}`}
                          onClick={() => handleSortToggle('size')}
                        >
                          {tKb('fileExplorer.table.size')}
                          {sortColumn === 'size' && (
                            <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} />
                          )}
                        </div>
                        <div className="finder-col"></div>
                      </div>
                    );
                  }
                  if (special === 'loading') {
                    return (
                      <div key={row.id} className="finder-loading">
                        <Spinner animation="border" size="sm" variant="secondary" />
                        <span>{tKb('fileExplorer.loadingFiles')}</span>
                      </div>
                    );
                  }
                  if (special === 'empty') {
                    return (
                      <div key={row.id} className="finder-empty" style={{ padding: '1.5rem' }}>
                        <i className="bi bi-inbox" style={{ fontSize: '1.5rem' }} />
                        <span>{tKb('fileExplorer.empty')}</span>
                      </div>
                    );
                  }

                  // Integration folder row — top-level entry that mirrors the KB
                  // folder row pattern: chevron toggles inline expansion, double-
                  // click drills into the integration's full browser view. Status
                  // badge + reconnect link surface any token issues without
                  // forcing the user out of the list.
                  if (integration) {
                    const badgeStatus: ConnectorStatus =
                      integration.status === 'connected'
                        ? 'connected'
                        : integration.status === 'error'
                          ? 'expired'
                          : 'check_failed';
                    const needsAttention = integration.status !== 'connected';
                    const isExpanded = expandedIntegrations.has(integration.id);
                    return (
                      <React.Fragment key={row.id}>
                        <div
                          className={[
                            'finder-row',
                            'finder-row--folder',
                            'finder-grid-6',
                            isExpanded ? 'finder-row--expanded' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onDoubleClick={() => {
                            setCurrentIntegration(integration);
                            setIntegrationSubPath([]);
                          }}
                          onContextMenu={(e) =>
                            openFolderContextMenu(e, {
                              kind: 'integration',
                              integrationId: integration.id,
                              integrationName: integration.displayName,
                            })
                          }
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="finder-row__name-content">
                            <span
                              className="finder-chevron"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleIntegrationExpansion(integration.id);
                              }}
                            >
                              <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
                            </span>
                            <i className={`${integration.icon} finder-icon finder-icon--folder`} aria-hidden />
                            <span className="finder-name">{integration.displayName}</span>
                            <ConnectorStatusBadge
                              status={badgeStatus}
                              detail={integration.errorMessage}
                              className="ms-2"
                            />
                            {needsAttention && (
                              <Link
                                to={`/integrations#${integration.id}`}
                                className="ms-2 small"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {t('integrationFolder.reconnectLink', 'Reconnect at Integrations')}
                              </Link>
                            )}
                          </div>
                          <div className="finder-row__meta finder-row__meta--type">
                            {t('integrationFolder.typeLabel', 'Integration')}
                          </div>
                          <div className="finder-row__meta d-none d-lg-block" />
                          <div className="finder-row__meta d-none d-md-block" />
                          <div className="finder-row__meta d-none d-sm-block" />
                          <div className="finder-row__actions" />
                        </div>
                        {isExpanded && (
                          <RemoteProviderInlineRows
                            providerId={integration.id}
                            baseDepth={1}
                            onRowContextMenu={(e) =>
                              openFolderContextMenu(e, {
                                kind: 'integration',
                                integrationId: integration.id,
                                integrationName: integration.displayName,
                              })
                            }
                            onFolderDoubleClick={() => {
                              setCurrentIntegration(integration);
                              setIntegrationSubPath([]);
                            }}
                          />
                        )}
                      </React.Fragment>
                    );
                  }

                  const isFolder = row.type === 'folder';
                  const kbState = kbFileStates.get(kbId);

                  // KB folder row at root level
                  if (isKbFolder && kb) {
                    const isExpanded = expandedKbs.has(kb.kb_id);
                    const isRootRow = !!kb.is_root;
                    const isOwner = kb.role === 'OWNER';
                    const isEditor = kb.role === 'EDITOR';
                    const canEdit = isOwner || isEditor;
                    const isDropTarget = dragOverTarget === row.id;
                    const dropDisabled = !canEdit;
                    const kbRootKey = kbRootPrefix(kb.kb_id);
                    const isKbRootSelected = selectedKeys.has(kbRootKey);
                    const isKbRootIndeterminate =
                      isKbRootSelected && [...excludedKeys].some((e) => e.startsWith(kbRootKey));
                    const isKbDownloading = downloadingFolderKey === kbRootKey;

                    return (
                      <div
                        key={row.id}
                        className={[
                          'finder-row',
                          'finder-row--folder',
                          'finder-grid-6',
                          isExpanded ? 'finder-row--expanded' : '',
                          isKbRootSelected ? 'finder-row--selected' : '',
                          isDropTarget ? 'finder-row--drop-over' : '',
                          isDragging && dropDisabled ? 'finder-row--viewer-disabled' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onDoubleClick={() => navigateIntoKb(kb)}
                        onContextMenu={(e) => openFolderContextMenu(e, { kind: 'topLevel', kb })}
                        onDragOver={(e) => onTargetDragOver(e, row.id, !dropDisabled)}
                        onDragLeave={() => onTargetDragLeave(row.id)}
                        onDrop={(e) => {
                          if (isExternalFileDrag(e)) {
                            void handleExternalUploadDrop(e, kb, '', false);
                          } else if (!dropDisabled) {
                            onDropOnKb(e, kb);
                          }
                        }}
                      >
                        <div className="finder-row__name-content">
                          <input
                            type="checkbox"
                            className="finder-row__checkbox"
                            ref={(el) => {
                              if (el) el.indeterminate = isKbRootIndeterminate;
                            }}
                            checked={isKbRootSelected && !isKbRootIndeterminate}
                            onChange={() => toggleRowSelection(kbRootKey)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t('bulk.selectFolder', { defaultValue: 'Select folder' })}
                          />
                          <span
                            className="finder-chevron"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleKbExpansion(kb.kb_id);
                            }}
                          >
                            <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
                          </span>
                          {isRootRow ? (
                            <i className="bi bi-person-circle finder-icon finder-icon--my-files" />
                          ) : (
                            <i className="bi bi-folder-fill finder-icon finder-icon--folder" />
                          )}
                          <span className="finder-name">{displayKbName(kb)}</span>
                          {!isOwner && !isRootRow && (
                            <span className="finder-row__badge">
                              {isEditor ? t('badges.editor') : t('badges.viewer')}
                            </span>
                          )}
                          {kbFileStates.get(kb.kb_id)?.truncated && (
                            <i
                              className="bi bi-exclamation-triangle-fill"
                              style={{ fontSize: '0.7rem', color: '#eab308' }}
                              title={t('search.truncatedTooltip')}
                            />
                          )}
                        </div>
                        <div className="finder-row__meta finder-row__meta--type"></div>
                        <div className="finder-row__meta d-none d-lg-block"></div>
                        <div className="finder-row__meta d-none d-md-block"></div>
                        <div className="finder-row__meta d-none d-sm-block">
                          {(() => {
                            const s = kbFileStates.get(kb.kb_id);
                            // Use the in-cache count once the KB has been deep-loaded
                            // (recursive + accurate). Fall back to the backend's
                            // root-level document_count before that.
                            const cached = s?.deepLoaded ? s.files.filter((f) => !f.Key.endsWith('/')).length : null;
                            const count = cached ?? kb.document_count ?? 0;
                            return count > 0 ? tKb('fileExplorer.table.items', { count }) : '';
                          })()}
                        </div>
                        <div className="finder-row__actions">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownloadFolder(kbRootKey, displayKbName(kb));
                            }}
                            disabled={isKbDownloading}
                            title={t('actions.downloadFolder', { defaultValue: 'Download folder as zip' })}
                          >
                            {isKbDownloading ? (
                              <Spinner animation="border" size="sm" style={{ width: '0.7rem', height: '0.7rem' }} />
                            ) : (
                              <i className="bi bi-download" />
                            )}
                          </button>
                          {canEdit && (
                            <>
                              <button onClick={(e) => openUploadForKb(kb, e)} title={t('actions.uploadFiles')}>
                                <i className="bi bi-upload" />
                              </button>
                              {!isRootRow && (
                                <button onClick={(e) => openSettings(kb, e)} title={t('folderList.settings')}>
                                  <i className="bi bi-gear" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // Child rows (files and subfolders)
                  const isSubfolder = isFolder;
                  const isSubfolderExpanded = isSubfolder && (kbState?.expandedFolders.has(row.id) ?? false);
                  const isSubfolderLoading = isSubfolder && (kbState?.loadingFolders.has(row.id) ?? false);
                  const rowCanEdit = canEditKb(kbId);
                  const folderSelectionKey = isSubfolder ? (row.id.endsWith('/') ? row.id : `${row.id}/`) : null;
                  const selectionKey = isSubfolder ? folderSelectionKey : (row.originalKey ?? null);
                  const isDirectlySelected = !!selectionKey && selectedKeys.has(selectionKey);
                  // Ticking a folder selects everything inside it (FEAT-216); items
                  // inside ride along unless explicitly carved back out via exclusions,
                  // so you can untick a few and keep the rest.
                  const isCoveredByFolder =
                    !!selectionKey &&
                    selectionStats.folderKeys.some((fk) => selectionKey !== fk && selectionKey.startsWith(fk));
                  const isExcluded = !!selectionKey && isKeyExcluded(selectionKey);
                  const isRowSelected = isDirectlySelected || (isCoveredByFolder && !isExcluded);
                  // A selected folder with some of its contents carved out shows a dash.
                  const isRowIndeterminate =
                    isSubfolder &&
                    isRowSelected &&
                    !!selectionKey &&
                    [...excludedKeys].some((e) => e !== selectionKey && e.startsWith(selectionKey));
                  const isRowDropTarget = isSubfolder && dragOverTarget === row.id;

                  return (
                    <div
                      key={row.id}
                      className={[
                        'finder-row',
                        'finder-grid-6',
                        isSubfolder ? 'finder-row--folder' : '',
                        `finder-row--depth-${row.depth}`,
                        isRowSelected ? 'finder-row--selected' : '',
                        isRowDropTarget ? 'finder-row--drop-over' : '',
                        !isSubfolder ? 'finder-row--file-selectable' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      draggable={(isSubfolder || !!row.originalKey) && rowCanEdit}
                      onDragStart={(e) => {
                        if (isSubfolder) {
                          onFolderDragStart(e, kbId, row.id);
                        } else if (row.originalKey) {
                          onFileDragStart(e, kbId, row.originalKey);
                        }
                      }}
                      onDragEnd={() => {
                        onFileDragEnd();
                      }}
                      onDragOver={(e) => {
                        if (isSubfolder) onTargetDragOver(e, row.id, rowCanEdit);
                      }}
                      onDragLeave={() => {
                        if (isSubfolder) onTargetDragLeave(row.id);
                      }}
                      onDrop={(e) => {
                        if (!isSubfolder || !rowCanEdit) return;
                        if (isExternalFileDrag(e)) {
                          const targetKb =
                            (rootKB && kbId === rootKB.kb_id
                              ? rootKB
                              : allUserKBs.find((candidate) => candidate.kb_id === kbId)) ?? null;
                          if (targetKb) {
                            void handleExternalUploadDrop(e, targetKb, subfolderRelativePath(kbId, row.id), false);
                          }
                        } else {
                          onDropOnSubfolder(e, kbId, row.id);
                        }
                      }}
                      onContextMenu={(e) => {
                        if (isSubfolder) {
                          openFolderContextMenu(e, {
                            kind: 'subfolder',
                            kbId,
                            folderId: row.id,
                            folderName: row.displayName || row.name,
                          });
                        }
                      }}
                      onClick={(e) => {
                        if (isSubfolder) {
                          handleFolderModifierClick(row.id, e);
                        } else if (row.originalKey) {
                          handleFileClick(row.originalKey, e);
                        }
                      }}
                      onDoubleClick={() => {
                        if (isSubfolder) {
                          navigateIntoSubfolder(kbId, row.id, row.displayName || row.name);
                        } else if (row.originalKey) {
                          const filename = row.name;
                          const isWc =
                            row.originalKey?.includes('web-crawler/') || row.originalKey?.includes('scraped-content/');
                          const ext = isWc ? 'md' : filename.includes('.') ? filename.split('.').pop() || '' : '';
                          handleOpenFilePreview({
                            filename,
                            fullPath: row.originalKey!,
                            relativePath: row.originalKey!,
                            extension: ext,
                          });
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="finder-row__name-content">
                        {selectionKey && (
                          <input
                            type="checkbox"
                            className="finder-row__checkbox"
                            ref={(el) => {
                              if (el) el.indeterminate = isRowIndeterminate;
                            }}
                            checked={isRowSelected && !isRowIndeterminate}
                            onChange={() => toggleRowSelection(selectionKey)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={
                              isSubfolder
                                ? t('bulk.selectFolder', { defaultValue: 'Select folder' })
                                : t('bulk.selectFile', { defaultValue: 'Select file' })
                            }
                          />
                        )}
                        {isSubfolder ? (
                          isSubfolderLoading ? (
                            <Spinner
                              animation="border"
                              size="sm"
                              variant="secondary"
                              style={{ width: '0.6rem', height: '0.6rem', flexShrink: 0 }}
                            />
                          ) : (
                            <span className="finder-chevron" onClick={() => toggleSubfolder(kbId, row.id)}>
                              <i className={`bi bi-chevron-${isSubfolderExpanded ? 'down' : 'right'}`} />
                            </span>
                          )
                        ) : (
                          <span className="finder-chevron-spacer" />
                        )}
                        {isSubfolder ? (
                          <i className="bi bi-folder-fill finder-icon finder-icon--folder" />
                        ) : (
                          <i
                            className={`${getFileIconClass(row.name)} finder-icon finder-icon--file ${getFileIconColorClass(row.name)}`}
                          />
                        )}
                        <span className="finder-name">{row.displayName || row.name}</span>
                      </div>
                      <div className="finder-row__meta finder-row__meta--type">
                        {isSubfolder
                          ? ''
                          : row.name.includes('.')
                            ? (row.name.split('.').pop()?.toUpperCase() ?? '')
                            : ''}
                      </div>
                      <div className="finder-row__meta d-none d-lg-block">
                        {!isSubfolder ? row.uploadedBy || '' : ''}
                      </div>
                      <div className="finder-row__meta d-none d-md-block">{!isSubfolder ? row.uploadDate : ''}</div>
                      <div className="finder-row__meta d-none d-sm-block">
                        {isSubfolder
                          ? (() => {
                              const state = kbFileStates.get(kbId);
                              if (!state) return '';
                              const prefix = row.id.endsWith('/') ? row.id : `${row.id}/`;
                              const count = state.files.filter(
                                (f) => f.Key.startsWith(prefix) && !f.Key.endsWith('/')
                              ).length;
                              return count > 0 ? tKb('fileExplorer.table.items', { count }) : '';
                            })()
                          : row.size}
                      </div>
                      <div className="finder-row__actions">
                        {isSubfolder && folderSelectionKey && (
                          <button
                            onClick={() => void handleDownloadFolder(folderSelectionKey, row.displayName || row.name)}
                            disabled={downloadingFolderKey === folderSelectionKey}
                            title={t('actions.downloadFolder', { defaultValue: 'Download folder as zip' })}
                          >
                            {downloadingFolderKey === folderSelectionKey ? (
                              <Spinner animation="border" size="sm" style={{ width: '0.7rem', height: '0.7rem' }} />
                            ) : (
                              <i className="bi bi-download" />
                            )}
                          </button>
                        )}
                        {!isSubfolder && row.originalKey && (
                          <>
                            <button
                              onClick={() => {
                                const filename = row.name;
                                const isWc =
                                  row.originalKey?.includes('web-crawler/') ||
                                  row.originalKey?.includes('scraped-content/');
                                const ext = isWc ? 'md' : filename.includes('.') ? filename.split('.').pop() || '' : '';
                                handleOpenFilePreview({
                                  filename,
                                  fullPath: row.originalKey!,
                                  relativePath: row.originalKey!,
                                  extension: ext,
                                });
                              }}
                              title={tKb('fileExplorer.actions.previewInPanel')}
                            >
                              <i className="bi bi-eye" />
                            </button>
                            <button
                              onClick={() => handleDownloadFile(row.originalKey!, row.name)}
                              title={tKb('fileExplorer.actions.downloadFile')}
                            >
                              <i className="bi bi-download" />
                            </button>
                            {rowCanEdit && (
                              <button
                                onClick={() => openRename(kbId, row.originalKey!, row.name)}
                                title={t('rename.title')}
                              >
                                <i className="bi bi-pencil" />
                              </button>
                            )}
                            {rowCanEdit && (
                              <button
                                onClick={() => confirmDeleteFiles(kbId, [row.originalKey!])}
                                title={t('delete.confirm', { count: 1 })}
                              >
                                <i className="bi bi-trash" />
                              </button>
                            )}
                          </>
                        )}
                        {isSubfolder && rowCanEdit && (
                          <button
                            onClick={() => confirmDeleteSubfolder(kbId, row.id, row.displayName || row.name)}
                            title={t('delete.confirm', { count: 1 })}
                          >
                            <i className="bi bi-trash" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }
              )
            )}
          </div>
        </>
      )}

      {/* Modals */}

      <CreateFolderModal
        show={showCreateModal}
        onHide={() => setShowCreateModal(false)}
        onSuccess={handleFolderCreated}
        initialVisibility={createModalVisibility}
      />

      {subfolderTarget && (
        <CreateSubfolderModal
          show
          kbId={subfolderTarget.kbId}
          parentPath={subfolderTarget.parentPath}
          parentDisplayName={subfolderTarget.parentDisplayName}
          onHide={() => setSubfolderTarget(null)}
          onSuccess={handleSubfolderCreated}
        />
      )}

      {folderContextMenu && (
        <FolderContextMenu
          show={folderContextMenu.show}
          position={folderContextMenu.position}
          target={folderContextMenu.target}
          canEdit={
            folderContextMenu.target.kind === 'topLevel'
              ? folderContextMenu.target.kb.role === 'OWNER' || folderContextMenu.target.kb.role === 'EDITOR'
              : folderContextMenu.target.kind === 'subfolder'
                ? canEditKb(folderContextMenu.target.kbId)
                : false
          }
          canDeleteTopLevel={
            folderContextMenu.target.kind === 'topLevel'
              ? folderContextMenu.target.kb.role === 'OWNER' && !folderContextMenu.target.kb.is_root
              : false
          }
          onClose={closeFolderContextMenu}
          onAction={handleContextMenuAction}
        />
      )}

      {/* Top-level folder delete confirmation (from context menu) */}
      <Modal show={!!topLevelDeleteConfirm} onHide={() => setTopLevelDeleteConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {t('delete.topLevelTitle', {
              name: topLevelDeleteConfirm?.kb_name ?? '',
              defaultValue: `Delete "${topLevelDeleteConfirm?.kb_name ?? ''}"?`,
            })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-0">
            {t('delete.topLevelMessage', {
              defaultValue: 'This folder and everything inside it will be permanently deleted. This cannot be undone.',
            })}
          </p>
        </Modal.Body>
        <Modal.Footer>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setTopLevelDeleteConfirm(null)}
            disabled={isDeletingTopLevel}
          >
            {t('rename.cancel')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={executeTopLevelDelete} disabled={isDeletingTopLevel}>
            {isDeletingTopLevel ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" />
                {t('delete.inProgress')}
              </>
            ) : (
              <>
                <i className="bi bi-trash me-1" />
                {t('delete.deleteFolderButton', { defaultValue: 'Delete folder' })}
              </>
            )}
          </button>
        </Modal.Footer>
      </Modal>

      {settingsKb && (
        <FolderSettingsDrawer
          show={showSettingsDrawer}
          onHide={() => setShowSettingsDrawer(false)}
          kbId={settingsKb.kb_id}
          kbName={settingsKb.kb_name}
          role={settingsKb.role}
          onDeleted={handleFolderDeleted}
          onUpdated={refreshKBs}
        />
      )}

      {(() => {
        if (!showUploadModal || !uploadTargetKb) return null;
        // `||` not `??` — the picker uses kbId='' as a "no KB chosen" state
        // when the user pops back to the KB list. We always need a real KB
        // to upload into, so fall back to the modal's original target.
        const effectiveKbId = uploadDestination?.kbId || uploadTargetKb.kb_id;
        const effectiveFolderPath = uploadDestination?.kbId ? uploadDestination.folderPath : '';
        const effectiveKb =
          (rootKB && effectiveKbId === rootKB.kb_id ? rootKB : allUserKBs.find((k) => k.kb_id === effectiveKbId)) ??
          uploadTargetKb;
        const effectiveKbName = displayKbName(effectiveKb);
        const isAtMyFilesRoot = !!rootKB && uploadTargetKb.kb_id === rootKB.kb_id;
        // Editable KB options for the picker. When opened from a specific
        // folder's upload button (eg the per-row Upload icon), lock the user
        // to that KB so they don't accidentally retarget elsewhere.
        const writableKBs = allUserKBs.filter((kb) => kb.role === 'OWNER' || kb.role === 'EDITOR');
        const pickerKBOptions = writableKBs.map((kb) => ({ kb, displayName: displayKbName(kb) }));
        const pickerRootOption = rootKB ? { kb: rootKB, displayName: displayKbName(rootKB) } : null;
        const lockedKbId = isAtMyFilesRoot ? undefined : uploadTargetKb.kb_id;
        return (
          <div className="modal show d-block kb-upload-modal-backdrop" onClick={closeUploadModal}>
            <div
              className="modal-dialog modal-dialog-centered modal-lg kb-upload-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    <i className="bi bi-upload me-2" />
                    {t('upload.title', { name: effectiveKbName })}
                  </h5>
                  <button type="button" className="btn-close" onClick={closeUploadModal} aria-label="Close" />
                </div>
                <div className="modal-body">
                  <p className="text-muted small mb-3">
                    {t('upload.body')}
                    <br />
                    <strong>{t('upload.noteLabel')}</strong> {t('upload.note')}
                  </p>
                  <DestinationFolderPicker
                    kbOptions={pickerKBOptions}
                    rootKBOption={pickerRootOption}
                    value={uploadDestination}
                    onChange={setUploadDestination}
                    loadFoldersForKB={loadFoldersForKB}
                    lockedKbId={lockedKbId}
                    label={t('upload.destinationLabel')}
                    helpText={t('upload.destinationHelp')}
                    onCreateFolder={
                      isAtMyFilesRoot
                        ? () => {
                            closeUploadModal();
                            setShowCreateModal(true);
                          }
                        : undefined
                    }
                  />
                  {uploadDestination?.kbId ? (
                    <FileUploader
                      onUploadSuccess={handleUploadSuccess}
                      onFileSelect={handleFileSelect}
                      clearFiles={clearFileUploader}
                      kb_id={effectiveKbId}
                      selectedFolder={effectiveFolderPath}
                      enableFolderUpload
                      preloadedFiles={droppedUploadBatch}
                      // Auto-upload stays for explicit per-folder drops only.
                      // When the user opened the modal from the My Files root
                      // they need to pick a destination first.
                      autoUploadPreloaded={!isAtMyFilesRoot}
                    />
                  ) : (
                    <div className="kb-upload-modal__hint">
                      <i className="bi bi-arrow-up me-2" />
                      {t('upload.pickDestinationHint', {
                        defaultValue: 'Pick a destination folder above to continue.',
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {showNotificationModal && (
        <NotificationModal
          type="warning"
          title={t('largeFile.title')}
          message={
            <div>
              <p>{t('largeFile.description')}</p>
              <ul className="mb-3">
                {pendingLargeFiles.map((file, i) => (
                  <li key={i}>
                    <strong>{file.name}</strong> ({formatFileSize(file.size)})
                  </li>
                ))}
              </ul>
              <p className="mb-0">{t('largeFile.warning')}</p>
            </div>
          }
          show={showNotificationModal}
          onHide={() => {
            setShowNotificationModal(false);
            setPendingLargeFiles([]);
            setClearFileUploader(true);
          }}
          onConfirm={() => {
            setShowNotificationModal(false);
            setPendingLargeFiles([]);
          }}
          confirmText={t('largeFile.confirmButton')}
          cancelText={t('largeFile.cancelButton')}
          showCancelButton
          size="lg"
        />
      )}

      {/* Delete confirmation modal */}
      <Modal show={!!deleteConfirm} onHide={() => setDeleteConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{deleteConfirm?.label}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-0">{t('delete.confirmMessage')}</p>
        </Modal.Body>
        <Modal.Footer>
          <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)} disabled={isDeleting}>
            {t('rename.cancel')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={executeDelete} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" />
                {t('delete.inProgress')}
              </>
            ) : (
              <>
                <i className="bi bi-trash me-1" />
                {deleteConfirm?.kind === 'subfolder'
                  ? t('delete.deleteFolderButton', { defaultValue: 'Delete folder' })
                  : t('delete.confirm', {
                      count:
                        deleteConfirm?.kind === 'files'
                          ? deleteConfirm.keys.filter((k) => !k.endsWith('.metadata.json')).length
                          : 0,
                    })}
              </>
            )}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Rename modal */}
      <Modal show={!!renameTarget} onHide={() => setRenameTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('rename.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <label className="form-label small">{t('rename.label')}</label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') executeRename();
            }}
            placeholder={t('rename.placeholder')}
            autoFocus
          />
        </Modal.Body>
        <Modal.Footer>
          <button className="btn btn-secondary btn-sm" onClick={() => setRenameTarget(null)} disabled={isRenaming}>
            {t('rename.cancel')}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={executeRename}
            disabled={isRenaming || !renameValue.trim() || renameValue.trim() === renameTarget?.currentName}
          >
            {isRenaming ? <Spinner animation="border" size="sm" /> : t('rename.confirm')}
          </button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={isMobile && showFilePreviewModal && !!filePreview}
        onHide={() => {
          setShowFilePreviewModal(false);
          closeFilePreview();
        }}
        fullscreen
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>{filePreview?.type === 'file' ? filePreview.filename : ''}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          {filePreview && (
            <FilePreviewPanel
              preview={filePreview}
              onClose={() => {
                setShowFilePreviewModal(false);
                closeFilePreview();
              }}
              bucket={dataBucket}
              region={region}
              getCredentials={getCredentials}
              embedded
            />
          )}
        </Modal.Body>
      </Modal>
      <ComposeEmailModal show={composeEmailOpen} onHide={() => setComposeEmailOpen(false)} provider="gmail" />

      {/* Bulk move destination picker */}
      {selectionSourceKb && (
        <DestinationFolderPickerModal
          show={showBulkMoveModal}
          onHide={() => setShowBulkMoveModal(false)}
          title={t('bulk.moveTitle', { defaultValue: 'Move {{count}} item(s)', count: selectedKeys.size })}
          description={t('bulk.moveDescription', {
            defaultValue: 'Pick a destination folder. Items keep their filenames and folder structure.',
          })}
          confirmLabel={t('bulk.moveConfirm', { defaultValue: 'Move here' })}
          onConfirm={(target) => void executeBulkMove(target)}
          inProgress={isMoving}
          kbOptions={allUserKBs
            .filter((kb) => kb.role === 'OWNER' || kb.role === 'EDITOR')
            .map((kb) => ({ kb, displayName: displayKbName(kb) }))}
          rootKBOption={rootKB ? { kb: rootKB, displayName: displayKbName(rootKB) } : null}
          loadFoldersForKB={loadFoldersForKB}
          initialValue={selectionSourceKb ? { kbId: selectionSourceKb.kb_id, folderPath: '' } : null}
        />
      )}

      {/* Bulk delete confirmation */}
      <Modal show={!!bulkConfirm} onHide={() => setBulkConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{bulkConfirm?.label}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-0">{t('delete.confirmMessage')}</p>
        </Modal.Body>
        <Modal.Footer>
          <button className="btn btn-secondary btn-sm" onClick={() => setBulkConfirm(null)} disabled={isBulkDeleting}>
            {t('rename.cancel')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={executeBulkDelete} disabled={isBulkDeleting}>
            {isBulkDeleting ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" />
                {t('delete.inProgress')}
              </>
            ) : (
              <>
                <i className="bi bi-trash me-1" />
                {t('bulk.deleteConfirmCta', { defaultValue: 'Delete' })}
              </>
            )}
          </button>
        </Modal.Footer>
      </Modal>

      <FilesBulkActionBar
        selectedCount={selectedKeys.size}
        fileCount={selectionStats.fileKeys.length}
        folderCount={selectionStats.folderKeys.length}
        canMove={canBulkAct && !selectionStats.hasRootSelection && !hasActiveExclusions && !isMoving && !isBulkDeleting}
        canDownload={(selectionStats.fileKeys.length > 0 || selectionStats.folderKeys.length > 0) && !isBulkDownloading}
        canDelete={canBulkAct && !selectionStats.hasRootSelection && !hasActiveExclusions && !isBulkDeleting}
        inProgress={isMoving || isBulkDeleting || isBulkDownloading}
        onMove={openBulkMove}
        onDownload={() => void executeBulkDownload()}
        onDelete={openBulkDeleteConfirm}
        onClear={() => setSelectedKeys(new Set())}
        warning={
          selectionStats.isMixedKb
            ? t('bulk.mixedKbWarning', {
                defaultValue:
                  'Selection spans multiple folders — move and delete are disabled until you narrow it down.',
              })
            : selectionStats.hasRootSelection
              ? t('bulk.rootSelectionWarning', {
                  defaultValue:
                    'Whole folders can be downloaded, but move and delete are disabled to protect against wiping a folder.',
                })
              : hasActiveExclusions
                ? t('bulk.partialSelectionWarning', {
                    defaultValue:
                      'You’ve unticked items inside a selected folder. Partial selections can be downloaded, but move and delete are disabled.',
                  })
                : !canBulkAct && selectionSourceKb && !canEditKb(selectionSourceKb.kb_id)
                  ? t('bulk.readOnlyWarning', {
                      defaultValue: "You can't change items in a folder you only have view access to.",
                    })
                  : undefined
        }
      />
    </div>
  );

  return (
    <ResizableSplitView
      left={mainContent}
      right={
        showFilePreview && filePreview ? (
          <FilePreviewPanel
            preview={filePreview}
            onClose={closeFilePreview}
            bucket={dataBucket}
            region={region}
            getCredentials={getCredentials}
          />
        ) : (
          <div />
        )
      }
      showRight={showFilePreview && !!filePreview && !isMobile}
      leftFraction={filePreviewLeftFraction}
      onLeftFractionChange={setFilePreviewLeftFraction}
      minLeft={300}
      minRight={300}
      rightPadding="0"
    />
  );
}
