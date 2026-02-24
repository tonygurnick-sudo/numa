const CONFIG_CACHE_DURATION = 7 * 60 * 1000; // 7 minutes (offset from 5-minute token refresh)
const CONFIG_TIMESTAMP_KEY = 'CONFIG_TIMESTAMP';
const CONFIG_VERSION_STORAGE_KEY = 'NUMA_BUILD_VERSION';
const CONFIG_VERSION_QUERY_PARAM = '_numaVersion';
const CONFIG_REQUIRED_PROPERTIES = [
  'ROLE_ARN',
  'REGION',
  'API_ENDPOINT',
  'USER_POOL_ID',
  'CLIENT_ID',
  'CLIENT_NAME',
  'HONEYCOMB_KEY',
  'OUTPUTS_BUCKET_NAME',
  'DATA_BUCKET',
  'PROVISION_Q_RESOURCES',
  'PREFERRED_KNOWLEDGE_BASE',
  'BEDROCK_KNOWLEDGE_BASE_ID',
];
const CONFIG_OPTIONAL_PROPERTIES = [
  'Q_APPLICATION_ID',
  'Q_INDEX_ID',
  'Q_RETRIEVER_ID',
  'BEDROCK_ACCOUNT',
  'PIPEDREAM_RELAY_LAMBDA_ARN',
  'PIPEDREAM_INTEGRATIONS',
  'DATA_CONNECTORS_ENABLED',
  'BRANDING_PROVIDER_ENABLED',
  'AGENTS',
  'NUMA_WORKSPACE_CHAT',
  'BRANDING_API_BASE_URL',
  'BRANDING_ASSETS_BUCKET',
  'BRANDING_ASSETS_PREFIX',
  'NUMA_VERSION',
  'WORKSPACE_CHAT_AGENT_FUNCTION_URL', // Direct Lambda URL for streaming (bypasses CloudFront buffering)
  'WORKSPACE_CHAT_MODEL_SELECTION', // Feature flag for model selection in workspace chat settings drawer
  'SCHEDULING', // Feature flag for agent scheduling and notifications
  'NUMA_FILES', // Feature flag for Numa Files (file management)
  'WORKSPACE_CHAT_MODEL_SELECTION', // Feature flag for model selection in Chat V2
  'NUMA_OPS', // Feature flag for Numa Ops work management
];
const CONFIG_PROPERTIES = [...CONFIG_REQUIRED_PROPERTIES, ...CONFIG_OPTIONAL_PROPERTIES];

export const fetchConfigAddtoSession = async (forceRefresh = false) => {
  // Check if we need to refresh the config
  if (!forceRefresh && !shouldRefreshConfig()) {
    console.debug('Config is still fresh, skipping fetch');
    return;
  }

  let needsRefresh = false;

  try {
    const response = await fetch('/config.json', {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch config');
    }

    const configData = await response.json();

    const versionChanged = await handleVersionChange(configData.NUMA_VERSION);
    if (versionChanged) {
      return;
    }
    cleanupVersionQueryParam();

    // Check if configData is empty
    if (!configData || Object.keys(configData).length === 0) {
      throw new Error('Config file is empty');
    }

    // Check if all required properties exist
    const hasOwnProperty = Object.prototype.hasOwnProperty;
    const missingProperties = CONFIG_REQUIRED_PROPERTIES.filter((prop) => !hasOwnProperty.call(configData, prop));
    if (missingProperties.length > 0) {
      console.error(`Missing required properties in config: ${missingProperties.join(', ')}`);
    }

    // Handle IDENTITY_POOLS as a JSON object separately
    if (configData.GROUPS) {
      const existing = sessionStorage.getItem('GROUPS');
      const newValue = JSON.stringify(configData.GROUPS);
      if (newValue !== existing) {
        sessionStorage.setItem('GROUPS', newValue);
        needsRefresh = true;
      }
    } else {
      console.error('Missing required property in config: GROUPS');
    }

    // Handle regular string properties
    CONFIG_PROPERTIES.forEach((property) => {
      const existing = sessionStorage.getItem(property);
      const configValue = configData[property];

      // Handle boolean values specially
      if (typeof configValue === 'boolean') {
        const stringValue = configValue.toString();
        if (stringValue !== existing) {
          sessionStorage.setItem(property, stringValue);
          needsRefresh = true;
        }
      } else if (!configValue && existing) {
        // If a value has been removed from the config, remove it from session.
        sessionStorage.removeItem(property);
        needsRefresh = true;
      } else if (configValue != existing) {
        // If a value is different from the config, update it.
        sessionStorage.setItem(property, configValue);
        needsRefresh = true;
      }
    });

    // Update the timestamp to mark when config was last fetched
    sessionStorage.setItem(CONFIG_TIMESTAMP_KEY, Date.now().toString());

    // reload so the items are available at login.
    if (needsRefresh) {
      // console.log('Config changed, reloading page');
      window.location.reload();
    } else {
      // console.log('Config fetched successfully, no changes detected');
    }
  } catch (error) {
    console.error('Error fetching config:', error);
    // On error, we might want to use cached config if available
    throw error;
  }
};

// Helper function to determine if config should be refreshed
const shouldRefreshConfig = () => {
  const timestamp = sessionStorage.getItem(CONFIG_TIMESTAMP_KEY);
  const workspaceModelFlag = sessionStorage.getItem('WORKSPACE_CHAT_MODEL_SELECTION');

  if (!hasConfigInSession()) {
    console.warn('Config is not in session, or is missing required properties');
    return true;
  }

  // Backward compatibility: older sessions may not have newer optional flags.
  // Force a refresh so feature flags from config.json are hydrated into sessionStorage.
  if (workspaceModelFlag === null) {
    return true;
  }

  if (!timestamp) {
    console.debug('No config timestamp found, needs refresh');
    return true;
  }

  const lastFetchTime = parseInt(timestamp, 10);
  const currentTime = Date.now();
  const timeDifference = currentTime - lastFetchTime;

  if (timeDifference > CONFIG_CACHE_DURATION) {
    console.debug(`Config is ${Math.round(timeDifference / (60 * 1000))} minutes old, needs refresh`);
    return true;
  }

  return false;
};

// Helper function to check if config exists in session storage
export const hasConfigInSession = () => {
  return (
    CONFIG_REQUIRED_PROPERTIES.every((key) => sessionStorage.getItem(key) !== null) &&
    sessionStorage.getItem('GROUPS') !== null
  );
};

// Helper function to force refresh config (useful for debugging or manual refresh)
export const forceRefreshConfig = () => {
  return fetchConfigAddtoSession(true);
};

// Helper function to clear config cache (useful for logout or debugging)
export const clearConfigCache = () => {
  sessionStorage.removeItem(CONFIG_TIMESTAMP_KEY);
  console.debug('Config cache cleared');
};

const handleVersionChange = async (incomingVersion?: string) => {
  if (typeof window === 'undefined' || !incomingVersion) return false;

  let storedVersion: string | null = null;
  try {
    storedVersion = window.localStorage?.getItem(CONFIG_VERSION_STORAGE_KEY) ?? null;
  } catch (error) {
    console.warn('Unable to read cached NUMA version from storage:', error);
  }

  if (!storedVersion) {
    try {
      window.localStorage?.setItem(CONFIG_VERSION_STORAGE_KEY, incomingVersion);
    } catch (error) {
      console.warn('Unable to persist NUMA version in storage:', error);
    }
    return false;
  }

  if (storedVersion === incomingVersion) {
    return false;
  }

  await clearVersionState();

  try {
    window.localStorage?.setItem(CONFIG_VERSION_STORAGE_KEY, incomingVersion);
  } catch (error) {
    console.warn('Unable to persist NUMA version after clearing caches:', error);
  }

  reloadWithVersionQuery(incomingVersion);
  return true;
};

const clearVersionState = async () => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.clear();
  } catch (error) {
    console.warn('Unable to clear session storage during version refresh:', error);
  }

  if (window.caches?.keys) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
    } catch (error) {
      console.warn('Unable to clear cache storage during version refresh:', error);
    }
  }

  if (window.navigator?.serviceWorker?.getRegistrations) {
    try {
      const registrations = await window.navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {
      console.warn('Unable to unregister service workers during version refresh:', error);
    }
  }
};

const reloadWithVersionQuery = (version: string) => {
  if (typeof window === 'undefined') return;
  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(CONFIG_VERSION_QUERY_PARAM, version);
    window.location.replace(nextUrl.toString());
  } catch {
    window.location.reload();
  }
};

const cleanupVersionQueryParam = () => {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(CONFIG_VERSION_QUERY_PARAM)) return;
    url.searchParams.delete(CONFIG_VERSION_QUERY_PARAM);
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, document.title, nextPath);
  } catch {
    // Ignore malformed URLs
  }
};
