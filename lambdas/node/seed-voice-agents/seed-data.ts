// Seed data for Numa Voice agents (FEAT-164/165/166/167) and the Post-Call
// Processor event schedule. Written idempotently at deploy time by index.ts.
//
// Agent ids are deterministic readable strings (the table only requires
// tenant_id+agent_id uniqueness), so re-deploys upsert rather than duplicate.

export const AGENT_IDS = {
  callPrep: 'agt_voice_callprep',
  postCall: 'agt_voice_postcall',
  promoter: 'agt_voice_promoter',
  ingest: 'agt_voice_ingest',
} as const;

// Fixed namespace for deterministic UUIDv5 schedule ids (schedule_id must be a
// UUID per scheduling-schemas, but must also be stable across deploys so the
// idempotent put doesn't create a new schedule every time).
// Valid RFC4122 UUID (variant nibble — 4th group — must be 8/9/a/b). MUST stay
// byte-identical to the copy in infra/constructs/numa-voice-construct.ts so the
// construct's SchedulerSchedule targets the same deterministic callprep id.
export const VOICE_UUID_NAMESPACE = '4f3b2a1c-9d8e-5f6a-8b8c-0d1e2f3a4b5c';

export interface VoiceAgentDef {
  agent_id: string;
  agent_type: string;
  title: string;
  description: string;
  system_prompt: string;
  // Pre-normalised tools_config (we write the table item directly, so this must
  // already match what the agents API's normaliseToolsConfig would produce).
  tools_config: Record<string, unknown>;
  tags: string[];
}

// allowedKnowledgeBases: null means "all KBs" — the schedule runner only enables
// the knowledge_base / numa_files tools when the agent has KB access (hasKBs).
const KB_ALL = null;

// Shared, MANDATORY file-format contract embedded in every Voice agent's system
// prompt. The Voice UI (numa-frontend Services/voiceData.ts) parses these two
// files literally — a wrong top-level shape or field name silently blanks the
// SDR call list. Agents kept drifting (writing today_calls.json as a bare array,
// using prospect_phone/sdr_outcome/etc.), so the rules are now spelled out
// verbatim. This lives in system_prompt (NOT prompt_text) because the schedule
// runner refreshes the agent's system_prompt from the {client}-agents table on
// every run, and the seeder upserts that table — so changes here propagate on
// re-deploy, whereas existing schedule prompt_text does not.
const FILE_FORMAT_CONTRACT = [
  '',
  'NUMA VOICE FILE FORMAT CONTRACT (MANDATORY — the Voice UI parses these files literally):',
  'Two files live in Numa Files / Company Files and their TOP-LEVEL SHAPES DIFFER — never change them:',
  '- master_prospects.json is a BARE JSON ARRAY: [ {prospect}, ... ]. Never an object, never {"prospects": [...]}.',
  '- today_calls.json is a JSON OBJECT: { "generated_at": "<ISO-8601>", "calls": [ {prospect}, ... ] }. Prospects go under the "calls" key. NEVER write today_calls.json as a bare array.',
  'Every {prospect} object uses EXACTLY these snake_case fields and no others:',
  '  REQUIRED: company_name, contact_name, contact_title, phone, industry, company_description, pain_hypothesis (all strings; phone in E.164 like "+6421234567").',
  '  OPTIONAL outcome fields (set only after a call): status, call_outcome, call_summary, call_date, callback_date, qualified (boolean), crm_record_id, objections (array of strings), next_steps (array of strings), call_quality_rating (integer 1-5), call_quality_justification (string), follow_up_talking_points (array of strings). call_outcome MUST be exactly one of: interested | callback | no_answer | not_interested.',
  'NEVER add any field that is not in the lists above. Do NOT use prospect_name, prospect_phone, phone_number, name, company, contact_id, sdr_outcome, transcript_file, transcript_ref, call_time_utc, or call_history. Use contact_name (not prospect_name), phone (not prospect_phone), call_outcome (not sdr_outcome). The structured post-call fields (objections, next_steps, call_quality_rating, call_quality_justification, follow_up_talking_points) ARE allowed and SHOULD each be their own field — do NOT cram them into call_summary.',
  'phone MUST be E.164: a leading +, country code, digits only, no spaces/brackets/dashes. Convert local numbers (drop the national leading 0, add the country code). If the country is unknown, ask rather than guess.',
  'ALWAYS read-modify-write the WHOLE file: download, parse, change only what is needed, then write back in the SAME top-level shape, preserving every existing record. If a file is missing, create master_prospects.json as [] and today_calls.json as {"generated_at": "<ISO>", "calls": []}.',
].join('\n');

export const VOICE_AGENTS: VoiceAgentDef[] = [
  {
    agent_id: AGENT_IDS.callPrep,
    agent_type: 'scheduled',
    title: 'Call List Preparer',
    description: "Prepares the SDR's daily call list each morning from the master prospect list.",
    system_prompt: [
      'You prepare the SDR daily call list for Numa Voice.',
      'Read master_prospects.json from Numa Files (it is a bare JSON array). Select prospects where status is "pending", or status is "callback" and callback_date is today or earlier.',
      'EXCLUDE any prospect whose `qualified` is true — those have already been promoted to the CRM and must NEVER reappear in a call list. Also exclude status "not_interested". When in doubt, leave a prospect OUT rather than re-calling someone already won or lost.',
      'Prioritise DETERMINISTICALLY so the order is reproducible and auditable. Compute a priority score for each selected prospect and sort by it (highest first); break ties by least-recent call_date (oldest first), then by company_name A→Z. Score = (pain_hypothesis is non-empty ? 3 : 0) + (industry is a known non-empty value ? 2 : 0) + (status is "callback" with callback_date due today/earlier ? 2 : 0) + (company_description is non-empty ? 1 : 0) + (never called — no call_date ? 1 : 0). Apply this exact rubric rather than a subjective judgement.',
      'For rows missing company_description, enrich it with a brief web search BEFORE scoring (so the description bonus is fair).',
      'Select the top 20–30 prospects by that score and write them, in that call order, into the "calls" array of today_calls.json (the object { "generated_at", "calls": [...] }). Keep every prospect field exactly as defined in the contract below — do not rename, drop, or add fields, and do not change the top-level shape of either file.',
      FILE_FORMAT_CONTRACT,
    ].join('\n'),
    tools_config: {
      autoToolsEnabled: true,
      queryDataSources: true,
      webSearchEnabled: true,
      createAgentEnabled: false,
      enabledConnections: [],
      enabledIntegrations: [],
      allowedKnowledgeBases: KB_ALL,
    },
    tags: ['numa-voice', 'sdr'],
  },
  {
    agent_id: AGENT_IDS.postCall,
    agent_type: 'task',
    title: 'Post-Call Processor',
    description: 'Summarises a completed SDR call, extracts insights, and updates the prospect record.',
    system_prompt: [
      'You are an SDR call analyst for Numa Voice. In the transcript, spk_0 is the SDR and spk_1 is the prospect.',
      'From the transcript and prospect context, work out: a 3-sentence summary, the objections raised, the agreed next steps, a call-quality rating (1–5), and two follow-up talking points for next time.',
      'Find the matching prospect by phone and update its record in BOTH today_calls.json and master_prospects.json. Set these STRUCTURED fields — each as its own field, do NOT cram them into call_summary: call_summary (3 sentences), call_outcome (exactly one of: interested | callback | no_answer | not_interested), call_date (ISO timestamp), status, objections (array of strings), next_steps (array of strings), call_quality_rating (integer 1-5), call_quality_justification (one line), follow_up_talking_points (array of 2 strings); and callback_date if a callback was agreed.',
      'Read each file by exact filename, modify it, and write it back in its existing top-level shape (today_calls.json stays the { "calls": [...] } object; master_prospects.json stays a bare array) — do not rely on search and do not restructure the file. Be concise and factual; never invent details not supported by the transcript.',
      FILE_FORMAT_CONTRACT,
    ].join('\n'),
    tools_config: {
      autoToolsEnabled: true,
      queryDataSources: true,
      webSearchEnabled: false,
      createAgentEnabled: false,
      enabledConnections: [],
      enabledIntegrations: [],
      allowedKnowledgeBases: KB_ALL,
    },
    tags: ['numa-voice', 'sdr'],
  },
  {
    agent_id: AGENT_IDS.promoter,
    agent_type: 'task',
    title: 'Qualification Promoter',
    description: 'Creates a clean Numa Ops CRM record when an SDR confirms a prospect is qualified.',
    system_prompt: [
      'You promote a qualified SDR prospect into the Numa Ops CRM. Only run for prospects the SDR has explicitly marked as qualified — never create CRM records for cold or unqualified prospects.',
      'Create a Numa Ops CRM customer record with company name, contact details, industry, and the identified pain points. Attach the call summary and transcript. Create a follow-up task on the record capturing the agreed next steps and assign it to the relevant AE.',
      'Write the new crm_record_id back to the prospect row in master_prospects.json and set qualified: true so the prospect is excluded from future call lists.',
    ].join('\n'),
    tools_config: {
      autoToolsEnabled: true,
      queryDataSources: true,
      webSearchEnabled: false,
      createAgentEnabled: false,
      enabledConnections: [],
      enabledIntegrations: [],
      allowedKnowledgeBases: KB_ALL,
    },
    tags: ['numa-voice', 'sdr', 'crm'],
  },
  {
    agent_id: AGENT_IDS.ingest,
    agent_type: 'task',
    title: 'Prospect Ingest',
    description: 'Converts an uploaded prospect spreadsheet into the master_prospects.json format.',
    system_prompt: [
      'You ingest prospect spreadsheets for Numa Voice. Given an uploaded .xlsx file, parse the rows and map columns to the prospect schema: company_name, contact_name, contact_title, phone (E.164), industry, company_description, pain_hypothesis, status, call_outcome, call_summary, call_date, callback_date, qualified, crm_record_id.',
      'If the industry field is missing, infer it DETERMINISTICALLY from the company description using this exact keyword map (count case-insensitive keyword hits per industry; pick the industry with the most hits; on a tie pick the one listed first here; if zero hits use "general"): construction = construction/builder/building/contractor/civil/infrastructure/roading/concrete; engineering = engineering/engineer/mechanical/electrical/fabrication/manufacturing/industrial; consulting = consulting/consultant/advisory/advisor/strategy; professional = accounting/accountant/law/legal/lawyer/solicitor/architect/surveyor/finance; healthcare = health/healthcare/medical/clinic/dental/pharmacy/aged care/hospital; technology = software/saas/technology/it services/tech/platform/data/cyber; property = property/real estate/realty/realtor/leasing/facilities; retail = retail/ecommerce/e-commerce/store/shop/wholesale/distribution; hospitality = hospitality/hotel/restaurant/cafe/catering/tourism/accommodation. Set all new records to status: "pending".',
      'Append the new records to master_prospects.json (a bare JSON array) in Numa Files — never overwrite existing records, and keep the file a bare array — then report the count of records added.',
      FILE_FORMAT_CONTRACT,
    ].join('\n'),
    tools_config: {
      autoToolsEnabled: true,
      queryDataSources: true,
      webSearchEnabled: false,
      createAgentEnabled: false,
      enabledConnections: [],
      enabledIntegrations: [],
      allowedKnowledgeBases: KB_ALL,
    },
    tags: ['numa-voice', 'sdr'],
  },
];

// Prompt for the seeded Post-Call Processor event schedule. The {{ event.* }}
// placeholders are interpolated by the runner's `connect` source branch (added
// with the native-source wiring); until then the schedule simply exists.
export const POST_CALL_PROMPT = [
  'A call has just completed for contact {{ event.contact_id }} (prospect phone {{ event.prospect_phone }}). The SDR marked the outcome "{{ event.sdr_outcome }}" with notes: {{ event.sdr_notes }}. qualified = {{ event.qualified }}.',
  'Download the diarised transcript from Numa Files: file "{{ event.transcript_kb_file }}" in knowledge base "{{ event.kb_id }}" (spk_0 = SDR, spk_1 = prospect). If transcription_failed is true or no transcript_kb_file is provided, proceed using only the SDR outcome + notes and note that no transcript was available.',
  'Identify the prospect in master_prospects.json (and today_calls.json) by phone ({{ event.prospect_phone }}). If no phone is present, fall back to the most recent today_calls.json entry for contact id {{ event.contact_id }}. If you still cannot confidently match a prospect, do NOT guess — record the summary against the contact id and note that the prospect could not be matched.',
  'Then follow your system instructions: summarise, extract objections and next steps, rate the call, suggest follow-ups, and update the matched prospect record in master_prospects.json + today_calls.json. Set these as SEPARATE structured fields (do NOT cram them into call_summary): call_summary, call_date, status, call_outcome (map {{ event.sdr_outcome }} to exactly one of: interested | callback | no_answer | not_interested), objections (array of strings), next_steps (array of strings), call_quality_rating (integer 1-5), call_quality_justification (one line), and follow_up_talking_points (array of 2 strings). If a callback was agreed, also set callback_date.',
  'You are the SINGLE writer for this prospect record this call. Qualification promotion runs ONLY if qualified is explicitly the literal true — NOT false, and NOT null/empty. A null/absent qualified means the SDR wrap-up was never captured: in that case do NOT promote, and note in the summary that the wrap-up was missing so a human can follow up. When qualified is explicitly true AND the Numa Ops tool is available to you, create the Numa Ops CRM customer record (attach the summary + transcript, add a follow-up task, assign the AE), write the returned crm_record_id back to the prospect, and set qualified: true. If the Numa Ops tool is NOT available, do NOT fail — still set qualified: true (so the prospect is excluded from future call lists) and note in call_summary that the prospect is qualified and awaiting manual CRM entry. Do all prospect-record edits in one read-modify-write so nothing is lost.',
  'CRITICAL FILE SHAPE: keep today_calls.json as the { "calls": [...] } object and master_prospects.json as a bare array; set only the prospect fields defined in the file format contract (including the structured outcome fields objections, next_steps, call_quality_rating, call_quality_justification, follow_up_talking_points). Never write today_calls.json as a bare array, and never add non-contract fields like prospect_phone, sdr_outcome, or contact_id. Follow the file format contract in your instructions exactly.',
].join('\n');

// NOTE: the Qualification Promoter no longer has its own event schedule (it
// caused a lost-update race with the Post-Call agent on master_prospects.json).
// The qualified→CRM promotion is folded into POST_CALL_PROMPT so a single agent
// is the sole writer per call. The promoter AGENT remains seeded for manual use.

// Prompt for the seeded Call List Preparer cron schedule (fired each morning by
// the SchedulerSchedule in NumaVoiceConstruct via a {type:'SCHEDULE'} runner event).
export const CALL_PREP_PROMPT =
  'Prepare today\'s SDR call list now: read master_prospects.json, select and prioritise today\'s prospects per your instructions, and write the ordered list into the "calls" array of today_calls.json (the { "generated_at", "calls": [...] } object). EXCLUDE any prospect with qualified=true (already in the CRM) or status "not_interested". Follow the file format contract in your instructions exactly — correct snake_case field names, E.164 phones, and both file shapes unchanged. Never write today_calls.json as a bare array.';

// Prompt for the seeded Prospect Ingest event schedule (fired by the intake
// emitter's numa.connector.connect / 'prospects.uploaded' event).
export const INGEST_PROMPT = [
  'A prospect spreadsheet has been uploaded. Download {{ event.intake_file }} from Numa Files (kb {{ event.kb_id }}), parse it, and append the new prospects to master_prospects.json per your instructions.',
  'Set new records to status "pending"; do not overwrite existing prospects. Keep master_prospects.json a bare JSON array and use the exact snake_case prospect field names (contact_name, phone in E.164, etc.) per the file format contract in your instructions. Report how many were added.',
].join('\n');
