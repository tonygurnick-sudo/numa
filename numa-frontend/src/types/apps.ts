export interface NumaApp {
  id: string;
  appName: string;
  appDescription?: string;
  category?: string;
  status?: string; // e.g., 'Active'
  priority?: number;
  [key: string]: unknown;
}

export type NumaAppContextValue = {
  // Status states
  loading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;

  // App data states
  numaApps: NumaApp[];
  setNumaApps: (apps: NumaApp[]) => void;

  // Task updates used across components
  updateTaskInputValue: (taskId: string, value: unknown) => void;
  updateTaskCompletionStatus: (taskId: string, success?: boolean) => void;

  // Allow other context members without over-constraining the type
  [key: string]: unknown;
};
