/**
 * Numa Voice — admin API client. Thin wrapper over the numa-voice-admin Lambda
 * (routed at /api/voice/*). Pass the authed helpers from useNumaRequest() so
 * every call carries the bearer token (see frontend CLAUDE.md).
 */

export interface VoicePhoneNumber {
  id?: string;
  number?: string;
  countryCode?: string;
  type?: string;
}

export interface VoiceAdminStatus {
  configured: boolean;
  instanceId?: string;
  instanceAlias: string;
  phoneNumbers?: VoicePhoneNumber[];
  approvedOrigins?: string[];
  numaOriginPresent?: boolean;
  agents?: { id?: string; username?: string }[];
  queues?: { id?: string; name?: string }[];
}

export interface OutboundCountryResult {
  filed: boolean;
  caseId?: string;
  reason?: string;
  manual?: { subject: string; communicationBody: string; supportConsole: string; connectConsole: string };
}

// Match the useNumaRequest() signatures (NumaRequestContext): post requires data.
type NumaGet = (url: string, params?: unknown) => Promise<unknown>;
type NumaPost = (url: string, data: unknown) => Promise<unknown>;
type NumaDelete = (url: string) => Promise<unknown>;

const BASE = '/api/voice';

export const VoiceAdminService = {
  getStatus: (numaGet: NumaGet): Promise<VoiceAdminStatus> =>
    numaGet(`${BASE}/admin/status`) as Promise<VoiceAdminStatus>,

  claimNumber: (numaPost: NumaPost, country: string, type = 'DID'): Promise<unknown> =>
    numaPost(`${BASE}/phone-numbers`, { country, type }),

  releaseNumber: (numaDelete: NumaDelete, id: string): Promise<unknown> =>
    numaDelete(`${BASE}/phone-numbers/${encodeURIComponent(id)}`),

  setCallerId: (numaPost: NumaPost, id: string): Promise<unknown> =>
    numaPost(`${BASE}/phone-numbers/${encodeURIComponent(id)}/caller-id`, {}),

  addOrigin: (numaPost: NumaPost, origin: string): Promise<unknown> => numaPost(`${BASE}/approved-origins`, { origin }),

  removeOrigin: (numaDelete: NumaDelete, origin: string): Promise<unknown> =>
    numaDelete(`${BASE}/approved-origins?origin=${encodeURIComponent(origin)}`),

  requestOutboundCountry: (numaPost: NumaPost, country: string): Promise<OutboundCountryResult> =>
    numaPost(`${BASE}/outbound-country-request`, { country }) as Promise<OutboundCountryResult>,
};
