/**
 * Dev-only mock frontend payload. Persisted at
 * `~/.config/numa/dev-context-<account>.json` so it survives between
 * commands. Used by the resolver to simulate "as if the frontend sent this
 * exact enabled list" without spinning a real conversation. Managed by the
 * `numa-dev context` command tree.
 *
 * Shape mirrors what the workspace agent receives as env vars on chat-start:
 *   NUMA_ALLOWED_KBS        → allowed_kbs
 *   NUMA_ENABLED_INTEGRATIONS → enabled_integrations
 *   NUMA_ENABLED_NATIVE_CONNECTORS → enabled_native_connectors
 *   NUMA_ENABLED_TOOLS      → enabled_tools
 *   NUMA_ALLOWED_OPERATIONS → allowed_operations
 *   NUMA_ALLOWED_KB_OPERATIONS → allowed_kb_operations
 *   NUMA_CONVERSATION_ID    → conversation_id
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureStateDir } from './store.js';

const STATE_DIR = join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'numa');

export interface DevContext {
  allowed_kbs?: Array<{ id: string; name?: string }>;
  allowed_kb_operations?: string[];
  enabled_integrations?: string[];
  enabled_native_connectors?: string[];
  enabled_tools?: string[];
  allowed_operations?: string[];
  conversation_id?: string;
}

export const devContextPath = (account: string): string => join(STATE_DIR, `dev-context-${account}.json`);

export const loadDevContext = (account: string): DevContext | undefined => {
  const path = devContextPath(account);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as DevContext;
  } catch {
    return undefined;
  }
};

export const saveDevContext = (account: string, ctx: DevContext): void => {
  ensureStateDir();
  const path = devContextPath(account);
  writeFileSync(path, JSON.stringify(ctx, null, 2) + '\n');
  chmodSync(path, 0o600);
};

export const clearDevContext = (account: string): boolean => {
  const path = devContextPath(account);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
};
