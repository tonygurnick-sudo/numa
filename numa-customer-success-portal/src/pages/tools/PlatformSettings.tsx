import { useState, useEffect } from 'react';
import { Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { ArrowLeft, GearWideConnected } from 'react-bootstrap-icons';
import { useNavigate } from 'react-router-dom';
import { platformSettingsService, PlatformSettings as PlatformSettingsType } from '@/services/platformSettingsService';

const PLATFORM_DEFAULT_MIN = 5;
const PLATFORM_MAX_MIN = 1440; // 1 day — reasonable upper bound

export default function PlatformSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [schedulingMinInterval, setSchedulingMinInterval] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const settings = await platformSettingsService.get();
        setSchedulingMinInterval(
          settings.schedulingMinIntervalMinutes != null ? String(settings.schedulingMinIntervalMinutes) : ''
        );
      } catch (err) {
        setError(`Failed to load platform settings: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    const parsed = schedulingMinInterval ? parseInt(schedulingMinInterval, 10) : undefined;
    if (parsed !== undefined && (isNaN(parsed) || parsed < PLATFORM_DEFAULT_MIN || parsed > PLATFORM_MAX_MIN)) {
      setError(
        `Scheduling minimum interval must be a whole number between ${PLATFORM_DEFAULT_MIN} and ${PLATFORM_MAX_MIN} minutes`
      );
      return;
    }

    try {
      setSaving(true);
      await platformSettingsService.save(parsed !== undefined ? { schedulingMinIntervalMinutes: parsed } : {});
      setSuccess('Platform settings saved successfully');
    } catch (err) {
      setError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
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
        <Card className="border-0 shadow-sm">
          <Card.Header>
            <h5 className="mb-0">Scheduling</h5>
          </Card.Header>
          <Card.Body>
            <Form.Group className="mb-3">
              <Form.Label>Global Minimum Scheduling Interval (minutes)</Form.Label>
              <Form.Control
                type="number"
                min={PLATFORM_DEFAULT_MIN}
                max={PLATFORM_MAX_MIN}
                step={1}
                value={schedulingMinInterval}
                onChange={(e) => setSchedulingMinInterval(e.target.value)}
                placeholder={`Leave empty for platform default (${PLATFORM_DEFAULT_MIN} minutes)`}
              />
              <Form.Text className="text-muted">
                When set, no customer can schedule agents more frequently than this unless they have a per-client
                override. Leave empty to use the platform default of {PLATFORM_DEFAULT_MIN} minutes.
              </Form.Text>
            </Form.Group>

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
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
