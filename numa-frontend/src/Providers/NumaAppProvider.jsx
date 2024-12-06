import { createContext, useState, useContext, useEffect } from 'react';
import { useAuth } from '../Providers/AuthProvider';
import { v4 as uuidv4 } from 'uuid';
import {
  startQappGetSession,
  getSessionQApp,
  updateQSessionData,
  fetchAndEncodeFile,
  importFileToQApp,
} from '../qAppHelper';

// Create the context
const NumaAppContext = createContext();

// Custom hook for using context
export const useNumaApp = () => useContext(NumaAppContext);

// Global helper function to resolve references like @taskId
const resolveReference = (key, taskResults) => {
  if (key.startsWith('@')) {
    const taskId = key.slice(1); // Remove '@' to get the task ID
    // Check if the taskId exists in taskResults and return the corresponding value
    return taskResults[taskId] !== undefined ? taskResults[taskId] : '';
  }
  return key; // If it's not a reference, just return the key (unchanged)
};

// Function to create a payload dynamically from a template
function createPayloadFromTemplate(template, inputValues, taskResults) {
  console.log('inputValues', inputValues);
  console.log('taskResults', taskResults);

  // Main function to recursively handle template (string, array, or object)
  if (typeof template === 'string') {
    // Replace all references of @taskId with the actual task result values
    return template.replace(/@[\w-]+/g, (match) =>
      resolveReference(match, taskResults),
    );
  } else if (Array.isArray(template)) {
    // Handle case for arrays (recursively apply transformation)
    return template.map((item) =>
      createPayloadFromTemplate(item, inputValues, taskResults),
    );
  } else if (typeof template === 'object' && template !== null) {
    // Handle case for objects (recursively apply transformation)
    return Object.entries(template).reduce((acc, [key, value]) => {
      const processedValue = createPayloadFromTemplate(
        value,
        inputValues,
        taskResults,
      );

      // Only include non-empty values
      if (processedValue !== '') {
        acc[key] = processedValue;
      }
      return acc;
    }, {});
  }

  return template; // Return as is for other data types (numbers, booleans, etc.)
}

// Provider component
export const NumaAppProvider = ({ children }) => {
  const { qAppsClient } = useAuth();

  const [loading, setLoading] = useState(true);
  const [numaTaskResponses, setNumaTaskResponses] = useState([]);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [runActive, setRunActive] = useState('disabled');
  const [appRunning, setAppRunning] = useState(false);

  // New states for processing progress
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');

  // Numa related
  const [numaApps, setNumaApps] = useState([]);
  const [numaAppData, setNumaAppData] = useState(null);
  const [numaAppId, setNumaAppId] = useState(null);
  const [taskInputValues, setTaskInputValues] = useState({});
  const [progress, setProgress] = useState(0);

  // Q native related
  const [qAppData, setqAppData] = useState([]);
  const [qSsessionId, setQSessionId] = useState(null);
  const [qCardInputValues, setQCardInputValues] = useState({});

  const [taskCompletionStatus, setTaskCompletionStatus] = useState({});

  // Function to get app jobs from local storage
  const getAppJobs = () => {
    const jobsKey = `appJobs_${numaAppId}`;
    const storedJobs = localStorage.getItem(jobsKey);
    return storedJobs ? JSON.parse(storedJobs) : [];
  };

  const checkRunActive = () => {
    if (!numaAppData || !numaAppData.tasks) {
      setRunActive('disabled');
      return;
    }

    // Track completed tasks for progress calculation
    let completedCount = 0;
    let totalRequiredTasks = 0;

    const allTasksCompleted = numaAppData.tasks.every((task) => {
      if (!task.requiredTasks) return true; // No dependencies, task is valid for 'Run' button

      const { any } = task.requiredTasks;
      if (any) {
        totalRequiredTasks++; // Increment count for required tasks

        // Check if any required task is completed
        const isTaskCompleted = any.some((requiredTaskId) => {
          const lookupId = requiredTaskId.startsWith('@')
            ? requiredTaskId.slice(1)
            : requiredTaskId;
          const isCompleted = taskCompletionStatus[lookupId];
          if (isCompleted) completedCount++; // Increment completed task count if this task is completed
          return isCompleted;
        });

        return isTaskCompleted;
      }
      return false;
    });

    // Enable the 'Run' button only if all required tasks are completed
    setRunActive(allTasksCompleted ? '' : 'disabled');

    // Calculate and set the progress bar (based on required tasks only)
    const progress =
      totalRequiredTasks > 0 ? (completedCount / totalRequiredTasks) * 100 : 0;
    setProgress(progress); // Set the progress for the progress bar
  };

  useEffect(() => {
    checkRunActive();
  }, [taskInputValues]);

  // Get an apps details from manifest via session
  useEffect(() => {
    if (!numaAppId) return;

    const fetchData = async () => {
      try {
        const appsData = JSON.parse(sessionStorage.getItem('appsData'));
        const app = appsData.find((app) => app.id === numaAppId);
        setNumaAppData(app);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching app data:', error);
        setError(error);
        setLoading(false);
      }
    };

    fetchData();
  }, [numaAppId]);

  // Task Processing Functions
  const processTextInputTask = (task, currentResults) => {
    currentResults[task.id] = taskInputValues[task.id] || '';
    console.log(`Input task result: ${currentResults[task.id]}`);
    return currentResults;
  };

  const processS3UploadTask = (task, currentResults) => {
    const uploadedFilePath = taskInputValues[task.id];
    currentResults[task.id] = uploadedFilePath;
    console.log(`S3 upload result: ${currentResults[task.id]}`);
    return currentResults;
  };

  const processHttpRequestTask = async (task, currentResults) => {
    const templatePayload = task.params?.payload;
    const payload = createPayloadFromTemplate(
      templatePayload,
      taskInputValues,
      currentResults,
    );
    console.log('Generated Payload for http-request:', payload);

    const response = await fakeHttpRequestFunction(payload);
    console.log('HTTP Request response:', response);

    if (!response) {
      throw new Error('HTTP request failed');
    }

    currentResults[task.id] = response?.data;
    return currentResults;
  };

  const pollQAppSession = async (sessionId) => {
    const pollInterval = 2000;
    let polling = true;
    let sessionResponse = null;

    while (polling) {
      sessionResponse = await getSessionQApp({
        qAppsClient,
        sessionId,
      });
      console.log(`Q App session response:`, sessionResponse);

      if (sessionResponse?.status === 'COMPLETED') {
        polling = false;
      } else if (sessionResponse?.status === 'FAILED') {
        polling = false;
        throw new Error('Q App session failed');
      } else {
        console.log('Session not completed yet, waiting for next poll...');
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    return sessionResponse;
  };

  const processQAppTask = async (task, currentResults) => {
    console.log(`Processing Q-App task with ID: ${task.id}`);
    const inputParamsArray = task.params.inputs;
    const updateValues = [];

    // Start session with built initialValues
    let sessionId = await startQappGetSession({
      qAppsClient,
      qAppId: task.params.qAppId,
      appVersion: task.appVersion,
      initialValues: null
    });

    if (!sessionId) {
      console.error('Failed to start Q App session');
      return;
    }

    // Single loop to handle both regular inputs and file imports
    for (const inputParam of inputParamsArray) {
      const { inputContentRef, qInputCardId, base64encode } = inputParam;
      const inputValue = resolveReference(inputContentRef, currentResults);
      console.log(
        `Processing input from task ${inputContentRef} (resolved: ${inputValue}) for card ${qInputCardId}`,
      );

      if (base64encode && inputValue) {
        const { base64Content, fileName } = await fetchAndEncodeFile(inputValue);
        console.log('file encoded: ', base64Content);



        const fileId = await importFileToQApp({
          qAppsClient,
          sessionId,
          qAppId: task.params.qAppId,
          cardId: qInputCardId,
          fileName,
          base64Content,
        });

        if (!fileId) {
          console.error('No fileId received from import');
          return;
        }

        updateValues.push({ cardId: qInputCardId, value: fileId });
      } else if (inputValue !== undefined && inputValue !== null && inputValue !== '') {
        updateValues.push({ cardId: qInputCardId, value: inputValue });
      }
    }

    // Update session with all values at once
    if (updateValues.length > 0) {
      await updateQSessionData({
        qAppsClient,
        sessionId,
        values: updateValues
      });
    }

    const sessionResponse = await pollQAppSession(sessionId);

    // Process the output cards and map them to the correct output references
    if (sessionResponse?.cardStatus) {
      for (const [cardId, cardData] of Object.entries(sessionResponse.cardStatus)) {

        // Match cardId to outputContentRef ID
        const matchingOutput = task.params.outputs.find(
          (output) => output.qOutputCardId === cardId
        );

        if (matchingOutput) {
          const outputId = matchingOutput.outputContentRef.replace('@', '');
          currentResults[outputId] = cardData.currentValue;
          console.log(
            `Updated currentResults[${outputId}] with value:`,
            cardData.currentValue
          );
        }
      }
    }

    // Store the full session response in the task results
    currentResults[task.id] = {
      status: sessionResponse?.status,
      cardStatus: sessionResponse?.cardStatus
    };

    console.log('Final currentResults:', currentResults);
    return currentResults;
  };

  const processTextOutputTask = (task, currentResults) => {
    const outputRef = task.params?.dataRef;
    const outputResult = resolveReference(outputRef, currentResults);

    if (outputResult) {
      const resultToDisplay = typeof outputResult === 'object'
        ? JSON.stringify(outputResult)
        : outputResult;

      setNumaTaskResponses((prevResponses) => [
        ...prevResponses.filter((response) => response.taskId !== task.id),
        { taskId: task.id, result: resultToDisplay },
      ]);
    }
    return currentResults;
  };

  const initializeJobExecution = () => {
    const jobID = uuidv4();
    const dateTime = new Date().toISOString();
    setAppRunning(true);
    setLoading(true);
    return { jobID, dateTime };
  };

  const saveJobResults = (jobID, dateTime, currentResults) => {
    const existingJobs = JSON.parse(localStorage.getItem('numaJobs')) || {};

    // Initialize the app's jobs array if it doesn't exist
    if (!existingJobs[numaAppId]) {
      existingJobs[numaAppId] = [];
    }

    // Add the new job to the app's jobs array
    existingJobs[numaAppId].push({
      jobID,
      dateTime,
      results: currentResults,
      appName: numaAppData?.appName || 'Unknown App'
    });

    localStorage.setItem('numaJobs', JSON.stringify(existingJobs));
    console.log(`Job saved for app ${numaAppId}:`, {
      jobID,
      dateTime,
      appName: numaAppData?.appName
    });
  };

  const handleRunButtonClick = async (appData) => {
    const { jobID, dateTime } = initializeJobExecution();
    let currentResults = {};

    try {
      const orderedTasks = appData.tasks
        .slice()
        .sort((a, b) => a.order - b.order);

      const totalTasks = orderedTasks.length;
      let completedTasks = 0;

      for (const task of orderedTasks) {
        console.log(`Processing task with order ${task.order} and type ${task.type}`);

        // Update status message based on task type
        switch (task.type) {
          case 'text-input':
            setProcessingStatus('Processing input data...');
            break;
          case 's3-upload':
            setProcessingStatus('Uploading files...');
            break;
          case 'http-request':
            setProcessingStatus('Gathering data...');
            break;
          case 'q-app':
            setProcessingStatus('Running analysis...');
            break;
          case 'text-output':
            setProcessingStatus('Generating output...');
            break;
          default:
            setProcessingStatus('Processing...');
        }

        // Process the task
        switch (task.type) {
          case 'text-input':
            currentResults = processTextInputTask(task, currentResults);
            break;
          case 's3-upload':
            currentResults = processS3UploadTask(task, currentResults);
            break;
          case 'http-request':
            currentResults = await processHttpRequestTask(task, currentResults);
            break;
          case 'q-app':
            currentResults = await processQAppTask(task, currentResults);
            break;
          case 'text-output':
            currentResults = processTextOutputTask(task, currentResults);
            break;
          default:
            console.warn(`Unknown task type: ${task.type}`);
        }

        // Update progress
        completedTasks++;
        setProcessingProgress((completedTasks / totalTasks) * 100);
      }

      // Save results and update UI state after successful completion
      saveJobResults(jobID, dateTime, currentResults);
      setProcessingStatus('Complete!');
    } catch (err) {
      console.error('Error processing tasks:', err);
      setError(err);
      setProcessingStatus('Error occurred during processing');
    } finally {
      setLoading(false);
      setAppRunning(false);
      // Reset progress after a delay
      setTimeout(() => {
        setProcessingProgress(0);
        setProcessingStatus('');
      }, 2000);
    }
  };

  // Mock HTTP request function (replace with real implementation)
  const fakeHttpRequestFunction = async (payload) => {
    // Simulate HTTP request delay
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          data: 'http://localhost:5173/example-meeting-transcript.txt',
        });
      }, 1000);
    });
  };

  // Function to update a specific task input value
  const updateTaskInputValue = (taskId, value) => {
    setTaskInputValues((prev) => ({
      ...prev,
      [taskId]: value,
    }));
    checkRunActive();
  };

  function updateTaskCompletionStatus(taskId, isComplete = true) {
    setTaskCompletionStatus((prevStatus) => ({
      ...prevStatus,
      [taskId]: isComplete,
    }));
  }

  return (
    <NumaAppContext.Provider
      value={{
        loading,
        setLoading,
        error,
        setError,
        numaApps,
        setNumaApps,
        numaAppData,
        setNumaAppData,
        numaAppId,
        setNumaAppId,
        taskInputValues,
        setTaskInputValues,
        taskCompletionStatus,
        setTaskCompletionStatus,
        updateTaskCompletionStatus,
        progress,
        setProgress,
        runActive,
        setRunActive,
        numaTaskResponses,
        setNumaTaskResponses,
        handleRunButtonClick,
        qAppData,
        setqAppData,
        qSsessionId,
        setQSessionId,
        qCardInputValues,
        setQCardInputValues,
        isPolling,
        setIsPolling,
        appRunning,
        setAppRunning,
        processingProgress,
        setProcessingProgress,
        processingStatus,
        setProcessingStatus,
        getAppJobs,
      }}
    >
      {children}
    </NumaAppContext.Provider>
  );
};
