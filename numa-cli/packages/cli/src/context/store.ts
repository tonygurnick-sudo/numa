/**
 * State storage for the numa CLI.
 *
 * Layout (compatible with the Python proof-of-concept that lived at
 * ~/.local/bin/numa, so existing tokens carry over without re-login):
 *
 *   ~/.config/numa/profile                    — active account name (one line)
 *   ~/.config/numa/tokens-<account>.json      — tokens (chmod 600)
 *   ~/.config/numa/context-<account>.json     — bootstrap response (Phase 2+)
 *
 * Resolution order for the active profile:
 *   1. NUMA_PROFILE env var
 *   2. NUMA_ACCOUNT env var (workspace-IAM mode; sdk_config.py sets this)
 *   3. ~/.config/numa/profile
 *   4. undefined (caller decides what to do)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'numa');
const PROFILE_FILE = join(STATE_DIR, 'profile');

export function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

export function activeProfile(): string | undefined {
  const fromEnv = process.env['NUMA_PROFILE']?.trim();
  if (fromEnv) return fromEnv;
  // Workspace mode sets NUMA_ACCOUNT instead of NUMA_PROFILE — same
  // concept ("which Numa instance does this CLI talk to"). Accept both
  // so workspace env-var naming stays semantically aligned with the
  // Lambda auth model (an "account" / tenant, not a "profile").
  const fromWorkspaceEnv = process.env['NUMA_ACCOUNT']?.trim();
  if (fromWorkspaceEnv) return fromWorkspaceEnv;
  if (!existsSync(PROFILE_FILE)) return undefined;
  const raw = readFileSync(PROFILE_FILE, 'utf-8').trim();
  return raw.length > 0 ? raw : undefined;
}

export function setActiveProfile(name: string): void {
  ensureStateDir();
  writeFileSync(PROFILE_FILE, name + '\n', { mode: 0o600 });
}

export function tokensPath(account: string): string {
  return join(STATE_DIR, `tokens-${account}.json`);
}

export function contextPath(account: string): string {
  return join(STATE_DIR, `context-${account}.json`);
}

export interface StoredTokens {
  account: string;
  username: string;
  sub: string;
  email: string;
  groups: string[];
  accessToken: string;
  idToken: string;
  refreshToken: string | undefined;
  /** Unix seconds when the access token expires. */
  expiresAt: number;
  /** Unix seconds when the tokens were obtained. */
  issuedAt: number;
}

export function loadTokens(account: string): StoredTokens | undefined {
  const path = tokensPath(account);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StoredTokens;
  } catch {
    return undefined;
  }
}

export function saveTokens(account: string, tokens: StoredTokens): void {
  ensureStateDir();
  const path = tokensPath(account);
  writeFileSync(path, JSON.stringify(tokens, null, 2) + '\n');
  chmodSync(path, 0o600);
}

export function clearTokens(account: string): boolean {
  const path = tokensPath(account);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function loadContext<T = unknown>(account: string): T | undefined {
  const path = contextPath(account);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

export function saveContext(account: string, ctx: unknown): void {
  ensureStateDir();
  const path = contextPath(account);
  writeFileSync(path, JSON.stringify(ctx, null, 2) + '\n');
  chmodSync(path, 0o600);
}
