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
import { useJobsApi } from '../Services/jobsApi';
import { useNumaRequest } from '../Providers/RequestProvider';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Create the context
const NumaAppContext = createContext();

// Custom hook for using context
export const useNumaApp = () => useContext(NumaAppContext);

// Global helper function to resolve references like @taskId or @taskId/subPath
const resolveReference = (key, taskResults) => {
  if (!key?.startsWith('@')) {
    return key; // If it's not a reference, just return the key (unchanged)
  }

  // Split the reference into taskId and subPath
  const [fullTaskId, ...subPaths] = key.slice(1).split('/');

  // Try both hyphen and underscore versions of the task ID
  const hyphenTaskId = fullTaskId.replace(/_/g, '-');
  const underscoreTaskId = fullTaskId.replace(/-/g, '_');

  // Get the base result, trying both versions of the task ID
  let baseResult = taskResults[hyphenTaskId];
  if (baseResult === undefined) {
    baseResult = taskResults[underscoreTaskId];
  }
  if (baseResult === undefined) {
    console.warn(`Could not find task result for either ${hyphenTaskId} or ${underscoreTaskId}`);
    return '';
  }

  // If there's no subPath or the result isn't an object, return the base result
  if (subPaths.length === 0 || typeof baseResult !== 'object') {
    return baseResult;
  }

  // Navigate through the subPath
  try {
    const result = subPaths.reduce((obj, path) => obj[path], baseResult);
    return result !== undefined ? result : '';
  } catch (error) {
    console.warn(`Failed to resolve sub-reference ${key}:`, error);
    return '';
  }
};

// Function to create a payload dynamically from a template
function createPayloadFromTemplate(template, inputValues, taskResults) {
  console.log('inputValues', inputValues);
  console.log('taskResults', taskResults);

  // Main function to recursively handle template (string, array, or object)
  if (typeof template === 'string') {
    // If the string is a direct reference (e.g. "@upload-files-to-s3"), return the resolved value directly
    if (template.match(/^@[\w-]+$/)) {
      return resolveReference(template, taskResults);
    }
    // Otherwise, it's a string with potential embedded references, so replace them
    return template.replace(/@[\w-]+/g, (match) => resolveReference(match, taskResults));
  } else if (Array.isArray(template)) {
    // Handle case for arrays (recursively apply transformation)
    return template.map((item) => createPayloadFromTemplate(item, inputValues, taskResults));
  } else if (typeof template === 'object' && template !== null) {
    // Handle case for objects (recursively apply transformation)
    return Object.entries(template).reduce((acc, [key, value]) => {
      const processedValue = createPayloadFromTemplate(value, inputValues, taskResults);

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
  const { qAppsClient, getIdentityPoolCredentials } = useAuth();
  const jobsApi = useJobsApi();

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
  const [hasRun, setHasRun] = useState(false);
  const { numaPost, numaPut, numaGet } = useNumaRequest();

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
          const lookupId = requiredTaskId.startsWith('@') ? requiredTaskId.slice(1) : requiredTaskId;
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
    const progress = totalRequiredTasks > 0 ? (completedCount / totalRequiredTasks) * 100 : 0;
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
    // Preserve array structure from taskInputValues
    currentResults[task.id] = uploadedFilePath; // uploadedFilePath is already an array from S3UploadModule
    console.log(`S3 upload result: ${currentResults[task.id]}`);
    return currentResults;
  };

  const processHttpRequestTask = async (jobID, task, currentResults) => {
    const templatePayload = task.params?.payload;
    const request_endpoint = `/api/${numaAppData.id}/main`;

    const payload = createPayloadFromTemplate(templatePayload, taskInputValues, currentResults);

    const requestPayload = {
      ...payload,
      jobId: jobID,
    };
    console.log('Generated Payload for http-request:', requestPayload);
    console.log('Endpoint for http-request:', request_endpoint);

    // Initial request should return success status
    try {
      const response = await makeHttpRequest(requestPayload, request_endpoint);
      console.log('Initial http-request response:', response);

      if (!response || !response.job_id) {
        throw new Error('No job ID received from initial request');
      }

      // Poll for results
      const maxAttempts = 24;
      const pollInterval = 10000;
      let attempts = 0;
      const polling_endpoint = `/api/${numaAppData.id}/main?job_id=${response.job_id}`;
      console.log('Starting polling with endpoint:', polling_endpoint);

      while (attempts < maxAttempts) {
        const pollResponse = await numaPollStatus(polling_endpoint);
        console.log('Poll status response:', pollResponse);
        console.log('attempts:', attempts);

        if (pollResponse.status === 'SUCCESS') {
          console.log('Task completed successfully');
          if (pollResponse.result) {
            console.log('Task result:', pollResponse.result);
            currentResults[task.id] = pollResponse.result;
            return currentResults;
          }
          throw new Error('No result data in successful response');
        } else if (pollResponse.status === 'FAILURE') {
          throw new Error(pollResponse.message || 'Task failed');
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      throw new Error('The process is taking longer than expected. Please try again.');
    } catch (error) {
      // Log the technical error for debugging
      console.error('HTTP Request task error:', error);
      // Return a user-friendly error message
      throw new Error('We encountered an issue processing your request. Please try again.');
    }
  };

  const processTextOutputTask = async (task, currentResults) => {
    try {
      console.log('Processing text output task:', task);
      const outputRef = task.params?.dataRef;
      console.log('Output reference:', outputRef);

      // First get the initial result
      let outputResult = resolveReference(outputRef, currentResults);
      console.log('Initial resolved reference result:', outputResult);

      // If the result contains S3 information, fetch and replace the content
      if (outputResult?.output_bucket && outputResult?.output_key) {
        console.log('Found S3 information, fetching content...');
        const credentials = await getIdentityPoolCredentials();
        const s3Content = await fetchS3Content(outputResult.output_bucket, outputResult.output_key, credentials);
        console.log('Retrieved S3 content:', s3Content);

        // Replace the S3 info with the actual content in currentResults
        const taskId = outputRef.split('/')[0].replace('@', '');
        currentResults[taskId] = s3Content;

        // Re-resolve to get the specific path from the content
        outputResult = resolveReference(outputRef, currentResults);
        console.log('Re-resolved reference after S3 fetch:', outputResult);
      }

      if (outputResult) {
        let resultToDisplay = outputResult;
        console.log('Processing result for display:', { type: typeof resultToDisplay, value: resultToDisplay });

        if (typeof outputResult === 'object') {
          if (Array.isArray(outputResult) && outputResult.length > 0 && typeof outputResult[0] === 'object') {
            console.log('Converting array of objects to markdown table');
            const headers = Object.keys(outputResult[0]);
            const headerRow = `| ${headers.join(' | ')} |`;
            const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
            const dataRows = outputResult.map(
              (item) => `| ${headers.map((header) => item[header] || '').join(' | ')} |`,
            );
            resultToDisplay = [headerRow, separatorRow, ...dataRows].join('\n');
          } else {
            console.log('Converting object to JSON string');
            resultToDisplay = '```json\n' + JSON.stringify(outputResult, null, 2) + '\n```';
          }
        } else if (typeof outputResult === 'string') {
          console.log('Processing string output:', {
            startsWithMarkdown: outputResult.startsWith('```markdown'),
            containsMarkdownChars: /[#*`[\]()|\n]/.test(outputResult),
            firstFewChars: outputResult.slice(0, 20),
          });

          // First check if it's a markdown code block and extract its content
          const markdownBlockMatch = outputResult.match(/^```markdown\n([\s\S]*)\n```$/);
          if (markdownBlockMatch) {
            console.log('Extracted content from markdown block');
            // Extract the content from inside the markdown block
            resultToDisplay = markdownBlockMatch[1];
          } else if (outputResult.includes('```markdown')) {
            // If it contains markdown blocks but isn't a perfect match (might be inside JSON)
            try {
              const parsed = JSON.parse(outputResult);
              if (parsed.value && typeof parsed.value === 'string') {
                const valueMarkdownMatch = parsed.value.match(/^```markdown\n([\s\S]*)\n```$/);
                if (valueMarkdownMatch) {
                  console.log('Extracted markdown from JSON value');
                  resultToDisplay = valueMarkdownMatch[1];
                }
              }
            } catch (e) {
              console.log('Not valid JSON with markdown:', e);
            }
          } else {
            // Check if the string already contains markdown-like formatting
            const hasMarkdown = /[#*`[\]()|\n]/.test(outputResult);
            if (!hasMarkdown) {
              // If it doesn't look like markdown, try to detect if it's JSON or code
              try {
                JSON.parse(outputResult);
                // If it parses as JSON, format it as a code block
                resultToDisplay = '```json\n' + JSON.stringify(JSON.parse(outputResult), null, 2) + '\n```';
              } catch {
                // If it's not JSON and doesn't have markdown, wrap paragraphs
                resultToDisplay = outputResult
                  .split('\n\n')
                  .map((para) => para.trim())
                  .filter((para) => para)
                  .join('\n\n');
              }
            }
          }
          console.log('Final processed string:', {
            firstFewChars: resultToDisplay.slice(0, 20),
            length: resultToDisplay.length,
          });
        }

        console.log('Final result to display:', resultToDisplay);
        currentResults[task.id] = resultToDisplay;

        // Update numaTaskResponses with the new result
        setNumaTaskResponses((prevResponses) => {
          // Remove any existing response for this task
          const filteredResponses = prevResponses.filter((r) => r.taskId !== task.id);
          // Add the new response
          return [
            ...filteredResponses,
            {
              taskId: task.id,
              result: resultToDisplay,
            },
          ];
        });
      } else {
        console.warn('No output result found for task:', task.id);
      }

      console.log('Updated current results:', currentResults);
      return currentResults;
    } catch (error) {
      console.error('Error in processTextOutputTask:', error);
      throw error;
    }
  };

  // Fetch content from S3
  const fetchS3Content = async (bucket, key, credentials) => {
    console.log('Fetching S3 content:', { bucket, key });

    try {
      console.log('Creating S3 client with provided credentials...');
      const s3Client = new S3Client({
        region: 'us-east-1',
        credentials,
      });

      console.log('Creating GetObject command...');
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      console.log('Getting signed URL...');
      const signedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });
      console.log('Got signed URL:', signedUrl);

      console.log('Fetching content...');
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log('S3 content retrieved:', data);
      return data;
    } catch (error) {
      console.error('Error fetching S3 content:', error);
      throw error;
    }
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
          const completedCards = cards.filter((card) => card.currentState === 'COMPLETED').length;
          const runningCards = cards.filter((card) => card.currentState === 'RUNNING').length;

          // Count completed cards fully and running cards as half complete
          progress = Math.round(((completedCards + runningCards * 0.5) / totalCards) * 100);
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
      const jobResponse = await jobsApi.createJob(numaAppData, taskInputValues);
      return {
        jobID: jobResponse.jobID,
        dateTime: jobResponse.startedAt,
      };
    } catch (error) {
      console.error('Failed to create job:', error);
      setProcessingStatus('Error');
      setProcessingProgress(0);
      throw new Error('Unable to start the process. Please try again.');
    }
  };

  const saveJobResults = async (jobID, dateTime, currentResults) => {
    try {
      // Get all text-output tasks
      const textOutputTasks = numaAppData.tasks.filter((task) => task.type === 'text-output');

      console.log('Found text-output tasks to be saved:', textOutputTasks);
      // Build results object from text-output tasks
      const textOutputResults = textOutputTasks.reduce((acc, task) => {
        // Get the referenced data using resolveReference
        const resolvedValue = resolveReference(task.params.dataRef, currentResults);
        if (resolvedValue !== '') {
          acc[task.id] = resolvedValue;
        }
        return acc;
      }, {});

      console.log('Text-output results to be saved:', textOutputResults);
      // Update the job using jobsApi
      await jobsApi.updateJob(numaAppData, jobID, textOutputResults);

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
      const cardCount = (task.params.inputs?.length || 0) + (task.params.outputs?.length || 0);
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
      const currentProgress = Math.min(Math.round(((completedWeight + qappContribution) / totalWeight) * 100), 99);

      setProcessingProgress(currentProgress);
    };
  };

  const handleQAppTask = async (task, currentResults, completedWeight, qappWeight, totalWeight) => {
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
            const { base64Content, fileName } = await fetchAndEncodeFile(inputValue);

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
        } else if (inputValue !== undefined && inputValue !== null && inputValue !== '') {
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

      const updateProgress = createProgressUpdater(completedWeight, qappWeight, totalWeight);
      const sessionResponse = await pollQAppSession(sessionId, updateProgress);

      // Process the output cards and map them to the correct output references
      if (sessionResponse?.cardStatus) {
        for (const [cardId, cardData] of Object.entries(sessionResponse.cardStatus)) {
          // Match cardId to outputContentRef ID
          const matchingOutput = task.params.outputs.find((output) => output.qOutputCardId === cardId);

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

  // Clean title of process-related words
  const cleanTaskTitle = (title) => {
    if (!title) return 'task';
    return title.replace(/\b(process(ing)?|running)\b/gi, '').trim();
  };

  const handleRunButtonClick = async () => {
    if (!numaAppData || !numaAppData.tasks) return;

    setProcessingStatus('Starting process...');
    setProcessingProgress(0);
    setError(null); // Clear any previous errors

    try {
      const { jobID, dateTime } = await initializeJob();
      let currentResults = {};

      const orderedTasks = numaAppData.tasks.slice().sort((a, b) => a.order - b.order);

      let completedWeight = 0;
      let qappWeight = 0;
      const totalWeight = calculateTotalWeight(orderedTasks);

      for (const task of orderedTasks) {
        setProcessingStatus(`Processing: ${cleanTaskTitle(task.title)}...`);
        const taskWeight = calculateTaskWeight(task);

        switch (task.type) {
          case 'text-input':
            currentResults = processTextInputTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          case 's3-upload':
            currentResults = processS3UploadTask(task, currentResults);
            completedWeight += taskWeight;
            break;
          case 'http-request':
            currentResults = await processHttpRequestTask(jobID, task, currentResults);
            completedWeight += taskWeight;
            break;

          case 'q-app':
            qappWeight = taskWeight;
            currentResults = await handleQAppTask(task, currentResults, completedWeight, qappWeight, totalWeight);
            completedWeight += taskWeight;
            break;

          case 'text-output':
            currentResults = await processTextOutputTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          default:
            console.warn(`Unknown task type: ${task.type}`);
            break;
        }

        const progress = Math.min(Math.round((completedWeight / totalWeight) * 100), 100);
        setProcessingProgress(progress);

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
      return currentResults;
    } catch (error) {
      console.error('Error running app:', error);
      setProcessingStatus('Error');
      setProcessingProgress(0);
      throw error; // Re-throw to be handled by AppWizard
    } finally {
      setLoading(false);
      setAppRunning(false);
    }
  };

  // Load and display historical job results
  const loadJobResults = async (jobId) => {
    try {
      const job = await jobsApi.getJobById(numaAppId, jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      console.log('Job:', job);

      // Reset states
      setNumaTaskResponses([]);
      setTaskCompletionStatus({});
      setTaskInputValues({});
      setActiveStep(0);
      setSelectedTaskId(null);
      setAppRunning(true); // Set to true to show post-run navigation
      setHasRun(true); // Set hasRun to true to show post-run navigation

      // Set inputs if available
      if (job.inputs) {
        setTaskInputValues(job.inputs);
      }

      // Mark all input tasks as complete
      const updatedStatus = {};
      numaAppData.tasks.forEach((task) => {
        //  this is a finished job
        if (!task.type.includes('output')) {
          updatedStatus[task.id] = true;
        }
      });
      setTaskCompletionStatus(updatedStatus);

      // Process results into task responses
      if (job.results) {
        const outputTasks = numaAppData.tasks.filter((task) => task.type === 'text-output');
        const responses = [];

        outputTasks.forEach((task) => {
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
                const dataRows = result.map((item) => `| ${headers.map((header) => item[header] || '').join(' | ')} |`);
                formattedResult = [headerRow, separatorRow, ...dataRows].join('\n');
              } else {
                // JSON format for other objects
                formattedResult = '```json\n' + JSON.stringify(result, null, 2) + '\n```';
              }
            }

            responses.push({
              taskId: task.id,
              result: formattedResult,
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
              (task) => !task.hidden && task.type !== 'q-app' && task.type !== 'http-request',
            );
            const taskIndex = visibleTasks.findIndex((t) => t.id === firstTaskWithResults.taskId);
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

      // Set appRunning to false after all results are processed
      setAppRunning(false);
    } catch (error) {
      console.error('Error loading job results:', error);
      throw error;
    }
  };

  // HTTP request function
  const makeHttpRequest = async (payload, endpoint) => {
    try {
      const response = await numaPost(endpoint, payload);

      if (!response) {
        throw new Error(`HTTP request failed`);
      }

      return {
        success: true,
        status: response.status || 'PROCESSING',
        ...response,
      };
    } catch (error) {
      console.error('HTTP request failed:', error);
      throw error;
    }
  };

  const numaPollStatus = async (polling_endpoint) => {
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
      const response = await numaGet(polling_endpoint);
      console.log('Poll response:', response);

      if (!response) {
        throw new Error('Unable to check the status of your request.');
      }

      // Return both status and result if available
      return {
        status: response.status,
        result: response.result,
        error: response.error,
      };
    } catch (error) {
      console.error('Error polling job status:', error);
      throw error;
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
    qAppData,
    setqAppData,
    numaAppId,
    setNumaAppId,
    taskInputValues,
    setTaskInputValues,
    updateTaskInputValue,
    taskCompletionStatus,
    setTaskCompletionStatus,
    updateTaskCompletionStatus,
    qCardInputValues,
    setQCardInputValues,
    qSsessionId,
    setQSessionId,
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
    setActiveStep,
    hasRun,
    setHasRun,
  };

  return (
    <NumaAppContext.Provider value={contextValue}>
      {children}
    </NumaAppContext.Provider>
  );
};
