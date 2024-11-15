import exampleItem from './Data/ExampleitemToCreate.json';
import {
  CreateQAppCommand,
  CreateLibraryItemCommand,
  DeleteQAppCommand,
  ListQAppsCommand,
  ListLibraryItemsCommand,
  StartQAppSessionCommand,
} from '@aws-sdk/client-qapps';

const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

/*
 *   Run a Q app by starting a session
 */
export const sendInputToQApp = async ({ qAppsClient, qAppData }) => {
  if (!qAppsClient) return;
  console.log('debug - qAppData', qAppData);
  console.log('debug - qAppId', qAppData.qAppId);
  const qAppId = qAppData.qAppId;

  try {
    const payload = {
      instanceId: APPLICATION_ID,
      appId: qAppId,
      appVersion: qAppData.appVersion,
      initialValues: qAppData.appDefinition.cards
        .map((card) => {
          const cardId = card[Object.keys(card)[0]].id;
          const defaultValue = card[Object.keys(card)[0]].defaultValue;
          return { cardId, value: defaultValue || '' };
        })
        .filter((card) => card.value !== ''), // Filter out cards without a value
    };

    const start_command = new StartQAppSessionCommand(payload);
    const start_response = await qAppsClient.send(start_command);

    if (start_response) {
      console.log('Q App session started successfully:', start_response);
      return start_response.sessionId;
    }
  } catch (error) {
    console.error('Error starting app session:', error);
  }
};

/*
 *   Used to delete a Q app from the user accounta
 */
export const deleteQAppById = async ({
  qAppsClient,
  appId,
  setLoading,
  setError,
  setResponse,
}) => {
  if (!qAppsClient || !appId) {
    console.error('Missing required parameters.');
    return;
  }

  try {
    setLoading(true);

    const command = new DeleteQAppCommand({
      appId,
      instanceId: APPLICATION_ID,
    });

    const response = await qAppsClient.send(command);

    if (response) {
      setResponse({ response, type: 'delete' });
    }
  } catch (error) {
    setError(error.message || 'Error deleting Q App');
  } finally {
    setLoading(false);
  }
};

export const createQApp = async ({
  qAppsClient,
  appPayload,
  setLoading,
  setError,
  setResponse,
}) => {
  if (!qAppsClient) {
    console.error('Missing required parameters.');
    return;
  }

  try {
    setLoading(true);

    // TODO wire up actual appPayload instead of using example data
    console.log('exampleItem', exampleItem);

    const command = new CreateQAppCommand(exampleItem);
    const response = await qAppsClient.send(command);
    console.log('response create app: ', response);

    if (response) {
      setResponse({ response, type: 'create' });
    }
  } catch (error) {
    setError(error.message || 'Error creating a Q App');
  } finally {
    setLoading(false);
  }
};

export const addAppToLibrary = async ({
  qAppsClient,
  appId,
  setLoading,
  setError,
  setResponse,
}) => {
  if (!qAppsClient) {
    console.error('Missing required parameters.');
    return;
  }

  //code to deploy a app to library:
  try {
    const addAppToLibCommand = {
      appId: appId,
      appVersion: 1, // TODO  ?
      categories: ['9c871ed4-1c41-4065-aefe-321cd4b61cf8'], // TODO
      instanceId: APPLICATION_ID,
    };
    const command = new CreateLibraryItemCommand(addAppToLibCommand);
    const response = await qAppsClient.send(command);
    if (response) {
      setResponse({ response, type: 'add-app-to-lib' });
    }
  } catch (error) {
    console.error('Error adding Q App to lib:', error);
  } finally {
    setLoading(false);
  }
};

export const fetchLibItems = async (qAppsClient) => {
  if (!qAppsClient) return;

  // Get lib apps
  try {
    const input = {
      instanceId: APPLICATION_ID,
    };

    const lib_command = new ListLibraryItemsCommand(input);
    const lib_response = await qAppsClient.send(lib_command);

    // TODO
    //setLibraryApps(lib_response.libraryItems);
  } catch (error) {
    console.error('Error fetching Q Apps:', error);
  }
};

// FETCH Q APPS
// export const fetchApps = async (qAppsClient) => {
//   if (!qAppsClient) return;

//   // Get user appointed apps
//   try {
//     const input = {
//       instanceId: APPLICATION_ID,
//     };

//     const command = new ListQAppsCommand(input);
//     const response = await qAppsClient.send(command);

//     // Filter myApps and add a flag
//     const uniqueApps = response.apps.map((app) => ({
//       ...app,
//       isMyApp: libraryApps.some((libApp) => libApp.appID === app.appID),
//     }));

//     return uniqueApps;
//     //setApps(response.apps);
//   } catch (error) {
//     console.error('Error fetching Q Apps:', error);
//   }
// };
