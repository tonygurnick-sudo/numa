/**
 * Tool-routing regression tests.
 *
 * Run: `npx tsx --test src/tools/registry.test.ts` from lambdas/node/numa-cli-api.
 *
 * WHY THIS EXISTS: the MCP→CLI migration (commit 6bebe5603) silently dropped
 * the native-connector file ops — the backend handlers stayed alive but no
 * route pointed at them, so every call fell through to the wrong Lambda
 * (workspace_chat_tools, which doesn't have them) and failed. These tests pin
 * the routing so that class of silent regression can't recur unnoticed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveToolRoute, TOOL_REGISTRY } from './registry.js';

test('every connect_synergy_* tool routes to oauth_workspace_tools', () => {
  // Auto-covers all current + future Synergy tools (the metadata/search group
  // added by 00d7edd48). A removed route — the original "not available"
  // regression — would drop the key from TOOL_REGISTRY and fail here.
  const synergyTools = Object.keys(TOOL_REGISTRY).filter((k) => k.startsWith('connect_synergy_'));
  assert.ok(
    synergyTools.length >= 27,
    `expected the full Synergy tool set to be registered, got ${synergyTools.length}`
  );
  for (const tool of synergyTools) {
    assert.equal(
      resolveToolRoute(tool).target,
      'oauth_workspace_tools',
      `${tool} must route to oauth_workspace_tools (else it falls through to the wrong Lambda)`
    );
  }
});

test('native-connector tools (status/request + file ops) route to oauth_workspace_tools', () => {
  for (const tool of [
    'connect_status',
    'connect_request',
    'connect_synergy_list',
    'connect_synergy_search',
    'connect_synergy_download',
    'oauth_list_files',
    'oauth_search_files',
    'oauth_download_file',
    'oauth_get_file_metadata',
  ]) {
    assert.equal(
      resolveToolRoute(tool).target,
      'oauth_workspace_tools',
      `${tool} must route to oauth_workspace_tools (else it falls through to the wrong Lambda)`
    );
  }
});

test('kb_manager file-management tools route to kb_manager with method + path', () => {
  const expected: Record<string, string> = {
    move_kb_file: '/api/kb/{kb_id}/files/move',
    rename_kb_file: '/api/kb/{kb_id}/files/rename',
    create_kb_subfolder: '/api/kb/{kb_id}/folders',
    delete_kb_subfolder: '/api/kb/{kb_id}/folders/delete',
  };
  for (const [tool, pathTemplate] of Object.entries(expected)) {
    const route = resolveToolRoute(tool);
    assert.equal(route.target, 'kb_manager', `${tool} must route to kb_manager`);
    assert.ok('pathTemplate' in route && route.pathTemplate === pathTemplate, `${tool} path template`);
  }
});

test('unregistered tools default to workspace_chat_tools (pass-through)', () => {
  for (const tool of ['query_knowledgebase', 'web_search', 'ops_list_tickets', 'list_agents', 'some_future_tool']) {
    assert.equal(
      resolveToolRoute(tool).target,
      'workspace_chat_tools',
      `${tool} should default to workspace_chat_tools`
    );
  }
});
