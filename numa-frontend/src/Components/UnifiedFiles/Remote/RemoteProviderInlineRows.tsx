/**
 * Inline (chevron-expanded) view of an integration's contents inside the
 * User Files root list. Mirrors the way KB folders inline-expand: rows are
 * rendered as plain `<div className="finder-row finder-grid-6">` fragments
 * so they merge cleanly into the parent finder-list, with depth-aware
 * indentation that continues from the integration row above.
 *
 * Branches by connector type:
 *   - OAuth providers     → `useRemoteTree` (`/oauth-files/{id}/list`)
 *   - Synergy (PAT-backed)→ jobs → folders → folder-items via
 *                           `SynergyDataConnectorService`
 *
 * The Synergy path can't share `useRemoteTree` because the backend exposes
 * three distinct endpoints with different shapes (jobs vs folders vs items)
 * rather than a single recursive list endpoint.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, InputGroup, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useToast } from '../../../Providers/ToastContext';
import { ROOT_FOLDER_KEY, useRemoteTree } from '../../../hooks/useRemoteTree';
import { ConnectorsService } from '../../../Services/ConnectorsService';
import { getFlag } from '../../../utils/featureFlags';
import { SynergyDataConnectorService } from '../../../Services/SynergyDataConnectorService';
import { getFileIcon, formatFileSize } from '../../../Services/filesService';
import { extractApiError } from '../../../utils/extractApiError';
import type { OAuthFile, OAuthFolder } from '../../../types/oauthProviders';
import type { SynergyFolder, SynergyJob, SynergyFile } from '../../../types/synergySync';
import { SynergyFileContextMenu, type SynergyFileAction } from '../../Synergy/SynergyFileContextMenu';
import { SynergyVersionHistoryModal } from '../../Synergy/SynergyVersionHistoryModal';
import { SynergyFileDetailsModal } from '../../Synergy/SynergyFileDetailsModal';

/**
 * Trigger a browser download for a remote-provider file. Common helper so
 * both the OAuth and Synergy inline-row paths can wire a download button
 * without duplicating the blob → anchor → revoke dance.
 */
async function downloadInlineFile(
  providerId: string,
  fileId: string,
  fileName: string,
  showToast: (opts: { message: string; variant: 'error' | 'success' }) => void,
  errorFallback: string
): Promise<void> {
  try {
    const blob = await ConnectorsService.files.download(providerId, fileId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast({ message: extractApiError(err, errorFallback), variant: 'error' });
  }
}

const SYNERGY_PROVIDER_ID = 'synergy';
const DEPTH_CAP = 5;

interface RemoteProviderInlineRowsProps {
  providerId: string;
  /** Starting indent for the rows. Integration row sits at depth 0, so
   *  children typically pass `baseDepth=1`. */
  baseDepth: number;
  /** Optional right-click handler applied to every inline row (folders +
   *  files) so the parent can open a context menu against the owning
   *  integration regardless of which sub-row was clicked. */
  onRowContextMenu?: (e: React.MouseEvent) => void;
  /** Double-click handler for sub-folder/job rows. Mirrors the KB
   *  sub-folder pattern — the chevron expands inline, double-clicking the
   *  row drills into a focused view. The `folder` arg is the row that was
   *  clicked ({ id, name } pulled from either a SynergyJob or SynergyFolder
   *  / OAuthFolder). The User Files inline view ignores the arg (drill
   *  goes to the integration's root regardless); the drill view uses it to
   *  push onto its sub-path. */
  onFolderDoubleClick?: (folder?: { id: string; name: string }) => void;
  /** When set, this is the "root" the inline rows render from — useful in
   *  the focused drill view where the user has navigated past the
   *  integration's top level. For OAuth it maps to `useRemoteTree`'s
   *  `rootFolderId`; for Synergy it switches the top-level fetch between
   *  `listJobs` (no path), `listJobFolders` (1 entry = job), and
   *  `listFolderItems` (2+ entries = folder). The User Files inline view
   *  always renders from the true root, so it omits this prop. */
  rootSubFolderPath?: { id: string; name: string }[];
  /** Synergy only: when non-empty, the rows switch to "search mode" and show
   *  files matching this query (by name + contents) within the current job
   *  (`rootSubFolderPath[0]`), instead of the browse tree. Synergy file search
   *  is job-scoped, so this is only meaningful when drilled into a job. */
  searchQuery?: string;
}

export function RemoteProviderInlineRows({
  providerId,
  baseDepth,
  onRowContextMenu,
  onFolderDoubleClick,
  rootSubFolderPath,
  searchQuery,
}: RemoteProviderInlineRowsProps): React.JSX.Element {
  if (providerId === SYNERGY_PROVIDER_ID) {
    return (
      <SynergyInlineRows
        baseDepth={baseDepth}
        onRowContextMenu={onRowContextMenu}
        onFolderDoubleClick={onFolderDoubleClick}
        rootSubFolderPath={rootSubFolderPath}
        searchQuery={searchQuery}
      />
    );
  }
  return (
    <OAuthInlineRows
      providerId={providerId}
      baseDepth={baseDepth}
      onRowContextMenu={onRowContextMenu}
      onFolderDoubleClick={onFolderDoubleClick}
      rootSubFolderPath={rootSubFolderPath}
    />
  );
}

// ---------------------------------------------------------------------------
// OAuth path
// ---------------------------------------------------------------------------

function OAuthInlineRows({
  providerId,
  baseDepth,
  onRowContextMenu,
  onFolderDoubleClick,
  rootSubFolderPath,
}: {
  providerId: string;
  baseDepth: number;
  onRowContextMenu?: (e: React.MouseEvent) => void;
  onFolderDoubleClick?: (folder?: { id: string; name: string }) => void;
  rootSubFolderPath?: { id: string; name: string }[];
}): React.JSX.Element {
  const { t } = useTranslation('files');
  const { showToast } = useToast();

  // Re-root the tree at the deepest sub-path entry when supplied (drill view
  // pattern). Empty / undefined → root listing for the provider.
  const rootFolderId =
    rootSubFolderPath && rootSubFolderPath.length > 0 ? rootSubFolderPath[rootSubFolderPath.length - 1].id : undefined;

  const { contents, expandedFolders, loadingFolders, rootLoading, toggleFolder, loadMore } = useRemoteTree({
    provider: providerId,
    rootFolderId,
    onError: (msg) => showToast({ message: extractApiError(msg, msg), variant: 'error' }),
  });

  type Row =
    | { kind: 'folder'; folder: OAuthFolder; depth: number }
    | { kind: 'file'; file: OAuthFile; depth: number }
    | { kind: 'load-more'; folderKey: string; depth: number }
    | { kind: 'inline-loading'; depth: number }
    | { kind: 'inline-empty'; depth: number };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const walk = (folderKey: string, depth: number): void => {
      const c = contents.get(folderKey);
      // When an expanded folder hasn't loaded contents yet (or the fetch
      // returned nothing), surface a placeholder row so the user sees
      // *something* changed when they clicked the chevron — silent
      // expansion reads as "nothing happened".
      if (!c) {
        if (folderKey !== ROOT_FOLDER_KEY && loadingFolders.has(folderKey)) {
          out.push({ kind: 'inline-loading', depth });
        }
        return;
      }
      for (const folder of c.folders) {
        out.push({ kind: 'folder', folder, depth });
        if (expandedFolders.has(folder.folder_id)) {
          walk(folder.folder_id, depth + 1);
        }
      }
      for (const file of c.files) {
        out.push({ kind: 'file', file, depth });
      }
      if (c.folders.length === 0 && c.files.length === 0 && folderKey !== ROOT_FOLDER_KEY) {
        out.push({ kind: 'inline-empty', depth });
      }
      if (c.nextPageToken) {
        out.push({ kind: 'load-more', folderKey, depth });
      }
    };
    walk(ROOT_FOLDER_KEY, baseDepth);
    return out;
  }, [contents, expandedFolders, loadingFolders, baseDepth]);

  if (rootLoading) {
    return (
      <div className={`finder-row finder-grid-6 finder-row--depth-${Math.min(baseDepth, DEPTH_CAP)}`}>
        <div className="finder-row__name-content">
          <span className="finder-chevron-spacer" />
          <Spinner animation="border" size="sm" variant="secondary" />
          <span className="text-muted small ms-2">{t('remote.loadingProviderFiles', { provider: providerId })}</span>
        </div>
        <div className="finder-row__meta finder-row__meta--type" />
        <div className="finder-row__meta d-none d-lg-block" />
        <div className="finder-row__meta d-none d-md-block" />
        <div className="finder-row__meta d-none d-sm-block" />
        <div className="finder-row__actions" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={`finder-row finder-grid-6 finder-row--depth-${Math.min(baseDepth, DEPTH_CAP)}`}>
        <div className="finder-row__name-content">
          <span className="finder-chevron-spacer" />
          <span className="text-muted small">{t('remote.folderEmpty', 'This folder is empty')}</span>
        </div>
        <div className="finder-row__meta finder-row__meta--type" />
        <div className="finder-row__meta d-none d-lg-block" />
        <div className="finder-row__meta d-none d-md-block" />
        <div className="finder-row__meta d-none d-sm-block" />
        <div className="finder-row__actions" />
      </div>
    );
  }

  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'folder') {
          return (
            <FolderRow
              key={`folder:${row.folder.folder_id}`}
              name={row.folder.name}
              depth={row.depth}
              isExpanded={expandedFolders.has(row.folder.folder_id)}
              isLoading={loadingFolders.has(row.folder.folder_id)}
              onToggle={() => toggleFolder(row.folder.folder_id)}
              onContextMenu={onRowContextMenu}
              onDoubleClick={
                onFolderDoubleClick
                  ? () => onFolderDoubleClick({ id: row.folder.folder_id, name: row.folder.name })
                  : undefined
              }
            />
          );
        }
        if (row.kind === 'file') {
          return (
            <FileRow
              key={`file:${row.file.file_id}`}
              name={row.file.name}
              size={row.file.size}
              modified={row.file.modified_at}
              depth={row.depth}
              onContextMenu={onRowContextMenu}
              onDownload={() =>
                downloadInlineFile(
                  providerId,
                  row.file.file_id,
                  row.file.name,
                  showToast,
                  t('remote.errors.downloadFailed', 'Failed to download file')
                )
              }
            />
          );
        }
        if (row.kind === 'load-more') {
          return (
            <LoadMoreRow
              key={`load-more:${row.folderKey}`}
              depth={row.depth}
              isLoading={loadingFolders.has(row.folderKey)}
              onLoadMore={() => loadMore(row.folderKey)}
            />
          );
        }
        if (row.kind === 'inline-loading') {
          return <InlinePlaceholderRow key={`loading-${row.depth}`} depth={row.depth} kind="loading" />;
        }
        return <InlinePlaceholderRow key={`empty-${row.depth}`} depth={row.depth} kind="empty" />;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Synergy path
// ---------------------------------------------------------------------------

function SynergyInlineRows({
  baseDepth,
  onRowContextMenu,
  onFolderDoubleClick,
  rootSubFolderPath,
  searchQuery,
}: {
  baseDepth: number;
  onRowContextMenu?: (e: React.MouseEvent) => void;
  onFolderDoubleClick?: (folder?: { id: string; name: string }) => void;
  rootSubFolderPath?: { id: string; name: string }[];
  searchQuery?: string;
}): React.JSX.Element {
  const { t } = useTranslation('files');
  const { numaGet } = useNumaRequest();
  const { showToast } = useToast();

  // SYNERGY_FILE_PARITY gates everything Phase A added: the rich metadata
  // columns, in-job search, and per-file actions (context menu / details /
  // history / copy link). When off, Synergy browsing falls back to the basic
  // jobs → folders → files + download experience.
  const parityEnabled = getFlag('SYNERGY_FILE_PARITY');

  // In-job file search. Synergy file search is job-scoped, so we search within
  // the job at the root of the current drill path. A non-empty `searchQuery`
  // switches the rows into a flat results list (see search-mode render below).
  const searchJobId = rootSubFolderPath && rootSubFolderPath.length > 0 ? rootSubFolderPath[0].id : null;
  const trimmedQuery = (searchQuery ?? '').trim();
  const searchActive = parityEnabled && trimmedQuery.length > 0 && !!searchJobId;
  const [searchResults, setSearchResults] = useState<SynergyFile[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);

  // Parity-gated metadata columns + per-file context menu. When the flag is
  // off these collapse to the pre-parity FileRow (name / size / modified +
  // download), so the branch ships dark.
  const fileMetaProps = useCallback(
    (file: SynergyFile) =>
      parityEnabled
        ? {
            revision: file.revision,
            version: file.version,
            documentStatus: file.document_status,
            state: file.state,
            isCheckedOut: file.is_checked_out,
            checkedOutBy: file.checked_out_by,
          }
        : {},
    [parityEnabled]
  );

  // Pagination matches the Google Drive Files surface: 10 rows per page,
  // "Load more" appends to existing state. Same value as `useRemoteTree`'s
  // PAGE_SIZE so the two surfaces feel identical when paginating.
  const PAGE_SIZE = 10;

  // Three rendering modes determined by `rootSubFolderPath`:
  //   * empty/undefined → jobs list (top-level Synergy navigation, used by
  //     the User Files inline expansion).
  //   * length 1        → folders inside a specific job (drill view rooted
  //     at a job).
  //   * length 2+       → subfolders + files inside a specific folder
  //     (drill view rooted at a folder, possibly arbitrarily deep).
  const rootMode = useMemo<
    { kind: 'jobs' } | { kind: 'job-folders'; jobId: string } | { kind: 'folder-items'; folderId: string }
  >(() => {
    if (!rootSubFolderPath || rootSubFolderPath.length === 0) return { kind: 'jobs' };
    if (rootSubFolderPath.length === 1) return { kind: 'job-folders', jobId: rootSubFolderPath[0].id };
    return { kind: 'folder-items', folderId: rootSubFolderPath[rootSubFolderPath.length - 1].id };
  }, [rootSubFolderPath]);

  // Top-level jobs: jobs list + next-page cursor (null when fully loaded)
  // + a separate loading flag for "load more" vs initial load so the
  // initial spinner doesn't double-render with the LoadMoreRow's spinner.
  const [jobs, setJobs] = useState<SynergyJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState<boolean>(true);
  const [jobsNextPage, setJobsNextPage] = useState<number | null>(null);
  const [jobsLoadingMore, setJobsLoadingMore] = useState<boolean>(false);

  // Rooted top-level (used when rootMode.kind !== 'jobs'). For
  // 'job-folders' mode we populate `rootedFolders` only; for
  // 'folder-items' mode both `rootedFolders` and `rootedFiles` are used.
  // Pagination cursor is single, walking folders-then-files (matches what
  // `get_folder_items` returns from the backend).
  const [rootedFolders, setRootedFolders] = useState<SynergyFolder[]>([]);
  const [rootedFiles, setRootedFiles] = useState<SynergyFile[]>([]);
  const [rootedLoading, setRootedLoading] = useState<boolean>(true);
  const [rootedNextPage, setRootedNextPage] = useState<number | null>(null);
  const [rootedLoadingMore, setRootedLoadingMore] = useState<boolean>(false);

  // Per-job folders: folders + next-page cursor.
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [jobFolders, setJobFolders] = useState<Map<string, SynergyFolder[]>>(new Map());
  const [jobFoldersNextPage, setJobFoldersNextPage] = useState<Map<string, number | null>>(new Map());
  const [loadingJobs, setLoadingJobs] = useState<Set<string>>(new Set());

  // Per-job inline search (jobs-mode tree). The tree can have several jobs
  // expanded at once and there's no single "current job", so search is scoped
  // per expanded job: each gets its own input + (when a query is active) a flat
  // results list that replaces that job's folder children. Parity-gated.
  const [jobSearchInput, setJobSearchInput] = useState<Map<string, string>>(new Map());
  const [jobSearchQuery, setJobSearchQuery] = useState<Map<string, string>>(new Map());
  const [jobSearchResults, setJobSearchResults] = useState<Map<string, SynergyFile[]>>(new Map());
  const [jobSearchLoading, setJobSearchLoading] = useState<Set<string>>(new Set());

  // Per-folder items: subfolders + files + next-page cursor (backend
  // returns a single combined cursor walking folders-then-files).
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderItems, setFolderItems] = useState<Map<string, { folders: SynergyFolder[]; files: SynergyFile[] }>>(
    new Map()
  );
  const [folderItemsNextPage, setFolderItemsNextPage] = useState<Map<string, number | null>>(new Map());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  const numaGetRef = useRef(numaGet);
  numaGetRef.current = numaGet;

  // Per-file context menu + details/history overlays.
  const [fileMenu, setFileMenu] = useState<{ file: SynergyFile; x: number; y: number } | null>(null);
  const [detailsFile, setDetailsFile] = useState<SynergyFile | null>(null);
  const [historyFile, setHistoryFile] = useState<SynergyFile | null>(null);

  const openFileMenu = useCallback((file: SynergyFile, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFileMenu({ file, x: e.clientX, y: e.clientY });
  }, []);

  const handleFileAction = useCallback(
    async (action: SynergyFileAction, file: SynergyFile): Promise<void> => {
      if (action === 'download') {
        await downloadInlineFile(
          SYNERGY_PROVIDER_ID,
          file.file_id,
          file.name,
          showToast,
          t('remote.errors.downloadFailed', 'Failed to download file')
        );
      } else if (action === 'details') {
        setDetailsFile(file);
      } else if (action === 'history') {
        setHistoryFile(file);
      } else if (action === 'copyLink') {
        try {
          const res = await SynergyDataConnectorService.getFileWeblink(numaGetRef.current, file.file_id);
          if (res.weblink) {
            await navigator.clipboard.writeText(res.weblink);
            showToast({ message: t('synergy.linkCopied', 'Link copied to clipboard'), variant: 'success' });
          } else {
            showToast({ message: t('synergy.linkFailed', 'No link available'), variant: 'error' });
          }
        } catch (err) {
          showToast({ message: extractApiError(err, t('synergy.linkFailed', 'Failed to get link')), variant: 'error' });
        }
      }
    },
    [showToast, t]
  );

  // Rendered in every return branch so the menu/modals are available regardless
  // of jobs vs rooted view.
  const overlays = (
    <>
      {fileMenu && (
        <SynergyFileContextMenu
          position={{ x: fileMenu.x, y: fileMenu.y }}
          onAction={(action) => void handleFileAction(action, fileMenu.file)}
          onClose={() => setFileMenu(null)}
        />
      )}
      <SynergyFileDetailsModal show={detailsFile !== null} file={detailsFile} onHide={() => setDetailsFile(null)} />
      <SynergyVersionHistoryModal
        show={historyFile !== null}
        fileId={historyFile?.file_id ?? null}
        fileName={historyFile?.name ?? ''}
        onHide={() => setHistoryFile(null)}
      />
    </>
  );

  // In-job search fetch. Runs whenever the query/job scope changes; clears the
  // results in browse mode. Job-scoped via SynergyDataConnectorService.searchFiles.
  useEffect(() => {
    if (!searchActive || !searchJobId) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void (async () => {
      try {
        const res = await SynergyDataConnectorService.searchFiles(numaGetRef.current, searchJobId, trimmedQuery);
        if (!cancelled) setSearchResults(res.items ?? []);
      } catch (err) {
        if (!cancelled) {
          setSearchResults([]);
          showToast({
            message: extractApiError(err, t('remote.errors.searchFailed', 'Search failed')),
            variant: 'error',
          });
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchActive, searchJobId, trimmedQuery, showToast, t]);

  // Top-level fetch: jobs OR rooted contents, depending on rootMode. Two
  // separate effects so the dep arrays stay tight — switching modes
  // remounts the component (see RemoteProviderBrowser's key), but keeping
  // the effects separated also keeps re-runs predictable when nothing
  // changes.
  useEffect(() => {
    if (rootMode.kind !== 'jobs') return;
    let cancelled = false;
    void (async () => {
      setJobsLoading(true);
      try {
        const res = await SynergyDataConnectorService.listJobs(numaGetRef.current, {
          page: 1,
          page_size: PAGE_SIZE,
        });
        if (!cancelled) {
          setJobs(res.items ?? []);
          const totalPages = res.total_pages ?? 1;
          setJobsNextPage(totalPages > 1 ? 2 : null);
        }
      } catch (err) {
        if (!cancelled) {
          showToast({
            message: extractApiError(err, t('remote.errors.loadJobs', 'Failed to load jobs')),
            variant: 'error',
          });
        }
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootMode.kind, showToast, t]);

  useEffect(() => {
    if (rootMode.kind === 'jobs') return;
    let cancelled = false;
    void (async () => {
      setRootedLoading(true);
      try {
        if (rootMode.kind === 'job-folders') {
          const res = await SynergyDataConnectorService.listJobFolders(numaGetRef.current, rootMode.jobId, {
            page: 1,
            page_size: PAGE_SIZE,
          });
          if (!cancelled) {
            setRootedFolders(res.items ?? []);
            setRootedFiles([]);
            const totalPages = res.total_pages ?? 1;
            setRootedNextPage(totalPages > 1 ? 2 : null);
          }
        } else {
          const res = await SynergyDataConnectorService.listFolderItems(numaGetRef.current, rootMode.folderId, {
            page: 1,
            page_size: PAGE_SIZE,
          });
          if (!cancelled) {
            setRootedFolders(res.subfolders ?? []);
            setRootedFiles(res.files ?? []);
            const totalPages = res.total_pages ?? 1;
            setRootedNextPage(totalPages > 1 ? 2 : null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          showToast({
            message: extractApiError(err, t('remote.errors.loadFolderContents', 'Failed to load folder contents')),
            variant: 'error',
          });
        }
      } finally {
        if (!cancelled) setRootedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // rootMode is a stable object per render (useMemo on rootSubFolderPath);
    // including it directly captures both the kind and the id.
  }, [rootMode, showToast, t]);

  // Load-more handler for the rooted top-level. Appends results into the
  // existing arrays so the user's scroll position is preserved. Like the
  // backend's slice, the cursor walks folders first then files.
  const loadMoreRooted = useCallback(async () => {
    if (rootMode.kind === 'jobs' || !rootedNextPage || rootedLoadingMore) return;
    setRootedLoadingMore(true);
    try {
      if (rootMode.kind === 'job-folders') {
        const res = await SynergyDataConnectorService.listJobFolders(numaGetRef.current, rootMode.jobId, {
          page: rootedNextPage,
          page_size: PAGE_SIZE,
        });
        setRootedFolders((prev) => [...prev, ...(res.items ?? [])]);
        const totalPages = res.total_pages ?? rootedNextPage;
        setRootedNextPage(rootedNextPage < totalPages ? rootedNextPage + 1 : null);
      } else {
        const res = await SynergyDataConnectorService.listFolderItems(numaGetRef.current, rootMode.folderId, {
          page: rootedNextPage,
          page_size: PAGE_SIZE,
        });
        setRootedFolders((prev) => [...prev, ...(res.subfolders ?? [])]);
        setRootedFiles((prev) => [...prev, ...(res.files ?? [])]);
        const totalPages = res.total_pages ?? rootedNextPage;
        setRootedNextPage(rootedNextPage < totalPages ? rootedNextPage + 1 : null);
      }
    } catch (err) {
      showToast({
        message: extractApiError(err, t('remote.errors.loadMore', 'Failed to load more')),
        variant: 'error',
      });
    } finally {
      setRootedLoadingMore(false);
    }
  }, [rootMode, rootedNextPage, rootedLoadingMore, showToast, t]);

  // "Load more" for the top-level jobs list. Appends the next page onto
  // the existing array and bumps the cursor (or clears it when the last
  // page lands). Errors leave the cursor unchanged so the user can retry.
  const loadMoreJobs = useCallback(async () => {
    if (!jobsNextPage || jobsLoadingMore) return;
    setJobsLoadingMore(true);
    try {
      const res = await SynergyDataConnectorService.listJobs(numaGetRef.current, {
        page: jobsNextPage,
        page_size: PAGE_SIZE,
      });
      const newItems = res.items ?? [];
      setJobs((prev) => [...prev, ...newItems]);
      const totalPages = res.total_pages ?? jobsNextPage;
      setJobsNextPage(jobsNextPage < totalPages ? jobsNextPage + 1 : null);
    } catch (err) {
      showToast({
        message: extractApiError(err, t('remote.errors.loadMore', 'Failed to load more')),
        variant: 'error',
      });
    } finally {
      setJobsLoadingMore(false);
    }
  }, [jobsNextPage, jobsLoadingMore, showToast, t]);

  // Per-job inline search handlers.
  const setJobInput = useCallback((jobId: string, value: string) => {
    setJobSearchInput((prev) => new Map(prev).set(jobId, value));
  }, []);

  const runJobSearch = useCallback(
    async (jobId: string) => {
      const query = (jobSearchInput.get(jobId) ?? '').trim();
      if (!query) return;
      setJobSearchQuery((prev) => new Map(prev).set(jobId, query));
      setJobSearchLoading((prev) => new Set(prev).add(jobId));
      try {
        const res = await SynergyDataConnectorService.searchFiles(numaGetRef.current, jobId, query);
        setJobSearchResults((prev) => new Map(prev).set(jobId, res.items ?? []));
      } catch (err) {
        setJobSearchResults((prev) => new Map(prev).set(jobId, []));
        showToast({
          message: extractApiError(err, t('remote.errors.searchFailed', 'Search failed')),
          variant: 'error',
        });
      } finally {
        setJobSearchLoading((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    },
    [jobSearchInput, showToast, t]
  );

  const clearJobSearch = useCallback((jobId: string) => {
    setJobSearchInput((prev) => new Map(prev).set(jobId, ''));
    setJobSearchQuery((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
    setJobSearchResults((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  const toggleJob = useCallback(
    async (jobId: string) => {
      const wasExpanded = expandedJobs.has(jobId);
      setExpandedJobs((prev) => {
        const next = new Set(prev);
        if (next.has(jobId)) next.delete(jobId);
        else next.add(jobId);
        return next;
      });
      if (wasExpanded || jobFolders.has(jobId)) return;
      setLoadingJobs((prev) => new Set(prev).add(jobId));
      try {
        const res = await SynergyDataConnectorService.listJobFolders(numaGetRef.current, jobId, {
          page: 1,
          page_size: PAGE_SIZE,
        });
        const folders = res.items ?? [];
        const totalPages = res.total_pages ?? 1;
        setJobFolders((prev) => new Map(prev).set(jobId, folders));
        setJobFoldersNextPage((prev) => new Map(prev).set(jobId, totalPages > 1 ? 2 : null));
      } catch (err) {
        showToast({
          message: extractApiError(err, t('remote.errors.loadFolders', 'Failed to load folders')),
          variant: 'error',
        });
      } finally {
        setLoadingJobs((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    },
    [expandedJobs, jobFolders, showToast, t]
  );

  // "Load more" for the folders inside a specific job. Same shape as
  // loadMoreJobs but keyed by jobId.
  const loadMoreJobFolders = useCallback(
    async (jobId: string) => {
      const nextPage = jobFoldersNextPage.get(jobId);
      if (!nextPage || loadingJobs.has(jobId)) return;
      setLoadingJobs((prev) => new Set(prev).add(jobId));
      try {
        const res = await SynergyDataConnectorService.listJobFolders(numaGetRef.current, jobId, {
          page: nextPage,
          page_size: PAGE_SIZE,
        });
        const newItems = res.items ?? [];
        setJobFolders((prev) => {
          const existing = prev.get(jobId) ?? [];
          return new Map(prev).set(jobId, [...existing, ...newItems]);
        });
        const totalPages = res.total_pages ?? nextPage;
        setJobFoldersNextPage((prev) => new Map(prev).set(jobId, nextPage < totalPages ? nextPage + 1 : null));
      } catch (err) {
        showToast({
          message: extractApiError(err, t('remote.errors.loadMore', 'Failed to load more')),
          variant: 'error',
        });
      } finally {
        setLoadingJobs((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    },
    [jobFoldersNextPage, loadingJobs, showToast, t]
  );

  const toggleFolder = useCallback(
    async (folderId: string) => {
      const wasExpanded = expandedFolders.has(folderId);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        return next;
      });
      if (wasExpanded || folderItems.has(folderId)) return;
      setLoadingFolders((prev) => new Set(prev).add(folderId));
      try {
        const res = await SynergyDataConnectorService.listFolderItems(numaGetRef.current, folderId, {
          page: 1,
          page_size: PAGE_SIZE,
        });
        const totalPages = res.total_pages ?? 1;
        setFolderItems((prev) =>
          new Map(prev).set(folderId, { folders: res.subfolders ?? [], files: res.files ?? [] })
        );
        setFolderItemsNextPage((prev) => new Map(prev).set(folderId, totalPages > 1 ? 2 : null));
      } catch (err) {
        showToast({
          message: extractApiError(err, t('remote.errors.loadFolderContents', 'Failed to load folder contents')),
          variant: 'error',
        });
      } finally {
        setLoadingFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      }
    },
    [expandedFolders, folderItems, showToast, t]
  );

  // "Load more" for a single folder's items. The backend returns a
  // combined cursor that walks subfolders first, then files — we merge
  // each side into its respective array so the UI keeps the same
  // "folders, then files" ordering.
  const loadMoreFolderItems = useCallback(
    async (folderId: string) => {
      const nextPage = folderItemsNextPage.get(folderId);
      if (!nextPage || loadingFolders.has(folderId)) return;
      setLoadingFolders((prev) => new Set(prev).add(folderId));
      try {
        const res = await SynergyDataConnectorService.listFolderItems(numaGetRef.current, folderId, {
          page: nextPage,
          page_size: PAGE_SIZE,
        });
        setFolderItems((prev) => {
          const existing = prev.get(folderId) ?? { folders: [], files: [] };
          return new Map(prev).set(folderId, {
            folders: [...existing.folders, ...(res.subfolders ?? [])],
            files: [...existing.files, ...(res.files ?? [])],
          });
        });
        const totalPages = res.total_pages ?? nextPage;
        setFolderItemsNextPage((prev) => new Map(prev).set(folderId, nextPage < totalPages ? nextPage + 1 : null));
      } catch (err) {
        showToast({
          message: extractApiError(err, t('remote.errors.loadMore', 'Failed to load more')),
          variant: 'error',
        });
      } finally {
        setLoadingFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      }
    },
    [folderItemsNextPage, loadingFolders, showToast, t]
  );

  // Empty / loading placeholders. Tracked separately for the two top-level
  // modes so jobs-mode messaging stays specific ("No jobs available") and
  // rooted-mode falls back to the generic empty state.
  const isJobsMode = rootMode.kind === 'jobs';
  const topLoading = isJobsMode ? jobsLoading : rootedLoading;
  const topEmpty = isJobsMode ? jobs.length === 0 : rootedFolders.length === 0 && rootedFiles.length === 0;

  // Search mode: a flat list of files matching the query within the current
  // job (name + contents), replacing the browse tree. Reuses the same FileRow
  // + per-file context menu / download / details / history wiring as browse.
  if (searchActive) {
    if (searchLoading) {
      return (
        <div className={`finder-row finder-grid-6 finder-row--depth-${Math.min(baseDepth, DEPTH_CAP)}`}>
          <div className="finder-row__name-content">
            <span className="finder-chevron-spacer" />
            <Spinner animation="border" size="sm" variant="secondary" />
            <span className="text-muted small ms-2">{t('synergy.searching', 'Searching…')}</span>
          </div>
          <div className="finder-row__meta finder-row__meta--type" />
          <div className="finder-row__meta d-none d-lg-block" />
          <div className="finder-row__meta d-none d-md-block" />
          <div className="finder-row__meta d-none d-sm-block" />
          <div className="finder-row__actions" />
        </div>
      );
    }
    if (searchResults.length === 0) {
      return (
        <div className={`finder-row finder-grid-6 finder-row--depth-${Math.min(baseDepth, DEPTH_CAP)}`}>
          <div className="finder-row__name-content">
            <span className="finder-chevron-spacer" />
            <span className="text-muted small">
              {t('synergy.noSearchResults', 'No files match your search in this job')}
            </span>
          </div>
          <div className="finder-row__meta finder-row__meta--type" />
          <div className="finder-row__meta d-none d-lg-block" />
          <div className="finder-row__meta d-none d-md-block" />
          <div className="finder-row__meta d-none d-sm-block" />
          <div className="finder-row__actions" />
        </div>
      );
    }
    return (
      <>
        {searchResults.map((file) => (
          <FileRow
            key={`syn-search-file:${file.file_id}`}
            name={file.name}
            size={file.size ?? undefined}
            modified={file.modified_at}
            subtitle={file.path ? file.path.split('/').slice(0, -1).join(' / ') : undefined}
            {...fileMetaProps(file)}
            depth={baseDepth}
            onContextMenu={(e) => openFileMenu(file, e)}
            onDownload={() =>
              downloadInlineFile(
                SYNERGY_PROVIDER_ID,
                file.file_id,
                file.name,
                showToast,
                t('remote.errors.downloadFailed', 'Failed to download file')
              )
            }
          />
        ))}
        {overlays}
      </>
    );
  }

  if (topLoading) {
    return (
      <div className={`finder-row finder-grid-6 finder-row--depth-${Math.min(baseDepth, DEPTH_CAP)}`}>
        <div className="finder-row__name-content">
          <span className="finder-chevron-spacer" />
          <Spinner animation="border" size="sm" variant="secondary" />
          <span className="text-muted small ms-2">{t('remote.loadingProviders', 'Loading…')}</span>
        </div>
        <div className="finder-row__meta finder-row__meta--type" />
        <div className="finder-row__meta d-none d-lg-block" />
        <div className="finder-row__meta d-none d-md-block" />
        <div className="finder-row__meta d-none d-sm-block" />
        <div className="finder-row__actions" />
      </div>
    );
  }

  if (topEmpty) {
    return (
      <div className={`finder-row finder-grid-6 finder-row--depth-${Math.min(baseDepth, DEPTH_CAP)}`}>
        <div className="finder-row__name-content">
          <span className="finder-chevron-spacer" />
          <span className="text-muted small">
            {isJobsMode
              ? t('remote.noJobsFound', 'No jobs available')
              : t('remote.folderEmpty', 'This folder is empty')}
          </span>
        </div>
        <div className="finder-row__meta finder-row__meta--type" />
        <div className="finder-row__meta d-none d-lg-block" />
        <div className="finder-row__meta d-none d-md-block" />
        <div className="finder-row__meta d-none d-sm-block" />
        <div className="finder-row__actions" />
      </div>
    );
  }

  // Recursive renderer: folder rows render their children inline when
  // expanded, walking `folderItems` to discover already-loaded subfolders.
  const renderFolderRow = (folder: SynergyFolder, depth: number): React.JSX.Element[] => {
    const out: React.JSX.Element[] = [];
    const isExpanded = expandedFolders.has(folder.folder_id);
    out.push(
      <FolderRow
        key={`syn-folder:${folder.folder_id}`}
        name={folder.name}
        depth={depth}
        isExpanded={isExpanded}
        isLoading={loadingFolders.has(folder.folder_id)}
        onToggle={() => void toggleFolder(folder.folder_id)}
        onContextMenu={onRowContextMenu}
        onDoubleClick={
          onFolderDoubleClick ? () => onFolderDoubleClick({ id: folder.folder_id, name: folder.name }) : undefined
        }
      />
    );
    if (isExpanded) {
      const items = folderItems.get(folder.folder_id);
      if (!items) {
        if (loadingFolders.has(folder.folder_id)) {
          out.push(<InlinePlaceholderRow key={`syn-loading:${folder.folder_id}`} depth={depth + 1} kind="loading" />);
        }
      } else {
        for (const sub of items.folders) {
          out.push(...renderFolderRow(sub, depth + 1));
        }
        for (const file of items.files) {
          out.push(
            <FileRow
              key={`syn-file:${file.file_id}`}
              name={file.name}
              size={file.size ?? undefined}
              modified={file.modified_at}
              {...fileMetaProps(file)}
              depth={depth + 1}
              onContextMenu={parityEnabled ? (e) => openFileMenu(file, e) : undefined}
              onDownload={() =>
                downloadInlineFile(
                  SYNERGY_PROVIDER_ID,
                  file.file_id,
                  file.name,
                  showToast,
                  t('remote.errors.downloadFailed', 'Failed to download file')
                )
              }
            />
          );
        }
        if (items.folders.length === 0 && items.files.length === 0) {
          out.push(<InlinePlaceholderRow key={`syn-empty:${folder.folder_id}`} depth={depth + 1} kind="empty" />);
        }
        // "Load more" for this folder's items, when more pages exist.
        const nextPage = folderItemsNextPage.get(folder.folder_id);
        if (nextPage) {
          out.push(
            <LoadMoreRow
              key={`syn-loadmore:${folder.folder_id}`}
              depth={depth + 1}
              isLoading={loadingFolders.has(folder.folder_id)}
              onLoadMore={() => void loadMoreFolderItems(folder.folder_id)}
            />
          );
        }
      }
    }
    return out;
  };

  // Rooted top-level render (drill view, past the synthetic root). The
  // folders/files at the root are rendered as top-level rows using the
  // same `renderFolderRow` / `FileRow` machinery the jobs path uses — so
  // chevron expansion + per-folder Load more + download all work the same
  // way. Job-folders mode has no files at this top level (jobs don't
  // expose files directly); folder-items mode renders both.
  if (!isJobsMode) {
    return (
      <>
        {rootedFolders.map((folder) => renderFolderRow(folder, baseDepth)).flat()}
        {rootedFiles.map((file) => (
          <FileRow
            key={`syn-rooted-file:${file.file_id}`}
            name={file.name}
            size={file.size ?? undefined}
            modified={file.modified_at}
            {...fileMetaProps(file)}
            depth={baseDepth}
            onContextMenu={parityEnabled ? (e) => openFileMenu(file, e) : undefined}
            onDownload={() =>
              downloadInlineFile(
                SYNERGY_PROVIDER_ID,
                file.file_id,
                file.name,
                showToast,
                t('remote.errors.downloadFailed', 'Failed to download file')
              )
            }
          />
        ))}
        {rootedNextPage && (
          <LoadMoreRow
            key="syn-loadmore-rooted"
            depth={baseDepth}
            isLoading={rootedLoadingMore}
            onLoadMore={() => void loadMoreRooted()}
          />
        )}
        {overlays}
      </>
    );
  }

  return (
    <>
      {jobs.map((job) => {
        const isExpanded = expandedJobs.has(job.job_id);
        const isLoading = loadingJobs.has(job.job_id);
        const folders = jobFolders.get(job.job_id) ?? [];
        const jobFoldersHasMore = jobFoldersNextPage.get(job.job_id);
        const activeJobQuery = jobSearchQuery.get(job.job_id);
        const jobSearching = jobSearchLoading.has(job.job_id);
        const jobResults = jobSearchResults.get(job.job_id) ?? [];
        return (
          <React.Fragment key={`syn-job:${job.job_id}`}>
            <FolderRow
              name={job.name}
              depth={baseDepth}
              isExpanded={isExpanded}
              isLoading={isLoading}
              onToggle={() => void toggleJob(job.job_id)}
              onContextMenu={onRowContextMenu}
              onDoubleClick={
                onFolderDoubleClick ? () => onFolderDoubleClick({ id: job.job_id, name: job.name }) : undefined
              }
            />
            {/* Per-job search box (parity-gated): scopes to this job, name + contents. */}
            {isExpanded && parityEnabled && (
              <SynergyJobSearchRow
                key={`syn-jobsearch:${job.job_id}`}
                depth={baseDepth + 1}
                value={jobSearchInput.get(job.job_id) ?? ''}
                hasQuery={!!activeJobQuery}
                loading={jobSearching}
                placeholder={t('synergy.searchInJob', 'Search files in this job (name or contents)')}
                clearLabel={t('synergy.clearSearch', 'Clear search')}
                onChange={(v) => setJobInput(job.job_id, v)}
                onSubmit={() => void runJobSearch(job.job_id)}
                onClear={() => clearJobSearch(job.job_id)}
              />
            )}
            {/* When a search is active for this job, its results replace the
                folder tree; otherwise show the normal folders + Load more. */}
            {isExpanded &&
              activeJobQuery &&
              (jobSearching ? (
                <InlinePlaceholderRow key={`syn-jrsearching:${job.job_id}`} depth={baseDepth + 1} kind="loading" />
              ) : jobResults.length === 0 ? (
                <InlinePlaceholderRow key={`syn-jrempty:${job.job_id}`} depth={baseDepth + 1} kind="empty" />
              ) : (
                jobResults.map((file) => (
                  <FileRow
                    key={`syn-jr-file:${job.job_id}:${file.file_id}`}
                    name={file.name}
                    size={file.size ?? undefined}
                    modified={file.modified_at}
                    subtitle={file.path ? file.path.split('/').slice(0, -1).join(' / ') : undefined}
                    {...fileMetaProps(file)}
                    depth={baseDepth + 1}
                    onContextMenu={(e) => openFileMenu(file, e)}
                    onDownload={() =>
                      downloadInlineFile(
                        SYNERGY_PROVIDER_ID,
                        file.file_id,
                        file.name,
                        showToast,
                        t('remote.errors.downloadFailed', 'Failed to download file')
                      )
                    }
                  />
                ))
              ))}
            {isExpanded && !activeJobQuery && folders.map((folder) => renderFolderRow(folder, baseDepth + 1)).flat()}
            {/* "Load more" for the job's top-level folders. Sits below the
                folder rows but inside the same expansion so it scrolls
                together with them. Hidden while showing search results. */}
            {isExpanded && !activeJobQuery && jobFoldersHasMore && (
              <LoadMoreRow
                key={`syn-loadmore-jf:${job.job_id}`}
                depth={baseDepth + 1}
                isLoading={loadingJobs.has(job.job_id)}
                onLoadMore={() => void loadMoreJobFolders(job.job_id)}
              />
            )}
          </React.Fragment>
        );
      })}
      {/* Top-level "Load more" for the jobs list itself. Anchored at
          baseDepth so it lines up with job rows. */}
      {jobsNextPage && (
        <LoadMoreRow
          key="syn-loadmore-jobs"
          depth={baseDepth}
          isLoading={jobsLoadingMore}
          onLoadMore={() => void loadMoreJobs()}
        />
      )}
      {overlays}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared row components
// ---------------------------------------------------------------------------

/** Per-job inline search input, rendered as a finder-row under an expanded job. */
function SynergyJobSearchRow({
  depth,
  value,
  hasQuery,
  loading,
  placeholder,
  clearLabel,
  onChange,
  onSubmit,
  onClear,
}: {
  depth: number;
  value: string;
  hasQuery: boolean;
  loading: boolean;
  placeholder: string;
  clearLabel: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div className={`finder-row finder-grid-6 finder-row--depth-${Math.min(depth, DEPTH_CAP)}`}>
      <div className="finder-row__name-content">
        <span className="finder-chevron-spacer" />
        <Form
          className="flex-grow-1"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <InputGroup size="sm">
            <Form.Control
              type="search"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
            />
            {hasQuery && (
              <Button variant="outline-secondary" onClick={onClear} title={clearLabel} aria-label={clearLabel}>
                <i className="bi bi-x-lg" aria-hidden="true" />
              </Button>
            )}
            <Button variant="primary" type="submit" disabled={!value.trim() || loading}>
              {loading ? <Spinner animation="border" size="sm" /> : <i className="bi bi-search" aria-hidden="true" />}
            </Button>
          </InputGroup>
        </Form>
      </div>
      <div className="finder-row__meta finder-row__meta--type" />
      <div className="finder-row__meta d-none d-lg-block" />
      <div className="finder-row__meta d-none d-md-block" />
      <div className="finder-row__meta d-none d-sm-block" />
      <div className="finder-row__actions" />
    </div>
  );
}

interface FolderRowProps {
  name: string;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Double-click handler. Mirrors the KB sub-folder pattern: clicking the
   *  chevron expands inline, double-clicking the row drills into a focused
   *  view of that folder. */
  onDoubleClick?: () => void;
}

function FolderRow({
  name,
  depth,
  isExpanded,
  isLoading,
  onToggle,
  onContextMenu,
  onDoubleClick,
}: FolderRowProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const cappedDepth = Math.min(depth, DEPTH_CAP);
  return (
    <div
      className={[
        'finder-row',
        'finder-grid-6',
        'finder-row--folder',
        isExpanded ? 'finder-row--expanded' : '',
        `finder-row--depth-${cappedDepth}`,
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={name}
      // Row-body click also toggles expansion. The 14px chevron is a small
      // hit target — matching the original Remote tab pattern (row + chevron
      // both toggle) ensures users always get expansion regardless of where
      // on the row they land. Chevron click uses stopPropagation so it
      // doesn't double-fire.
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="finder-row__name-content">
        {isLoading ? (
          <Spinner
            animation="border"
            size="sm"
            variant="secondary"
            style={{ width: '0.6rem', height: '0.6rem', flexShrink: 0 }}
          />
        ) : (
          <span
            className="finder-chevron"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-hidden
          >
            <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
          </span>
        )}
        <i className="bi bi-folder-fill finder-icon finder-icon--folder" aria-hidden />
        <span className="finder-name">{name}</span>
      </div>
      <div className="finder-row__meta finder-row__meta--type">{t('headers.folder', 'Folder')}</div>
      <div className="finder-row__meta d-none d-lg-block" />
      <div className="finder-row__meta d-none d-md-block" />
      <div className="finder-row__meta d-none d-sm-block" />
      <div className="finder-row__actions" />
    </div>
  );
}

interface FileRowProps {
  name: string;
  size?: number;
  modified?: string;
  depth: number;
  /** Optional muted second line under the name — used to show a file's folder
   *  path in flat search results (where rows aren't in their folder context). */
  subtitle?: string;
  /** Synergy parity metadata (optional; OAuth rows omit these). */
  revision?: string;
  version?: number;
  documentStatus?: string;
  state?: string;
  isCheckedOut?: boolean;
  checkedOutBy?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** When supplied, renders a download button in the row actions slot.
   *  The handler is wired up to `ConnectorsService.files.download` by the
   *  per-provider renderer (OAuthInlineRows / SynergyInlineRows). */
  onDownload?: () => void;
}

function FileRow({
  name,
  size,
  modified,
  depth,
  subtitle,
  revision,
  version,
  documentStatus,
  state,
  isCheckedOut,
  checkedOutBy,
  onContextMenu,
  onDownload,
}: FileRowProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const cappedDepth = Math.min(depth, DEPTH_CAP);
  const iconCls = getFileIcon(name);
  const [downloading, setDownloading] = useState(false);
  // Status column: prefer Document Status, fall back to a meaningful workflow
  // state ("None" is 12d's noise default, so suppress it).
  const status = documentStatus || (state && state !== 'None' ? state : '');
  // Rev/Version column, e.g. "Rev D · v6"; OAuth rows (no rev/ver) fall back
  // to the modified date so they're unchanged.
  const revVer =
    [revision ? `Rev ${revision}` : '', version != null ? `v${version}` : ''].filter(Boolean).join(' · ') || null;
  const handleDownload = async (e: React.MouseEvent): Promise<void> => {
    if (!onDownload) return;
    e.stopPropagation();
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className={`finder-row finder-grid-6 finder-row--depth-${cappedDepth}`} onContextMenu={onContextMenu}>
      <div className="finder-row__name-content">
        <span className="finder-chevron-spacer" />
        <i className={`${iconCls} finder-icon finder-icon--file`} aria-hidden />
        <span className="finder-name">{name}</span>
        {subtitle && (
          <span className="text-muted small ms-2 text-truncate" title={subtitle} style={{ minWidth: 0 }}>
            {subtitle}
          </span>
        )}
        {isCheckedOut && (
          <i
            className="bi bi-lock-fill text-warning ms-1"
            title={checkedOutBy ? t('remote.checkedOutBy', { name: checkedOutBy }) : t('remote.checkedOut')}
            aria-label={checkedOutBy ? t('remote.checkedOutBy', { name: checkedOutBy }) : t('remote.checkedOut')}
          />
        )}
      </div>
      <div className="finder-row__meta finder-row__meta--type">
        {name.includes('.') ? name.split('.').pop()?.toUpperCase() : ''}
      </div>
      <div className="finder-row__meta d-none d-lg-block">{status}</div>
      <div className="finder-row__meta d-none d-md-block" title={modified ?? undefined}>
        {revVer ?? modified ?? ''}
      </div>
      <div className="finder-row__meta d-none d-sm-block">{size != null ? formatFileSize(size) : ''}</div>
      <div className="finder-row__actions">
        {onDownload && (
          <button
            type="button"
            className="btn btn-link btn-sm p-1 text-secondary"
            onClick={(e) => void handleDownload(e)}
            title={t('remote.download', 'Download')}
            aria-label={t('remote.download', 'Download')}
            disabled={downloading}
          >
            {downloading ? (
              <Spinner animation="border" size="sm" style={{ width: '0.85rem', height: '0.85rem' }} />
            ) : (
              <i className="bi bi-download" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function InlinePlaceholderRow({ depth, kind }: { depth: number; kind: 'loading' | 'empty' }): React.JSX.Element {
  const { t } = useTranslation('files');
  const cappedDepth = Math.min(depth, DEPTH_CAP);
  return (
    <div className={`finder-row finder-grid-6 finder-row--depth-${cappedDepth}`}>
      <div className="finder-row__name-content">
        <span className="finder-chevron-spacer" />
        {kind === 'loading' ? (
          <span className="d-inline-flex align-items-center gap-2 text-muted small">
            <Spinner animation="border" size="sm" />
            <span>{t('remote.loadingFolders', 'Loading…')}</span>
          </span>
        ) : (
          <span className="text-muted small">{t('remote.folderEmpty', 'This folder is empty')}</span>
        )}
      </div>
      <div className="finder-row__meta finder-row__meta--type" />
      <div className="finder-row__meta d-none d-lg-block" />
      <div className="finder-row__meta d-none d-md-block" />
      <div className="finder-row__meta d-none d-sm-block" />
      <div className="finder-row__actions" />
    </div>
  );
}

interface LoadMoreRowProps {
  depth: number;
  isLoading: boolean;
  onLoadMore: () => void;
}

function LoadMoreRow({ depth, isLoading, onLoadMore }: LoadMoreRowProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const cappedDepth = Math.min(depth, DEPTH_CAP);
  return (
    <div className={`finder-row finder-grid-6 finder-row--depth-${cappedDepth}`}>
      <div className="finder-row__name-content">
        <span className="finder-chevron-spacer" />
        {isLoading ? (
          <span className="d-inline-flex align-items-center gap-1 text-muted small">
            <Spinner animation="border" size="sm" />
            <span>{t('remote.loadingMore', 'Loading…')}</span>
          </span>
        ) : (
          <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={onLoadMore}>
            {t('remote.loadMore', 'Load more')}
          </button>
        )}
      </div>
      <div className="finder-row__meta finder-row__meta--type" />
      <div className="finder-row__meta d-none d-lg-block" />
      <div className="finder-row__meta d-none d-md-block" />
      <div className="finder-row__meta d-none d-sm-block" />
      <div className="finder-row__actions" />
    </div>
  );
}
