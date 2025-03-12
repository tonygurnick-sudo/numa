export const fetchConfigAddtoSession = async () => {
  let needsRefresh = false;

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

  // Loop through the desired properties and add them to sessionStorage
  const propertiesToAdd = [
    'Q_APPLICATION_ID',
    'Q_INDEX_ID',
    'Q_RETRIEVER_ID',
    'IDENTITY_POOL_ID',
    'IDENTITY_POOL_ROLE_ARN',
    'ROLE_ARN',
    'REGION',
    'API_ENDPOINT',
    'USER_POOL_ID',
    'CLIENT_ID',
    'CLIENT_NAME',
    'HONEYCOMB_KEY',
  ];

  // Check if all required properties exist
  const missingProperties = propertiesToAdd.filter((prop) => !Object.hasOwn(configData, prop));
  if (missingProperties.length > 0) {
    console.error(`Missing required properties in config: ${missingProperties.join(', ')}`);
  }

  propertiesToAdd.forEach((property) => {
    const existing = sessionStorage.getItem(property);
    if ((configData[property] ?? 'undefined') != existing) {
      sessionStorage.setItem(property, configData[property]);
      needsRefresh = true;
    }
  });

  // reload so the items are available at login.
  if (needsRefresh) window.location.reload();
};
