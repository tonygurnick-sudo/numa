/**
 * A single audit log entry from a system log table.
 */
export interface AuditLogEntry {
  logId: string;
  logType: string;
  timestamp: number;
  action: string;
  status: 'success' | 'failure' | 'in_progress' | 'pending';
  userId?: string;
  userName?: string;
  details: Record<string, unknown>;
}

/**
 * Filters for listing audit logs.
 */
export interface AuditLogFilters {
  status?: string;
  limit?: number;
  nextToken?: string;
}

/**
 * Response from the audit logs endpoint.
 */
export interface AuditLogResponse {
  logs: AuditLogEntry[];
  nextToken?: string;
  count: number;
}

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

/**
 * Admin service for system audit log endpoints.
 * All methods require admin authentication via numaGet.
 */
export const AdminAuditLogService = {
  /**
   * List audit log entries for a given log type with optional filters and pagination.
   */
  async listLogs(logType: string, filters: AuditLogFilters, numaGet: NumaGet): Promise<AuditLogResponse> {
    const params = new URLSearchParams();

    if (filters.status) {
      params.set('status', filters.status);
    }

    if (filters.limit) {
      params.set('limit', String(filters.limit));
    }

    if (filters.nextToken) {
      params.set('nextToken', filters.nextToken);
    }

    const url = `/api/audit-logs/${logType}${params.toString() ? `?${params.toString()}` : ''}`;
    const response = (await numaGet(url)) as AuditLogResponse;

    return response;
  },
};
