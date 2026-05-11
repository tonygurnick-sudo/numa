import { useState, useEffect, useMemo } from 'react';
import { Card, Form, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { ArrowLeft, ExclamationTriangleFill, GearWideConnected } from 'react-bootstrap-icons';
import { useNavigate } from 'react-router-dom';
import {
  platformSettingsService,
  PLATFORM_QUOTA_INITIAL_VALUES,
  PlatformSettings as PlatformSettingsType,
} from '@/services/platformSettingsService';

const PLATFORM_DEFAULT_MIN = PLATFORM_QUOTA_INITIAL_VALUES.schedulingMinIntervalMinutes;
const PLATFORM_MAX_MIN = 1440; // 1 day — reasonable upper bound

/** Mean minutes per month — matches lib/schedule-load.ts MINUTES_PER_MONTH. */
const MINUTES_PER_MONTH = 43_800;

export default function PlatformSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state — all numeric fields required; empty rejected on save.
  const [schedulingMinInterval, setSchedulingMinInterval] = useState<string>('');
  const [maxRunsPerCompanyPerMonth, setMaxRunsPerCompanyPerMonth] = useState<string>('');
  const [maxRunsPerUserPerMonth, setMaxRunsPerUserPerMonth] = useState<string>('');
  const [maxTriggerRunsPerCompanyPerMonth, setMaxTriggerRunsPerCompanyPerMonth] = useState<string>('');
  const [maxTriggerRunsPerUserPerMonth, setMaxTriggerRunsPerUserPerMonth] = useState<string>('');
  const [maxConcurrentActiveSchedulesPerCompany, setMaxConcurrentActiveSchedulesPerCompany] = useState<string>('');
  const [maxConcurrentActiveSchedulesPerUser, setMaxConcurrentActiveSchedulesPerUser] = useState<string>('');
  const [requireApprovalAboveUserCap, setRequireApprovalAboveUserCap] = useState<boolean>(
    PLATFORM_QUOTA_INITIAL_VALUES.requireApprovalAboveUserCap
  );
  // Names of any fields that were missing from the saved record and have
  // been pre-populated with PLATFORM_QUOTA_INITIAL_VALUES. Drives the
  // first-time-setup / incomplete-record warning banner.
  const [bootstrappedFields, setBootstrappedFields] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const settings = await platformSettingsService.get();
        const missing: string[] = [];
        const fillNum = <K extends keyof typeof PLATFORM_QUOTA_INITIAL_VALUES>(
          key: K,
          setter: (v: string) => void
        ): void => {
          const v = settings[key as keyof PlatformSettingsType];
          if (typeof v === 'number') {
            setter(String(v));
          } else {
            missing.push(String(key));
            setter(String(PLATFORM_QUOTA_INITIAL_VALUES[key]));
          }
        };
        fillNum('schedulingMinIntervalMinutes', setSchedulingMinInterval);
        fillNum('maxRunsPerCompanyPerMonth', setMaxRunsPerCompanyPerMonth);
        fillNum('maxRunsPerUserPerMonth', setMaxRunsPerUserPerMonth);
        fillNum('maxTriggerRunsPerCompanyPerMonth', setMaxTriggerRunsPerCompanyPerMonth);
        fillNum('maxTriggerRunsPerUserPerMonth', setMaxTriggerRunsPerUserPerMonth);
        fillNum('maxConcurrentActiveSchedulesPerCompany', setMaxConcurrentActiveSchedulesPerCompany);
        fillNum('maxConcurrentActiveSchedulesPerUser', setMaxConcurrentActiveSchedulesPerUser);
        if (typeof settings.requireApprovalAboveUserCap === 'boolean') {
          setRequireApprovalAboveUserCap(settings.requireApprovalAboveUserCap);
        } else {
          missing.push('requireApprovalAboveUserCap');
          setRequireApprovalAboveUserCap(PLATFORM_QUOTA_INITIAL_VALUES.requireApprovalAboveUserCap);
        }
        setBootstrappedFields(missing);
      } catch (err) {
        setError(`Failed to load platform settings: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /**
   * Required-non-negative-integer parser. Empty values throw — every field
   * on this page MUST have a value (no implicit fallback to a code default).
   * 0 is valid for cap fields ("0 allowed", a way to fully disable a quota
   * target). Floors that can't sensibly be 0 should use a more restrictive
   * parser at the call site.
   */
  const parseNonNegativeInt = (raw: string, fieldName: string): number => {
    if (raw === '') {
      throw new Error(`${fieldName} is required`);
    }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(`${fieldName} must be a non-negative integer`);
    }
    return n;
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    let payload: PlatformSettingsType;
    try {
      if (schedulingMinInterval === '') {
        throw new Error('Global minimum automation interval is required');
      }
      const parsedInterval = parseInt(schedulingMinInterval, 10);
      if (isNaN(parsedInterval) || parsedInterval < PLATFORM_DEFAULT_MIN || parsedInterval > PLATFORM_MAX_MIN) {
        throw new Error(
          `Automation minimum interval must be a whole number between ${PLATFORM_DEFAULT_MIN} and ${PLATFORM_MAX_MIN} minutes`
        );
      }

      payload = {
        schedulingMinIntervalMinutes: parsedInterval,
        maxRunsPerCompanyPerMonth: parseNonNegativeInt(
          maxRunsPerCompanyPerMonth,
          'Max schedule runs per company / month'
        ),
        maxRunsPerUserPerMonth: parseNonNegativeInt(maxRunsPerUserPerMonth, 'Max schedule runs per user / month'),
        maxTriggerRunsPerCompanyPerMonth: parseNonNegativeInt(
          maxTriggerRunsPerCompanyPerMonth,
          'Max trigger runs per company / month'
        ),
        maxTriggerRunsPerUserPerMonth: parseNonNegativeInt(
          maxTriggerRunsPerUserPerMonth,
          'Max trigger runs per user / month'
        ),
        maxConcurrentActiveSchedulesPerCompany: parseNonNegativeInt(
          maxConcurrentActiveSchedulesPerCompany,
          'Max concurrent active automations per company'
        ),
        maxConcurrentActiveSchedulesPerUser: parseNonNegativeInt(
          maxConcurrentActiveSchedulesPerUser,
          'Max concurrent active automations per user'
        ),
        requireApprovalAboveUserCap,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    try {
      setSaving(true);
      await platformSettingsService.save(payload);
      setSuccess('Platform settings saved successfully');
    } catch (err) {
      setError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Cross-field consistency warnings. Each input falls back to the platform
   * default if left empty so we're validating what *will be* enforced — not
   * just what the user typed. Returned grouped by card so we can render the
   * banner alongside the relevant fields.
   */
  const warnings = useMemo(() => {
    const parse = (raw: string, fallback: number): number => {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const minInt = parse(schedulingMinInterval, PLATFORM_DEFAULT_MIN);
    const sCompany = parse(maxRunsPerCompanyPerMonth, PLATFORM_QUOTA_INITIAL_VALUES.maxRunsPerCompanyPerMonth);
    const sUser = parse(maxRunsPerUserPerMonth, PLATFORM_QUOTA_INITIAL_VALUES.maxRunsPerUserPerMonth);
    const tCompany = parse(
      maxTriggerRunsPerCompanyPerMonth,
      PLATFORM_QUOTA_INITIAL_VALUES.maxTriggerRunsPerCompanyPerMonth
    );
    const tUser = parse(maxTriggerRunsPerUserPerMonth, PLATFORM_QUOTA_INITIAL_VALUES.maxTriggerRunsPerUserPerMonth);
    const cCompany = parse(
      maxConcurrentActiveSchedulesPerCompany,
      PLATFORM_QUOTA_INITIAL_VALUES.maxConcurrentActiveSchedulesPerCompany
    );
    const cUser = parse(
      maxConcurrentActiveSchedulesPerUser,
      PLATFORM_QUOTA_INITIAL_VALUES.maxConcurrentActiveSchedulesPerUser
    );
    const runsPerScheduleAtMinInterval = Math.floor(MINUTES_PER_MONTH / Math.max(minInt, 1));

    const schedules: string[] = [];
    if (sUser > sCompany) {
      schedules.push(
        `User cap (${sUser.toLocaleString()}) exceeds the company cap (${sCompany.toLocaleString()}). The company cap is the absolute ceiling — a user can never run more than the company total.`
      );
    }
    if (runsPerScheduleAtMinInterval > sUser) {
      schedules.push(
        `One schedule at the minimum interval (~${runsPerScheduleAtMinInterval.toLocaleString()} runs/mo) exceeds the per-user cap of ${sUser.toLocaleString()}. Users couldn't run a single schedule at the floor.`
      );
    }

    const triggers: string[] = [];
    if (tUser > tCompany) {
      triggers.push(
        `Trigger user cap (${tUser.toLocaleString()}) exceeds the trigger company cap (${tCompany.toLocaleString()}).`
      );
    }

    const concurrent: string[] = [];
    if (cUser > cCompany) {
      concurrent.push(
        `Per-user concurrent cap (${cUser.toLocaleString()}) exceeds the company concurrent cap (${cCompany.toLocaleString()}). One user could never use more concurrent automations than the whole company is allowed.`
      );
    }

    return { schedules, triggers, concurrent };
  }, [
    schedulingMinInterval,
    maxRunsPerCompanyPerMonth,
    maxRunsPerUserPerMonth,
    maxTriggerRunsPerCompanyPerMonth,
    maxTriggerRunsPerUserPerMonth,
    maxConcurrentActiveSchedulesPerCompany,
    maxConcurrentActiveSchedulesPerUser,
  ]);

  /** Render a warning block as the first child inside a Card.Body. */
  const renderWarnings = (items: string[]): React.ReactNode => {
    if (items.length === 0) return null;
    return (
      <Alert variant="warning" className="mb-3 d-flex align-items-start gap-2">
        <ExclamationTriangleFill className="flex-shrink-0 mt-1" />
        <div>
          <strong>Quota consistency warning</strong>
          <ul className="mb-0 mt-1 ps-3 small">
            {items.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      </Alert>
    );
  };

  return (
    <div>
      <div className="d-flex align-items-center mb-4">
        <Button variant="outline-secondary" size="sm" className="me-3" onClick={() => navigate('/tools')}>
          <ArrowLeft className="me-1" /> Back to Tools
        </Button>
        <div>
          <h1 className="h3 mb-0 d-flex align-items-center">
            <GearWideConnected className="me-2" />
            Platform Settings
          </h1>
          <p className="text-muted mb-0 small">Global defaults that apply to all customers</p>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" dismissible onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <>
          {bootstrappedFields.length > 0 && (
            <Alert variant="warning" className="d-flex align-items-start gap-2">
              <ExclamationTriangleFill className="flex-shrink-0 mt-1" />
              <div>
                <div className="fw-semibold">Platform settings are incomplete</div>
                <div className="small">
                  {bootstrappedFields.length} field{bootstrappedFields.length === 1 ? '' : 's'} (
                  <code>{bootstrappedFields.join(', ')}</code>) {bootstrappedFields.length === 1 ? 'was' : 'were'} unset
                  in the saved record and {bootstrappedFields.length === 1 ? 'has' : 'have'} been pre-populated with the
                  recommended values. <strong>Review and click Save</strong> — the underlying lambdas will throw on
                  every invocation until the record is fully populated.
                </div>
              </div>
            </Alert>
          )}

          <Alert variant="info" className="small">
            All fields below are required. There are no code-side fallback defaults — the values stored here are the
            sole source of truth for every client's Level 1 quotas. The placeholder{' '}
            <code>PLATFORM_QUOTA_INITIAL_VALUES</code> in the CSP exists only to seed this page on a fresh deployer.
          </Alert>

          <Card className="border-0 shadow-sm mb-3">
            <Card.Header>
              <h5 className="mb-0">Automations — Minimum Interval</h5>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Global Minimum Automation Interval (minutes)</Form.Label>
                <Form.Control
                  type="number"
                  min={PLATFORM_DEFAULT_MIN}
                  max={PLATFORM_MAX_MIN}
                  step={1}
                  value={schedulingMinInterval}
                  onChange={(e) => setSchedulingMinInterval(e.target.value)}
                  placeholder="Required"
                />
                <Form.Text className="text-muted">
                  No customer can run automations more frequently than this unless they have a per-client override.
                  Required — minimum {PLATFORM_DEFAULT_MIN} minutes.
                </Form.Text>
              </Form.Group>
            </Card.Body>
          </Card>

          <Card className="border-0 shadow-sm mb-3">
            <Card.Header>
              <h5 className="mb-0">Schedules — Run Quotas</h5>
              <p className="text-muted small mb-0">
                Hard ceilings on schedule (cron-based automation) run volume. <strong>Projected</strong> — computed from
                the cron expression at creation time. Customers can override these per-client or via admin Settings but
                never above what's set here. All fields required.
              </p>
            </Card.Header>
            <Card.Body>
              {renderWarnings(warnings.schedules)}
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Max Schedule Runs / Company / Month</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      step={1}
                      value={maxRunsPerCompanyPerMonth}
                      onChange={(e) => setMaxRunsPerCompanyPerMonth(e.target.value)}
                      placeholder="Required"
                    />
                    <Form.Text className="text-muted">
                      Hard tenant-wide ceiling. Always enforced — admin approval cannot breach this.
                    </Form.Text>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Max Schedule Runs / User / Month</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      step={1}
                      value={maxRunsPerUserPerMonth}
                      onChange={(e) => setMaxRunsPerUserPerMonth(e.target.value)}
                      placeholder="Required"
                    />
                    <Form.Text className="text-muted">Above this triggers admin approval if enabled.</Form.Text>
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group>
                <Form.Check
                  type="switch"
                  id="require-approval-above-user-cap"
                  label="Require admin approval when a user's projected runs would exceed their cap"
                  checked={requireApprovalAboveUserCap}
                  onChange={(e) => setRequireApprovalAboveUserCap(e.target.checked)}
                />
                <Form.Text className="text-muted">
                  When on, a user requesting more than their per-user cap goes to admin approval — admin can authorise
                  up to the company cap, never above. When off, those requests are hard-rejected at creation.
                  <strong> The company quota is always a hard ceiling — admin approval cannot breach it.</strong>{' '}
                  Default on.
                </Form.Text>
              </Form.Group>
            </Card.Body>
          </Card>

          <Card className="border-0 shadow-sm mb-3">
            <Card.Header>
              <h5 className="mb-0">Triggers — Run Quotas</h5>
              <p className="text-muted small mb-0">
                Hard ceilings on trigger (event-based automation) fires — e.g. Gmail message.received.
                <strong> Actuals</strong> — counted at fire time. Triggers over their cap are dropped silently with a
                one-shot per-month notification to the owner.
              </p>
            </Card.Header>
            <Card.Body>
              {renderWarnings(warnings.triggers)}
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Max Trigger Runs / Company / Month</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      step={1}
                      value={maxTriggerRunsPerCompanyPerMonth}
                      onChange={(e) => setMaxTriggerRunsPerCompanyPerMonth(e.target.value)}
                      placeholder="Required"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Max Trigger Runs / User / Month</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      step={1}
                      value={maxTriggerRunsPerUserPerMonth}
                      onChange={(e) => setMaxTriggerRunsPerUserPerMonth(e.target.value)}
                      placeholder="Required"
                    />
                  </Form.Group>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          <Card className="border-0 shadow-sm mb-3">
            <Card.Header>
              <h5 className="mb-0">Concurrent Active Automations</h5>
              <p className="text-muted small mb-0">
                Cap on how many automations (cron schedules + event triggers combined) can be active at the same time.
              </p>
            </Card.Header>
            <Card.Body>
              {renderWarnings(warnings.concurrent)}
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Max Concurrent Active Automations / Company</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      step={1}
                      value={maxConcurrentActiveSchedulesPerCompany}
                      onChange={(e) => setMaxConcurrentActiveSchedulesPerCompany(e.target.value)}
                      placeholder="Required"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Max Concurrent Active Automations / User</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      step={1}
                      value={maxConcurrentActiveSchedulesPerUser}
                      onChange={(e) => setMaxConcurrentActiveSchedulesPerUser(e.target.value)}
                      placeholder="Required"
                    />
                  </Form.Group>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          <div className="d-flex justify-content-end">
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
