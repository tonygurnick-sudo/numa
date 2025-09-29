import { createContext, useContext } from 'react';

type Ctx = {
  updateTaskInputValue: (taskId: string, value: unknown) => void;
  updateTaskCompletionStatus: (taskId: string, success?: boolean) => void;
};

// Create the context
export const NumaAppContext = createContext<Ctx>({
  // Status states
  loading: false,
  setLoading: () => {},
  error: null,
  setError: () => {},

  // App data states
  numaApps: [],
  setNumaApps: () => {},
  numaAppData: null,
  setNumaAppData: () => {},
  qAppData: [],
  setqAppData: () => {},
  numaAppId: null,
  setNumaAppId: () => {},

  // Task states
  taskInputValues: {},
  setTaskInputValues: () => {},
  updateTaskInputValue: () => {},
  taskCompletionStatus: {},
  setTaskCompletionStatus: () => {},
  updateTaskCompletionStatus: () => {},

  // Q-App specific states
  qCardInputValues: {},
  setQCardInputValues: () => {},
  qSsessionId: null,
  setQSessionId: () => {},

  // Run states
  runActive: 'disabled',
  setRunActive: () => {},
  progress: 0,
  setProgress: () => {},
  isPolling: false,
  setIsPolling: () => {},
  processingStatus: '',
  setProcessingStatus: () => {},
  processingProgress: 0,
  setProcessingProgress: () => {},

  // Job and task management
  handleRunButtonClick: async () => {},
  getAppJobs: () => [],
  loadAppJobs: async () => {},
  appRunning: false,
  setAppRunning: () => {},
  loadJobResults: async () => {},
  currentJobId: null,
  setCurrentJobId: () => {},
  loadingJobId: null,
  setLoadingJobId: () => {},

  // UI states
  numaTaskResponses: [],
  selectedTaskId: null,
  setSelectedTaskId: () => {},
  jobHistorySidebarOpen: false,
  setJobHistorySidebarOpen: () => {},
  activeStep: 0,
  setActiveStep: () => {},
  hasRun: false,
  setHasRun: () => {},

  // Utility functions
  resetAppState: () => {},
});

// Custom hook for using context
export const useNumaApp = () => {
  const context = useContext(NumaAppContext);
  if (!context) {
    throw new Error('useNumaApp must be used within a NumaAppProvider');
  }
  return context;
};

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
export const resolveReference = (key, taskResults) => {
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

  // Process file arrays - if the result is an array of file objects, preserve the standardized format
  if (
    Array.isArray(baseResult) &&
    baseResult.length > 0 &&
    typeof baseResult[0] === 'object' &&
    (baseResult[0].filePath || baseResult[0].s3_key)
  ) {
    // If there's no subPath, return the array as-is
    if (subPaths.length === 0) {
      // Convert legacy format (filePath) to standardized format (s3_key)
      return baseResult.map((fileObj) => ({
        id: fileObj.randomId || fileObj.id,
        name: fileObj.fileName || fileObj.name,
        s3_key: fileObj.filePath || fileObj.s3_key,
      }));
    }

    // If there is a subPath, we can't navigate further since we've transformed the structure
    console.warn(`Cannot navigate to subpath ${subPaths.join('/')} after file array transformation`);
    return baseResult;
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
export function createPayloadFromTemplate(template, inputValues, taskResults) {
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

      // Handle null values and empty arrays to prevent backend errors
      if (processedValue === null) {
        // Use empty string instead of null
        acc[key] = '';
      } else if (Array.isArray(processedValue) && processedValue.length === 0) {
        // Use empty array as is
        acc[key] = [];
      } else {
        // Use the processed value directly without wrapping in an array
        acc[key] = processedValue;
      }

      return acc;
    }, {});
  }

  return template; // Return as is for other data types (numbers, booleans, etc.)
}
