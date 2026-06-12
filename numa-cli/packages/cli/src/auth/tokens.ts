/**
 * Token management — read what's on disk, refresh if expired, persist.
 *
 * Numa client config sets accessTokenValidity=60min, idTokenValidity=60min,
 * refreshTokenValidity=60days, so the access/id pair is the thing that
 * actually expires in normal use.
 */

import { loadTokens, saveTokens, clearTokens, type StoredTokens } from '../context/store.js';
import { refreshSession } from './srp.js';

const SKEW_SECONDS = 60;

export function isAccessTokenFresh(tokens: StoredTokens): boolean {
  const now = Math.floor(Date.now() / 1000);
  return tokens.expiresAt > now + SKEW_SECONDS;
}

/**
 * Returns the stored tokens, refreshing them in place if the access token is
 * expired. Throws if no tokens exist or refresh fails.
 *
 * In workspace-IAM mode (NUMA_AUTH_MODE=workspace-iam) there's no token on
 * disk. Identity is carried separately: the transport (`client.ts`) reads
 * NUMA_IDENTITY_TOKEN and sends it as the `authorization` header to
 * numa-cli-api, which verifies it. This stub exists only so call sites that
 * pre-load tokens don't need a workspace-mode branch in every action; its
 * token fields are unused for auth and left empty (notably idToken — in
 * non-interactive runs NUMA_USER_ID_TOKEN can hold the server-to-server
 * bearer, which must not travel downstream as a user id_token).
 */
export async function getValidTokens(account: string): Promise<StoredTokens> {
  if (process.env['NUMA_AUTH_MODE'] === 'workspace-iam') {
    const now = Math.floor(Date.now() / 1000);
    const groupsRaw = process.env['NUMA_USER_GROUPS']?.trim();
    let groups: string[] = [];
    if (groupsRaw) {
      try {
        const parsed = JSON.parse(groupsRaw);
        if (Array.isArray(parsed)) groups = parsed.filter((g): g is string => typeof g === 'string');
      } catch {
        groups = groupsRaw
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean);
      }
    }
    return {
      account,
      username: process.env['NUMA_USER_SUB'] ?? '',
      sub: process.env['NUMA_USER_SUB'] ?? '',
      email: process.env['NUMA_USER_EMAIL'] ?? '',
      groups,
      accessToken: '',
      idToken: '',
      refreshToken: undefined,
      // Far future — this stub never "expires"; the real identity token lives
      // in NUMA_IDENTITY_TOKEN and is verified (with its own expiry) server-side.
      expiresAt: now + 3600 * 24 * 365,
      issuedAt: now,
    };
  }
  const tokens = loadTokens(account);
  if (!tokens) {
    throw new Error(`No tokens for '${account}' — run 'numa login ${account}' first`);
  }
  if (isAccessTokenFresh(tokens)) {
    return tokens;
  }

  if (!tokens.refreshToken) {
    throw new Error(`Tokens for '${account}' expired and no refresh token on file — run 'numa login ${account}'`);
  }

  const { authResult } = await refreshSession(account, tokens.sub, tokens.refreshToken);

  // Refresh returns new access + id tokens (refresh is rotated separately by
  // Cognito's refresh policy, often only on full re-login).
  const updated: StoredTokens = {
    ...tokens,
    accessToken: authResult.AccessToken ?? tokens.accessToken,
    idToken: authResult.IdToken ?? tokens.idToken,
    expiresAt: Math.floor(Date.now() / 1000) + (authResult.ExpiresIn ?? 3600),
  };
  saveTokens(account, updated);
  return updated;
}

export { loadTokens, saveTokens, clearTokens };
export type { StoredTokens };
