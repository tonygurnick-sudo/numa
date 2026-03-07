/**
 * Knowledge Base Service
 * Handles API calls for split user knowledge base management
 */
import i18n from '../i18n';
import { getSwrCache, setSwrCache } from '../utils/swrCache';

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
  document_count?: number; // Cached count, updated when KB is viewed
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

export interface S3FileInfo {
  key: string;
  lastModified: string | null;
  size: number;
  urlTag?: string;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface ListKBFilesResponse {
  files: S3FileInfo[];
  folders?: string[];
  document_count: number;
}

// KB State types (for sync status, documents, ingestion jobs)
export interface KBDocument {
  documentId: string;
  status: string;
  updatedAt?: string;
  error?: {
    errorMessage?: string;
    errorCode?: string;
  };
  fileName?: string;
  isInferred?: boolean;
  statusReason?: string;
}

export interface KBDataSource {
  dataSourceId: string;
  name?: string;
  displayName?: string;
  type?: string;
  status?: string;
  source?: string;
  isWebCrawler?: boolean;
  url?: string;
  pageCount?: number;
  lastCrawled?: string;
  lastSynced?: string;
  lastUpdated?: string;
}

export interface KBState {
  dataSourceId?: string;
  syncStatus?: string;
  syncJobStatus?: string;
  lastSuccessfulSync?: string | null;
  lastUpdated?: string | null;
  syncMetrics?: Record<string, number>;
  documents: KBDocument[];
  dataSources: KBDataSource[];
  failedDocuments: KBDocument[];
  source: 'q-business' | 'bedrock';
  error?: string;
  message?: string;
}

class KnowledgeBaseService {
  private baseUrl: string;

  constructor() {
    // Use relative path - will be proxied by API Gateway
    this.baseUrl = '/api/kb';
  }

  /**
   * Build an absolute URL for environments (tests/SSR) that don't allow relative fetch URLs.
   */
  private buildUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';
    return new URL(path, base).toString();
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
    const res = response as unknown as { text?: () => Promise<string>; json?: () => Promise<unknown> };
    let rawBody = '';
    let parsed: unknown = {};

    if (typeof res.text === 'function') {
      rawBody = await res.text();
    } else if (typeof res.json === 'function') {
      parsed = await res.json();
    }

    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        const trimmed = rawBody.trim();
        const looksLikeHtml =
          trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML');

        if (looksLikeHtml) {
          throw new Error(i18n.t('errors:knowledgeBase.htmlResponse'));
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
   * Note: This is normally injected by CloudFront automatically,
   * but may be needed for direct API testing
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
      const response = await fetch(this.buildUrl(this.baseUrl), {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const data = await this.parseJsonResponse<{ kbs?: UserKB[] }>(
        response,
        i18n.t('errors:knowledgeBase.listFailed')
      );
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
      const response = await fetch(this.buildUrl(`${this.baseUrl}/${kbId}`), {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const data = await this.parseJsonResponse<{ kb: KnowledgeBase }>(
        response,
        i18n.t('errors:knowledgeBase.detailsFailed')
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
      const response = await fetch(this.buildUrl(this.baseUrl), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });

      const data = await this.parseJsonResponse<{ kb: KnowledgeBase }>(
        response,
        i18n.t('errors:knowledgeBase.createFailed')
      );
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
      const response = await fetch(this.buildUrl(`${this.baseUrl}/${kbId}`), {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });

      await this.parseJsonResponse<Record<string, unknown>>(response, i18n.t('errors:knowledgeBase.updateFailed'));
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
      const response = await fetch(this.buildUrl(`${this.baseUrl}/${kbId}`), {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      await this.parseJsonResponse<Record<string, unknown>>(response, i18n.t('errors:knowledgeBase.deleteFailed'));
    } catch (error) {
      console.error('Error deleting KB:', error);
      throw error;
    }
  }

  /** Read cached KB file listing from localStorage (instant, synchronous). */
  getCachedKBFiles(kbId: string): ListKBFilesResponse | null {
    return getSwrCache<ListKBFilesResponse>(`kbFiles_${kbId}`);
  }

  /**
   * List files and folders at one level of a KB's S3 prefix.
   * Pass `path` to drill into a subfolder (e.g. "reports/" or "reports/2024/").
   */
  async listKBFiles(kbId: string, path?: string): Promise<ListKBFilesResponse> {
    try {
      let url = `${this.baseUrl}/${kbId}/files`;
      if (path) {
        url += `?path=${encodeURIComponent(path)}`;
      }
      const response = await fetch(this.buildUrl(url), {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const result = await this.parseJsonResponse<ListKBFilesResponse>(
        response,
        i18n.t('errors:knowledgeBase.listFilesFailed')
      );
      // Persist to localStorage for instant load on next visit.
      // Skip caching if payload is over 500KB to avoid filling localStorage for huge KBs.
      setSwrCache(`kbFiles_${kbId}`, result, 500_000);
      return result;
    } catch (error) {
      console.error('Error listing KB files:', error);
      throw error;
    }
  }

  /**
   * Get KB state including documents, sync status, and ingestion jobs
   * This replaces the frontend AWS SDK calls for KB state
   */
  async getKBState(kbId: string): Promise<KBState> {
    try {
      const response = await fetch(this.buildUrl(`${this.baseUrl}/${kbId}/state`), {
        method: 'GET',
        headers: this.getHeaders(),
      });

      return this.parseJsonResponse<KBState>(response, i18n.t('errors:knowledgeBase.stateFailed'));
    } catch (error) {
      console.error('Error getting KB state:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const knowledgeBaseService = new KnowledgeBaseService();
