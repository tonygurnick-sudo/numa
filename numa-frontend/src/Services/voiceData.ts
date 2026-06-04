/**
 * Numa Voice — direct-S3 data helpers.
 *
 * No backend API: the Voice surface reads its working data straight from the
 * per-client DATA bucket and writes SDR wrap-up outcomes straight to the
 * OUTPUTS bucket, using the caller's STS credentials. This mirrors the
 * direct-S3 pattern in ChatReferencesDropdown / fileIgnoreList:
 * withPRM(S3Client, { region, credentials }) + GetObjectCommand /
 * PutObjectCommand, region/buckets from sessionStorage.
 *
 * `credentials` is the object returned by useAuth().getCredentials() — pass it
 * in from the component layer (do NOT call getCredentials in here, so callers
 * control credential freshness / null-handling).
 */
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { withPRM } from '../utils/prmUtils';
import type { CallOutcome, Prospect, TodayCalls, SdrPlaybook, WrapUpOutcome } from '../types/voice';

/** S3 key prefix for Voice data files inside the DATA bucket. The company KB
 *  maps to `documents/company/`; the agents write today_calls.json /
 *  master_prospects.json there via numa_files (bare filenames → KB root), and
 *  sdr_playbook.json is uploaded to the same root, so the FE reads from there. */
const VOICE_DATA_PREFIX = 'documents/company';
/** S3 key prefix for SDR wrap-up outcomes inside the OUTPUTS bucket. */
const VOICE_OUTCOMES_PREFIX = 'voice/outcomes';

// Exported so tests can assert the producer/consumer S3 contract (these keys are
// shared with the voice lambdas + scheduled agents — drift = silent no-op).
export const TODAY_CALLS_KEY = `${VOICE_DATA_PREFIX}/today_calls.json`;
export const MASTER_PROSPECTS_KEY = `${VOICE_DATA_PREFIX}/master_prospects.json`;
export const PLAYBOOK_KEY = `${VOICE_DATA_PREFIX}/sdr_playbook.json`;

/** Read a required sessionStorage value, throwing a clear, actionable error
 *  (names the key + suggests re-login) when it's absent — these are populated at
 *  login by ConfigSetup, so a missing one means a stale/cleared session. */
function requireSession(key: string): string {
  const value = window.sessionStorage.getItem(key);
  if (!value) {
    throw new Error(`Voice: ${key} missing from sessionStorage — sign out and back in to refresh your session.`);
  }
  return value;
}

const getRegion = (): string => requireSession('REGION');
const getDataBucket = (): string => requireSession('DATA_BUCKET');
const getOutputsBucket = (): string => requireSession('OUTPUTS_BUCKET_NAME');

function makeClient(credentials: AwsCredentialIdentity, region: string): S3Client {
  // getCredentials() can return null (expired/not-ready session). Fail with a
  // clear message rather than passing undefined creds into the SDK and getting
  // an opaque signing error.
  if (!credentials) {
    throw new Error('Voice: AWS credentials not available');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withPRM(S3Client as any, { region, credentials }) as S3Client;
}

/** Read + JSON-parse an object from a bucket. Returns null if the object is missing. */
async function readJson<T>(credentials: AwsCredentialIdentity, bucket: string, key: string): Promise<T | null> {
  const region = getRegion();
  const client = makeClient(credentials, region);
  // ResponseCacheControl forces a fresh fetch — the data bucket sets no
  // Cache-Control, so without this the browser can serve a stale copy and the
  // call list looks like it "didn't update" after a chat/KB edit.
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, ResponseCacheControl: 'no-cache' })
  );
  const text = await response.Body?.transformToString();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    // Distinguish corrupted content from a missing object (NoSuchKey) — name the
    // exact S3 location so a bad write is diagnosable instead of an opaque parse error.
    throw new Error(`Voice: failed to parse JSON at s3://${bucket}/${key}: ${(err as Error).message}`);
  }
}

/** Trim a value to a string, or '' if it isn't a usable string. */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Coerce a value to a non-empty array of trimmed strings, or undefined. */
function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

/**
 * Normalise a phone string for dialling: strip spacing/punctuation and convert a
 * leading international "00" prefix to "+". Deliberately does NOT guess a country
 * code — a bare local number stays local (and is surfaced as not-diallable in the
 * UI) rather than being silently mis-dialled under an assumed country.
 */
export function normalizePhone(value: unknown): string {
  const raw = str(value);
  if (!raw) return '';
  let cleaned = raw.replace(/[\s().-]/g, '');
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  return cleaned;
}

/**
 * E.164: a leading "+", country code (no leading 0), 2–15 digits total. This is
 * the SINGLE source of truth for "can this number be dialled", shared by the
 * focus card's Call CTA and the prospect table's dial guard (previously each had
 * its own copy of the regex). The CCP rejects anything else.
 */
export const E164_REGEX = /^\+[1-9]\d{1,14}$/;
export function isDiallable(phone: string | undefined | null): boolean {
  return !!phone && E164_REGEX.test(phone);
}

/** Allowed call-outcome values (mirrors the CallOutcome union); anything else is dropped. */
const VALID_OUTCOMES: ReadonlySet<string> = new Set<string>(['interested', 'callback', 'no_answer', 'not_interested']);

/**
 * Coerce a raw record from the JSON files into a Prospect.
 *
 * The producers are agents/LLMs writing free-form JSON into Company Files, so the
 * read path is defensive: we normalise the phone and tolerate a small set of
 * well-known field-name drift (e.g. `prospect_name` → `contact_name`) so a slightly
 * off write doesn't silently render a blank row. The canonical field always wins; an
 * alias only fills a missing canonical value. This is a safety net, NOT a licence to
 * drift — producers must still follow the `Prospect` contract (see types/voice.ts and
 * the numa-voice workspace skill).
 */
export function sanitizeProspect(raw: unknown): Prospect {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = str(r[key]);
      if (value) return value;
    }
    return '';
  };
  // Build EXACTLY the Prospect contract — no spread of `r`, so arbitrary/wrong
  // producer fields (contact_id, sdr_outcome, prospect_phone, objections, …) can
  // never leak through with unvalidated types.
  const prospect: Prospect = {
    company_name: pick('company_name', 'company'),
    contact_name: pick('contact_name', 'prospect_name', 'name', 'full_name'),
    contact_title: pick('contact_title', 'title', 'job_title'),
    phone: normalizePhone(r.phone ?? r.prospect_phone ?? r.phone_number ?? r.phoneNumber ?? r.mobile),
    industry: str(r.industry),
    company_description: str(r.company_description),
    pain_hypothesis: pick('pain_hypothesis', 'pain'),
  };
  // Optional outcome fields — set only when present AND valid (validated, not trusted).
  const status = str(r.status);
  if (status) prospect.status = status;
  const outcome = str(r.call_outcome);
  if (VALID_OUTCOMES.has(outcome)) prospect.call_outcome = outcome as CallOutcome;
  const callSummary = str(r.call_summary);
  if (callSummary) prospect.call_summary = callSummary;
  const callDate = str(r.call_date);
  if (callDate) prospect.call_date = callDate;
  const callbackDate = str(r.callback_date);
  if (callbackDate) prospect.callback_date = callbackDate;
  if (typeof r.qualified === 'boolean') prospect.qualified = r.qualified;
  const crmId = str(r.crm_record_id);
  if (crmId) prospect.crm_record_id = crmId;
  // Structured post-call outputs (FEAT-165) — validated arrays / bounded rating.
  const objections = strArray(r.objections);
  if (objections) prospect.objections = objections;
  const nextSteps = strArray(r.next_steps);
  if (nextSteps) prospect.next_steps = nextSteps;
  if (typeof r.call_quality_rating === 'number' && r.call_quality_rating >= 1 && r.call_quality_rating <= 5) {
    prospect.call_quality_rating = r.call_quality_rating;
  }
  const cqj = str(r.call_quality_justification);
  if (cqj) prospect.call_quality_justification = cqj;
  const followUps = strArray(r.follow_up_talking_points);
  if (followUps) prospect.follow_up_talking_points = followUps;
  return prospect;
}

/** A prospect is usable if it has at least one of company/contact/phone to show. */
function hasIdentity(prospect: Prospect): boolean {
  return !!(prospect.company_name || prospect.contact_name || prospect.phone);
}

/**
 * Sanitise an array of raw prospect records: coerce each, drop identity-less rows,
 * then DEDUPE by E.164 phone (first wins). Duplicate phones otherwise collide in
 * the page's per-phone outcome overlay — saving one prospect's outcome would apply
 * it to the other. Warns (never silently truncates) so a malformed/duplicate write
 * is diagnosable from the console.
 */
function sanitizeProspectList(raw: unknown[], source: string): Prospect[] {
  const all = raw.map(sanitizeProspect);
  const usable = all.filter(hasIdentity);
  const malformed = all.length - usable.length;

  const seenPhones = new Set<string>();
  const deduped: Prospect[] = [];
  let duplicates = 0;
  for (const p of usable) {
    if (p.phone) {
      if (seenPhones.has(p.phone)) {
        duplicates += 1;
        continue;
      }
      seenPhones.add(p.phone);
    }
    deduped.push(p);
  }

  if (malformed > 0) {
    console.warn(
      `Numa Voice: dropped ${String(malformed)} malformed record(s) from ${source} (no company_name/contact_name/phone).`
    );
  }
  if (duplicates > 0) {
    console.warn(`Numa Voice: dropped ${String(duplicates)} duplicate-phone record(s) from ${source} (first wins).`);
  }
  return deduped;
}

/**
 * Load the ordered daily call list from the DATA bucket.
 * Returns an empty list (no prospects) if the file does not exist yet.
 */
/**
 * Normalise a parsed today_calls.json payload into a TodayCalls.
 *
 * Tolerates BOTH the canonical wrapper `{ calls: [...] }` and a bare top-level
 * array `[...]`. Producers (the interactive chat agent AND the seeded Voice
 * agents) have in practice written today_calls.json as a bare array; that
 * previously slipped through as `data.calls === undefined` and silently blanked
 * the ENTIRE call list — every prospect vanished, not just the newly added one.
 * Records are then sanitised (field-name drift tolerated, phone normalised,
 * identity-less rows dropped). Pure + exported so the exact failure is testable.
 */
export function normalizeTodayCalls(data: unknown): TodayCalls {
  const asObj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Partial<TodayCalls>) : null;
  const rawCalls: unknown[] | null = Array.isArray(data) ? data : Array.isArray(asObj?.calls) ? asObj.calls : null;
  if (!rawCalls) return { calls: [] };
  return { generated_at: asObj?.generated_at, calls: sanitizeProspectList(rawCalls, 'today_calls.json') };
}

export async function loadTodayCalls(credentials: AwsCredentialIdentity): Promise<TodayCalls> {
  try {
    const data = await readJson<unknown>(credentials, getDataBucket(), TODAY_CALLS_KEY);
    if (data === null) return { calls: [] };
    return normalizeTodayCalls(data);
  } catch (error) {
    // Treat a missing object as an empty list; surface anything else.
    if (isNoSuchKey(error)) return { calls: [] };
    throw error;
  }
}

/**
 * Load the full master prospect roster from the DATA bucket.
 * Returns an empty array if the file does not exist yet.
 */
export async function loadMasterProspects(credentials: AwsCredentialIdentity): Promise<Prospect[]> {
  try {
    const data = await readJson<Prospect[]>(credentials, getDataBucket(), MASTER_PROSPECTS_KEY);
    return Array.isArray(data) ? sanitizeProspectList(data, 'master_prospects.json') : [];
  } catch (error) {
    if (isNoSuchKey(error)) return [];
    throw error;
  }
}

/**
 * Load the SDR playbook from the DATA bucket.
 * Returns an empty (industries-only) playbook if the file does not exist yet.
 */
export async function loadPlaybook(credentials: AwsCredentialIdentity): Promise<SdrPlaybook> {
  try {
    const data = await readJson<SdrPlaybook>(credentials, getDataBucket(), PLAYBOOK_KEY);
    if (!data || typeof data.industries !== 'object' || data.industries === null) {
      return { industries: {} };
    }
    return data;
  } catch (error) {
    if (isNoSuchKey(error)) return { industries: {} };
    throw error;
  }
}

/**
 * Persist an SDR wrap-up outcome to the OUTPUTS bucket. The post-call processor
 * reads it back by contactId at voice/outcomes/{contactId}.json.
 */
export async function saveCallOutcome(credentials: AwsCredentialIdentity, outcome: WrapUpOutcome): Promise<void> {
  const region = getRegion();
  const bucket = getOutputsBucket();
  const client = makeClient(credentials, region);
  const key = `${VOICE_OUTCOMES_PREFIX}/${outcome.contactId}.json`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(outcome),
      ContentType: 'application/json',
    })
  );
}

/** True when an S3 error indicates the object simply does not exist. NOTE:
 *  AccessDenied is deliberately NOT treated as "missing" — a permission failure
 *  must propagate to the caller's error/Retry state, not silently render an
 *  empty call list. (S3 returns AccessDenied for a missing key when the caller
 *  lacks s3:ListBucket, but for the Voice role that grants ListBucket so genuine
 *  not-found surfaces as NoSuchKey/NotFound.) */
export function isNoSuchKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const name = e.name ?? e.Code;
  // Cover the SDK v3 error-shape variance: name/Code, or a 404 status on $metadata.
  return name === 'NoSuchKey' || name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}
