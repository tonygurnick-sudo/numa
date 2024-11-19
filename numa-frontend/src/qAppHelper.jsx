import exampleItem from './Data/ExampleitemToCreate.json';
import {
  CreateQAppCommand,
  CreateLibraryItemCommand,
  DeleteQAppCommand,
  ListQAppsCommand,
  GetQAppSessionCommand,
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

  // Mocked session ID and response
  const mockSessionId = 'mock-session-id-12345';

  try {
    const payload = {
      instanceId: APPLICATION_ID,
      appId: qAppId,
      appVersion: qAppData.appVersion,
      initialValues: qAppData.appDefinition.cards,
    };
    console.log('start payload:', payload);
    const start_command = new StartQAppSessionCommand(payload);
    //const start_response = await qAppsClient.send(start_command);

    // Simulating an API response.
    const start_response = { sessionId: mockSessionId }; // Simulated response

    console.log('start_response:', start_response);
    if (start_response) {
      console.log('Q App session started successfully:', start_response);
      return start_response.sessionId;
    }
  } catch (error) {
    console.error('Error starting app session:', error);
  }
};

/*
 *   Get a Q app response with a sessionId
 */
export const getSessionQApp = async ({ qAppsClient, sessionId }) => {
  if (!qAppsClient) return;
  console.log('debug - sessionId', sessionId);

  // Mocked session ID and response
  const mockSessionId = 'mock-session-id-12345';

  try {
    const input = {
      instanceId: sessionId,
      sessionId: APPLICATION_ID,
    };

    const get_command = new GetQAppSessionCommand(input);
    //const get_response = await qAppsClient.send(get_command);

    // Simulating an API response with detailed cardStatus for two cards.
    const mockResponse = {
      sessionId: mockSessionId,
      cardStatus: {
        '60796c48-3cfa-44a5-9b4e-b60f76d470f7': {
          currentState: 'COMPLETED',
          currentValue:
            'Summary of the discussion including key points and takeaways.',
        },
        '6539cff8-a245-43cc-b8c1-18f6dcd483d0': {
          currentState: 'COMPLETED',
          currentValue:
            'Actions and next steps outlined based on meeting insights.',
        },
      },
      sessionArn:
        'arn:aws:qapps:us-west-2:0123456789012:application/a929ecd6-5765-4ec7-bd3e-2ca90098b18e/qapp/65e7dce7-226a-47f9-b689-22850becef89/session/1fca878e-64c5-4dc4-b1d9-c93effed4e82',
      status: 'COMPLETED',
    };

    // Adding a delay
    const get_response = await new Promise((resolve) =>
      setTimeout(() => resolve(mockResponse), 5000),
    );

    console.log('start_response:', get_response);
    if (get_response) {
      return get_response;
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
