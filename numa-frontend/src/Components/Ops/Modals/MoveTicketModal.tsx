import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Form, Spinner, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import * as OpsService from '../../../Services/OpsService';
import type { Ticket, TeamSummary, WorkZone, WorkStage } from '../../../types/ops';

interface MoveTicketModalProps {
  show: boolean;
  onHide: () => void;
  onMoved: (updatedTicket: Ticket) => void;
  ticket: Ticket;
  currentTeamName: string;
  availableTeams: TeamSummary[];
}

export function MoveTicketModal({
  show,
  onHide,
  onMoved,
  ticket,
  currentTeamName,
  availableTeams,
}: MoveTicketModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPut } = useNumaRequest();

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [targetZones, setTargetZones] = useState<WorkZone[]>([]);
  const [targetStages, setTargetStages] = useState<WorkStage[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [loadingStages, setLoadingStages] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!show) {
      setSelectedTeamId(null);
      setTargetZones([]);
      setTargetStages([]);
      setSelectedStageId(null);
      setLoadingStages(false);
      setMoving(false);
      setError(null);
    }
  }, [show]);

  // Fetch target board stages when board is selected
  useEffect(() => {
    if (!selectedTeamId) {
      setTargetZones([]);
      setTargetStages([]);
      setSelectedStageId(null);
      return;
    }

    let cancelled = false;
    setLoadingStages(true);
    setError(null);
    setSelectedStageId(null);

    void (async () => {
      try {
        const data = await OpsService.getTeam(numaGet, selectedTeamId);
        if (cancelled) return;

        const zones = data.zones.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const stages = data.stages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setTargetZones(zones);
        setTargetStages(stages);

        // Default to first backlog stage, or first stage overall
        const backlogStage = stages.find((s) => s.statusType === 'backlog');
        setSelectedStageId(backlogStage?.id ?? stages[0]?.id ?? null);
      } catch {
        if (!cancelled) {
          setError(t('moveToBoard.error'));
        }
      } finally {
        if (!cancelled) setLoadingStages(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, numaGet, t]);

  const selectedTeamName = availableTeams.find((t) => t.id === selectedTeamId)?.name ?? '';
  const selectedStage = targetStages.find((s) => s.id === selectedStageId);

  const handleMove = useCallback(async () => {
    if (!selectedTeamId || !selectedStageId || !selectedStage) return;

    setMoving(true);
    setError(null);

    try {
      const updated = await OpsService.updateTicket(numaPut, ticket.id, {
        currentTeamId: ticket.teamId,
        teamId: selectedTeamId,
        stageId: selectedStageId,
        zoneId: selectedStage.zoneId,
        statusType: selectedStage.statusType,
        version: ticket.version,
      });
      onMoved(updated);
    } catch (err: unknown) {
      const isConflict = err instanceof Error && (err.message.includes('409') || err.message.includes('conflict'));
      setError(isConflict ? t('moveToBoard.versionConflict') : t('moveToBoard.error'));
    } finally {
      setMoving(false);
    }
  }, [selectedTeamId, selectedStageId, selectedStage, numaPut, ticket.id, ticket.version, onMoved, t]);

  const canConfirm = selectedTeamId && selectedStageId && !loadingStages && !moving;

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>{t('moveToBoard.title')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label className="text-muted small mb-1">{t('moveToBoard.currentBoard')}</Form.Label>
          <div className="fw-semibold">{currentTeamName}</div>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('moveToBoard.targetBoard')}</Form.Label>
          <Form.Select value={selectedTeamId ?? ''} onChange={(e) => setSelectedTeamId(e.target.value || null)}>
            <option value="">{t('moveToBoard.selectBoard')}</option>
            {availableTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Form.Select>
        </Form.Group>

        {selectedTeamId && (
          <Form.Group className="mb-3">
            <Form.Label>
              {t('moveToBoard.targetStage')}
              {loadingStages && <Spinner size="sm" animation="border" className="ms-2" />}
            </Form.Label>
            <Form.Select
              value={selectedStageId ?? ''}
              onChange={(e) => setSelectedStageId(e.target.value || null)}
              disabled={loadingStages || targetStages.length === 0}
            >
              {!loadingStages && targetStages.length === 0 && <option value="">{t('moveToBoard.selectStage')}</option>}
              {targetZones.map((zone) => {
                const zoneStages = targetStages.filter((s) => s.zoneId === zone.id);
                if (zoneStages.length === 0) return null;
                return (
                  <optgroup key={zone.id} label={zone.name}>
                    {zoneStages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Form.Select>
          </Form.Group>
        )}

        {selectedTeamId && selectedStageId && selectedStage && !loadingStages && (
          <div
            className="small text-muted border rounded p-2"
            style={{ backgroundColor: '#f8f9fa' }}
            dangerouslySetInnerHTML={{
              __html: t('moveToBoard.confirmMessage', {
                currentBoard: currentTeamName,
                targetBoard: selectedTeamName,
                stageName: selectedStage.name,
                interpolation: { escapeValue: false },
              }),
            }}
          />
        )}

        {error && (
          <Alert variant="danger" className="mt-3 mb-0">
            {error}
          </Alert>
        )}
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <Button variant="secondary" onClick={onHide} disabled={moving}>
          {t('moveToBoard.cancel')}
        </Button>
        <Button variant="primary" onClick={() => void handleMove()} disabled={!canConfirm}>
          {moving && <Spinner size="sm" animation="border" className="me-2" />}
          {t('moveToBoard.confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
