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
import type { Prospect, TodayCalls, SdrPlaybook, WrapUpOutcome } from '../types/voice';

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

function getRegion(): string {
  const region = window.sessionStorage.getItem('REGION');
  if (!region) {
    throw new Error('Voice: REGION missing from sessionStorage');
  }
  return region;
}

function getDataBucket(): string {
  const bucket = window.sessionStorage.getItem('DATA_BUCKET');
  if (!bucket) {
    throw new Error('Voice: DATA_BUCKET missing from sessionStorage');
  }
  return bucket;
}

function getOutputsBucket(): string {
  const bucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  if (!bucket) {
    throw new Error('Voice: OUTPUTS_BUCKET_NAME missing from sessionStorage');
  }
  return bucket;
}

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
  return JSON.parse(text) as T;
}

/**
 * Load the ordered daily call list from the DATA bucket.
 * Returns an empty list (no prospects) if the file does not exist yet.
 */
export async function loadTodayCalls(credentials: AwsCredentialIdentity): Promise<TodayCalls> {
  try {
    const data = await readJson<TodayCalls>(credentials, getDataBucket(), TODAY_CALLS_KEY);
    if (!data || !Array.isArray(data.calls)) {
      return { calls: [] };
    }
    return data;
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
    return Array.isArray(data) ? data : [];
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
