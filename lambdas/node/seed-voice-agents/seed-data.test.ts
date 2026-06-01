import { describe, it, expect } from 'vitest';
import { v5 as uuidv5, validate as uuidValidate } from 'uuid';
import { VOICE_UUID_NAMESPACE, AGENT_IDS, POST_CALL_PROMPT, INGEST_PROMPT, VOICE_AGENTS } from './seed-data';

describe('VOICE_UUID_NAMESPACE', () => {
  it('is a valid RFC4122 UUID with an 8/9/a/b variant nibble', () => {
    expect(uuidValidate(VOICE_UUID_NAMESPACE)).toBe(true);
    expect('89ab').toContain(VOICE_UUID_NAMESPACE[19]); // variant nibble must be 8/9/a/b
  });

  it('produces a STABLE call-prep schedule id — guards against namespace drift', () => {
    // If this literal changes, the seeded schedule id and the construct's
    // SchedulerSchedule target diverge -> silent no-op at 7:30am. The construct
    // computes the same uuidv5(`callprep-${client}`, VOICE_UUID_NAMESPACE).
    expect(uuidv5('callprep-arcanum-demo-tony', VOICE_UUID_NAMESPACE)).toBe('04fca325-7203-5103-87c8-ec635ade6b02');
  });
});

describe('seeded agent + prompt contracts', () => {
  it('has stable agent ids', () => {
    expect(AGENT_IDS.callPrep).toBe('agt_voice_callprep');
    expect(AGENT_IDS.postCall).toBe('agt_voice_postcall');
    expect(AGENT_IDS.ingest).toBe('agt_voice_ingest');
  });

  it('post-call prompt references the event join keys it consumes', () => {
    expect(POST_CALL_PROMPT).toContain('{{ event.prospect_phone }}');
    expect(POST_CALL_PROMPT).toContain('{{ event.contact_id }}');
    expect(POST_CALL_PROMPT).toContain('{{ event.transcript_kb_file }}');
    // explicit-true qualification (the audit blocker fix)
    expect(POST_CALL_PROMPT).toMatch(/explicitly the literal true/i);
  });

  it('ingest prompt references the intake_file placeholder', () => {
    expect(INGEST_PROMPT).toContain('{{ event.intake_file }}');
  });

  it('every voice agent has a non-empty system prompt + tools_config', () => {
    for (const a of VOICE_AGENTS) {
      expect(a.system_prompt.length).toBeGreaterThan(0);
      expect(a.tools_config).toBeTruthy();
    }
  });
});
