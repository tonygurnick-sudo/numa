import React, { useState, useMemo, useCallback } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import * as OpsService from '../../../Services/OpsService';
import type { WorkUnit, Ticket, WorkZone } from '../../../types/ops';

// ═══════════════════════════════════════════════════════════════════════════════
// StartWorkUnitModal
// ═══════════════════════════════════════════════════════════════════════════════

interface StartWorkUnitModalProps {
  show: boolean;
  workUnits: WorkUnit[];
  teamId: string;
  tickets: Ticket[];
  zones: WorkZone[];
  onHide: () => void;
  onStarted: () => void;
}

export function StartWorkUnitModal({
  show,
  workUnits,
  teamId,
  tickets,
  zones,
  onHide,
  onStarted,
}: StartWorkUnitModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPut } = useNumaRequest();

  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planningUnits = useMemo(() => workUnits.filter((wu) => wu.status === 'planning'), [workUnits]);

  const hasActiveUnit = useMemo(() => workUnits.some((wu) => wu.status === 'active'), [workUnits]);

  /** Count of backlog tickets that will be moved when this sprint starts */
  const backlogTicketCount = useMemo(() => {
    if (!selectedId) return 0;
    const backlogZoneIds = new Set(zones.filter((z) => z.zoneType === 'backlog').map((z) => z.id));
    return tickets.filter((tk) => tk.workUnitId === selectedId && backlogZoneIds.has(tk.zoneId)).length;
  }, [selectedId, tickets, zones]);

  const handleStart = useCallback(async () => {
    if (!selectedId) return;
    try {
      setSaving(true);
      setError(null);
      await OpsService.updateWorkUnit(numaPut, teamId, selectedId, {
        status: 'active',
      });
      setSelectedId('');
      onStarted();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [selectedId, teamId, numaPut, onStarted, t]);

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('sprints.start')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && <div className="alert alert-danger mb-3">{error}</div>}

        {hasActiveUnit && <div className="alert alert-warning mb-3">{t('sprints.completeCurrentFirst')}</div>}

        <Form.Group className="mb-3">
          <Form.Label>{t('sprints.selectWorkUnit')}</Form.Label>
          <Form.Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={hasActiveUnit}>
            <option value="">{t('common.selectOption')}</option>
            {planningUnits.map((wu) => (
              <option key={wu.id} value={wu.id}>
                {wu.name}
              </option>
            ))}
          </Form.Select>
        </Form.Group>

        {selectedId && backlogTicketCount > 0 && (
          <div className="alert alert-info mb-0">{t('sprints.startConfirmMessage', { count: backlogTicketCount })}</div>
        )}

        {selectedId && backlogTicketCount === 0 && (
          <p className="text-muted small mb-0">{t('sprints.noTicketsToMove')}</p>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="success" disabled={!selectedId || hasActiveUnit || saving} onClick={handleStart}>
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
  teamId: string;
  incompleteCount: number;
  onHide: () => void;
  onCompleted: () => void;
}

export function CompleteWorkUnitModal({
  show,
  workUnit,
  teamId,
  incompleteCount,
  onHide,
  onCompleted,
}: CompleteWorkUnitModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPut } = useNumaRequest();

  const [rolloverChoice, setRolloverChoice] = useState<'next' | 'backlog'>('backlog');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = useCallback(async () => {
    if (!workUnit) return;
    try {
      setSaving(true);
      setError(null);

      const payload: { status: 'completed'; rolloverToWorkUnitId?: string } = {
        status: 'completed',
      };

      // If user chooses to move to next sprint, we send undefined for
      // rolloverToWorkUnitId — the backend will resolve the next WU.
      // If they choose backlog, we also omit it so tickets go to backlog.
      if (rolloverChoice === 'next') {
        // The backend interprets a truthy rolloverToWorkUnitId as "move
        // incomplete tickets to that work unit". Sending 'next' as a
        // sentinel tells the backend to find the next planning unit.
        payload.rolloverToWorkUnitId = 'next';
      }

      await OpsService.updateWorkUnit(numaPut, teamId, workUnit.id, payload);
      onCompleted();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [workUnit, teamId, rolloverChoice, numaPut, onCompleted, t]);

  if (!workUnit) return <></>;

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('sprints.complete')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && <div className="alert alert-danger mb-3">{error}</div>}

        <p className="fw-medium mb-3">{workUnit.name}</p>

        {incompleteCount > 0 && (
          <>
            <p className="text-muted mb-2">{t('sprints.incompleteTickets')}</p>
            <Form.Check
              type="radio"
              id="rollover-next"
              name="rolloverChoice"
              label={t('sprints.moveToNext')}
              checked={rolloverChoice === 'next'}
              onChange={() => setRolloverChoice('next')}
              className="mb-2"
            />
            <Form.Check
              type="radio"
              id="rollover-backlog"
              name="rolloverChoice"
              label={t('sprints.moveToBacklog')}
              checked={rolloverChoice === 'backlog'}
              onChange={() => setRolloverChoice('backlog')}
              className="mb-2"
            />
          </>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="warning" disabled={saving} onClick={handleComplete}>
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
