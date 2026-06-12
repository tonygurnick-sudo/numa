/**
 * Client for `GET /api/cli/integrations/<slug>/docs?method=pipedream|native`.
 *
 * Returns the same shape the server constructs:
 *   pipedream → { method, slug, index: PipedreamActionIndexEntry[] }
 *   native    → { method, slug, files: Array<{name, content}> }
 *
 * No caching here — caller is responsible (see `context/integrations-cache.ts`).
 */

import { apiCall } from './client.js';
import type { PipedreamActionIndexEntry } from '../metadata/tool-types.js';

export interface PipedreamDocsResult {
  method: 'pipedream';
  slug: string;
  index: PipedreamActionIndexEntry[];
}

export interface NativeDocsResult {
  method: 'native';
  slug: string;
  files: Array<{ name: string; content: string }>;
}

export type IntegrationDocsResult = PipedreamDocsResult | NativeDocsResult;

interface DocsEnvelope {
  status?: 'success' | 'error' | string;
  result?: IntegrationDocsResult;
  error?: string;
}

export const fetchIntegrationDocs = async (
  account: string,
  accessToken: string,
  slug: string,
  method: 'pipedream' | 'native'
): Promise<IntegrationDocsResult> => {
  const res = await apiCall<DocsEnvelope>({
    account,
    accessToken,
    method: 'GET',
    path: `/cli/integrations/${encodeURIComponent(slug)}/docs`,
    query: { method },
  });
  if (res.status === 'error' || !res.result) {
    throw new Error(`fetchIntegrationDocs(${slug}/${method}): ${res.error ?? 'no result'}`);
  }
  return res.result;
};
