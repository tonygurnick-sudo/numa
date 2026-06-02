import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Nav, Tab, Form, Badge } from 'react-bootstrap';
import { StaffAvatar } from '../Shared/StaffAvatar';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../Providers/AuthProvider';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useConfirm } from '../../../Providers/ConfirmContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { BOARD_COLORS } from '../Shared/colorUtils';
import { resolveBoardFieldList } from '../Shared/fieldResolution';
import { GeneralTab } from './tabs/GeneralTab';
import { WorkUnitsTab } from './tabs/WorkUnitsTab';
import { TicketsFieldsTab } from './tabs/TicketsFieldsTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import { ConfirmModal } from './ConfirmModal';
import { UserPicker } from '../../Inputs/UserPicker';
import type {
  WorkZone,
  WorkStage,
  FieldOverride,
  FieldDefinition,
  FieldCategory,
  FieldType,
  WorkUnitSeriesConfig,
  AccessControlMode,
} from '../../../types/ops';

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
  const { numaPut, numaDelete, numaPost } = useNumaRequest();
  const { config, boardData, tickets, refreshStaff, refreshConfig } = useOps();
  const showConfirm = useConfirm();

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
  const [personas, setPersonas] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);

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
      setPersonas([...(team.personas ?? [])]);
      setIndustries([...(team.industries ?? [])]);
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
  const setPersonasDirty = useCallback(
    (v: string[]) => {
      setPersonas(v);
      markDirty();
    },
    [markDirty]
  );
  const setIndustriesDirty = useCallback(
    (v: string[]) => {
      setIndustries(v);
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
    setPersonas([...(team.personas ?? [])]);
    setIndustries([...(team.industries ?? [])]);
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

  /**
   * Materialise the board's current effective list for `ticketTypeId` before
   * the user mutates it. Returns the complete, ordered list — drawing from
   * any pre-FEAT-171 legacy "extras only" entry, the template's defaults,
   * and the new "complete snapshot" shape transparently via
   * resolveBoardFieldList.
   *
   * The first write on a legacy entry therefore upgrades it to a complete
   * board-owned snapshot in one step. After that the board owns the list
   * and template edits no longer flow through; "Sync to template" is the
   * only path back.
   */
  const snapshotIfNeeded = (ticketTypeId: string, prev: Record<string, string[]>): string[] => {
    const tt = config.ticketTypes.find((t) => t.id === ticketTypeId);
    return resolveBoardFieldList(tt, prev);
  };

  const handleAddField = (ticketTypeId: string, fieldId: string) => {
    markDirty();
    setAddedFields((prev) => {
      const current = snapshotIfNeeded(ticketTypeId, prev);
      if (current.includes(fieldId)) return { ...prev, [ticketTypeId]: current };
      return { ...prev, [ticketTypeId]: [...current, fieldId] };
    });
  };

  const handleRemoveAddedField = (ticketTypeId: string, fieldId: string) => {
    markDirty();
    setAddedFields((prev) => {
      const current = snapshotIfNeeded(ticketTypeId, prev);
      return { ...prev, [ticketTypeId]: current.filter((id) => id !== fieldId) };
    });
  };

  /**
   * Reorder the board's per-type field list. The list itself IS the order —
   * no separate `order` overrides needed since the board now owns its own
   * snapshot. Hidden fields (title, description, watchers) keep their data
   * positions; only the visible fields are reshuffled.
   */
  const handleMoveField = (ticketTypeId: string, fromIdx: number, toIdx: number) => {
    markDirty();
    const HIDDEN = new Set(['field-name', 'field-description', 'field-watchers']);

    setAddedFields((prev) => {
      const current = snapshotIfNeeded(ticketTypeId, prev);
      const visibleIds = current.filter((id) => !HIDDEN.has(id));

      if (fromIdx < 0 || fromIdx >= visibleIds.length) return prev;
      const clampedTo = Math.max(0, Math.min(toIdx, visibleIds.length - 1));
      if (fromIdx === clampedTo) return { ...prev, [ticketTypeId]: current };
      const [moved] = visibleIds.splice(fromIdx, 1);
      visibleIds.splice(clampedTo, 0, moved);

      // Reconstruct: hidden fields keep their positions in the original list,
      // visible slots get the newly ordered ids in sequence.
      let cursor = 0;
      const next = current.map((id) => (HIDDEN.has(id) ? id : (visibleIds[cursor++] ?? id)));
      return { ...prev, [ticketTypeId]: next };
    });
  };

  /**
   * Replace the board's snapshot for a ticket type with the template's
   * current defaultFields. Manual opt-in to template changes — the only
   * channel by which template updates reach the board after the first edit.
   *
   * Per-field overrides (label, options, conditions, required) are kept so
   * any earlier customisation survives — except for `visible=false`, which
   * would otherwise hide fields that the template now includes. Sync's
   * intent is "make this look like the template", so we clear those
   * hide-overrides for fields in the new list. Stale `order` overrides on
   * the same fields are also cleared so the template's order wins.
   */
  const handleSyncToTemplate = (ticketTypeId: string) => {
    markDirty();
    const tt = config.ticketTypes.find((t) => t.id === ticketTypeId);
    if (!tt) return;
    const newDefaults = [...(tt.defaultFields ?? [])];
    setAddedFields((prev) => ({ ...prev, [ticketTypeId]: newDefaults }));
    setFieldOverrides((prev) => {
      const next = { ...prev };
      const inNew = new Set(newDefaults);
      for (const fId of Object.keys(next)) {
        if (!inNew.has(fId)) continue;
        const cur = next[fId];
        if (cur.visible === false || typeof cur.order === 'number') {
          const cleaned: typeof cur = { ...cur, visible: true };
          if ('order' in cleaned) delete (cleaned as Record<string, unknown>).order;
          next[fId] = cleaned;
        }
      }
      return next;
    });
  };

  /**
   * Persist a brand-new global field directly from the board settings flow,
   * matching the CRM Customer Record Layout pattern. The created field is
   * appended to `addedFields` for this ticket type so it shows up immediately
   * on this board without affecting other boards. Duplicate-name detection on
   * the server returns 409 — we surface the confirm dialog (Use existing /
   * Create anyway), reusing the same UX as Global Settings.
   */
  const handleCreateField = useCallback(
    async (payload: {
      name: string;
      fieldType: FieldType;
      category: FieldCategory;
      options?: string[];
    }): Promise<string> => {
      const persist = async (force: boolean): Promise<FieldDefinition> => {
        return OpsService.createField(numaPost, payload, { force });
      };
      let created: FieldDefinition;
      try {
        created = await persist(false);
      } catch (err) {
        const e = err as {
          response?: {
            status?: number;
            data?: { error?: string; existing?: { id: string; name: string; isSystem?: boolean } };
          };
        };
        if (e.response?.status === 409 && e.response.data?.error === 'duplicate-name' && e.response.data.existing) {
          const existing = e.response.data.existing;
          const shouldForce = await showConfirm({
            title: t('globalSettings.duplicateFieldTitle', 'Field already exists'),
            message: t('globalSettings.duplicateFieldPrompt', {
              name: existing.name,
              defaultValue: 'A field called "{{name}}" already exists. Use existing, or create a parallel duplicate?',
            }),
            confirmLabel: t('globalSettings.duplicateCreateAnyway', 'Create anyway'),
            cancelLabel: t('globalSettings.duplicateUseExisting', 'Use existing'),
            variant: 'warning',
          });
          if (!shouldForce) {
            // Use existing — attach the matched field to this board's added
            // fields rather than persisting another duplicate.
            await refreshConfig();
            return existing.id;
          }
          created = await persist(true);
        } else {
          throw err;
        }
      }
      // Pull the new field into config.fields so the editor renders it.
      await refreshConfig();
      return created.id;
    },
    [numaPost, refreshConfig, showConfirm, t]
  );

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
        personas,
        industries,
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
    personas,
    industries,
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
        setError(t('boards.deleteBoardHasTickets'));
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
      <Modal show={show} onHide={onHide} size="xl" fullscreen="lg-down" centered scrollable>
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
                  personas={personas}
                  setPersonas={setPersonasDirty}
                  industries={industries}
                  setIndustries={setIndustriesDirty}
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
                  onMoveField={handleMoveField}
                  onCreateField={handleCreateField}
                  onSyncToTemplate={handleSyncToTemplate}
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
                      allowSelectAll
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
              {t('boards.deleteBoard')}
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
        title={t('boards.deleteBoard')}
        message={t('boards.deleteBoardConfirm', { name: team?.name ?? '' })}
        confirmLabel={t('boards.deleteBoard')}
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
