export type DataConnectorStatus = {
  connector_id: string;
  status?: string;
  config?: {
    server?: string;
  };
  test_result?: {
    message?: string;
    jobs_found?: number | null;
    tested_at?: string;
  };
  last_tested?: string;
  pat_expires_at?: string;
  error_code?: string;
  error_message?: string;
};

export type PatStatus = {
  pat_created_at?: string;
  pat_expires_at?: string;
  pat_ttl_days?: number;
  days_remaining?: number | null;
  status: 'healthy' | 'warning' | 'critical' | 'expired' | 'unknown';
  rotation_threshold_days?: number;
  history_count?: number;
  history?: Array<{
    created_at?: string;
    expires_at?: string;
    replaced_at?: string;
    reason?: string;
  }>;
};
