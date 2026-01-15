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
};
