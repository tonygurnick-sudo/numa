import React from 'react';
import Alert from 'react-bootstrap/Alert';
import { useTranslation } from 'react-i18next';

/**
 * RecordingConsentBanner — a persistent, non-dismissible notice that Numa Voice
 * records calls (audio → Amazon Transcribe → AI post-call analysis) and that the
 * SDR is responsible for disclosing this to the prospect at the start of the call.
 *
 * Recording-consent law varies by jurisdiction (AU/NZ are generally one-party for
 * the recording party, but disclosure is best practice and required in some
 * states/countries). The agent also hears an automated whisper reminder before
 * each call (the OUTBOUND_WHISPER contact flow), and the SDR attests to disclosure
 * in the post-call wrap-up — this banner is the always-on visual half of that.
 */
export const RecordingConsentBanner: React.FC = () => {
  const { t } = useTranslation('voice');
  return (
    <Alert variant="info" className="py-2 px-3 small mb-3 d-flex align-items-start gap-2" role="note">
      <i className="bi bi-record-circle-fill text-danger mt-1 flex-shrink-0" aria-hidden="true"></i>
      <span>
        <strong>{t('consent.title')}</strong> {t('consent.body')}
      </span>
    </Alert>
  );
};

export default RecordingConsentBanner;
