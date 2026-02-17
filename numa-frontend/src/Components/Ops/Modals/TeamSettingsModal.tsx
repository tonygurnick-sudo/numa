import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Nav, Tab, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { BOARD_COLORS } from '../Shared/colorUtils';
import { GeneralTab } from './tabs/GeneralTab';
import { TicketsFieldsTab } from './tabs/TicketsFieldsTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import type { WorkZone, WorkStage, FieldOverride, WorkUnitSeriesConfig } from '../../../types/ops';

// ─── Props ───────────────────────────────────────────────────────────────────

interface TeamSettingsModalProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TeamSettingsModal({ show, onHide, onSaved }: TeamSettingsModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPut, numaDelete } = useNumaRequest();
  const { config, teamData, tickets } = useOps();

  const team = teamData?.team ?? null;
  const existingZones = teamData?.zones ?? [];
  const existingStages = teamData?.stages ?? [];

  // ── General tab state ────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [color, setColor] = useState(BOARD_COLORS[0]);
  const [workUnitSeries, setWorkUnitSeries] = useState<WorkUnitSeriesConfig>(null);
  const [defaultZoneId, setDefaultZoneId] = useState('');
  const [defaultStageId, setDefaultStageId] = useState('');

  // ── Tickets & Fields tab state ───────────────────────────────────────────
  const [allowedTicketTypes, setAllowedTicketTypes] = useState<string[]>([]);
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, FieldOverride>>({});

  // ── Workflow tab state ───────────────────────────────────────────────────
  const [zones, setZones] = useState<Partial<WorkZone>[]>([]);
  const [stages, setStages] = useState<Partial<WorkStage>[]>([]);

  // ── Saving state ─────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Sync state from team data when modal opens ──────────────────────────
  useEffect(() => {
    if (show && team) {
      setName(team.name);
      setColor(team.color);
      setWorkUnitSeries(team.workUnitSeries ?? null);
      setDefaultZoneId(team.defaultZoneId ?? '');
      setDefaultStageId(team.defaultStageId ?? '');
      setAllowedTicketTypes([...(team.allowedTicketTypes ?? [])]);
      setFieldOverrides({ ...(team.fieldOverrides ?? {}) });
      setZones(existingZones.map((z) => ({ ...z })));
      setStages(existingStages.map((s) => ({ ...s })));
      setError(null);
    }
  }, [show, team, existingZones, existingStages]);

  // ── Field override handlers ─────────────────────────────────────────────
  const handleFieldVisibleToggle = (fieldId: string) => {
    setFieldOverrides((prev) => {
      const current = prev[fieldId] ?? { visible: true, required: false };
      return { ...prev, [fieldId]: { ...current, visible: !current.visible } };
    });
  };

  const handleFieldRequiredToggle = (fieldId: string) => {
    setFieldOverrides((prev) => {
      const current = prev[fieldId] ?? { visible: true, required: false };
      return { ...prev, [fieldId]: { ...current, required: !current.required } };
    });
  };

  const handleToggleTicketType = (typeId: string) => {
    setAllowedTicketTypes((prev) => (prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId]));
  };

  // ── Unified save: team settings + workflow (zones + stages) ─────────────
  const handleSave = useCallback(async () => {
    if (!team) return;
    try {
      setSaving(true);
      setError(null);

      // Save team settings
      await OpsService.updateTeam(numaPut, team.id, {
        name,
        color,
        allowedTicketTypes,
        fieldOverrides,
        workUnitSeries,
        defaultZoneId: defaultZoneId || undefined,
        defaultStageId: defaultStageId || undefined,
      });

      // Delete removed zones
      const existingZoneIds = new Set(existingZones.map((z) => z.id));
      const currentZoneIds = new Set(zones.filter((z) => z.id).map((z) => z.id!));
      const deletedZoneIds = [...existingZoneIds].filter((id) => !currentZoneIds.has(id));
      for (const zoneId of deletedZoneIds) {
        await OpsService.deleteZone(numaDelete, team.id, zoneId);
      }

      // Save workflow (zones + stages)
      await OpsService.updateTeamZones(numaPut, team.id, zones);
      await OpsService.updateTeamStages(numaPut, team.id, stages);

      onSaved();
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setSaving(false);
    }
  }, [
    team,
    name,
    color,
    allowedTicketTypes,
    fieldOverrides,
    workUnitSeries,
    defaultZoneId,
    defaultStageId,
    zones,
    stages,
    existingZones,
    numaPut,
    numaDelete,
    onSaved,
    t,
  ]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!team || !config) return <></>;

  return (
    <Modal show={show} onHide={onHide} size="xl" centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('teams.settings')}</Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ minHeight: 480 }}>
        {error && <div className="alert alert-danger mb-3">{error}</div>}

        <Tab.Container defaultActiveKey="general">
          <Row>
            {/* ── Sidebar Navigation ──────────────────────────────────────── */}
            <Col xs={3} className="border-end pe-3">
              <Nav variant="pills" className="flex-column gap-1">
                <Nav.Item>
                  <Nav.Link eventKey="general">
                    <i className="bi bi-sliders me-2" />
                    {t('settings.general')}
                  </Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="tickets">
                    <i className="bi bi-tag me-2" />
                    {t('settings.ticketsAndFields')}
                  </Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="workflow">
                    <i className="bi bi-columns-gap me-2" />
                    {t('settings.workflow')}
                  </Nav.Link>
                </Nav.Item>
              </Nav>
            </Col>

            {/* ── Content Area ─────────────────────────────────────────────── */}
            <Col xs={9} className="ps-4">
              <Tab.Content>
                <Tab.Pane eventKey="general">
                  <GeneralTab
                    name={name}
                    setName={setName}
                    color={color}
                    setColor={setColor}
                    workUnitSeries={workUnitSeries}
                    onWorkUnitSeriesChange={setWorkUnitSeries}
                    defaultZoneId={defaultZoneId}
                    setDefaultZoneId={setDefaultZoneId}
                    defaultStageId={defaultStageId}
                    setDefaultStageId={setDefaultStageId}
                    zones={zones}
                    stages={stages}
                  />
                </Tab.Pane>

                <Tab.Pane eventKey="tickets">
                  <TicketsFieldsTab
                    ticketTypes={config.ticketTypes}
                    fields={config.fields}
                    allowedTicketTypes={allowedTicketTypes}
                    onToggleTicketType={handleToggleTicketType}
                    fieldOverrides={fieldOverrides}
                    onFieldVisibleToggle={handleFieldVisibleToggle}
                    onFieldRequiredToggle={handleFieldRequiredToggle}
                  />
                </Tab.Pane>

                <Tab.Pane eventKey="workflow">
                  <WorkflowTab
                    zones={zones}
                    setZones={setZones}
                    stages={stages}
                    setStages={setStages}
                    tickets={tickets}
                    teamId={team.id}
                    defaultZoneId={defaultZoneId}
                    setDefaultZoneId={setDefaultZoneId}
                    defaultStageId={defaultStageId}
                    setDefaultStageId={setDefaultStageId}
                  />
                </Tab.Pane>
              </Tab.Content>
            </Col>
          </Row>
        </Tab.Container>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={saving} onClick={handleSave}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
