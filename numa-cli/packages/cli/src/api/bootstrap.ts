/**
 * /api/cli/bootstrap — server-aggregated context the CLI caches at
 * ~/.config/numa/context-<account>.json.
 *
 * v1 is intentionally lean: identity (from JWT) + client name + version
 * floor. Feature flags live in /config.json which the CLI fetches on every
 * login, so we don't duplicate them here.
 */

import { apiCall } from './client.js';

export interface BootstrapResponse {
  user: {
    sub: string;
    email: string | undefined;
    name: string | undefined;
    groups: string[];
  };
  client_name: string;
  cli_min_version: string;
  fetched_at: string;
}

export async function fetchBootstrap(account: string, accessToken: string): Promise<BootstrapResponse> {
  return apiCall<BootstrapResponse>({
    account,
    accessToken,
    method: 'POST',
    path: '/cli/bootstrap',
  });
}
