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
import { jobsApi } from '../Services/jobsApi';

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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [numaApps, setNumaApps] = useState([]);
  const [numaAppData, setNumaAppData] = useState(null);
  const [numaAppId, setNumaAppId] = useState(null);
  const [jobHistorySidebarOpen, setJobHistorySidebarOpen] = useState(false);
  const [numaTaskResponses, setNumaTaskResponses] = useState([]);
  const [taskInputValues, setTaskInputValues] = useState({});
  const [taskCompletionStatus, setTaskCompletionStatus] = useState({});
  const [runActive, setRunActive] = useState('disabled');
  const [progress, setProgress] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [appRunning, setAppRunning] = useState(false);

  // New states for processing progress
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');

  // Q native related
  const [qAppData, setqAppData] = useState([]);
  const [qSsessionId, setQSessionId] = useState(null);
  const [qCardInputValues, setQCardInputValues] = useState({});

  const [jobs, setJobs] = useState([]);

  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const [activeStep, setActiveStep] = useState(0);

  // Load jobs for the current app
  const loadAppJobs = async () => {
    if (!numaAppId) return;
    try {
      const appJobs = await jobsApi.getJobsByAppId(numaAppId);
      setJobs(appJobs);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  };

  // Reload jobs whenever the app changes
  useEffect(() => {
    loadAppJobs();
  }, [numaAppId]);

  const getAppJobs = () => jobs;

  // Function to get app jobs from local storage
  // const getAppJobs = () => {
  //   const allJobs = JSON.parse(localStorage.getItem('numaJobs')) || {};
  //   return allJobs[numaAppId] || [];
  // };

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

  const processHttpRequestTask = async (jobID, task, currentResults) => {
    const templatePayload = task.params?.payload;
    const payload = createPayloadFromTemplate(
      templatePayload,
      taskInputValues,
      currentResults,
    );
    
    // Include the parent job ID in the payload
    const requestPayload = {
      ...payload,
      jobId: jobID
    };
    console.log('Generated Payload for http-request:', requestPayload);

    // Initial request should return success status
    const response = await fakeHttpRequestFunction(requestPayload);
    console.log('HTTP Request response:', response);

    if (!response?.success) {
      throw new Error('HTTP request failed');
    }

    // Start polling for status
    const maxAttempts = 30;
    const pollInterval = 2000;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const status = await NumaPollStatus(jobID);
      console.log('Poll status response:', status);

      if (status.status === 'SUCCESS') {
        currentResults[task.id] = status.result;
        return currentResults;
      } else if (status.status === 'FAILURE' || status.status === 'UNKNOWN') {
        throw new Error(`Job failed with status: ${status.status}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;
    }

    throw new Error('Polling timed out');
  };

  const processTextOutputTask = (task, currentResults) => {
    const outputRef = task.params?.dataRef;
    const outputResult = resolveReference(outputRef, currentResults);

    if (outputResult) {
      let resultToDisplay = outputResult;

      if (typeof outputResult === 'object') {
        // If it's an array of objects, convert to markdown table
        if (Array.isArray(outputResult) && outputResult.length > 0 && typeof outputResult[0] === 'object') {
          const headers = Object.keys(outputResult[0]);
          const headerRow = `| ${headers.join(' | ')} |`;
          const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
          const dataRows = outputResult.map(item =>
            `| ${headers.map(header => item[header] || '').join(' | ')} |`
          );
          resultToDisplay = [headerRow, separatorRow, ...dataRows].join('\n');
        } else {
          // For other objects, format as code block
          resultToDisplay = '```json\n' + JSON.stringify(outputResult, null, 2) + '\n```';
        }
      }

      setNumaTaskResponses((prevResponses) => [
        ...prevResponses.filter((response) => response.taskId !== task.id),
        { taskId: task.id, result: resultToDisplay },
      ]);
    }
    return currentResults;
  };

  const pollQAppSession = async (sessionId, updateProgress) => {
    console.log('Starting to poll Q-App session:', sessionId);
    let polling = true;
    let sessionResponse = null;

    while (polling) {
      try {
        console.log('Polling Q-App session...');
        sessionResponse = await getSessionQApp({
          qAppsClient,
          sessionId,
        });

        if (sessionResponse?.status === 'COMPLETED') {
          polling = false;
          return { ...sessionResponse, progress: 100 };
        } else if (sessionResponse?.status === 'FAILED') {
          console.log('Q-App session failed');
          polling = false;
          throw new Error('Q App session failed');
        }

        // Calculate progress from card statuses
        let progress = 0;
        if (sessionResponse?.cardStatus) {
          const cards = Object.values(sessionResponse.cardStatus);
          const totalCards = cards.length;
          const completedCards = cards.filter(
            (card) => card.currentState === 'COMPLETED',
          ).length;
          const runningCards = cards.filter(
            (card) => card.currentState === 'RUNNING',
          ).length;

          // Count completed cards fully and running cards as half complete
          progress = Math.round(
            ((completedCards + runningCards * 0.5) / totalCards) * 100,
          );
          progress = Math.min(progress, 99); // Cap at 99% until fully complete


          // Call the progress update callback
          if (updateProgress) {
            updateProgress(progress);
          } else {
            console.warn('No progress update callback provided');
          }
        } else {
          console.log('No card status in session response');
        }

        sessionResponse.progress = progress || 5; // Minimum 5% progress
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Error polling Q App session:', error);
        polling = false;
        throw error;
      }
    }

    return sessionResponse;
  };

  const initializeJob = async () => {
    setAppRunning(true);
    setLoading(true);

    try {
      // Create job in API
      const jobResponse = await jobsApi.createJob(
        numaAppData,
        taskInputValues
      );

      return {
        jobID: jobResponse.jobID,
        dateTime: jobResponse.startedAt
      };
    } catch (error) {
      console.error('Failed to create job:', error);
      setAppRunning(false);
      setLoading(false);
      throw error;
    }
  };

  const saveJobResults = async (jobID, dateTime, currentResults) => {
    try {
      // Get all text-output tasks
      const textOutputTasks = numaAppData.tasks.filter(task => task.type === 'text-output');

      // Build results object from text-output tasks
      const textOutputResults = textOutputTasks.reduce((acc, task) => {
        // Get the referenced data from currentResults
        const dataRef = task.params.dataRef.slice(1); // Remove @ from reference
        if (currentResults[dataRef]) {
          acc[task.id] = currentResults[dataRef];
        }
        return acc;
      }, {});

      // Update the job using jobsApi
      await jobsApi.updateJob(jobID, textOutputResults);

      // Refresh the jobs list
      await loadAppJobs();
    } catch (error) {
      console.error('Failed to update job:', error);
      throw error;
    }
  };

  const calculateTaskWeight = (task) => {
    if (task.type === 'q-app') {
      // Count input and output cards for Q-Apps
      const cardCount =
        (task.params.inputs?.length || 0) + (task.params.outputs?.length || 0);
      return cardCount || 1; // Minimum weight of 1
    }
    return 1; // Regular tasks count as 1
  };

  const calculateTotalWeight = (tasks) => {
    return tasks.reduce((sum, task) => sum + calculateTaskWeight(task), 0);
  };

  const createProgressUpdater = (completedWeight, qappWeight, totalWeight) => {
    return (progress) => {

      const qappContribution = (progress / 100) * qappWeight;
      const currentProgress = Math.min(
        Math.round(((completedWeight + qappContribution) / totalWeight) * 100),
        99,
      );

      setProcessingProgress(currentProgress);
    };
  };

  const handleQAppTask = async (
    task,
    currentResults,
    completedWeight,
    qappWeight,
    totalWeight,
  ) => {
    setProcessingStatus('Running analysis...');
    setIsPolling(true);
    setAppRunning(true);

    try {
      const sessionId = await startQappGetSession({
        qAppsClient,
        qAppId: task.params.qAppId,
        appVersion: task.appVersion,
        initialValues: null,
      });

      // Handle inputs before polling
      const updateValues = [];
      const inputParamsArray = task.params.inputs;

      // Process all inputs (both files and regular values)
      for (const inputParam of inputParamsArray) {
        const { inputContentRef, qInputCardId, base64encode } = inputParam;
        const inputValue = resolveReference(inputContentRef, currentResults);

        if (base64encode && inputValue) {
          try {
            const { base64Content, fileName } =
              await fetchAndEncodeFile(inputValue);

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
          } catch (error) {
            console.error('Error importing file:', error);
            throw error;
          }
        } else if (
          inputValue !== undefined &&
          inputValue !== null &&
          inputValue !== ''
        ) {
          updateValues.push({ cardId: qInputCardId, value: inputValue });
        }
      }

      // Update session with all values at once
      if (updateValues.length > 0) {
        await updateQSessionData({
          qAppsClient,
          sessionId,
          values: updateValues,
        });
      }

      const updateProgress = createProgressUpdater(
        completedWeight,
        qappWeight,
        totalWeight,
      );
      const sessionResponse = await pollQAppSession(sessionId, updateProgress);

      // Process the output cards and map them to the correct output references
      if (sessionResponse?.cardStatus) {
        for (const [cardId, cardData] of Object.entries(
          sessionResponse.cardStatus,
        )) {
          // Match cardId to outputContentRef ID
          const matchingOutput = task.params.outputs.find(
            (output) => output.qOutputCardId === cardId,
          );

          if (matchingOutput) {
            const outputId = matchingOutput.outputContentRef.replace('@', '');
            currentResults[outputId] = cardData.currentValue;
          }
        }
      }

      // Add final Q-App contribution
      currentResults[task.id] = {
        status: sessionResponse?.status,
        cardStatus: sessionResponse?.cardStatus,
      };
      return currentResults;
    } catch (error) {
      console.error('Error in Q-App task execution:', error);
      throw error;
    } finally {
      setIsPolling(false);
      setAppRunning(false);
    }
  };

  const handleRunButtonClick = async () => {
    if (!numaAppData || !numaAppData.tasks) return;

    const { jobID, dateTime } = await initializeJob();
    let currentResults = {};

    try {
      const orderedTasks = numaAppData.tasks
        .slice()
        .sort((a, b) => a.order - b.order);
      const totalWeight = calculateTotalWeight(orderedTasks);
      let completedWeight = 0;
      let qappWeight = 0;

      for (const task of orderedTasks) {
        const taskWeight = calculateTaskWeight(task);

        switch (task.type) {
          case 'text-input':
            setProcessingStatus('Processing input data...');
            currentResults = processTextInputTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          case 's3-upload':
            setProcessingStatus('Uploading files...');
            currentResults = processS3UploadTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          case 'http-request':
            setProcessingStatus('Gathering data...');
            currentResults = await processHttpRequestTask(jobID, task, currentResults);
            completedWeight += taskWeight;
            break;

          case 'q-app':
            qappWeight = taskWeight;
            currentResults = await handleQAppTask(
              task,
              currentResults,
              completedWeight,
              qappWeight,
              totalWeight,
            );
            completedWeight += qappWeight;
            break;

          case 'text-output':
            setProcessingStatus('Generating output...');
            currentResults = processTextOutputTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          default:
            console.warn(`Unknown task type: ${task.type}`);
            break;
        }

        // Update task completion status
        setTaskCompletionStatus((prev) => ({
          ...prev,
          [task.id]: true,
        }));
      }

      // Save final results
      await saveJobResults(jobID, dateTime, currentResults);
      setProcessingProgress(100);
      setProcessingStatus('Complete!');
    } catch (error) {
      console.error('Error executing tasks:', error);
      setProcessingStatus('Error occurred');
      setError(error.message || 'An error occurred while running the tasks');
    } finally {
      setLoading(false);
      setAppRunning(false);
    }
  };

  // Load and display historical job results
  const loadJobResults = async (jobId) => {
    try {
      const job = await jobsApi.getJobById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      // Reset states
      setNumaTaskResponses([]);
      setTaskCompletionStatus({});
      setTaskInputValues({});
      setActiveStep(0);
      setSelectedTaskId(null);

      // Set inputs if available
      if (job.inputs) {
        setTaskInputValues(job.inputs);
      }

      // Mark all input tasks as complete
      const updatedStatus = {};
      numaAppData.tasks.forEach((task) => {
        // Mark input tasks as complete since this is a finished job
        if (!task.type.includes('output')) {
          updatedStatus[task.id] = true;
        }
      });
      setTaskCompletionStatus(updatedStatus);

      // Process results into task responses
      if (job.results) {
        const outputTasks = numaAppData.tasks.filter(task => task.type === 'text-output');
        const responses = [];

        outputTasks.forEach(task => {
          const result = job.results[task.id];
          if (result !== undefined) {
            let formattedResult = result;

            // Format result based on type (similar to processTaskResults)
            if (typeof result === 'object') {
              if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object') {
                // Table format for arrays of objects
                const headers = Object.keys(result[0]);
                const headerRow = `| ${headers.join(' | ')} |`;
                const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
                const dataRows = result.map(item =>
                  `| ${headers.map(header => item[header] || '').join(' | ')} |`
                );
                formattedResult = [headerRow, separatorRow, ...dataRows].join('\n');
              } else {
                // JSON format for other objects
                formattedResult = '```json\n' + JSON.stringify(result, null, 2) + '\n```';
              }
            }

            responses.push({
              taskId: task.id,
              result: formattedResult
            });

            // Mark output tasks with results as complete
            updatedStatus[task.id] = true;
          }
        });

        if (responses.length > 0) {
          // Set task responses first
          setNumaTaskResponses(responses);

          // Find the first task that has results
          const firstTaskWithResults = responses[0];
          if (firstTaskWithResults) {
            // Find the task index in the filtered tasks list
            const visibleTasks = numaAppData.tasks.filter(
              task => !task.hidden && task.type !== 'q-app' && task.type !== 'http-request'
            );
            const taskIndex = visibleTasks.findIndex(t => t.id === firstTaskWithResults.taskId);
            if (taskIndex !== -1) {
              // Set active step to first task with results
              setActiveStep(taskIndex);
              // Select the first task with results
              setSelectedTaskId(firstTaskWithResults.taskId);
            }
          }
        }

        // Update completion status for all tasks
        setTaskCompletionStatus(updatedStatus);

        // Close the job history sidebar
        setJobHistorySidebarOpen(false);

        // Set final status
        setProcessingProgress(100);
        setProcessingStatus('Complete!');
      }
    } catch (error) {
      console.error('Error loading job results:', error);
      setError(error);
    }
  };

  // Mock HTTP request function (replace with real implementation)
  const fakeHttpRequestFunction = async (payload) => {
    // Simulate HTTP request delay
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          status: 'PROCESSING'
        });
      }, 1000);
    });
  };


  const NumaPollStatus = async (jobId) => {
    // Mock implementation - keep until api proxy in place
    // return new Promise((resolve) => {
    //   setTimeout(() => {
    //     // Simulate success after 2 calls
    //     const mockData = 'http://localhost:5173/example-meeting-transcript.txt';
    //     const pollCount = window.pollCount = (window.pollCount || 0) + 1;
        
    //     if (pollCount >= 2) {
    //       resolve({
    //         status: 'SUCCESS',
    //         result: mockData
    //       });
    //     } else {
    //       resolve({
    //         status: 'PROCESSING'
    //       });
    //     }
    //   }, 500);
    // });


    try {
      const response = await fetch(`/api/jobs/${jobId}/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error('Failed to get job status');
      }

      const statusData = await response.json();
      return {
        status: statusData.status,
        result: statusData.result,
        error: statusData.error
      };
    } catch (error) {
      console.error('Error polling job status:', error);
      return {
        status: 'UNKNOWN',
        error: error.message
      };
    }
  };

  const updateTaskInputValue = (taskId, value) => {
    setTaskInputValues((prev) => ({
      ...prev,
      [taskId]: value,
    }));
  };

  function updateTaskCompletionStatus(taskId, isComplete = true) {
    setTaskCompletionStatus((prev) => ({
      ...prev,
      [taskId]: isComplete,
    }));
  }

  const contextValue = {
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
    updateTaskInputValue,
    taskCompletionStatus,
    setTaskCompletionStatus,
    updateTaskCompletionStatus,
    runActive,
    setRunActive,
    progress,
    setProgress,
    isPolling,
    setIsPolling,
    processingStatus,
    setProcessingStatus,
    processingProgress,
    setProcessingProgress,
    handleRunButtonClick,
    getAppJobs,
    loadAppJobs,
    appRunning,
    setAppRunning,
    loadJobResults,
    numaTaskResponses,
    selectedTaskId,
    setSelectedTaskId,
    jobHistorySidebarOpen,
    setJobHistorySidebarOpen,
    activeStep,
    setActiveStep
  };

  return (
    <NumaAppContext.Provider value={contextValue}>
      {children}
    </NumaAppContext.Provider>
  );
};
