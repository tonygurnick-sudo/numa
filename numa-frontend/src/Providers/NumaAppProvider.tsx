import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../Providers/AuthProvider';
import { manifestService } from '../Services/manifestService';
import {
  startQappGetSession,
  getSessionQApp,
  updateQSessionData,
  fetchAndEncodeFile,
  importFileToQApp,
} from '../utils/qAppHelper';
import { useJobsApi } from '../Services/jobsApi';
import { useNumaRequest } from './NumaRequestContext';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { withPRM } from '../utils/prmUtils';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import i18n from '../i18n';
import {
  NumaAppContext,
  createPayloadFromTemplate,
  findValueWithFormatFlexibility,
  resolveReference,
} from './NumaAppContext';
import { getEffectiveLanguage } from '../utils/languagePreference';

// Provider component
export const NumaAppProvider = ({ children }) => {
  const { qAppsClient } = useAuth();
  const jobsApi = useJobsApi();

  const JOB_NAMING_STORAGE_KEY = 'numa-job-naming-enabled';

  const getStoredJobNamingPreference = () => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      const storedValue = window.localStorage.getItem(JOB_NAMING_STORAGE_KEY);
      return storedValue === 'true';
    } catch (error) {
      console.error('Failed to read job naming preference:', error);
      return false;
    }
  };

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
  const [job, setJob] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [loadingJobId, setLoadingJobId] = useState(null);
  const [jobEvents, setJobEvents] = useState([]);

  // New states for processing progress
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');

  // Q native related
  const [qAppData, setqAppData] = useState([]);
  const [qSsessionId, setQSessionId] = useState(null);
  const [qCardInputValues, setQCardInputValues] = useState({});

  const [runName, setRunName] = useState('');
  const [isJobNamingEnabled, setIsJobNamingEnabled] = useState(getStoredJobNamingPreference);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(JOB_NAMING_STORAGE_KEY, String(isJobNamingEnabled));
    } catch (error) {
      console.error('Failed to persist job naming preference:', error);
    }

    if (!isJobNamingEnabled) {
      setRunName('');
    }
  }, [isJobNamingEnabled]);

  const [jobs, setJobs] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [hasRun, setHasRun] = useState(false);
  const { numaPost } = useNumaRequest();

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
    setRunName('');
    setCurrentJobId(null);
    setJob(null);
    setLoadingJobId(null);
    // Note: jobEvents are NOT cleared here - they persist until a new run starts

    // Clear URL query parameters to prevent auto-reload
    const currentPath = window.location.pathname;
    window.history.replaceState(null, '', currentPath);
  };

  // We now create a job directly when uploading files instead of using a session ID
  // Load jobs for the current app
  const loadAppJobs = async ({ nextToken = null, append = false } = {}) => {
    if (!numaAppId) {
      return { items: [], nextToken: null };
    }

    try {
      const response = await jobsApi.getJobsByAppId(numaAppId, nextToken);

      const items = response.items || [];
      const newNextToken = response.next_token || response.nextToken || null;

      // Filter out 'files-uploaded' jobs as they are intermediate states, not actual app runs
      const filteredItems = items.filter((job) => {
        const status = (job.status || '').toLowerCase();
        return status !== 'files-uploaded' && status !== 'files_uploaded';
      });

      // Sort jobs by date before setting/appending
      const sortedJobs = filteredItems.sort((a, b) => {
        const dateA = new Date(a.startedAt || a.dateTime);
        const dateB = new Date(b.startedAt || b.dateTime);
        return dateB - dateA;
      });

      // If append is true, add to existing jobs, otherwise replace
      setJobs((prevJobs) => {
        if (append) {
          // Filter out any duplicates when appending
          const newJobs = sortedJobs.filter(
            (newJob) => !prevJobs.some((existingJob) => existingJob.jobId === newJob.jobId),
          );
          return [...prevJobs, ...newJobs];
        }
        return sortedJobs;
      });

      const result = { items: sortedJobs, nextToken: newNextToken };
      return result;
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

  // Auto-load job if jobId query parameter is present
  useEffect(() => {
    if (appRunning || loading || loadingJobId) {
      return;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const jobIdParam = urlParams.get('jobId');

    // Clear current job data if no jobId in URL
    // But only clear if the current job doesn't have results (to avoid clearing completed jobs)
    if (!jobIdParam && currentJobId && (!job || !job.results)) {
      setCurrentJobId(null);
      setJob(null);
    }

    // Load job data if jobId is present
    if (jobIdParam && numaAppId && numaAppData) {
      // Only load if the job ID has changed or we don't have a job loaded
      if (jobIdParam !== currentJobId || !job) {
        loadJobResults(jobIdParam).catch((error) => {
          console.error('Failed to auto-load job from query parameter:', error);
          setError(error);
        });
      }
    }
  }, [appRunning, loading, loadingJobId, numaAppId, numaAppData, window.location.search, currentJobId, job]);

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
    return currentResults;
  };

  const processDropdownTableTask = (task, currentResults) => {
    currentResults[task.id] = taskInputValues[task.id] || {};
    return currentResults;
  };

  const processS3UploadTask = (task, currentResults) => {
    const uploadedFiles = taskInputValues[task.id];
    // Check if the task is required (default to false for better user experience)
    const isRequired = task.required !== undefined ? task.required : false;

    // Check if we have valid uploads in either format:
    // 1. Standardized format (array of objects with id, name, s3_key)
    // 2. Legacy format (string or array of strings)
    const isValidUpload =
      uploadedFiles &&
      // Check standardized format or legacy object format
      ((Array.isArray(uploadedFiles) &&
        uploadedFiles.length > 0 &&
        uploadedFiles.every(
          (file) =>
            file &&
            // Check either standardized format (s3_key) or legacy format (filePath)
            ((file.id && file.name && file.s3_key) || (file.randomId && file.fileName && file.filePath)),
        )) ||
        // Check legacy string format
        (typeof uploadedFiles === 'string' && uploadedFiles.length > 0) ||
        (Array.isArray(uploadedFiles) &&
          uploadedFiles.length > 0 &&
          uploadedFiles.every((path) => typeof path === 'string')));

    // If the upload is required and we don't have valid files, throw an error
    if (isRequired && !isValidUpload) {
      throw new Error(i18n.t('apps:errors.noFileUploaded'));
    }

    // For non-required uploads with no file or invalid uploads, handle appropriately
    if (!isValidUpload) {
      // Always return an empty array for consistency
      currentResults[task.id] = [];
    } else {
      // Convert to standardized format
      if (Array.isArray(uploadedFiles)) {
        if (uploadedFiles[0] && uploadedFiles[0].s3_key) {
          // Already in standardized format
          currentResults[task.id] = uploadedFiles;
        } else if (uploadedFiles[0] && uploadedFiles[0].filePath) {
          // Legacy object format - convert to standardized format
          currentResults[task.id] = uploadedFiles.map((file) => ({
            id: file.randomId || file.id,
            name: file.fileName || file.name,
            s3_key: file.filePath || file.s3_key,
          }));
        } else {
          // Legacy string format - convert to standardized format
          currentResults[task.id] = uploadedFiles.map((path) => ({
            id: path.split('/').pop().split('_')[1].split('.')[0], // Extract randomId from path
            name: path.split('/').pop().split('_')[0] + path.split('_')[1].split('.')[1], // Extract filename
            s3_key: path,
          }));
        }
      } else {
        // Legacy format - single string
        const path = uploadedFiles;
        currentResults[task.id] = [
          {
            id: path.split('/').pop().split('_')[1].split('.')[0], // Extract randomId from path
            name: path.split('/').pop().split('_')[0] + path.split('_')[1].split('.')[1], // Extract filename
            s3_key: path,
          },
        ];
      }
    }
    return currentResults;
  };

  const processHttpRequestTask = async (jobId, task, currentResults) => {
    const templatePayload = task.params?.payload;
    const request_endpoint = `/api/${numaAppData.id}/main`;

    const payload = createPayloadFromTemplate(templatePayload, taskInputValues, currentResults);

    // Get user's language preference for LLM responses
    const { language } = getEffectiveLanguage();

    const requestPayload = {
      ...payload,
      jobId: jobId,
      user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language,
    };

    // Initial request should return success status
    try {
      const response = await numaPost(request_endpoint, requestPayload);

      if (!response || !response.job_id) {
        throw new Error(i18n.t('apps:errors.noJobId'));
      }

      // Poll for results using standardized function
      const { result } = await pollJobForCompletion(response.job_id);

      console.log('Task completed - result:', result);
      currentResults[task.id] = result;
      return currentResults;
    } catch (error) {
      // Log the technical error for debugging
      console.error('HTTP Request task error:', error);
      // Return a user-friendly error message
      throw new Error(i18n.t('apps:errors.processFailed'));
    }
  };

  // Standardized function for polling job completion - used by both initial runs and history jobs
  const pollJobForCompletion = async (jobId) => {
    try {
      const { status, result } = await pollJobStatus({
        jobId: jobId,
        pollInterval: 5000,
        maxPollingTime: 30 * 60 * 1000, // 30 minutes
      });

      if (status === 'completed' && result) {
        console.log('Job completed - result:', result);
        return { success: true, result };
      }

      if (status === 'incomplete') {
        throw new Error(i18n.t('apps:errors.timeout'));
      }

      throw new Error(i18n.t('apps:errors.jobIncomplete'));
    } catch (error) {
      console.error('Job polling error:', error);
      throw error;
    }
  };

  // Shared polling function for both initial tasks and history jobs
  const pollJobStatus = async ({
    jobId,
    pollInterval = 5000,
    maxPollingTime = 30 * 60 * 1000, // Changed from 5 * 60 * 1000 to 30 * 60 * 1000 for consistency
    initialState = null,
    onPollSuccess = null,
    shouldContinuePolling = null,
  }) => {
    const startTime = Date.now();
    let currentState = initialState ? { ...initialState } : null;

    try {
      while (true) {
        // Use jobsApi to get job status directly from DynamoDB
        const job = await jobsApi.getJobById(numaAppData.id, jobId);

        // Extract and merge job events if present
        if (job.events && Array.isArray(job.events)) {
          setJobEvents((prevEvents) => {
            // Merge frontend synthetic events with backend events
            // Create a map of backend events by timestamp+message for deduplication
            const backendEventsMap = new Map();
            job.events.forEach((event) => {
              const key = `${event.timestamp}-${event.message}`;
              backendEventsMap.set(key, event);
            });

            // Add previous frontend events that aren't in backend
            prevEvents.forEach((event) => {
              const key = `${event.timestamp}-${event.message}`;
              if (!backendEventsMap.has(key)) {
                backendEventsMap.set(key, event);
              }
            });

            // Convert back to array and sort by timestamp
            const mergedEvents = Array.from(backendEventsMap.values()).sort((a, b) => {
              return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            });

            // Only update if events have changed to avoid unnecessary re-renders
            const eventsChanged = JSON.stringify(prevEvents) !== JSON.stringify(mergedEvents);
            return eventsChanged ? mergedEvents : prevEvents;
          });
        }

        // For history jobs, check for changes
        if (currentState) {
          const hasChanges =
            job.status !== currentState.status || JSON.stringify(job.results) !== JSON.stringify(currentState.results);

          if (hasChanges) {
            // Update the state with new data
            currentState = {
              ...currentState,
              status: job.status,
              lastUpdated: new Date().toISOString(),
              results: job.results || currentState.results,
            };

            // Call success handler if provided
            if (onPollSuccess) {
              await onPollSuccess(currentState, job);
            }
          }
        }

        // Check completion status
        if (job.status === 'SUCCESS' || job.status === 'completed') {
          if (job.results) {
            // Parse the result if it's a JSON string
            let parsedResult = job.results;
            if (typeof job.results === 'string') {
              try {
                parsedResult = JSON.parse(job.results);
              } catch (parseError) {
                console.error('Error parsing result JSON:', parseError);
                // Keep the original string if parsing fails
                parsedResult = job.results;
              }
            }

            // Format the result
            const formattedResult = {};
            if (typeof parsedResult === 'object' && parsedResult !== null) {
              Object.entries(parsedResult).forEach(([key, value]) => {
                formattedResult[key] = value;
              });
            } else {
              // Handle non-object results
              formattedResult.data = parsedResult;
            }

            return {
              status: 'completed',
              result: formattedResult,
              state: currentState,
            };
          }
          throw new Error(i18n.t('apps:errors.noResultData'));
        } else if (job.status === 'FAILURE' || job.status === 'error' || job.status === 'failed') {
          throw new Error(job.error || i18n.t('apps:errors.taskFailed'));
        }

        // Check if we should continue polling
        if (shouldContinuePolling) {
          const shouldContinue = shouldContinuePolling(currentState, startTime);
          if (!shouldContinue) {
            break;
          }
        }

        // Always check default polling time as a safety net
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > maxPollingTime) {
          console.log('Stopping poll: Max time reached');
          break;
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
      jobHistoryItem.status === 'SUCCESS' ||
      jobHistoryItem.status === 'error' ||
      jobHistoryItem.status === 'FAILURE' ||
      jobHistoryItem.status === 'files-uploaded'
    ) {
      // Skip polling for completed jobs or 'files-uploaded' jobs
      return jobHistoryItem;
    }

    if (!jobHistoryItem.jobId) {
      // console.log('No jobId available for polling incomplete job');
      return jobHistoryItem;
    }

    try {
      // Set UI states to match initial app run
      setAppRunning(true);
      setJobHistorySidebarOpen(false);
      setProcessingStatus(i18n.t('apps:processing.processing'));
      setProcessingProgress(30);

      // Load input values and mark tasks as complete
      const taskCompletions = {};

      // Mark input tasks complete if they have values
      if (jobHistoryItem.inputs) {
        // Filter out internal fields from inputs before setting as task input values
        // Only include fields that correspond to actual task IDs
        const filteredInputs = {};
        if (numaAppData?.tasks) {
          const taskIds = new Set(numaAppData.tasks.map((t) => t.id));
          Object.entries(jobHistoryItem.inputs).forEach(([key, value]) => {
            if (taskIds.has(key)) {
              filteredInputs[key] = value;
            }
          });
        }
        setTaskInputValues(filteredInputs);
        numaAppData.tasks.forEach((task) => {
          if ((task.type === 'text-input' || task.type === 's3-upload') && jobHistoryItem.inputs[task.id]) {
            taskCompletions[task.id] = true;
          }
        });
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

      // Use the standardized polling function
      const { result } = await pollJobForCompletion(jobHistoryItem.jobId);

      // Just store the original keys, we'll use findValueWithFormatFlexibility for lookups
      const formattedResult = {};
      Object.entries(result).forEach(([key, value]) => {
        formattedResult[key] = value;
      });

      // DO NOT update job status - the app should handle its own completion
      // Simply refresh the jobs list to get the updated status from the app
      await loadAppJobs();

      // Update UI same as initial app run
      setProcessingProgress(100);
      setProcessingStatus(i18n.t('apps:processing.complete'));
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
    } catch (error) {
      console.error('Error in history job polling:', error);
      setProcessingStatus(i18n.t('apps:processing.error'));
      setProcessingProgress(0);
      return jobHistoryItem;
    } finally {
      setAppRunning(false);
    }
  };

  // Fetch content from S3
  // Wrapped in useCallback to maintain stable reference and prevent unnecessary re-renders
  const fetchS3Content = useCallback(async (bucket, key, credentials) => {
    try {
      const region = window.sessionStorage.getItem('REGION');
      const s3Client = withPRM(S3Client, {
        region: region,
        credentials,
      });

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const signedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      });

      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.text();

      return data;
    } catch (error) {
      console.error('Error fetching S3 content:', error);
      throw error;
    }
  }, []);

  const pollQAppSession = async (sessionId, updateProgress) => {
    let polling = true;
    let sessionResponse = null;

    while (polling) {
      try {
        sessionResponse = await getSessionQApp({
          qAppsClient,
          sessionId,
        });

        if (sessionResponse?.status === 'COMPLETED') {
          polling = false;
          return { ...sessionResponse, progress: 100 };
        } else if (sessionResponse?.status === 'FAILED') {
          polling = false;
          throw new Error(i18n.t('apps:errors.qAppSessionFailed'));
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
          // console.log('No card status in session response');
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

  const initializeJob = async (nameOverride?: string) => {
    setAppRunning(true);
    setLoading(true);

    try {
      const normalizedRunName = (nameOverride ?? runName ?? '').trim();
      // If we already have a job ID (from file uploads), use it
      // Otherwise, create a new job
      let jobResponse;
      if (currentJobId) {
        // Check if job is already completed - if so, don't update it
        try {
          const existingJob = await jobsApi.getJobById(numaAppData.id, currentJobId);
          if (existingJob && (existingJob.status === 'completed' || existingJob.status === 'SUCCESS')) {
            jobResponse = {
              jobId: currentJobId,
              startedAt: existingJob.startedAt || new Date().toISOString(),
              name: existingJob.name,
            };
          } else {
            // Only update to PROCESSING if job is not already completed
            const updateOptions = normalizedRunName ? { name: normalizedRunName } : undefined;
            await jobsApi.updateJob(numaAppData, currentJobId, null, taskInputValues, 'PROCESSING', updateOptions);
            jobResponse = {
              jobId: currentJobId,
              startedAt: new Date().toISOString(),
              name: normalizedRunName,
            };
          }
        } catch (updateError) {
          console.error('Failed to update job status:', updateError);
          // Continue even if the update fails - we'll still try to use the job
          jobResponse = {
            jobId: currentJobId,
            startedAt: new Date().toISOString(),
            name: normalizedRunName,
          };
        }
      } else {
        // No job exists yet, create one with 'PROCESSING' status
        const createOptions = normalizedRunName ? { name: normalizedRunName } : undefined;
        jobResponse = await jobsApi.createJob(numaAppData, taskInputValues, 'PROCESSING', createOptions);
        setCurrentJobId(jobResponse.jobId);
      }

      if (jobResponse?.name) {
        setRunName(jobResponse.name);
      } else if (normalizedRunName) {
        setRunName(normalizedRunName);
      }

      return {
        jobId: jobResponse.jobId,
        dateTime: jobResponse.startedAt,
      };
    } catch (error) {
      console.error('Failed to create job:', error);
      setProcessingStatus(i18n.t('apps:processing.error'));
      setProcessingProgress(0);
      throw new Error(i18n.t('apps:errors.startProcessFailed'));
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
    setProcessingStatus(i18n.t('apps:processing.runningAnalysis'));
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
    if (!title) return i18n.t('apps:processing.taskFallback');
    return title.replace(/\b(process(ing)?|running)\b/gi, '').trim();
  };

  // Add synthetic event to job events (frontend-only, immediate feedback)
  const addSyntheticEvent = (message) => {
    const newEvent = {
      timestamp: new Date().toISOString(),
      message: message,
    };
    setJobEvents((prev) => [...prev, newEvent]);
  };

  const handleRunButtonClick = async (_app = null, options: { runName?: string } = {}) => {
    if (!numaAppData || !numaAppData.tasks) return;

    // Clear previous run's events
    setJobEvents([]);
    setProcessingStatus(i18n.t('apps:processing.startingProcess'));
    setProcessingProgress(0);
    setError(null); // Clear any previous errors

    // Add initial synthetic event
    const appName = numaAppData?.manifest?.appName || i18n.t('apps:processing.appFallback');
    addSyntheticEvent(i18n.t('apps:processing.startingApp', { appName }));

    try {
      const { jobId } = await initializeJob(options.runName);
      let currentResults = {};

      const orderedTasks = numaAppData.tasks.slice().sort((a, b) => a.order - b.order);

      let completedWeight = 0;
      let qappWeight = 0;
      const totalWeight = calculateTotalWeight(orderedTasks);

      for (const task of orderedTasks) {
        // Determine appropriate prefix based on task type
        let taskPrefix = i18n.t('apps:processing.taskPrefixes.processing');
        if (
          task.type === 'text-input' ||
          task.type === 's3-upload' ||
          task.type === 'dropdown' ||
          task.type === 'dropdown-table'
        ) {
          taskPrefix = i18n.t('apps:processing.taskPrefixes.processingInput');
        } else if (task.type === 'http-request' || task.type === 'q-app') {
          taskPrefix = i18n.t('apps:processing.taskPrefixes.executing');
        } else if (task.type === 'text-output') {
          taskPrefix = i18n.t('apps:processing.taskPrefixes.preparingOutput');
        }
        const taskMessage = i18n.t('apps:processing.taskMessage', {
          prefix: taskPrefix,
          title: cleanTaskTitle(task.title),
        });
        setProcessingStatus(taskMessage);
        addSyntheticEvent(taskMessage);
        const taskWeight = calculateTaskWeight(task);

        switch (task.type) {
          case 'text-input':
            currentResults = processTextInputTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          case 'dropdown-table':
            currentResults = processDropdownTableTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          case 'dropdown':
            // Handle similarly to text input
            currentResults = processTextInputTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          case 's3-upload':
            currentResults = processS3UploadTask(task, currentResults);
            completedWeight += taskWeight;
            break;

          case 'http-request':
            currentResults = await processHttpRequestTask(jobId, task, currentResults);
            completedWeight += taskWeight;
            break;

          case 'q-app':
            qappWeight = taskWeight;
            currentResults = await handleQAppTask(task, currentResults, completedWeight, qappWeight, totalWeight);
            completedWeight += taskWeight;
            break;

          case 'text-output':
            // Skip text-output tasks during main loop - they'll be processed by loadJobResults
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

      // Add completion synthetic event
      addSyntheticEvent(i18n.t('apps:processing.analysisComplete'));

      // After all tasks complete successfully, reload the job to get proper output processing
      // This reuses the existing loadJobResults logic which handles output tasks correctly
      await loadJobResults(jobId);

      return currentResults;
    } catch (error) {
      console.error('Error running app:', error);
      addSyntheticEvent(
        i18n.t('apps:processing.errorWithMessage', {
          message: error.message || i18n.t('errors:unknown'),
        }),
      );
      setProcessingStatus(i18n.t('apps:processing.error'));
      setProcessingProgress(0);
      throw error; // Re-throw to be handled by AppWizard
    } finally {
      setLoading(false);
      setAppRunning(false);
    }
  };

  // Load and display historical job results
  const loadJobResults = async (jobId) => {
    setLoadingJobId(jobId);
    try {
      let job = await jobsApi.getJobById(numaAppId, jobId);
      if (!job) {
        throw new Error(i18n.t('apps:errors.jobNotFound'));
      }

      setJob(job);

      // Try to poll for updates if job is incomplete
      if (job.status !== 'completed') {
        job = await pollIncompleteHistoryJob(job);
      }

      // Reset states before polling
      setNumaTaskResponses([]);
      setTaskCompletionStatus({});
      setTaskInputValues({});
      setActiveStep(0);
      setSelectedTaskId(null);

      // Clear or load job events from the loaded job
      if (job.events && Array.isArray(job.events)) {
        // Load the events from the job
        setJobEvents(job.events);
      } else {
        // No events in the job, clear any previous events
        setJobEvents([]);
      }

      // Set app state based on job status
      if (job.status === 'files-uploaded') {
        // For 'files-uploaded' jobs, the app wasn't run, so don't show post-run navigation
        setAppRunning(false);
        setHasRun(false);
        setJobHistorySidebarOpen(false); // Close the sidebar for files-uploaded jobs
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
              // ALWAYS ensure file uploads are loaded as arrays for consistency
              // This ensures compatibility with the state machine expectations
              if (!Array.isArray(fileValue)) {
                processedInputs[task.id] = [fileValue];
              }
            }
          });
        }

        // Filter out internal fields from processedInputs before setting as task input values
        // Only include fields that correspond to actual task IDs
        const filteredInputs = {};
        if (numaAppData?.tasks) {
          const taskIds = new Set(numaAppData.tasks.map((t) => t.id));
          Object.entries(processedInputs).forEach(([key, value]) => {
            if (taskIds.has(key)) {
              filteredInputs[key] = value;
            }
          });
        }

        setTaskInputValues(filteredInputs);
      }

      // Set the current job ID so we can use it when running the app
      if (job.jobId) {
        setCurrentJobId(job.jobId);

        // Update URL with jobId so the results persist across page refresh
        const url = new URL(window.location.href);
        if (url.searchParams.get('jobId') !== job.jobId) {
          url.searchParams.set('jobId', job.jobId);
          window.history.replaceState({}, '', url);
        }
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
        throw new Error(i18n.t('apps:errors.noManifest'));
      }

      // Try to poll for updates if job is incomplete and was actually running
      // If status is 'files-uploaded', we don't need to poll as the app was never run
      if (job.status === 'PROCESSING') {
        job = await pollIncompleteHistoryJob(job);
      } else if (job.status === 'files-uploaded') {
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
              updatedStatus[task.id] = true;
            } else if (task.type === 's3-upload' && job.inputs && job.inputs[task.id]) {
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
        setProcessingStatus(i18n.t('apps:processing.complete'));
      }

      setJob(job);
      setRunName((job.name || '').trim());

      // Set appRunning to false after all results are processed
      setAppRunning(false);

      // Trigger file upload value updates to ensure file names are displayed
      triggerFileUploadValueUpdates();
    } catch (error) {
      console.error('Error loading job results:', error);
      throw error;
    } finally {
      setLoadingJobId(null);
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

  /**
   * Start a follow-up prompt with the same job ID to continue an analysis session
   * Uses session continuity to build on previous work
   */
  const startFollowUp = async (jobId: string, prompt: string) => {
    if (!numaAppData) {
      throw new Error(i18n.t('apps:errors.appNotInitialized'));
    }

    // Clear previous results to switch UI to running state
    setNumaTaskResponses([]);
    setJob(null);
    setJobEvents([]);
    setProcessingStatus(i18n.t('apps:processing.startingFollowUp'));
    setProcessingProgress(0);
    setError(null);
    setAppRunning(true);
    setLoading(true);

    // Add synthetic event for immediate feedback
    addSyntheticEvent(i18n.t('apps:processing.startingFollowUpAnalysis'));

    try {
      // Get current task input values (uploaded files, etc.)
      const uploaded_files = taskInputValues['upload-files-to-s3'] || [];

      // Get user's language preference for LLM responses
      const { language } = getEffectiveLanguage();

      const requestPayload = {
        jobId: jobId, // Re-use same job ID for session continuity
        prompt: prompt,
        uploaded_files: uploaded_files,
        resume_session: true, // Enable session continuity
        analysis_mode: 'full', // Required by the Step Function Initialize state
        user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language,
      };

      // Start the follow-up run
      const request_endpoint = `/api/${numaAppData.id}/main`;
      addSyntheticEvent(i18n.t('apps:processing.sendingFollowUpRequest'));
      const response = await numaPost(request_endpoint, requestPayload);

      if (!response || !response.job_id) {
        throw new Error(i18n.t('apps:errors.followUpNoJobId'));
      }

      // Set this as the current job
      setCurrentJobId(response.job_id);
      addSyntheticEvent(i18n.t('apps:processing.processingFollowUpQuestion'));

      // Poll for results
      const { result } = await pollJobForCompletion(response.job_id);

      // Load the results
      await loadJobResults(response.job_id);
      addSyntheticEvent(i18n.t('apps:processing.followUpComplete'));

      return result;
    } catch (error) {
      console.error('Error starting follow-up:', error);
      setProcessingStatus(i18n.t('apps:processing.error'));
      setProcessingProgress(0);
      addSyntheticEvent(
        i18n.t('apps:processing.errorWithMessage', {
          message: error.message || i18n.t('errors:unknown'),
        }),
      );
      throw new Error(i18n.t('apps:errors.startFollowUpFailed'));
    } finally {
      setLoading(false);
      setAppRunning(false);
    }
  };

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
    runName,
    setRunName,
    isJobNamingEnabled,
    setIsJobNamingEnabled,
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
    job,
    jobEvents,
    fetchS3Content,
    loadingJobId,
    setLoadingJobId,
    startFollowUp,
  };

  return <NumaAppContext.Provider value={contextValue}>{children}</NumaAppContext.Provider>;
};
