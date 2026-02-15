const CONFIG_CACHE_DURATION = 7 * 60 * 1000; // 7 minutes
const CONFIG_TIMESTAMP_KEY = 'PORTAL_CONFIG_TIMESTAMP';
const CONFIG_REQUIRED_PROPERTIES = [
  'AWS_REGION',
  'USER_POOL_ID',
  'USER_POOL_CLIENT_ID',
  'IDENTITY_POOL_ID',
  'CLIENT_CONFIG_TABLE',
];

const CONFIG_OPTIONAL_PROPERTIES = [
  'ECR_REPOSITORY_URI',
  'ECR_REGION',
  'ECR_REGISTRY_ID',
  'DEPLOYMENTS_TABLE',
  'DEPLOYMENT_SFN_ARN',
  'DEPLOYMENT_GROUP_SFN_ARN',
  'DEPLOYMENT_GROUPS_TABLE',
  'DEPLOYMENT_GROUP_DEFAULT_CONCURRENCY',
  'DEPLOYMENT_GROUP_MAX_CONCURRENCY',
  'ACTIVITY_TABLE',
  'NEXTGEN_BROKER_LAMBDA',
  'NEXTGEN_BROKER_REGION',
  'SUPPORT_DOCS_BUCKET',
];

const CONFIG_PROPERTIES = [...CONFIG_REQUIRED_PROPERTIES, ...CONFIG_OPTIONAL_PROPERTIES];

export interface PortalConfig {
  AWS_REGION: string;
  USER_POOL_ID: string;
  USER_POOL_CLIENT_ID: string;
  IDENTITY_POOL_ID: string;
  CLIENT_CONFIG_TABLE: string;
  ECR_REPOSITORY_URI?: string;
  ECR_REGION?: string;
  ECR_REGISTRY_ID?: string;
  DEPLOYMENTS_TABLE?: string;
  DEPLOYMENT_SFN_ARN?: string;
  DEPLOYMENT_GROUP_SFN_ARN?: string;
  DEPLOYMENT_GROUPS_TABLE?: string;
  DEPLOYMENT_GROUP_DEFAULT_CONCURRENCY?: string;
  DEPLOYMENT_GROUP_MAX_CONCURRENCY?: string;
  ACTIVITY_TABLE?: string;
  NEXTGEN_BROKER_LAMBDA?: string;
  NEXTGEN_BROKER_REGION?: string;
  SUPPORT_DOCS_BUCKET?: string;
}

export const fetchConfigAndAddToSession = async (forceRefresh = false): Promise<void> => {
  // Check if we need to refresh the config
  if (!forceRefresh && !shouldRefreshConfig()) {
    console.debug('Config is still fresh, skipping fetch');
    return;
  }

  let needsRefresh = false;

  try {
    const response = await fetch('/config.json', {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch config');
    }

    const configData: PortalConfig = await response.json();

    // Check if configData is empty
    if (!configData || Object.keys(configData).length === 0) {
      throw new Error('Config file is empty');
    }

    // Check if all required properties exist
    const missingProperties = CONFIG_REQUIRED_PROPERTIES.filter((prop) => !Object.hasOwn(configData, prop));
    if (missingProperties.length > 0) {
      console.error(`Missing required properties in config: ${missingProperties.join(', ')}`);
      throw new Error(`Missing required config properties: ${missingProperties.join(', ')}`);
    }

    // Handle regular string properties
    CONFIG_PROPERTIES.forEach((property) => {
      const existing = sessionStorage.getItem(property);
      const configValue = configData[property as keyof PortalConfig];

      if (configValue && configValue !== existing) {
        sessionStorage.setItem(property, configValue);
        needsRefresh = true;
      } else if (!configValue && existing) {
        // If a value has been removed from the config, remove it from session.
        sessionStorage.removeItem(property);
        needsRefresh = true;
      }
    });

    // Update the timestamp to mark when config was last fetched
    sessionStorage.setItem(CONFIG_TIMESTAMP_KEY, Date.now().toString());

    // Reload if config changed to ensure all components have the latest config
    if (needsRefresh) {
      console.log('Config changed, reloading page');
      window.location.reload();
    } else {
      console.debug('Config fetched successfully, no changes detected');
    }
  } catch (error) {
    console.error('Error fetching config:', error);
    throw error;
  }
};

// Helper function to determine if config should be refreshed
const shouldRefreshConfig = (): boolean => {
  const timestamp = sessionStorage.getItem(CONFIG_TIMESTAMP_KEY);

  if (!hasConfigInSession()) {
    console.warn('Config is not in session, or is missing required properties');
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
export const hasConfigInSession = (): boolean => {
  return CONFIG_REQUIRED_PROPERTIES.every((key) => sessionStorage.getItem(key) !== null);
};

// Helper function to get a specific config value from session storage
export const getConfigValue = (key: keyof PortalConfig): string | null => {
  return sessionStorage.getItem(key);
};

// Helper function to get all config values from session storage
export const getAllConfig = (): PortalConfig | null => {
  if (!hasConfigInSession()) {
    return null;
  }

  const config: Partial<PortalConfig> = {};
  CONFIG_PROPERTIES.forEach((prop) => {
    const value = sessionStorage.getItem(prop);
    if (value) {
      config[prop as keyof PortalConfig] = value;
    }
  });

  return config as PortalConfig;
};

// Helper function to force refresh config (useful for debugging or manual refresh)
export const forceRefreshConfig = (): Promise<void> => {
  return fetchConfigAndAddToSession(true);
};

// Helper function to clear config cache (useful for logout or debugging)
export const clearConfigCache = (): void => {
  CONFIG_PROPERTIES.forEach((prop) => {
    sessionStorage.removeItem(prop);
  });
  sessionStorage.removeItem(CONFIG_TIMESTAMP_KEY);
  console.debug('Config cache cleared');
};
