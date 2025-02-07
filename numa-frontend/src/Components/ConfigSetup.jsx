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

  // Loop through the desired properties and add them to sessionStorage
  const propertiesToAdd = [
    'Q_APPLICATION_ID',
    'Q_INDEX_ID',
    'Q_DATASOURCE_ID',
    'IDENTITY_POOL_ID',
    'IDENTITY_POOL_ROLE_ARN',
    'ROLE_ARN',
    'REGION',
    'API_ENDPOINT',
    'USER_POOL_ID',
    'CLIENT_NAME',
  ];
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
