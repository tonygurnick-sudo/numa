import { createContext, useState, useContext, useEffect } from 'react';

// Create the context
const NumaAppContext = createContext();

// Custom hook for using context
export const useNumaApp = () => useContext(NumaAppContext);

// Function to create a payload dynamically from a template
function createPayloadFromTemplate(template, inputValues, taskResults) {
  console.log('inputValues', inputValues);
  console.log('taskResults', taskResults);

  // Helper function to resolve references like @taskId
  const resolveReference = (key) => {
    if (key.startsWith('@')) {
      const taskId = key.slice(1); // Remove '@' to get task id
      // Check if the taskId exists in taskResults and return the corresponding value
      return taskResults[taskId] !== undefined ? taskResults[taskId] : '';
    }
    return key; // If it's not a reference, just return the key (unchanged)
  };

  // Main function to recursively handle template (string, array, or object)
  if (typeof template === 'string') {
    // Replace all references of @taskId with the actual task result values
    return template.replace(/@[\w-]+/g, (match) => resolveReference(match));
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
  const [loading, setLoading] = useState(true);
  const [numaTaskResponse, setNumaTaskResponse] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [runActive, setRunActive] = useState('disabled');

  // Numa related
  const [numaApps, setNumaApps] = useState([]);
  const [numaAppData, setNumaAppData] = useState(null);
  const [numaAppId, setNumaAppId] = useState(null);
  const [taskInputValues, setTaskInputValues] = useState({});

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

    const allTasksCompleted = numaAppData.tasks.every((task) => {
      if (!task.requiredTasks) return true; // No dependencies mean it's valid
      const { any } = task.requiredTasks;
      if (any) {
        console.log('found some any', any);
        return any.some(
          (requiredTaskId) => taskCompletionStatus[requiredTaskId],
        );
      }
      return false;
    });

    setRunActive(allTasksCompleted ? '' : 'disabled');
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
        const app = appsData.apps.find((app) => app.id === numaAppId);
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

  const handleRunButtonClick = async (appId, appData) => {
    try {
      setLoading(true);
      let currentResults = {}; // To store results of each task

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

          // Format and store response for later use (stringified or processed)
          const formattedResponse = {
            success: response?.success || false,
            data: response?.data || {},
          };

          currentResults[task.id] = formattedResponse;
          setNumaTaskResponse(formattedResponse);

          if (!response) {
            throw new Error('HTTP request failed');
          }
        }

        if (task.type === 'text-output') {
          // For output tasks, check if the source task's result is an object
          const outputResult = currentResults[task.params.sourceTaskId];

          if (outputResult) {
            // Safely handle the output result
            const resultToDisplay =
              typeof outputResult === 'object'
                ? JSON.stringify(outputResult)
                : outputResult;

            console.log('Output task, showing result:', resultToDisplay);
          }
        }

        // Add additional task types and their handling logic as needed
      }
    } catch (err) {
      console.error('Error processing tasks:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  // Mock HTTP request function (replace with real implementation)
  const fakeHttpRequestFunction = async (payload) => {
    // Simulate HTTP request delay
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, data: 'We did it!' });
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
        numaTaskResponse,
        error,
        setError,
        isPolling,
        setIsPolling,
        runActive,
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
