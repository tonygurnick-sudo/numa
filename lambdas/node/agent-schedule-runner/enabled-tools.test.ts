/**
 * Unit tests for buildEnabledTools — the tool-list builder used by the
 * scheduled / event-triggered runner.
 *
 * Regression coverage for BUG-187: an agent with Auto-tools mode on but the
 * standalone createAgentEnabled toggle off (the default) could create agents
 * in interactive chat but was told "Agent Creation tool isn't enabled" in
 * scheduled/triggered runs. Auto mode must enable create_agent_tool
 * unconditionally, matching the frontend's getEnabledTools.
 */

import { describe, it, expect } from 'vitest';
import { buildEnabledTools } from './index';

describe('buildEnabledTools — Auto mode', () => {
  it('BUG-187: includes create_agent_tool even when createAgentEnabled is false', () => {
    // The exact Numa HQ Slack-agent shape: autoToolsEnabled=true,
    // createAgentEnabled=false, allKBsAllowed=true.
    const tools = buildEnabledTools({
      autoToolsEnabled: true,
      createAgentEnabled: false,
      webSearchEnabled: true,
      enabledKBIds: [],
      allKBsAllowed: true,
      kbFieldSet: true,
    });
    expect(tools).toContain('create_agent_tool');
    expect(tools).toContain('web_search');
    expect(tools).toContain('memories_tool');
    expect(tools).toContain('knowledge_base');
  });

  it('includes the standard auto tools when no KBs are available', () => {
    const tools = buildEnabledTools({
      autoToolsEnabled: true,
      createAgentEnabled: false,
      enabledKBIds: [],
      allKBsAllowed: false,
      kbFieldSet: true,
    });
    expect(tools).toEqual(expect.arrayContaining(['web_search', 'create_agent_tool', 'memories_tool']));
    expect(tools).not.toContain('knowledge_base');
  });

  it('defaults to auto when autoToolsEnabled is undefined', () => {
    const tools = buildEnabledTools({
      enabledKBIds: [],
    });
    expect(tools).toContain('create_agent_tool');
  });
});

describe('buildEnabledTools — Manual mode', () => {
  it('omits create_agent_tool when createAgentEnabled is false', () => {
    const tools = buildEnabledTools({
      autoToolsEnabled: false,
      createAgentEnabled: false,
      webSearchEnabled: true,
      enabledKBIds: [],
      allKBsAllowed: false,
      kbFieldSet: true,
    });
    expect(tools).not.toContain('create_agent_tool');
    expect(tools).toContain('web_search');
    expect(tools).toContain('memories_tool');
  });

  it('includes create_agent_tool when createAgentEnabled is true', () => {
    const tools = buildEnabledTools({
      autoToolsEnabled: false,
      createAgentEnabled: true,
      webSearchEnabled: false,
      enabledKBIds: [],
      allKBsAllowed: false,
      kbFieldSet: true,
    });
    expect(tools).toContain('create_agent_tool');
    expect(tools).not.toContain('web_search');
  });

  it('respects webSearchEnabled and specific KB ids', () => {
    const tools = buildEnabledTools({
      autoToolsEnabled: false,
      createAgentEnabled: false,
      webSearchEnabled: true,
      enabledKBIds: ['company'],
      allKBsAllowed: false,
      kbFieldSet: true,
    });
    expect(tools).toContain('knowledge_base');
    expect(tools).toContain('web_search');
    expect(tools).not.toContain('create_agent_tool');
  });

  it('omits memories_tool when memoriesEnabled is false', () => {
    const tools = buildEnabledTools({
      autoToolsEnabled: false,
      memoriesEnabled: false,
      enabledKBIds: [],
    });
    expect(tools).not.toContain('memories_tool');
  });

  it('includes memories_tool by default (toggle unset)', () => {
    const tools = buildEnabledTools({ autoToolsEnabled: false, enabledKBIds: [] });
    expect(tools).toContain('memories_tool');
  });

  it('includes numa_ops_tool when numaOpsEnabled is true', () => {
    const tools = buildEnabledTools({
      autoToolsEnabled: false,
      numaOpsEnabled: true,
      enabledKBIds: [],
    });
    expect(tools).toContain('numa_ops_tool');
  });

  it('omits numa_ops_tool by default', () => {
    const tools = buildEnabledTools({ autoToolsEnabled: false, enabledKBIds: [] });
    expect(tools).not.toContain('numa_ops_tool');
  });
});

describe('buildEnabledTools — Auto mode toggles', () => {
  it('includes numa_ops_tool in auto mode when numaOpsEnabled is true', () => {
    const tools = buildEnabledTools({
      autoToolsEnabled: true,
      numaOpsEnabled: true,
      enabledKBIds: [],
    });
    expect(tools).toContain('numa_ops_tool');
    expect(tools).toContain('memories_tool');
  });
});
