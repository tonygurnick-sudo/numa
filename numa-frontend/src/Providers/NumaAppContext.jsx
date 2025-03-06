import { createContext, useContext } from 'react';

// Create the context
export const NumaAppContext = createContext({
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
