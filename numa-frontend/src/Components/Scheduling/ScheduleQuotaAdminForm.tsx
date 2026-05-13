/* eslint-disable i18next/no-literal-string -- admin-only scheduling UI; translations deferred to round-2 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Form, Button, Alert, Spinner, Row, Col, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { ScheduleService, type QuotaSummary, type TriggerLoadSummary } from '../../Services/ScheduleService';
import type { AgentSchedule } from '../../types/agentSchedules';
import { QuotaUsageRow } from './QuotaUsageRow';
import { getFlag } from '../../utils/featureFlags';

/**
 * Numeric quota fields exposed by the admin endpoint — used in `effective`
 * and `ceilings`.
 */
type NumericQuotaFields = {
  minIntervalMinutes: number;
  maxRunsPerCompanyPerMonth: number;
  maxRunsPerUserPerMonth: number;
  maxTriggerRunsPerCompanyPerMonth: number;
  maxTriggerRunsPerUserPerMonth: number;
  maxConcurrentActiveSchedulesPerCompany: number;
  maxConcurrentActiveSchedulesPerUser: number;
};

/**
 * Server-resolved quota structure returned by GET /api/settings/scheduling.
 * Backend resolves Level 1 (platform) + Level 2 (per-client CSP) into
 * `effective` and `ceilings`. Tenant admins can tighten user-level caps
 * (and raise the min-interval floor) within their tenant. They CANNOT
 * touch company-level caps — those are platform-controlled.
 */
type SchedulingQuotaResponse = {
  minIntervalMinutes: number | null;
  arcanumFloor: number;
  adminOverrides: Partial<NumericQuotaFields> & {
    requireApprovalAboveUserCap?: boolean;
  };
  effective: NumericQuotaFields & { requireApprovalAboveUserCap: boolean };
  ceilings: NumericQuotaFields & { requireApprovalAboveUserCap: boolean };
};

const formatNum = (v: number | undefined): string => (v == null ? '' : String(v));

/**
 * Admin Settings → Automations → quota panel.
 *
 * **Company-level quotas** (max runs/triggers/concurrent per company) are
 * platform-controlled — admins see them read-only with a "contact Arcanum"
 * note for changes.
 *
 * **User-level quotas** (max runs/triggers/concurrent per user, per agent;
 * minimum interval) are admin-tightable for this tenant: admin can LOWER
 * caps (or RAISE the min-interval floor) within the platform-imposed
 * ceiling, never above it.
 */
export const ScheduleQuotaAdminForm: React.FC = () => {
  const { t } = useTranslation('agents');
  const { numaGet, numaPut } = useNumaRequest();

  // Sub-flag of SCHEDULING — gates trigger usage rows and trigger quota
  // input fields. When false, this form shows only schedule (cron) quotas.
  const triggersEnabled = getFlag('EVENT_TRIGGERS');

  const [data, setData] = useState<SchedulingQuotaResponse | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<QuotaSummary | null>(null);
  const [triggerLoad, setTriggerLoad] = useState<TriggerLoadSummary | null>(null);
  const [tenantSchedules, setTenantSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastErrorStatus, setLastErrorStatus] = useState<number | null>(null);

  // Editable form state — empty string means "inherit from level 1+2".
  const [minInterval, setMinInterval] = useState('');
  const [maxUser, setMaxUser] = useState('');
  const [maxTriggerUser, setMaxTriggerUser] = useState('');
  const [maxConcurrent, setMaxConcurrent] = useState('');

  const load = useCallback(
    async (attempt = 1): Promise<void> => {
      if (attempt === 1) {
        setLoading(true);
        setError(null);
        setLastErrorStatus(null);
      }
      try {
        // Settings response is the source of truth for ceilings + overrides;
        // the other three are non-fatal — used purely to power the company-quota
        // usage bars at the top of the form.
        const [res, qs, tl, list] = await Promise.all([
          numaGet('/api/settings/scheduling') as Promise<SchedulingQuotaResponse>,
          ScheduleService.quotaSummary(numaGet).catch(() => null),
          ScheduleService.triggerLoad(numaGet, 30).catch(() => null),
          ScheduleService.listTenant(numaGet).catch(() => [] as AgentSchedule[]),
        ]);
        // Validate shape before commit — the render path indexes into
        // res.effective and res.adminOverrides without further guards, so a
        // malformed response (e.g. test stub returning []) would crash the
        // tree. Treat shape mismatch as a load error.
        if (!res || typeof res !== 'object' || !res.effective || !res.adminOverrides) {
          throw new Error('Malformed /api/settings/scheduling response');
        }
        setData(res);
        setQuotaSummary(qs);
        setTriggerLoad(tl);
        setTenantSchedules(list);
        setMinInterval(formatNum(res.adminOverrides.minIntervalMinutes));
        setMaxUser(formatNum(res.adminOverrides.maxRunsPerUserPerMonth));
        setMaxTriggerUser(formatNum(res.adminOverrides.maxTriggerRunsPerUserPerMonth));
        setMaxConcurrent(formatNum(res.adminOverrides.maxConcurrentActiveSchedulesPerUser));
        setError(null);
        setLastErrorStatus(null);
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status ?? null;
        if (status === 403 && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return load(attempt + 1);
        }
        setLastErrorStatus(status);
        setError(
          status === 403
            ? t('scheduling.quotaAdmin.loadError403', {
                defaultValue:
                  "Couldn't load scheduling settings — your session may have a stale token. Click Retry, or refresh the page.",
              })
            : t('scheduling.quotaAdmin.loadError', { defaultValue: 'Failed to load scheduling settings' })
        );
        console.error('ScheduleQuotaAdminForm load failed', err);
      } finally {
        setLoading(false);
      }
    },
    [numaGet, t]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = () => void load(1);

  const parseField = (raw: string, label: string): number | undefined => {
    if (raw === '') return undefined;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(`${label} must be a positive integer`);
    }
    return n;
  };

  /**
   * Inline ceiling check. `direction: 'upper'` means admin LOWERS — value
   * cannot exceed the ceiling. `direction: 'lower'` means admin RAISES (the
   * floor) — value cannot dip below the ceiling.
   */
  const validateAgainstCeiling = (
    raw: string,
    field: keyof NumericQuotaFields,
    direction: 'upper' | 'lower'
  ): string | null => {
    if (!data || raw === '') return null;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || !Number.isInteger(n) || n <= 0) return 'Must be a positive integer';
    const bound = data.ceilings[field] as number;
    if (direction === 'upper' && n > bound) return `Cannot exceed maximum of ${bound}`;
    if (direction === 'lower' && n < bound) return `Cannot go below minimum of ${bound}`;
    return null;
  };

  const fieldErrors = data
    ? {
        minIntervalMinutes: validateAgainstCeiling(minInterval, 'minIntervalMinutes', 'lower'),
        maxRunsPerUserPerMonth: validateAgainstCeiling(maxUser, 'maxRunsPerUserPerMonth', 'upper'),
        maxTriggerRunsPerUserPerMonth: validateAgainstCeiling(maxTriggerUser, 'maxTriggerRunsPerUserPerMonth', 'upper'),
        maxConcurrentActiveSchedulesPerUser: validateAgainstCeiling(
          maxConcurrent,
          'maxConcurrentActiveSchedulesPerUser',
          'upper'
        ),
      }
    : {};
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);

  /**
   * Concurrent-automations count = active or pending_approval cron + event
   * triggers combined. Mirrors the backend's `aggregateLoad` semantic where
   * the concurrent cap covers both kinds.
   */
  const activeAutomationCount = useMemo(
    () => tenantSchedules.filter((s) => s.status === 'active' || s.status === 'pending_approval').length,
    [tenantSchedules]
  );

  const handleSave = async () => {
    if (!data) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const payload = {
        quotas: {
          minIntervalMinutes: parseField(minInterval, 'Minimum interval'),
          maxRunsPerUserPerMonth: parseField(maxUser, 'Max schedule runs / user / month'),
          maxTriggerRunsPerUserPerMonth: parseField(maxTriggerUser, 'Max trigger runs / user / month'),
          maxConcurrentActiveSchedulesPerUser: parseField(maxConcurrent, 'Max concurrent active automations / user'),
          // requireApprovalAboveUserCap is a Level-2 hard floor — admin
          // cannot toggle it. The lambda silently drops it; we don't include
          // it in the payload.
        },
      };
      await numaPut('/api/settings/scheduling', payload);
      setSuccess(t('scheduling.quotaAdmin.saveSuccess', { defaultValue: 'Settings saved.' }));
      await load();
    } catch (err) {
      const responseError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(responseError || (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" />
      </div>
    );
  }

  if (!data) {
    return (
      <Alert
        variant={lastErrorStatus === 403 ? 'warning' : 'danger'}
        className="d-flex align-items-center justify-content-between gap-2"
      >
        <span>
          {error ?? t('scheduling.quotaAdmin.loadError', { defaultValue: 'Failed to load scheduling settings' })}
        </span>
        <Button size="sm" variant="outline-secondary" onClick={handleRetry} disabled={loading}>
          {loading ? <Spinner size="sm" animation="border" /> : t('common.retry', { defaultValue: 'Retry' })}
        </Button>
      </Alert>
    );
  }

  return (
    <>
      {error && (
        <Alert variant={lastErrorStatus === 403 ? 'warning' : 'danger'} dismissible onClose={() => setError(null)}>
          <div className="d-flex align-items-center justify-content-between gap-2">
            <span>{error}</span>
            <Button size="sm" variant="outline-secondary" onClick={handleRetry} disabled={loading}>
              {loading ? <Spinner size="sm" animation="border" /> : t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </Alert>
      )}
      {success && (
        <Alert variant="success" dismissible onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/*
       * Company-level usage panel. Replaces the old read-only static table with
       * live usage bars so admins can see at-a-glance how much head-room is
       * left across the whole tenant. Numbers come from three concurrent reads:
       *   - quotaSummary  → cron projected total this month
       *   - triggerLoad   → event-trigger actuals + 30-day projection
       *   - listTenant    → for the concurrent-active count (cron + events)
       *
       * Caps still come from `data.effective` so they reflect any per-client
       * (Level 2) overrides correctly.
       */}
      <Card className="border-0 mb-3">
        <Card.Body>
          <div className="settings-section-title mb-3">Company quota usage (platform-controlled)</div>
          <Alert variant="info" className="mb-3 small py-2 d-flex align-items-center gap-2">
            <i className="bi bi-info-circle-fill" />
            <span>
              Company-level caps are platform-controlled and can&apos;t be changed in-app. To request an increase,{' '}
              <a href="mailto:support@arcanum.ai?subject=Quota%20increase%20request">contact Arcanum</a>.
            </span>
          </Alert>
          <QuotaUsageRow
            label="Schedule runs / company / month"
            current={quotaSummary?.company?.runsPerMonth ?? 0}
            cap={data.effective.maxRunsPerCompanyPerMonth}
          />
          {triggersEnabled && (
            <QuotaUsageRow
              label="Trigger runs / company / month"
              current={triggerLoad?.monthRuns ?? 0}
              projected={triggerLoad?.projectedMonthRuns}
              cap={triggerLoad?.caps.company ?? data.effective.maxTriggerRunsPerCompanyPerMonth}
            />
          )}
          <QuotaUsageRow
            label="Concurrent active automations / company"
            current={activeAutomationCount}
            cap={data.effective.maxConcurrentActiveSchedulesPerCompany}
          />
        </Card.Body>
      </Card>

      {/* User-level — admin can tighten within the platform ceiling. */}
      <Card className="border-0 mb-3">
        <Card.Body>
          <div className="settings-section-title mb-1">User-level quotas (you can tighten)</div>
          <p className="small text-muted mb-3">
            Set tighter caps for users in this tenant. Values must be ≤ the platform ceiling shown next to each field.
            Leave empty to inherit. Use this to throttle a busy user without changing the company total.
          </p>

          <Form.Group className="mb-3">
            <Form.Label className="d-flex align-items-center justify-content-between fw-normal">
              <span>Minimum interval between runs (minutes)</span>
              <span className="badge bg-light text-dark border" title="Platform floor — admin may RAISE only">
                <i className="bi bi-lock-fill me-1" /> Min: {data.ceilings.minIntervalMinutes}
              </span>
            </Form.Label>
            <Form.Control
              type="number"
              min={data.ceilings.minIntervalMinutes}
              value={minInterval}
              placeholder={`Min: ${data.ceilings.minIntervalMinutes}`}
              onChange={(e) => setMinInterval(e.target.value)}
              isInvalid={!!fieldErrors.minIntervalMinutes}
            />
            <Form.Control.Feedback type="invalid">{fieldErrors.minIntervalMinutes}</Form.Control.Feedback>
            <Form.Text className="text-muted">
              Currently effective: {data.effective.minIntervalMinutes} min. Raise to make schedules less frequent.
            </Form.Text>
          </Form.Group>

          <div className="text-muted small fw-semibold mt-3 mb-2 text-uppercase">
            Schedule run quotas (cron, projected)
          </div>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label className="d-flex align-items-center justify-content-between fw-normal">
                  <span>Max schedule runs / user / month</span>
                  <span className="badge bg-light text-dark border" title="Platform ceiling">
                    <i className="bi bi-lock-fill me-1" /> Max: {data.ceilings.maxRunsPerUserPerMonth}
                  </span>
                </Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={data.ceilings.maxRunsPerUserPerMonth}
                  value={maxUser}
                  placeholder={`Max: ${data.ceilings.maxRunsPerUserPerMonth}`}
                  onChange={(e) => setMaxUser(e.target.value)}
                  isInvalid={!!fieldErrors.maxRunsPerUserPerMonth}
                />
                <Form.Control.Feedback type="invalid">{fieldErrors.maxRunsPerUserPerMonth}</Form.Control.Feedback>
                <Form.Text className="text-muted">
                  Currently effective: {data.effective.maxRunsPerUserPerMonth}.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          {triggersEnabled && (
            <>
              <div className="text-muted small fw-semibold mt-3 mb-2 text-uppercase">
                Trigger run quotas (event, actuals)
              </div>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label className="d-flex align-items-center justify-content-between fw-normal">
                      <span>Max trigger fires / user / month</span>
                      <span className="badge bg-light text-dark border" title="Platform ceiling">
                        <i className="bi bi-lock-fill me-1" /> Max: {data.ceilings.maxTriggerRunsPerUserPerMonth}
                      </span>
                    </Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      max={data.ceilings.maxTriggerRunsPerUserPerMonth}
                      value={maxTriggerUser}
                      placeholder={`Max: ${data.ceilings.maxTriggerRunsPerUserPerMonth}`}
                      onChange={(e) => setMaxTriggerUser(e.target.value)}
                      isInvalid={!!fieldErrors.maxTriggerRunsPerUserPerMonth}
                    />
                    <Form.Control.Feedback type="invalid">
                      {fieldErrors.maxTriggerRunsPerUserPerMonth}
                    </Form.Control.Feedback>
                    <Form.Text className="text-muted">
                      Currently effective: {data.effective.maxTriggerRunsPerUserPerMonth}.
                    </Form.Text>
                  </Form.Group>
                </Col>
              </Row>
            </>
          )}

          <div className="text-muted small fw-semibold mt-3 mb-2 text-uppercase">Concurrent active automations</div>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label className="d-flex align-items-center justify-content-between fw-normal">
                  <span>Max active automations / user</span>
                  <span className="badge bg-light text-dark border" title="Platform ceiling">
                    <i className="bi bi-lock-fill me-1" /> Max: {data.ceilings.maxConcurrentActiveSchedulesPerUser}
                  </span>
                </Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={data.ceilings.maxConcurrentActiveSchedulesPerUser}
                  value={maxConcurrent}
                  placeholder={`Max: ${data.ceilings.maxConcurrentActiveSchedulesPerUser}`}
                  onChange={(e) => setMaxConcurrent(e.target.value)}
                  isInvalid={!!fieldErrors.maxConcurrentActiveSchedulesPerUser}
                />
                <Form.Control.Feedback type="invalid">
                  {fieldErrors.maxConcurrentActiveSchedulesPerUser}
                </Form.Control.Feedback>
                <Form.Text className="text-muted">
                  Currently effective: {data.effective.maxConcurrentActiveSchedulesPerUser}. Per-user cap on
                  simultaneously active cron + trigger automations.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          {/* requireApprovalAboveUserCap is a Level-2 hard floor — set at the
              platform-settings level and not admin-toggleable. We surface
              the *effective* value here so admins know whether their tenant
              currently requires approval, but they cannot change it. To
              flip, contact Customer Success to update platform-settings. */}
          <Form.Group className="mb-3 mt-3">
            <Form.Label className="d-flex align-items-center gap-2">
              <span>
                {t('scheduling.quotaAdmin.requireApproval.label', {
                  defaultValue: 'Approval required for over-cap schedules',
                })}
              </span>
              <span className={`badge ${data.effective.requireApprovalAboveUserCap ? 'bg-success' : 'bg-secondary'}`}>
                {data.effective.requireApprovalAboveUserCap
                  ? t('scheduling.quotaAdmin.requireApproval.statusOn', { defaultValue: 'On' })
                  : t('scheduling.quotaAdmin.requireApproval.statusOff', { defaultValue: 'Off' })}
              </span>
            </Form.Label>
            <Form.Text className="text-muted d-block">
              {t('scheduling.quotaAdmin.requireApproval.helpReadOnly', {
                defaultValue:
                  'Set at platform level — not configurable in-app. When on, admin can authorise individual users up to the company cap. When off, over-cap requests are hard-rejected. Contact Customer Success to change.',
              })}
            </Form.Text>
          </Form.Group>

          <div className="d-flex gap-2 align-items-center">
            <Button variant="primary" onClick={handleSave} disabled={saving || hasFieldErrors}>
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Saving…
                </>
              ) : (
                t('scheduling.quotaAdmin.save', { defaultValue: 'Save' })
              )}
            </Button>
            {hasFieldErrors && (
              <span className="small text-danger">
                <i className="bi bi-exclamation-circle me-1" />
                Fix the highlighted field(s) — values cannot exceed the platform limits.
              </span>
            )}
          </div>
        </Card.Body>
      </Card>
    </>
  );
};
