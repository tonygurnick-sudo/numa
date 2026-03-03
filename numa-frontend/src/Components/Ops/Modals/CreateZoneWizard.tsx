import React, { useState, useCallback } from 'react';
import { Modal, Button, Form, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { ZONE_STATUS_TYPES, ZONE_TYPE_BADGE_COLORS } from '../../../constants/opsConstants';
import type { ZoneType, StatusType, WorkZone } from '../../../types/ops';

// ─── Props ───────────────────────────────────────────────────────────────────

interface CreateZoneWizardProps {
  show: boolean;
  onHide: () => void;
  onCreated: () => void;
}

// ─── Default stages per zone type ────────────────────────────────────────────

const DEFAULT_STAGES: Record<ZoneType, { name: string; statusType: StatusType }[]> = {
  board: [
    { name: 'To Do', statusType: 'queued' },
    { name: 'In Progress', statusType: 'active' },
    { name: 'Done', statusType: 'completed' },
  ],
  backlog: [
    { name: 'New', statusType: 'backlog' },
    { name: 'Ready', statusType: 'scoped' },
  ],
};

// ─── Component ───────────────────────────────────────────────────────────────

export function CreateZoneWizard({ show, onHide, onCreated }: CreateZoneWizardProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPut } = useNumaRequest();
  const { teamData } = useOps();

  const team = teamData?.team ?? null;
  const existingZones = teamData?.zones ?? [];

  // ── Form state ─────────────────────────────────────────────────────────────
  const [zoneName, setZoneName] = useState('');
  const [zoneType, setZoneType] = useState<ZoneType>('board');
  const [stages, setStages] = useState<{ name: string; statusType: StatusType }[]>([...DEFAULT_STAGES.board]);
  const [newStageName, setNewStageName] = useState('');
  const [newStageStatusType, setNewStageStatusType] = useState<StatusType | ''>('');

  // ── Saving state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Reset on open ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (show) {
      setZoneName('');
      setZoneType('board');
      setStages([...DEFAULT_STAGES.board]);
      setNewStageName('');
      setNewStageStatusType('');
      setError(null);
    }
  }, [show]);

  // ── Zone type change: reset stages to defaults for new type ────────────────
  const handleZoneTypeChange = (newType: ZoneType) => {
    setZoneType(newType);
    setStages([...DEFAULT_STAGES[newType]]);
    setNewStageStatusType('');
  };

  // ── Stage management ───────────────────────────────────────────────────────
  const handleAddStage = () => {
    if (!newStageName.trim() || !newStageStatusType) return;
    setStages((prev) => [...prev, { name: newStageName.trim(), statusType: newStageStatusType }]);
    setNewStageName('');
    setNewStageStatusType('');
  };

  const handleRemoveStage = (idx: number) => {
    setStages((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!team) return;
    try {
      setSaving(true);
      setError(null);

      // Build the full zones list: existing zones + new zone
      const maxOrder = existingZones.reduce((max, z) => Math.max(max, z.order ?? 0), 0);
      const newZone: Partial<WorkZone> = {
        name: zoneName.trim(),
        zoneType,
        order: maxOrder + 1000,
      };

      const allZones: Partial<WorkZone>[] = [...existingZones.map((z) => ({ ...z })), newZone];

      // Save zones — backend will create the new one and return all
      const savedZones = await OpsService.updateTeamZones(numaPut, team.id, allZones);

      // Find the newly created zone to attach stages
      const createdZone = savedZones.find((z) => z.name === zoneName.trim() && z.zoneType === zoneType);

      if (createdZone) {
        // Get existing stages and add new ones for the new zone
        const existingStages = teamData?.stages ?? [];
        const newStages = stages.map((s, idx) => ({
          zoneId: createdZone.id,
          name: s.name,
          statusType: s.statusType,
          order: (idx + 1) * 1000,
        }));

        await OpsService.updateTeamStages(numaPut, team.id, [...existingStages.map((s) => ({ ...s })), ...newStages]);
      }

      onCreated();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [team, teamData, existingZones, zoneName, zoneType, stages, numaPut, onCreated, t]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!team) return <></>;

  return (
    <Modal show={show} onHide={onHide} size="lg" fullscreen="lg-down" centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('zones.createZone')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && <div className="alert alert-danger mb-3">{error}</div>}

        <Form.Group className="mb-3">
          <Form.Label>{t('zones.zoneName')}</Form.Label>
          <Form.Control type="text" value={zoneName} onChange={(e) => setZoneName(e.target.value)} autoFocus />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>{t('zones.zoneTypeLabel')}</Form.Label>
          <div className="d-flex gap-3">
            {(['board', 'backlog'] as ZoneType[]).map((zt) => (
              <div
                key={zt}
                className={`border rounded p-3 flex-fill ${zoneType === zt ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => handleZoneTypeChange(zt)}
              >
                <div className="d-flex align-items-center gap-2">
                  <i className={`bi ${zt === 'board' ? 'bi-kanban' : 'bi-list-task'}`} />
                  <strong>{t(`zones.type_${zt}`)}</strong>
                  <Badge bg={ZONE_TYPE_BADGE_COLORS[zt]}>{zt}</Badge>
                </div>
                <p className="text-muted small mb-0 mt-1">{t(`zones.typeDesc_${zt}`)}</p>
              </div>
            ))}
          </div>
        </Form.Group>

        {/* Stages */}
        <Form.Label>{t('zones.initialStages')}</Form.Label>
        <div className="border rounded p-2 mb-3">
          {stages.map((stage, idx) => (
            <div key={idx} className="d-flex align-items-center gap-2 mb-1">
              <Badge bg="outline-secondary" className="border">
                {stage.statusType}
              </Badge>
              <span>{stage.name}</span>
              <button
                type="button"
                className="btn btn-sm btn-link text-danger ms-auto p-0"
                onClick={() => handleRemoveStage(idx)}
              >
                <i className="bi bi-x" />
              </button>
            </div>
          ))}

          <div className="d-flex gap-2 mt-2">
            <Form.Control
              size="sm"
              placeholder={t('teams.newStageName')}
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
            />
            <Form.Select
              size="sm"
              value={newStageStatusType}
              onChange={(e) => setNewStageStatusType(e.target.value as StatusType)}
              style={{ maxWidth: 140 }}
            >
              <option value="">{t('zones.selectStatusType')}</option>
              {ZONE_STATUS_TYPES[zoneType].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Form.Select>
            <Button
              size="sm"
              variant="outline-primary"
              onClick={handleAddStage}
              disabled={!newStageName.trim() || !newStageStatusType}
            >
              <i className="bi bi-plus" />
            </Button>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={saving || !zoneName.trim() || stages.length === 0} onClick={handleSave}>
          {saving ? t('common.loading') : t('zones.createZone')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
