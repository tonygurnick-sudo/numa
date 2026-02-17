import React, { useState, useCallback, useMemo } from 'react';
import { Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../Modals/ConfirmModal';
import { useOps } from '../OpsContext';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import * as OpsService from '../../../Services/OpsService';
import type { Ticket, TicketPriority } from '../../../types/ops';

// ─── Constants ──────────────────────────────────────────────────────────────

const KEEP_AS_IS = '__keep__';

const PRIORITIES: TicketPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

// ─── Props ──────────────────────────────────────────────────────────────────

interface BulkEditPanelProps {
  selectedTickets: Ticket[];
  onDeselect: () => void;
  onApplied: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BulkEditPanel({
  selectedTickets,
  onDeselect,
  onApplied,
}: BulkEditPanelProps): React.JSX.Element | null {
  const { t } = useTranslation('ops');
  const { config, teamData, workUnits } = useOps();
  const { numaPost, numaDelete } = useNumaRequest();

  // ── Local state ───────────────────────────────────────────────────────────

  const [stageId, setStageId] = useState(KEEP_AS_IS);
  const [assigneeId, setAssigneeId] = useState(KEEP_AS_IS);
  const [priority, setPriority] = useState(KEEP_AS_IS);
  const [workUnitId, setWorkUnitId] = useState(KEEP_AS_IS);

  const [applying, setApplying] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Derived data ──────────────────────────────────────────────────────────

  const zones = teamData?.zones ?? [];
  const stages = teamData?.stages ?? [];
  const staff = config?.staff?.filter((s) => s.isActive) ?? [];
  const hasWorkUnits = !!teamData?.team?.workUnitSeries?.enabled;

  const hasChanges = useMemo(
    () => stageId !== KEEP_AS_IS || assigneeId !== KEEP_AS_IS || priority !== KEEP_AS_IS || workUnitId !== KEEP_AS_IS,
    [stageId, assigneeId, priority, workUnitId],
  );

  const ticketIds = useMemo(() => selectedTickets.map((t) => t.id), [selectedTickets]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleApply = useCallback(async () => {
    if (!hasChanges || ticketIds.length === 0) return;

    try {
      setApplying(true);

      const changes: Record<string, string | null | undefined> = {};
      if (stageId !== KEEP_AS_IS) {
        changes.stageId = stageId;
        const stage = stages.find((s) => s.id === stageId);
        if (stage) changes.zoneId = stage.zoneId;
      }
      if (assigneeId !== KEEP_AS_IS) {
        changes.assigneeId = assigneeId === '' ? null : assigneeId;
      }
      if (priority !== KEEP_AS_IS) changes.priority = priority;
      if (workUnitId !== KEEP_AS_IS) {
        changes.workUnitId = workUnitId === '' ? null : workUnitId;
      }

      await OpsService.bulkUpdateTickets(numaPost, {
        ticketIds,
        changes,
      });

      // Reset selections and notify parent
      resetFields();
      onApplied();
    } catch (err) {
      console.error('[BulkEditPanel] Failed to apply bulk changes:', err);
    } finally {
      setApplying(false);
    }
  }, [hasChanges, ticketIds, stageId, stages, assigneeId, priority, workUnitId, numaPost, onApplied]);

  const handleBulkDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    try {
      setApplying(true);
      await Promise.all(ticketIds.map((id) => OpsService.deleteTicket(numaDelete, id)));
      resetFields();
      onApplied();
    } catch (err) {
      console.error('[BulkEditPanel] Failed to delete tickets:', err);
    } finally {
      setApplying(false);
    }
  }, [ticketIds, numaDelete, onApplied]);

  const resetFields = () => {
    setStageId(KEEP_AS_IS);
    setAssigneeId(KEEP_AS_IS);
    setPriority(KEEP_AS_IS);
    setWorkUnitId(KEEP_AS_IS);
  };

  // ── Guard: don't render when nothing is selected ──────────────────────────

  if (selectedTickets.length === 0) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className="bg-white border-top shadow-sm px-3 py-2"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
        }}
      >
        {/* ── Header row ──────────────────────────────────────────────────── */}
        <div className="d-flex align-items-center justify-content-between mb-2">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-semibold small">{t('bulk.selected', { count: selectedTickets.length })}</span>
            <Button variant="link" size="sm" className="p-0 text-muted" onClick={onDeselect}>
              {t('bulk.deselectAll')}
            </Button>
          </div>
        </div>

        {/* ── Fields row ──────────────────────────────────────────────────── */}
        <div className="d-flex align-items-end gap-3 flex-wrap">
          {/* Stage */}
          <Form.Group style={{ minWidth: 150 }}>
            <Form.Label className="small mb-1">{t('tickets.status')}</Form.Label>
            <Form.Select size="sm" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value={KEEP_AS_IS}>{t('bulk.keepAsIs')}</option>
              {zones.map((zone) => {
                const zoneStages = stages.filter((s) => s.zoneId === zone.id).sort((a, b) => a.order - b.order);
                if (zoneStages.length === 0) return null;
                return (
                  <optgroup key={zone.id} label={zone.name}>
                    {zoneStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Form.Select>
          </Form.Group>

          {/* Assignee */}
          <Form.Group style={{ minWidth: 160 }}>
            <Form.Label className="small mb-1">{t('tickets.assignee')}</Form.Label>
            <Form.Select size="sm" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value={KEEP_AS_IS}>{t('bulk.keepAsIs')}</option>
              <option value="">{t('fields.unassigned')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          {/* Priority */}
          <Form.Group style={{ minWidth: 140 }}>
            <Form.Label className="small mb-1">{t('tickets.priority')}</Form.Label>
            <Form.Select size="sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value={KEEP_AS_IS}>{t('bulk.keepAsIs')}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          {/* Work Unit (only if board has work units enabled) */}
          {hasWorkUnits && (
            <Form.Group style={{ minWidth: 160 }}>
              <Form.Label className="small mb-1">{t('tickets.workUnit')}</Form.Label>
              <Form.Select size="sm" value={workUnitId} onChange={(e) => setWorkUnitId(e.target.value)}>
                <option value={KEEP_AS_IS}>{t('bulk.keepAsIs')}</option>
                <option value="">{t('common.none')}</option>
                {workUnits.map((wu) => (
                  <option key={wu.id} value={wu.id}>
                    {wu.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          {/* ── Action buttons ──────────────────────────────────────────── */}
          <div className="d-flex gap-2 ms-auto align-self-end">
            <Button variant="primary" size="sm" disabled={!hasChanges || applying} onClick={handleApply}>
              {applying ? t('common.loading') : t('common.save')}
            </Button>
            <Button variant="outline-danger" size="sm" disabled={applying} onClick={() => setShowDeleteConfirm(true)}>
              {t('bulk.bulkDelete')}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Delete Confirmation Modal ───────────────────────────────────────── */}
      <ConfirmModal
        show={showDeleteConfirm}
        onHide={() => setShowDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title={t('bulk.bulkDelete')}
        message={t('tickets.deleteConfirm')}
        confirmLabel={t('bulk.bulkDelete')}
        variant="danger"
      />
    </>
  );
}
