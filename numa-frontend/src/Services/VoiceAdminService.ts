/**
 * Numa Voice — admin API client. Thin wrapper over the numa-voice-admin Lambda
 * (routed at /api/voice/*). Pass the authed helpers from useNumaRequest() so
 * every call carries the bearer token (see frontend CLAUDE.md).
 */

export type VoiceMode = 'personal' | 'shared';

export interface VoicePhoneNumber {
  id?: string;
  number?: string;
  countryCode?: string;
  type?: string;
  /** Connect username this DID belongs to (its personal line), or undefined = shared/unowned. */
  owner?: string;
  /** Server-computed: true if this DID belongs to the CURRENT user (reliable vs matching
   *  the owner tag, which is a hashed/sanitised username the frontend can't recompute). */
  mine?: boolean;
}

export interface VoiceAdminStatus {
  configured: boolean;
  instanceId?: string;
  instanceAlias: string;
  /** Tenant inbound routing mode: 'personal' honours per-DID owners, 'shared' rings the team. */
  mode?: VoiceMode;
  /** True when the inbound contact flow is deployed (DIDs can actually receive calls). */
  inboundReady?: boolean;
  phoneNumbers?: VoicePhoneNumber[];
  approvedOrigins?: string[];
  numaOriginPresent?: boolean;
  /** Authoritative approved-origin from the backend (correct for custom domains). */
  numaOrigin?: string;
  agents?: { id?: string; username?: string }[];
  queues?: { id?: string; name?: string }[];
  /** PhoneNumberId currently set as the outbound queue's caller-ID (undefined = none set). */
  outboundCallerIdNumberId?: string;
}

/** FEAT-170: month-to-date usage for one DID (joined via its owner agent). */
export interface VoiceNumberUsage {
  id?: string;
  number?: string;
  owner?: string;
  minutes: number;
  contacts: number;
}

export interface VoiceUsage {
  configured: boolean;
  from?: string;
  to?: string;
  numbers: VoiceNumberUsage[];
  /** Talk time by agents who own no DID (shared mode / unassigned) — not per-number attributable. */
  unattributed?: { minutes: number; contacts: number };
  totalMinutes: number;
  totalContacts?: number;
}

/** FEAT-168: realtime transcript payload from GET /voice/contacts/{id}/live-transcript. */
export interface VoiceLiveTranscript {
  /** False when Contact Lens isn't analysing this contact (flag off / not started). */
  enabled: boolean;
  segments: { participant: string; text: string }[];
}

// Match the useNumaRequest() signatures (NumaRequestContext): post requires data.
type NumaGet = (url: string, params?: unknown) => Promise<unknown>;
type NumaPost = (url: string, data: unknown) => Promise<unknown>;
type NumaDelete = (url: string) => Promise<unknown>;

const BASE = '/api/voice';

export const VoiceAdminService = {
  getStatus: (numaGet: NumaGet): Promise<VoiceAdminStatus> =>
    numaGet(`${BASE}/admin/status`) as Promise<VoiceAdminStatus>,

  /** FEAT-170: month-to-date per-number minutes (best-effort — UI degrades gracefully). */
  getUsage: (numaGet: NumaGet): Promise<VoiceUsage> => numaGet(`${BASE}/usage`) as Promise<VoiceUsage>,

  /** FEAT-168: realtime Contact Lens transcript segments for an in-progress call.
   *  { enabled:false } means live assist isn't available for this contact. */
  getLiveTranscript: (numaGet: NumaGet, contactId: string): Promise<VoiceLiveTranscript> =>
    numaGet(`${BASE}/contacts/${encodeURIComponent(contactId)}/live-transcript`) as Promise<VoiceLiveTranscript>,

  claimNumber: (numaPost: NumaPost, country: string, type = 'DID'): Promise<unknown> =>
    numaPost(`${BASE}/phone-numbers`, { country, type }),

  releaseNumber: (numaDelete: NumaDelete, id: string): Promise<unknown> =>
    numaDelete(`${BASE}/phone-numbers/${encodeURIComponent(id)}`),

  setCallerId: (numaPost: NumaPost, id: string): Promise<unknown> =>
    numaPost(`${BASE}/phone-numbers/${encodeURIComponent(id)}/caller-id`, {}),

  addOrigin: (numaPost: NumaPost, origin: string): Promise<unknown> => numaPost(`${BASE}/approved-origins`, { origin }),

  removeOrigin: (numaDelete: NumaDelete, origin: string): Promise<unknown> =>
    numaDelete(`${BASE}/approved-origins?origin=${encodeURIComponent(origin)}`),

  /** Assign a DID's owner. No `owner` → claim it for yourself; admins may pass a username. */
  setOwner: (numaPost: NumaPost, id: string, owner?: string): Promise<unknown> =>
    numaPost(`${BASE}/phone-numbers/${encodeURIComponent(id)}/owner`, owner ? { owner } : {}),

  /** Clear a DID's owner (it then rings the shared team queue). */
  unsetOwner: (numaDelete: NumaDelete, id: string): Promise<unknown> =>
    numaDelete(`${BASE}/phone-numbers/${encodeURIComponent(id)}/owner`),

  /** Set the tenant inbound routing mode (admin only). */
  setMode: (numaPost: NumaPost, mode: VoiceMode): Promise<unknown> => numaPost(`${BASE}/mode`, { mode }),
};
