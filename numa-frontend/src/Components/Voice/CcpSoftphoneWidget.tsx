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
import { useCallback, useEffect, useState } from 'react';
import { Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getFlag } from '../../utils/featureFlags';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useConnectCcp, VOICE_DIAL_EVENT } from '../../hooks/useConnectCcp';
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
    } catch {
      return null;
    }
  }, [numaGet]);

  // Initialise the CCP eagerly when Voice is enabled (NOT only after the SDR
  // opens the panel) — otherwise a click-to-dial from the prospect table before
  // the panel was ever opened has no live CCP and silently no-ops.
  const { containerRef, status } = useConnectCcp(flagEnabled && browserSupport !== 'unsupported', getSignInUrl);

  // Auto-open the panel when a dial is requested so the SDR sees the call and
  // the iframe is visible for the softphone UI.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onDial = (): void => setOpen(true);
    window.addEventListener(VOICE_DIAL_EVENT, onDial);
    return () => window.removeEventListener(VOICE_DIAL_EVENT, onDial);
  }, []);

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
        <div className="p-3 text-center text-danger small">
          <i className="bi bi-exclamation-octagon me-1" aria-hidden="true"></i>
          {t('ccp.error')}
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
          <i className="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i>
          {t('ccp.loginPrompt')}
        </div>
      );
    }
    // ready
    return (
      <div className="px-3 pt-2 text-center text-muted small">
        <i className="bi bi-mic me-1" aria-hidden="true"></i>
        {t('ccp.micPrompt')}
      </div>
    );
  };

  // The iframe host stays mounted whenever Voice is enabled + configured (so the
  // CCP initialises without the SDR opening the panel); we only hide the chrome.
  const showIframeHost = status !== 'not_configured' && status !== 'error';

  return (
    <>
      {/* Floating toggle button (bottom-right). */}
      <Button
        variant={open ? 'secondary' : 'primary'}
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-circle d-flex align-items-center justify-content-center shadow"
        aria-expanded={open}
        aria-label={open ? t('ccp.hide') : t('ccp.show')}
        title={open ? t('ccp.hide') : t('ccp.show')}
        style={{
          position: 'fixed',
          right: 20,
          // Sit above the AskNuma FAB (bottom:24, ~56px tall) so they don't overlap.
          bottom: 88,
          width: 56,
          height: 56,
          zIndex: 1060,
        }}
      >
        <i className={`bi ${open ? 'bi-chevron-down' : 'bi-telephone-fill'} fs-5`} aria-hidden="true"></i>
      </Button>

      {/* Softphone panel. */}
      <div
        className="bg-white border rounded-3 shadow-lg overflow-hidden d-flex flex-column"
        style={{
          position: 'fixed',
          right: 20,
          // Above the toggle button (which is itself above the AskNuma FAB).
          bottom: 156,
          width: PANEL_WIDTH,
          maxWidth: 'calc(100vw - 40px)',
          zIndex: 1060,
          // Keep mounted (so the iframe/session persists) but hide when collapsed.
          display: open ? 'flex' : 'none',
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
                  height: PANEL_BODY_HEIGHT,
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
