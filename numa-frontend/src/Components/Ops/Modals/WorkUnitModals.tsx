import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import * as OpsService from '../../../Services/OpsService';
import type { WorkUnit, Ticket, WorkZone } from '../../../types/ops';

// ═══════════════════════════════════════════════════════════════════════════════
// CreateWorkUnitModal
// ═══════════════════════════════════════════════════════════════════════════════

interface CreateWorkUnitModalProps {
  show: boolean;
  boardId: string;
  defaultName: string;
  onHide: () => void;
  onCreated: () => void;
}

export function CreateWorkUnitModal({
  show,
  boardId,
  defaultName,
  onHide,
  onCreated,
}: CreateWorkUnitModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost } = useNumaRequest();

  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  const handleShow = useCallback(() => {
    setName(defaultName);
    setGoal('');
    setError(null);
  }, [defaultName]);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    try {
      setSaving(true);
      setError(null);
      await OpsService.createWorkUnit(numaPost, boardId, {
        name: name.trim(),
        status: 'planning',
        goal: goal.trim() || null,
      });
      onCreated();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [name, goal, boardId, numaPost, onCreated, t]);

  return (
    <Modal show={show} onHide={onHide} onShow={handleShow} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('sprints.createTitle')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <div className="alert alert-danger mb-3" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            {error}
          </div>
        )}

        <Form.Group className="mb-3">
          <Form.Label>{t('sprints.createName')}</Form.Label>
          <Form.Control
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sprints.createNamePlaceholder')}
            autoFocus
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('sprints.createGoal')}</Form.Label>
          <Form.Control
            as="textarea"
            rows={2}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t('sprints.createGoalPlaceholder')}
          />
        </Form.Group>

        <div className="alert alert-info mb-0 small">
          <i className="bi bi-info-circle me-1" />
          {t('sprints.createBacklogNote')}
        </div>
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!name.trim() || saving} onClick={handleCreate}>
          {saving ? t('common.loading') : t('sprints.create')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// StartWorkUnitModal
// ═══════════════════════════════════════════════════════════════════════════════

interface StartWorkUnitModalProps {
  show: boolean;
  workUnits: WorkUnit[];
  boardId: string;
  tickets: Ticket[];
  zones: WorkZone[];
  preselectedId?: string | null;
  defaultZoneId?: string | null;
  onHide: () => void;
  onStarted: () => void;
}

export function StartWorkUnitModal({
  show,
  workUnits,
  boardId,
  tickets,
  zones,
  preselectedId,
  defaultZoneId,
  onHide,
  onStarted,
}: StartWorkUnitModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPut } = useNumaRequest();

  const [selectedId, setSelectedId] = useState('');
  const [sprintName, setSprintName] = useState('');
  const [targetZoneId, setTargetZoneId] = useState('');
  const [durationWeeks, setDurationWeeks] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planningUnits = useMemo(() => workUnits.filter((wu) => wu.status === 'planning'), [workUnits]);

  // All board zones get listed in the picker. Zones already running a sprint
  // are shown but disabled, so the user can see why they can't pick them.
  const boardZones = useMemo(() => zones.filter((z) => z.zoneType === 'board'), [zones]);
  const eligibleZones = useMemo(() => boardZones.filter((z) => !z.activeWorkUnitId), [boardZones]);

  // Auto-select when modal opens with a preselected sprint
  useEffect(() => {
    if (show && preselectedId) {
      const wu = planningUnits.find((u) => u.id === preselectedId);
      if (wu) {
        setSelectedId(wu.id);
        setSprintName(wu.name);
      }
    }
    if (show) {
      // Default the target zone to the currently-viewed one if it's eligible,
      // otherwise the first eligible board zone.
      const fallback =
        (defaultZoneId && eligibleZones.find((z) => z.id === defaultZoneId)?.id) ?? eligibleZones[0]?.id ?? '';
      setTargetZoneId(fallback);
    } else {
      setSelectedId('');
      setSprintName('');
      setTargetZoneId('');
      setDurationWeeks(2);
      setError(null);
    }
  }, [show, preselectedId, planningUnits, defaultZoneId, eligibleZones]);

  // When a sprint is selected, populate its name
  const selectedUnit = useMemo(
    () => planningUnits.find((wu) => wu.id === selectedId) ?? null,
    [planningUnits, selectedId]
  );
  const handleSelectSprint = useCallback(
    (id: string) => {
      setSelectedId(id);
      const wu = planningUnits.find((u) => u.id === id);
      if (wu) setSprintName(wu.name);
    },
    [planningUnits]
  );

  // Computed dates
  const startDate = useMemo(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }, []);

  const endDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + durationWeeks * 7);
    return d.toISOString().split('T')[0];
  }, [durationWeeks]);

  const formatDateDisplay = (iso: string): string => {
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  /** Count of backlog tickets that will be moved when this sprint starts */
  const backlogTicketCount = useMemo(() => {
    if (!selectedId) return 0;
    const backlogZoneIds = new Set(zones.filter((z) => z.zoneType === 'backlog').map((z) => z.id));
    return tickets.filter((tk) => tk.workUnitId === selectedId && backlogZoneIds.has(tk.zoneId)).length;
  }, [selectedId, tickets, zones]);

  const handleStart = useCallback(async () => {
    if (!selectedId || !targetZoneId) return;
    try {
      setSaving(true);
      setError(null);
      // Update name (if changed) and set dates + status + target zone
      await OpsService.updateWorkUnit(numaPut, boardId, selectedId, {
        status: 'active',
        name: sprintName.trim() || selectedUnit?.name,
        startDate,
        endDate,
        targetZoneId,
      });
      setSelectedId('');
      setSprintName('');
      setTargetZoneId('');
      setDurationWeeks(2);
      onStarted();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [selectedId, sprintName, selectedUnit, startDate, endDate, targetZoneId, boardId, numaPut, onStarted, t]);

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('sprints.start')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <div className="alert alert-danger mb-3" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            {error}
          </div>
        )}

        {eligibleZones.length === 0 && <div className="alert alert-warning mb-3">{t('sprints.noEligibleZones')}</div>}

        <Form.Group className="mb-3">
          <Form.Label>{t('sprints.selectWorkUnit')}</Form.Label>
          <Form.Select
            value={selectedId}
            onChange={(e) => handleSelectSprint(e.target.value)}
            disabled={eligibleZones.length === 0}
          >
            <option value="">{t('common.selectOption')}</option>
            {planningUnits.map((wu) => (
              <option key={wu.id} value={wu.id}>
                {wu.name}
              </option>
            ))}
          </Form.Select>
        </Form.Group>

        {selectedId && (
          <>
            <Form.Group className="mb-3">
              <Form.Label>{t('sprints.sprintName')}</Form.Label>
              <Form.Control type="text" value={sprintName} onChange={(e) => setSprintName(e.target.value)} />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{t('sprints.targetZone')}</Form.Label>
              <Form.Select value={targetZoneId} onChange={(e) => setTargetZoneId(e.target.value)}>
                <option value="">{t('common.selectOption')}</option>
                {boardZones.map((z) => {
                  const occupied = !!z.activeWorkUnitId;
                  return (
                    <option key={z.id} value={z.id} disabled={occupied}>
                      {z.name}
                      {occupied ? ` (${t('sprints.zoneAlreadyActive')})` : ''}
                    </option>
                  );
                })}
              </Form.Select>
              <Form.Text className="text-muted">{t('sprints.targetZoneHint')}</Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{t('sprints.duration')}</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Form.Control
                  type="number"
                  min={1}
                  max={52}
                  value={durationWeeks}
                  onChange={(e) => setDurationWeeks(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: 80 }}
                />
                <span className="text-muted">{t('sprints.weeks')}</span>
              </div>
            </Form.Group>

            <div className="small text-muted mb-3">
              <i className="bi bi-calendar3 me-1" />
              {t('sprints.dateRange', {
                start: formatDateDisplay(startDate),
                end: formatDateDisplay(endDate),
              })}
            </div>

            {backlogTicketCount > 0 && (
              <div className="alert alert-info mb-0">
                {t('sprints.startConfirmMessage', { count: backlogTicketCount })}
              </div>
            )}

            {backlogTicketCount === 0 && <p className="text-muted small mb-0">{t('sprints.noTicketsToMove')}</p>}
          </>
        )}
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="success"
          disabled={!selectedId || !targetZoneId || eligibleZones.length === 0 || saving}
          onClick={handleStart}
        >
          {saving ? t('common.loading') : t('sprints.start')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CompleteWorkUnitModal
// ═══════════════════════════════════════════════════════════════════════════════

interface CompleteWorkUnitModalProps {
  show: boolean;
  workUnit: WorkUnit | null;
  workUnits: WorkUnit[];
  boardId: string;
  incompleteCount: number;
  completedCount: number;
  onHide: () => void;
  onCompleted: () => void;
}

export function CompleteWorkUnitModal({
  show,
  workUnit,
  workUnits,
  boardId,
  incompleteCount,
  completedCount,
  onHide,
  onCompleted,
}: CompleteWorkUnitModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPut } = useNumaRequest();

  const [rolloverChoice, setRolloverChoice] = useState<'backlog' | 'sprint'>('backlog');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planningUnits = useMemo(() => workUnits.filter((wu) => wu.status === 'planning'), [workUnits]);

  const handleComplete = useCallback(async () => {
    if (!workUnit) return;
    try {
      setSaving(true);
      setError(null);

      const payload: { status: 'completed'; rolloverToWorkUnitId?: string } = {
        status: 'completed',
      };

      if (rolloverChoice === 'sprint' && selectedTargetId) {
        payload.rolloverToWorkUnitId = selectedTargetId;
      }

      await OpsService.updateWorkUnit(numaPut, boardId, workUnit.id, payload);
      onCompleted();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [workUnit, boardId, rolloverChoice, selectedTargetId, numaPut, onCompleted, t]);

  if (!workUnit) return <></>;

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('sprints.complete')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <div className="alert alert-danger mb-3" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            {error}
          </div>
        )}

        <p className="fw-medium mb-2">{workUnit.name}</p>

        {/* Ticket summary */}
        <p className="text-muted small mb-3">
          {t('sprints.completionSummary', { done: completedCount, incomplete: incompleteCount })}
        </p>

        {incompleteCount > 0 && (
          <>
            <p className="text-muted mb-2">{t('sprints.incompleteTickets')}</p>
            <Form.Check
              type="radio"
              id="rollover-backlog"
              name="rolloverChoice"
              label={t('sprints.moveToBacklog')}
              checked={rolloverChoice === 'backlog'}
              onChange={() => setRolloverChoice('backlog')}
              className="mb-2"
            />
            <Form.Check
              type="radio"
              id="rollover-sprint"
              name="rolloverChoice"
              label={t('sprints.moveToSprint')}
              checked={rolloverChoice === 'sprint'}
              onChange={() => setRolloverChoice('sprint')}
              disabled={planningUnits.length === 0}
              className="mb-2"
            />
            {rolloverChoice === 'sprint' && planningUnits.length > 0 && (
              <>
                <Form.Select
                  size="sm"
                  className="ms-4 mb-2"
                  style={{ width: 'auto' }}
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                >
                  <option value="">{t('sprints.selectTargetSprint')}</option>
                  {planningUnits.map((wu) => (
                    <option key={wu.id} value={wu.id}>
                      {wu.name}
                    </option>
                  ))}
                </Form.Select>
                <p className="text-muted small ms-4 mb-2">{t('sprints.rolloverAutoActivateNote')}</p>
              </>
            )}
            {planningUnits.length === 0 && (
              <p className="text-muted small ms-4 mb-2">{t('sprints.noPlanningSprints')}</p>
            )}
          </>
        )}
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="warning"
          disabled={saving || (incompleteCount > 0 && rolloverChoice === 'sprint' && !selectedTargetId)}
          onClick={handleComplete}
        >
          {saving ? t('common.loading') : t('sprints.complete')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WorkUnitSuccessModal
// ═══════════════════════════════════════════════════════════════════════════════

interface WorkUnitSuccessModalProps {
  show: boolean;
  workUnit: WorkUnit | null;
  action: 'started' | 'completed';
  onHide: () => void;
}

export function WorkUnitSuccessModal({ show, workUnit, action, onHide }: WorkUnitSuccessModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  if (!workUnit) return <></>;

  const actionLabel = action === 'started' ? t('sprints.active') : t('sprints.completedStatus');

  return (
    <Modal show={show} onHide={onHide} centered size="sm">
      <Modal.Body className="text-center py-4">
        <div
          className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
          style={{
            width: 56,
            height: 56,
            backgroundColor: '#d1e7dd',
          }}
        >
          <i className="bi bi-check-lg" style={{ fontSize: 28, color: '#198754' }} />
        </div>

        <h5 className="mb-1">{workUnit.name}</h5>
        <p className="text-muted mb-3">{actionLabel}</p>

        <Button variant="primary" size="sm" onClick={onHide}>
          {t('common.viewOnBoard')}
        </Button>
      </Modal.Body>
    </Modal>
  );
}
