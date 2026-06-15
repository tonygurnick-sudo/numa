/**
 * Numa Voice — shared frontend type contracts.
 *
 * Data model for the Amazon Connect outbound calling surface (SDR cold-calling).
 * These types are the single source of truth shared across the Voice page,
 * the prospect table, the CCP softphone, the wrap-up panel, and the live
 * assist panel. Keep them in lockstep with the S3 record shapes produced by
 * the backend processors (master_prospects.json / today_calls.json /
 * sdr_playbook.json) and consumed by the post-call outcome processor.
 */

/**
 * Possible outcomes recorded by the SDR at the end of a call.
 * - interested      → prospect wants to proceed / book a follow-up
 * - callback        → prospect asked to be called back later (see callback_date)
 * - no_answer       → no one picked up / went to voicemail
 * - not_interested  → explicit decline
 */
export type CallOutcome = 'interested' | 'callback' | 'no_answer' | 'not_interested';

/**
 * A single prospect record.
 *
 * Sourced from master_prospects.json and surfaced in today_calls.json as the
 * ordered daily call list. Fields after `pain_hypothesis` are populated/updated
 * by the post-call outcome processor and may be absent before the first call.
 */
export interface Prospect {
  /** Company / organisation name. */
  company_name: string;
  /** Primary contact's full name. */
  contact_name: string;
  /** Contact's job title. */
  contact_title: string;
  /** Phone number in E.164 format (e.g. "+6421234567"). */
  phone: string;
  /** Industry vertical — used to select the matching playbook panel. */
  industry: string;
  /** Short blurb about the company. */
  company_description: string;
  /** Hypothesised pain point to anchor the pitch. */
  pain_hypothesis: string;
  /** Pipeline status (free-form, e.g. "new" | "called" | "qualified"). */
  status?: string;
  /** Outcome of the most recent call, if any. */
  call_outcome?: CallOutcome;
  /** Free-text summary of the most recent call. */
  call_summary?: string;
  /** ISO timestamp of the most recent call. */
  call_date?: string;
  /** ISO date the prospect asked to be called back, if outcome === 'callback'. */
  callback_date?: string;
  /** Whether the prospect has been qualified by the SDR. */
  qualified?: boolean;
  /** ID of the CRM record created/linked for this prospect, if any. */
  crm_record_id?: string;
  /** Objections the prospect raised on the most recent call (post-call processor). */
  objections?: string[];
  /** Agreed next steps from the most recent call (post-call processor). */
  next_steps?: string[];
  /** Call-quality rating 1–5 from the most recent call (post-call processor). */
  call_quality_rating?: number;
  /** One-line justification for the call-quality rating (post-call processor). */
  call_quality_justification?: string;
  /** Two suggested talking points for the next call (post-call processor). */
  follow_up_talking_points?: string[];
  /** Prospect's AI maturity, assessed from the call (post-call processor).
   *  One of: beginner | intermediate | advanced | enterprise. */
  ai_maturity?: string;
  /** The decision-maker / economic buyer identified on the call (name + title). */
  champion?: string;
  /** Recommended discovery questions for the AE to ask next (post-call processor). */
  discovery_questions?: string[];
  /** Pain points confirmed on the call (distinct from the pre-call pain_hypothesis). */
  pain_points?: string[];
  /** CRM lifecycle stage — set to "Prospect" on qualification promotion. */
  lifecycle_stage?: string;
  /** The AE this qualified prospect was handed to (name/email). */
  assigned_ae?: string;
}

/**
 * The ordered daily call list, read from
 * documents/company/today_calls.json in the data bucket (company KB root).
 */
export interface TodayCalls {
  /** ISO timestamp the list was generated, if provided by the backend. */
  generated_at?: string;
  /** Prospects to call today, in dial order. */
  calls: Prospect[];
}

/**
 * A single objection-handling entry within an industry playbook panel.
 */
export interface PlaybookObjection {
  /** Short human label for the objection (e.g. "Too expensive"). */
  label: string;
  /** Suggested SDR response. */
  response: string;
  /** Keywords that hint this objection is being raised on the call. */
  keywords: string[];
}

/**
 * The playbook content for one industry vertical.
 */
export interface IndustryPanel {
  /** Discovery questions to ask the prospect. */
  discovery_questions: string[];
  /** Objection → response pairs with trigger keywords. */
  objections: PlaybookObjection[];
  /** Opening hook lines to grab attention. */
  hook_lines: string[];
  /** Buying/deal signals to watch for and check off during the call. */
  deal_signals?: string[];
}

/**
 * The full SDR playbook, read from
 * documents/company/sdr_playbook.json in the data bucket (company KB root).
 *
 * `industries` is keyed by industry slug (construction, engineering,
 * consulting, professional, general, ...). Use the 'general' panel as the
 * fallback when a prospect's industry has no dedicated entry.
 */
export interface SdrPlaybook {
  /** Per-industry playbook panels, keyed by industry slug. */
  industries: Record<string, IndustryPanel>;
  /** Optional global basics (intro framing, etc.). */
  basics?: Record<string, unknown>;
  /** Optional lunch / scheduling guidance block. */
  lunch?: Record<string, unknown>;
}

/**
 * The wrap-up outcome the SDR submits after a call.
 *
 * Written to voice/outcomes/{contactId}.json in the OUTPUTS bucket. The
 * post-call processor reads it back by contactId.
 */
export interface WrapUpOutcome {
  /** Amazon Connect contact ID for the call. */
  contactId: string;
  /** Disposition selected by the SDR. */
  outcome: CallOutcome;
  /** Free-text call notes. */
  notes: string;
  /** Whether the SDR marked the prospect as qualified. */
  qualified: boolean;
  /** The dialled E.164 number — REQUIRED: it is the join key the post-call
   *  processor uses to match the outcome back to a prospect record. */
  prospect_phone: string;
  /** ISO timestamp the outcome was submitted. */
  submitted_at: string;
  /** Recording-consent audit: whether the SDR attested they told the prospect the
   *  call was being recorded. Persisted on the per-call outcome record (the audit
   *  artifact at voice/outcomes/{contactId}.json). */
  recording_disclosed?: boolean;
  /** SDR (Connect agent) identity — the logged-in Numa user who placed the call.
   *  The processor maps these into the vCon's SDR party, and they route the
   *  post-call "summary ready" notification. Optional: legacy outcomes lack them
   *  and the backend degrades gracefully. `agent_id` mirrors the Connect username
   *  (derived from email under per-user federation). */
  agent_id?: string;
  agent_email?: string;
  agent_name?: string;
  /** Cognito sub of the SDR — stable id for notification routing. */
  sdr_sub?: string;
  /** Prospect identity, carried so the processor can populate the vCon's prospect
   *  party (Company / contact columns in the call log) without re-matching. */
  company_name?: string;
  contact_name?: string;
  /** Account Executive the SDR hands a qualified prospect to (Phase 2). Set the
   *  CRM customer owner + routes the hand-off notification/email. Sub is the stable
   *  routing id; email for the email; name for display. */
  assigned_ae_sub?: string;
  assigned_ae_name?: string;
  assigned_ae_email?: string;
}

/**
 * A pre-wrap-up STUB written to voice/outcomes/{contactId}.json the moment a call
 * ends — so the dialled number, prospect company, and SDR identity are captured
 * even when the SDR closes without completing the wrap-up (e.g. a voicemail). It
 * deliberately omits the SDR's disposition/qualification: the processor treats a
 * missing `outcome` as "wrap-up not captured" and never promotes. A later full
 * {@link WrapUpOutcome} save overwrites the same key with the complete record.
 */
export interface CallOutcomeStub {
  contactId: string;
  prospect_phone: string;
  company_name?: string;
  contact_name?: string;
  recording_disclosed?: boolean;
  agent_id?: string;
  agent_email?: string;
  agent_name?: string;
  sdr_sub?: string;
}
