import { describe, it, expect } from 'vitest';
import { buildScheduledRunPreamble } from './index';

describe('agent-schedule-runner', () => {
  it('has a smoke test', () => {
    expect(true).toBe(true);
  });
});

describe('buildScheduledRunPreamble (FEAT-243 REFLECT & COMPOUND)', () => {
  it('keeps the mandatory status-report contract', () => {
    const p = buildScheduledRunPreamble();
    expect(p).toContain('/workdir/outputs/status.json');
    expect(p).toContain('MANDATORY — STATUS REPORT');
  });

  it('carries the reflect-and-compound contract with the not-compulsory framing', () => {
    const p = buildScheduledRunPreamble('agt_123');
    expect(p).toContain('REFLECT & COMPOUND');
    expect(p).toContain('SCRIPT');
    expect(p).toContain('REMEMBER');
    // Encourage, don't mandate — and never script the thinking.
    expect(p).toContain('NEVER script judgment');
    expect(p).toMatch(/Acting on them is NOT/);
  });

  it('documents the optional optimised[] status field', () => {
    const p = buildScheduledRunPreamble('agt_123');
    expect(p).toContain('"optimised"');
    expect(p).toContain('OPTIONAL');
    // The "exactly these fields" wording must be relaxed or agents reject optimised.
    expect(p).not.toContain('exactly these fields');
  });

  it('scopes saved memories to the active agent', () => {
    const p = buildScheduledRunPreamble('agt_xyz');
    expect(p).toContain('--scope agent:agt_xyz');
  });

  it('falls back to general memory scope when there is no agent id', () => {
    const p = buildScheduledRunPreamble();
    expect(p).toContain('--scope general');
    expect(p).not.toContain('agent:');
  });

  it('does not inject credit/cost figures into the preamble', () => {
    // FEAT-243: cost feedback was removed — the agent has no reference frame for
    // a "good" credit number, so credits live in the UI/ledger, not the prompt.
    const p = buildScheduledRunPreamble('agt_123');
    expect(p).not.toContain('COST CONTEXT');
    expect(p).not.toContain('credits');
  });
});
