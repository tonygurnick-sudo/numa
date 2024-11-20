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

  const handleRunButtonClick = async (appData) => {
    const jobID = uuidv4();
    const dateTime = new Date().toISOString();

    let currentResults = {};

    try {
      setAppRunning(true);
      setLoading(true);

      // Sort tasks by their `order` property
      const orderedTasks = appData.tasks
        .slice()
        .sort((a, b) => a.order - b.order);

      // Process each task in order
      for (const task of orderedTasks) {
        console.log(
          `Processing task with order ${task.order} and type ${task.type}`,
        );

        if (task.type === 'text-input') {
          // Assume taskInputValues are already populated for input tasks
          currentResults[task.id] = taskInputValues[task.id] || '';
          console.log(`Input task result: ${currentResults[task.id]}`);
        }

        if (task.type === 's3-upload') {
          // Handle S3 upload task, storing the resulting file key (or URL) in currentResults
          const uploadedFilePath = taskInputValues[task.id];
          currentResults[task.id] = uploadedFilePath;
          console.log(`S3 upload result: ${currentResults[task.id]}`);
        }

        if (task.type === 'http-request') {
          // Extract and build payload for the http-request task
          const templatePayload = task.params?.payload;
          const payload = createPayloadFromTemplate(
            templatePayload,
            taskInputValues,
            currentResults,
          );
          console.log('Generated Payload for http-request:', payload);

          // Replace this with actual HTTP request logic
          const response = await fakeHttpRequestFunction(payload);
          console.log('HTTP Request response:', response);

          // no longer needed possibly
          // Format and store response for later use (stringified or processed)
          // const formattedResponse = {
          //   success: response?.success || false,
          //   data: response?.data || {},
          // };

          currentResults[task.id] = response?.data;

          if (!response) {
            throw new Error('HTTP request failed');
          }
        }

        if (task.type === 'q-app') {
          // Handle `q-app` task logic
          console.log(`Processing Q-App task with ID: ${task.id}`);
          try {
            const inputParamsArray = task.params.inputs;
            const initialValues = [];

            const sessionId = await startQappGetSession({
              qAppsClient,
              qAppId: task.params.qAppId,
              appVersion: task.appVersion,
            });

            for (const inputParam of inputParamsArray) {
              const { inputContentRef, qInputCardId, base64encode } =
                inputParam;

              // Use the global resolveReference function to get the value from currentResults
              const inputValue = resolveReference(
                inputContentRef,
                currentResults,
              );
              console.log(
                `Fetching input from task ${inputContentRef} (resolved: ${inputValue}) for card ${qInputCardId}`,
              );

              // If `base64encode` is true, handle the file as required
              if (base64encode && inputValue) {
                console.log(
                  `Base64 encoding enabled for card: ${qInputCardId}`,
                );
                const { base64Content, fileName } =
                  await fetchAndEncodeFile(inputValue);

                console.log('file encoded: ', base64Content);
                if (sessionId) {
                  const fileId = importFileToQApp({
                    qAppId: task.params.qAppId,
                    qInputCardId,
                    base64Content,
                    fileName,
                    sessionId,
                  });
                  console.log(`File uploaded, received fileId: ${fileId}`);

                  // Add the file ID to the initial values
                  initialValues.push({ cardId: qInputCardId, value: fileId });
                }
              } else if (
                inputValue !== undefined &&
                inputValue !== null &&
                inputValue !== ''
              ) {
                initialValues.push({ cardId: qInputCardId, value: inputValue });
              } else {
                console.warn(
                  `Skipping empty or null value for card ${qInputCardId}`,
                );
              }
            }

            const qAppData = {
              qAppId: task.params.qAppId,
              appVersion: task.appVersion,
              appDefinition: {
                cards: initialValues,
              },
            };

            // adjust to an update call
            // not sure if its the same session id that we get back
            const new_sessionId = await updateQSessionData({
              qAppsClient,
              qAppData,
            });

            console.log(`Q App session updated, session ID: ${new_sessionId}`);

            // Poll for results
            const pollInterval = 2000; // milliseconds
            let polling = true;

            // Ensure the task results object is initialized
            currentResults[task.id] = currentResults[task.id] || {};

            while (polling) {
              const sessionResponse = await getSessionQApp({
                qAppsClient,
                sessionId,
              });
              console.log(`Q App session response:`, sessionResponse);

              if (sessionResponse.status === 'COMPLETED') {
                for (const [cardId, cardData] of Object.entries(
                  sessionResponse.cardStatus,
                )) {
                  console.log('in loop - cardId to lookup...', cardId);
                  console.log('task.params.outputs...', task.params.outputs);

                  // Match cardId to outputContentRef ID
                  const matchingOutput = task.params.outputs.find(
                    (output) => output.qOutputCardId === cardId,
                  );
                  console.log('matchingOutput...', matchingOutput);
                  if (matchingOutput) {
                    const outputId = matchingOutput.outputContentRef.replace(
                      '@',
                      '',
                    );

                    console.log('output id to create...', outputId);
                    currentResults[outputId] = cardData.currentValue;

                    console.log(
                      `Updated currentResults[${outputId}] with state: ${cardData.currentState} and value: ${cardData.currentValue}`,
                    );
                  }
                }
                polling = false;
              } else {
                console.log(
                  'Session not completed yet, waiting for next poll...',
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, pollInterval),
                );
              }
            }

            console.log('Q App session processing complete.');

            console.log(
              `Updated currentResults for task ${task.id}:`,
              currentResults[task.id],
            );
          } catch (error) {
            console.error(`Error processing Q-App task ${task.id}:`, error);
            throw error;
          }
        }

        console.log('currentResults', currentResults);

        if (task.type === 'text-output') {
          const outputRef = task.params?.dataRef;
          console.log('Output task, outputRef:', outputRef);

          // Resolve the reference using resolveReference
          const outputResult = resolveReference(outputRef, currentResults);
          console.log('Output task, outputResult:', outputResult);

          if (outputResult) {
            // Safely handle the output result
            const resultToDisplay =
              typeof outputResult === 'object'
                ? JSON.stringify(outputResult)
                : outputResult;

            console.log('Output task, showing result:', resultToDisplay);

            // Update the state for the specific task
            setNumaTaskResponses((prevResponses) => [
              ...prevResponses.filter(
                (response) => response.taskId !== task.id,
              ), // Remove old response if present
              { taskId: task.id, result: resultToDisplay }, // Add the new response
            ]);
          } else {
            console.log('No result found for outputRef:', outputRef);
          }
        }

        // Add additional task types and their handling logic as needed
      }
    } catch (err) {
      console.error('Error processing tasks:', err);
      setError(err);
    } finally {
      // Save job results in local storage with the jobID as the reference
      const existingJobs = JSON.parse(localStorage.getItem('numaJobs')) || [];
      existingJobs.push({ jobID, dateTime, results: currentResults });
      localStorage.setItem('numaJobs', JSON.stringify(existingJobs));

      setLoading(false);
      setAppRunning(true);
    }
  };

  // Mock HTTP request function (replace with real implementation)
  const fakeHttpRequestFunction = async (payload) => {
    // Simulate HTTP request delay
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          data: 'http://localhost:5173/example-file.txt',
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
        appRunning,
        numaTaskResponses,
        error,
        setError,
        isPolling,
        setIsPolling,
        runActive,
        progress,
        setProgress,
        setRunActive,
        handleRunButtonClick,
        setNumaApps,
        numaApps,
        setNumaAppId,
        numaAppData,
        taskInputValues,
        updateTaskInputValue,
        updateTaskCompletionStatus,
        taskCompletionStatus,
        setqAppData,
        qAppData,
        setQCardInputValues,
        qCardInputValues,
        setQSessionId,
        qSsessionId,
      }}
    >
      {children}
    </NumaAppContext.Provider>
  );
};
