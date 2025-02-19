import exampleItem from './Data/Meeting_Tools_Q_App_v27.json';
import {
  CreateQAppCommand,
  CreateLibraryItemCommand,
  DeleteQAppCommand,
  ListQAppsCommand,
  GetQAppSessionCommand,
  UpdateQAppSessionCommand,
  StartQAppSessionCommand,
  ImportDocumentCommand,
} from '@aws-sdk/client-qapps';

const Q_APPLICATION_ID = sessionStorage.getItem('Q_APPLICATION_ID');
/*
 *   Start a Q app session
 */
export const startQappGetSession = async ({ qAppsClient, qAppId, appVersion, initialValues }) => {
  if (!qAppsClient) return;

  try {
    const payload = {
      instanceId: Q_APPLICATION_ID,
      appId: qAppId,
      appVersion: Number(appVersion),
      initialValues: Array.isArray(initialValues) ? initialValues : [],
    };
    console.log('start payload:', payload);
    const command = new StartQAppSessionCommand(payload);
    const response = await qAppsClient.send(command);

    if (response) {
      console.log('Q App session started successfully:', response);
      return response.sessionId;
    }
  } catch (error) {
    console.error('Error starting app session:', error);
    throw error;
  }
};

/*
 *   updat an already running Q app session
 */
export const updateQSessionData = async ({ qAppsClient, sessionId, values }) => {
  try {
    const payload = {
      instanceId: Q_APPLICATION_ID,
      sessionId: sessionId,
      values: values,
    };
    console.log('update payload:', payload);
    const command = new UpdateQAppSessionCommand(payload);
    const response = await qAppsClient.send(command);

    // Simulating an API response.
    // const response = { sessionId: sessionId }; // Simulated response

    console.log('update response:', response);
    if (response) {
      return response.sessionId;
    }
  } catch (error) {
    console.error('Error updating app session:', error);
  }
};

/*
 *   Get a Q app response with a sessionId
 */
export const getSessionQApp = async ({ qAppsClient, sessionId }) => {
  if (!qAppsClient) return;

  try {
    const input = {
      instanceId: Q_APPLICATION_ID,
      sessionId: sessionId,
    };

    const command = new GetQAppSessionCommand(input);
    const resoponse = await qAppsClient.send(command);

    if (resoponse) {
      return resoponse;
    }
  } catch (error) {
    console.error('Error starting app session:', error);
  }
};

/*
 *   Takes in a file URL, retrieves the file, base64 encodes it, and extracts the filename.
 */
export const fetchAndEncodeFile = async (fileUrl) => {
  if (!fileUrl) return;

  try {
    // Extract the filename from the URL
    const urlParts = fileUrl.split('/');
    const fileName = urlParts[urlParts.length - 1] || 'default.txt';

    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file from URL: ${fileUrl}`);
    }

    // Get the text content
    const text = await response.text();

    // Convert text to base64 with proper padding
    const base64Content = btoa(unescape(encodeURIComponent(text)));

    // Ensure proper base64 padding
    const paddedBase64 = base64Content + '='.repeat((4 - (base64Content.length % 4)) % 4);

    // Additional validation
    const isValidBase64 = /^[A-Za-z0-9+/]+={0,3}$/.test(paddedBase64);
    if (!isValidBase64) {
      console.log('Invalid characters:', paddedBase64.match(/[^A-Za-z0-9+/=]/g));
    }

    // Validate base64 string (including proper padding)
    if (!paddedBase64 || !isValidBase64) {
      throw new Error('Invalid base64 string format after encoding');
    }

    return { base64Content: paddedBase64, fileName };
  } catch (error) {
    console.error(`Error fetching or encoding file: ${error}`);
    throw error;
  }
};

/*
 *   upload a file to a Q App
 */
export const importFileToQApp = async ({ qAppsClient, sessionId, qAppId, cardId, fileName, base64Content }) => {
  // Validate all required fields
  const requiredFields = {
    qAppsClient,
    cardId,
    qAppId,
    fileName,
    base64Content,
    sessionId,
  };

  for (const [field, value] of Object.entries(requiredFields)) {
    if (!value) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  try {
    // Remove any data URL prefix if present
    const cleanBase64 = base64Content.replace(/^data:[^;]+;base64,/, '');

    // Calculate and add required padding
    let paddedBase64 = cleanBase64;
    const padding = 4 - (paddedBase64.length % 4);
    if (padding !== 4) {
      // only add padding if needed
      paddedBase64 = paddedBase64 + '='.repeat(padding);
    }

    // Add the data URL prefix for text files
    const dataUrl = `data:text/plain;base64,${paddedBase64}`;

    // Try decoding to verify content
    try {
      atob(paddedBase64);
    } catch (e) {
      console.error('Failed to decode base64:', e);
      throw new Error('Invalid base64 encoding');
    }

    const payload = {
      appId: qAppId,
      cardId: cardId,
      fileContentsBase64: dataUrl, // Use the full data URL
      fileName: fileName,
      instanceId: Q_APPLICATION_ID,
      scope: 'SESSION',
      sessionId: sessionId,
    };

    // Log full payload structure (without actual base64 content)
    console.log('Import file payload structure:', {
      ...payload,
      fileContentsBase64: `<data URL length: ${dataUrl.length}>`,
    });

    const command = new ImportDocumentCommand(payload);
    const response = await qAppsClient.send(command);

    if (response) {
      console.log('File imported successfully:', response);
      return response.fileId;
    } else {
      throw new Error('No response received from import command');
    }
  } catch (error) {
    // Enhanced error logging
    console.error('Error importing file:', {
      message: error.message,
      name: error.name,
      code: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId,
      cfId: error.$metadata?.cfId,
      extendedRequestId: error.$metadata?.extendedRequestId,
    });
    throw error;
  }
};

/*
 *   Used to delete a Q app from the user accounta
 */
export const deleteQAppById = async ({ qAppsClient, qAppId, setLoading, setError, setResponse }) => {
  if (!qAppsClient || !qAppId) {
    console.error('Missing required parameters.');
    return;
  }

  try {
    setLoading(true);

    const command = new DeleteQAppCommand({
      appId: qAppId,
      instanceId: Q_APPLICATION_ID,
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

export const createQApp = async ({ qAppsClient, setLoading, setError, setResponse }) => {
  if (!qAppsClient) {
    const error = 'Q Apps client is not initialized';
    console.error(error);
    setError(error);
    return;
  }

  try {
    setLoading(true);
    setError(null);
    setResponse(null);

    console.log('Creating Q App with configuration:', exampleItem);

    const command = new CreateQAppCommand(exampleItem);
    const response = await qAppsClient.send(command);
    console.log('Q App created successfully:', response);

    if (response) {
      setResponse({
        response,
        type: 'create',
        message: `Q App created successfully with ID: ${response.id}`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error creating Q App:', error);
    setError(error.message || 'Failed to create Q App. Please check your configuration and try again.');
  } finally {
    setLoading(false);
  }
};

export const addAppToLibrary = async ({ qAppsClient, appId, setLoading, setResponse }) => {
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
      instanceId: Q_APPLICATION_ID,
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

// FETCH Q APPS
export const fetchApps = async (qAppsClient) => {
  if (!qAppsClient) return;

  try {
    const input = {
      instanceId: Q_APPLICATION_ID,
    };

    const command = new ListQAppsCommand(input);
    const response = await qAppsClient.send(command);

    return response.apps;
  } catch (error) {
    console.error('Error fetching Q Apps:', error);
  }
};
