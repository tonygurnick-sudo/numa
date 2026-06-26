import { describe, it, expect } from 'vitest';
import { effectiveModeFor, atRiskCapabilitiesForSchedule } from '../../utils/approvalPosture';
import type { AgentToolsConfig } from '../../types/agents';
import type { ChatSettings } from '../../Services/ChatSettingsService';

const baseSettings = (
  integrationApprovalModes: ChatSettings['integrationApprovalModes']
): Pick<ChatSettings, 'approvalMode' | 'numaToolApprovalMode' | 'integrationApprovalModes'> => ({
  approvalMode: 'non_destructive',
  numaToolApprovalMode: {},
  integrationApprovalModes,
});

describe('effectiveModeFor — cross-method slug overrides (BUG-390)', () => {
  it('resolves a native-slug lookup against a Pipedream-slug override', () => {
    // Override saved under the Pipedream slug; the agent enables the native slug.
    const settings = baseSettings({ google_drive: 'always' });
    expect(effectiveModeFor('integrations', undefined, settings, 'googledrive')).toBe('always');
  });

  it('resolves a Pipedream-slug lookup against a native-slug override', () => {
    const settings = baseSettings({ googledrive: 'always' });
    expect(effectiveModeFor('integrations', undefined, settings, 'google_drive')).toBe('always');
  });

  it('prefers an exact slug match over its alias', () => {
    const settings = baseSettings({ googledrive: 'never', google_drive: 'always' });
    expect(effectiveModeFor('integrations', undefined, settings, 'googledrive')).toBe('never');
  });

  it('falls back to the category default when no slug or alias matches', () => {
    const settings = baseSettings({ slack: 'always' });
    expect(effectiveModeFor('integrations', undefined, settings, 'googledrive')).toBe('non_destructive');
  });
});

describe('atRiskCapabilitiesForSchedule — native connector warning fires', () => {
  it('flags a native Drive connector whose override is keyed by the Pipedream slug', () => {
    const settings = baseSettings({ google_drive: 'always' });
    const toolsConfig: AgentToolsConfig = {
      enabledConnections: ['googledrive'],
    } as AgentToolsConfig;
    const atRisk = atRiskCapabilitiesForSchedule(toolsConfig, settings);
    const integrations = atRisk.find((c) => c.category === 'integrations');
    expect(integrations).toBeDefined();
    expect(integrations?.mode).toBe('always');
  });
});
