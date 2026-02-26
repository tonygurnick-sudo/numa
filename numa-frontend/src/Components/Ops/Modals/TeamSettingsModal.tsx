import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Nav, Tab, Row, Col, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../Providers/AuthProvider';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { BOARD_COLORS } from '../Shared/colorUtils';
import { GeneralTab } from './tabs/GeneralTab';
import { TicketsFieldsTab } from './tabs/TicketsFieldsTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import { ConfirmModal } from './ConfirmModal';
import { UserPicker } from '../../Inputs/UserPicker';
import type { WorkZone, WorkStage, FieldOverride, WorkUnitSeriesConfig, AccessControlMode } from '../../../types/ops';

// ─── Props ───────────────────────────────────────────────────────────────────

interface TeamSettingsModalProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TeamSettingsModal({ show, onHide, onSaved, onDeleted }: TeamSettingsModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { user } = useAuth();
  const { numaPut, numaDelete } = useNumaRequest();
  const { config, teamData, tickets, refreshStaff } = useOps();

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

  // ── Access tab state ────────────────────────────────────────────────────
  const [accessMode, setAccessMode] = useState<AccessControlMode>('all');
  const [accessUserIds, setAccessUserIds] = useState<string[]>([]);

  // ── Saving / deleting state ────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = Boolean(team?.createdBy && user?.username && team.createdBy === user.username);

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
      setAccessMode(team.accessControl?.mode ?? 'all');
      setAccessUserIds([...(team.accessControl?.users ?? [])]);
      setZones(existingZones.map((z) => ({ ...z })));
      setStages(existingStages.map((s) => ({ ...s })));
      setError(null);
    }
  }, [show, team, existingZones, existingStages]);

  // ── Sync staff from Cognito when the modal opens ──────────────────────
  useEffect(() => {
    if (show) {
      refreshStaff();
    }
  }, [show, refreshStaff]);

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
        accessControl: { mode: accessMode, users: accessMode === 'specific' ? accessUserIds : [] },
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
    accessMode,
    accessUserIds,
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

  // ── Delete team handler ────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!team) return;
    try {
      setDeleting(true);
      setError(null);
      await OpsService.deleteTeam(numaDelete, team.id);
      setShowDeleteConfirm(false);
      onHide();
      onDeleted?.();
    } catch (err) {
      const msg = String(err);
      if (msg.includes('409')) {
        setError(t('teams.deleteTeamHasTickets'));
      } else {
        setError(t('errors.saveFailed', { message: msg }));
      }
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }, [team, numaDelete, onHide, onDeleted, t]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!team || !config) return <></>;

  return (
    <>
      <Modal show={show} onHide={onHide} size="xl" fullscreen="lg-down" centered>
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
                  <Nav.Item>
                    <Nav.Link eventKey="access">
                      <i className="bi bi-people me-2" />
                      {t('settings.accessControl')}
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
                      createdBy={team.createdBy}
                      staff={config.staff}
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

                  <Tab.Pane eventKey="access">
                    <h6 className="mb-3">{t('settings.accessControl')}</h6>
                    <p className="text-muted small mb-3">{t('teams.accessControlHelp')}</p>
                    <Form.Check
                      type="radio"
                      id="settings-access-all"
                      name="settings-access"
                      label={t('teams.allUsers')}
                      checked={accessMode === 'all'}
                      onChange={() => setAccessMode('all')}
                      className="mb-2"
                    />
                    <Form.Check
                      type="radio"
                      id="settings-access-specific"
                      name="settings-access"
                      label={t('teams.specificUsers')}
                      checked={accessMode === 'specific'}
                      onChange={() => setAccessMode('specific')}
                      className="mb-3"
                    />
                    {accessMode === 'specific' && config.staff && (
                      <div className="ps-4">
                        <Form.Label className="small text-muted">{t('teams.selectMembers')}</Form.Label>
                        <UserPicker
                          staff={config.staff}
                          selectedIds={accessUserIds}
                          onChange={setAccessUserIds}
                          mode="multi"
                        />
                      </div>
                    )}
                  </Tab.Pane>
                </Tab.Content>
              </Col>
            </Row>
          </Tab.Container>
        </Modal.Body>

        <Modal.Footer>
          {isOwner && (
            <Button
              variant="outline-danger"
              className="me-auto"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
            >
              <i className="bi bi-trash me-1" />
              {t('teams.deleteTeam')}
            </Button>
          )}
          <Button variant="secondary" onClick={onHide}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={saving} onClick={handleSave}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal
        show={showDeleteConfirm}
        title={t('teams.deleteTeam')}
        message={t('teams.deleteTeamConfirm', { name: team?.name ?? '' })}
        confirmLabel={t('teams.deleteTeam')}
        variant="danger"
        onConfirm={handleDelete}
        onHide={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
