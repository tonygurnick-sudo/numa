/**
 * Wraps the existing /api/srp-hasher Lambda. Returns
 * `HMAC-SHA256(client_secret, identifier + client_id)` — the SECRET_HASH that
 * Cognito requires for app clients with `generateSecret: true`. The client
 * secret stays server-side; we only ever see the hash.
 *
 * Accepts either an email or a userSub as the identifier.
 */

import { numaBaseUrl, type ClientConfig } from './client.js';

interface SrpHasherResponse {
  hash?: string;
}

export async function fetchSecretHash(account: string, identifier: string, config: ClientConfig): Promise<string> {
  const apiPrefix = config.API_ENDPOINT ?? '/api';
  const url = `${numaBaseUrl(account)}${apiPrefix}/srp-hasher`;

  const isEmail = identifier.includes('@');
  const payload = isEmail ? { email: identifier } : { userSub: identifier };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`fetchSecretHash: HTTP ${res.status} from ${url}`);
  }

  const data = (await res.json()) as SrpHasherResponse;
  if (!data.hash) {
    throw new Error('fetchSecretHash: response missing `hash` field');
  }
  return data.hash;
}
