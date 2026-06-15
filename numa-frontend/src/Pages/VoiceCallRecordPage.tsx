import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { VoiceAnalyticsService } from '../Services/VoiceAnalyticsService';
import { CallRecordView } from '../Components/Voice/Analytics/CallRecordView';
import type { CallDetail } from '../types/voiceAnalytics';

/**
 * VoiceCallRecordPage — a linkable, first-class record for one call (/voice/calls/:id).
 * The deep-link target for the SDR "call summary ready" notification: recording,
 * AI summary/objections/next-steps, sentiment, transcript, and per-call cost.
 */
export const VoiceCallRecordPage = (): React.JSX.Element => {
  const { t } = useTranslation('voice');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { numaGet } = useNumaRequest();
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(false);
    VoiceAnalyticsService.getCallDetail(numaGet, id)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [numaGet, id]);

  return (
    <div className="container-fluid p-3" style={{ maxWidth: 720 }}>
      <Button variant="link" className="px-0 mb-2 text-decoration-none" onClick={() => navigate('/voice/analytics')}>
        <i className="bi bi-arrow-left me-1" aria-hidden="true" />
        {t('analytics.backToCalls', { defaultValue: 'Back to call logs' })}
      </Button>
      <h1 className="h4 mb-3">
        <i className="bi bi-telephone me-2" aria-hidden="true" />
        {t('analytics.callRecord', { defaultValue: 'Call record' })}
      </h1>
      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" role="status" />
        </div>
      ) : error || !detail ? (
        <Alert variant="danger">{t('analytics.callLoadError', { defaultValue: "Couldn't load this call." })}</Alert>
      ) : (
        <CallRecordView detail={detail} />
      )}
    </div>
  );
};

export default VoiceCallRecordPage;
