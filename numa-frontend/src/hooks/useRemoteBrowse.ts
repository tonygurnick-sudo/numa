/**
 * Unified remote browsing hook for the Files page Remote tab.
 *
 * Consolidates all OAuth + Synergy browsing state, navigation handlers,
 * cache-first fetching, and prefetch orchestration into a single hook.
 * Replaces ~200 lines of inline state/handlers in Files.tsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  OAuthProviderType,
  OAuthProviderInfo,
  OAuthConnectionStatus,
  OAuthFile,
  OAuthFolder,
  OAuthBreadcrumb,
} from '../types/oauthProviders';
import type { SynergyJob, SynergyFolder, SynergyFile } from '../types/synergySync';
import { OAuthProvidersService } from '../Services/OAuthProvidersService';
import { SynergyDataConnectorService } from '../Services/SynergyDataConnectorService';
import {
  getRemoteFolder,
  setRemoteFolder,
  oauthCacheKey,
  synergyCacheKey,
  type RemoteFolderData,
  type RemoteJobsData,
} from '../utils/remoteFolderCache';
import { useRemotePrefetch } from './useRemotePrefetch';
import { getConnectorById, type CachingPolicy, CACHING_PRESETS } from '../Components/DataConnectors/connectorRegistry';

/** Resolve the caching TTL (in ms) for a provider. Falls back to 10 min. */
const getProviderTtlMs = (provider: string): number => {
  const connector = getConnectorById(provider);
  const policy: CachingPolicy = connector?.cachingPolicy ?? CACHING_PRESETS.cloudStorage;
  return policy.ttl * 1000;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

type ShowToast = (opts: { message: string; variant?: 'success' | 'error' | 'info' | 'warning' }) => void;

export type SynergyBreadcrumb = { label: string; type: 'root' | 'job' | 'folder'; id?: string };

export interface UseRemoteBrowseOpts {
  numaGet: NumaGet;
  showToast: ShowToast;
  enabledOAuthProviders: OAuthProviderInfo[];
  oauthProviderStatuses: Record<string, OAuthConnectionStatus>;
  synergyConnected: boolean;
  activeTab: string | null;
}

export interface UseRemoteBrowseReturn {
  // OAuth state
  oauthFolders: OAuthFolder[];
  oauthFiles: OAuthFile[];
  oauthBreadcrumbs: OAuthBreadcrumb[];
  oauthContentLoading: boolean;
  /** True when stale cache data is shown and a background revalidation is in progress. */
  oauthRevalidating: boolean;
  selectedOauthProvider: OAuthProviderType | null;

  // OAuth pagination
  oauthPageToken: string | null;
  oauthHasPrevPage: boolean;
  oauthCurrentPage: number;
  oauthTotalCount: number | null;
  handleOAuthNextPage: () => void;
  handleOAuthPrevPage: () => void;

  // Synergy state
  synergyJobs: SynergyJob[];
  synergyFolders: SynergyFolder[];
  synergyFiles: SynergyFile[];
  synergyBreadcrumbs: SynergyBreadcrumb[];
  synergyFoldersLoading: boolean;
  synergyJobsLoading: boolean;
  /** True when stale cache data is shown and a background revalidation is in progress. */
  synergyRevalidating: boolean;

  // Handlers
  handleOAuthProviderClick: (provider: OAuthProviderType) => void;
  handleOAuthFolderClick: (folder: OAuthFolder) => void;
  handleOAuthBreadcrumbClick: (index: number) => void;
  handleSynergyJobClick: (job: SynergyJob) => void;
  handleSynergyFolderClick: (folder: SynergyFolder) => void;
  handleSynergyBreadcrumbClick: (index: number) => void;
  loadSynergyJobs: () => void;
  setSelectedOauthProvider: (provider: OAuthProviderType | null) => void;

  /** Reset all remote state to the top-level provider list. */
  resetToRoot: () => void;
  /** Navigate into Synergy jobs view from the root level. */
  navigateToSynergyJobs: () => void;

  // Prefetch viewport registration
  observeFolder: (folderId: string, element: HTMLElement | null) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRemoteBrowse({
  numaGet,
  showToast,
  enabledOAuthProviders,
  oauthProviderStatuses,
  synergyConnected,
  activeTab,
}: UseRemoteBrowseOpts): UseRemoteBrowseReturn {
  const { t } = useTranslation('files');

  // --- OAuth state --------------------------------------------------------
  const [selectedOauthProvider, setSelectedOauthProvider] = useState<OAuthProviderType | null>(null);
  const [oauthFiles, setOauthFiles] = useState<OAuthFile[]>([]);
  const [oauthFolders, setOauthFolders] = useState<OAuthFolder[]>([]);
  const [oauthContentLoading, setOauthContentLoading] = useState(false);
  const [oauthRevalidating, setOauthRevalidating] = useState(false);
  const [oauthBreadcrumbs, setOauthBreadcrumbs] = useState<OAuthBreadcrumb[]>([]);

  // --- Synergy state ------------------------------------------------------
  const [synergyJobs, setSynergyJobs] = useState<SynergyJob[]>([]);
  const [synergyJobsLoading, setSynergyJobsLoading] = useState(false);
  const [synergyFolders, setSynergyFolders] = useState<SynergyFolder[]>([]);
  const [synergyFiles, setSynergyFiles] = useState<SynergyFile[]>([]);
  const [synergyFoldersLoading, setSynergyFoldersLoading] = useState(false);
  const [synergyRevalidating, setSynergyRevalidating] = useState(false);
  const [synergyBreadcrumbs, setSynergyBreadcrumbs] = useState<SynergyBreadcrumb[]>([
    { label: t('remote.rootLabel'), type: 'root' },
  ]);

  // --- OAuth pagination state ----------------------------------------------
  const [oauthPageToken, setOauthPageToken] = useState<string | null>(null);
  const [oauthPageHistory, setOauthPageHistory] = useState<string[]>([]);
  const [oauthCurrentPage, setOauthCurrentPage] = useState(1);
  const [oauthTotalCount, setOauthTotalCount] = useState<number | null>(null);
  /** The folder ID for the current OAuth listing (undefined = root). */
  const oauthCurrentFolderRef = useRef<string | undefined>(undefined);

  // --- Generation counter to discard stale fetches ------------------------
  const generationRef = useRef(0);

  // --- Helper: only update state when data actually changed (prevents flickering) --
  const dataChanged = (a: unknown[], b: unknown[]): boolean =>
    a.length !== b.length || JSON.stringify(a) !== JSON.stringify(b);

  // --- Prefetch hooks (one per provider type) -----------------------------
  const oauthPrefetch = useRemotePrefetch({
    provider: { type: 'oauth', oauthProvider: selectedOauthProvider ?? '' },
    enabled: activeTab === 'remote' && selectedOauthProvider !== null,
  });

  const synergyPrefetch = useRemotePrefetch({
    provider: { type: 'synergy', numaGet },
    enabled: false, // Synergy now uses generic OAuth provider path
  });

  // --- Cancel all prefetches on tab change --------------------------------
  useEffect(() => {
    if (activeTab !== 'remote') {
      oauthPrefetch.cancelAll();
      synergyPrefetch.cancelAll();
    }
  }, [activeTab, oauthPrefetch, synergyPrefetch]);

  // --- Eager preload: warm cache for all connected providers on Remote tab --
  // Fires as soon as the Remote tab is active and we know which providers
  // are connected. Silently fetches root listings into the cache so clicking
  // a provider card is instant.
  useEffect(() => {
    if (activeTab !== 'remote') return;

    // Synergy preload disabled — Synergy now goes through the generic OAuth provider path
    // via SynergyProvider in oauth-files-api. The preload below handles all providers.

    // Preload all provider root listings (OAuth + token connectors)
    for (const provider of enabledOAuthProviders) {
      if (oauthProviderStatuses[provider.id]?.status !== 'connected') continue;
      const key = oauthCacheKey(provider.id);
      if (!getRemoteFolder(key)) {
        OAuthProvidersService.listContents(provider.id)
          .then((contents) => {
            setRemoteFolder(key, { folders: contents.folders ?? [], files: contents.files ?? [] });
          })
          .catch(() => {
            /* silent */
          });
      }
    }
  }, [activeTab, synergyConnected, enabledOAuthProviders, oauthProviderStatuses, numaGet]);

  // --- Observe folder for viewport priority (delegates to active prefetch) --
  const observeFolder = useCallback(
    (folderId: string, el: HTMLElement | null) => {
      if (selectedOauthProvider) {
        oauthPrefetch.observeFolder(folderId, el);
      } else {
        synergyPrefetch.observeFolder(folderId, el);
      }
    },
    [selectedOauthProvider, oauthPrefetch, synergyPrefetch]
  );

  // =======================================================================
  // OAuth handlers
  // =======================================================================

  const handleOAuthProviderClick = useCallback(
    async (provider: OAuthProviderType) => {
      if (oauthProviderStatuses[provider]?.status !== 'connected') return;

      const gen = ++generationRef.current;
      oauthPrefetch.cancelAll();

      setSelectedOauthProvider(provider);
      const displayName = enabledOAuthProviders.find((p) => p.id === provider)?.display_name ?? provider;
      setOauthBreadcrumbs([{ label: displayName, type: 'root', provider }]);

      // Reset pagination on new provider navigation
      setOauthPageToken(null);
      setOauthPageHistory([]);
      setOauthCurrentPage(1);
      setOauthTotalCount(null);
      oauthCurrentFolderRef.current = undefined;

      // Cache-first: check for cached root listing (TTL from connector's caching policy)
      const cacheKey = oauthCacheKey(provider);
      const ttlMs = getProviderTtlMs(provider);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey, ttlMs);

      if (cached) {
        // Instant render from cache
        setOauthFolders(cached.data.folders as OAuthFolder[]);
        setOauthFiles(cached.data.files as OAuthFile[]);
        setOauthContentLoading(false);

        if (cached.stale) {
          // Background revalidation
          setOauthRevalidating(true);
          try {
            const contents = await OAuthProvidersService.listContents(provider);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, { folders: contents.folders ?? [], files: contents.files ?? [] });
              if (dataChanged(oauthFolders, contents.folders ?? [])) setOauthFolders(contents.folders ?? []);
              if (dataChanged(oauthFiles, contents.files ?? [])) setOauthFiles(contents.files ?? []);
              setOauthPageToken(contents.next_page_token ?? null);
              setOauthTotalCount(contents.total_count ?? null);
              oauthPrefetch.triggerPrefetch(contents.folders ?? [], cacheKey);
            }
          } catch {
            // Stale data is still better than nothing
          } finally {
            if (generationRef.current === gen) setOauthRevalidating(false);
          }
        } else {
          oauthPrefetch.triggerPrefetch(cached.data.folders as OAuthFolder[], cacheKey);
        }
      } else {
        // Cache miss — show spinner
        setOauthContentLoading(true);
        try {
          const contents = await OAuthProvidersService.listContents(provider);
          if (generationRef.current === gen) {
            setRemoteFolder(cacheKey, { folders: contents.folders ?? [], files: contents.files ?? [] });
            setOauthFolders(contents.folders ?? []);
            setOauthFiles(contents.files ?? []);
            setOauthPageToken(contents.next_page_token ?? null);
            oauthPrefetch.triggerPrefetch(contents.folders ?? [], cacheKey);
          }
        } catch (error) {
          console.error(`Failed to load ${provider} contents:`, error);
          if (generationRef.current === gen) {
            showToast({ message: t('remote.errors.loadProviderFiles', { provider }), variant: 'error' });
            setOauthFolders([]);
            setOauthFiles([]);
          }
        } finally {
          if (generationRef.current === gen) setOauthContentLoading(false);
        }
      }
    },
    [oauthProviderStatuses, enabledOAuthProviders, showToast, oauthPrefetch]
  );

  const handleOAuthFolderClick = useCallback(
    async (folder: OAuthFolder) => {
      if (!selectedOauthProvider) return;

      const gen = ++generationRef.current;
      oauthPrefetch.cancelAll();

      setOauthBreadcrumbs((prev) => [
        ...prev,
        { label: folder.name, type: 'folder', id: folder.folder_id, provider: selectedOauthProvider },
      ]);

      // Reset pagination on folder navigation
      setOauthPageToken(null);
      setOauthPageHistory([]);
      setOauthCurrentPage(1);
      setOauthTotalCount(null);
      oauthCurrentFolderRef.current = folder.folder_id;

      const cacheKey = oauthCacheKey(selectedOauthProvider, folder.folder_id);
      const ttlMs = getProviderTtlMs(selectedOauthProvider);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey, ttlMs);

      if (cached) {
        setOauthFolders(cached.data.folders as OAuthFolder[]);
        setOauthFiles(cached.data.files as OAuthFile[]);
        setOauthContentLoading(false);

        if (cached.stale) {
          setOauthRevalidating(true);
          try {
            const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folder.folder_id);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, { folders: contents.folders ?? [], files: contents.files ?? [] });
              if (dataChanged(oauthFolders, contents.folders ?? [])) setOauthFolders(contents.folders ?? []);
              if (dataChanged(oauthFiles, contents.files ?? [])) setOauthFiles(contents.files ?? []);
              setOauthPageToken(contents.next_page_token ?? null);
              setOauthTotalCount(contents.total_count ?? null);
              oauthPrefetch.triggerPrefetch(contents.folders ?? [], cacheKey);
            }
          } catch {
            // Keep stale data
          } finally {
            if (generationRef.current === gen) setOauthRevalidating(false);
          }
        } else {
          oauthPrefetch.triggerPrefetch(cached.data.folders as OAuthFolder[], cacheKey);
        }
      } else {
        setOauthContentLoading(true);
        try {
          const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folder.folder_id);
          if (generationRef.current === gen) {
            setRemoteFolder(cacheKey, { folders: contents.folders ?? [], files: contents.files ?? [] });
            setOauthFolders(contents.folders ?? []);
            setOauthFiles(contents.files ?? []);
            setOauthPageToken(contents.next_page_token ?? null);
            oauthPrefetch.triggerPrefetch(contents.folders ?? [], cacheKey);
          }
        } catch (error) {
          console.error('Failed to load folder contents:', error);
          if (generationRef.current === gen) {
            showToast({ message: t('remote.errors.loadFolderContents'), variant: 'error' });
          }
        } finally {
          if (generationRef.current === gen) setOauthContentLoading(false);
        }
      }
    },
    [selectedOauthProvider, showToast, oauthPrefetch]
  );

  const handleOAuthBreadcrumbClick = useCallback(
    async (index: number) => {
      if (!selectedOauthProvider) return;

      const gen = ++generationRef.current;
      oauthPrefetch.cancelAll();

      // Reset pagination on breadcrumb navigation
      setOauthPageToken(null);
      setOauthPageHistory([]);
      setOauthCurrentPage(1);
      setOauthTotalCount(null);

      const newBreadcrumbs = oauthBreadcrumbs.slice(0, index + 1);
      setOauthBreadcrumbs(newBreadcrumbs);

      const targetCrumb = newBreadcrumbs[index];
      const folderId = targetCrumb.type === 'root' ? undefined : targetCrumb.id;
      oauthCurrentFolderRef.current = folderId;

      const cacheKey = oauthCacheKey(selectedOauthProvider, folderId);
      const ttlMs = getProviderTtlMs(selectedOauthProvider);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey, ttlMs);

      if (cached) {
        setOauthFolders(cached.data.folders as OAuthFolder[]);
        setOauthFiles(cached.data.files as OAuthFile[]);
        setOauthContentLoading(false);

        if (cached.stale) {
          setOauthRevalidating(true);
          try {
            const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folderId);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, { folders: contents.folders ?? [], files: contents.files ?? [] });
              if (dataChanged(oauthFolders, contents.folders ?? [])) setOauthFolders(contents.folders ?? []);
              if (dataChanged(oauthFiles, contents.files ?? [])) setOauthFiles(contents.files ?? []);
            }
          } catch {
            // Keep stale data
          } finally {
            if (generationRef.current === gen) setOauthRevalidating(false);
          }
        }
      } else {
        setOauthContentLoading(true);
        try {
          const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folderId);
          if (generationRef.current === gen) {
            setRemoteFolder(cacheKey, { folders: contents.folders ?? [], files: contents.files ?? [] });
            setOauthFolders(contents.folders ?? []);
            setOauthFiles(contents.files ?? []);
          }
        } catch (error) {
          console.error('Failed to navigate to breadcrumb:', error);
          if (generationRef.current === gen) {
            showToast({ message: t('remote.errors.navigateFailed'), variant: 'error' });
          }
        } finally {
          if (generationRef.current === gen) setOauthContentLoading(false);
        }
      }
    },
    [selectedOauthProvider, oauthBreadcrumbs, showToast, oauthPrefetch]
  );

  // =======================================================================
  // Synergy handlers
  // =======================================================================

  const loadSynergyJobs = useCallback(async () => {
    const gen = ++generationRef.current;

    // Cache-first for jobs list
    const cacheKey = synergyCacheKey.jobs();
    const cached = getRemoteFolder<RemoteJobsData>(cacheKey);

    if (cached) {
      setSynergyJobs(cached.data.jobs);
      setSynergyJobsLoading(false);

      if (cached.stale) {
        setSynergyRevalidating(true);
        try {
          const response = await SynergyDataConnectorService.listJobs(numaGet);
          const jobs = response.items ?? [];
          if (generationRef.current === gen) {
            setRemoteFolder(cacheKey, { jobs });
            if (dataChanged(synergyJobs, jobs)) setSynergyJobs(jobs);
          }
        } catch {
          // Keep stale data
        } finally {
          if (generationRef.current === gen) setSynergyRevalidating(false);
        }
      }
    } else {
      setSynergyJobsLoading(true);
      try {
        const response = await SynergyDataConnectorService.listJobs(numaGet);
        const jobs = response.items ?? [];
        if (generationRef.current === gen) {
          setRemoteFolder(cacheKey, { jobs });
          setSynergyJobs(jobs);
        }
      } catch {
        if (generationRef.current === gen) setSynergyJobs([]);
      } finally {
        if (generationRef.current === gen) setSynergyJobsLoading(false);
      }
    }
  }, [numaGet]);

  const handleSynergyJobClick = useCallback(
    async (job: SynergyJob) => {
      const gen = ++generationRef.current;
      synergyPrefetch.cancelAll();

      setSynergyFiles([]);
      setSynergyBreadcrumbs((prev) => [...prev, { label: job.name, type: 'job', id: job.job_id }]);

      const cacheKey = synergyCacheKey.jobFolders(job.job_id);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey);

      if (cached) {
        setSynergyFolders(cached.data.folders as SynergyFolder[]);
        setSynergyFoldersLoading(false);

        if (cached.stale) {
          setSynergyRevalidating(true);
          try {
            const folders = await SynergyDataConnectorService.listJobFolders(numaGet, job.job_id);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, { folders, files: [] });
              if (dataChanged(synergyFolders, folders)) setSynergyFolders(folders);
              synergyPrefetch.triggerPrefetch(folders, cacheKey);
            }
          } catch {
            // Keep stale
          } finally {
            if (generationRef.current === gen) setSynergyRevalidating(false);
          }
        } else {
          synergyPrefetch.triggerPrefetch(cached.data.folders as SynergyFolder[], cacheKey);
        }
      } else {
        setSynergyFoldersLoading(true);
        setSynergyFolders([]);
        try {
          const folders = await SynergyDataConnectorService.listJobFolders(numaGet, job.job_id);
          if (generationRef.current === gen) {
            setRemoteFolder(cacheKey, { folders, files: [] });
            setSynergyFolders(folders);
            synergyPrefetch.triggerPrefetch(folders, cacheKey);
          }
        } catch {
          if (generationRef.current === gen) setSynergyFolders([]);
        } finally {
          if (generationRef.current === gen) setSynergyFoldersLoading(false);
        }
      }
    },
    [numaGet, synergyPrefetch]
  );

  const handleSynergyFolderClick = useCallback(
    async (folder: SynergyFolder) => {
      const gen = ++generationRef.current;
      synergyPrefetch.cancelAll();

      setSynergyBreadcrumbs((prev) => [...prev, { label: folder.name, type: 'folder', id: folder.folder_id }]);

      const cacheKey = synergyCacheKey.folder(folder.folder_id);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey);

      if (cached) {
        setSynergyFolders(cached.data.folders as SynergyFolder[]);
        setSynergyFiles(cached.data.files as SynergyFile[]);
        setSynergyFoldersLoading(false);

        if (cached.stale) {
          setSynergyRevalidating(true);
          try {
            const response = await SynergyDataConnectorService.listFolderItems(numaGet, folder.folder_id);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, {
                folders: response.subfolders ?? [],
                files: response.files ?? [],
              });
              if (dataChanged(synergyFolders, response.subfolders ?? [])) setSynergyFolders(response.subfolders ?? []);
              if (dataChanged(synergyFiles, response.files ?? [])) setSynergyFiles(response.files ?? []);
              synergyPrefetch.triggerPrefetch(response.subfolders ?? [], cacheKey);
            }
          } catch {
            // Keep stale
          } finally {
            if (generationRef.current === gen) setSynergyRevalidating(false);
          }
        } else {
          synergyPrefetch.triggerPrefetch(cached.data.folders as SynergyFolder[], cacheKey);
        }
      } else {
        setSynergyFoldersLoading(true);
        try {
          const response = await SynergyDataConnectorService.listFolderItems(numaGet, folder.folder_id);
          if (generationRef.current === gen) {
            setRemoteFolder(cacheKey, {
              folders: response.subfolders ?? [],
              files: response.files ?? [],
            });
            setSynergyFolders(response.subfolders ?? []);
            setSynergyFiles(response.files ?? []);
            synergyPrefetch.triggerPrefetch(response.subfolders ?? [], cacheKey);
          }
        } catch {
          if (generationRef.current === gen) {
            setSynergyFolders([]);
            setSynergyFiles([]);
          }
        } finally {
          if (generationRef.current === gen) setSynergyFoldersLoading(false);
        }
      }
    },
    [numaGet, synergyPrefetch]
  );

  const handleSynergyBreadcrumbClick = useCallback(
    async (index: number) => {
      const crumb = synergyBreadcrumbs[index];
      if (!crumb) return;

      const gen = ++generationRef.current;
      synergyPrefetch.cancelAll();

      setSynergyBreadcrumbs((prev) => prev.slice(0, index + 1));

      if (crumb.type === 'root') {
        setSynergyFolders([]);
        setSynergyFiles([]);
        loadSynergyJobs();
      } else if (crumb.type === 'job' && !crumb.id) {
        // "Synergy Jobs" header — go back to jobs list
        setSynergyFolders([]);
        setSynergyFiles([]);
        loadSynergyJobs();
      } else if (crumb.type === 'job' && crumb.id) {
        const cacheKey = synergyCacheKey.jobFolders(crumb.id);
        const cached = getRemoteFolder<RemoteFolderData>(cacheKey);

        setSynergyFiles([]);
        if (cached) {
          setSynergyFolders(cached.data.folders as SynergyFolder[]);
          setSynergyFoldersLoading(false);
          if (cached.stale) {
            setSynergyRevalidating(true);
            try {
              const folders = await SynergyDataConnectorService.listJobFolders(numaGet, crumb.id);
              if (generationRef.current === gen) {
                setRemoteFolder(cacheKey, { folders, files: [] });
                if (dataChanged(synergyFolders, folders)) setSynergyFolders(folders);
              }
            } catch {
              // Keep stale
            } finally {
              if (generationRef.current === gen) setSynergyRevalidating(false);
            }
          }
        } else {
          setSynergyFoldersLoading(true);
          try {
            const folders = await SynergyDataConnectorService.listJobFolders(numaGet, crumb.id);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, { folders, files: [] });
              setSynergyFolders(folders);
            }
          } catch {
            if (generationRef.current === gen) setSynergyFolders([]);
          } finally {
            if (generationRef.current === gen) setSynergyFoldersLoading(false);
          }
        }
      } else if (crumb.type === 'folder' && crumb.id) {
        const cacheKey = synergyCacheKey.folder(crumb.id);
        const cached = getRemoteFolder<RemoteFolderData>(cacheKey);

        if (cached) {
          setSynergyFolders(cached.data.folders as SynergyFolder[]);
          setSynergyFiles(cached.data.files as SynergyFile[]);
          setSynergyFoldersLoading(false);
          if (cached.stale) {
            setSynergyRevalidating(true);
            try {
              const response = await SynergyDataConnectorService.listFolderItems(numaGet, crumb.id);
              if (generationRef.current === gen) {
                setRemoteFolder(cacheKey, {
                  folders: response.subfolders ?? [],
                  files: response.files ?? [],
                });
                if (dataChanged(synergyFolders, response.subfolders ?? []))
                  setSynergyFolders(response.subfolders ?? []);
                if (dataChanged(synergyFiles, response.files ?? [])) setSynergyFiles(response.files ?? []);
              }
            } catch {
              // Keep stale
            } finally {
              if (generationRef.current === gen) setSynergyRevalidating(false);
            }
          }
        } else {
          setSynergyFoldersLoading(true);
          try {
            const response = await SynergyDataConnectorService.listFolderItems(numaGet, crumb.id);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, {
                folders: response.subfolders ?? [],
                files: response.files ?? [],
              });
              setSynergyFolders(response.subfolders ?? []);
              setSynergyFiles(response.files ?? []);
            }
          } catch {
            if (generationRef.current === gen) {
              setSynergyFolders([]);
              setSynergyFiles([]);
            }
          } finally {
            if (generationRef.current === gen) setSynergyFoldersLoading(false);
          }
        }
      }
    },
    [synergyBreadcrumbs, numaGet, loadSynergyJobs, synergyPrefetch]
  );

  // =======================================================================
  // OAuth pagination handlers
  // =======================================================================

  const handleOAuthNextPage = useCallback(async () => {
    if (!selectedOauthProvider || !oauthPageToken) return;

    const gen = ++generationRef.current;
    setOauthContentLoading(true);

    // Push current page token to history so we can go back
    setOauthPageHistory((prev) => [...prev, oauthPageToken]);

    try {
      const contents = await OAuthProvidersService.listContents(
        selectedOauthProvider,
        oauthCurrentFolderRef.current,
        undefined,
        oauthPageToken
      );
      if (generationRef.current === gen) {
        setOauthFolders(contents.folders ?? []);
        setOauthFiles(contents.files ?? []);
        setOauthPageToken(contents.next_page_token ?? null);
        setOauthTotalCount(contents.total_count ?? null);
        setOauthCurrentPage((prev) => prev + 1);
      }
    } catch (error) {
      console.error('Failed to load next page:', error);
      if (generationRef.current === gen) {
        showToast({ message: t('remote.errors.loadNextPage'), variant: 'error' });
      }
    } finally {
      if (generationRef.current === gen) setOauthContentLoading(false);
    }
  }, [selectedOauthProvider, oauthPageToken, showToast]);

  const handleOAuthPrevPage = useCallback(async () => {
    if (!selectedOauthProvider || oauthPageHistory.length === 0) return;

    const gen = ++generationRef.current;
    setOauthContentLoading(true);

    const newHistory = [...oauthPageHistory];
    // The last entry in history is the token we used to get to the current page.
    // Pop it off. The entry before it (or undefined for page 1) is what we pass.
    newHistory.pop();
    const prevToken = newHistory.length > 0 ? newHistory[newHistory.length - 1] : undefined;
    setOauthPageHistory(newHistory);

    try {
      const contents = await OAuthProvidersService.listContents(
        selectedOauthProvider,
        oauthCurrentFolderRef.current,
        undefined,
        prevToken
      );
      if (generationRef.current === gen) {
        setOauthFolders(contents.folders ?? []);
        setOauthFiles(contents.files ?? []);
        setOauthPageToken(contents.next_page_token ?? null);
        setOauthTotalCount(contents.total_count ?? null);
        setOauthCurrentPage((prev) => Math.max(1, prev - 1));
      }
    } catch (error) {
      console.error('Failed to load previous page:', error);
      if (generationRef.current === gen) {
        showToast({ message: t('remote.errors.loadPreviousPage'), variant: 'error' });
      }
    } finally {
      if (generationRef.current === gen) setOauthContentLoading(false);
    }
  }, [selectedOauthProvider, oauthPageHistory, showToast]);

  // --- Convenience: reset to root level -----------------------------------

  const resetToRoot = useCallback(() => {
    ++generationRef.current;
    oauthPrefetch.cancelAll();
    synergyPrefetch.cancelAll();
    setSelectedOauthProvider(null);
    setSynergyBreadcrumbs([{ label: t('remote.rootLabel'), type: 'root' }]);
    setOauthBreadcrumbs([]);
    setSynergyFolders([]);
    setSynergyFiles([]);
    setOauthFolders([]);
    setOauthFiles([]);
    setSynergyJobsLoading(false);
    setSynergyFoldersLoading(false);
    setOauthContentLoading(false);
    setOauthRevalidating(false);
    setSynergyRevalidating(false);
    setOauthPageToken(null);
    setOauthPageHistory([]);
    setOauthCurrentPage(1);
    setOauthTotalCount(null);
    oauthCurrentFolderRef.current = undefined;
  }, [t, oauthPrefetch, synergyPrefetch]);

  const navigateToSynergyJobs = useCallback(() => {
    setSelectedOauthProvider(null);
    setSynergyBreadcrumbs([
      { label: t('remote.rootLabel'), type: 'root' },
      { label: t('remote.synergyName'), type: 'job' },
    ]);
    loadSynergyJobs();
  }, [t, loadSynergyJobs]);

  return {
    // OAuth
    oauthFolders,
    oauthFiles,
    oauthBreadcrumbs,
    oauthContentLoading,
    oauthRevalidating,
    selectedOauthProvider,

    // OAuth pagination
    oauthPageToken,
    oauthHasPrevPage: oauthPageHistory.length > 0,
    oauthCurrentPage,
    oauthTotalCount,
    handleOAuthNextPage,
    handleOAuthPrevPage,

    // Synergy
    synergyJobs,
    synergyFolders,
    synergyFiles,
    synergyBreadcrumbs,
    synergyFoldersLoading,
    synergyJobsLoading,
    synergyRevalidating,

    // Handlers
    handleOAuthProviderClick,
    handleOAuthFolderClick,
    handleOAuthBreadcrumbClick,
    handleSynergyJobClick,
    handleSynergyFolderClick,
    handleSynergyBreadcrumbClick,
    loadSynergyJobs,
    setSelectedOauthProvider,
    resetToRoot,
    navigateToSynergyJobs,

    // Prefetch
    observeFolder,
  };
}
