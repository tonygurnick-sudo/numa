/**
 * Knowledge Base Service
 * Handles API calls for split user knowledge base management
 */

export interface KnowledgeBase {
  kb_id: string;
  kb_name: string;
  s3_prefix: string;
  is_default: boolean;
  is_shared: boolean; // Whether KB is shared with other users
  viewers: string[];
  editors: string[];
  editor_emails?: string[];
  viewer_emails?: string[];
  created_by: string;
  created_at: string;
  status: string;
  document_count: number;
}

export interface UserKB {
  kb_id: string;
  kb_name: string;
  role: 'VIEWER' | 'EDITOR' | 'OWNER';
  is_shared?: boolean; // Whether KB is shared with other users
}

export interface CreateKBRequest {
  name: string;
  is_shared: boolean; // True for shared KB, false for personal
  viewers: string[]; // Only used when is_shared=true
  editors: string[]; // Only used when is_shared=true
}

export interface UpdateKBRequest {
  name?: string;
  is_shared?: boolean;
  viewers?: string[];
  editors?: string[];
}

class KnowledgeBaseService {
  private baseUrl: string;

  constructor() {
    // Use relative path - will be proxied by API Gateway
    this.baseUrl = '/api/kb';
  }

  /**
   * Parse JSON responses and surface readable errors when the payload is HTML or plain text.
   */
  private extractErrorMessage(payload: unknown): string | undefined {
    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>;
      const candidate = obj.error ?? obj.message;
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
    return undefined;
  }

  private async parseJsonResponse<T>(response: Response, fallbackError: string): Promise<T> {
    const rawBody = await response.text();
    let parsed: unknown = {};

    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        const trimmed = rawBody.trim();
        const looksLikeHtml =
          trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML');

        if (looksLikeHtml) {
          throw new Error(
            'Knowledge base API returned HTML. This usually means the request was routed to the web app instead of the backend API. Check your API proxy or authentication configuration.',
          );
        }

        throw new Error(trimmed || fallbackError);
      }
    }

    if (!response.ok) {
      const message = this.extractErrorMessage(parsed) || response.statusText || fallbackError;
      throw new Error(message);
    }

    return parsed as T;
  }

  /**
   * Get authorization token from local storage (where AuthProvider stores it)
   */
  private getAuthToken(): string | null {
    return window.localStorage.getItem('idToken');
  }

  /**
   * Get CloudFront shared secret from session storage
   */
  private getCloudfrontSecret(): string | null {
    return window.sessionStorage.getItem('CLOUDFRONT_SHARED_SECRET');
  }

  /**
   * Build headers for API requests
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const token = this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const cfSecret = this.getCloudfrontSecret();
    if (cfSecret) {
      headers['x-arcanum-cloudfront-secret'] = cfSecret;
    }

    return headers;
  }

  /**
   * List all KBs accessible to the current user
   */
  async listUserKBs(): Promise<UserKB[]> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const data = await this.parseJsonResponse<{ kbs?: UserKB[] }>(response, 'Failed to list knowledge bases');
      return data.kbs || [];
    } catch (error) {
      console.error('Error listing user KBs:', error);
      throw error;
    }
  }

  /**
   * Get details of a specific KB
   */
  async getKB(kbId: string): Promise<KnowledgeBase> {
    try {
      const response = await fetch(`${this.baseUrl}/${kbId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const data = await this.parseJsonResponse<{ kb: KnowledgeBase }>(
        response,
        'Failed to get knowledge base details',
      );
      return data.kb;
    } catch (error) {
      console.error('Error getting KB:', error);
      throw error;
    }
  }

  /**
   * Create a new knowledge base
   */
  async createKB(request: CreateKBRequest): Promise<KnowledgeBase> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });

      const data = await this.parseJsonResponse<{ kb: KnowledgeBase }>(response, 'Failed to create KB');
      return data.kb;
    } catch (error) {
      console.error('Error creating KB:', error);
      throw error;
    }
  }

  /**
   * Update an existing knowledge base
   */
  async updateKB(kbId: string, request: UpdateKBRequest): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${kbId}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });

      await this.parseJsonResponse<Record<string, unknown>>(response, 'Failed to update KB');
    } catch (error) {
      console.error('Error updating KB:', error);
      throw error;
    }
  }

  /**
   * Delete (archive) a knowledge base
   */
  async deleteKB(kbId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${kbId}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      await this.parseJsonResponse<Record<string, unknown>>(response, 'Failed to delete KB');
    } catch (error) {
      console.error('Error deleting KB:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const knowledgeBaseService = new KnowledgeBaseService();
