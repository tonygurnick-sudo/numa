/**
 * Per-source fetchers for the bootstrap aggregator. Each function returns
 * the verbatim shape its source provides — normalisation happens in
 * `bootstrap/index.ts` if at all. Keeping fetchers thin makes it easy to
 * add / remove sources without churning the orchestration code.
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { s3 } from '../shared/aws.js';
import { CLIENT_NAME, CLOUDFRONT_SHARED_SECRET, COMPANY_BUCKET_NAME } from '../shared/config.js';
import { buildSyntheticEvent, invokeAndParse } from './synthetic-event.js';

/**
 * Fetch the client's public /config.json. Same blob the frontend pulls at
 * startup — feature flags, region, app catalog, branding hints, etc. URL
 * is the standard subdomain pattern (custom domains are unreliable per
 * CLAUDE.md; always assume `<client>.numa.arcanum.ai`).
 */
export const fetchClientConfig = async (): Promise<unknown> => {
  const url = `https://${CLIENT_NAME}.numa.arcanum.ai/config.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`config.json: HTTP ${res.status} from ${url}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`config.json: unexpected content-type ${contentType} from ${url}`);
  }
  return res.json();
};

/**
 * Read `company-data.json` from the client's company bucket. Same blob the
 * workspace agent loads via `load_company_profile_from_s3()` for system-
 * prompt personalisation. Returns `{}` when the bucket is unset or the
 * object is missing — both are normal cases for clients that haven't
 * filled in a company profile yet (matches the workspace agent's
 * behaviour).
 */
export const fetchCompanyProfile = async (): Promise<unknown> => {
  if (!COMPANY_BUCKET_NAME) return {};
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: COMPANY_BUCKET_NAME, Key: 'company-data.json' }));
    const text = await res.Body?.transformToString();
    if (!text) return {};
    return JSON.parse(text);
  } catch (err: unknown) {
    // NoSuchKey / NoSuchBucket → return empty, matches workspace agent
    // behaviour. Any other error propagates so the strict bootstrap fan-out
    // surfaces it.
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'NoSuchKey' || name === 'NoSuchBucket') return {};
    throw err;
  }
};

// ─── Downstream Lambda fetchers ─────────────────────────────────────────────
//
// Each of these calls a sibling client-account Lambda via Lambda.Invoke with
// a synthetic API Gateway event. The downstream lambda's own auth flow runs
// (JWT decode off the Authorization header) — bootstrap is forwarding the
// caller's access token verbatim, so the user sees exactly what they'd see
// hitting the endpoint directly.

export const fetchAgents = (authHeader: string): Promise<unknown> =>
  invokeAndParse(`${CLIENT_NAME}_agents`, buildSyntheticEvent('GET', '/api/agents', authHeader));

export const fetchAdminIntegrations = (authHeader: string): Promise<unknown> =>
  invokeAndParse(
    `${CLIENT_NAME}_admin-integration-settings-get`,
    buildSyntheticEvent('GET', '/api/settings/integrations', authHeader)
  );

export const fetchConnectorsStatus = (authHeader: string): Promise<unknown> =>
  invokeAndParse(
    `${CLIENT_NAME}_data-connectors-status`,
    buildSyntheticEvent('GET', '/api/data-connectors/status', authHeader)
  );

export const fetchKnowledgeBases = (authHeader: string): Promise<unknown> =>
  invokeAndParse(
    `${CLIENT_NAME}_kb_manager`,
    buildSyntheticEvent('GET', '/api/kb', authHeader, undefined, {
      // kb_manager sits behind a Function URL (not API Gateway) and validates
      // the CloudFront shared secret on every request. Forward it so direct
      // Lambda.Invoke behaves like a real CloudFront-routed call.
      'x-arcanum-cloudfront-secret': CLOUDFRONT_SHARED_SECRET,
    })
  );

export const fetchChatSettingsUser = (authHeader: string): Promise<unknown> =>
  invokeAndParse(`${CLIENT_NAME}_chat-settings-get`, buildSyntheticEvent('GET', '/api/chat/settings', authHeader));

export const fetchChatSettingsGlobal = (authHeader: string): Promise<unknown> =>
  invokeAndParse(
    `${CLIENT_NAME}_chat-settings-get`,
    buildSyntheticEvent('GET', '/api/chat/settings', authHeader, { scope: 'global' })
  );

export const fetchChatSettingsProfile = (authHeader: string): Promise<unknown> =>
  invokeAndParse(
    `${CLIENT_NAME}_chat-settings-get`,
    buildSyntheticEvent('GET', '/api/chat/settings', authHeader, { scope: 'profile' })
  );
