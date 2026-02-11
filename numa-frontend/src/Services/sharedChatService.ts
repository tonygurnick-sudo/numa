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
  status?: 'processing' | 'ready' | 'error';
  description?: string;
  enable_chat: boolean;
  allow_download: boolean;
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

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
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
  onError: (error: string) => void,
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
