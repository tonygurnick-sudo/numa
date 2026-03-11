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

export interface JobEvent {
  timestamp: string;
  message: string;
}

export interface JobResult {
  outputs: ResultOutput[];
}

export interface Job {
  results?: JobResult[];
  events?: JobEvent[];
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

// ─── V2 Apps Types ──────────────────────────────────────────────────────────

export interface V2AppTab {
  id: string;
  labelKey: string;
  icon?: string;
}

export type V2AppStatus = 'active' | 'beta' | 'coming-soon';

export interface V2AppAgent {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: string;
  color: string;
  status: 'active' | 'coming-soon';
  capabilities?: string[];
  /** How to display results for this agent's runs. Defaults to agent-response. */
  resultConfig?: V2AppResultConfig;
}

export interface V2AppWorkspaceSettings {
  enabledKBIds: string[];
  enabledTools: string[];
  enabledConnections: string[];
  workspaceAccess: boolean;
  contextInstructions: string;
}

export interface RunConfiguration {
  agentId: string;
  enabledKBIds: string[];
  enabledKBs?: Array<{ id: string; name: string }>;
  enabledTools: string[];
  enabledConnections: string[];
  workspaceAccess: boolean;
  contextInstructions: string;
}

/**
 * Defines how to extract and display results for a V2 app run.
 *
 * - 'agent-response': Show the agent's text response as markdown.
 * - 'file': Download/display a specific file from the run's S3 path (e.g. report.pdf).
 */
export type V2AppResultConfig = { type: 'agent-response' } | { type: 'file'; fileName: string; contentType: string };

export interface V2AppConfig {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  color: string;
  status: V2AppStatus;
  category: string;
  tabs: V2AppTab[];
  agents: V2AppAgent[];
  /** Optional per-app prompt placeholder i18n key. Falls back to v2Apps.agentRunPanel.promptPlaceholder. */
  promptPlaceholderKey?: string;
  /** @deprecated — Use resultConfig on each V2AppAgent instead. */
  resultConfig?: V2AppResultConfig;
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
  jobEvents: JobEvent[];
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
