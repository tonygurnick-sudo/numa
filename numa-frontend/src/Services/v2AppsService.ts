/**
 * V2 Apps Service
 *
 * Wraps the V2 Apps API for run CRUD, execution, and file upload.
 * All endpoint methods accept numaGet/numaPost/etc. from useNumaRequest().
 */

import type { V2AppWorkspaceSettings } from '../types/apps';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown) => Promise<unknown>;
type NumaDelete = (url: string) => Promise<unknown>;

const BASE_URL = '/api/v2-apps';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RunInputs {
  runId?: string;
  prompt: string;
  files: string[];
  options?: Record<string, unknown>;
  name?: string;
  userEmail?: string;
  /** Explicit workspace agent type_id override (e.g., 'nolia-compliance'). */
  agentType?: string;
}

export interface RunResult {
  text: string;
  artifacts: Array<{ type: string; path: string }>;
  usage: Record<string, unknown>;
}

export interface ProgressEvent {
  timestamp: string;
  phase: string;
  message: string;
}

export interface RunRecord {
  runId: string;
  appId: string;
  actionId: string;
  userId: string;
  userEmail: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  inputs: RunInputs;
  result: RunResult | null;
  error: string | null;
  s3Prefix: string;
  agentType: string;
  name: string;
  /** Stable conversation ID shared across follow-up runs. Defaults to runId. */
  conversationId?: string;
  /** If this is a follow-up, the parent run's ID. */
  parentRunId?: string;
  /** Pipeline progress events (only present while PROCESSING, from _progress.json). */
  progressEvents?: ProgressEvent[];
}

interface ListRunsResponse {
  runs: RunRecord[];
  nextToken?: string;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export const createRun = async (numaPost: NumaPost, appId: string, inputs: RunInputs): Promise<RunRecord> => {
  const response = (await numaPost(`${BASE_URL}/runs`, { appId, ...inputs })) as RunRecord;
  return response;
};

export const getRun = async (numaGet: NumaGet, runId: string): Promise<RunRecord> => {
  const response = (await numaGet(`${BASE_URL}/runs/${runId}`)) as RunRecord;
  return response;
};

export const listRuns = async (
  numaGet: NumaGet,
  params: { appId?: string; userId?: string; limit?: number; nextToken?: string } = {}
): Promise<ListRunsResponse> => {
  const response = (await numaGet(`${BASE_URL}/runs`, params as Record<string, unknown>)) as ListRunsResponse;
  return response;
};

export const updateRun = async (
  numaPut: NumaPut,
  runId: string,
  updates: Partial<Pick<RunRecord, 'name' | 'status' | 'result' | 'error'>>
): Promise<RunRecord> => {
  const response = (await numaPut(`${BASE_URL}/runs/${runId}`, updates)) as RunRecord;
  return response;
};

export const deleteRun = async (numaDelete: NumaDelete, runId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/runs/${runId}`);
};

export const startRun = async (numaPost: NumaPost, runId: string): Promise<RunRecord> => {
  const response = (await numaPost(`${BASE_URL}/runs/${runId}/start`)) as RunRecord;
  return response;
};

export const followUpRun = async (
  numaPost: NumaPost,
  parentRunId: string,
  prompt: string,
  files?: string[],
  runId?: string
): Promise<RunRecord> => {
  const response = (await numaPost(`${BASE_URL}/runs/${parentRunId}/follow-up`, {
    prompt,
    files,
    runId,
  })) as RunRecord;
  return response;
};

export const getConversationRuns = async (numaGet: NumaGet, conversationId: string): Promise<ListRunsResponse> => {
  const response = (await numaGet(`${BASE_URL}/runs`, {
    conversationId,
  })) as ListRunsResponse;
  return response;
};

// ─── File Operations ────────────────────────────────────────────────────────

export interface V2AppFile {
  key: string;
  name: string;
  size: number;
  lastModified: string;
}

export const listFiles = async (numaGet: NumaGet, prefix: string): Promise<{ files: V2AppFile[] }> => {
  const response = (await numaGet(`${BASE_URL}/files`, { prefix })) as { files: V2AppFile[] };
  return response;
};

export const getUploadUrl = async (
  numaPost: NumaPost,
  key: string,
  contentType: string
): Promise<{ url: string; key: string }> => {
  const response = (await numaPost(`${BASE_URL}/files/upload-url`, { key, contentType })) as {
    url: string;
    key: string;
  };
  return response;
};

export const deleteFile = async (numaDelete: NumaDelete, key: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/files?key=${encodeURIComponent(key)}`);
};

// ─── Settings ────────────────────────────────────────────────────────────────

export const getSettings = async (
  numaGet: NumaGet,
  appId: string
): Promise<{ settings: V2AppWorkspaceSettings | null; updatedAt?: string }> => {
  const response = (await numaGet(`${BASE_URL}/settings`, { appId })) as {
    settings: V2AppWorkspaceSettings | null;
    updatedAt?: string;
  };
  return response;
};

export const saveSettings = async (
  numaPut: NumaPut,
  appId: string,
  settings: V2AppWorkspaceSettings
): Promise<{ settings: V2AppWorkspaceSettings; updatedAt: string }> => {
  const response = (await numaPut(`${BASE_URL}/settings`, {
    appId,
    settings,
  })) as { settings: V2AppWorkspaceSettings; updatedAt: string };
  return response;
};
