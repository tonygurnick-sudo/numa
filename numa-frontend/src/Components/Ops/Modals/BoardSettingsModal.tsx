import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Nav, Tab, Form, Badge } from 'react-bootstrap';
import { StaffAvatar } from '../Shared/StaffAvatar';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../Providers/AuthProvider';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { BOARD_COLORS } from '../Shared/colorUtils';
import { GeneralTab } from './tabs/GeneralTab';
import { WorkUnitsTab } from './tabs/WorkUnitsTab';
import { TicketsFieldsTab } from './tabs/TicketsFieldsTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import { ConfirmModal } from './ConfirmModal';
import { UserPicker } from '../../Inputs/UserPicker';
import type { WorkZone, WorkStage, FieldOverride, WorkUnitSeriesConfig, AccessControlMode } from '../../../types/ops';

// ─── Props ───────────────────────────────────────────────────────────────────

interface BoardSettingsModalProps {
  show: boolean;
  onHide: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BoardSettingsModal({ show, onHide, onSaved, onDeleted }: BoardSettingsModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { user } = useAuth();
  const { numaPut, numaDelete } = useNumaRequest();
  const { config, boardData, tickets, refreshStaff } = useOps();

  const team = boardData?.board ?? null;
  const existingZones = boardData?.zones ?? [];
  const existingStages = boardData?.stages ?? [];

  // ── General tab state ────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [color, setColor] = useState(BOARD_COLORS[0]);
  const [workUnitSeries, setWorkUnitSeries] = useState<WorkUnitSeriesConfig>(null);
  const [announcement, setAnnouncement] = useState('');
  const [defaultZoneId, setDefaultZoneId] = useState('');
  const [defaultStageId, setDefaultStageId] = useState('');

  // ── Tickets & Fields tab state ───────────────────────────────────────────
  const [allowedTicketTypes, setAllowedTicketTypes] = useState<string[]>([]);
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, FieldOverride>>({});
  const [addedFields, setAddedFields] = useState<Record<string, string[]>>({});

  // ── Workflow tab state ───────────────────────────────────────────────────
  const [zones, setZones] = useState<Partial<WorkZone>[]>([]);
  const [stages, setStages] = useState<Partial<WorkStage>[]>([]);

  // ── Access tab state ────────────────────────────────────────────────────
  const [accessMode, setAccessMode] = useState<AccessControlMode>('all');
  const [accessUserIds, setAccessUserIds] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);

  // ── Tab navigation & dirty tracking ─────────────────────────────────
  const [activeTab, setActiveTab] = useState('general');
  const [isDirty, setIsDirty] = useState(false);
  const [pendingTabKey, setPendingTabKey] = useState<string | null>(null);

  // ── Saving / deleting state ────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const currentUserSub = user?.decoded_tokens?.idToken?.sub;
  const isOwner = Boolean(
    currentUserSub && (team?.createdBy === currentUserSub || team?.accessControl?.owners?.includes(currentUserSub))
  );

  // ── Sync state from team data when modal opens or team changes ──────────
  // Only initialize once per modal-open cycle so local edits are not clobbered
  // by fresh array refs, but re-initialize if the selected team changes while
  // the modal stays open or if team data arrives after the modal is opened.
  const initializedRef = useRef(false);
  const initialZoneIdsRef = useRef<Set<string>>(new Set());
  const prevTeamIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!show) {
      initializedRef.current = false;
      initialZoneIdsRef.current = new Set();
      prevTeamIdRef.current = null;
      return;
    }

    const teamChanged = team && team.id !== prevTeamIdRef.current;
    const shouldInitialize = Boolean(team && existingZones.length > 0 && (!initializedRef.current || teamChanged));

    if (shouldInitialize && team) {
      setName(team.name);
      setColor(team.color);
      setWorkUnitSeries(team.workUnitSeries ?? null);
      setAnnouncement(team.announcement ?? '');
      setDefaultZoneId(team.defaultZoneId ?? '');
      setDefaultStageId(team.defaultStageId ?? '');
      setAllowedTicketTypes([...(team.allowedTicketTypes ?? config.ticketTypes.map((t) => t.id))]);
      setFieldOverrides({ ...(team.fieldOverrides ?? {}) });
      setAddedFields({ ...(team.addedFields ?? {}) });
      setAccessMode(team.accessControl?.mode ?? 'all');
      setAccessUserIds([...(team.accessControl?.users ?? [])]);
      setOwnerIds([...(team.accessControl?.owners ?? [])]);
      setZones(existingZones.map((z) => ({ ...z })));
      setStages(existingStages.map((s) => ({ ...s })));
      setError(null);
      setIsDirty(false);
      setActiveTab('general');
      setPendingTabKey(null);

      initialZoneIdsRef.current = new Set(existingZones.filter((z) => z.id).map((z) => z.id!));
      initializedRef.current = true;
      prevTeamIdRef.current = team.id;
    }
  }, [show, team, existingZones, existingStages, config.ticketTypes]);

  // ── Sync staff from Cognito when the modal opens ──────────────────────
  useEffect(() => {
    if (show) {
      refreshStaff();
    }
  }, [show, refreshStaff]);

  // ── Dirty tracking helpers ───────────────────────────────────────────
  const markDirty = useCallback(() => setIsDirty(true), []);

  // Wrap state setters to mark dirty on change
  const setNameDirty = useCallback(
    (v: string) => {
      setName(v);
      markDirty();
    },
    [markDirty]
  );
  const setColorDirty = useCallback(
    (v: string) => {
      setColor(v);
      markDirty();
    },
    [markDirty]
  );
  const setAnnouncementDirty = useCallback(
    (v: string) => {
      setAnnouncement(v);
      markDirty();
    },
    [markDirty]
  );
  const setWorkUnitSeriesDirty = useCallback(
    (v: WorkUnitSeriesConfig) => {
      setWorkUnitSeries(v);
      markDirty();
    },
    [markDirty]
  );
  const setDefaultZoneIdDirty = useCallback(
    (v: string) => {
      setDefaultZoneId(v);
      markDirty();
    },
    [markDirty]
  );
  const setDefaultStageIdDirty = useCallback(
    (v: string) => {
      setDefaultStageId(v);
      markDirty();
    },
    [markDirty]
  );
  const setZonesDirty = useCallback(
    (v: React.SetStateAction<Partial<WorkZone>[]>) => {
      setZones(v);
      markDirty();
    },
    [markDirty]
  );
  const setStagesDirty = useCallback(
    (v: React.SetStateAction<Partial<WorkStage>[]>) => {
      setStages(v);
      markDirty();
    },
    [markDirty]
  );
  const setAccessModeDirty = useCallback(
    (v: AccessControlMode) => {
      setAccessMode(v);
      markDirty();
    },
    [markDirty]
  );
  const setAccessUserIdsDirty = useCallback(
    (v: string[]) => {
      setAccessUserIds(v);
      markDirty();
    },
    [markDirty]
  );
  const setOwnerIdsDirty = useCallback(
    (v: string[]) => {
      setOwnerIds(v);
      markDirty();
    },
    [markDirty]
  );

  // ── Tab navigation with dirty guard ────────────────────────────────
  const handleTabSelect = useCallback(
    (key: string | null) => {
      if (!key || key === activeTab) return;
      if (isDirty) {
        setPendingTabKey(key);
      } else {
        setActiveTab(key);
      }
    },
    [activeTab, isDirty]
  );

  const resetFormToTeam = useCallback(() => {
    if (!team) return;
    setName(team.name);
    setColor(team.color);
    setWorkUnitSeries(team.workUnitSeries ?? null);
    setAnnouncement(team.announcement ?? '');
    setDefaultZoneId(team.defaultZoneId ?? '');
    setDefaultStageId(team.defaultStageId ?? '');
    setAllowedTicketTypes([...(team.allowedTicketTypes ?? config.ticketTypes.map((t) => t.id))]);
    setFieldOverrides({ ...(team.fieldOverrides ?? {}) });
    setAddedFields({ ...(team.addedFields ?? {}) });
    setAccessMode(team.accessControl?.mode ?? 'all');
    setAccessUserIds([...(team.accessControl?.users ?? [])]);
    setOwnerIds([...(team.accessControl?.owners ?? [])]);
    setZones(existingZones.map((z) => ({ ...z })));
    setStages(existingStages.map((s) => ({ ...s })));
  }, [team, config, existingZones, existingStages]);

  const handleUnsavedDiscard = useCallback(() => {
    resetFormToTeam();
    setIsDirty(false);
    if (pendingTabKey) {
      setActiveTab(pendingTabKey);
      setPendingTabKey(null);
    }
  }, [resetFormToTeam, pendingTabKey]);

  const handleUnsavedStay = useCallback(() => {
    setPendingTabKey(null);
  }, []);

  // ── Field override handlers ─────────────────────────────────────────────
  const handleFieldVisibleToggle = (fieldId: string) => {
    markDirty();
    setFieldOverrides((prev) => {
      const current = prev[fieldId] ?? { visible: true, required: false };
      return { ...prev, [fieldId]: { ...current, visible: !current.visible } };
    });
  };

  const handleFieldRequiredToggle = (fieldId: string) => {
    markDirty();
    setFieldOverrides((prev) => {
      const current = prev[fieldId] ?? { visible: true, required: false };
      return { ...prev, [fieldId]: { ...current, required: !current.required } };
    });
  };

  const handleFieldOverrideChange = (fieldId: string, changes: Partial<FieldOverride>) => {
    markDirty();
    setFieldOverrides((prev) => {
      const current = prev[fieldId] ?? { visible: true, required: false };
      return { ...prev, [fieldId]: { ...current, ...changes } };
    });
  };

  const handleAddField = (ticketTypeId: string, fieldId: string) => {
    markDirty();
    setAddedFields((prev) => {
      const current = prev[ticketTypeId] ?? [];
      if (current.includes(fieldId)) return prev;
      return { ...prev, [ticketTypeId]: [...current, fieldId] };
    });
    // Ensure the field is visible by default when added
    setFieldOverrides((prev) => {
      const current = prev[fieldId];
      if (current) return prev;
      return { ...prev, [fieldId]: { visible: true, required: false } };
    });
  };

  const handleRemoveAddedField = (ticketTypeId: string, fieldId: string) => {
    markDirty();
    setAddedFields((prev) => {
      const current = prev[ticketTypeId] ?? [];
      return { ...prev, [ticketTypeId]: current.filter((id) => id !== fieldId) };
    });
  };

  const handleReorderField = (ticketTypeId: string, fieldId: string, direction: 'up' | 'down') => {
    markDirty();
    // Get the ticket type to find its default fields
    const tt = config.ticketTypes.find((t) => t.id === ticketTypeId);
    if (!tt) return;
    const added = addedFields[ticketTypeId] ?? [];
    const allFieldIds = [...(tt.defaultFields ?? []), ...added];

    const idx = allFieldIds.indexOf(fieldId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= allFieldIds.length) return;

    // Assign order values based on new positions
    const reordered = [...allFieldIds];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];

    setFieldOverrides((prev) => {
      const next = { ...prev };
      reordered.forEach((fId, i) => {
        next[fId] = { ...(next[fId] ?? { visible: true, required: false }), order: i };
      });
      return next;
    });
  };

  const handleToggleTicketType = (typeId: string) => {
    markDirty();
    setAllowedTicketTypes((prev) => (prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId]));
  };

  // ── Unified save: team settings + workflow (zones + stages) ─────────────
  const handleSave = useCallback(async () => {
    if (!team) return;
    try {
      setSaving(true);
      setError(null);

      const isAllSelected = allowedTicketTypes.length === config.ticketTypes.length;

      // Save team settings
      await OpsService.updateBoard(numaPut, team.id, {
        name,
        color,
        announcement: announcement || null,
        allowedTicketTypes: isAllSelected ? undefined : allowedTicketTypes,
        fieldOverrides,
        addedFields,
        workUnitSeries,
        accessControl: { mode: accessMode, users: accessMode === 'specific' ? accessUserIds : [], owners: ownerIds },
        defaultZoneId: defaultZoneId || undefined,
        defaultStageId: defaultStageId || undefined,
      });

      // Delete removed zones
      const currentZoneIds = new Set(zones.filter((z) => z.id).map((z) => z.id!));
      const deletedZoneIds = [...initialZoneIdsRef.current].filter((id) => !currentZoneIds.has(id));
      for (const zoneId of deletedZoneIds) {
        await OpsService.deleteZone(numaDelete, team.id, zoneId);
      }

      // Save workflow (zones + stages)
      await OpsService.updateBoardZones(numaPut, team.id, zones);
      await OpsService.updateBoardStages(numaPut, team.id, stages);

      setIsDirty(false);
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
    announcement,
    allowedTicketTypes,
    fieldOverrides,
    addedFields,
    workUnitSeries,
    accessMode,
    accessUserIds,
    ownerIds,
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

  // ── Save-and-switch for unsaved changes prompt ─────────────────────
  const handleUnsavedSave = useCallback(async () => {
    await handleSave();
    if (pendingTabKey) {
      setActiveTab(pendingTabKey);
      setPendingTabKey(null);
    }
  }, [handleSave, pendingTabKey]);

  // ── Delete team handler ────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!team) return;
    try {
      setDeleting(true);
      setError(null);
      await OpsService.deleteBoard(numaDelete, team.id);
      setShowDeleteConfirm(false);
      onHide();
      onDeleted?.();
    } catch (err) {
      const msg = String(err);
      if (msg.includes('409')) {
        setError(t('boards.deleteTeamHasTickets'));
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
          <Modal.Title>{t('boards.settings')}</Modal.Title>
        </Modal.Header>

        <Modal.Body style={{ minHeight: 480 }}>
          {error && (
            <div className="alert alert-danger mb-3" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
              {error}
            </div>
          )}

          <Tab.Container activeKey={activeTab} onSelect={handleTabSelect}>
            {/* ── Horizontal Tab Navigation ──────────────────────────────── */}
            <Nav variant="pills" className="flex-row flex-wrap gap-2 pb-3 mb-3 border-bottom ops-settings-nav">
              <Nav.Item>
                <Nav.Link eventKey="general">
                  <i className="bi bi-sliders me-2" />
                  {t('settings.general')}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="workUnits">
                  <i className="bi bi-stopwatch me-2" />
                  {t('settings.workUnitsTab')}
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

            {/* ── Content Area ─────────────────────────────────────────────── */}
            <Tab.Content>
              <Tab.Pane eventKey="general">
                <GeneralTab
                  name={name}
                  setName={setNameDirty}
                  color={color}
                  setColor={setColorDirty}
                  announcement={announcement}
                  setAnnouncement={setAnnouncementDirty}
                  defaultZoneId={defaultZoneId}
                  setDefaultZoneId={setDefaultZoneIdDirty}
                  defaultStageId={defaultStageId}
                  setDefaultStageId={setDefaultStageIdDirty}
                  zones={zones}
                  stages={stages}
                  createdBy={team.createdBy}
                  staff={config.staff}
                />
              </Tab.Pane>

              <Tab.Pane eventKey="workUnits">
                <WorkUnitsTab workUnitSeries={workUnitSeries} onWorkUnitSeriesChange={setWorkUnitSeriesDirty} />
              </Tab.Pane>

              <Tab.Pane eventKey="tickets">
                <TicketsFieldsTab
                  ticketTypes={config.ticketTypes}
                  fields={config.fields}
                  allowedTicketTypes={allowedTicketTypes}
                  onToggleTicketType={handleToggleTicketType}
                  fieldOverrides={fieldOverrides}
                  addedFields={addedFields}
                  onFieldVisibleToggle={handleFieldVisibleToggle}
                  onFieldRequiredToggle={handleFieldRequiredToggle}
                  onFieldOverrideChange={handleFieldOverrideChange}
                  onAddField={handleAddField}
                  onRemoveAddedField={handleRemoveAddedField}
                  onReorderField={handleReorderField}
                />
              </Tab.Pane>

              <Tab.Pane eventKey="workflow">
                <WorkflowTab
                  zones={zones}
                  setZones={setZonesDirty}
                  stages={stages}
                  setStages={setStagesDirty}
                  tickets={tickets}
                  boardId={team.id}
                  defaultZoneId={defaultZoneId}
                  setDefaultZoneId={setDefaultZoneIdDirty}
                  defaultStageId={defaultStageId}
                  setDefaultStageId={setDefaultStageIdDirty}
                />
              </Tab.Pane>

              <Tab.Pane eventKey="access" style={{ minHeight: 320 }}>
                {/* ── Board Owners ──────────────────────────────────────── */}
                <h6 className="mb-2">{t('boards.boardOwners')}</h6>
                <p className="text-muted small mb-3">{t('boards.boardOwnersHelp')}</p>

                {/* Board creator — always shown, cannot be removed */}
                {team.createdBy &&
                  config.staff &&
                  (() => {
                    const creator = config.staff.find((s) => s.id === team.createdBy);
                    return creator ? (
                      <div
                        className="d-flex align-items-center gap-2 mb-2 px-2 py-2"
                        style={{ backgroundColor: '#f9fafb', borderRadius: 6 }}
                      >
                        <StaffAvatar staff={creator} size={24} />
                        <span className="small fw-medium">{creator.name || creator.email}</span>
                        <Badge bg="secondary" className="ms-1" style={{ fontSize: '0.65rem' }}>
                          {t('boards.boardCreator')}
                        </Badge>
                      </div>
                    ) : null;
                  })()}

                {/* Co-owners with remove capability */}
                {config.staff &&
                  ownerIds
                    .filter((id) => id !== team.createdBy)
                    .map((ownerId) => {
                      const staff = config.staff.find((s) => s.id === ownerId);
                      if (!staff) return null;
                      return (
                        <div
                          key={ownerId}
                          className="d-flex align-items-center gap-2 mb-2 px-2 py-2"
                          style={{ backgroundColor: '#f9fafb', borderRadius: 6 }}
                        >
                          <StaffAvatar staff={staff} size={24} />
                          <span className="small fw-medium">{staff.name || staff.email}</span>
                          <Badge bg="primary" className="ms-1" style={{ fontSize: '0.65rem' }}>
                            {t('boards.owner')}
                          </Badge>
                          {isOwner && (
                            <button
                              type="button"
                              className="btn-close ms-auto"
                              style={{ fontSize: '0.5rem' }}
                              onClick={() => setOwnerIdsDirty(ownerIds.filter((id) => id !== ownerId))}
                              aria-label={t('common.remove')}
                            />
                          )}
                        </div>
                      );
                    })}

                {/* Add co-owner picker — only visible to owners */}
                {isOwner && config.staff && (
                  <div className="mb-4">
                    <UserPicker
                      staff={config.staff}
                      selectedIds={[]}
                      onChange={(ids) => {
                        if (ids.length > 0) {
                          const newOwners = [...new Set([...ownerIds, ...ids])];
                          setOwnerIdsDirty(newOwners);
                        }
                      }}
                      excludeIds={[...(team.createdBy ? [team.createdBy] : []), ...ownerIds]}
                      mode="multi"
                      placeholder={t('boards.addOwnerPlaceholder')}
                    />
                  </div>
                )}

                <hr className="my-3" />

                {/* ── Access Control ────────────────────────────────────── */}
                <h6 className="mb-2">{t('settings.accessControl')}</h6>
                <p className="text-muted small mb-3">{t('boards.accessControlHelp')}</p>

                <Form.Check
                  type="radio"
                  id="settings-access-all"
                  name="settings-access"
                  label={t('boards.allUsers')}
                  checked={accessMode === 'all'}
                  onChange={() => setAccessModeDirty('all')}
                  className="mb-2"
                />
                <Form.Check
                  type="radio"
                  id="settings-access-specific"
                  name="settings-access"
                  label={t('boards.specificUsers')}
                  checked={accessMode === 'specific'}
                  onChange={() => setAccessModeDirty('specific')}
                  className="mb-3"
                />
                {accessMode === 'specific' && config.staff && (
                  <div className="ps-4">
                    <Form.Label className="small text-muted">{t('boards.selectMembers')}</Form.Label>
                    <UserPicker
                      staff={config.staff}
                      selectedIds={accessUserIds.filter((id) => id !== team.createdBy && !ownerIds.includes(id))}
                      onChange={(ids) =>
                        setAccessUserIdsDirty(ids.filter((id) => id !== team.createdBy && !ownerIds.includes(id)))
                      }
                      excludeIds={[...(team.createdBy ? [team.createdBy] : []), ...ownerIds]}
                      mode="multi"
                    />
                  </div>
                )}
              </Tab.Pane>
            </Tab.Content>
          </Tab.Container>
        </Modal.Body>

        <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
          {isOwner && (
            <Button
              variant="outline-danger"
              className="me-auto"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
            >
              <i className="bi bi-trash me-1" />
              {t('boards.deleteTeam')}
            </Button>
          )}
          <Button variant="outline-secondary" onClick={onHide}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={saving} onClick={handleSave}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal
        show={showDeleteConfirm}
        title={t('boards.deleteTeam')}
        message={t('boards.deleteTeamConfirm', { name: team?.name ?? '' })}
        confirmLabel={t('boards.deleteTeam')}
        variant="danger"
        onConfirm={handleDelete}
        onHide={() => setShowDeleteConfirm(false)}
      />

      {/* Unsaved changes confirmation */}
      <Modal show={pendingTabKey !== null} onHide={handleUnsavedStay} size="sm" centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('unsavedChanges.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-0">{t('unsavedChanges.message')}</p>
        </Modal.Body>
        <Modal.Footer className="d-flex gap-2" style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="outline-secondary" onClick={handleUnsavedStay}>
            {t('unsavedChanges.stay')}
          </Button>
          <Button variant="outline-secondary" onClick={handleUnsavedDiscard}>
            {t('unsavedChanges.discard')}
          </Button>
          <Button variant="primary" disabled={saving} onClick={handleUnsavedSave}>
            {saving ? t('common.loading') : t('unsavedChanges.save')}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
