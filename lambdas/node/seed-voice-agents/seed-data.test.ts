import { describe, it, expect } from 'vitest';
import { v5 as uuidv5, validate as uuidValidate } from 'uuid';
import { ScheduleRecordSchema } from '../../../lib/scheduling-schemas';
import {
  VOICE_UUID_NAMESPACE,
  AGENT_IDS,
  POST_CALL_PROMPT,
  CALL_PREP_PROMPT,
  INGEST_PROMPT,
  VOICE_AGENTS,
} from './seed-data';

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

  it('Call List Preparer excludes already-qualified prospects (FEAT-166)', () => {
    const callPrep = VOICE_AGENTS.find((a) => a.agent_id === AGENT_IDS.callPrep);
    expect(callPrep).toBeTruthy();
    expect(callPrep!.system_prompt).toMatch(/EXCLUDE any prospect whose `?qualified`? is true/i);
    expect(CALL_PREP_PROMPT).toMatch(/exclude.*qualified=true/i);
  });

  it('Post-Call still sets qualified when Numa Ops tool is unavailable (FEAT-166 availability)', () => {
    expect(POST_CALL_PROMPT).toMatch(/Numa Ops tool is NOT available/i);
    expect(POST_CALL_PROMPT).toMatch(/still set qualified: true/i);
  });

  it('Post-Call writes STRUCTURED outcome fields, not a folded call_summary (FEAT-165)', () => {
    // The agent must emit objections/next_steps/rating/justification/talking-points
    // as their OWN fields — the regression here is the old "fold into call_summary" rule.
    for (const field of ['objections', 'next_steps', 'call_quality_rating', 'follow_up_talking_points']) {
      expect(POST_CALL_PROMPT).toContain(field);
    }
    expect(POST_CALL_PROMPT).toMatch(/do NOT cram them into call_summary/i);
    // The old fold-everything-into-call_summary instruction must be gone.
    expect(POST_CALL_PROMPT).not.toMatch(/fold any objections.*into call_summary/i);
  });

  it('file-format contract allows the structured fields and no longer bans them (FEAT-165)', () => {
    const postCall = VOICE_AGENTS.find((a) => a.agent_id === AGENT_IDS.postCall);
    expect(postCall).toBeTruthy();
    const sp = postCall!.system_prompt;
    // The OPTIONAL outcome fields line now enumerates the structured fields.
    expect(sp).toMatch(/OPTIONAL outcome fields[^\n]*objections \(array of strings\)/);
    expect(sp).toMatch(/call_quality_rating \(integer 1-5\)/);
    // They must NOT appear in the banned-field sentence any more (scope to the
    // "Do NOT use … ." sentence — objections is now mentioned positively elsewhere).
    const bannedSentence = sp.match(/Do NOT use[^.]*\./)?.[0] ?? '';
    expect(bannedSentence).not.toContain('objections');
    expect(bannedSentence).not.toContain('call_quality_rating');
  });

  it('Call List Preparer uses a DETERMINISTIC, auditable priority rubric (FEAT-164)', () => {
    const callPrep = VOICE_AGENTS.find((a) => a.agent_id === AGENT_IDS.callPrep);
    expect(callPrep).toBeTruthy();
    const sp = callPrep!.system_prompt;
    expect(sp).toMatch(/Prioritise DETERMINISTICALLY/i);
    expect(sp).toMatch(/priority score/i);
    // The exact weighting must be spelled out so the order is reproducible.
    expect(sp).toMatch(/pain_hypothesis is non-empty \? 3 : 0/);
    expect(sp).toMatch(/break ties/i);
  });

  it('Prospect ingest uses a DETERMINISTIC industry keyword map (FEAT-167)', () => {
    const ingest = VOICE_AGENTS.find((a) => a.agent_id === AGENT_IDS.ingest);
    expect(ingest).toBeTruthy();
    const sp = ingest!.system_prompt;
    expect(sp).toMatch(/infer it DETERMINISTICALLY/i);
    expect(sp).toMatch(/most hits/i);
    // A couple of canonical slugs from the shared map must be present.
    expect(sp).toMatch(/construction =/);
    expect(sp).toMatch(/healthcare =/);
  });

  // The seed lambda runs as a Terraform aws_lambda_invocation at the END of a
  // client deploy — a prompt over the record-schema cap fails the whole deploy
  // (validateScheduleRecord throws). Catch it here, not mid-deploy.
  it('every seeded schedule prompt fits the ScheduleRecordSchema prompt_text cap', () => {
    const promptTextField = ScheduleRecordSchema.innerType().shape.prompt_text;
    for (const [name, prompt] of Object.entries({ POST_CALL_PROMPT, CALL_PREP_PROMPT, INGEST_PROMPT })) {
      const parsed = promptTextField.safeParse(prompt);
      expect(parsed.success, `${name} is ${prompt.length} chars — exceeds the schedule prompt_text cap`).toBe(true);
    }
  });

  it('every voice agent has a non-empty system prompt + tools_config', () => {
    for (const a of VOICE_AGENTS) {
      expect(a.system_prompt.length).toBeGreaterThan(0);
      expect(a.tools_config).toBeTruthy();
    }
  });

  // The file-format contract is what stops the agents corrupting today_calls.json
  // (bare array / prospect_phone / sdr_outcome). It MUST be embedded in the file-
  // writing agents' system_prompt — that is the field the schedule runner refreshes
  // from the agents table each run, so it is what actually propagates on re-deploy.
  describe('file-format contract is embedded in the file-writing agents', () => {
    const fileWriters = [AGENT_IDS.callPrep, AGENT_IDS.postCall, AGENT_IDS.ingest];

    for (const id of fileWriters) {
      it(`${id} system_prompt carries the file-format contract`, () => {
        const agent = VOICE_AGENTS.find((a) => a.agent_id === id);
        expect(agent, `agent ${id} should exist`).toBeTruthy();
        const sp = agent!.system_prompt;
        // today_calls.json wrapper rule (the bug that blanked the list)
        expect(sp).toContain('today_calls.json is a JSON OBJECT');
        expect(sp).toContain('NEVER write today_calls.json as a bare array');
        // master_prospects.json bare-array rule
        expect(sp).toContain('master_prospects.json is a BARE JSON ARRAY');
        // correct field names + the banned drift names
        expect(sp).toContain('contact_name (not prospect_name)');
        expect(sp).toMatch(/Do NOT use prospect_name, prospect_phone/);
        // E.164 requirement
        expect(sp).toContain('phone MUST be E.164');
      });
    }
  });
});
