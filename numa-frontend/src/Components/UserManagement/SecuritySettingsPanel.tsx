import { useState, useEffect, useCallback } from 'react';
import { Form, Button, Spinner, Alert, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AdminMfaSettingsService } from '../../Services/AdminMfaSettingsService';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

type SecuritySettingsPanelProps = {
  mfaEnabled: boolean;
  numaGet?: NumaGet;
  numaPut?: NumaPut;
};

// Validation limits
const IDLE_TIMEOUT_MAX = 480; // minutes (8 hours)
const MAX_SESSION_DURATION_MAX = 8760; // hours (1 year)
const MFA_MAX_HOURS = 24;
const MFA_MAX_DAYS = 90;

/** Returns true if the string represents a valid integer in [0, max]. */
const isValidInt = (value: string, max: number): boolean => {
  if (value === '' || value === '0') return true;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max;
};

/** Tooltip icon shown next to input with the max allowed value. */
const MaxTooltip = ({ max, unit }: { max: number; unit: string }) => (
  <OverlayTrigger placement="top" overlay={<Tooltip>{`Max: ${max} ${unit}`}</Tooltip>}>
    <i className="bi bi-info-circle text-muted" style={{ cursor: 'pointer' }}></i>
  </OverlayTrigger>
);

/**
 * Admin panel for session expiry and MFA device trust settings.
 * Rendered inside the Users tab of admin settings.
 */
export const SecuritySettingsPanel = ({ mfaEnabled, numaGet, numaPut }: SecuritySettingsPanelProps) => {
  const { t } = useTranslation('settings');

  // All inputs stored as strings — the single source of truth for what the user typed.
  // Parsed to numbers only at save time (after validation passes).
  const [mfaInputValue, setMfaInputValue] = useState<string>('0');
  const [mfaUnit, setMfaUnit] = useState<'hours' | 'days'>('days');
  const [idleTimeoutInput, setIdleTimeoutInput] = useState<string>('0');
  const [maxSessionInput, setMaxSessionInput] = useState<string>('0');

  // Loading/save state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ variant: string; message: string } | null>(null);

  const mfaMaxForUnit = mfaUnit === 'days' ? MFA_MAX_DAYS : MFA_MAX_HOURS;

  // Single validation pass — drives red borders, error messages, and save button state
  const idleValid = isValidInt(idleTimeoutInput, IDLE_TIMEOUT_MAX);
  const maxSessionValid = isValidInt(maxSessionInput, MAX_SESSION_DURATION_MAX);
  const mfaValid = !mfaEnabled || isValidInt(mfaInputValue, mfaMaxForUnit);

  const hasErrors = !idleValid || !maxSessionValid || !mfaValid;

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await AdminMfaSettingsService.get(numaGet);
      const hours = settings.rememberDurationHours;
      const unit = hours > 0 && hours % 24 === 0 ? 'days' : 'hours';
      setMfaUnit(unit);
      setMfaInputValue(String(unit === 'days' ? Math.floor(hours / 24) : hours));

      setIdleTimeoutInput(String(settings.sessionIdleTimeoutMinutes));
      setMaxSessionInput(String(settings.maxSessionDurationHours));
    } catch {
      // Defaults are fine
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    if (hasErrors) return;

    // Parse values from input strings — safe because hasErrors is false
    const idleTimeout = parseInt(idleTimeoutInput, 10) || 0;
    const maxSession = parseInt(maxSessionInput, 10) || 0;
    const mfaDisplay = parseInt(mfaInputValue, 10) || 0;
    const rememberHours = mfaUnit === 'days' ? mfaDisplay * 24 : mfaDisplay;

    try {
      setSaving(true);
      setSaveStatus(null);
      await AdminMfaSettingsService.update(
        {
          rememberDurationHours: rememberHours,
          sessionIdleTimeoutMinutes: idleTimeout,
          maxSessionDurationHours: maxSession,
        },
        numaPut
      );
      setSaveStatus({ variant: 'success', message: t('securitySettings.saveSuccess') });
    } catch (e) {
      setSaveStatus({
        variant: 'danger',
        message: (e as Error).message || t('errors.saveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" />
      </div>
    );
  }

  const idleParsed = parseInt(idleTimeoutInput, 10);
  const maxSessionParsed = parseInt(maxSessionInput, 10);
  const mfaParsed = parseInt(mfaInputValue, 10);

  return (
    <div className="mt-4">
      <Alert variant="secondary" className="mb-3">
        <div className="d-flex align-items-start">
          <i className="bi bi-shield-lock me-2 mt-1"></i>
          <div>
            <div className="settings-section-title">{t('securitySettings.title')}</div>
            <div className="small text-muted">{t('securitySettings.description')}</div>
          </div>
        </div>
      </Alert>

      <Form>
        {/* Session Expiry Settings */}
        <div className="mb-4 p-3 border rounded-3 bg-light">
          <h6 className="fw-semibold mb-3">
            <i className="bi bi-clock-history me-2"></i>
            {t('securitySettings.sessionExpiry.title')}
          </h6>

          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">{t('securitySettings.sessionExpiry.idleTimeoutLabel')}</Form.Label>
            <div className="d-flex align-items-center gap-2" style={{ maxWidth: 340 }}>
              <Form.Control
                type="number"
                min={0}
                max={IDLE_TIMEOUT_MAX}
                value={idleTimeoutInput}
                isInvalid={!idleValid}
                onChange={(e) => setIdleTimeoutInput(e.target.value)}
                onBlur={() => {
                  if (idleTimeoutInput === '') setIdleTimeoutInput('0');
                }}
                style={{ maxWidth: 100 }}
              />
              <span className="text-muted">{t('securitySettings.sessionExpiry.minutes')}</span>
              <MaxTooltip max={IDLE_TIMEOUT_MAX} unit={t('securitySettings.sessionExpiry.minutes')} />
            </div>
            {!idleValid && (
              <Form.Text className="text-danger">
                {t('securitySettings.validation.idleTimeout', { max: IDLE_TIMEOUT_MAX })}
              </Form.Text>
            )}
            {idleValid && (
              <Form.Text className="text-muted">
                {t('securitySettings.sessionExpiry.idleTimeoutHelp', { max: IDLE_TIMEOUT_MAX })}
              </Form.Text>
            )}
            {idleValid && (isNaN(idleParsed) || idleParsed === 0) && (
              <div className="mt-2">
                <Alert variant="info" className="mb-0 py-2 px-3">
                  <i className="bi bi-info-circle me-2"></i>
                  {t('securitySettings.sessionExpiry.idleDisabled')}
                </Alert>
              </div>
            )}
          </Form.Group>

          <Form.Group className="mb-0">
            <Form.Label className="fw-semibold">{t('securitySettings.sessionExpiry.maxDurationLabel')}</Form.Label>
            <div className="d-flex align-items-center gap-2" style={{ maxWidth: 340 }}>
              <Form.Control
                type="number"
                min={0}
                max={MAX_SESSION_DURATION_MAX}
                value={maxSessionInput}
                isInvalid={!maxSessionValid}
                onChange={(e) => setMaxSessionInput(e.target.value)}
                onBlur={() => {
                  if (maxSessionInput === '') setMaxSessionInput('0');
                }}
                style={{ maxWidth: 100 }}
              />
              <span className="text-muted">{t('securitySettings.sessionExpiry.hours')}</span>
              <MaxTooltip max={MAX_SESSION_DURATION_MAX} unit={t('securitySettings.sessionExpiry.hours')} />
            </div>
            {!maxSessionValid && (
              <Form.Text className="text-danger">
                {t('securitySettings.validation.maxDuration', { max: MAX_SESSION_DURATION_MAX })}
              </Form.Text>
            )}
            {maxSessionValid && (
              <Form.Text className="text-muted">
                {t('securitySettings.sessionExpiry.maxDurationHelp', { max: MAX_SESSION_DURATION_MAX })}
              </Form.Text>
            )}
            {maxSessionValid && (isNaN(maxSessionParsed) || maxSessionParsed === 0) && (
              <div className="mt-2">
                <Alert variant="info" className="mb-0 py-2 px-3">
                  <i className="bi bi-info-circle me-2"></i>
                  {t('securitySettings.sessionExpiry.maxDurationDisabled')}
                </Alert>
              </div>
            )}
          </Form.Group>
        </div>

        {/* MFA Device Trust Duration (only when MFA is enabled) */}
        {mfaEnabled && (
          <div className="mb-4 p-3 border rounded-3 bg-light">
            <h6 className="fw-semibold mb-3">
              <i className="bi bi-phone me-2"></i>
              {t('mfaSettings.title')}
            </h6>
            <p className="small text-muted mb-3">{t('mfaSettings.description')}</p>

            <Form.Group className="mb-0">
              <Form.Label className="fw-semibold">{t('mfaSettings.durationLabel')}</Form.Label>
              <div className="d-flex align-items-center gap-2" style={{ maxWidth: 340 }}>
                <Form.Control
                  type="number"
                  min={0}
                  max={mfaMaxForUnit}
                  value={mfaInputValue}
                  isInvalid={!mfaValid}
                  onChange={(e) => setMfaInputValue(e.target.value)}
                  onBlur={() => {
                    if (mfaInputValue === '') setMfaInputValue('0');
                  }}
                  style={{ maxWidth: 100 }}
                />
                <Form.Select
                  value={mfaUnit}
                  onChange={(e) => {
                    const newUnit = e.target.value as 'hours' | 'days';
                    const newMax = newUnit === 'days' ? MFA_MAX_DAYS : MFA_MAX_HOURS;
                    const currentParsed = parseInt(mfaInputValue, 10) || 0;
                    // Convert between units: hours→days divide by 24, days→hours multiply by 24
                    const converted = newUnit === 'days' ? Math.floor(currentParsed / 24) : currentParsed * 24;
                    const clamped = Math.min(converted, newMax);
                    setMfaUnit(newUnit);
                    setMfaInputValue(String(clamped));
                  }}
                  style={{ maxWidth: 100 }}
                >
                  <option value="hours">{t('mfaSettings.unitHours')}</option>
                  <option value="days">{t('mfaSettings.unitDays')}</option>
                </Form.Select>
                <MaxTooltip
                  max={mfaMaxForUnit}
                  unit={mfaUnit === 'days' ? t('mfaSettings.unitDays') : t('mfaSettings.unitHours')}
                />
              </div>
              {!mfaValid && (
                <Form.Text className="text-danger">
                  {t('securitySettings.validation.mfaDuration', {
                    max: mfaMaxForUnit,
                    unit: mfaUnit === 'days' ? t('mfaSettings.unitDays') : t('mfaSettings.unitHours'),
                  })}
                </Form.Text>
              )}
              {mfaValid && (
                <Form.Text className="text-muted">
                  {t('mfaSettings.durationHelp', { maxHours: MFA_MAX_HOURS, maxDays: MFA_MAX_DAYS })}
                </Form.Text>
              )}
            </Form.Group>

            {mfaValid && (isNaN(mfaParsed) || mfaParsed === 0) && (
              <Alert variant="info" className="mt-2 mb-0 py-2 px-3">
                <i className="bi bi-info-circle me-2"></i>
                {t('mfaSettings.zeroMeansAlways')}
              </Alert>
            )}
          </div>
        )}

        {saveStatus && (
          <Alert variant={saveStatus.variant} className="mb-3" dismissible onClose={() => setSaveStatus(null)}>
            {saveStatus.message}
          </Alert>
        )}

        <Button variant="primary" disabled={saving || hasErrors} onClick={handleSave}>
          {saving ? (
            <>
              <Spinner as="span" animation="border" size="sm" className="me-2" />
              {t('common:saving')}
            </>
          ) : (
            t('common:save')
          )}
        </Button>
      </Form>
    </div>
  );
};
