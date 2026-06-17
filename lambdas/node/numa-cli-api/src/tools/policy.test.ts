/**
 * Policy parity + behaviour tests (Phase 5 CLI allow-list).
 *
 * Run: `npx tsx --test src/tools/policy.test.ts` from lambdas/node/numa-cli-api.
 *
 * The Python source of truth (agent_types/__init__.py) restricts every
 * `nolia*` type to `["docs"]` and leaves everything else unrestricted. These
 * tests pin the Node enforcement to that same contract so the two can't drift.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allowedCategoriesForAgentType, isToolAllowedForAgentType, toolCategory } from './policy.js';

test('Nolia types are restricted to the docs category', () => {
  for (const t of [
    'nolia-eda',
    'nolia-global',
    'nolia-compliance',
    'nolia-funding-assess',
    'nolia-funding-assess-single',
  ]) {
    const allowed = allowedCategoriesForAgentType(t);
    assert.notEqual(allowed, null, `${t} should be restricted`);
    assert.deepEqual([...allowed!], ['docs'], `${t} should allow only docs`);
  }
});

test('Unrestricted types (and laptop/no-type) get no restriction', () => {
  for (const t of ['numa-chat', 'data-analysis', 'research-agent', 'quoting', undefined, '']) {
    assert.equal(allowedCategoriesForAgentType(t), null, `${t} should be unrestricted`);
  }
});

test('Nolia may extract/convert docs but not touch ops/agents/memory', () => {
  // Allowed
  for (const tool of ['extract_content', 'convert_document', 'transcribe']) {
    assert.equal(isToolAllowedForAgentType('nolia-eda', tool).allowed, true, `${tool} should be allowed`);
  }
  // Denied — the prompt-injection threat. `view_image` is in the `vision`
  // category (not `docs`), so Nolia — restricted to docs — must NOT get it.
  for (const tool of [
    'ops_delete_ticket',
    'create_agent',
    'delete_agent',
    'user_profile_add_memory',
    'pipedream_run_action',
    'add_to_kb',
    'web_search',
    'view_image',
  ]) {
    assert.equal(isToolAllowedForAgentType('nolia-eda', tool).allowed, false, `${tool} should be denied for nolia`);
  }
});

test('Unrestricted types auto-permit vision (view_image)', () => {
  // The Standard-model "eyes" are gated purely by prompt-advertisement; the
  // server-side allow-list auto-permits the new `vision` category for any
  // unrestricted type.
  for (const t of ['numa-chat', 'data-analysis', undefined]) {
    assert.equal(isToolAllowedForAgentType(t, 'view_image').allowed, true, `${t} should permit view_image`);
  }
});

test('Restricted type + uncategorizable tool fails closed', () => {
  assert.equal(isToolAllowedForAgentType('nolia-eda', 'some_unknown_future_tool').allowed, false);
});

test('Unrestricted type may use anything, including unknown tools', () => {
  for (const tool of ['ops_delete_ticket', 'create_agent', 'some_unknown_future_tool']) {
    assert.equal(isToolAllowedForAgentType('numa-chat', tool).allowed, true);
  }
});

test('native-connector file tools are integrations — usable unrestricted, denied for nolia', () => {
  for (const tool of [
    'connect_synergy_list',
    'connect_synergy_search',
    'connect_synergy_download',
    'oauth_list_files',
    'oauth_search_files',
    'oauth_download_file',
    'oauth_get_file_metadata',
  ]) {
    assert.equal(toolCategory(tool), 'integrations', `${tool} should bucket as integrations`);
    assert.equal(isToolAllowedForAgentType('numa-chat', tool).allowed, true, `${tool} allowed for numa-chat`);
    assert.equal(isToolAllowedForAgentType(undefined, tool).allowed, true, `${tool} allowed for laptop/no-type`);
    assert.equal(isToolAllowedForAgentType('nolia-eda', tool).allowed, false, `${tool} denied for nolia (docs-only)`);
  }
});

test('toolCategory buckets known + prefixed tools correctly', () => {
  assert.equal(toolCategory('extract_content'), 'docs');
  assert.equal(toolCategory('view_image'), 'vision');
  assert.equal(toolCategory('web_search'), 'web');
  assert.equal(toolCategory('user_profile_add_memory'), 'memory');
  assert.equal(toolCategory('create_agent'), 'agents');
  assert.equal(toolCategory('add_to_kb'), 'files');
  assert.equal(toolCategory('pipedream_run_action'), 'integrations');
  assert.equal(toolCategory('connect_request'), 'integrations');
  // prefix fallbacks for tools not in the explicit map
  assert.equal(toolCategory('ops_create_ticket'), 'ops');
  assert.equal(toolCategory('pipedream_brand_new_op'), 'integrations');
  assert.equal(toolCategory('archive_agent'), 'agents');
  assert.equal(toolCategory('totally_unknown'), null);
});
