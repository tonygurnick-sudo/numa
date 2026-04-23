/**
 * Service for interacting with the public demo chat proxy via HTTP streaming.
 *
 * Stripped-down version of workspaceChatAgentService.ts -- no authentication,
 * no direct Lambda URL, no presigned URLs. Always routes through CloudFront.
 */

import type {
  SDKEvent,
  OnWorkspaceChatComplete,
  OnWorkspaceChatError,
  SessionInitEvent,
  ConversationSwitchEvent,
  AssistantAdviceEvent,
} from '../types/workspaceChatTypes';

/** Callback for receiving SDK events during streaming */
export type OnPublicDemoEvent = (event: SDKEvent) => void;

/** Callback for session-level events */
export type OnPublicDemoSessionEvent = (
  event: SessionInitEvent | ConversationSwitchEvent | AssistantAdviceEvent
) => void;

const API_BASE = '/api/public-demo';

/**
 * Stream a chat message to the public demo proxy.
 *
 * Same SSE parsing logic as the workspace chat service but with no authentication
 * headers. The proxy forces Haiku 4.5 and restricted tools server-side.
 */
export async function streamPublicDemoChat(
  request: {
    prompt: string;
    conversationId: string;
    timezone?: string;
    todayString?: string;
    attachments?: {
      files: Array<{ path: string; filename: string; size: number }>;
      folders?: Array<{ name: string; path: string; fileCount: number; totalSize: number }>;
    };
    voiceRecordings?: string[];
    requestId?: string;
  },
  onEvent: OnPublicDemoEvent,
  onComplete: OnWorkspaceChatComplete,
  onError: OnWorkspaceChatError,
  onSessionEvent?: OnPublicDemoSessionEvent
): Promise<{ abort: () => void; requestId: string }> {
  const abortController = new AbortController();

  const requestId =
    request.requestId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random()}`);

  const invocationPayload = {
    action: 'chat',
    prompt: request.prompt,
    conversationId: request.conversationId,
    timezone: request.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    todayString: request.todayString || _generateTodayString(),
    attachments: request.attachments,
    voiceRecordings: request.voiceRecordings,
    requestId,
  };

  try {
    const res = await fetch(`${API_BASE}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invocationPayload),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');

      // Special handling for 429 (daily limit / rate limit)
      if (res.status === 429) {
        try {
          const errorJson = JSON.parse(errorText);
          throw new Error(errorJson.error || 'Rate limit exceeded');
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error(errorText || 'Rate limit exceeded');
          }
          throw e;
        }
      }

      throw new Error(`Demo chat error (${res.status}): ${errorText}`);
    }

    if (!res.body) {
      throw new Error('No response body from demo chat proxy');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedCompletion = false;

    // Async streaming pump - parses SSE format
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let eventEndIndex: number;
          while ((eventEndIndex = buffer.indexOf('\n\n')) >= 0) {
            const eventBlock = buffer.slice(0, eventEndIndex);
            buffer = buffer.slice(eventEndIndex + 2);

            for (const line of eventBlock.split('\n')) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine.startsWith(':')) continue;

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
                  console.warn('Invalid SSE data from demo proxy:', jsonStr.slice(0, 100));
                }
              }
            }
          }
        }

        // Flush trailing buffer
        if (buffer.trim()) {
          for (const line of buffer.split('\n')) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith(':')) continue;

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
 * Upload a file to the demo conversation workspace.
 * Files are sent through the proxy (no presigned URLs since no auth).
 */
export async function uploadPublicDemoFile(conversationId: string, action: 'upload'): Promise<void> {
  // File uploads are handled as part of the chat invocation payload
  // (attachments in the request body). This is a placeholder for future
  // direct upload support if needed.
  console.warn('Direct file upload not yet implemented for public demo');
}

/**
 * List files in a public demo conversation's workspace.
 */
export async function getPublicDemoFiles(conversationId: string): Promise<{ files: unknown[] }> {
  try {
    const res = await fetch(`${API_BASE}/files/${conversationId}`);
    if (!res.ok) return { files: [] };
    return await res.json();
  } catch {
    return { files: [] };
  }
}

/** Temporary AWS credentials from the demo proxy */
export interface DemoCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
  region: string;
  bucket: string;
}

/**
 * Fetch temporary, scoped AWS credentials for S3 file access.
 * Returns credentials that only allow S3 GetObject on the public demo prefix.
 * Credentials expire in 15 minutes.
 */
export async function fetchDemoCredentials(): Promise<DemoCredentials | null> {
  try {
    const res = await fetch(`${API_BASE}/credentials`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    console.warn('Failed to fetch demo credentials');
    return null;
  }
}

/**
 * Convert a document for preview (e.g. DOCX -> PDF) via the public demo proxy.
 * Same interface as convertDocxPreview in workspaceChatAgentService but no auth.
 */
export async function convertDemoDocxPreview(
  bucket: string,
  key: string,
  format: string = 'pdf'
): Promise<{ url: string; filename: string; size: number }> {
  const res = await fetch(`${API_BASE}/convert-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, key, format }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Document conversion failed: ${errorText}`);
  }

  return res.json();
}

/**
 * Upload a file for the public demo.
 *
 * Same S3 direct upload as the regular chat, but notifies the demo proxy
 * instead of the authenticated workspace proxy.
 */
export async function uploadDemoFile(
  file: File,
  conversationId: string,
  relativePath: string | undefined,
  onProgress: (progress: number) => void,
  getCredentials: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>
): Promise<{ status: string; filename: string; path: string; s3Key: string; size: number }> {
  const region = sessionStorage.getItem('REGION');
  const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  const userSub = 'public-demo-user';

  if (!region || !bucket) {
    throw new Error('Missing region or bucket configuration');
  }

  const filename = relativePath || file.name;
  const s3Key = `numa-chat/workspace/${userSub}/conversations/${conversationId}/uploads/${filename}`;

  // Import S3 client dynamically to avoid bundling when not needed
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const credentials = await getCredentials();
  const s3Client = new S3Client({ region, credentials });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: file.type || 'application/octet-stream',
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  // Upload to S3 with progress tracking
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded * 100) / e.total));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });

  // Notify demo proxy (fire-and-forget -- the agent syncs from S3 on next invocation anyway)
  fetch(`${API_BASE}/upload-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, filename, s3Key, size: file.size }),
  }).catch(() => {
    /* ignore */
  });

  // Return the expected response shape immediately -- upload is already in S3
  return {
    status: 'success',
    filename,
    path: `/workdir/uploads/${filename}`,
    s3Key,
    size: file.size,
  };
}

/** Generate a TODAY string matching the workspace chat format */
function _generateTodayString(): string {
  const NOW = new Date();
  const date = NOW.toLocaleDateString();
  const time = NOW.toLocaleTimeString();
  const dayOfWeek = NOW.toLocaleDateString(undefined, { weekday: 'long' });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Local date: ${dayOfWeek}, ${date}, Local time: ${time} (${timezone})`;
}
