export const fetchConfigAddtoSession = async () => {
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));

    const is_config = sessionStorage.getItem('Q_APPLICATION_ID', null);

    if (is_config === null) {
      // TODO: change to load from s3 location

      const response = await fetch('../config.json', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch manifest');
      }

      const configData = await response.json();

      // Loop through the desired properties and add them to sessionStorage
      const propertiesToAdd = [
        'Q_APPLICATION_ID',
        'Q_INDEX_ID',
        'Q_DATASOURCE_ID',
        'IDENTITY_POOL_ID',
        'ROLE_ARN',
        'REGION',
        'API_ENDPOINT',
        'USER_POOL_ID',
        'CLIENT_ID',
      ];
      propertiesToAdd.forEach((property) => {
        sessionStorage.setItem(property, configData[property]);
      });

      // reload so the items are available at login.
      window.location.reload();
    }
  } catch (error) {
    console.error('Error loading apps:', error);
  }
};
