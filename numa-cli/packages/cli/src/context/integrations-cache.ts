/**
 * Doc cache for `numa integrations docs <slug>`.
 *
 * Routing:
 *   - In-workspace (NUMA_CONVERSATION_ID set) → prefer the local files the
 *     workspace agent already syncs at chat-start:
 *       Pipedream: /workdir/tools/integrations/<slug>/
 *       Native:    /workdir/api-docs/<slug>/
 *     Returns paths to those files. No network. Same workflow the LLM
 *     uses today.
 *   - Outside workspace → fetch via `/api/cli/integrations/<slug>/docs`
 *     and write to a local cache. Subsequent calls re-fetch (no TTL yet
 *     — keep it simple; can add later if hitting cost). Returns paths
 *     under the cache dir.
 *
 * Cache layout (local):
 *   ~/.cache/numa/integrations/<slug>/
 *     pipedream/_index.json
 *     native/01-llm-api-rules.md
 *     native/01a-domain-model-reference.md
 *     ...
 *
 * Override: NUMA_CLI_CACHE_DIR=<path> reroots everything under that path.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { IntegrationDocsResult } from '../api/integrations-docs.js';

const WORKSPACE_PIPEDREAM_DIR = '/workdir/tools/integrations';
const WORKSPACE_NATIVE_DIR = '/workdir/api-docs';

export interface ResolvedDoc {
  /** Filesystem path the caller can read. */
  path: string;
  /** Filename only (e.g. `_index.json`, `01-llm-api-rules.md`). */
  name: string;
}

export interface ResolvedDocs {
  method: 'pipedream' | 'native';
  slug: string;
  /** Where the files live now (workspace path OR local cache). */
  source: 'workspace' | 'cache';
  files: ResolvedDoc[];
}

const inWorkspace = (): boolean => !!process.env['NUMA_CONVERSATION_ID'];

const cacheRoot = (): string => {
  const override = process.env['NUMA_CLI_CACHE_DIR'];
  if (override) return override;
  return join(homedir(), '.cache', 'numa');
};

const integrationCacheDir = (slug: string, method: 'pipedream' | 'native'): string =>
  join(cacheRoot(), 'integrations', slug, method);

/**
 * List the files in a directory (filtered by extension). Returns an empty
 * array if the directory doesn't exist — caller decides whether that's an
 * error or a cache miss.
 */
const listFiles = (dir: string, extensions: string[]): ResolvedDoc[] => {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => extensions.some((ext) => name.endsWith(ext)))
      .filter((name) => {
        try {
          return statSync(join(dir, name)).isFile();
        } catch {
          return false;
        }
      })
      .sort()
      .map((name) => ({ name, path: join(dir, name) }));
  } catch {
    return [];
  }
};

/** In-workspace path lookup. Returns empty files when the slug isn't synced. */
export const tryWorkspaceDocs = (slug: string, method: 'pipedream' | 'native'): ResolvedDocs | undefined => {
  if (!inWorkspace()) return undefined;
  const dir = method === 'pipedream' ? join(WORKSPACE_PIPEDREAM_DIR, slug) : join(WORKSPACE_NATIVE_DIR, slug);
  const extensions = method === 'pipedream' ? ['.json'] : ['.md'];
  const files = listFiles(dir, extensions);
  if (files.length === 0) return undefined;
  return { method, slug, source: 'workspace', files };
};

/** Write API-fetched docs to the local cache + return the paths. */
export const writeCachedDocs = (slug: string, docs: IntegrationDocsResult): ResolvedDocs => {
  const dir = integrationCacheDir(slug, docs.method);
  mkdirSync(dir, { recursive: true });

  const files: ResolvedDoc[] = [];
  if (docs.method === 'pipedream') {
    // Single _index.json with the action summaries. Per-action schemas are
    // fetched on demand (and not currently cached) since each is its own
    // pipedream_list_actions roundtrip server-side.
    const name = '_index.json';
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(docs.index, null, 2));
    files.push({ name, path });
  } else {
    for (const file of docs.files) {
      const path = join(dir, file.name);
      writeFileSync(path, file.content);
      files.push({ name: file.name, path });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { method: docs.method, slug, source: 'cache', files };
};
