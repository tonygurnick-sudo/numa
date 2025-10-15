const CONFIG_CACHE_DURATION = 7 * 60 * 1000; // 7 minutes (offset from 5-minute token refresh)
const CONFIG_TIMESTAMP_KEY = 'CONFIG_TIMESTAMP';
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
  'BRANDING_PROVIDER_ENABLED',
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
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch config');
    }

    const configData = await response.json();

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
