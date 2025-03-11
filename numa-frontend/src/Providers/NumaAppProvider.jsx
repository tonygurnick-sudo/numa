import { useState, useEffect } from 'react';
import { useAuth } from '../Providers/AuthProvider';
import { manifestService } from '../Services/manifestService';
import {
  startQappGetSession,
  getSessionQApp,
  updateQSessionData,
  fetchAndEncodeFile,
  importFileToQApp,
} from '../qAppHelper';
import { useJobsApi } from '../Services/jobsApi';
import { useNumaRequest } from './NumaRequestContext';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NumaAppContext } from './NumaAppContext';

// Utility function to find a value in an object using both hyphen and underscore formats of the key
export const findValueWithFormatFlexibility = (obj, key) => {
  // Try the original key first
  let value = obj[key];
  if (value !== undefined) {
    return value;
  }

  // Try hyphen version if the key contains underscores
  if (key.includes('_')) {
    const hyphenKey = key.replace(/_/g, '-');
    value = obj[hyphenKey];
    if (value !== undefined) {
      return value;
    }
  }

  // Try underscore version if the key contains hyphens
  if (key.includes('-')) {
    const underscoreKey = key.replace(/-/g, '_');
    value = obj[underscoreKey];
    if (value !== undefined) {
      return value;
    }
  }

  // Return undefined if not found with any format
  return undefined;
};

// Global helper function to resolve references like @taskId or @taskId/subPath
const resolveReference = (key, taskResults) => {
  if (!key?.startsWith('@')) {
    return key; // If it's not a reference, just return the key (unchanged)
  }

  // Split the reference into taskId and subPath
  const [fullTaskId, ...subPaths] = key.slice(1).split('/');

  // Get the base result using format flexibility
  const baseResult = findValueWithFormatFlexibility(taskResults, fullTaskId);

  if (baseResult === undefined) {
    console.warn(`Could not find task result for ${fullTaskId}`);
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
      // Always include the key in the accumulator, even if the value is empty
      acc[key] = [processedValue];
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
  const [currentJobId, setCurrentJobId] = useState(null);

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
  const { numaPost, numaGet } = useNumaRequest();

  const resetAppState = () => {
    setLoading(false);
    setError(null);
    setNumaApps([]);
    setNumaAppData(null);
    setNumaAppId(null);
    setJobHistorySidebarOpen(false);
    setNumaTaskResponses([]);
    setTaskInputValues({});
    setTaskCompletionStatus({});
    setRunActive('disabled');
    setProgress(0);
    setIsPolling(false);
    setAppRunning(false);
    setProcessingProgress(0);
    setProcessingStatus('');
    setqAppData([]);
    setQSessionId(null);
    setQCardInputValues({});
    setJobs([]);
    setSelectedTaskId(null);
    setActiveStep(0);
    setHasRun(false);
    setCurrentJobId(null);
  };

  // We now create a job directly when uploading files instead of using a session ID

  // Load jobs for the current app
  const loadAppJobs = async ({ limit = 50, nextToken = null, append = false } = {}) => {
    if (!numaAppId) return;
    try {
      const response = await jobsApi.getJobsByAppId(numaAppId, { limit, nextToken });
      const { items: appJobs, nextToken: newNextToken } = response;

      // Sort jobs by date before setting/appending
      const sortedJobs = appJobs.sort((a, b) => {
        const dateA = new Date(a.startedAt || a.dateTime);
        const dateB = new Date(b.startedAt || b.dateTime);
        return dateB - dateA;
      });

      // If append is true, add to existing jobs, otherwise replace
      setJobs((prevJobs) => {
        if (append) {
          // Filter out any duplicates when appending
          const newJobs = sortedJobs.filter(
            (newJob) => !prevJobs.some((existingJob) => existingJob.jobID === newJob.jobID),
          );
          return [...prevJobs, ...newJobs];
        }
        return sortedJobs;
      });

      return { items: sortedJobs, nextToken: newNextToken }; // Return for pagination check
    } catch (error) {
      console.error('Failed to load jobs:', error);
      throw error;
    }
  };

  // Reload jobs whenever the app changes, but skip for policy apps
  useEffect(() => {
    // Don't automatically load jobs for policy apps
    if (numaAppId && numaAppId !== 'policy-builder-app' && numaAppId !== 'policy-reviewer-app') {
      loadAppJobs();
    }
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
      // If task is not required, it doesn't affect completion status
      if (!task.required) return true;

      // For required tasks, increment total count
      totalRequiredTasks++;

      // Check if this required task is completed
      const isCompleted = taskCompletionStatus[task.id];

      // Increment completed count if this task is done
      if (isCompleted) {
        completedCount++;
      }

      return isCompleted;
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
        const app = await manifestService.fetchAppById(numaAppId);
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

  const processS3UploadTask = (task, currentResults, jobID) => {
    const uploadedFilePath = taskInputValues[task.id];

    // Only consider the task complete if we have a valid upload path
    if (!uploadedFilePath || (Array.isArray(uploadedFilePath) && uploadedFilePath.length === 0)) {
      throw new Error('No file uploaded');
    }

    // We're using the session ID consistently throughout, so no path modification is needed
    // Just pass the uploaded file path directly to the results
    currentResults[task.id] = uploadedFilePath;
    console.log(`S3 upload result: ${JSON.stringify(currentResults[task.id])}`);
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
      const { status, result } = await pollJobStatus({
        jobID: response.job_id,
        pollInterval: 10000,
        maxPollingTime: 24 * 10000, // 24 attempts * 10 seconds
      });

      if (status === 'completed' && result) {
        console.log('Task completed successfully');
        console.log('Task result:', result);
        currentResults[task.id] = result;
        return currentResults;
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

  // Shared polling function for both initial tasks and history jobs
  const pollJobStatus = async ({
    jobID,
    pollInterval = 5000,
    maxPollingTime = 5 * 60 * 1000,
    initialState = null,
    onPollSuccess = null,
    shouldContinuePolling = null,
  }) => {
    const startTime = Date.now();
    let currentState = initialState ? { ...initialState } : null;

    try {
      while (true) {
        const polling_endpoint = `/api/${numaAppData.id}/main?job_id=${jobID}`;
        console.log('Polling job:', polling_endpoint);

        const pollResponse = await numaPollStatus(polling_endpoint);
        console.log('Poll response:', pollResponse);

        // For history jobs, check for changes
        if (currentState) {
          const hasChanges =
            pollResponse.status !== currentState.status ||
            JSON.stringify(pollResponse.result) !== JSON.stringify(currentState.results);

          if (hasChanges) {
            // Update the state with new data
            currentState = {
              ...currentState,
              status: pollResponse.status,
              lastUpdated: new Date().toISOString(),
              results: pollResponse.result || currentState.results,
            };

            // Call success handler if provided
            if (onPollSuccess) {
              await onPollSuccess(currentState, pollResponse);
            }
          }
        }

        // Check completion status
        if (pollResponse.status === 'SUCCESS') {
          if (pollResponse.result) {
            // Just store the original keys, we'll use findValueWithFormatFlexibility for lookups
            const formattedResult = {};
            Object.entries(pollResponse.result).forEach(([key, value]) => {
              formattedResult[key] = value;
            });
            return { status: 'completed', result: formattedResult, state: currentState };
          }
          throw new Error('No result data in successful response');
        } else if (pollResponse.status === 'FAILURE' || pollResponse.status === 'error') {
          throw new Error(pollResponse.message || 'Task failed');
        }

        // Check if we should continue polling
        if (shouldContinuePolling) {
          const shouldContinue = shouldContinuePolling(currentState, startTime);
          if (!shouldContinue) {
            console.log('Stopping poll: Custom condition met');
            break;
          }
        } else {
          // Default polling time check
          const elapsedTime = Date.now() - startTime;
          if (elapsedTime > maxPollingTime) {
            console.log('Stopping poll: Max time reached');
            break;
          }
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      return { status: 'incomplete', state: currentState };
    } catch (error) {
      console.error('Error polling job:', error);
      throw error;
    }
  };

  // Function to poll an incomplete job when loading from history
  const pollIncompleteHistoryJob = async (jobHistoryItem) => {
    if (
      !jobHistoryItem ||
      jobHistoryItem.status === 'completed' ||
      jobHistoryItem.status === 'error' ||
      jobHistoryItem.status === 'files-uploaded'
    ) {
      // Skip polling for 'files-uploaded' jobs
      return jobHistoryItem;
    }

    if (!jobHistoryItem.jobID) {
      console.log('No jobId available for polling incomplete job');
      return jobHistoryItem;
    }

    try {
      // Set UI states to match initial app run
      setAppRunning(true);
      setJobHistorySidebarOpen(false);
      setProcessingStatus('Processing...');
      setProcessingProgress(30);

      // Load input values and mark tasks as complete
      const taskCompletions = {};

      // Mark input tasks complete if they have values
      console.log('Loading job inputs:', jobHistoryItem.inputs);
      if (jobHistoryItem.inputs) {
        console.log('Setting taskInputValues from job inputs');
        setTaskInputValues(jobHistoryItem.inputs);
        numaAppData.tasks.forEach((task) => {
          console.log(`Checking task ${task.id} in inputs:`, !!jobHistoryItem.inputs[task.id]);
          if ((task.type === 'text-input' || task.type === 's3-upload') && jobHistoryItem.inputs[task.id]) {
            taskCompletions[task.id] = true;
          }
        });
      } else {
        console.log('No inputs found in job history item');
      }

      // Mark output tasks complete if they have results
      if (jobHistoryItem.results) {
        numaAppData.tasks.forEach((task) => {
          if (task.type === 'text-output' && jobHistoryItem.results[task.id]) {
            taskCompletions[task.id] = true;
          }
        });
      }

      setTaskCompletionStatus(taskCompletions);

      // Use the same polling logic as initial app run
      const { status, result } = await pollJobStatus({
        jobID: jobHistoryItem.jobID,
        pollInterval: 5000,
        maxPollingTime: 5 * 60 * 1000,
      });

      if (status === 'completed' && result) {
        // Just store the original keys, we'll use findValueWithFormatFlexibility for lookups
        const formattedResult = {};
        Object.entries(result).forEach(([key, value]) => {
          formattedResult[key] = value;
        });

        // Update job in history with results and completed status, but don't modify inputs
        await jobsApi.updateJob(numaAppData, jobHistoryItem.jobID, formattedResult, undefined, 'completed');
        await loadAppJobs();

        // Update UI same as initial app run
        setProcessingProgress(100);
        setProcessingStatus('Complete!');
        setHasRun(true);

        // Set task responses
        if (formattedResult && numaAppData?.tasks) {
          const outputTasks = numaAppData.tasks.filter((task) => task.type === 'text-output');

          const responses = outputTasks
            .map((task) => {
              // Find the result using format flexibility
              const result = findValueWithFormatFlexibility(formattedResult, task.id);

              return {
                taskId: task.id,
                result: result,
              };
            })
            .filter((r) => r.result !== undefined);
          setNumaTaskResponses(responses);

          // Mark all tasks as complete since we have results
          const allTaskCompletions = {};
          numaAppData.tasks.forEach((task) => {
            if (task.type === 'text-input' || task.type === 's3-upload') {
              allTaskCompletions[task.id] = Boolean(jobHistoryItem.inputs?.[task.id]);
            } else if (task.type === 'text-output') {
              // Find the result using format flexibility
              const result = findValueWithFormatFlexibility(formattedResult, task.id);

              allTaskCompletions[task.id] = Boolean(result);
            }
          });
          setTaskCompletionStatus(allTaskCompletions);
        }

        return { ...jobHistoryItem, status: 'completed', results: result };
      }

      return jobHistoryItem;
    } catch (error) {
      console.error('Error in history job polling:', error);
      setProcessingStatus('Error');
      setProcessingProgress(0);
      return jobHistoryItem;
    } finally {
      setAppRunning(false);
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
      // If we already have a job ID (from file uploads), use it
      // Otherwise, create a new job
      let jobResponse;
      if (currentJobId) {
        console.log(`Using existing job ID: ${currentJobId}`);
        // We already have a job from file uploads, so we need to update its status to 'running'
        try {
          await jobsApi.updateJob(numaAppData, currentJobId, null, taskInputValues, 'running');
          console.log(`Updated job ${currentJobId} status to 'running'`);
        } catch (updateError) {
          console.error('Failed to update job status:', updateError);
          // Continue even if the update fails - we'll still try to use the job
        }
        jobResponse = { jobID: currentJobId, startedAt: new Date().toISOString() };
      } else {
        // No job exists yet, create one with 'running' status
        jobResponse = await jobsApi.createJob(numaAppData, taskInputValues);
        setCurrentJobId(jobResponse.jobID);
        console.log(`Created new job with ID: ${jobResponse.jobID}`);
      }

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
      // Update the job with results and completed status, but don't modify inputs
      await jobsApi.updateJob(numaAppData, jobID, textOutputResults, undefined, 'completed');

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
            currentResults = processS3UploadTask(task, currentResults, jobID);
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
      let job = await jobsApi.getJobById(numaAppId, jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      console.log('Initial job:', job);

      // Try to poll for updates if job is incomplete
      if (job.status !== 'completed') {
        job = await pollIncompleteHistoryJob(job);
        console.log('Job after polling:', job);
      }

      // Reset states before polling
      setNumaTaskResponses([]);
      setTaskCompletionStatus({});
      setTaskInputValues({});
      setActiveStep(0);
      setSelectedTaskId(null);

      // Set app state based on job status
      if (job.status === 'files-uploaded') {
        // For 'files-uploaded' jobs, the app wasn't run, so don't show post-run navigation
        setAppRunning(false);
        setHasRun(false);
        setJobHistorySidebarOpen(false); // Close the sidebar for files-uploaded jobs
        console.log('Setting app state for files-uploaded job');
      } else {
        // For completed or running jobs, show post-run navigation
        setAppRunning(true);
        setHasRun(true);
        setJobHistorySidebarOpen(false); // Close the sidebar for all jobs
      }

      // Set inputs if available
      const jobInputs = job.inputs || {};

      if (Object.keys(jobInputs).length > 0) {
        // Process inputs to ensure file uploads are properly formatted
        const processedInputs = { ...jobInputs };

        // Look for s3-upload tasks and ensure their values are properly formatted
        if (numaAppData && numaAppData.tasks) {
          numaAppData.tasks.forEach((task) => {
            if (task.type === 's3-upload' && processedInputs[task.id]) {
              const fileValue = processedInputs[task.id];
              // Keep the file value as is - don't modify the format
              // The S3UploadModule will handle different formats appropriately
            }
          });
        }

        setTaskInputValues(processedInputs);
      }

      // Set the current job ID so we can use it when running the app
      if (job.jobID) {
        setCurrentJobId(job.jobID);
      }

      // Parse stored manifest if available, otherwise fall back to current manifest
      let manifestToUse;
      if (job.manifest) {
        try {
          manifestToUse = typeof job.manifest === 'string' ? JSON.parse(job.manifest) : job.manifest;
        } catch (e) {
          console.error('Failed to parse job manifest:', e);
          manifestToUse = numaAppData;
        }
      } else {
        manifestToUse = numaAppData;
      }

      if (!manifestToUse) {
        throw new Error('No manifest available for job');
      }

      // Try to poll for updates if job is incomplete and was actually running
      // If status is 'files-uploaded', we don't need to poll as the app was never run
      if (job.status === 'running') {
        job = await pollIncompleteHistoryJob(job);
        console.log('Job after polling:', job);
      } else if (job.status === 'files-uploaded') {
        console.log('Job has files uploaded but was never run, skipping polling');
        // Set app as not running since we're just loading files
        setAppRunning(false);
        setHasRun(false);
      }

      // Function to trigger task value updates for s3-upload tasks
      // This is needed to ensure the S3UploadModule displays the file name
      const triggerFileUploadValueUpdates = () => {
        // Find all s3-upload tasks with values
        const fileUploadTasks = [];
        if (manifestToUse.tasks && job.inputs) {
          manifestToUse.tasks.forEach((task) => {
            if (task.type === 's3-upload' && job.inputs[task.id]) {
              fileUploadTasks.push({
                taskId: task.id,
                value: job.inputs[task.id],
              });
            }
          });
        }

        // Schedule updates to be applied after the component has rendered
        if (fileUploadTasks.length > 0) {
          console.log('Scheduling file upload value updates for tasks:', fileUploadTasks);
          setTimeout(() => {
            fileUploadTasks.forEach(({ taskId, value }) => {
              // Force a re-render of the task value to trigger the useEffect in S3UploadModule
              const currentInputs = { ...taskInputValues };
              // First remove the value to force a change
              delete currentInputs[taskId];
              setTaskInputValues(currentInputs);

              // Then add it back in the next tick
              setTimeout(() => {
                setTaskInputValues((prev) => ({
                  ...prev,
                  [taskId]: value,
                }));
                console.log(`Triggered value update for s3-upload task ${taskId} with value:`, value);
              }, 50);
            });
          }, 100);
        }
      };

      // Mark tasks as complete based on job status
      const updatedStatus = {};
      if (manifestToUse.tasks) {
        manifestToUse.tasks.forEach((task) => {
          if (job.status === 'files-uploaded') {
            // For 'files-uploaded' jobs, only mark input tasks as complete if they have values
            if (task.type === 'text-input' && job.inputs && job.inputs[task.id]) {
              console.log(`Marking text-input task ${task.id} as complete`);
              updatedStatus[task.id] = true;
            } else if (task.type === 's3-upload' && job.inputs && job.inputs[task.id]) {
              console.log(`Marking s3-upload task ${task.id} as complete with value:`, job.inputs[task.id]);
              updatedStatus[task.id] = true;
            }
          } else {
            // For completed or running jobs, mark all input tasks as complete
            if (!task.type.includes('output')) {
              updatedStatus[task.id] = true;
            }
          }
        });
      } else {
        console.warn('No tasks found in manifest');
      }
      setTaskCompletionStatus(updatedStatus);

      // Process results into task responses
      if (job.results) {
        const outputTasks = manifestToUse.tasks.filter((task) => task.type === 'text-output');
        const responses = [];

        outputTasks.forEach((task) => {
          // Find the result using format flexibility
          const result = findValueWithFormatFlexibility(job.results, task.id);
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
            const visibleTasks = manifestToUse.tasks.filter(
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

      // Trigger file upload value updates to ensure file names are displayed
      triggerFileUploadValueUpdates();
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

  function updateTaskCompletionStatus(taskId, isComplete = false) {
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
    resetAppState,
    currentJobId,
    setCurrentJobId,
  };

  return <NumaAppContext.Provider value={contextValue}>{children}</NumaAppContext.Provider>;
};
