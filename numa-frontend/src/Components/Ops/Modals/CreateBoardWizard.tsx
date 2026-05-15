import React, { useState, useMemo, useCallback } from 'react';
import { Modal, Button, Form, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { BOARD_COLORS } from '../Shared/colorUtils';
import {
  BOARD_PRESETS,
  ZONE_STATUS_TYPES,
  ZONE_TYPE_BADGE_COLORS,
  getPreset,
  getTicketTypeIconClass,
  getDefaultFieldsForPrefix,
} from '../../../constants/opsConstants';
import type { PresetZone } from '../../../constants/opsConstants';
import { UserPicker } from '../../Inputs/UserPicker';
import type { Team, WorkUnitSeriesConfig, StatusType, AccessControlMode } from '../../../types/ops';

// ─── Props ───────────────────────────────────────────────────────────────────

interface CreateBoardWizardProps {
  show: boolean;
  onHide: () => void;
  onCreated: (team: Team) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

// ─── Component ───────────────────────────────────────────────────────────────

export function CreateBoardWizard({ show, onHide, onCreated }: CreateBoardWizardProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost } = useNumaRequest();
  const { config, refreshConfig } = useOps();

  // ── Step navigation ──────────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── Step 1: Name & Color ─────────────────────────────────────────────────
  const [boardName, setTeamName] = useState('');
  const [teamColor, setTeamColor] = useState(BOARD_COLORS[0]);
  const [presetId, setPresetId] = useState('standard');
  const [enableWorkUnits, setEnableWorkUnits] = useState(false);
  const [wuLabel, setWuLabel] = useState('Sprint');
  const [wuPatternStart, setWuPatternStart] = useState<number | string>(1);
  const [wuPatternType, setWuPatternType] = useState<'sequential' | 'months'>('sequential');

  // ── Step 2: Ticket Types ─────────────────────────────────────────────────
  const allTypeIds = useMemo(() => config?.ticketTypes.map((tt) => tt.id) ?? [], [config?.ticketTypes]);
  const [selectedTicketTypes, setSelectedTicketTypes] = useState<string[]>([]);
  const [customTicketTypes, setCustomTicketTypes] = useState<
    { tempId: string; name: string; prefix: string; icon: string; color: string }[]
  >([]);
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypePrefix, setNewTypePrefix] = useState('');

  // ── Step 3: Workflow Customization ───────────────────────────────────────
  const [customStages, setCustomStages] = useState<PresetZone[] | null>(null);
  const [newStageByZone, setNewStageByZone] = useState<Record<number, { name: string; statusType: StatusType | '' }>>(
    {}
  );

  // ── Step 4: Access Control ───────────────────────────────────────────────
  const [accessMode, setAccessMode] = useState<AccessControlMode>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // ── General state ────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Preset data ──────────────────────────────────────────────────────────
  const preset = useMemo(() => getPreset(presetId), [presetId]);
  const workflowZones = customStages ?? preset.zones;

  // ── Reset on open ────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (show) {
      setStep(1);
      setTeamName('');
      setTeamColor(BOARD_COLORS[0]);
      setPresetId('standard');
      setEnableWorkUnits(false);
      setWuLabel('Sprint');
      setWuPatternStart(1);
      setWuPatternType('sequential');
      setSelectedTicketTypes([]);
      setCustomTicketTypes([]);
      setShowAddType(false);
      setNewTypeName('');
      setNewTypePrefix('');
      setCustomStages(null);
      setNewStageByZone({});
      setAccessMode('all');
      setSelectedUserIds([]);
      setError(null);
    }
  }, [show, allTypeIds]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    try {
      setCreating(true);
      setError(null);

      let workUnitSeries: WorkUnitSeriesConfig = null;
      if (enableWorkUnits) {
        workUnitSeries = {
          enabled: true,
          label: wuLabel || 'Sprint',
          labelPlural: `${wuLabel || 'Sprint'}s`,
          patternType: wuPatternType,
          patternStart: wuPatternStart,
          allowOverlap: false,
        };
      }

      // Persist any custom ticket types to global config
      const typeIdMap: Record<string, string> = {};
      for (const ct of customTicketTypes) {
        const created = await OpsService.createTicketType(numaPost, {
          name: ct.name,
          prefix: ct.prefix,
          icon: ct.icon,
          color: ct.color,
          defaultFields: getDefaultFieldsForPrefix(ct.prefix),
        });
        typeIdMap[ct.tempId] = created.id;
      }

      // Remap selected ticket types: replace temp IDs with real IDs
      const resolvedTicketTypes = selectedTicketTypes.map((id) => typeIdMap[id] ?? id);

      const isAllSelected = selectedTicketTypes.length === config.ticketTypes.length + customTicketTypes.length;

      // Create the team
      const team = await OpsService.createBoard(numaPost, {
        name: boardName.trim(),
        color: teamColor,
        preset: presetId,
        customStages: customStages ?? undefined,
        workUnitSeries,
        allowedTicketTypes: isAllSelected
          ? undefined
          : resolvedTicketTypes.length > 0
            ? resolvedTicketTypes
            : undefined,
        accessControl: { mode: accessMode, users: accessMode === 'specific' ? selectedUserIds : [], owners: [] },
      });

      // Always refresh global config so newly created ticket types
      // (and the board's allowedTicketTypes) are immediately available
      // when the user opens the Create Ticket modal.
      await refreshConfig();

      onCreated(team);
    } catch (err) {
      setError(t('errors.saveFailed', { message: String(err) }));
    } finally {
      setCreating(false);
    }
  }, [
    boardName,
    teamColor,
    presetId,
    customStages,
    customTicketTypes,
    enableWorkUnits,
    wuLabel,
    wuPatternStart,
    selectedTicketTypes,
    allTypeIds,
    accessMode,
    selectedUserIds,
    numaPost,
    onCreated,
    refreshConfig,
    t,
  ]);

  const canProceed = (): boolean => {
    switch (step) {
      case 1:
        return boardName.trim().length > 0;
      case 2:
        return selectedTicketTypes.length > 0 || customTicketTypes.length > 0;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) setStep(step + 1);
    else handleSubmit();
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const stepTitle = (): string => {
    switch (step) {
      case 1:
        return t('boards.step1');
      case 2:
        return t('boards.step2');
      case 3:
        return t('boards.step3');
      case 4:
        return t('boards.step4');
      default:
        return '';
    }
  };

  // ── Custom type handlers ─────────────────────────────────────────────────
  const handleAddCustomType = () => {
    if (!newTypeName.trim() || !newTypePrefix.trim()) return;
    const tempId = `custom-${Date.now()}`;
    setCustomTicketTypes((prev) => [
      ...prev,
      {
        tempId,
        name: newTypeName.trim(),
        prefix: newTypePrefix.trim().toUpperCase(),
        icon: 'clipboard',
        color: '#6c757d',
      },
    ]);
    setSelectedTicketTypes((prev) => [...prev, tempId]);
    setNewTypeName('');
    setNewTypePrefix('');
    setShowAddType(false);
  };

  // ── Workflow customization helpers ───────────────────────────────────────
  const handleRemoveStage = (zoneIdx: number, stageIdx: number) => {
    const zones = [...(customStages ?? preset.zones).map((z) => ({ ...z, stages: [...z.stages] }))];
    zones[zoneIdx].stages.splice(stageIdx, 1);
    setCustomStages(zones);
  };

  const handleRenameStage = (zoneIdx: number, stageIdx: number, newName: string) => {
    const zones = [...(customStages ?? preset.zones).map((z) => ({ ...z, stages: [...z.stages] }))];
    zones[zoneIdx].stages[stageIdx] = { ...zones[zoneIdx].stages[stageIdx], name: newName };
    setCustomStages(zones);
  };

  const handleAddStageToZone = (zoneIdx: number) => {
    const entry = newStageByZone[zoneIdx];
    if (!entry?.name.trim() || !entry.statusType) return;
    const zones = [...(customStages ?? preset.zones).map((z) => ({ ...z, stages: [...z.stages] }))];
    zones[zoneIdx].stages.push({ name: entry.name.trim(), statusType: entry.statusType as StatusType });
    setCustomStages(zones);
    setNewStageByZone((prev) => ({ ...prev, [zoneIdx]: { name: '', statusType: '' } }));
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (!config) return <></>;

  return (
    <Modal show={show} onHide={onHide} size="lg" fullscreen="lg-down" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title>{t('boards.create')}</Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ minHeight: 360 }}>
        {error && (
          <div className="alert alert-danger mb-3" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            {error}
          </div>
        )}

        {/* Step indicator */}
        <div className="d-flex justify-content-center mb-3 gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`badge rounded-pill ${i + 1 <= step ? 'bg-primary' : 'bg-secondary'}`}
              style={{ width: 28, height: 28, lineHeight: '20px', textAlign: 'center' }}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <h6 className="text-center text-muted mb-3">{stepTitle()}</h6>

        {/* ── Step 1: Name & Color ── */}
        {step === 1 && (
          <>
            <Form.Group className="mb-3">
              <Form.Label>{t('boards.name')}</Form.Label>
              <Form.Control type="text" value={boardName} onChange={(e) => setTeamName(e.target.value)} autoFocus />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{t('boards.color')}</Form.Label>
              <div className="d-flex align-items-center gap-3">
                <Form.Control
                  type="color"
                  value={teamColor}
                  onChange={(e) => setTeamColor(e.target.value)}
                  title={t('common.chooseColor', 'Choose your color')}
                  className="p-1"
                  style={{ width: '48px', height: '36px', cursor: 'pointer', borderRadius: '4px' }}
                />
                <Form.Control
                  type="text"
                  value={teamColor}
                  onChange={(e) => setTeamColor(e.target.value)}
                  placeholder="#000000"
                  style={{ maxWidth: '120px' }}
                />
              </div>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{t('boards.preset')}</Form.Label>
              <div className="d-flex flex-wrap gap-2">
                {BOARD_PRESETS.map((p) => (
                  <div
                    key={p.id}
                    className={`border rounded p-3 flex-grow-1 cursor-pointer ${presetId === p.id ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                    style={{ cursor: 'pointer', flexBasis: '48%', minWidth: '200px' }}
                    onClick={() => {
                      setPresetId(p.id);
                      setCustomStages(null);

                      // Auto-select ticket types based on prefixes
                      if (p.allowedTicketTypePrefixes && config.ticketTypes) {
                        const autoSelectedIds = config.ticketTypes
                          .filter((tt) => p.allowedTicketTypePrefixes?.includes(tt.prefix))
                          .map((tt) => tt.id);

                        const missingSuggestions = (p.suggestedTicketTypes || []).filter(
                          (st) => !config.ticketTypes.some((tt) => tt.prefix === st.prefix)
                        );

                        const newCustomTypes = missingSuggestions.map((st) => ({
                          tempId: `custom-${st.prefix}-${Date.now()}`,
                          name: st.name,
                          prefix: st.prefix,
                          icon: st.icon,
                          color: st.color,
                        }));

                        setCustomTicketTypes(newCustomTypes);
                        setSelectedTicketTypes([...autoSelectedIds, ...newCustomTypes.map((ct) => ct.tempId)]);
                      } else {
                        setCustomTicketTypes([]);
                        setSelectedTicketTypes([...allTypeIds]);
                      }

                      // Auto-configure work units based on preset
                      if (p.mode === 'development') {
                        setEnableWorkUnits(true);
                        setWuLabel('Sprint');
                        setWuPatternType('sequential');
                        setWuPatternStart(1);
                      } else if (p.mode === 'monthly') {
                        setEnableWorkUnits(true);
                        setWuLabel('Month');
                        setWuPatternType('months');
                        setWuPatternStart('january');
                      } else {
                        setEnableWorkUnits(false);
                      }
                    }}
                  >
                    <strong>{p.name}</strong>
                    <p className="text-muted small mb-0">{p.description}</p>
                  </div>
                ))}
              </div>
            </Form.Group>

            {['development', 'monthly', 'normal'].includes(preset.mode) && (
              <div className="border-top pt-3">
                <Form.Check
                  type="switch"
                  id="enable-work-units-wizard"
                  label={t('boards.enableWorkUnits')}
                  checked={enableWorkUnits}
                  onChange={(e) => setEnableWorkUnits(e.target.checked)}
                />
                <p className="text-muted small mb-3">{t('boards.enableWorkUnitsHelp')}</p>
                {enableWorkUnits && (
                  <div className="d-flex gap-3 ps-4">
                    <Form.Group>
                      <Form.Label>{t('boards.workUnitLabel')}</Form.Label>
                      <Form.Control size="sm" value={wuLabel} onChange={(e) => setWuLabel(e.target.value)} />
                    </Form.Group>
                    <Form.Group>
                      <Form.Label>{t('boards.patternStart')}</Form.Label>
                      {wuPatternType === 'sequential' ? (
                        <Form.Control
                          size="sm"
                          type="number"
                          min={1}
                          value={wuPatternStart as number}
                          onChange={(e) => setWuPatternStart(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          style={{ maxWidth: 100 }}
                        />
                      ) : (
                        <Form.Select
                          size="sm"
                          value={wuPatternStart as string}
                          onChange={(e) => setWuPatternStart(e.target.value)}
                          style={{ maxWidth: 150 }}
                        >
                          {[
                            'january',
                            'february',
                            'march',
                            'april',
                            'may',
                            'june',
                            'july',
                            'august',
                            'september',
                            'october',
                            'november',
                            'december',
                          ].map((m) => (
                            <option key={m} value={m}>
                              {m.charAt(0).toUpperCase() + m.slice(1)}
                            </option>
                          ))}
                        </Form.Select>
                      )}
                    </Form.Group>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Step 2: Ticket Types ── */}
        {step === 2 && (
          <>
            <p className="text-muted small mb-3">
              {t('boards.ticketTypesHelp', 'Please select the ticket types you want for this board.')}
            </p>

            {config.ticketTypes.map((tt) => (
              <Form.Check
                key={tt.id}
                type="checkbox"
                id={`tt-${tt.id}`}
                label={
                  <span className="d-flex align-items-center gap-2">
                    <i className={getTicketTypeIconClass(tt.icon)} style={{ color: tt.color }} />
                    {tt.name}
                    <Badge bg="secondary" className="ms-1">
                      {tt.prefix}
                    </Badge>
                  </span>
                }
                checked={selectedTicketTypes.includes(tt.id)}
                onChange={() =>
                  setSelectedTicketTypes((prev) =>
                    prev.includes(tt.id) ? prev.filter((id) => id !== tt.id) : [...prev, tt.id]
                  )
                }
                className="mb-2"
              />
            ))}

            {customTicketTypes.map((ct) => (
              <Form.Check
                key={ct.tempId}
                type="checkbox"
                id={`tt-${ct.tempId}`}
                label={
                  <span className="d-flex align-items-center gap-2">
                    <i className="bi bi-clipboard" />
                    {ct.name}
                    <Badge bg="info">{ct.prefix}</Badge>
                  </span>
                }
                checked={selectedTicketTypes.includes(ct.tempId)}
                onChange={() =>
                  setSelectedTicketTypes((prev) =>
                    prev.includes(ct.tempId) ? prev.filter((id) => id !== ct.tempId) : [...prev, ct.tempId]
                  )
                }
                className="mb-2"
              />
            ))}

            {showAddType ? (
              <div className="border rounded p-2 mt-2">
                <div className="d-flex gap-2 align-items-end">
                  <Form.Group className="flex-grow-1">
                    <Form.Control
                      size="sm"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      placeholder={t('boards.newTypeName')}
                    />
                  </Form.Group>
                  <Form.Group style={{ width: 120 }}>
                    <Form.Control
                      size="sm"
                      value={newTypePrefix}
                      onChange={(e) => setNewTypePrefix(e.target.value)}
                      placeholder={t('boards.newTypePrefix')}
                      maxLength={6}
                    />
                  </Form.Group>
                  <Button size="sm" variant="primary" onClick={handleAddCustomType}>
                    {t('common.add')}
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => setShowAddType(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline-secondary" size="sm" className="mt-2" onClick={() => setShowAddType(true)}>
                <i className="bi bi-plus me-1" />
                {t('boards.addCustomType')}
              </Button>
            )}
          </>
        )}

        {/* ── Step 3: Workflow Preview/Customization ── */}
        {step === 3 && (
          <>
            <p className="text-muted small mb-3">{t('boards.workflowPreviewHelp')}</p>

            {workflowZones.map((zone, zoneIdx) => (
              <div key={zoneIdx} className="border rounded mb-3">
                <div className="d-flex align-items-center gap-2 px-3 py-2 bg-light border-bottom">
                  <strong>{zone.name}</strong>
                  <Badge bg={ZONE_TYPE_BADGE_COLORS[zone.zoneType]}>{zone.zoneType}</Badge>
                </div>
                <div className="px-3 py-2">
                  {zone.stages.map((stage, stageIdx) => (
                    <div key={stageIdx} className="d-flex align-items-center gap-2 mb-1">
                      <Form.Control
                        size="sm"
                        value={stage.name}
                        onChange={(e) => handleRenameStage(zoneIdx, stageIdx, e.target.value)}
                        className="flex-grow-1"
                      />
                      <Badge bg="light" text="dark" className="border flex-shrink-0">
                        {stage.statusType}
                      </Badge>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-danger flex-shrink-0 p-0"
                        onClick={() => handleRemoveStage(zoneIdx, stageIdx)}
                      >
                        <i className="bi bi-x" />
                      </button>
                    </div>
                  ))}

                  {/* Add stage inline */}
                  <div className="d-flex gap-2 mt-2">
                    <Form.Control
                      size="sm"
                      placeholder={t('boards.newStageName')}
                      value={newStageByZone[zoneIdx]?.name ?? ''}
                      onChange={(e) =>
                        setNewStageByZone((prev) => ({
                          ...prev,
                          [zoneIdx]: {
                            ...prev[zoneIdx],
                            name: e.target.value,
                            statusType: prev[zoneIdx]?.statusType ?? '',
                          },
                        }))
                      }
                    />
                    <Form.Select
                      size="sm"
                      value={newStageByZone[zoneIdx]?.statusType ?? ''}
                      onChange={(e) =>
                        setNewStageByZone((prev) => ({
                          ...prev,
                          [zoneIdx]: {
                            ...prev[zoneIdx],
                            name: prev[zoneIdx]?.name ?? '',
                            statusType: e.target.value as StatusType,
                          },
                        }))
                      }
                      style={{ maxWidth: 140 }}
                    >
                      <option value="">Status...</option>
                      {ZONE_STATUS_TYPES[zone.zoneType].map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </Form.Select>
                    <Button
                      size="sm"
                      variant="outline-primary"
                      onClick={() => handleAddStageToZone(zoneIdx)}
                      disabled={!newStageByZone[zoneIdx]?.name?.trim() || !newStageByZone[zoneIdx]?.statusType}
                    >
                      <i className="bi bi-plus" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-muted small">{t('boards.workflowCustomiseLater')}</p>
          </>
        )}

        {/* ── Step 4: Access Control ── */}
        {step === 4 && (
          <>
            <p className="text-muted small mb-3">{t('boards.accessControlHelp')}</p>
            <Form.Check
              type="radio"
              id="access-all"
              name="access"
              label={t('boards.allUsers')}
              checked={accessMode === 'all'}
              onChange={() => setAccessMode('all')}
              className="mb-2"
            />
            <Form.Check
              type="radio"
              id="access-specific"
              name="access"
              label={t('boards.specificUsers')}
              checked={accessMode === 'specific'}
              onChange={() => setAccessMode('specific')}
              className="mb-3"
            />
            {accessMode === 'specific' && config.staff && (
              <div className="ps-4">
                <Form.Label className="small text-muted">{t('boards.selectMembers')}</Form.Label>
                <UserPicker
                  staff={config.staff}
                  selectedIds={selectedUserIds}
                  onChange={setSelectedUserIds}
                  mode="multi"
                  allowSelectAll
                />
              </div>
            )}
          </>
        )}
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        {step > 1 && (
          <Button variant="outline-secondary" onClick={handleBack}>
            {t('createWizard.back')}
          </Button>
        )}
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!canProceed() || creating} onClick={handleNext}>
          {creating ? t('tickets.creating') : step < TOTAL_STEPS ? t('createWizard.next') : t('createWizard.create')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
