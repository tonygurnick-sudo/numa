#!/usr/bin/env node
// -----------------------------------------------------------------------------
// check-connector-docs
//
// Enforces the invariant: every folder under `ext-api-doc/` must equal a
// connector's `id` in the frontend connector registry, and vice-versa for any
// connector that has docs. The workspace agent looks up `s3://...-ext-api-doc/
// {id}/` at runtime — if the folder name drifts from the id, the agent silently
// falls through with "no dedicated API docs for this connector," even though
// the files exist (just at the wrong prefix). That's the bug that bit Synergy
// today; this script makes it impossible to reintroduce.
//
// Exits 1 on drift, 0 on clean.
//
// Run via: `node tools/check-connector-docs.mjs` or as part of `make lint`.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EXT_API_DOC_DIR = path.join(REPO_ROOT, 'ext-api-doc');
const REGISTRY_FILE = path.join(
  REPO_ROOT,
  'numa-frontend',
  'src',
  'Components',
  'DataConnectors',
  'connectorRegistry.ts'
);

// Folders under ext-api-doc that are not connector-scoped (shared tooling,
// templates, README, etc.). Whitelisted explicitly so the check stays strict.
const NON_CONNECTOR_FOLDERS = new Set(['_templates']);

function loadRegistryIds() {
  const src = fs.readFileSync(REGISTRY_FILE, 'utf8');
  // Connector entries are nested inside CONNECTOR_REGISTRY. Event-type ids
  // (id: 'new_email' etc.) sit inside a connector's eventTypes array so we
  // can't just grep every `id:` line. Look for top-level connector ids by
  // matching the shape `{ id: '...', displayName: '...',` which appears once
  // per connector.
  const ids = new Set();
  const connectorRegex = /\bid:\s*'([^']+)'\s*,\s*\n\s*displayName:/g;
  let m;
  while ((m = connectorRegex.exec(src)) !== null) {
    ids.add(m[1]);
  }
  if (ids.size === 0) {
    throw new Error(
      `Could not parse any connector ids from ${REGISTRY_FILE}. The connector-detection regex may need updating.`
    );
  }
  return ids;
}

function listDocFolders() {
  if (!fs.existsSync(EXT_API_DOC_DIR)) return [];
  return fs
    .readdirSync(EXT_API_DOC_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !NON_CONNECTOR_FOLDERS.has(name));
}

function main() {
  const ids = loadRegistryIds();
  const folders = listDocFolders();

  const problems = [];

  // 1. Every folder must have a matching connector id.
  for (const folder of folders) {
    if (!ids.has(folder)) {
      problems.push(
        `  ext-api-doc/${folder}/  —  orphan: no connector with id="${folder}" in connectorRegistry.ts.\n` +
          `    Fix: rename the folder to match a connector id, add a matching entry to the registry, or move it under _templates/.`
      );
    }
  }

  // 2. Ids are optional in the other direction (connectors without docs are
  //    fine), so no "missing folder" check — a connector can exist without
  //    any API reference.

  if (problems.length === 0) {
    console.log(`✓ ext-api-doc/ parity check passed (${folders.length} folders, ${ids.size} registered connectors)`);
    return 0;
  }

  console.error('✗ ext-api-doc/ parity check FAILED:\n');
  for (const p of problems) console.error(p + '\n');
  console.error(
    'Rule: every folder under ext-api-doc/ must equal a connector id in\n' +
      'numa-frontend/src/Components/DataConnectors/connectorRegistry.ts. The\n' +
      'workspace agent uses the id verbatim as the S3 prefix to fetch docs at\n' +
      'runtime. Folder-name drift = agent silently has no docs for that\n' +
      'connector.\n'
  );
  return 1;
}

process.exit(main());
