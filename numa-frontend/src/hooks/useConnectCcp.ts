/**
 * useConnectCcp — Amazon Connect CCP (Contact Control Panel) lifecycle hook for Numa Voice.
 *
 * Wraps `amazon-connect-streams` `connect.core.initCCP(...)` and the contact
 * lifecycle subscriptions, exposing a small, typed surface the softphone widget
 * (and any future Voice component) can consume:
 *
 *   - call status:  not_configured | initialising | needs_login | ready | error
 *   - the current contact phase / contactId (also re-published on a window
 *     CustomEvent so loosely-coupled components — wrap-up, assist — can react
 *     without importing the widget)
 *   - dialNumber(e164) — click-to-dial helper
 *
 * Why a window CustomEvent (not a context):
 *   The widget mounts at the app-shell level (AppLayout), while the wrap-up and
 *   assist panels live on the /voice page. A window CustomEvent is the lowest-
 *   coupling way to bridge those two trees, and matches the existing pattern in
 *   the codebase (e.g. adminCapabilityGating dispatches `numa-capabilities-changed`).
 *   Components subscribe via `subscribeVoiceContact(...)`; the dial side can fire
 *   `dialVoiceNumber(e164)` from anywhere (it routes through the active CCP).
 *
 * amazon-connect-streams ships no bundled TypeScript types, so a minimal local
 * shim of the bits we touch is declared inline below. Do NOT add @types — the
 * upstream package has none and the shim is intentionally narrow.
 *
 * RUNTIME NOTE: this is the highest runtime-risk piece of Numa Voice. It cannot
 * be exercised without a live Amazon Connect instance (a configured
 * CONNECT_INSTANCE_URL + the instance's Approved Origins allowing this domain).
 * The login/mic flow happens entirely inside the iframe initCCP injects.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Prospect } from '../types/voice';

/* ------------------------------------------------------------------ *
 * Minimal amazon-connect-streams type shim (no @types upstream).
 * Only the members we actually call are declared.
 * ------------------------------------------------------------------ */

/** Contact lifecycle phase we surface to the rest of the app. 'acw' = After
 *  Call Work (matches the wrap-up panel + the processor's onACW semantics). */
export type VoiceContactPhase = 'connecting' | 'connected' | 'acw' | 'ended';

/** Status of the CCP softphone itself.
 *  'inactive_tab' = another browser tab already owns the single CCP agent session,
 *  so this tab deliberately skipped initCCP (see the cross-tab primary-tab guard). */
export type CcpStatus =
  | 'not_configured'
  | 'initialising'
  | 'needs_login'
  | 'ready'
  | 'error'
  | 'inactive_tab'
  | 'unsupported'
  | 'offline';

/** Detail payload carried by the `numa-voice-contact` CustomEvent. Consumed by
 *  the wrap-up (phase 'acw') and assist (phase 'connected'/'ended') panels. */
export interface VoiceContactEventDetail {
  phase: VoiceContactPhase;
  /** Amazon Connect contact ID, when known. */
  contactId?: string;
  /** Dialled / connected E.164 number, when resolvable from the contact. */
  phoneNumber?: string;
  /** The prospect this call is for — threaded through from the dial request so
   *  the wrap-up + assist panels have full context (the CCP contact alone does
   *  not carry it). */
  prospect?: Prospect;
  /** Call wall-clock duration (seconds), when known (ACW). */
  durationSeconds?: number;
}

/** Detail carried by the `numa-voice-dial` CustomEvent (from the prospect table). */
export interface VoiceDialEventDetail {
  /** E.164 number to dial. */
  phone: string;
  /** The prospect being dialled (carried through to the contact lifecycle). */
  prospect?: Prospect;
}

/** Detail carried by the `numa-voice-call-state` CustomEvent (drives the table's Dial button). */
export interface VoiceCallStateEventDetail {
  phone: string | null;
  state: 'dialing' | 'connected' | 'idle';
}

/** Window CustomEvent name carrying contact lifecycle transitions. */
export const VOICE_CONTACT_EVENT = 'numa-voice-contact';
/** Window CustomEvent name carrying outbound dial requests. */
export const VOICE_DIAL_EVENT = 'numa-voice-dial';
/** Window CustomEvent name carrying call-state for the prospect table button. */
export const VOICE_CALL_STATE_EVENT = 'numa-voice-call-state';
/** Window CustomEvent name carrying the softphone's current CcpStatus, so the
 *  cockpit (FocusCallCard) can tell the SDR the truth about readiness instead
 *  of always claiming "ready". */
export const VOICE_CCP_STATUS_EVENT = 'numa-voice-ccp-status';

/** Detail carried by the `numa-voice-ccp-status` CustomEvent. */
export interface VoiceCcpStatusEventDetail {
  status: CcpStatus;
}

interface ConnectAgent {
  connect(endpoint: unknown, callbacks?: { success?: () => void; failure?: (err: unknown) => void }): void;
}

interface ConnectContact {
  getContactId(): string;
  getActiveInitialConnection?(): { getEndpoint?(): { phoneNumber?: string } | undefined } | undefined;
  onConnected(handler: (contact: ConnectContact) => void): void;
  onACW(handler: (contact: ConnectContact) => void): void;
  onEnded(handler: (contact: ConnectContact) => void): void;
  onDestroy?(handler: (contact: ConnectContact) => void): void;
  /** Clears the contact out of After-Call Work (returns the agent to their prior
   *  state). Numa owns the wrap-up flow, so Connect ACW is redundant — we clear it. */
  clear?(callbacks?: { success?: () => void; failure?: (err: unknown) => void }): void;
}

interface ConnectEndpoint {
  byPhoneNumber(phoneNumber: string): unknown;
}

interface ConnectCore {
  initCCP(container: HTMLElement, config: Record<string, unknown>): void;
  onInitialized?(handler: () => void): void;
  terminate?(): void;
}

interface ConnectGlobal {
  core: ConnectCore;
  agent(handler: (agent: ConnectAgent) => void): void;
  contact(handler: (contact: ConnectContact) => void): void;
  Endpoint: ConnectEndpoint;
}

/* ------------------------------------------------------------------ *
 * Cross-component event helpers (importable from anywhere).
 * ------------------------------------------------------------------ */

/** Publish a contact lifecycle transition to any listening component. */
export function publishVoiceContact(detail: VoiceContactEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<VoiceContactEventDetail>(VOICE_CONTACT_EVENT, { detail }));
}

/**
 * Subscribe to contact lifecycle transitions. Returns an unsubscribe fn.
 * Use this from the wrap-up / assist panels to react to onConnected/onACW/onEnded.
 */
export function subscribeVoiceContact(handler: (detail: VoiceContactEventDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<VoiceContactEventDetail>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(VOICE_CONTACT_EVENT, listener);
  return () => window.removeEventListener(VOICE_CONTACT_EVENT, listener);
}

/**
 * Request an outbound dial to an E.164 number from anywhere in the app
 * (e.g. the prospect table's "Dial" button). The mounted CCP widget listens
 * for this and routes it through `connect.agent(...).connect(...)`. The optional
 * prospect is threaded through to the contact lifecycle events.
 */
export function dialVoiceNumber(e164: string, prospect?: Prospect): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<VoiceDialEventDetail>(VOICE_DIAL_EVENT, { detail: { phone: e164, prospect } }));
}

/** Publish a call-state transition for the prospect table's Dial button. */
function publishCallState(detail: VoiceCallStateEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<VoiceCallStateEventDetail>(VOICE_CALL_STATE_EVENT, { detail }));
}

/** Publish the softphone's current CcpStatus to the cockpit. */
export function publishCcpStatus(status: CcpStatus): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<VoiceCcpStatusEventDetail>(VOICE_CCP_STATUS_EVENT, { detail: { status } }));
}

/**
 * Subscribe to softphone-status changes. Returns an unsubscribe fn. The status
 * is also re-published whenever a subscriber asks (via a one-shot request event)
 * so a late-mounting consumer isn't stuck on a stale default until the next change.
 */
export function subscribeCcpStatus(handler: (status: CcpStatus) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<VoiceCcpStatusEventDetail>;
    if (custom.detail) handler(custom.detail.status);
  };
  window.addEventListener(VOICE_CCP_STATUS_EVENT, listener);
  // Ask the widget to re-announce its current status for this fresh subscriber.
  window.dispatchEvent(new CustomEvent('numa-voice-ccp-status-request'));
  return () => window.removeEventListener(VOICE_CCP_STATUS_EVENT, listener);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Build the CCP URL from the configured Connect instance URL in sessionStorage.
 *  Exported for tests. */
export function getCcpUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const instanceUrl = window.sessionStorage.getItem('CONNECT_INSTANCE_URL');
  // Treat empty/whitespace as not-configured — config.json emits '' when unset.
  if (!instanceUrl || instanceUrl.trim() === '') return null;
  // Tolerate a trailing slash on the stored instance URL. The modern Connect
  // domain serves CCP at /ccp-v2/ (the legacy /connect/ccp-v2/ 301-redirects here).
  return `${instanceUrl.trim().replace(/\/+$/, '')}/ccp-v2/`;
}

/** Connect region for initCCP — configurable via sessionStorage, defaults to Sydney.
 *  Exported for tests. */
export function getConnectRegion(): string {
  if (typeof window === 'undefined') return 'ap-southeast-2';
  return window.sessionStorage.getItem('CONNECT_REGION') || 'ap-southeast-2';
}

/* ------------------------------------------------------------------ *
 * Cross-tab "primary tab" guard.
 *
 * amazon-connect-streams' initCCP drives a SINGLE agent CCP session. If two
 * Numa tabs both call initCCP they stack iframes and fight over the same agent
 * session (login loops, dropped contacts). So we elect ONE primary tab via a
 * localStorage sentinel: { id, ts }. The primary tab refreshes `ts` on a
 * heartbeat; other tabs see a FRESH sentinel owned by someone else and skip
 * initCCP. When the primary tab closes (beforeunload) or is hidden it releases
 * the sentinel; if it dies without releasing, its heartbeat goes stale and any
 * other tab takes over. Pure localStorage — no SharedWorker/BroadcastChannel
 * dependency, robust to private-mode quota errors (all access is try/caught).
 * ------------------------------------------------------------------ */

/** localStorage key holding the active primary tab's sentinel. */
const CCP_PRIMARY_TAB_KEY = 'numa-voice-ccp-primary-tab';
/** How often the primary tab refreshes its heartbeat. */
const CCP_HEARTBEAT_MS = 2_000;
/** A sentinel older than this is considered dead and can be taken over. Must be
 *  comfortably larger than the heartbeat to tolerate a slow/throttled tab. */
const CCP_STALE_MS = 8_000;

interface CcpTabSentinel {
  id: string;
  ts: number;
}

function readPrimaryTabSentinel(): CcpTabSentinel | null {
  try {
    const raw = window.localStorage.getItem(CCP_PRIMARY_TAB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CcpTabSentinel>;
    if (typeof parsed?.id !== 'string' || typeof parsed?.ts !== 'number') return null;
    return { id: parsed.id, ts: parsed.ts };
  } catch {
    return null;
  }
}

function writePrimaryTabSentinel(id: string): void {
  try {
    window.localStorage.setItem(CCP_PRIMARY_TAB_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch {
    /* localStorage unavailable (private mode / quota) — best effort. */
  }
}

/** Release the sentinel only if WE still own it (avoid clobbering a tab that
 *  legitimately took over). */
function releasePrimaryTabSentinel(id: string): void {
  try {
    const current = readPrimaryTabSentinel();
    if (current && current.id !== id) return;
    window.localStorage.removeItem(CCP_PRIMARY_TAB_KEY);
  } catch {
    /* best effort */
  }
}

/** A sentinel owned by another tab whose heartbeat is still fresh blocks us. */
function isPrimaryTakenByOther(myId: string): boolean {
  const current = readPrimaryTabSentinel();
  if (!current) return false;
  if (current.id === myId) return false;
  return Date.now() - current.ts < CCP_STALE_MS;
}

/** Best-effort extraction of the connected endpoint phone number from a contact. */
function getContactPhoneNumber(contact: ConnectContact): string | undefined {
  try {
    const connection = contact.getActiveInitialConnection?.();
    return connection?.getEndpoint?.()?.phoneNumber;
  } catch {
    return undefined;
  }
}

interface UseConnectCcpResult {
  /** Attach to the iframe host div: initCCP renders the softphone inside it. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current softphone status. */
  status: CcpStatus;
  /** True once we've seen at least one initialised event from the CCP. */
  initialised: boolean;
  /** Place an outbound call to an E.164 number. */
  dialNumber: (e164: string) => void;
}

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

/**
 * Initialise the Amazon Connect CCP into a container and wire the contact
 * lifecycle. `active` gates the actual initCCP call so the iframe is only
 * created when the widget is mounted/open (initCCP must run exactly once per
 * container element).
 */
export function useConnectCcp(active: boolean, getSignInUrl?: () => Promise<string | null>): UseConnectCcpResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialisedRef = useRef(false);
  // Set true when init hits a terminal failure (e.g. the streams library has no
  // `connect.core`). Without it, the takeover poll re-triggers init every 2s
  // forever (re-fetching the federation token + re-importing the lib each time).
  const initFailedRef = useRef(false);
  // The just-dialled prospect, before a contactId exists; consumed when the
  // contact appears and moved into the per-contact map below.
  const pendingProspectRef = useRef<Prospect | undefined>(undefined);
  // Prospect + call-start keyed BY contactId, so overlapping contacts never
  // cross-thread each other's prospect context / duration (the CCP contact alone
  // doesn't carry the prospect).
  const prospectByContactRef = useRef<Map<string, Prospect>>(new Map());
  const startedAtByContactRef = useRef<Map<string, number>>(new Map());
  // Last-dialled prospect — a safe fallback for the per-contact map when a
  // contactId isn't yet available at contact-creation time (calls are sequential
  // from the cockpit, so the most-recent dial is the right context).
  const lastProspectRef = useRef<Prospect | undefined>(undefined);
  // Keep the latest getSignInUrl WITHOUT making it an effect dependency. initCCP
  // must run exactly once; getSignInUrl's identity changes whenever the auth token
  // refreshes (it closes over numaGet), and re-running the effect would terminate +
  // recreate the CCP iframe mid-call. We read the current value via this ref.
  const getSignInUrlRef = useRef(getSignInUrl);
  getSignInUrlRef.current = getSignInUrl;
  // Resets a stuck optimistic 'dialing' state if neither onConnected nor onEnded
  // fires (dial accepted by the API but silently never progresses).
  const dialTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Whether a contact is currently live (connecting → connected → until terminal).
  // Used to SKIP connect.core.terminate() in the init-effect cleanup so unmounting
  // the host (e.g. navigation) mid-call doesn't orphan the agent's live call.
  const callActiveRef = useRef(false);
  // This tab's stable identity for the cross-tab primary-tab election. Generated
  // once per hook instance (per tab) and compared against the localStorage sentinel.
  const tabIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  // True while THIS tab owns the CCP session (ran initCCP). Used by the heartbeat
  // + release logic so only the primary tab maintains/relinquishes the sentinel.
  const isPrimaryTabRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Bumped by the cross-tab effect when the primary slot frees up (sentinel
  // released or heartbeat went stale) so a secondary tab can re-attempt initCCP.
  // It IS an init-effect dependency, but re-running is a cheap no-op once
  // initialisedRef is set (the primary tab), so it only does real work for a
  // secondary tab promoting itself.
  const [takeoverTick, setTakeoverTick] = useState(0);
  const [status, setStatus] = useState<CcpStatus>('initialising');
  const [initialised, setInitialised] = useState(false);

  // Place an outbound call. Resolves `connect` from the module global the
  // streams library attaches to window. Guarded so calling before init is a
  // no-op rather than a throw.
  const dialNumber = useCallback((e164: string) => {
    const connect = (window as unknown as { connect?: ConnectGlobal }).connect;
    // Reset the table's optimistic "Dialing…" state whenever the dial can't
    // proceed, fails, or stalls — otherwise the button is stuck on dialing forever
    // (the only other reset is contact.onEnded, which never fires for a failed dial).
    const resetDial = (): void => {
      publishCallState({ phone: null, state: 'idle' });
      // Also clear the PAGE phase: a failed/stalled dial published 'connecting'
      // (via connect.contact) but no onConnected/onEnded follows, so without a
      // terminal event the FocusCallCard would spin on "Dialing…" forever. The
      // page reducer maps 'ended' → idle (and protects an open wrap-up).
      publishVoiceContact({ phase: 'ended' });
      pendingProspectRef.current = undefined;
      if (dialTimeoutRef.current) {
        clearTimeout(dialTimeoutRef.current);
        dialTimeoutRef.current = undefined;
      }
    };
    if (!connect || !initialisedRef.current) {
      console.warn('Numa Voice: CCP not ready, cannot dial', e164);
      resetDial();
      return;
    }
    // Only NOW (CCP confirmed ready) flip the table button to 'dialing' — doing it
    // before the readiness check briefly stranded the button on 'Dialing…' for a
    // dial that never started.
    publishCallState({ phone: e164, state: 'dialing' });
    // Safety net: if neither onConnected nor onEnded fires within 60s, reset the
    // stuck 'dialing' state. Cleared in onConnected / onEnded.
    if (dialTimeoutRef.current) clearTimeout(dialTimeoutRef.current);
    dialTimeoutRef.current = setTimeout(() => {
      console.warn('Numa Voice: dial timed out with no connect/end event', e164);
      resetDial();
    }, 60_000);
    try {
      connect.agent((agent) => {
        agent.connect(connect.Endpoint.byPhoneNumber(e164), {
          failure: (err) => {
            console.error('Numa Voice: dial failed', err);
            resetDial();
          },
        });
      });
    } catch (err) {
      console.error('Numa Voice: dial error', err);
      resetDial();
    }
  }, []);

  // Listen for dial requests fired from elsewhere (e.g. prospect table). The
  // table sends { phone, prospect }; we remember the prospect for the lifecycle
  // events and optimistically mark the table button as dialing.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const listener = (event: Event) => {
      const custom = event as CustomEvent<VoiceDialEventDetail & { phoneNumber?: string }>;
      // Accept `phone` (table contract) and tolerate a legacy `phoneNumber`.
      const phone = custom.detail?.phone ?? custom.detail?.phoneNumber;
      if (!phone) return;
      pendingProspectRef.current = custom.detail?.prospect;
      // dialNumber publishes the optimistic 'dialing' state itself, but only
      // after it confirms the CCP is ready (so a not-ready dial never strands
      // the button).
      dialNumber(phone);
    };
    window.addEventListener(VOICE_DIAL_EVENT, listener);
    return () => window.removeEventListener(VOICE_DIAL_EVENT, listener);
  }, [dialNumber]);

  // Initialise the CCP once the widget is active and the container exists.
  useEffect(() => {
    if (!active) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    // initCCP must run exactly once per container element. If we've already
    // initialised, do nothing — React strict-mode double-mounts and re-renders
    // would otherwise stack multiple iframes / event handlers.
    if (initialisedRef.current) return undefined;

    let cancelled = false;

    const init = async () => {
      try {
        // The iframe ALWAYS loads the static ccp-v2 URL — it is the only frameable
        // Connect page (Connect widens its frame-ancestors CSP to include the
        // Approved Origin once the agent is authenticated). The login is a SEPARATE
        // step: amazon-connect-streams opens `loginUrl` in a popup (loginPopup:true).
        //
        // For passwordless SSO we hand it the GetFederationToken SignInUrl as the
        // loginUrl: the popup auto-authenticates the SAML agent (no password field)
        // and auto-closes, after which the framed ccp-v2 picks up the session.
        // The SignInUrl points at /auth/sign-in, which sends frame-ancestors:'none'
        // and can NEVER be framed — so it must be the loginUrl (popup), never ccpUrl.
        // ccpUrl = the Connect instance ccp-v2 URL (CONNECT_INSTANCE_URL, the
        // *.my.connect.aws domain). loginUrl = an AWS console-federation login URL
        // minted server-side (GET /api/voice/federation-token): the popup loads it,
        // AWS federates a console session and hands it to connect/federate, which
        // establishes the agent's CCP session passwordlessly and lands on ccp-v2.
        // That login URL lives on signin.aws.amazon.com — so it is NOT the ccpUrl.
        const ccpUrl = getCcpUrl();
        if (!ccpUrl) {
          setStatus('not_configured');
          return;
        }

        // Cross-tab guard: only ONE tab may run initCCP (a single agent CCP
        // session). If another tab already holds a FRESH sentinel, this tab steps
        // aside and surfaces an "active in another tab" status instead of stacking
        // a second iframe / fighting over the session. Cheap check up front so we
        // don't even fetch a federation token / load the heavy bundle as a
        // secondary tab.
        const myTabId = tabIdRef.current;
        if (isPrimaryTakenByOther(myTabId)) {
          setStatus('inactive_tab');
          return;
        }
        let loginUrl: string | undefined;
        const getSignInUrl = getSignInUrlRef.current;
        if (getSignInUrl) {
          try {
            const signInUrl = await getSignInUrl();
            if (signInUrl) loginUrl = signInUrl;
          } catch (err) {
            // Federation unavailable — streams falls back to its default login.
            // Warn (don't swallow) so a broken federation token is diagnosable.
            console.warn('Numa Voice: federation sign-in URL unavailable; using default CCP login', err);
          }
        }
        if (cancelled) return;

        // Dynamic import: amazon-connect-streams is a heavy iframe-bootstrapping
        // bundle; load it lazily so it doesn't bloat the app-shell chunk and is
        // only fetched when Voice is actually used.
        const mod = await import('amazon-connect-streams');
        if (cancelled) return;

        const connect =
          (window as unknown as { connect?: ConnectGlobal }).connect ??
          (mod as unknown as { default?: ConnectGlobal }).default ??
          (mod as unknown as ConnectGlobal);

        if (!connect || !connect.core) {
          setStatus('error');
          // Terminal: the streams library is unusable. Stop the takeover poll from
          // re-running this expensive async init every 2s.
          initFailedRef.current = true;
          return;
        }

        // Re-check the cross-tab sentinel right before initCCP: the federation
        // fetch + dynamic import above are async, so another tab could have
        // claimed primary in the meantime. Closing this race keeps it to one
        // initCCP across tabs.
        if (isPrimaryTakenByOther(myTabId)) {
          setStatus('inactive_tab');
          return;
        }
        // Claim primary and start the heartbeat so other tabs see us as alive.
        writePrimaryTabSentinel(myTabId);
        isPrimaryTabRef.current = true;
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (isPrimaryTabRef.current) writePrimaryTabSentinel(myTabId);
        }, CCP_HEARTBEAT_MS);

        connect.core.initCCP(container, {
          ccpUrl,
          ...(loginUrl ? { loginUrl } : {}),
          region: getConnectRegion(),
          loginPopup: true,
          loginPopupAutoClose: true,
          softphone: {
            allowFramedSoftphone: true,
          },
        });

        // Quiet the amazon-connect-streams console flood. While the browser is
        // offline it logs "network offline ........." every second (plus periodic
        // softphone-log batch-size warnings) — hundreds of lines that bury real
        // errors. Cap the CONSOLE echo to errors only; streams' own telemetry is
        // unaffected. Best-effort: the logging API isn't in our minimal type shim.
        try {
          const c = connect as unknown as {
            getLog?: () => { setEchoLevel?: (level: unknown) => void };
            LogLevel?: { ERROR?: unknown };
          };
          if (c.LogLevel?.ERROR !== undefined) c.getLog?.()?.setEchoLevel?.(c.LogLevel.ERROR);
        } catch {
          /* logging config is non-critical */
        }

        initialisedRef.current = true;
        setStatus('needs_login');

        // Fired once the embedded CCP iframe has booted and the agent is
        // authenticated. Until then we sit in needs_login (the iframe shows the
        // Connect login popup).
        connect.core.onInitialized?.(() => {
          if (cancelled) return;
          setInitialised(true);
          setStatus('ready');
        });

        // Contact lifecycle → re-published as window events for loose coupling.
        connect.contact((contact) => {
          const contactId = (() => {
            try {
              return contact.getContactId();
            } catch {
              return undefined;
            }
          })();

          // Move the just-dialled prospect under this contactId so concurrent
          // contacts don't cross-thread. All reads below are keyed by contactId.
          const prospect = pendingProspectRef.current;
          if (prospect) lastProspectRef.current = prospect;
          if (contactId && prospect) prospectByContactRef.current.set(contactId, prospect);
          pendingProspectRef.current = undefined;
          const prospectFor = (c: ConnectContact): Prospect | undefined => {
            const id = safeContactId(c) ?? contactId;
            const mapped = id ? prospectByContactRef.current.get(id) : undefined;
            // Fall back to the most-recently-dialled prospect when the per-contact
            // map misses, so the wrap-up + focus card never lose prospect context.
            return mapped ?? lastProspectRef.current;
          };
          // A contact now exists → a call is live. Block terminate() in cleanup
          // so unmounting the host mid-call doesn't drop the agent's call.
          callActiveRef.current = true;
          publishVoiceContact({ phase: 'connecting', contactId, prospect });

          contact.onConnected((c) => {
            callActiveRef.current = true;
            if (dialTimeoutRef.current) {
              clearTimeout(dialTimeoutRef.current);
              dialTimeoutRef.current = undefined;
            }
            const id = safeContactId(c) ?? contactId;
            if (id) startedAtByContactRef.current.set(id, Date.now());
            const phoneNumber = getContactPhoneNumber(c);
            const p = prospectFor(c);
            publishVoiceContact({ phase: 'connected', contactId: id, phoneNumber, prospect: p });
            // Prefer the dialled prospect's E.164 (the table's row key) over the
            // Connect-resolved endpoint string so the table's on-call state matches.
            publishCallState({ phone: p?.phone ?? phoneNumber ?? null, state: 'connected' });
          });

          // After Call Work → wrap-up panel should open (phase 'acw').
          contact.onACW((c) => {
            if (dialTimeoutRef.current) {
              clearTimeout(dialTimeoutRef.current);
              dialTimeoutRef.current = undefined;
            }
            const id = safeContactId(c) ?? contactId;
            const startedAt = id ? startedAtByContactRef.current.get(id) : undefined;
            // The wrap-up panel needs a contactId to save against AND to render at
            // all (it shows nothing without one). If getContactId threw on both the
            // ACW contact and the outer closure, DON'T enter 'acw' — that would
            // strand the SDR in a blank, undismissable wrap-up (the page reducer
            // protects 'acw', so onDismissed is unreachable). Publish 'ended'
            // instead so the page returns to idle and the next call can proceed.
            if (id) {
              publishVoiceContact({
                phase: 'acw',
                contactId: id,
                phoneNumber: getContactPhoneNumber(c),
                prospect: prospectFor(c),
                durationSeconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : undefined,
              });
            } else {
              console.warn('Numa Voice: ACW with no contactId — skipping wrap-up for this call');
              publishVoiceContact({ phase: 'ended' });
            }
            // The live call is OVER once we hit ACW (the customer hung up / the
            // call disconnected — the agent is now wrapping up). Reset the table's
            // "On call" button now: Connect's onEnded only fires when the agent
            // CLOSES the contact, which may never happen, so without this the row
            // stays stuck on "On call" through the entire wrap-up. The page keeps
            // its own 'acw' phase (wrap-up panel) alive separately.
            publishCallState({ phone: null, state: 'idle' });
            // No live media remains in ACW, so terminate() is once-again safe.
            callActiveRef.current = false;
            // Numa owns the post-call wrap-up (PostCallWrapUpPanel), so Connect's own
            // ACW is redundant — and leaving the contact in ACW keeps the agent "on
            // call" on Connect (they'd otherwise have to click "Close contact" in the
            // CCP, which they may never do → stuck agent + "1 agent on call" in Live).
            // Clear it now: the agent returns to Available immediately, while the Numa
            // wrap-up panel stays open (the page reducer protects the 'acw' phase from
            // the 'ended' event that c.clear() triggers). Best-effort.
            try {
              c.clear?.({ failure: (err) => console.warn('Numa Voice: contact.clear failed', err) });
            } catch (err) {
              console.warn('Numa Voice: contact.clear threw', err);
            }
          });

          // onEnded (contact cleared) and onDestroy are both wired so the lifecycle
          // always resets, regardless of which the Connect flow emits.
          // Both onEnded and onDestroy may fire for one contact — guard so the
          // terminal transition is published exactly once.
          let terminated = false;
          const handleTerminal = (c: ConnectContact): void => {
            if (terminated) return;
            terminated = true;
            // Call fully over — terminate() in cleanup is safe again.
            callActiveRef.current = false;
            if (dialTimeoutRef.current) {
              clearTimeout(dialTimeoutRef.current);
              dialTimeoutRef.current = undefined;
            }
            const id = safeContactId(c) ?? contactId;
            publishVoiceContact({ phase: 'ended', contactId: id, prospect: prospectFor(c) });
            publishCallState({ phone: null, state: 'idle' });
            if (id) {
              prospectByContactRef.current.delete(id);
              startedAtByContactRef.current.delete(id);
            }
          };
          contact.onEnded(handleTerminal);
          contact.onDestroy?.(handleTerminal);
        });
      } catch (err) {
        if (cancelled) return;
        console.error('Numa Voice: failed to initialise CCP', err);
        setStatus('error');
      }
    };

    init();

    return () => {
      cancelled = true;
      // SKIP terminate() while a call is live: the init effect's cleanup also runs
      // when the host unmounts (e.g. navigation). terminate() tears down the whole
      // CCP session — doing that mid-call ORPHANS the agent's live call. We only
      // tear down when no contact is active; if a call is in progress we leave the
      // iframe/session intact (initialisedRef stays true so a remount won't re-init).
      if (callActiveRef.current) {
        console.warn('Numa Voice: skipping CCP terminate — a call is active');
        return;
      }
      // Tear down the CCP iframe + handlers so a remount re-inits cleanly and we
      // don't leak handlers / stack iframes. terminate is optional in the streams
      // API; guard for the not-yet-initialised case.
      try {
        const connect = (window as unknown as { connect?: ConnectGlobal }).connect;
        connect?.core?.terminate?.();
      } catch (err) {
        console.warn('Numa Voice: CCP terminate failed', err);
      }
      initialisedRef.current = false;
      // Relinquish primary so another tab can claim the session, and stop the
      // heartbeat (the dedicated cross-tab effect below also releases on unmount).
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = undefined;
      }
      if (isPrimaryTabRef.current) {
        releasePrimaryTabSentinel(tabIdRef.current);
        isPrimaryTabRef.current = false;
      }
      if (dialTimeoutRef.current) {
        clearTimeout(dialTimeoutRef.current);
        dialTimeoutRef.current = undefined;
      }
    };
    // Deps: `active` (gates init) and `takeoverTick` (lets a secondary tab
    // re-attempt initCCP once the primary slot frees). getSignInUrl is read via
    // getSignInUrlRef so a token refresh (which changes its identity) does not
    // re-run init and tear down a live call. initCCP is a once-per-container
    // operation — guarded by initialisedRef so a tick re-run is a no-op for the
    // already-primary tab.
  }, [active, takeoverTick]);

  // Cross-tab coordination: release the sentinel when this tab goes away/hidden,
  // and (as a secondary tab) take over when the primary slot frees up. Runs for
  // ALL tabs, including secondary tabs that skipped initCCP.
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    const myTabId = tabIdRef.current;

    // Release primary on REAL teardown (tab close / navigation) so another tab can
    // claim it. We deliberately do NOT release merely on tab-hide: the iframe is
    // still mounted while hidden, so releasing then would let another tab run a
    // second initCCP and we'd be back to two stacked sessions. A truly
    // backgrounded/frozen primary instead goes stale (heartbeat stops) and the
    // takeover poll promotes another tab — the intended last-resort path.
    const release = (): void => {
      if (isPrimaryTabRef.current) {
        releasePrimaryTabSentinel(myTabId);
        isPrimaryTabRef.current = false;
      }
    };
    // On becoming visible again, nudge a takeover re-check so a tab that lost
    // primary while frozen re-syncs promptly (the poll also handles this, this
    // just makes it immediate). The poll's guards keep it a no-op when not needed.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && !isPrimaryTabRef.current) {
        setTakeoverTick((n) => n + 1);
      }
    };

    window.addEventListener('beforeunload', release);
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onVisibility);

    // Takeover poll: if we're NOT primary and the slot is free (no fresh sentinel
    // from another tab), bump takeoverTick to re-run the init effect and promote
    // this tab. Cheap no-op for the current primary tab (it owns a fresh sentinel).
    // Gated on a configured instance so an unconfigured deployment (no ccpUrl,
    // which can never claim primary) doesn't churn state every interval.
    const poll = setInterval(() => {
      if (isPrimaryTabRef.current) return;
      // A terminal init failure (no usable streams lib) won't fix itself on retry —
      // don't churn the expensive async init every interval.
      if (initFailedRef.current) return;
      if (!getCcpUrl()) return;
      if (!isPrimaryTakenByOther(myTabId)) {
        // Slot is free — re-attempt init. The init effect re-checks + claims.
        setTakeoverTick((n) => n + 1);
      }
    }, CCP_HEARTBEAT_MS);

    return () => {
      window.removeEventListener('beforeunload', release);
      window.removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(poll);
      // Unmount: release primary so a sibling tab can claim it. The init effect's
      // own cleanup also releases, but it bails early while a call is active — so
      // release here too (the host is going away regardless).
      release();
    };
  }, [active]);

  return { containerRef, status, initialised, dialNumber };
}

/** Safe getContactId wrapper used inside lifecycle callbacks. */
function safeContactId(contact: ConnectContact): string | undefined {
  try {
    return contact.getContactId();
  } catch {
    return undefined;
  }
}
