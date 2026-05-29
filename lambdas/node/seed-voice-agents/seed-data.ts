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

export const VOICE_AGENTS: VoiceAgentDef[] = [
  {
    agent_id: AGENT_IDS.callPrep,
    agent_type: 'scheduled',
    title: 'Call List Preparer',
    description: "Prepares the SDR's daily call list each morning from the master prospect list.",
    system_prompt: [
      'You prepare the SDR daily call list for Numa Voice.',
      'Read master_prospects.json from Numa Files. Select prospects where status is "pending", or status is "callback" and callback_date is today or earlier.',
      'Prioritise by completeness of pain_hypothesis, industry fit, and least-recent last contact. For rows missing company_description, enrich it with a brief web search.',
      'Select the top 20–30 prospects and write them, in call order, to today_calls.json in Numa Files. Keep the master_prospects.json schema fields intact.',
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
      'Given the call transcript and prospect context, produce: (1) a 3-sentence summary; (2) the objections the prospect raised; (3) the agreed next steps; (4) a call-quality rating 1–5 with a one-line justification; (5) two follow-up talking points for the next call.',
      'Then update the prospect record in today_calls.json and master_prospects.json (Numa Files): set call_summary, call_date, and status. If a callback was agreed, set callback_date.',
      'Read the record by exact filename, modify it, and write it back — do not rely on search. Be concise and factual; never invent details not supported by the transcript.',
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
      'You ingest prospect spreadsheets for Numa Voice. Given an uploaded .xlsx file, parse the rows and map columns to the master_prospects.json schema: company_name, contact_name, contact_title, phone (E.164), industry, company_description, pain_hypothesis, status, call_outcome, call_summary, call_date, callback_date, qualified, crm_record_id.',
      'If the industry field is missing, infer it from the company description using industry keyword matching. Set all new records to status: "pending".',
      'Append the new records to master_prospects.json in Numa Files — never overwrite existing records — and report the count of records added.',
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
  'Follow your system instructions: summarise, extract objections and next steps, rate the call, suggest follow-ups, and update the prospect record in master_prospects.json + today_calls.json — match the prospect by phone ({{ event.prospect_phone }}).',
  'You are the SINGLE writer for this prospect record this call — so if (and only if) qualified is true, ALSO perform the qualification promotion in the same run: if Numa Ops is available, create the Numa Ops CRM customer record (attach the summary + transcript, add a follow-up task, assign the AE) and write crm_record_id back; either way set qualified: true. Do all prospect-record edits in one read-modify-write so nothing is lost.',
].join('\n');

// NOTE: the Qualification Promoter no longer has its own event schedule (it
// caused a lost-update race with the Post-Call agent on master_prospects.json).
// The qualified→CRM promotion is folded into POST_CALL_PROMPT so a single agent
// is the sole writer per call. The promoter AGENT remains seeded for manual use.

// Prompt for the seeded Call List Preparer cron schedule (fired each morning by
// the SchedulerSchedule in NumaVoiceConstruct via a {type:'SCHEDULE'} runner event).
export const CALL_PREP_PROMPT =
  "Prepare today's SDR call list now: read master_prospects.json, select and prioritise today's prospects per your instructions, and write the ordered list to today_calls.json.";

// Prompt for the seeded Prospect Ingest event schedule (fired by the intake
// emitter's numa.connector.connect / 'prospects.uploaded' event).
export const INGEST_PROMPT = [
  'A prospect spreadsheet has been uploaded. Download {{ event.intake_file }} from Numa Files (kb {{ event.kb_id }}), parse it, and append the new prospects to master_prospects.json per your instructions.',
  'Set new records to status "pending"; do not overwrite existing prospects. Report how many were added.',
].join('\n');
