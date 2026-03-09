import { useState, useEffect, useCallback } from 'react';
import { Form, Button, Spinner, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AdminMfaSettingsService } from '../../Services/AdminMfaSettingsService';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

type SecuritySettingsPanelProps = {
  mfaEnabled: boolean;
  numaGet?: NumaGet;
  numaPut?: NumaPut;
};

/**
 * Admin panel for session expiry and MFA device trust settings.
 * Rendered inside the Users tab of admin settings.
 */
export const SecuritySettingsPanel = ({ mfaEnabled, numaGet, numaPut }: SecuritySettingsPanelProps) => {
  const { t } = useTranslation('settings');

  // MFA device trust state
  const [mfaRememberHours, setMfaRememberHours] = useState<number>(0);
  const [mfaInputValue, setMfaInputValue] = useState<string>('0');
  const [mfaUnit, setMfaUnit] = useState<'hours' | 'days'>('days');

  // Session expiry state
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState<number>(0);
  const [idleTimeoutInput, setIdleTimeoutInput] = useState<string>('0');
  const [maxSessionHours, setMaxSessionHours] = useState<number>(0);
  const [maxSessionInput, setMaxSessionInput] = useState<string>('0');

  // Loading/save state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ variant: string; message: string } | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await AdminMfaSettingsService.get(numaGet);
      const hours = settings.rememberDurationHours;
      setMfaRememberHours(hours);
      const unit = hours > 0 && hours % 24 === 0 ? 'days' : 'hours';
      setMfaUnit(unit);
      setMfaInputValue(String(unit === 'days' ? Math.floor(hours / 24) : hours));

      setIdleTimeoutMinutes(settings.sessionIdleTimeoutMinutes);
      setIdleTimeoutInput(String(settings.sessionIdleTimeoutMinutes));
      setMaxSessionHours(settings.maxSessionDurationHours);
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
    try {
      setSaving(true);
      setSaveStatus(null);
      await AdminMfaSettingsService.update(
        {
          rememberDurationHours: mfaRememberHours,
          sessionIdleTimeoutMinutes: idleTimeoutMinutes,
          maxSessionDurationHours: maxSessionHours,
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
                max={480}
                value={idleTimeoutInput}
                onChange={(e) => {
                  const str = e.target.value;
                  setIdleTimeoutInput(str);
                  const parsed = parseInt(str, 10);
                  if (!isNaN(parsed) && parsed >= 0) {
                    setIdleTimeoutMinutes(Math.min(parsed, 480));
                  } else {
                    setIdleTimeoutMinutes(0);
                  }
                }}
                onBlur={() => {
                  if (idleTimeoutInput === '') setIdleTimeoutInput('0');
                }}
                style={{ maxWidth: 100 }}
              />
              <span className="text-muted">{t('securitySettings.sessionExpiry.minutes')}</span>
            </div>
            <Form.Text className="text-muted">{t('securitySettings.sessionExpiry.idleTimeoutHelp')}</Form.Text>
            {idleTimeoutMinutes === 0 && (
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
                max={8760}
                value={maxSessionInput}
                onChange={(e) => {
                  const str = e.target.value;
                  setMaxSessionInput(str);
                  const parsed = parseInt(str, 10);
                  if (!isNaN(parsed) && parsed >= 0) {
                    setMaxSessionHours(Math.min(parsed, 8760));
                  } else {
                    setMaxSessionHours(0);
                  }
                }}
                onBlur={() => {
                  if (maxSessionInput === '') setMaxSessionInput('0');
                }}
                style={{ maxWidth: 100 }}
              />
              <span className="text-muted">{t('securitySettings.sessionExpiry.hours')}</span>
            </div>
            <Form.Text className="text-muted">{t('securitySettings.sessionExpiry.maxDurationHelp')}</Form.Text>
            {maxSessionHours === 0 && (
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
                  max={mfaUnit === 'days' ? 365 : 8760}
                  value={mfaInputValue}
                  onChange={(e) => {
                    const str = e.target.value;
                    setMfaInputValue(str);
                    const parsed = parseInt(str, 10);
                    if (!isNaN(parsed) && parsed >= 0) {
                      const maxVal = mfaUnit === 'days' ? 365 : 8760;
                      const clamped = Math.min(parsed, maxVal);
                      setMfaRememberHours(mfaUnit === 'days' ? clamped * 24 : clamped);
                    } else {
                      setMfaRememberHours(0);
                    }
                  }}
                  onBlur={() => {
                    if (mfaInputValue === '') setMfaInputValue('0');
                  }}
                  style={{ maxWidth: 100 }}
                />
                <Form.Select
                  value={mfaUnit}
                  onChange={(e) => {
                    const newUnit = e.target.value as 'hours' | 'days';
                    setMfaUnit(newUnit);
                    const display = newUnit === 'days' ? Math.floor(mfaRememberHours / 24) : mfaRememberHours;
                    setMfaInputValue(String(display));
                  }}
                  style={{ maxWidth: 100 }}
                >
                  <option value="hours">{t('mfaSettings.unitHours')}</option>
                  <option value="days">{t('mfaSettings.unitDays')}</option>
                </Form.Select>
              </div>
              <Form.Text className="text-muted">{t('mfaSettings.durationHelp')}</Form.Text>
            </Form.Group>

            {mfaRememberHours === 0 && (
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

        <Button variant="primary" disabled={saving} onClick={handleSave}>
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
