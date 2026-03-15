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
    enabled: activeTab === 'remote' && synergyConnected,
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

    // Preload Synergy jobs (also set state so navigating is instant)
    if (synergyConnected) {
      const key = synergyCacheKey.jobs();
      const cached = getRemoteFolder<RemoteJobsData>(key);
      if (cached) {
        setSynergyJobs(cached.data.jobs);
      } else {
        SynergyDataConnectorService.listJobs(numaGet)
          .then((response) => {
            const jobs = response.items ?? [];
            setRemoteFolder(key, { jobs });
            setSynergyJobs(jobs);
          })
          .catch(() => {
            /* silent — user hasn't navigated here yet */
          });
      }
    }

    // Preload OAuth provider root listings
    for (const provider of enabledOAuthProviders) {
      if (oauthProviderStatuses[provider.id]?.status !== 'connected') continue;
      const key = oauthCacheKey(provider.id);
      if (!getRemoteFolder(key)) {
        OAuthProvidersService.listContents(provider.id)
          .then((contents) => {
            setRemoteFolder(key, { folders: contents.folders, files: contents.files });
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

      // Cache-first: check for cached root listing
      const cacheKey = oauthCacheKey(provider);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey);

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
              setRemoteFolder(cacheKey, { folders: contents.folders, files: contents.files });
              if (dataChanged(oauthFolders, contents.folders)) setOauthFolders(contents.folders);
              if (dataChanged(oauthFiles, contents.files)) setOauthFiles(contents.files);
              oauthPrefetch.triggerPrefetch(contents.folders, cacheKey);
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
            setRemoteFolder(cacheKey, { folders: contents.folders, files: contents.files });
            setOauthFolders(contents.folders);
            setOauthFiles(contents.files);
            oauthPrefetch.triggerPrefetch(contents.folders, cacheKey);
          }
        } catch (error) {
          console.error(`Failed to load ${provider} contents:`, error);
          if (generationRef.current === gen) {
            showToast({ message: `Failed to load ${provider} files`, variant: 'error' });
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

      const cacheKey = oauthCacheKey(selectedOauthProvider, folder.folder_id);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey);

      if (cached) {
        setOauthFolders(cached.data.folders as OAuthFolder[]);
        setOauthFiles(cached.data.files as OAuthFile[]);
        setOauthContentLoading(false);

        if (cached.stale) {
          setOauthRevalidating(true);
          try {
            const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folder.folder_id);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, { folders: contents.folders, files: contents.files });
              if (dataChanged(oauthFolders, contents.folders)) setOauthFolders(contents.folders);
              if (dataChanged(oauthFiles, contents.files)) setOauthFiles(contents.files);
              oauthPrefetch.triggerPrefetch(contents.folders, cacheKey);
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
            setRemoteFolder(cacheKey, { folders: contents.folders, files: contents.files });
            setOauthFolders(contents.folders);
            setOauthFiles(contents.files);
            oauthPrefetch.triggerPrefetch(contents.folders, cacheKey);
          }
        } catch (error) {
          console.error('Failed to load folder contents:', error);
          if (generationRef.current === gen) {
            showToast({ message: 'Failed to load folder contents', variant: 'error' });
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

      const newBreadcrumbs = oauthBreadcrumbs.slice(0, index + 1);
      setOauthBreadcrumbs(newBreadcrumbs);

      const targetCrumb = newBreadcrumbs[index];
      const folderId = targetCrumb.type === 'root' ? undefined : targetCrumb.id;

      const cacheKey = oauthCacheKey(selectedOauthProvider, folderId);
      const cached = getRemoteFolder<RemoteFolderData>(cacheKey);

      if (cached) {
        setOauthFolders(cached.data.folders as OAuthFolder[]);
        setOauthFiles(cached.data.files as OAuthFile[]);
        setOauthContentLoading(false);

        if (cached.stale) {
          setOauthRevalidating(true);
          try {
            const contents = await OAuthProvidersService.listContents(selectedOauthProvider, folderId);
            if (generationRef.current === gen) {
              setRemoteFolder(cacheKey, { folders: contents.folders, files: contents.files });
              if (dataChanged(oauthFolders, contents.folders)) setOauthFolders(contents.folders);
              if (dataChanged(oauthFiles, contents.files)) setOauthFiles(contents.files);
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
            setRemoteFolder(cacheKey, { folders: contents.folders, files: contents.files });
            setOauthFolders(contents.folders);
            setOauthFiles(contents.files);
          }
        } catch (error) {
          console.error('Failed to navigate to breadcrumb:', error);
          if (generationRef.current === gen) {
            showToast({ message: 'Failed to navigate', variant: 'error' });
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
  }, [t, oauthPrefetch, synergyPrefetch]);

  const navigateToSynergyJobs = useCallback(() => {
    setSelectedOauthProvider(null);
    setSynergyBreadcrumbs([
      { label: t('remote.rootLabel'), type: 'root' },
      { label: 'Synergy Jobs', type: 'job' },
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
