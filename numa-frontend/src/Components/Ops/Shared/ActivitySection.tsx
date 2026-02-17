import React, { useState, useCallback } from 'react';
import { Button, Form, Badge, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import * as OpsService from '../../../Services/OpsService';
import type {
  Activity,
  ActivityType,
  ActivityDirection,
  ActivityOutcome,
  CreateActivityPayload,
} from '../../../types/ops';

interface ActivitySectionProps {
  entityType: 'customer' | 'supplier';
  entityId: string;
  activities?: Activity[];
}

/** Map activity types to Bootstrap Icons class names. */
const ACTIVITY_ICON: Record<ActivityType, string> = {
  call: 'bi-telephone',
  email: 'bi-envelope',
  meeting: 'bi-calendar-event',
  note: 'bi-sticky',
  demo: 'bi-display',
  slack: 'bi-chat-dots',
};

/** Map outcome values to Bootstrap color classes for badges. */
const OUTCOME_VARIANT: Record<ActivityOutcome, string> = {
  positive: 'success',
  neutral: 'secondary',
  negative: 'danger',
  info: 'info',
};

const ACTIVITY_TYPES: ActivityType[] = ['call', 'email', 'meeting', 'note', 'demo', 'slack'];
const DIRECTIONS: ActivityDirection[] = ['inbound', 'outbound'];
const OUTCOMES: ActivityOutcome[] = ['positive', 'neutral', 'negative', 'info'];

/**
 * ActivitySection renders a timeline of activities for a customer or supplier,
 * along with a "Log Activity" form for creating new entries.
 *
 * Activities are sorted by date descending. Creating and deleting activities
 * calls the appropriate OpsService method based on `entityType`.
 */
export function ActivitySection({
  entityType,
  entityId,
  activities: activitiesProp,
}: ActivitySectionProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaDelete } = useNumaRequest();

  // ── Local state ───────────────────────────────────────────────────────────

  // Keep a local copy so we can optimistically append/remove items.
  const [localActivities, setLocalActivities] = useState<Activity[]>(activitiesProp ?? []);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form fields
  const today = new Date().toISOString().split('T')[0];
  const [formType, setFormType] = useState<ActivityType>('call');
  const [formDirection, setFormDirection] = useState<ActivityDirection>('outbound');
  const [formDate, setFormDate] = useState(today);
  const [formDuration, setFormDuration] = useState<string>('');
  const [formSummary, setFormSummary] = useState('');
  const [formOutcome, setFormOutcome] = useState<ActivityOutcome>('neutral');
  const [formNextActionDate, setFormNextActionDate] = useState('');
  const [formNextActionType, setFormNextActionType] = useState('');

  // Keep in sync with parent if prop changes.
  React.useEffect(() => {
    if (activitiesProp) {
      setLocalActivities(activitiesProp);
    }
  }, [activitiesProp]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const sorted = [...localActivities].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Handlers ──────────────────────────────────────────────────────────────

  const resetForm = () => {
    setFormType('call');
    setFormDirection('outbound');
    setFormDate(today);
    setFormDuration('');
    setFormSummary('');
    setFormOutcome('neutral');
    setFormNextActionDate('');
    setFormNextActionType('');
  };

  const handleSave = useCallback(async () => {
    if (!formSummary.trim()) return;
    setSaving(true);
    try {
      const payload: CreateActivityPayload = {
        type: formType,
        direction: formDirection,
        date: formDate,
        duration: formDuration ? parseInt(formDuration, 10) : null,
        summary: formSummary.trim(),
        outcome: formOutcome,
        nextActionDate: formNextActionDate || null,
        nextActionType: formNextActionType || null,
      };

      let created: Activity;
      if (entityType === 'customer') {
        created = await OpsService.createCustomerActivity(numaPost, entityId, payload);
      } else {
        created = await OpsService.createSupplierActivity(numaPost, entityId, payload);
      }

      setLocalActivities((prev) => [created, ...prev]);
      resetForm();
      setShowForm(false);
    } catch (err) {
      console.error('[ActivitySection] Failed to create activity', err);
    } finally {
      setSaving(false);
    }
  }, [
    entityType,
    entityId,
    formType,
    formDirection,
    formDate,
    formDuration,
    formSummary,
    formOutcome,
    formNextActionDate,
    formNextActionType,
    numaPost,
  ]);

  const handleDelete = useCallback(
    async (activityId: string) => {
      // Only customer activities have a delete endpoint.
      if (entityType !== 'customer') return;

      if (!window.confirm(t('activities.deleteConfirm'))) return;

      try {
        await OpsService.deleteCustomerActivity(numaDelete, entityId, activityId);
        setLocalActivities((prev) => prev.filter((a) => a.id !== activityId));
      } catch (err) {
        console.error('[ActivitySection] Failed to delete activity', err);
      }
    },
    [entityType, entityId, numaDelete, t],
  );

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header + Log button */}
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="fw-semibold small">{t('crm.activities')}</span>
        {!showForm && (
          <Button variant="outline-primary" size="sm" onClick={() => setShowForm(true)}>
            <i className="bi bi-plus me-1" />
            {t('activities.logActivity')}
          </Button>
        )}
      </div>

      {/* ── Log Activity Form ────────────────────────────────────────────── */}
      {showForm && (
        <Card className="mb-3">
          <Card.Body className="p-2">
            <div className="row g-2">
              {/* Type */}
              <div className="col-sm-4">
                <Form.Label className="small mb-0">{t('activities.type')}</Form.Label>
                <Form.Select size="sm" value={formType} onChange={(e) => setFormType(e.target.value as ActivityType)}>
                  {ACTIVITY_TYPES.map((at) => (
                    <option key={at} value={at}>
                      {t(`activities.${at}`)}
                    </option>
                  ))}
                </Form.Select>
              </div>

              {/* Direction */}
              <div className="col-sm-4">
                <Form.Label className="small mb-0">{t('activities.direction')}</Form.Label>
                <div className="d-flex gap-2 mt-1">
                  {DIRECTIONS.map((dir) => (
                    <Form.Check
                      key={dir}
                      type="radio"
                      id={`direction-${dir}`}
                      name="direction"
                      label={t(`activities.${dir}`)}
                      checked={formDirection === dir}
                      onChange={() => setFormDirection(dir)}
                      className="small"
                    />
                  ))}
                </div>
              </div>

              {/* Date */}
              <div className="col-sm-4">
                <Form.Label className="small mb-0">{t('activities.date')}</Form.Label>
                <Form.Control size="sm" type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </div>

              {/* Duration */}
              <div className="col-sm-4">
                <Form.Label className="small mb-0">
                  {t('activities.duration')} ({t('common.optional')})
                </Form.Label>
                <Form.Control
                  size="sm"
                  type="number"
                  min={0}
                  placeholder="min"
                  value={formDuration}
                  onChange={(e) => setFormDuration(e.target.value)}
                />
              </div>

              {/* Outcome */}
              <div className="col-sm-4">
                <Form.Label className="small mb-0">{t('activities.outcome')}</Form.Label>
                <Form.Select
                  size="sm"
                  value={formOutcome}
                  onChange={(e) => setFormOutcome(e.target.value as ActivityOutcome)}
                >
                  {OUTCOMES.map((oc) => (
                    <option key={oc} value={oc}>
                      {t(`activities.${oc}`)}
                    </option>
                  ))}
                </Form.Select>
              </div>

              {/* Summary */}
              <div className="col-12">
                <Form.Label className="small mb-0">
                  {t('activities.summary')} <span className="text-danger">*</span>
                </Form.Label>
                <Form.Control
                  size="sm"
                  as="textarea"
                  rows={2}
                  value={formSummary}
                  onChange={(e) => setFormSummary(e.target.value)}
                />
              </div>

              {/* Next action date */}
              <div className="col-sm-6">
                <Form.Label className="small mb-0">
                  {t('activities.nextActionDate')} ({t('common.optional')})
                </Form.Label>
                <Form.Control
                  size="sm"
                  type="date"
                  value={formNextActionDate}
                  onChange={(e) => setFormNextActionDate(e.target.value)}
                />
              </div>

              {/* Next action type */}
              <div className="col-sm-6">
                <Form.Label className="small mb-0">
                  {t('activities.nextActionType')} ({t('common.optional')})
                </Form.Label>
                <Form.Control
                  size="sm"
                  type="text"
                  value={formNextActionType}
                  onChange={(e) => setFormNextActionType(e.target.value)}
                />
              </div>
            </div>

            <div className="d-flex gap-1 justify-content-end mt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                disabled={saving}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !formSummary.trim()}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ── Timeline ─────────────────────────────────────────────────────── */}
      {sorted.length === 0 && !showForm && <div className="text-muted small">{t('empty.noActivities')}</div>}

      {sorted.map((activity) => (
        <div key={activity.id} className="d-flex align-items-start gap-2 py-2 border-bottom">
          {/* Type icon */}
          <div className="flex-shrink-0 text-muted" style={{ width: 24, textAlign: 'center' }}>
            <i className={`bi ${ACTIVITY_ICON[activity.type] ?? 'bi-circle'}`} />
          </div>

          {/* Direction arrow */}
          <div className="flex-shrink-0 small" style={{ width: 16, textAlign: 'center' }}>
            {activity.direction === 'inbound' ? (
              <span title={t('activities.inbound')}>&#8601;</span>
            ) : (
              <span title={t('activities.outbound')}>&#8599;</span>
            )}
          </div>

          {/* Body */}
          <div className="flex-grow-1 min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="small fw-semibold">{t(`activities.${activity.type}`)}</span>
              <span className="text-muted small">{formatDate(activity.date)}</span>

              {/* Outcome badge */}
              <Badge bg={OUTCOME_VARIANT[activity.outcome] ?? 'secondary'} className="small">
                {t(`activities.${activity.outcome}`)}
              </Badge>

              {/* Duration */}
              {activity.duration != null && activity.duration > 0 && (
                <span className="text-muted small">
                  {t('activities.durationMinutes', { count: activity.duration })}
                </span>
              )}
            </div>

            {/* Summary (truncated to 2 lines) */}
            <div
              className="small mt-1"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {activity.summary}
            </div>

            {/* Staff + next action */}
            <div className="d-flex gap-3 text-muted small mt-1">
              <span>{activity.staffName}</span>
              {activity.nextActionDate && (
                <span>
                  {t('activities.nextAction')}: {formatDate(activity.nextActionDate)}
                  {activity.nextActionType ? ` (${activity.nextActionType})` : ''}
                </span>
              )}
            </div>
          </div>

          {/* Delete button — only for customers (supplier has no delete endpoint) */}
          {entityType === 'customer' && (
            <div className="flex-shrink-0">
              <Button
                variant="link"
                size="sm"
                className="p-0 text-danger"
                onClick={() => handleDelete(activity.id)}
                title={t('common.delete')}
              >
                <i className="bi bi-trash" />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
