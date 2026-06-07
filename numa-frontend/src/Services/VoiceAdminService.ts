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
  /** Resolved human identity of the owner (Connect usernames are Cognito subs). */
  ownerEmail?: string;
  ownerDisplayName?: string;
  /** Server-computed: true if this DID belongs to the CURRENT user (reliable vs matching
   *  the owner tag, which is a hashed/sanitised username the frontend can't recompute). */
  mine?: boolean;
}

/** A Connect agent (one per Numa user) with its identity resolved from Cognito and the
 *  DID it owns joined in — the unit the redesigned agent-centric panel renders. */
export interface VoiceAgent {
  /** Connect User Id. */
  id?: string;
  /** Connect username — the user's Cognito sub (the join key for DID ownership). */
  username?: string;
  /** Resolved real email/name (the username itself is a UUID, so never show it raw). */
  email?: string;
  displayName?: string;
  /** True for the current caller / for the shared system bot agent. */
  isSelf?: boolean;
  isBot?: boolean;
  /** The DID this agent owns (their personal line), joined server-side. */
  phoneNumberId?: string;
  phoneNumber?: string;
  countryCode?: string;
  type?: string;
  /** True when this agent's DID is the instance-wide outbound caller-ID. */
  isCallerId?: boolean;
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
  agents?: VoiceAgent[];
  queues?: { id?: string; name?: string }[];
  /** PhoneNumberId currently set as the outbound queue's caller-ID (undefined = none set). */
  outboundCallerIdNumberId?: string;
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

  /** Claim a NEW DID and assign it to a specific agent in one step (admin, per-agent flow). */
  claimNumberForAgent: (numaPost: NumaPost, country: string, owner: string, type = 'DID'): Promise<unknown> =>
    numaPost(`${BASE}/phone-numbers`, { country, type, owner }),

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

  /** Backfill existing agents' Connect IdentityInfo (email/name) from Cognito (admin only).
   *  Returns { updated, skipped, failed, total }. The panel already shows resolved names;
   *  this repairs the Connect console / CCP records too. */
  syncIdentities: (numaPost: NumaPost): Promise<{ updated: number; skipped: number; failed: number; total: number }> =>
    numaPost(`${BASE}/agents/sync-identities`, {}) as Promise<{
      updated: number;
      skipped: number;
      failed: number;
      total: number;
    }>,
};
