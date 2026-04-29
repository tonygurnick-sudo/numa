/**
 * Service for interacting with the Shared Document Q&A API.
 *
 * Provides functions to:
 * - Get share information (public)
 * - Stream chat responses (public)
 * - Create shares (authenticated)
 * - List shares (authenticated)
 * - Get activity feed (authenticated)
 * - Get analytics (authenticated, owner-only)
 */

export interface ShareInfo {
  uuid: string;
  s3_signed_url: string;
  expires_at?: string | null; // null = permanent
  client_name?: string;
  name?: string;
  status?: 'processing' | 'ready' | 'error';
  chat_status?: 'ready' | 'pending' | 'error';
  description?: string;
  enable_chat: boolean;
  allow_download: boolean;
  max_calls?: number | null; // null/undefined = unlimited
  call_count?: number;
  // Drop zone fields
  share_type?: 'document' | 'dropzone';
  instructions?: string;
  auth_mode?: 'none' | 'passcode' | 'email';
  enable_api?: boolean;
  folder_path?: string;
  upload_count?: number;
  max_file_size_mb?: number | null;
  total_quota_mb?: number | null;
  used_quota_mb?: number;
  allowed_extensions?: string[] | null;
  view_count?: number;
  allowed_ips?: string[] | null;
}

export interface SessionAnalytics {
  session_id: string;
  ip_address?: string;
  user_agent?: string;
  message_count: number;
  first_message_at?: number;
  last_message_at?: number;
  sentiment: string;
  summary: string;
  topics: string[];
}

export interface EngagementMetrics {
  engagement_score: number;
  interest_signals: string[];
  recommended_action: string;
}

export interface ShareAnalytics {
  uuid: string;
  sessions: SessionAnalytics[];
  overall: {
    total_sessions: number;
    total_messages: number;
    unique_visitors: number;
    overall_sentiment: string;
    overall_summary: string;
    view_count: number;
    avg_session_duration: number;
  };
  engagement?: EngagementMetrics;
}

interface ChatFrame {
  type: 'start' | 'chunk' | 'completion' | 'error';
  data?: string;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Custom error for document processing state.
 * Thrown when document extraction is still in progress.
 */
export class DocumentProcessingError extends Error {
  constructor(message = 'Document is still being processed') {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}

/**
 * Get or create a session ID for this share.
 * Stored in sessionStorage per-share.
 */
export const getSessionId = (shareUuid: string): string => {
  const key = `share_session_${shareUuid}`;
  let sessionId = sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
};

/**
 * Get the persisted call count for this share.
 * Returns the higher of local optimistic count or backend count.
 * Stored in sessionStorage per-share to persist across page refreshes.
 */
export const getPersistentCallCount = (shareUuid: string, backendCount = 0): number => {
  const key = `share_call_count_${shareUuid}`;
  const storedCount = sessionStorage.getItem(key);
  const localCount = storedCount ? parseInt(storedCount, 10) : 0;

  // Use the higher of local optimistic count or backend count
  // This handles cases where backend might lag behind local updates
  return Math.max(localCount, backendCount);
};

/**
 * Update the persisted call count for this share.
 * Stores the count in sessionStorage to survive page refreshes.
 */
export const setPersistentCallCount = (shareUuid: string, count: number): void => {
  const key = `share_call_count_${shareUuid}`;
  sessionStorage.setItem(key, count.toString());
};

/**
 * Increment the persisted call count for this share.
 * Returns the new count.
 */
export const incrementPersistentCallCount = (shareUuid: string): number => {
  const current = getPersistentCallCount(shareUuid);
  const newCount = current + 1;
  setPersistentCallCount(shareUuid, newCount);
  return newCount;
};

/**
 * Attempt to retrieve detailed error information for a failed share.
 * Tries multiple endpoints and methods to get specific error details.
 *
 * NOTE: The filesystem architecture uses the DATA bucket as the primary storage.
 * All user files should be saved to the data bucket, not the outputs bucket.
 * During filesystem migration, some files may still be in outputs bucket causing
 * "file not found" errors during extraction.
 */
export const getDetailedShareError = async (uuid: string): Promise<string | null> => {
  const methods = [
    // Method 1: Try chat endpoint to get extraction-specific errors
    async (): Promise<string | null> => {
      try {
        const response = await fetch(`/api/shared/${uuid}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            query: 'test',
            session_id: `error-check-${Date.now()}`,
          }),
        });

        if (response.status === 502) {
          const errorData = await response.json();
          return errorData.detail || errorData.error || null;
        } else if (response.status === 404) {
          return 'Document not found. The file may be in the wrong storage location during filesystem migration to the data bucket.';
        } else if (response.status === 400) {
          const errorData = await response.json();
          return errorData.detail || errorData.message || 'Invalid document format';
        } else if (!response.ok) {
          return `Processing service error (${response.status})`;
        }
        return null;
      } catch {
        return null;
      }
    },

    // Method 2: Try to get share info with error field
    async (): Promise<string | null> => {
      try {
        const response = await fetch(`/api/shared/${uuid}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'error' && (data.error_details || data.error_message || data.extraction_error)) {
            return data.error_details || data.error_message || data.extraction_error;
          }
        } else if (!response.ok) {
          const errorData = await response.json();
          return errorData.detail || errorData.error || errorData.message || null;
        }
        return null;
      } catch {
        return null;
      }
    },
  ];

  // Try each method in sequence until we get a meaningful error
  for (const [, method] of methods.entries()) {
    try {
      const error = await method();
      if (error && error.trim() && error !== 'Document processing failed') {
        return error;
      }
    } catch {
      continue;
    }
  }

  return null;
};

/**
 * Get share information by UUID.
 * This is a public endpoint - no authentication required.
 */
export const getShareInfo = async (uuid: string): Promise<ShareInfo> => {
  const response = await fetch(`/api/shared/${uuid}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  // HTTP 202 means document is still being processed
  if (response.status === 202) {
    const body = await response.json();
    throw new DocumentProcessingError(body.detail || 'Document is still being processed');
  }

  if (!response.ok) {
    // Try to get detailed error from response body
    let errorMessage = `${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.detail) {
        errorMessage = errorBody.detail;
      } else if (errorBody.error) {
        errorMessage = errorBody.error;
      } else if (errorBody.message) {
        errorMessage = errorBody.message;
      }
    } catch {
      // If JSON parsing fails, use the status text
    }
    throw new Error(errorMessage);
  }

  const shareInfo = await response.json();

  // Check if the share info itself contains error details
  if (shareInfo.status === 'error' && shareInfo.error_details) {
    throw new Error(shareInfo.error_details);
  }

  return shareInfo;
};

/**
 * Stream chat response for a shared document.
 * This is a public endpoint - no authentication required.
 *
 * @param uuid - The share UUID
 * @param query - The user's question
 * @param onChunk - Callback for each text chunk
 * @param onComplete - Callback when streaming completes
 * @param onError - Callback on error
 */
export const streamChat = async (
  uuid: string,
  query: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void
): Promise<void> => {
  try {
    // Get session ID for chat history tracking
    const sessionId = getSessionId(uuid);

    const response = await fetch(`/api/shared/${uuid}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({ query, session_id: sessionId }),
    });

    // HTTP 202 means document is still being processed
    if (response.status === 202) {
      const body = await response.json();
      throw new DocumentProcessingError(body.detail || 'Document is still being processed');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          processLine(buffer, onChunk, onError);
        }
        onComplete();
        break;
      }

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines (NDJSON format)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          processLine(line, onChunk, onError);
        }
      }
    }
  } catch (err) {
    // Re-throw DocumentProcessingError so callers can handle retry logic
    if (err instanceof DocumentProcessingError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    onError(message);
  }
};

/**
 * Process a single NDJSON line.
 */
const processLine = (line: string, onChunk: (chunk: string) => void, onError: (error: string) => void): void => {
  try {
    const frame: ChatFrame = JSON.parse(line);

    switch (frame.type) {
      case 'start':
        // Stream started - nothing to do
        break;
      case 'chunk':
        if (frame.data) {
          onChunk(frame.data);
        }
        break;
      case 'completion':
        // Completion is handled in the read loop
        break;
      case 'error':
        onError(frame.error || 'Unknown error');
        break;
    }
  } catch {
    // Ignore malformed lines
  }
};

export interface ShareListItem {
  uuid: string;
  name: string;
  description: string;
  status: string;
  created_at: number | null;
  expires_at?: string | null; // null = permanent
  call_count: number;
  view_count: number;
  enable_chat: boolean;
  allow_download: boolean;
  // Drop zone fields
  share_type?: 'document' | 'dropzone';
  upload_count?: number;
  total_quota_mb?: number | null;
  used_quota_mb?: number;
  folder_path?: string;
  auth_mode?: string;
  passcode?: string;
  max_calls?: number | null;
  allowed_ips?: string[] | null;
}

export interface ActivityItem {
  share_uuid: string;
  share_name: string;
  session_id: string;
  event_type: 'view' | 'message';
  message_preview: string;
  timestamp: number;
  ip_address?: string;
  user_agent?: string;
}

export interface CreateShareRequest {
  s3_signed_url: string;
  system_prompt: string;
  expiry_hours?: number; // undefined = permanent
  max_calls?: number;
  description?: string;
  enable_chat: boolean;
  allow_download: boolean;
  kb_id?: string; // Optional Knowledge Base ID for enhanced chat
  allowed_ips?: string[];
}

export interface CreateShareResponse {
  uuid: string;
  expires_at?: string | null; // null = permanent
  status: string;
}

/**
 * List all shares created by the authenticated user.
 * Returns shares sorted by creation date (newest first).
 */
export const listMyShares = async (): Promise<ShareListItem[]> => {
  const token = localStorage.getItem('idToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch('/api/shared/list', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.shares;
};

/**
 * Delete a share or drop zone (authenticated, owner-only).
 */
export const deleteShare = async (uuid: string): Promise<void> => {
  const token = localStorage.getItem('idToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch(`/api/shared/${uuid}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || body.error || `Delete failed: ${response.status}`);
  }
};

/**
 * Get analytics for a shared document.
 * This is an authenticated endpoint - only accessible to the share creator.
 *
 * @param uuid - The share UUID
 * @returns Analytics data including session breakdowns and overall summary
 */
export const getShareAnalytics = async (uuid: string): Promise<ShareAnalytics> => {
  // Get auth token from localStorage (same pattern as other services)
  const token = localStorage.getItem('idToken');

  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch(`/api/shared/${uuid}/analytics`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Not authorized to view analytics');
    }
    if (response.status === 404) {
      throw new Error('Share not found');
    }
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
};

/**
 * Create a new share for a document.
 * Authenticated endpoint — uses idToken with Bearer prefix.
 */
export const createShare = async (req: CreateShareRequest): Promise<CreateShareResponse> => {
  const token = localStorage.getItem('idToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch('/api/shared/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status}: ${errorText}`);
  }

  return response.json();
};

/**
 * Generate an AI description for a shared document (public endpoint).
 * Requires chat_status="ready" — document text must be available.
 */
export const generateDescription = async (uuid: string): Promise<string> => {
  const response = await fetch(`/api/shared/${uuid}/generate-description`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 202) {
    throw new DocumentProcessingError();
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.description;
};

/**
 * Get recent visitor activity across all of the user's shares.
 * Authenticated endpoint — only returns activity for shares owned by the caller.
 */
export const getActivity = async (limit = 50): Promise<ActivityItem[]> => {
  const token = localStorage.getItem('idToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch(`/api/shared/activity?limit=${limit}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.activity;
};

// ── Drop Zone API Functions ────────────────────────────────────────────────

export interface CreateDropZoneRequest {
  folder_path: string;
  s3_folder_prefix: string;
  instructions: string;
  auth_mode: 'none' | 'passcode' | 'email';
  passcode?: string;
  expiry_hours?: number;
  max_file_size_mb?: number;
  total_quota_mb?: number;
  allowed_extensions?: string[];
  enable_api: boolean;
  enable_chat: boolean;
  description?: string;
  max_calls?: number;
  kb_id?: string;
  allowed_ips?: string[];
}

export interface CreateDropZoneResponse {
  uuid: string;
  expires_at?: string | null;
  status: string;
  share_type: 'dropzone';
}

export interface DropZoneFile {
  file_id: string;
  name: string;
  size_bytes: number;
  uploaded_at: number;
}

export interface QuotaInfo {
  used_mb: number;
  total_mb: number | null;
}

/**
 * Create a new drop zone (authenticated).
 */
export const createDropZone = async (req: CreateDropZoneRequest): Promise<CreateDropZoneResponse> => {
  const token = localStorage.getItem('idToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch('/api/shared/create-dropzone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status}: ${errorText}`);
  }

  return response.json();
};

/**
 * Authenticate to a drop zone with a passcode.
 * Returns a session token for subsequent requests.
 */
export const authenticateDropZone = async (
  uuid: string,
  passcode: string
): Promise<{ token: string; expires_in: number }> => {
  const response = await fetch(`/api/shared/${uuid}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ passcode }),
  });

  if (response.status === 401) {
    throw new Error('Invalid passcode');
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status}: ${errorText}`);
  }

  return response.json();
};

/**
 * Request a presigned upload URL for a drop zone file.
 */
export const requestUploadUrl = async (
  uuid: string,
  filename: string,
  contentType: string,
  sizeBytes: number,
  token?: string
): Promise<{ upload_url: string; file_id: string; s3_key: string; expires_in: number }> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api/shared/${uuid}/upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename,
      content_type: contentType,
      size_bytes: sizeBytes,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || body.error || `Upload request failed: ${response.status}`);
  }

  return response.json();
};

/**
 * Confirm a completed upload to a drop zone.
 */
export const confirmUpload = async (
  uuid: string,
  fileId: string,
  filename: string,
  sizeBytes: number,
  token?: string
): Promise<{ status: string; used_quota_mb: number; total_quota_mb: number | null }> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api/shared/${uuid}/upload/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      file_id: fileId,
      filename,
      size_bytes: sizeBytes,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload confirmation failed: ${errorText}`);
  }

  return response.json();
};

/**
 * List uploaded files in a drop zone.
 */
export const listDropZoneFiles = async (
  uuid: string,
  token?: string
): Promise<{ files: DropZoneFile[]; quota: QuotaInfo }> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/api/shared/${uuid}/files`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
};
