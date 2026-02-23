import i18n from '../i18n';
import { getSwrCache, setSwrCache } from '../utils/swrCache';

const SWR_KEY = 'manifest';

let manifestCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 300000; // 5 minutes

export const manifestService = {
  /** Read cached manifest from localStorage (instant, synchronous). */
  getCachedManifest: () => getSwrCache<unknown[]>(SWR_KEY),

  // Fetch all apps from manifest
  fetchAppsFromManifest: async (forceRefresh = false) => {
    const now = Date.now();
    // Use cache if it's fresh and not forcing refresh
    if (!forceRefresh && manifestCache && now - lastFetchTime < CACHE_DURATION) {
      return manifestCache;
    }

    try {
      const response = await fetch('/manifest.json', {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(i18n.t('errors:manifest.fetchFailed'));
      }

      const data = await response.json();
      const appsData = data.apps;

      if (!Array.isArray(appsData)) {
        throw new Error(i18n.t('errors:manifest.invalidData'));
      }

      // Check if the data has actually changed
      const dataHasChanged = !manifestCache || JSON.stringify(manifestCache) !== JSON.stringify(appsData);

      if (dataHasChanged) {
        // Update cache
        manifestCache = appsData;
        lastFetchTime = now;
        // Persist to localStorage for instant load on next page refresh
        setSwrCache(SWR_KEY, appsData);
      } else {
        // Update timestamp even if data hasn't changed
        lastFetchTime = now;
      }

      return appsData;
    } catch (error) {
      console.error('Error loading apps:', error);
      throw error;
    }
  },

  // Fetch single app from manifest by ID
  fetchAppById: async (appId) => {
    try {
      const apps = await manifestService.fetchAppsFromManifest();
      const app = apps.find((app) => app.id === appId);
      if (!app) {
        throw new Error(i18n.t('errors:manifest.appNotFound', { appId }));
      }
      return app;
    } catch (error) {
      console.error('Error loading app:', error);
      throw error;
    }
  },

  // Force refresh manifest (bypasses cache timer)
  forceRefreshManifest: async () => {
    return await manifestService.fetchAppsFromManifest(true);
  },
};
