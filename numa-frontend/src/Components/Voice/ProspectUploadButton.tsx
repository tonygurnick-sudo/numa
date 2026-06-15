import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { uploadProspectSpreadsheet, isIntakeSpreadsheet, INTAKE_EXTENSIONS } from '../../Services/voiceData';

/**
 * ProspectUploadButton — FEAT-167 intake upload surface.
 *
 * A self-contained "Upload prospects" button (hidden file input) that puts a
 * .xlsx/.xls straight into the per-tenant prospect-intake bucket. The bucket's
 * S3 notification fires the intake lambda → Prospect Ingest agent, so once the
 * upload lands there is nothing else for the researcher to do — the success
 * state says so explicitly because the new rows only appear after the agent
 * has run (typically within a couple of minutes).
 *
 * Renders nothing when VOICE_INTAKE_BUCKET is absent from sessionStorage
 * (voice off, or a pre-FEAT-167 deployment) — the affordance simply doesn't
 * exist rather than failing on click.
 */

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

/** How long the done/error chip stays before reverting to the idle button. */
const RESET_DELAY_MS = 6000;

export const ProspectUploadButton: React.FC = () => {
  const { t } = useTranslation('voice');
  const { getCredentials } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  /** Auto-revert the transient SUCCESS chip back to the button. Errors are NOT
   *  auto-reverted — they stay (with the button kept visible) so the SDR can read
   *  the message and retry rather than the failure vanishing after 6s. */
  const scheduleSuccessReset = useCallback(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setState('idle'), RESET_DELAY_MS);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      setErrorText('');
      if (!isIntakeSpreadsheet(file.name)) {
        setErrorText(
          t('intake.wrongType', {
            defaultValue: 'Only {{types}} files can be ingested',
            types: INTAKE_EXTENSIONS.join(' / '),
          })
        );
        setState('error');
        return;
      }
      setState('uploading');
      try {
        const credentials = await getCredentials();
        if (!credentials) throw new Error('no credentials');
        await uploadProspectSpreadsheet(credentials, file);
        setState('done');
        scheduleSuccessReset();
      } catch (err) {
        console.error('[ProspectUploadButton] upload failed:', err);
        setErrorText(t('intake.error', { defaultValue: 'Upload failed — try again' }));
        setState('error');
      }
    },
    [getCredentials, scheduleSuccessReset, t]
  );

  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Allow re-selecting the same file later (change wouldn't fire otherwise).
      event.target.value = '';
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  // No intake bucket configured (voice off / old deploy) — no affordance.
  if (!window.sessionStorage.getItem('VOICE_INTAKE_BUCKET')) {
    return null;
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={INTAKE_EXTENSIONS.join(',')}
        className="d-none"
        data-testid="prospect-upload-input"
        onChange={onInputChange}
      />
      {state === 'done' ? (
        <span className="small text-success-emphasis text-nowrap">
          <i className="bi bi-check-circle-fill me-1" aria-hidden="true"></i>
          {t('intake.done', { defaultValue: 'Uploaded — prospects will appear after ingest' })}
        </span>
      ) : (
        // Idle / uploading / error all keep the button so a failed upload is
        // RETRYABLE (the error message sits beside it and persists until retry).
        <span className="d-inline-flex align-items-center gap-2 flex-wrap">
          <Button
            variant={state === 'error' ? 'outline-danger' : 'outline-secondary'}
            size="sm"
            className="text-nowrap"
            disabled={state === 'uploading'}
            onClick={() => inputRef.current?.click()}
          >
            {state === 'uploading' ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" aria-hidden="true" />
                {t('intake.uploading', { defaultValue: 'Uploading…' })}
              </>
            ) : state === 'error' ? (
              <>
                <i className="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>
                {t('intake.retry', { defaultValue: 'Retry upload' })}
              </>
            ) : (
              <>
                <i className="bi bi-file-earmark-spreadsheet me-1" aria-hidden="true"></i>
                {t('intake.upload', { defaultValue: 'Upload prospects' })}
              </>
            )}
          </Button>
          {state === 'error' && (
            <span className="small text-danger-emphasis">
              <i className="bi bi-exclamation-triangle-fill me-1" aria-hidden="true"></i>
              {errorText}
            </span>
          )}
        </span>
      )}
    </>
  );
};

export default ProspectUploadButton;
