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
import { TranscriptionService } from './TranscriptionService';
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

/** Callback for receiving SDK events during streaming */
export type OnWorkspaceChatEvent = (event: SDKEvent) => void;

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
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const idToken = localStorage.getItem('idToken');
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
 * Stream a chat message to the workspace chat agent.
 *
 * Uses the AgentCore /invocations endpoint with action='chat'.
 *
 * @param request - Chat request with prompt and optional conversationId
 * @param onEvent - Callback for each NDJSON event from Claude Agent SDK
 * @param onComplete - Callback when stream completes
 * @param onError - Callback for errors
 * @param onSessionEvent - Optional callback for AgentCore session events (cold start, conversation switch)
 * @returns Abort function to cancel the stream
 */
export async function streamWorkspaceChatAgent(
  request: WorkspaceChatRequest,
  onEvent: OnWorkspaceChatEvent,
  onComplete: OnWorkspaceChatComplete,
  onError: OnWorkspaceChatError,
  onSessionEvent?: OnSessionEvent
): Promise<{ abort: () => void; requestId: string }> {
  const abortController = new AbortController();
  const requestId =
    request.requestId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random()}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
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
    enabledTools: request.enabledTools,
    enabledConnections: request.enabledConnections,
    // Feature flags for conditional tool registration in the workspace agent
    featureFlags: {
      NUMA_FILES: sessionStorage.getItem('NUMA_FILES') === 'true',
      OAUTH_INTEGRATIONS_ENABLED: sessionStorage.getItem('OAUTH_AVAILABLE') === 'true',
      SECRETS_VAULT_ENABLED: sessionStorage.getItem('SECRETS_VAULT_ENABLED') === 'true',
    },
    // Model selection (global cross-region inference profile)
    modelId: request.modelId,
    // File attachments for workspace uploads
    attachments: request.attachments,
    hasUploads: request.hasUploads,
    expectedUploadPaths: request.expectedUploadPaths,
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

  return { abort: () => abortController.abort(), requestId };
}

/**
 * Stop an in-flight workspace chat run.
 *
 * Uses AgentCore /invocations with action='stop'.
 */
export async function stopWorkspaceChatAgent(conversationId: string, requestId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
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
  conversationId: string
): Promise<void> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      action: 'approve',
      approvalId,
      decision,
      conversationId,
    }),
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
  conversationId: string
): Promise<WorkspaceChatConversationDetailResponse> {
  const res = await fetch(`${getApiUrl()}/history/${encodeURIComponent(conversationId)}`, {
    headers: getAuthHeaders(),
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
export async function getWorkspaceChatRawTrace(conversationId: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const res = await fetch(`${getApiUrl()}/trace/${encodeURIComponent(conversationId)}`, {
      headers: getAuthHeaders(),
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
  relativePath?: string
): Promise<WorkspaceChatUploadResponse> {
  // Convert file to base64
  const arrayBuffer = await file.arrayBuffer();
  const base64Content = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
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
  paths: string[]
): Promise<{ deleted: string[]; errors: Array<{ path: string; error: string }> }> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
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
export async function listWorkspaceChatFiles(): Promise<WorkspaceChatFilesResponse> {
  const res = await fetch(`${getApiUrl()}/files`, {
    headers: getAuthHeaders(),
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
export async function listConversationFiles(conversationId: string): Promise<WorkspaceChatFilesResponse> {
  const res = await fetch(`${getApiUrl()}/files/${encodeURIComponent(conversationId)}`, {
    headers: getAuthHeaders(),
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
export async function cleanupConversationSession(conversationId: string): Promise<WorkspaceChatCleanupResponse> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
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
export async function isWorkspaceChatAgentAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiUrl()}/ping`, {
      headers: getAuthHeaders(),
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
  size: number
): Promise<WorkspaceChatUploadResponse> {
  const res = await fetch(`${getApiUrl()}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
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
  getCredentials: () => Promise<AwsCredentialIdentity>
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
  return notifyUploadComplete(conversationId, filename, s3Key, file.size);
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
  getCredentials: () => Promise<AwsCredentialIdentity>,
  numaPost?: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>
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

    // Submit to transcription service (fire-and-forget)
    if (numaPost) {
      const outputsBucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || '';
      TranscriptionService.submit(filename, s3Key, numaPost, outputsBucket || undefined).catch((err) =>
        console.warn('[WorkspaceChat] Chat save pre-transcription failed:', err)
      );
    }
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
  request: WorkspaceChatRequest
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
    enabledTools: request.enabledTools,
    enabledConnections: request.enabledConnections,
    featureFlags: {
      NUMA_FILES: sessionStorage.getItem('NUMA_FILES') === 'true',
      OAUTH_INTEGRATIONS_ENABLED: sessionStorage.getItem('OAUTH_AVAILABLE') === 'true',
      SECRETS_VAULT_ENABLED: sessionStorage.getItem('SECRETS_VAULT_ENABLED') === 'true',
    },
    modelId: request.modelId,
    attachments: request.attachments,
    hasUploads: request.hasUploads,
    expectedUploadPaths: request.expectedUploadPaths,
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
      ...getAuthHeaders(),
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
  timeoutMs = 300_000
): Promise<import('../types/workspaceChatTypes').WorkspaceSyncResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${getApiUrl()}/runs/${encodeURIComponent(runId)}/status`, {
      headers: getAuthHeaders(),
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
 * List available agent types from the backend registry.
 *
 * Returns metadata about all registered agent types (type_id,
 * display_name, response_mode).
 */
export async function listWorkspaceAgentTypes(): Promise<
  import('../types/workspaceChatTypes').WorkspaceAgentTypeInfo[]
> {
  const res = await fetch(`${getApiUrl()}/types`, {
    headers: getAuthHeaders(),
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
  format: string = 'pdf'
): Promise<{ url: string; filename: string; size: number }> {
  const res = await fetch(`${getApiUrl()}/convert-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ bucket, key, format }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Document conversion failed: ${errorText}`);
  }

  return res.json();
}
