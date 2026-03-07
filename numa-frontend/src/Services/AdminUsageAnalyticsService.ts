import type { UsageEvent } from '../../../lib/usage-analytics-schemas';

/**
 * Filters for listing usage analytics events
 */
export interface UsageAnalyticsFilters {
  eventType?: string;
  isTest?: boolean;
  limit?: number;
  nextToken?: string;
}

/**
 * Response from list events endpoint
 */
export interface UsageAnalyticsResponse {
  events: UsageEvent[];
  nextToken?: string;
  count: number;
}

/**
 * API key metadata (never includes plaintext key)
 */
export interface ApiKeyMetadata {
  createdAt: string;
  expiresAt: string;
  rotatedAt?: string;
  rotationCount: number;
  lastUsedAt?: string;
  retentionMonths: number;
}

/**
 * Response from regenerate key endpoint
 */
export interface RegenerateKeyResponse {
  apiKey: string;
  expiresAt: string;
  message: string;
}

/**
 * A single entry in the login activity heatmap
 */
export interface HeatmapEntry {
  userId: string;
  userName?: string;
  date: string; // YYYY-MM-DD
  real: number;
  test: number;
  total: number;
}

/**
 * Data retention setting
 */
export interface RetentionSetting {
  retentionMonths: number;
}

/**
 * Response from set retention endpoint
 */
export interface SetRetentionResponse {
  retentionMonths: number;
  message: string;
}

/**
 * Numa request context helpers
 */
type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

/**
 * Admin service for usage analytics endpoints.
 * All methods require admin authentication.
 */
export const AdminUsageAnalyticsService = {
  /**
   * List usage analytics events with filters and pagination
   */
  async listEvents(filters: UsageAnalyticsFilters, numaGet: NumaGet): Promise<UsageAnalyticsResponse> {
    const params = new URLSearchParams();

    if (filters.eventType) {
      params.set('eventType', filters.eventType);
    }

    if (filters.isTest !== undefined) {
      params.set('isTest', String(filters.isTest));
    }

    if (filters.limit) {
      params.set('limit', String(filters.limit));
    }

    if (filters.nextToken) {
      params.set('nextToken', filters.nextToken);
    }

    const url = `/api/usage-analytics/events${params.toString() ? `?${params.toString()}` : ''}`;
    const response = (await numaGet(url)) as UsageAnalyticsResponse;

    return response;
  },

  /**
   * Bulk delete all test data (isTest=true events)
   */
  async deleteTestData(numaDelete: NumaDelete): Promise<{ deletedCount: number }> {
    const response = (await numaDelete('/api/usage-analytics/test-data')) as { deletedCount: number };
    return response;
  },

  /**
   * Get API key metadata (does NOT return plaintext key)
   */
  async getApiKeyMetadata(numaGet: NumaGet): Promise<ApiKeyMetadata> {
    const response = (await numaGet('/api/usage-analytics/key')) as ApiKeyMetadata;
    return response;
  },

  /**
   * Regenerate API key (returns NEW key - only time it's accessible)
   */
  async regenerateApiKey(numaPost: NumaPost): Promise<RegenerateKeyResponse> {
    const response = (await numaPost('/api/usage-analytics/key/regenerate')) as RegenerateKeyResponse;
    return response;
  },

  /**
   * Get data retention setting (in months)
   */
  async getRetention(numaGet: NumaGet): Promise<RetentionSetting> {
    const response = (await numaGet('/api/usage-analytics/retention')) as RetentionSetting;
    return response;
  },

  /**
   * Set data retention period (valid values: 1, 3, 6, 12, 15 months)
   */
  async setRetention(retentionMonths: number, numaPut: NumaPut): Promise<SetRetentionResponse> {
    const response = (await numaPut('/api/usage-analytics/retention', { retentionMonths })) as SetRetentionResponse;
    return response;
  },

  /**
   * Get pre-aggregated login activity heatmap data (per user per day)
   */
  async getLoginHeatmap(numaGet: NumaGet): Promise<HeatmapEntry[]> {
    const response = (await numaGet('/api/usage-analytics/heatmap')) as { heatmap: HeatmapEntry[] };
    return response.heatmap;
  },

  /**
   * Get API contract documentation (public endpoint, no auth)
   */
  async getContract(): Promise<unknown> {
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const response = await fetch(`${API_ENDPOINT}/usage-analytics/contract`);

    if (!response.ok) {
      throw new Error('Failed to fetch API contract');
    }

    return response.json();
  },
};
