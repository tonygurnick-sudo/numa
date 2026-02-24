export type AgentStatus = {
  status: 'success' | 'partial' | 'failed';
  summary: string;
  artifacts: string[];
  errors: string[];
  warnings: string[];
};

export type ScheduledRunLog = {
  scheduleId?: string;
  scheduleLabel?: string | null;
  runId?: string;
  conversationId?: string;
  userId?: string;
  prompt?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  messages?: { role: string; content: string }[];
  agentStatus?: AgentStatus;
};

export type RunHistoryItem = {
  runId: string;
  s3Key: string;
  timestamp: Date;
  log?: ScheduledRunLog;
  loading?: boolean;
  error?: string;
};
