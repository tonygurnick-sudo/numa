import React, { useCallback, useEffect, useState } from 'react';
import Spinner from 'react-bootstrap/Spinner';
import Button from 'react-bootstrap/Button';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';
import { getFlag } from '../utils/featureFlags';
import { loadTodayCalls } from '../Services/voiceData';
import { ProspectListTable } from '../Components/Voice/ProspectListTable';
import { PostCallWrapUpPanel } from '../Components/Voice/PostCallWrapUpPanel';
import { SdrAssistSidebar } from '../Components/Voice/SdrAssistSidebar';
import type { Prospect } from '../types/voice';

/**
 * VoicePage — Numa Voice (Amazon Connect outbound calling + AI call intelligence
 * for SDRs).
 *
 * Phase 1: the prospect-list table. Loads the ordered daily call list
 * (today_calls.json) straight from the DATA bucket via the direct-S3 voiceData
 * service, using the caller's STS credentials from useAuth(). Each row exposes a
 * click-to-dial button that drives the CCP softphone widget via the
 * `numa-voice-dial` window CustomEvent (the table and CCP widget are decoupled —
 * see ProspectListTable for the contract).
 *
 * The whole surface is gated by the NUMA_VOICE feature flag. The /voice route is
 * already flag-gated in routeConfig, but we defensively gate here too so the page
 * never renders its data-loading body for a workspace without Voice enabled.
 */
export const VoicePage: React.FC = () => {
  const { t } = useTranslation('voice');
  const { getCredentials, user } = useAuth();
  const isAdmin = ((user?.decoded_tokens?.idToken?.['cognito:groups'] as string[] | undefined) ?? []).includes('admin');

  const voiceEnabled = getFlag('NUMA_VOICE');

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped to re-trigger the load effect on Retry.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!voiceEnabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    (async () => {
      try {
        const credentials = await getCredentials();
        if (!credentials) {
          // No active role/user yet — surface as a retryable error rather than
          // silently showing an empty list.
          if (!cancelled) {
            setError(true);
            setLoading(false);
          }
          return;
        }
        const todayCalls = await loadTodayCalls(credentials);
        if (cancelled) return;
        setProspects(todayCalls.calls);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[VoicePage] Failed to load today_calls:', err);
        setError(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [voiceEnabled, getCredentials, reloadToken]);

  const handleRetry = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  // ── Flag-off guard (defensive — route is also gated) ──────────────────────
  if (!voiceEnabled) {
    return (
      <div className="container py-5 text-center">
        <i className="bi bi-telephone-fill fs-1 text-primary" aria-hidden="true"></i>
        <h1 className="h3 mt-3">{t('page.title')}</h1>
        <p className="text-muted">{t('page.comingSoon')}</p>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      <header className="mb-4 d-flex justify-content-between align-items-start gap-2">
        <div>
          <h1 className="h3 d-flex align-items-center gap-2 mb-1">
            <i className="bi bi-telephone-fill text-primary" aria-hidden="true"></i>
            {t('page.title')}
          </h1>
          <p className="text-muted mb-0">{t('page.subtitle')}</p>
        </div>
        {isAdmin && (
          <Link to="/voice/admin" className="btn btn-outline-secondary btn-sm text-nowrap">
            <i className="bi bi-sliders me-1" aria-hidden="true"></i>
            {t('admin.title', { defaultValue: 'Voice Admin' })}
          </Link>
        )}
      </header>

      {/* Inline post-call wrap-up — renders only while a call is in ACW. */}
      <PostCallWrapUpPanel />

      <div className="row g-3">
        <div className="col-lg-8">
          <section className="bg-white border rounded-3 overflow-hidden" aria-label={t('prospectTable.title')}>
            <div className="px-3 py-2 border-bottom">
              <h2 className="h6 mb-0">{t('prospectTable.title')}</h2>
            </div>

            {loading ? (
              <div className="d-flex align-items-center justify-content-center py-5 text-muted">
                <Spinner animation="border" size="sm" className="me-2" />
                <span>{t('page.loading')}</span>
              </div>
            ) : error ? (
              <div className="text-center py-5">
                <p className="text-muted mb-3">{t('page.error')}</p>
                <Button variant="outline-primary" size="sm" onClick={handleRetry}>
                  <i className="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>
                  {t('page.retry')}
                </Button>
              </div>
            ) : (
              <ProspectListTable prospects={prospects} />
            )}
          </section>
        </div>

        {/* Live SDR assist — binds to the prospect on contact.onConnected. */}
        <div className="col-lg-4">
          <SdrAssistSidebar />
        </div>
      </div>
    </div>
  );
};

export default VoicePage;
