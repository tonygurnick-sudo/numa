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
    'ROLE_ARN',
    'REGION',
    'API_ENDPOINT',
    'USER_POOL_ID',
    'CLIENT_ID',
    'CLIENT_NAME',
    'HONEYCOMB_KEY',
    'OUTPUTS_BUCKET_NAME',
    'DATA_BUCKET',
    'HIDE_ADMIN',
    'PROVISION_Q_RESOURCES',
    'PREFERRED_KNOWLEDGE_BASE',
    'BEDROCK_KNOWLEDGE_BASE_ID',
  ];

  // Check if all required properties exist
  const missingProperties = propertiesToAdd.filter((prop) => !Object.hasOwn(configData, prop));
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
  propertiesToAdd.forEach((property) => {
    const existing = sessionStorage.getItem(property);
    const configValue = configData[property];

    // Handle boolean values specially
    if (typeof configValue === 'boolean') {
      const stringValue = configValue.toString();
      if (stringValue !== existing) {
        sessionStorage.setItem(property, stringValue);
        needsRefresh = true;
      }
    } else if ((configValue ?? 'undefined') != existing) {
      sessionStorage.setItem(property, configValue);
      needsRefresh = true;
    }
  });

  // reload so the items are available at login.
  if (needsRefresh) window.location.reload();
};
