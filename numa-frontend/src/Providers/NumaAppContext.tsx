// Providers/NumaAppContext.tsx
import { createContext, useContext } from 'react';
import { FileRef, LegacyFileRef, NumaApp, NumaAppContextValue, RunActiveState } from '../types/apps';

// Create the context with a fully typed default (no-ops are fine)
export const NumaAppContext = createContext<NumaAppContextValue>({
  // Status states
  loading: false,
  setLoading: (_v: boolean) => {},
  error: null,
  setError: (_e: string | null) => {},

  // Job state
  job: null,
  jobEvents: [],

  // App data states
  numaApps: [],
  setNumaApps: (_apps: NumaApp[]) => {},
  numaAppData: null,
  setNumaAppData: (_a: NumaApp | null) => {}, // ✅ explicitly typed as NumaApp | null
  qAppData: [],
  setqAppData: (_d: unknown[]) => {},
  numaAppId: null,
  setNumaAppId: (_id: string | null) => {},

  // Task states
  taskInputValues: {},
  setTaskInputValues: (_vals: Record<string, unknown>) => {},
  updateTaskInputValue: (_taskId: string, _value: unknown) => {},
  taskCompletionStatus: {},
  setTaskCompletionStatus: (_s: Record<string, boolean>) => {},
  updateTaskCompletionStatus: (_taskId: string, _success?: boolean) => {},

  // Q-App specific states
  qCardInputValues: {},
  setQCardInputValues: (_vals: Record<string, unknown>) => {},
  qSsessionId: null,
  setQSessionId: (_id: string | null) => {},

  // Run states
  runActive: RunActiveState.Disabled,
  setRunActive: (_state: 'enabled' | 'disabled') => {},
  progress: 0,
  setProgress: (_v: number) => {},
  isPolling: false,
  setIsPolling: (_v: boolean) => {},
  processingStatus: '',
  setProcessingStatus: (_s: string) => {},
  processingProgress: 0,
  setProcessingProgress: (_v: number) => {},

  // Run naming
  runName: '',
  setRunName: (_value: string) => {},
  isJobNamingEnabled: false,
  setIsJobNamingEnabled: (_enabled: boolean) => {},

  // Job and task management
  handleRunButtonClick: async (_app: NumaApp | null, _options?: { runName?: string }) => {},
  getAppJobs: () => [],
  loadAppJobs: async () => {},
  appRunning: false,
  setAppRunning: (_v: boolean) => {},
  loadJobResults: async () => {},
  currentJobId: null,
  setCurrentJobId: (_id: string | null) => {},
  loadingJobId: null,
  setLoadingJobId: (_id: string | null) => {},
  startFollowUp: async (_jobId: string, _prompt: string) => {},

  // UI states
  numaTaskResponses: [],
  selectedTaskId: null,
  setSelectedTaskId: (_id: string | null) => {},
  jobHistorySidebarOpen: false,
  setJobHistorySidebarOpen: (_v: boolean) => {},
  activeStep: 0,
  setActiveStep: (_n: number) => {},
  hasRun: false,
  setHasRun: (_v: boolean) => {},

  // Utility
  resetAppState: () => {},
});

// Hook for consuming the context
export const useNumaApp = (): NumaAppContextValue => {
  const context = useContext(NumaAppContext);
  if (!context) {
    throw new Error('useNumaApp must be used within a NumaAppProvider');
  }
  return context;
};

// ---- Utility functions ----

// Look up a value in an object by key, allowing "_" vs "-" flexibility
export const findValueWithFormatFlexibility = (obj: Record<string, unknown>, key: string): unknown => {
  let value = obj[key];
  if (value !== undefined) return value;

  if (key.includes('_')) {
    const hyphenKey = key.replace(/_/g, '-');
    value = obj[hyphenKey];
    if (value !== undefined) return value;
  }

  if (key.includes('-')) {
    const underscoreKey = key.replace(/-/g, '_');
    value = obj[underscoreKey];
    if (value !== undefined) return value;
  }

  return undefined;
};

// Resolve a reference like "@taskId" or "@taskId/subPath"
export const resolveReference = (key: string, taskResults: Record<string, unknown>): unknown => {
  if (!key?.startsWith('@')) return key;

  const [fullTaskId, ...subPaths] = key.slice(1).split('/');
  const baseResult = findValueWithFormatFlexibility(taskResults, fullTaskId);

  if (baseResult === undefined) {
    console.warn(`Could not find task result for ${fullTaskId}`);
    return '';
  }

  if (
    Array.isArray(baseResult) &&
    baseResult.length > 0 &&
    typeof baseResult[0] === 'object' &&
    ('filePath' in baseResult[0] || 's3_key' in baseResult[0])
  ) {
    if (subPaths.length === 0) {
      return (baseResult as LegacyFileRef[]).map(
        (fileObj): FileRef => ({
          id: fileObj.randomId ?? fileObj.id ?? '',
          name: fileObj.fileName ?? fileObj.name ?? '',
          s3_key: fileObj.filePath ?? fileObj.s3_key ?? '',
        }),
      );
    }
    console.warn(`Cannot navigate to subpath ${subPaths.join('/')} after file array transformation`);
    return baseResult;
  }

  if (subPaths.length === 0 || typeof baseResult !== 'object') return baseResult;

  try {
    return (
      subPaths.reduce<unknown>((obj, path) => {
        if (obj && typeof obj === 'object' && path in obj) {
          return (obj as Record<string, unknown>)[path];
        }
        return undefined;
      }, baseResult) ?? ''
    );
  } catch (error) {
    console.warn(`Failed to resolve sub-reference ${key}:`, error);
    return '';
  }
};

// Create a payload dynamically from a template + task results
export function createPayloadFromTemplate(
  template: unknown,
  inputValues: Record<string, unknown>,
  taskResults: Record<string, unknown>,
): unknown {
  if (typeof template === 'string') {
    if (template.match(/^@[\w-]+$/)) {
      return resolveReference(template, taskResults);
    }
    return template.replace(/@[\w-]+/g, (match) => String(resolveReference(match, taskResults)));
  } else if (Array.isArray(template)) {
    return template.map((item) => createPayloadFromTemplate(item, inputValues, taskResults));
  } else if (typeof template === 'object' && template !== null) {
    return Object.entries(template).reduce<Record<string, unknown>>((acc, [key, value]) => {
      const processed = createPayloadFromTemplate(value, inputValues, taskResults);
      if (processed === null) {
        acc[key] = '';
      } else if (Array.isArray(processed) && processed.length === 0) {
        acc[key] = [];
      } else {
        acc[key] = processed;
      }
      return acc;
    }, {});
  }

  return template;
}
