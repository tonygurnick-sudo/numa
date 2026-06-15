/**
 * CcpSoftphoneWidget — floating, collapsible Amazon Connect softphone for Numa Voice.
 *
 * Mounts at the app-shell level (see integration_needs: add <CcpSoftphoneWidget/>
 * to AppLayout) so the embedded CCP iframe — and therefore the agent's live call
 * session — survives navigation between Voice and other pages. Gated by
 * getFlag('NUMA_VOICE'): renders nothing when the flag is off.
 *
 * Behaviour:
 *   - A fixed bottom-right toggle button shows/hides the panel.
 *   - The CCP iframe is created lazily on first open via useConnectCcp and then
 *     kept mounted (only visually collapsed) so the call/session is not torn
 *     down when the user hides the panel. initCCP must run exactly once per
 *     container element — the hook enforces that.
 *   - The iframe initCCP injects requests microphone access itself (allow=microphone),
 *     so there is no CSP / getUserMedia work to do here.
 *   - Contact lifecycle is published on the `numa-voice-contact` window event by
 *     the hook; the prospect table dials via `dialVoiceNumber(e164)`. This widget
 *     does not need to own that wiring — it just hosts the iframe.
 *
 * The whole thing is a no-op without a configured CONNECT_INSTANCE_URL: it shows
 * a "not configured" notice instead of an iframe.
 *
 * RUNTIME NOTE: highest runtime-risk piece of Numa Voice — cannot be validated
 * without a live Amazon Connect instance whose Approved Origins allow this
 * domain. See useConnectCcp for the initCCP details.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getFlag } from '../../utils/featureFlags';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import {
  useConnectCcp,
  getCcpUrl,
  publishCcpStatus,
  VOICE_DIAL_EVENT,
  VOICE_CALL_STATE_EVENT,
} from '../../hooks/useConnectCcp';
import type { VoiceCallStateEventDetail, CcpStatus } from '../../hooks/useConnectCcp';
import { getVoiceBrowserSupport } from '../../utils/voiceBrowserSupport';

/** Minimum CCP iframe footprint required by amazon-connect-streams ccp-v2. */
const PANEL_WIDTH = 320;
const PANEL_BODY_HEIGHT = 465;

export const CcpSoftphoneWidget = () => {
  const { t } = useTranslation('voice');
  const flagEnabled = getFlag('NUMA_VOICE');
  const { numaGet } = useNumaRequest();

  // Embedded CCP needs third-party cookies on the Connect origin. Safari/iOS block
  // them outright (no path), so we don't even initialise the iframe there — we show
  // a "use Chrome/Edge" message instead of letting the agent hit a silent login loop.
  // Firefox is best-effort (warned, but attempted). See voiceBrowserSupport.ts.
  const [browserSupport] = useState(getVoiceBrowserSupport);

  // `open` controls panel visibility only — the iframe host stays mounted while
  // the flag is on so the agent session persists across collapse/navigation.
  const [open, setOpen] = useState(false);

  // Passwordless SSO: mint a federation SignInUrl (GetFederationToken) for the
  // authenticated Numa user so the CCP iframe logs in without a Connect password.
  // Returns null on failure → the hook falls back to the static login popup.
  const getSignInUrl = useCallback(async (): Promise<string | null> => {
    try {
      const res = (await numaGet('/api/voice/federation-token')) as { signInUrl?: string } | null;
      return res?.signInUrl ?? null;
    } catch (err) {
      console.warn('Numa Voice: failed to mint federation token; CCP will use the default login popup', err);
      return null;
    }
  }, [numaGet]);

  // Initialise the CCP eagerly when Voice is enabled (NOT only after the SDR
  // opens the panel) — otherwise a click-to-dial from the prospect table before
  // the panel was ever opened has no live CCP and silently no-ops.
  const { containerRef, status } = useConnectCcp(flagEnabled && browserSupport !== 'unsupported', getSignInUrl);

  // Holds the login popup opened by the Sign-in button so we can auto-close it
  // once the agent has authenticated (status → ready).
  const loginPopupRef = useRef<Window | null>(null);

  // Detects a STALLED login. The softphone signs in via Amazon Connect's
  // console-federation flow (signin.aws.amazon.com → /connect/federate). That
  // flow COLLIDES when the same browser already holds an AWS Console session:
  // the federate page runs as the user's own console identity (not the voice
  // agent) and returns "Access denied", so the agent never reaches `ready`.
  // It works for everyone WITHOUT a console session (i.e. every real SDR). We
  // can't read the cross-origin popup, so we infer the stall: if a sign-in was
  // attempted and the agent hasn't reached `ready` within the window, surface
  // guidance (use a profile not signed into the AWS Console). Bumped per attempt.
  const [signInTick, setSignInTick] = useState(0);
  const [loginStalled, setLoginStalled] = useState(false);
  useEffect(() => {
    if (signInTick === 0) return undefined; // no sign-in attempted yet
    if (status === 'ready') {
      setLoginStalled(false);
      return undefined;
    }
    const t = setTimeout(() => setLoginStalled(true), 25_000);
    return () => clearTimeout(t);
  }, [signInTick, status]);

  // Explicit, user-gesture-driven sign-in. initCCP's own loginPopup auto-opens on
  // mount, but browsers block popups that aren't triggered by a click — so the
  // agent was stranded in needs_login with no popup and no way to start login.
  // This button IS that click: open the popup synchronously (so it's allowed),
  // then navigate it to the freshly-minted federation URL. The SAML agent
  // auto-authenticates, lands on /ccp-v2, and the embedded iframe (same Connect
  // domain) picks up the session → onInitialized fires → status becomes ready.
  const signIn = useCallback(async () => {
    // Open a real browser TAB (no width/height features = tab, not a popup window).
    // Feature-restricted popups were being blocked / silently failing; a tab reliably
    // completes the SAML federation handoff. Open BEFORE the await so it's inside the
    // click's call stack (a window opened after an async hop gets blocked).
    const win = window.open('about:blank', 'numa-ccp-login');
    loginPopupRef.current = win;
    // Start (or restart) the stalled-login watchdog for this attempt.
    setLoginStalled(false);
    setSignInTick((n) => n + 1);
    let url = await getSignInUrl();
    // Federation mint failed → fall back to the bare ccp-v2 URL so the agent can still
    // sign in manually in the tab (the SAML login page can't be framed, but loads fine
    // as a top-level page).
    if (!url) url = getCcpUrl();
    if (!url) {
      win?.close();
      return;
    }
    if (win) win.location.href = url;
    else window.open(url, 'numa-ccp-login'); // blocked → last-ditch retry
  }, [getSignInUrl]);

  // Auto-close the login popup once the agent is authenticated.
  useEffect(() => {
    if (status === 'ready' && loginPopupRef.current) {
      try {
        loginPopupRef.current.close();
      } catch {
        /* already closed / cross-origin — close is best-effort on windows we opened */
      }
      loginPopupRef.current = null;
    }
  }, [status]);

  // Auto-open the panel when a dial is requested so the SDR sees the call and
  // the iframe is visible for the softphone UI.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onDial = (): void => setOpen(true);
    window.addEventListener(VOICE_DIAL_EVENT, onDial);
    return () => window.removeEventListener(VOICE_DIAL_EVENT, onDial);
  }, []);

  // Mirror live call state so the floating toggle turns green + pulses while a
  // call is connected. Purely cosmetic — does not touch the iframe / CCP lifecycle.
  const [onCall, setOnCall] = useState(false);
  // The floating phone launcher only shows when the Voice page is selected (per design)
  // — plus during a live call from anywhere, so an in-progress call is never trapped
  // without a hangup control. The widget itself stays mounted regardless so the CCP
  // iframe/session + inbound handling persist; we only gate the launcher + panel.
  const location = useLocation();
  const showLauncher = location.pathname.startsWith('/voice') || onCall;
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onState = (event: Event): void => {
      const detail = (event as CustomEvent<VoiceCallStateEventDetail>).detail;
      setOnCall(detail?.state === 'connected');
    };
    window.addEventListener(VOICE_CALL_STATE_EVENT, onState);
    return () => window.removeEventListener(VOICE_CALL_STATE_EVENT, onState);
  }, []);

  // Surface network state ON SCREEN. When the browser goes offline the embedded CCP
  // can't reach Connect (it logs "network offline" / "Failed to get agent data" on a
  // loop) — show the agent a clear banner instead of leaving them guessing why the
  // softphone stopped working.
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Publish softphone status to the cockpit (FocusCallCard) so its CTA reflects
  // reality (e.g. "Connect your phone first" when needs_login) instead of always
  // claiming "ready". Also re-announce on demand for late-mounting subscribers.
  // On an unsupported browser the CCP hook never runs (so it never publishes a
  // status) — publish 'unsupported' explicitly so the cockpit doesn't spin on
  // "Connecting your phone…" forever. When offline, publish 'offline' so the
  // cockpit blocks dialing + explains why (the in-panel offline banner is hidden
  // while the panel is collapsed — its normal state).
  const publishedStatus: CcpStatus = browserSupport === 'unsupported' ? 'unsupported' : !online ? 'offline' : status;
  useEffect(() => {
    publishCcpStatus(publishedStatus);
    const onRequest = (): void => publishCcpStatus(publishedStatus);
    window.addEventListener('numa-voice-ccp-status-request', onRequest);
    return () => window.removeEventListener('numa-voice-ccp-status-request', onRequest);
  }, [publishedStatus]);

  if (!flagEnabled) return null;

  const renderStatusNotice = () => {
    if (status === 'not_configured') {
      return (
        <div className="p-3 text-center text-muted small">
          <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
          {t('ccp.notConfigured')}
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div className="p-3 text-center small">
          <div className="text-danger mb-2">
            <i className="bi bi-exclamation-octagon me-1" aria-hidden="true"></i>
            {t('ccp.error')}
          </div>
          <Button variant="primary" size="sm" onClick={signIn}>
            <i className="bi bi-telephone-outbound me-1" aria-hidden="true"></i>
            {t('ccp.signIn')}
          </Button>
        </div>
      );
    }
    if (status === 'inactive_tab') {
      // Another browser tab already owns the single CCP agent session, so this
      // tab deliberately skipped initCCP. If that tab closes, the cross-tab guard
      // promotes this one automatically (no reload needed).
      return (
        <div className="p-3 text-center text-muted small" style={{ minHeight: PANEL_BODY_HEIGHT / 2 }}>
          <i className="bi bi-window-stack d-block fs-3 mb-2" aria-hidden="true"></i>
          {t('ccp.activeInOtherTab', { defaultValue: 'The softphone is active in another browser tab.' })}
        </div>
      );
    }
    if (status === 'initialising') {
      return (
        <div className="p-3 text-center text-muted small">
          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
          {t('ccp.connecting')}
        </div>
      );
    }
    if (status === 'needs_login') {
      return (
        <div className="px-3 pt-2 text-center text-muted small">
          <div className="mb-2">{t('ccp.loginPrompt')}</div>
          <Button variant="primary" size="sm" onClick={signIn}>
            <i className="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i>
            {t('ccp.signIn')}
          </Button>
          {loginStalled && (
            <div
              className="mt-3 px-2 py-2 text-start text-warning-emphasis bg-warning-subtle border border-warning-subtle rounded small"
              data-testid="voice-ccp-console-collision-hint"
            >
              <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
              {t('ccp.loginStalledHint')}
            </div>
          )}
        </div>
      );
    }
    // ready — the "allow microphone" nudge is only useful before the first call;
    // suppress it once a call is live (otherwise it lingers as a stale hint over
    // an active call, which reads like something is wrong).
    if (onCall) return null;
    return (
      <div className="px-3 pt-2 text-center text-muted small">
        <i className="bi bi-mic me-1" aria-hidden="true"></i>
        {t('ccp.micPrompt')}
      </div>
    );
  };

  // The iframe host stays mounted whenever Voice is enabled + configured (so the
  // CCP initialises without the SDR opening the panel); we only hide the chrome.
  // It MUST also stay mounted for 'inactive_tab' (collapsed to height 0): when the
  // primary tab closes, the takeover tick re-runs initCCP into containerRef — if
  // the host weren't rendered, containerRef.current would be null and this tab
  // could NEVER be promoted to primary.
  const showIframeHost = status !== 'not_configured' && status !== 'error';
  const iframeHostHeight = status === 'inactive_tab' ? 0 : PANEL_BODY_HEIGHT;

  return (
    <>
      {/* Floating toggle button — stacked directly ABOVE the AskNuma FAB (which is a
          ~56px circle at bottom:24/right:24). Only shown on the Voice page (or during a
          live call). Turns green + pulses on a live call. */}
      {showLauncher && (
        <Button
          variant={onCall ? 'success' : open ? 'secondary' : 'primary'}
          onClick={() => setOpen((prev) => !prev)}
          className={`rounded-circle d-flex align-items-center justify-content-center shadow${onCall ? ' pulse-on-call' : ''}`}
          aria-expanded={open}
          aria-label={open ? t('ccp.hide') : t('ccp.show')}
          title={open ? t('ccp.hide') : t('ccp.show')}
          style={{
            position: 'fixed',
            // Right-aligned with the AskNuma FAB (right:24), one FAB-height + gap above it.
            right: 24,
            bottom: 96,
            width: 56,
            height: 56,
            zIndex: 1060,
          }}
        >
          <i className={`bi ${open ? 'bi-chevron-down' : 'bi-telephone-fill'} fs-5`} aria-hidden="true"></i>
        </Button>
      )}

      {/* Softphone panel. NOTE: no `d-flex` class — Bootstrap's `.d-flex` is
          `display:flex !important`, which would override the inline `display:none`
          and make the panel impossible to hide. We drive display inline instead
          (flex when open, none when collapsed) and keep `flex-column` for direction. */}
      <div
        className="bg-white border rounded-3 shadow-lg overflow-hidden flex-column"
        style={{
          position: 'fixed',
          right: 20,
          // Above the toggle button (which sits above the AskNuma FAB, bottom-right).
          bottom: 164,
          width: PANEL_WIDTH,
          maxWidth: 'calc(100vw - 40px)',
          zIndex: 1060,
          // Keep mounted (so the iframe/session persists) but hide when collapsed OR when
          // the launcher is hidden (off the Voice page and not on a call).
          display: open && showLauncher ? 'flex' : 'none',
        }}
        role="region"
        aria-label={t('ccp.title')}
      >
        {/* Header */}
        <div className="d-flex align-items-center justify-content-between px-3 py-2 border-bottom bg-light">
          <span className="fw-semibold">
            <i className="bi bi-headset me-2" aria-hidden="true"></i>
            {t('ccp.title')}
          </span>
          <Button
            variant="link"
            size="sm"
            className="p-0 text-secondary"
            onClick={() => setOpen(false)}
            aria-label={t('ccp.hide')}
            title={t('ccp.hide')}
          >
            <i className="bi bi-x-lg" aria-hidden="true"></i>
          </Button>
        </div>

        {browserSupport === 'unsupported' ? (
          /* Safari/iOS: 3p cookies are hard-blocked, so the embedded CCP can never
             authenticate. Show clear guidance instead of a broken login loop. */
          <div className="p-3 text-center text-muted small" style={{ minHeight: PANEL_BODY_HEIGHT / 2 }}>
            <i className="bi bi-browser-chrome d-block fs-3 mb-2" aria-hidden="true"></i>
            {t('ccp.unsupportedBrowser')}
          </div>
        ) : (
          <>
            {/* Offline banner — the embedded CCP can't reach Connect while offline. */}
            {!online && (
              <div className="px-3 py-2 text-center text-warning small bg-warning-subtle border-bottom">
                <i className="bi bi-wifi-off me-1" aria-hidden="true"></i>
                {t('ccp.offline', {
                  defaultValue: "You're offline — the softphone will reconnect when your connection returns.",
                })}
              </div>
            )}

            {/* Firefox best-effort heads-up (still attempted below). */}
            {browserSupport === 'best_effort' && (
              <div className="px-3 pt-2 text-center text-warning small">
                <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
                {t('ccp.bestEffortBrowser')}
              </div>
            )}

            {/* Status notice (login prompt / mic prompt / errors) */}
            {renderStatusNotice()}

            {/*
              CCP iframe host. amazon-connect-streams renders its iframe inside this
              div. Kept mounted once created so the agent session/call survives the
              panel being collapsed. We only render it when configured.
            */}
            {showIframeHost && (
              <div
                ref={containerRef}
                style={{
                  width: '100%',
                  height: iframeHostHeight,
                  // Collapse (don't unmount) while another tab owns the session so
                  // the ref survives for a later takeover.
                  overflow: 'hidden',
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  );
};

export default CcpSoftphoneWidget;
