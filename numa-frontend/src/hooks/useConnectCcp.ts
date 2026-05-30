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

/** Status of the CCP softphone itself. */
export type CcpStatus = 'not_configured' | 'initialising' | 'needs_login' | 'ready' | 'error';

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
  // Tolerate a trailing slash on the stored instance URL.
  return `${instanceUrl.trim().replace(/\/+$/, '')}/connect/ccp-v2/`;
}

/** Connect region for initCCP — configurable via sessionStorage, defaults to Sydney.
 *  Exported for tests. */
export function getConnectRegion(): string {
  if (typeof window === 'undefined') return 'ap-southeast-2';
  return window.sessionStorage.getItem('CONNECT_REGION') || 'ap-southeast-2';
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
export function useConnectCcp(active: boolean): UseConnectCcpResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialisedRef = useRef(false);
  // The just-dialled prospect, before a contactId exists; consumed when the
  // contact appears and moved into the per-contact map below.
  const pendingProspectRef = useRef<Prospect | undefined>(undefined);
  // Prospect + call-start keyed BY contactId, so overlapping contacts never
  // cross-thread each other's prospect context / duration (the CCP contact alone
  // doesn't carry the prospect).
  const prospectByContactRef = useRef<Map<string, Prospect>>(new Map());
  const startedAtByContactRef = useRef<Map<string, number>>(new Map());
  // Resets a stuck optimistic 'dialing' state if neither onConnected nor onEnded
  // fires (dial accepted by the API but silently never progresses).
  const dialTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      publishCallState({ phone, state: 'dialing' });
      dialNumber(phone);
    };
    window.addEventListener(VOICE_DIAL_EVENT, listener);
    return () => window.removeEventListener(VOICE_DIAL_EVENT, listener);
  }, [dialNumber]);

  // Initialise the CCP once the widget is active and the container exists.
  useEffect(() => {
    if (!active) return undefined;

    const ccpUrl = getCcpUrl();
    if (!ccpUrl) {
      setStatus('not_configured');
      return undefined;
    }

    const container = containerRef.current;
    if (!container) return undefined;

    // initCCP must run exactly once per container element. If we've already
    // initialised, do nothing — React strict-mode double-mounts and re-renders
    // would otherwise stack multiple iframes / event handlers.
    if (initialisedRef.current) return undefined;

    let cancelled = false;

    const init = async () => {
      try {
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
          return;
        }

        connect.core.initCCP(container, {
          ccpUrl,
          region: getConnectRegion(),
          loginPopup: true,
          loginPopupAutoClose: true,
          softphone: {
            allowFramedSoftphone: true,
          },
        });

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
          if (contactId && prospect) prospectByContactRef.current.set(contactId, prospect);
          pendingProspectRef.current = undefined;
          const prospectFor = (c: ConnectContact): Prospect | undefined => {
            const id = safeContactId(c) ?? contactId;
            return id ? prospectByContactRef.current.get(id) : undefined;
          };
          publishVoiceContact({ phase: 'connecting', contactId, prospect });

          contact.onConnected((c) => {
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
            const id = safeContactId(c) ?? contactId;
            const startedAt = id ? startedAtByContactRef.current.get(id) : undefined;
            publishVoiceContact({
              phase: 'acw',
              contactId: id,
              phoneNumber: getContactPhoneNumber(c),
              prospect: prospectFor(c),
              durationSeconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : undefined,
            });
          });

          contact.onEnded((c) => {
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
          });
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
      if (dialTimeoutRef.current) {
        clearTimeout(dialTimeoutRef.current);
        dialTimeoutRef.current = undefined;
      }
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
