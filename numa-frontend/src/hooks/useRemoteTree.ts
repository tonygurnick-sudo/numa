/**
 * Tree-expansion state for the Files > Integration Files tab.
 *
 * Lazy-loads a folder's children on first expand and keeps them in memory so
 * collapse/expand toggling is instant. Mirrors the pattern in
 * CompanyFilesTab/UserFilesTab — single flat row list, depth derived from
 * the path, expand state tracked in a Set.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectorsService } from '../Services/ConnectorsService';
import { extractApiError } from '../utils/extractApiError';
import type { OAuthFile, OAuthFolder } from '../types/oauthProviders';

/** Sentinel for the provider's root listing. */
export const ROOT_FOLDER_KEY = '__root__';

/** Page size for incremental folder loading. Matches the "load 10 at a
 *  time" UX from product. */
const PAGE_SIZE = 10;

export interface RemoteFolderContents {
  folders: OAuthFolder[];
  files: OAuthFile[];
  /** Next-page cursor returned by the provider, or null if fully loaded. */
  nextPageToken: string | null;
}

export interface UseRemoteTreeOpts {
  /** Stable provider id. Changing this resets all state. */
  provider: string | null;
  /** Optional folder id to treat as the tree's root. When supplied the
   *  initial fetch lists this folder's contents (not the provider's true
   *  root), which is how sub-folder drill-in is implemented — the parent
   *  navigates to a folder by re-mounting the tree with this set. */
  rootFolderId?: string;
  /** Called with a user-facing error when a folder load fails. */
  onError?: (message: string) => void;
}

export interface UseRemoteTreeReturn {
  /** Per-folder contents, keyed by `folder_id` (or `ROOT_FOLDER_KEY`). */
  contents: Map<string, RemoteFolderContents>;
  expandedFolders: Set<string>;
  loadingFolders: Set<string>;
  /** True until the root listing has been fetched at least once. */
  rootLoading: boolean;
  /** Toggle a folder's expanded state, fetching children lazily. */
  toggleFolder: (folderId: string) => void;
  /** Append the next page of children into an already-loaded folder. */
  loadMore: (folderId: string) => void;
  /** Force-refresh the root listing (e.g. on tab return). */
  reloadRoot: () => Promise<void>;
}

export function useRemoteTree({ provider, rootFolderId, onError }: UseRemoteTreeOpts): UseRemoteTreeReturn {
  const [contents, setContents] = useState<Map<string, RemoteFolderContents>>(new Map());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = useState(false);

  // Track the active provider so an in-flight fetch from a previous provider
  // can't leak its result into the new tree.
  const providerRef = useRef<string | null>(provider);
  // onError comes in as an inline lambda from most callers, which would
  // change identity every render. Pin it in a ref so fetchFolder stays
  // stable (and the provider-change useEffect doesn't fire on every render
  // → infinite loop).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // Snapshot of current contents for loadMore — avoids stale-closure
  // issues without putting `contents` in any useCallback dep array.
  const contentsRef = useRef(contents);
  contentsRef.current = contents;

  // Tracks the currently-active root for this hook instance. When the
  // parent navigates to a sub-folder, `rootFolderId` changes and the
  // reset-effect below re-keys the tree off the new root. Storing it in a
  // ref keeps `fetchFolder` stable while still letting it resolve the
  // right API folder for the synthetic ROOT_FOLDER_KEY.
  const rootFolderIdRef = useRef<string | undefined>(rootFolderId);
  rootFolderIdRef.current = rootFolderId;

  const fetchFolder = useCallback(async (folderId: string, pageToken?: string) => {
    const activeProvider = providerRef.current;
    if (!activeProvider) return;

    setLoadingFolders((prev) => {
      if (prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
    try {
      // ROOT_FOLDER_KEY is the in-memory sentinel; on the wire it maps
      // either to `undefined` (the provider's true root) or the parent's
      // chosen rootFolderId when drilled into a sub-folder.
      const apiFolderId = folderId === ROOT_FOLDER_KEY ? rootFolderIdRef.current : folderId;
      const data = await ConnectorsService.files.list(activeProvider, apiFolderId, PAGE_SIZE, pageToken);
      // Bail if the provider changed mid-flight.
      if (providerRef.current !== activeProvider) return;
      // Google Drive (and possibly other providers) returns folder entries
      // inside the `files` array with `is_folder: true` rather than in the
      // dedicated `folders` array. Normalise here so the renderer can treat
      // folders uniformly regardless of which bucket the API used.
      const folderShaped: OAuthFolder[] = data.files
        .filter((f) => f.is_folder)
        .map((f) => ({
          folder_id: f.file_id,
          name: f.name,
          parent_id: f.parent_id,
          path: f.path,
        }));
      const incomingFolders: OAuthFolder[] = [...data.folders, ...folderShaped];
      const incomingFiles: OAuthFile[] = data.files.filter((f) => !f.is_folder);

      setContents((prev) => {
        const next = new Map(prev);
        const existing = pageToken ? prev.get(folderId) : null;
        next.set(folderId, {
          folders: existing ? [...existing.folders, ...incomingFolders] : incomingFolders,
          files: existing ? [...existing.files, ...incomingFiles] : incomingFiles,
          nextPageToken: data.next_page_token ?? null,
        });
        return next;
      });
    } catch (err) {
      if (providerRef.current !== activeProvider) return;
      // Always log so the failure is never fully silent, even if the caller
      // didn't wire an onError handler. extractApiError unwraps the lambda's
      // structured `{ error: ... }` body — without it, users see axios's
      // useless "Request failed with status code N" generic.
      console.error(`[useRemoteTree] folder fetch failed (${folderId}):`, err);
      const message = extractApiError(err, 'Failed to load folder contents');
      onErrorRef.current?.(message);
    } finally {
      setLoadingFolders((prev) => {
        if (!prev.has(folderId)) return prev;
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  }, []);

  // Reset everything when the provider OR the chosen root folder changes.
  // The latter is how sub-folder drill-in is implemented — the parent
  // re-mounts the tree (or rerenders with a new rootFolderId) and we treat
  // that as a fresh tree starting from the new root.
  useEffect(() => {
    providerRef.current = provider;
    setContents(new Map());
    setExpandedFolders(new Set());
    setLoadingFolders(new Set());
    if (!provider) {
      setRootLoading(false);
      return;
    }
    setRootLoading(true);
    fetchFolder(ROOT_FOLDER_KEY).finally(() => {
      if (providerRef.current === provider) setRootLoading(false);
    });
  }, [provider, rootFolderId, fetchFolder]);

  const toggleFolder = useCallback(
    (folderId: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) {
          next.delete(folderId);
          return next;
        }
        next.add(folderId);
        return next;
      });
      // Lazy fetch on first expand only.
      setContents((prev) => {
        if (!prev.has(folderId)) {
          // Fire and forget — fetchFolder manages its own loading set.
          void fetchFolder(folderId);
        }
        return prev;
      });
    },
    [fetchFolder]
  );

  const loadMore = useCallback(
    (folderId: string) => {
      const c = contentsRef.current.get(folderId);
      if (!c?.nextPageToken) return;
      void fetchFolder(folderId, c.nextPageToken);
    },
    [fetchFolder]
  );

  const reloadRoot = useCallback(async () => {
    if (!providerRef.current) return;
    await fetchFolder(ROOT_FOLDER_KEY);
  }, [fetchFolder]);

  return {
    contents,
    expandedFolders,
    loadingFolders,
    rootLoading,
    toggleFolder,
    loadMore,
    reloadRoot,
  };
}
