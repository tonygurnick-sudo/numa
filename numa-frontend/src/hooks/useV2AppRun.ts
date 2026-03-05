/**
 * useV2AppRun — React hook for managing V2 app run lifecycle.
 *
 * Handles: file upload → run creation → start → polling → result.
 * The hook polls GET /v2-apps/runs/{runId} which transparently checks S3
 * for _result.json, so the frontend doesn't need to know about S3 directly.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import * as v2AppsService from '../Services/v2AppsService';
import type { RunRecord } from '../Services/v2AppsService';
import type { RunConfiguration } from '../types/apps';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown) => Promise<unknown>;
type NumaDelete = (url: string) => Promise<unknown>;

export type V2AppRunState = 'idle' | 'uploading' | 'processing' | 'completed' | 'error';

interface UseV2AppRunOptions {
  appId: string;
  numaGet: NumaGet;
  numaPost: NumaPost;
  numaDelete: NumaDelete;
  /** Polling interval in ms (default: 4000) */
  pollInterval?: number;
}

function getUserSubFromToken(): string | undefined {
  const idToken = localStorage.getItem('idToken');
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.sub;
  } catch {
    return undefined;
  }
}

function getUserEmailFromToken(): string | undefined {
  const idToken = localStorage.getItem('idToken');
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.email;
  } catch {
    return undefined;
  }
}

export function useV2AppRun({ appId, numaGet, numaPost, numaDelete, pollInterval = 4000 }: UseV2AppRunOptions) {
  const [state, setState] = useState<V2AppRunState>('idle');
  const [currentRun, setCurrentRun] = useState<RunRecord | null>(null);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Load run history
  const loadHistory = useCallback(async () => {
    try {
      const response = await v2AppsService.listRuns(numaGet, { appId, limit: 20 });
      if (mountedRef.current) setRunHistory(response.runs);
    } catch (err) {
      console.error('[useV2AppRun] Failed to load history:', err);
    }
  }, [numaGet, appId]);

  // Stop polling
  const cancelPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Start polling for a run
  const pollRun = useCallback(
    (runId: string) => {
      cancelPolling();
      pollingRef.current = setInterval(async () => {
        try {
          const run = await v2AppsService.getRun(numaGet, runId);
          if (!mountedRef.current) return;

          setCurrentRun(run);

          if (run.status === 'COMPLETED') {
            cancelPolling();
            setState('completed');
            loadHistory();
          } else if (run.status === 'FAILED') {
            cancelPolling();
            setState('error');
            setError(run.error || 'Run failed');
            loadHistory();
          }
        } catch (err) {
          console.error('[useV2AppRun] Poll error:', err);
        }
      }, pollInterval);
    },
    [numaGet, cancelPolling, pollInterval, loadHistory]
  );

  // Upload a file via presigned URL from the API
  const uploadFile = useCallback(
    async (file: File, runId: string): Promise<string> => {
      const userSub = getUserSubFromToken();
      if (!userSub) throw new Error('Missing user sub for upload');

      const s3Key = `v2-apps/${appId}/${userSub}/${runId}/uploads/${file.name}`;
      const contentType = file.type || 'application/octet-stream';
      const { url } = await v2AppsService.getUploadUrl(numaPost, s3Key, contentType);

      const { default: axios } = await import('axios');
      await axios.put(url, file, {
        headers: { 'Content-Type': contentType },
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || file.size || 1;
          const progress = Math.round((progressEvent.loaded * 100) / total);
          setUploadProgress(progress);
        },
      });

      return file.name;
    },
    [appId, numaPost]
  );

  // Main entry: upload files, create run, start, poll
  const startAnalysis = useCallback(
    async (prompt: string, files: File[], config?: RunConfiguration, runName?: string) => {
      setError(null);
      setState('uploading');
      setUploadProgress(0);

      try {
        // Generate a run ID (the API creates it, but we need it for S3 paths first)
        const runId = crypto.randomUUID();

        // Upload files to S3
        const uploadedFiles: string[] = [];
        for (const file of files) {
          const name = await uploadFile(file, runId);
          uploadedFiles.push(name);
        }

        if (!mountedRef.current) return;
        setState('processing');

        // Create run record (pass the same runId used for uploads so S3 paths match)
        const run = await v2AppsService.createRun(numaPost, appId, {
          runId,
          prompt,
          files: uploadedFiles,
          name: runName || undefined,
          userEmail: getUserEmailFromToken(),
          options: config
            ? {
                agentId: config.agentId,
                enabledKBIds: config.enabledKBIds,
                enabledKBs: config.enabledKBs,
                enabledTools: config.enabledTools,
                enabledConnections: config.enabledConnections,
                workspaceAccess: config.workspaceAccess,
                contextInstructions: config.contextInstructions,
              }
            : undefined,
        });

        if (!mountedRef.current) return;
        setCurrentRun(run);

        // Start the run (invokes workspace agent)
        const startedRun = await v2AppsService.startRun(numaPost, run.runId);
        if (!mountedRef.current) return;
        setCurrentRun(startedRun);

        // Add the run to history optimistically so it appears in the sidebar immediately
        setRunHistory((prev) => [
          { ...run, status: 'PROCESSING' as const, updatedAt: new Date().toISOString() },
          ...prev,
        ]);

        // Begin polling
        pollRun(startedRun.runId);

        // Also refresh history from the API for data consistency
        loadHistory();
      } catch (err) {
        if (!mountedRef.current) return;
        setState('error');
        setError(err instanceof Error ? err.message : 'Failed to start analysis');
        console.error('[useV2AppRun] startAnalysis error:', err);
      }
    },
    [appId, numaPost, uploadFile, pollRun]
  );

  // View a past run
  const viewRun = useCallback(
    async (runId: string) => {
      cancelPolling();
      setError(null);

      try {
        const run = await v2AppsService.getRun(numaGet, runId);
        if (!mountedRef.current) return;
        setCurrentRun(run);

        if (run.status === 'COMPLETED' || run.status === 'FAILED') {
          setState(run.status === 'COMPLETED' ? 'completed' : 'error');
          if (run.status === 'FAILED') setError(run.error || 'Run failed');
        } else if (run.status === 'PROCESSING') {
          setState('processing');
          pollRun(runId);
        } else {
          setState('idle');
        }
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'Failed to load run');
      }
    },
    [numaGet, cancelPolling, pollRun]
  );

  // Delete a run
  const removeRun = useCallback(
    async (runId: string) => {
      try {
        await v2AppsService.deleteRun(numaDelete, runId);
        if (mountedRef.current) {
          setRunHistory((prev) => prev.filter((r) => r.runId !== runId));
          if (currentRun?.runId === runId) {
            setCurrentRun(null);
            setState('idle');
          }
        }
      } catch (err) {
        console.error('[useV2AppRun] deleteRun error:', err);
      }
    },
    [numaDelete, currentRun]
  );

  // Follow up on a completed run (optionally with file uploads).
  // Returns the new RunRecord so callers can immediately react to it.
  const startFollowUp = useCallback(
    async (parentRunId: string, prompt: string, files: File[] = []): Promise<RunRecord | undefined> => {
      setError(null);

      try {
        const runId = crypto.randomUUID();

        // For follow-up uploads, use the parent's conversationId as the S3 path key
        // so files land in the same workspace the agent syncs from.
        // (For original runs, conversationId === runId, so this is only relevant for follow-ups.)
        const parentRun = runHistory.find((r) => r.runId === parentRunId);
        const uploadPathId = parentRun?.conversationId || parentRunId;

        // Upload files if provided
        if (files.length > 0) {
          setState('uploading');
          setUploadProgress(0);
          for (const file of files) {
            await uploadFile(file, uploadPathId);
          }
          if (!mountedRef.current) return;
        }

        setState('processing');

        const uploadedFileNames = files.map((f) => f.name);
        const run = await v2AppsService.followUpRun(
          numaPost,
          parentRunId,
          prompt,
          uploadedFileNames.length > 0 ? uploadedFileNames : undefined,
          runId
        );
        if (!mountedRef.current) return;

        setCurrentRun(run);

        // Add to history optimistically
        setRunHistory((prev) => [run, ...prev]);

        // Begin polling
        pollRun(run.runId);
        loadHistory();

        return run;
      } catch (err) {
        if (!mountedRef.current) return;
        setState('error');
        setError(err instanceof Error ? err.message : 'Failed to start follow-up');
        console.error('[useV2AppRun] startFollowUp error:', err);
      }
    },
    [numaPost, uploadFile, pollRun, loadHistory, runHistory]
  );

  // Reset to idle
  const reset = useCallback(() => {
    cancelPolling();
    setCurrentRun(null);
    setState('idle');
    setError(null);
    setUploadProgress(0);
  }, [cancelPolling]);

  return {
    state,
    currentRun,
    runHistory,
    error,
    uploadProgress,
    startAnalysis,
    startFollowUp,
    viewRun,
    removeRun,
    loadHistory,
    cancelPolling,
    reset,
  };
}
