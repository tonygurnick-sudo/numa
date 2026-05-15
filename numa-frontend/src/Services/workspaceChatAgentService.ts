/**
 * Service for interacting with the Numa Workspace Chat Agent via HTTP streaming
 *
 * The workspace chat agent uses Claude Agent SDK format events.
 * With AgentCore, we use the /invocations endpoint and dispatch by action field.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import axios from 'axios';
import { sanitizeS3Filename } from '../utils/sanitizeFilename';
import type {
  SDKEvent,
  WorkspaceChatRequest,
  WorkspaceChatConversationDetailResponse,
  WorkspaceChatUploadResponse,
  WorkspaceChatFilesResponse,
  WorkspaceChatCleanupResponse,
  OnWorkspaceChatComplete,
  OnWorkspaceChatError,
  SessionInitEvent,
  ConversationSwitchEvent,
  AssistantAdviceEvent,
} from '../types/workspaceChatTypes';
import { withPRM } from '../utils/prmUtils';

/** Async function that returns a fresh ID token, auto-refreshing if expired */
export type GetIdToken = () => Promise<string | null>;

/** Callback for receiving SDK events during streaming */
export type OnWorkspaceChatEvent = (event: SDKEvent) => void;

/** Callback for retry attempts during streaming */
export type OnRetryAttempt = (attempt: number, maxAttempts: number, error: Error) => void;

/** Configuration for retry behavior */
export interface StreamRetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Callback invoked before each retry attempt */
  onRetry?: OnRetryAttempt;
}

const DEFAULT_RETRY_CONFIG: Required<Omit<StreamRetryConfig, 'onRetry'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
};

/**
 * Determine if an error is retryable (network-level failure vs application error).
 *
 * Retryable: network failures (TypeError from fetch), 5xx server errors, connection resets.
 * Not retryable: 4xx client errors, AbortError (user cancelled), auth failures.
 */
export function isRetryableError(error: unknown, statusCode?: number): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false;

  // 4xx = client error, don't retry (includes 401/403 auth)
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) return false;

  // 5xx = server error, retry
  if (statusCode !== undefined && statusCode >= 500) return true;

  // Network-level failures (no response received)
  if (error instanceof TypeError) return true;

  // Check error message for network indicators
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('err_connection') ||
      msg.includes('err_internet') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('timeout')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extract HTTP status code from an error message if present.
 * Matches patterns like "error (500):" or "failed (503):"
 */
function extractStatusCode(error: Error): number | undefined {
  const match = error.message.match(/\((\d{3})\)/);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const API_BASE = '/api/workspace-chat-agent';

/**
 * Get the direct Lambda Function URL for workspace chat agent.
 * This bypasses CloudFront to avoid response buffering issues.
 */
function getDirectLambdaUrl(): string | null {
  return sessionStorage.getItem('WORKSPACE_CHAT_AGENT_FUNCTION_URL');
}

/**
 * Get URL for streaming endpoints (invocations).
 * Uses direct Lambda URL if available to bypass CloudFront buffering.
 * Falls back to CloudFront path if not configured.
 */
function getStreamingUrl(): string {
  const directUrl = getDirectLambdaUrl();
  if (directUrl) {
    const baseUrl = directUrl.replace(/\/$/, '');
    return baseUrl + '/api/workspace-chat-agent';
  }
  return API_BASE;
}

/**
 * Get URL for non-streaming endpoints (status, history, files, trace).
 * Always uses CloudFront path for caching and standard routing.
 */
function getApiUrl(): string {
  return API_BASE;
}

/**
 * Get auth headers for API requests.
 * AgentCore session routing is now handled by the proxy based on conversationId.
 *
 * When a getIdToken callback is provided (from AuthProvider), it checks token
 * expiry and auto-refreshes before returning -- preventing 403s after laptop
 * sleep or backgrounded tabs where the refresh timer was suspended.
 */
async function getAuthHeaders(getIdToken?: GetIdToken): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const idToken = getIdToken ? await getIdToken() : localStorage.getItem('idToken');
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

/**
 * Get the user sub from the stored ID token
 */
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

/**
 * Get the user email from the stored ID token
 */
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

/**
 * Generate TODAY string matching the format in chatSystemPromptUtils.ts
 * Format: "Local date: Monday, 12/9/2024, Local time: 10:30:00 AM (America/New_York)"
 */
function generateTodayString(): string {
  const NOW = new Date();
  const date = NOW.toLocaleDateString();
  const time = NOW.toLocaleTimeString();
  const dayOfWeek = NOW.toLocaleDateString(undefined, { weekday: 'long' });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Local date: ${dayOfWeek}, ${date}, Local time: ${time} (${timezone})`;
}

/** Callback for AgentCore session events (cold start, conversation switch, assistant advice) */
export type OnSessionEvent = (event: SessionInitEvent | ConversationSwitchEvent | AssistantAdviceEvent) => void;

/**
 * Execute a single streaming attempt (no retry logic).
 * This is the core fetch + SSE parsing extracted for use by the retry wrapper.
 */
async function streamWorkspaceChatAttempt(
  request: WorkspaceChatRequest,
  requestId: string,
  onEvent: OnWorkspaceChatEvent,
  onComplete: OnWorkspaceChatComplete,
  onError: OnWorkspaceChatError,
  onSessionEvent?: OnSessionEvent,
  getIdToken?: GetIdToken
): Promise<{ abort: () => void }> {
  const abortController = new AbortController();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await getAuthHeaders(getIdToken)),
  };

  // AgentCore invocations payload with action='chat'
  const invocationPayload = {
    action: 'chat',
    prompt: request.prompt,
    conversationId: request.conversationId,
    timezone: request.timezone,
    userEmail: request.userEmail || getUserEmailFromToken(),
    todayString: request.todayString || generateTodayString(),
    // Parity with ChatAgentRequest
    availableKBs: request.availableKBs,
    accessibleKBs: request.accessibleKBs,
    enabledTools: request.enabledTools,
    enabledConnections: request.enabledConnections,
    availableIntegrations: request.availableIntegrations,
    connectedDataConnectors: request.connectedDataConnectors,
    // Feature flags for conditional tool registration in the workspace agent
    featureFlags: {
      OAUTH_INTEGRATIONS_ENABLED: sessionStorage.getItem('OAUTH_AVAILABLE') === 'true',
      SECRETS_VAULT_ENABLED: sessionStorage.getItem('SECRETS_VAULT_ENABLED') === 'true',
      // Data connectors toggle — when false, the connectors MCP server is NOT registered
      DATA_CONNECTORS_CHAT_ENABLED: request.dataConnectorsEnabled ?? false,
    },
    // Model selection (global cross-region inference profile)
    modelId: request.modelId,
    // File attachments for workspace uploads
    attachments: request.attachments,
    hasUploads: request.hasUploads,
    expectedUploadPaths: request.expectedUploadPaths,
    voiceRecordings: request.voiceRecordings,
    requestId,
    // V1 to V2 migration flag
    migrateFromV1: request.migrateFromV1 || false,
    // Agent support - ID of agent for custom prompts/restrictions
    agentId: request.agentId,
    // Agent type system — selects registered type config (default: "numa-chat")
    type: request.type,
    // Response mode override — "stream", "sync", or "fire-and-forget"
    responseMode: request.responseMode,
  };

  try {
    const streamingUrl = getStreamingUrl();
    const res = await fetch(`${streamingUrl}/invocations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(invocationPayload),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new Error(`Workspace chat agent error (${res.status}): ${errorText}`);
    }

    if (!res.body) {
      throw new Error('No response body from workspace chat agent');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Track whether the stream ended with a proper completion marker
    // (ResultMessage, completion event, or error event from the agent).
    let receivedCompletion = false;

    // Async streaming pump - parses SSE format (text/event-stream)
    // SSE format: lines starting with "data: " contain JSON, lines starting with ":" are comments (heartbeats)
    // Events are separated by double newlines (\n\n)
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process SSE events (separated by double newlines)
          let eventEndIndex: number;
          while ((eventEndIndex = buffer.indexOf('\n\n')) >= 0) {
            const eventBlock = buffer.slice(0, eventEndIndex);
            buffer = buffer.slice(eventEndIndex + 2); // Skip past \n\n

            // Process each line in the event block
            for (const line of eventBlock.split('\n')) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              // SSE comment (heartbeat) - starts with ':'
              if (trimmedLine.startsWith(':')) {
                continue;
              }

              // SSE data line - starts with 'data: '
              if (trimmedLine.startsWith('data: ')) {
                const jsonStr = trimmedLine.slice(6); // Remove 'data: ' prefix
                try {
                  const event = JSON.parse(jsonStr);

                  // Track completion markers from the agent
                  if (event.type === 'result' || event.type === 'completion' || event.type === 'error') {
                    receivedCompletion = true;
                  }

                  // Check for AgentCore session events first (including assistant advice)
                  if (
                    event.type === 'session_init' ||
                    event.type === 'conversation_switch' ||
                    event.type === 'assistant_advice'
                  ) {
                    onSessionEvent?.(event as SessionInitEvent | ConversationSwitchEvent | AssistantAdviceEvent);
                  } else {
                    onEvent(event as SDKEvent);
                  }
                } catch {
                  console.warn('Invalid SSE data from workspace chat agent:', jsonStr.slice(0, 100));
                }
              }
            }
          }
        }

        // Flush any trailing content
        if (buffer.trim()) {
          for (const line of buffer.split('\n')) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            // SSE comment - ignore
            if (trimmedLine.startsWith(':')) continue;

            // SSE data line
            if (trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.slice(6);
              try {
                const event = JSON.parse(jsonStr);

                if (event.type === 'result' || event.type === 'completion' || event.type === 'error') {
                  receivedCompletion = true;
                }

                if (
                  event.type === 'session_init' ||
                  event.type === 'conversation_switch' ||
                  event.type === 'assistant_advice'
                ) {
                  onSessionEvent?.(event as SessionInitEvent | ConversationSwitchEvent | AssistantAdviceEvent);
                } else {
                  onEvent(event as SDKEvent);
                }
              } catch {
                // Ignore trailing parse errors
              }
            }
          }
        }

        onComplete({ receivedCompletion });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          onError(err as Error);
        }
      }
    })();
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      onError(err as Error);
    }
  }

  return { abort: () => abortController.abort() };
}

/**
 * Stream a chat message to the workspace chat agent with automatic retry.
 *
 * Uses the AgentCore /invocations endpoint with action='chat'.
 * On retryable errors (network failures, 5xx), retries with exponential backoff.
 * Non-retryable errors (4xx, abort) are passed to onError immediately.
 *
 * @param request - Chat request with prompt and optional conversationId
 * @param onEvent - Callback for each NDJSON event from Claude Agent SDK
 * @param onComplete - Callback when stream completes
 * @param onError - Callback for errors (after all retries exhausted)
 * @param onSessionEvent - Optional callback for AgentCore session events
 * @param retryConfig - Optional retry configuration
 * @returns Abort function to cancel the stream
 */
export async function streamWorkspaceChatAgent(
  request: WorkspaceChatRequest,
  onEvent: OnWorkspaceChatEvent,
  onComplete: OnWorkspaceChatComplete,
  onError: OnWorkspaceChatError,
  onSessionEvent?: OnSessionEvent,
  retryConfig?: StreamRetryConfig,
  getIdToken?: GetIdToken
): Promise<{ abort: () => void; requestId: string }> {
  const maxAttempts = retryConfig?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts;
  const baseDelayMs = retryConfig?.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs;

  const requestId =
    request.requestId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random()}`);

  let currentAbort: (() => void) | null = null;
  let cancelled = false;

  const abort = () => {
    cancelled = true;
    currentAbort?.();
  };

  // Attempt loop — try up to maxAttempts times with exponential backoff
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (cancelled) break;

    try {
      await new Promise<{ abort: () => void; success: boolean }>((resolve, reject) => {
        streamWorkspaceChatAttempt(
          request,
          requestId,
          onEvent,
          // Wrap onComplete to resolve the promise
          (info) => {
            resolve({ abort: () => {}, success: true });
            onComplete(info);
          },
          // Wrap onError to decide retry vs reject
          (err) => {
            reject(err);
          },
          onSessionEvent,
          getIdToken
        ).then(({ abort: attemptAbort }) => {
          currentAbort = attemptAbort;
        });
      });

      // Stream completed successfully — no need to retry
      return { abort, requestId };
    } catch (err) {
      const error = err as Error;

      // Don't retry if user cancelled
      if (error.name === 'AbortError' || cancelled) {
        return { abort, requestId };
      }

      const statusCode = extractStatusCode(error);

      // Auth errors (401/403): refresh token and allow one retry
      if ((statusCode === 401 || statusCode === 403) && getIdToken && attempt === 1) {
        console.warn('[WorkspaceChat] Auth error, refreshing token and retrying once');
        await getIdToken(); // Force token refresh
        continue;
      }

      // Don't retry non-retryable errors
      if (!isRetryableError(error, statusCode)) {
        onError(error);
        return { abort, requestId };
      }

      // Last attempt — give up
      if (attempt >= maxAttempts) {
        onError(error);
        return { abort, requestId };
      }

      // Notify caller about retry attempt
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.warn(
        `[WorkspaceChat] Retryable error on attempt ${attempt}/${maxAttempts}, retrying in ${delayMs}ms:`,
        error.message
      );
      retryConfig?.onRetry?.(attempt, maxAttempts, error);

      // Wait with exponential backoff before retrying
      await sleep(delayMs);
    }
  }

  return { abort, requestId };
}

/**
 * Stop an in-flight workspace chat run.
 *
 * Uses AgentCore /invocations with action='stop'.
 */
export async function stopWorkspaceChatAgent(
  conversationId: string,
  requestId: string,
  getIdToken?: GetIdToken
): Promise<void> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(getIdToken)),
    },
    body: JSON.stringify({
      action: 'stop',
      conversationId,
      requestId,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Stop request failed (${res.status}): ${errorText}`);
  }
}

/**
 * Approve or deny an integration tool action.
 * Called when the user clicks Approve/Deny on a tool-approval card.
 */
export async function approveToolAction(
  approvalId: string,
  decision: 'approved' | 'denied',
  conversationId: string,
  reason?: string,
  getIdToken?: GetIdToken
): Promise<void> {
  const body: Record<string, string> = {
    action: 'approve',
    approvalId,
    decision,
    conversationId,
  };
  if (reason) {
    body.reason = reason;
  }

  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(getIdToken)),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Approval request failed (${res.status}): ${errorText}`);
  }
}

/**
 * Get conversation history by fetching and parsing the trace from S3.
 *
 * This is a lightweight GET endpoint that reads directly from S3
 * without triggering workspace sync or starting a session.
 */
export async function getWorkspaceChatConversation(
  conversationId: string,
  getIdToken?: GetIdToken
): Promise<WorkspaceChatConversationDetailResponse> {
  const res = await fetch(`${getApiUrl()}/history/${encodeURIComponent(conversationId)}`, {
    headers: await getAuthHeaders(getIdToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to get conversation: ${res.status}`);
  }

  return res.json();
}

/**
 * Get filtered trace content for a conversation.
 *
 * Returns NDJSON with thinking blocks and assistant_advice stripped by the proxy.
 * Used for loading conversation history with the frontend's rich trace parser.
 *
 * Includes a 30-second timeout to prevent infinite loading if AgentCore is slow or hung.
 */
export async function getWorkspaceChatRawTrace(conversationId: string, getIdToken?: GetIdToken): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const res = await fetch(`${getApiUrl()}/trace/${encodeURIComponent(conversationId)}`, {
      headers: await getAuthHeaders(getIdToken),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Failed to get trace: ${res.status}`);
    }

    return res.text();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Unable to load conversation history. The request took too long - please try again.');
    }
    throw err;
  }
}

/**
 * Normalize a filename by replacing unicode space characters with regular ASCII spaces.
 *
 * macOS uses non-breaking spaces (U+00A0) in screenshot filenames like
 * "Screenshot 2026-01-14 at 7.43.42 am.png" which causes phantom file issues
 * where Glob can find files but Read/cp fail because the space characters differ.
 *
 * @param name - The filename to normalize
 * @returns Normalized filename with unicode spaces replaced
 */
function normalizeFilename(name: string): string {
  return sanitizeS3Filename(name);
}

/**
 * Upload a file to a conversation's uploads directory
 *
 * Uses AgentCore /invocations with action='upload' and base64 file content.
 *
 * @param file - The file to upload
 * @param conversationId - The conversation ID
 * @param relativePath - Optional relative path for folder uploads (e.g., "folder/subfolder/file.txt")
 */
export async function uploadWorkspaceChatFile(
  file: File,
  conversationId: string,
  relativePath?: string,
  getIdToken?: GetIdToken
): Promise<WorkspaceChatUploadResponse> {
  // Convert file to base64
  const arrayBuffer = await file.arrayBuffer();
  const base64Content = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await getAuthHeaders(getIdToken)),
  };

  // Use relativePath if provided (for folder uploads), otherwise just filename
  // Normalize to replace unicode spaces (e.g., macOS non-breaking spaces) with regular spaces
  const filename = relativePath ? normalizeFilename(relativePath) : normalizeFilename(file.name);

  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'upload',
      conversationId,
      filename,
      fileContent: base64Content,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Upload failed (${res.status}): ${errorText}`);
  }

  return res.json();
}

/**
 * Delete uploaded files from workspace
 *
 * Uses AgentCore /invocations with action='delete_uploads'.
 * Deletes from both local EFS and S3.
 *
 * @param conversationId - The conversation ID
 * @param paths - Array of relative paths within uploads/ (e.g., ["folder/file.pdf", "doc.txt"])
 */
export async function deleteWorkspaceChatUploads(
  conversationId: string,
  paths: string[],
  getIdToken?: GetIdToken
): Promise<{ deleted: string[]; errors: Array<{ path: string; error: string }> }> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(getIdToken)),
    },
    body: JSON.stringify({
      action: 'delete_uploads',
      conversationId,
      paths,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Delete failed (${res.status}): ${errorText}`);
  }

  return res.json();
}

/**
 * List files in user's persistent workspace directory
 *
 * This is a lightweight GET endpoint that reads directly from S3
 * without triggering workspace sync or starting a session.
 */
export async function listWorkspaceChatFiles(getIdToken?: GetIdToken): Promise<WorkspaceChatFilesResponse> {
  const res = await fetch(`${getApiUrl()}/files`, {
    headers: await getAuthHeaders(getIdToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to list workspace files: ${res.status}`);
  }

  return res.json();
}

/**
 * List files for a specific conversation (uploads + session folders)
 *
 * This endpoint lists files from the conversation's uploads/ and outputs/
 * directories in S3, used for the settings panel file listing.
 */
export async function listConversationFiles(
  conversationId: string,
  getIdToken?: GetIdToken
): Promise<WorkspaceChatFilesResponse> {
  const res = await fetch(`${getApiUrl()}/files/${encodeURIComponent(conversationId)}`, {
    headers: await getAuthHeaders(getIdToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to list conversation files: ${res.status}`);
  }

  return res.json();
}

/**
 * Clean up session files for a conversation
 *
 * Uses AgentCore /invocations with action='cleanup_session'.
 */
export async function cleanupConversationSession(
  conversationId: string,
  getIdToken?: GetIdToken
): Promise<WorkspaceChatCleanupResponse> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(getIdToken)),
    },
    body: JSON.stringify({
      action: 'cleanup_session',
      conversationId,
    }),
  });

  if (!res.ok) {
    throw new Error(`Cleanup failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Check if the workspace chat agent is available (basic connectivity check)
 *
 * Uses AgentCore /ping endpoint.
 */
export async function isWorkspaceChatAgentAvailable(getIdToken?: GetIdToken): Promise<boolean> {
  try {
    const res = await fetch(`${getApiUrl()}/ping`, {
      headers: await getAuthHeaders(getIdToken),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Notify backend that a file was uploaded directly to S3.
 *
 * Called after direct S3 upload completes. Backend syncs the file from S3 to local EFS.
 */
async function notifyUploadComplete(
  conversationId: string,
  filename: string,
  s3Key: string,
  size: number,
  getIdToken?: GetIdToken
): Promise<WorkspaceChatUploadResponse> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(getIdToken)),
    },
    body: JSON.stringify({
      action: 'upload_complete',
      conversationId,
      filename,
      s3Key,
      size,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Upload complete notification failed (${res.status}): ${errorText}`);
  }

  return res.json();
}

/**
 * Upload a file directly to S3, bypassing CloudFront.
 *
 * This method supports files up to 200MB by:
 * 1. Generating a presigned PUT URL for S3
 * 2. Uploading the file directly to S3 (bypasses 10MB CloudFront limit)
 * 3. Notifying the backend to sync the file from S3 to local EFS
 *
 * @param file - The file to upload
 * @param conversationId - The conversation ID
 * @param relativePath - Optional relative path for folder uploads (e.g., "folder/subfolder/file.txt")
 * @param onProgress - Callback for upload progress (0-100)
 * @param getCredentials - Function to get AWS credentials
 */
export async function uploadWorkspaceChatFileDirect(
  file: File,
  conversationId: string,
  relativePath: string | undefined,
  onProgress: (progress: number) => void,
  getCredentials: () => Promise<AwsCredentialIdentity>,
  getIdToken?: GetIdToken
): Promise<WorkspaceChatUploadResponse> {
  // Get config from session storage
  const region = sessionStorage.getItem('REGION');
  const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  const userSub = getUserSubFromToken();

  if (!region || !bucket) {
    throw new Error('Missing region or bucket configuration');
  }
  if (!userSub) {
    throw new Error('User not authenticated');
  }

  // Use relativePath if provided (for folder uploads), otherwise just filename
  // Normalize to replace unicode spaces (e.g., macOS non-breaking spaces) with regular spaces
  const filename = relativePath ? normalizeFilename(relativePath) : normalizeFilename(file.name);

  // Build S3 key (same path structure as existing upload)
  const s3Key = `numa-chat/workspace/${userSub}/conversations/${conversationId}/uploads/${filename}`;

  // Get credentials and create S3 client
  const credentials = await getCredentials();
  const s3Client = withPRM(S3Client, { region, credentials });

  // Generate presigned URL for PUT
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: file.type || 'application/octet-stream',
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  // Upload directly to S3 with real progress tracking
  await axios.put(presignedUrl, file, {
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    onUploadProgress: (progressEvent) => {
      const total = progressEvent.total || file.size || 1;
      const progress = Math.round((progressEvent.loaded * 100) / total);
      onProgress(progress);
    },
  });

  // Notify backend that upload is complete (backend syncs from S3 to EFS)
  return notifyUploadComplete(conversationId, filename, s3Key, file.size, getIdToken);
}

/**
 * Sanitize a document title for use as a filename.
 */
function sanitizeTitleForFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'document'
  );
}

/**
 * Save an inline document (generated by the agent) to the outputs/ folder in S3.
 *
 * Creates a .md file from the document content and uploads it directly to S3
 * using a presigned PUT URL. Fire-and-forget: errors are logged but do not throw.
 */
export async function saveInlineDocumentToS3(
  title: string,
  content: string,
  conversationId: string,
  getCredentials: () => Promise<AwsCredentialIdentity>
): Promise<void> {
  const region = sessionStorage.getItem('REGION');
  const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  const userSub = getUserSubFromToken();

  if (!region || !bucket || !userSub) {
    console.warn('[WorkspaceChat] Cannot save inline document: missing config');
    return;
  }

  const sanitized = sanitizeTitleForFilename(title);
  const filename = `${sanitized}-${Date.now()}.md`;
  const s3Key = `numa-chat/workspace/${userSub}/conversations/${conversationId}/outputs/${filename}`;

  try {
    const credentials = await getCredentials();
    const s3Client = withPRM(S3Client, { region, credentials });

    const blob = new Blob([content], { type: 'text/markdown' });
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: 'text/markdown',
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    await axios.put(presignedUrl, blob, {
      headers: { 'Content-Type': 'text/markdown' },
    });
  } catch (err) {
    console.error('[WorkspaceChat] Failed to save inline document to S3:', err);
  }
}

// ============================================================
// Agent Type System — sync invocation and polling
// ============================================================

/**
 * Invoke a workspace agent synchronously (non-streaming).
 *
 * Sends the request with responseMode="sync" and waits for the full JSON
 * response. Use this for agent types that return structured data (e.g.
 * document-summariser) rather than streamed chat output.
 */
export async function invokeWorkspaceAgentSync(
  request: WorkspaceChatRequest,
  getIdToken?: GetIdToken
): Promise<import('../types/workspaceChatTypes').WorkspaceSyncResponse> {
  const requestId =
    request.requestId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random()}`);

  const invocationPayload = {
    action: 'chat',
    prompt: request.prompt,
    conversationId: request.conversationId,
    timezone: request.timezone,
    userEmail: request.userEmail || getUserEmailFromToken(),
    todayString: request.todayString || generateTodayString(),
    availableKBs: request.availableKBs,
    accessibleKBs: request.accessibleKBs,
    enabledTools: request.enabledTools,
    enabledConnections: request.enabledConnections,
    availableIntegrations: request.availableIntegrations,
    connectedDataConnectors: request.connectedDataConnectors,
    featureFlags: {
      OAUTH_INTEGRATIONS_ENABLED: sessionStorage.getItem('OAUTH_AVAILABLE') === 'true',
      SECRETS_VAULT_ENABLED: sessionStorage.getItem('SECRETS_VAULT_ENABLED') === 'true',
      // Data connectors toggle — when false, the connectors MCP server is NOT registered
      DATA_CONNECTORS_CHAT_ENABLED: request.dataConnectorsEnabled ?? false,
    },
    modelId: request.modelId,
    attachments: request.attachments,
    hasUploads: request.hasUploads,
    expectedUploadPaths: request.expectedUploadPaths,
    voiceRecordings: request.voiceRecordings,
    requestId,
    migrateFromV1: false,
    agentId: request.agentId,
    type: request.type,
    responseMode: 'sync' as const,
  };

  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(getIdToken)),
    },
    body: JSON.stringify(invocationPayload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Sync invocation failed (${res.status}): ${errorText}`);
  }

  return res.json();
}

/**
 * Poll for a fire-and-forget run result.
 *
 * Calls GET /runs/{runId}/status repeatedly until the run completes
 * (or errors), or until the timeout is reached.
 *
 * @param runId - The run ID returned by the fire-and-forget invocation
 * @param intervalMs - Polling interval in milliseconds (default: 2000)
 * @param timeoutMs - Maximum time to poll in milliseconds (default: 300000 = 5 min)
 * @returns The completed run result
 */
export async function pollWorkspaceAgentRun(
  runId: string,
  intervalMs = 2000,
  timeoutMs = 300_000,
  getIdToken?: GetIdToken
): Promise<import('../types/workspaceChatTypes').WorkspaceSyncResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${getApiUrl()}/runs/${encodeURIComponent(runId)}/status`, {
      headers: await getAuthHeaders(getIdToken),
    });

    if (!res.ok) {
      throw new Error(`Polling failed (${res.status})`);
    }

    const data = await res.json();

    if (data.status !== 'running') {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Polling timed out after ${timeoutMs}ms`);
}

/**
 * Single status check for a conversation's agent run.
 * Returns the current status and whether an agent is actively processing.
 */
export async function checkConversationStatus(
  conversationId: string,
  getIdToken?: GetIdToken
): Promise<{ status: string; active?: boolean; run_id?: string }> {
  const res = await fetch(`${getApiUrl()}/runs/${encodeURIComponent(conversationId)}/status`, {
    headers: await getAuthHeaders(getIdToken),
  });
  if (!res.ok) {
    throw new Error(`Status check failed (${res.status})`);
  }
  return res.json();
}

/**
 * Poll a conversation's status until the agent is no longer actively processing.
 * Resolves when `active` is false or status is not 'running'.
 * Calls `onPoll` after each check so callers can react to intermediate states.
 */
export async function pollConversationUntilComplete(
  conversationId: string,
  opts?: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onPoll?: (data: { status: string; active?: boolean }) => void;
  },
  getIdToken?: GetIdToken
): Promise<{ status: string; active?: boolean }> {
  const intervalMs = opts?.intervalMs ?? 3000;
  const timeoutMs = opts?.timeoutMs ?? 3_600_000; // 1 h default — matches AgentCore idle limit
  const startTime = Date.now();
  // Tolerate transient status-call failures (e.g. brief 502 from API Gateway,
  // network blip). Only give up after several consecutive failures so a long
  // recovery isn't torn down by a single hiccup.
  const maxConsecutiveFailures = 5;
  let consecutiveFailures = 0;

  while (Date.now() - startTime < timeoutMs) {
    if (opts?.signal?.aborted) {
      throw new DOMException('Polling aborted', 'AbortError');
    }

    try {
      const data = await checkConversationStatus(conversationId, getIdToken);
      consecutiveFailures = 0;
      opts?.onPoll?.(data);

      // Agent is done: not running, or running without an active in-memory run
      if (data.status !== 'running' || !data.active) {
        return data;
      }
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        throw err;
      }
      console.warn(
        `[WorkspaceChat] Status poll failed (${consecutiveFailures}/${maxConsecutiveFailures}), retrying:`,
        err
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Polling timed out after ${timeoutMs}ms`);
}

/**
 * List available agent types from the backend registry.
 *
 * Returns metadata about all registered agent types (type_id,
 * display_name, response_mode).
 */
export async function listWorkspaceAgentTypes(
  getIdToken?: GetIdToken
): Promise<import('../types/workspaceChatTypes').WorkspaceAgentTypeInfo[]> {
  const res = await fetch(`${getApiUrl()}/types`, {
    headers: await getAuthHeaders(getIdToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to list agent types: ${res.status}`);
  }

  const data = await res.json();
  return data.types || [];
}

/**
 * Convert a document for preview (e.g. DOCX -> PDF) via server-side LibreOffice.
 *
 * Calls the proxy Lambda which invokes workspace-chat-tools -> document-converter.
 * Returns a presigned URL to the converted file (15min expiry).
 */
export async function convertDocxPreview(
  bucket: string,
  key: string,
  format: string = 'pdf',
  getIdToken?: GetIdToken
): Promise<{ url: string; filename: string; size: number }> {
  const res = await fetch(`${getApiUrl()}/convert-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(getIdToken)),
    },
    body: JSON.stringify({ bucket, key, format }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Document conversion failed: ${errorText}`);
  }

  return res.json();
}
