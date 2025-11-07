// ../types/apps.ts
export interface LegacyFileRef {
  id?: string;
  randomId?: string;
  name?: string;
  fileName?: string;
  filePath?: string;
  s3_key?: string;
}

export interface FileRef {
  id: string;
  name: string;
  s3_key: string;
}

export enum RunActiveState {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export enum ProcessingStatus {
  Idle = 'idle',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

export interface ResultOutput {
  title?: string;
  content_type: 'text/markdown' | 'application/json' | string;
  data: unknown;
}

export interface JobResult {
  outputs: ResultOutput[];
}

export interface Job {
  results?: JobResult[];
}

export interface NumaApp {
  id: string;
  appName: string;
  appDescription?: string;
  category?: string;
  status?: string; // e.g., 'Active'
  priority?: number;
  job: Job | null;
  [key: string]: unknown;
}

// ../types/apps.ts
export interface NumaAppContextValue {
  // Status states
  loading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;

  // App data states
  numaApps: NumaApp[];
  setNumaApps: (apps: NumaApp[]) => void;
  numaAppData: NumaApp | null;
  setNumaAppData: (a: NumaApp | null) => void;
  qAppData: unknown[];
  setqAppData: (d: unknown[]) => void;
  numaAppId: string | null;
  setNumaAppId: (id: string | null) => void;

  // Task states
  taskInputValues: Record<string, unknown>;

  setTaskInputValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;

  updateTaskInputValue: (taskId: string, value: unknown) => void;
  taskCompletionStatus: Record<string, boolean>;
  setTaskCompletionStatus: (status: Record<string, boolean>) => void;
  updateTaskCompletionStatus: (taskId: string, success?: boolean) => void;

  // Q-App specific states
  qCardInputValues: Record<string, unknown>;
  setQCardInputValues: (vals: Record<string, unknown>) => void;
  qSsessionId: string | null;
  setQSessionId: (id: string | null) => void;

  // Run states
  runActive: RunActiveState;
  setRunActive: (state: RunActiveState) => void;
  progress: number;
  setProgress: (v: number) => void;
  isPolling: boolean;
  setIsPolling: (v: boolean) => void;
  processingStatus: ProcessingStatus | string;
  setProcessingStatus: (s: ProcessingStatus | string) => void;
  processingProgress: number;
  setProcessingProgress: (v: number) => void;

  // Run naming
  runName: string;
  setRunName: (value: string) => void;
  isJobNamingEnabled: boolean;
  setIsJobNamingEnabled: (enabled: boolean) => void;

  // Job and task management
  job: Job | null;
  handleRunButtonClick: (app: NumaApp | null, options?: { runName?: string }) => Promise<void>;
  getAppJobs: () => Job[];
  loadAppJobs: () => Promise<void>;
  appRunning: boolean;
  setAppRunning: (v: boolean) => void;
  loadJobResults: () => Promise<void>;
  currentJobId: string | null;
  setCurrentJobId: (id: string | null) => void;
  loadingJobId: string | null;
  setLoadingJobId: (id: string | null) => void;

  // UI states
  numaTaskResponses: unknown[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  jobHistorySidebarOpen: boolean;
  setJobHistorySidebarOpen: (v: boolean) => void;
  activeStep: number;
  setActiveStep: (n: number) => void;
  hasRun: boolean;
  setHasRun: (v: boolean) => void;

  // Utility
  resetAppState: () => void;
}
