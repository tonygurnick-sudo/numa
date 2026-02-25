import React, { useState, useMemo, useCallback } from 'react';
import { Form, Button, Badge, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkZone, WorkStage, ZoneType, StatusType, Ticket } from '../../../../types/ops';
import { ZONE_STATUS_TYPES, ZONE_TYPE_BADGE_COLORS } from '../../../../constants/opsConstants';

interface WorkflowTabProps {
  zones: Partial<WorkZone>[];
  setZones: React.Dispatch<React.SetStateAction<Partial<WorkZone>[]>>;
  stages: Partial<WorkStage>[];
  setStages: React.Dispatch<React.SetStateAction<Partial<WorkStage>[]>>;
  tickets: Ticket[];
  teamId?: string;
  defaultZoneId: string;
  setDefaultZoneId: (v: string) => void;
  defaultStageId: string;
  setDefaultStageId: (v: string) => void;
}

export function WorkflowTab({
  zones,
  setZones,
  stages,
  setStages,
  tickets,
  teamId,
  defaultZoneId,
  setDefaultZoneId,
  defaultStageId,
  setDefaultStageId,
}: WorkflowTabProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [newStageByZone, setNewStageByZone] = useState<Record<string, { name: string; statusType: string }>>({});
  const [newZoneType, setNewZoneType] = useState<ZoneType>('board');
  const [newZoneName, setNewZoneName] = useState('');

  const sortedZones = useMemo(() => [...zones].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [zones]);

  const getStagesForZone = useCallback(
    (zoneId: string | undefined) => {
      if (!zoneId) return [];
      return stages.filter((s) => s.zoneId === zoneId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    [stages],
  );

  // Get allowed statusType values for a given zone type
  const getAllowedStatusTypes = useCallback((zoneType: ZoneType | undefined): StatusType[] => {
    if (!zoneType) return Object.values(ZONE_STATUS_TYPES).flat();
    return ZONE_STATUS_TYPES[zoneType] ?? [];
  }, []);

  // ── Zone handlers ─────────────────────────────────────────────────
  const handleZoneNameChange = (index: number, value: string) => {
    setZones((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], name: value };
      return updated;
    });
  };

  const handleAddZone = () => {
    const trimmedName = newZoneName.trim();
    if (!trimmedName) return;
    const maxOrder = zones.reduce((max, z) => Math.max(max, z.order ?? 0), 0);
    const zoneId = crypto.randomUUID();
    const newZone: Partial<WorkZone> = {
      id: zoneId,
      name: trimmedName,
      zoneType: newZoneType,
      order: maxOrder + 1000,
      teamId,
    };
    setZones((prev) => [...prev, newZone]);

    // Auto-create a default stage for the new zone
    const defaultStage: Partial<WorkStage> = {
      name: newZoneType === 'backlog' ? 'Backlog' : 'To Do',
      statusType: newZoneType === 'backlog' ? 'backlog' : 'queued',
      zoneId,
      order: 1000,
      teamId,
    };
    setStages((prev) => [...prev, defaultStage]);

    setNewZoneName('');
    setNewZoneType('board');
  };

  const handleZoneTypeChange = (index: number, value: ZoneType) => {
    setZones((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], zoneType: value };
      return updated;
    });
  };

  const handleDeleteZone = (zoneId: string) => {
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
    setStages((prev) => prev.filter((s) => s.zoneId !== zoneId));
    // Clear default zone/stage if they were in the deleted zone
    if (defaultZoneId === zoneId) {
      setDefaultZoneId('');
      setDefaultStageId('');
    }
  };

  // ── Stage handlers ──────────────────────────────────────────────────
  const handleStageNameChange = (zoneId: string, stageIndex: number, value: string) => {
    const zoneStages = getStagesForZone(zoneId);
    const stage = zoneStages[stageIndex];
    setStages((prev) => prev.map((s) => (s === stage ? { ...s, name: value } : s)));
  };

  const handleStageStatusTypeChange = (zoneId: string, stageIndex: number, statusType: StatusType) => {
    const zoneStages = getStagesForZone(zoneId);
    const stage = zoneStages[stageIndex];
    setStages((prev) => prev.map((s) => (s === stage ? { ...s, statusType } : s)));
  };

  const handleStageMoveInZone = (zoneId: string, stageIndex: number, direction: 'up' | 'down') => {
    const zoneStages = getStagesForZone(zoneId);
    const swapIdx = direction === 'up' ? stageIndex - 1 : stageIndex + 1;
    if (swapIdx < 0 || swapIdx >= zoneStages.length) return;
    const a = zoneStages[stageIndex];
    const b = zoneStages[swapIdx];
    setStages((prev) =>
      prev.map((s) => {
        if (s === a) return { ...s, order: b.order };
        if (s === b) return { ...s, order: a.order };
        return s;
      }),
    );
  };

  const handleRemoveStageFromZone = (zoneId: string, stageIndex: number) => {
    const zoneStages = getStagesForZone(zoneId);
    const stage = zoneStages[stageIndex];
    setStages((prev) => prev.filter((s) => s !== stage));
  };

  const handleAddStageToZone = (zoneId: string) => {
    const newStage = newStageByZone[zoneId];
    if (!newStage?.name.trim() || !newStage.statusType) return;
    const zoneStages = getStagesForZone(zoneId);
    const maxOrder = zoneStages.reduce((max, s) => Math.max(max, s.order ?? 0), 0);
    setStages((prev) => [
      ...prev,
      {
        name: newStage.name.trim(),
        statusType: newStage.statusType as StatusType,
        zoneId,
        order: maxOrder + 1000,
        teamId,
      },
    ]);
    setNewStageByZone((prev) => ({ ...prev, [zoneId]: { name: '', statusType: '' } }));
  };

  const handleNewStageChange = (zoneId: string, field: 'name' | 'statusType', value: string) => {
    setNewStageByZone((prev) => ({
      ...prev,
      [zoneId]: { ...(prev[zoneId] ?? { name: '', statusType: '' }), [field]: value },
    }));
  };

  // ── Editing zone detail ──────────────────────────────────────────────
  const editingZone = editingZoneId ? (zones.find((z) => z.id === editingZoneId) ?? null) : null;
  const editingZoneIdx = editingZone ? zones.indexOf(editingZone) : -1;
  const editingZoneStages = editingZoneId ? getStagesForZone(editingZoneId) : [];
  const editingNewStage = editingZoneId
    ? (newStageByZone[editingZoneId] ?? { name: '', statusType: '' })
    : { name: '', statusType: '' };
  const editingZoneAllowedTypes = getAllowedStatusTypes(editingZone?.zoneType);

  // ── Ticket counts per zone ──────────────────────────────────────────
  const zoneTicketCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of tickets) {
      counts.set(ticket.zoneId, (counts.get(ticket.zoneId) ?? 0) + 1);
    }
    return counts;
  }, [tickets]);

  // ── Default zone stages for the location picker ────────────────────
  const defaultZoneStages = useMemo(() => {
    if (!defaultZoneId) return [];
    return getStagesForZone(defaultZoneId);
  }, [defaultZoneId, getStagesForZone]);

  // ════════════════════════════════════════════════════════════════════
  // Zone Edit Detail View
  // ════════════════════════════════════════════════════════════════════
  if (editingZone && editingZoneId) {
    return (
      <div className="border rounded-3 p-4 bg-white mb-4 shadow-sm">
        <button
          type="button"
          className="btn btn-link text-decoration-none p-0 mb-4 text-muted d-flex align-items-center"
          onClick={() => setEditingZoneId(null)}
        >
          <i className="bi bi-arrow-left me-2" />
          <span className="fw-medium">{t('settings.workZones')}</span>
        </button>

        <h5 className="fw-bold mb-4 text-dark">{t('settings.editWorkZone')}</h5>

        <div className="bg-light p-3 rounded border mb-4">
          <Row>
            <Col md={6}>
              {/* Zone name (editable) */}
              <Form.Group>
                <Form.Label className="small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>
                  {t('settings.zoneName')} *
                </Form.Label>
                <Form.Control
                  type="text"
                  value={editingZone.name ?? ''}
                  onChange={(e) => handleZoneNameChange(editingZoneIdx, e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              {/* Zone type */}
              <Form.Group>
                <Form.Label className="small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>
                  {t('settings.zoneType')}
                </Form.Label>
                <Form.Select
                  size="sm"
                  value={editingZone.zoneType ?? 'standard'}
                  onChange={(e) => handleZoneTypeChange(editingZoneIdx, e.target.value as ZoneType)}
                  style={{ height: '38px' }}
                >
                  {(Object.keys(ZONE_STATUS_TYPES) as ZoneType[]).map((zt) => (
                    <option key={zt} value={zt}>
                      {t(`zones.type_${zt}`)}
                    </option>
                  ))}
                </Form.Select>
                <small className="text-muted d-block mt-2">
                  {t(`settings.zoneTypeDesc_${editingZone.zoneType ?? 'standard'}`)}
                </small>
              </Form.Group>
            </Col>
          </Row>
        </div>

        <div className="border-top pt-4 mt-2">
          <h6 className="fw-bold mb-1 text-dark">{t('settings.workStages')}</h6>
          <p className="text-muted small mb-3">{t('settings.workStagesHelp')}</p>

          {editingZoneStages.length > 0 && (
            <div className="d-flex align-items-center gap-2 mb-2 px-1">
              <div style={{ width: 20 }} />
              <small className="text-muted fw-bold" style={{ flex: 1, maxWidth: 280 }}>
                {t('settings.stageName')}
              </small>
              <small className="text-muted fw-bold" style={{ width: 160 }}>
                {t('settings.statusCategory')}
              </small>
              <small className="text-muted fw-bold" style={{ width: 120 }}>
                {t('common.actions')}
              </small>
            </div>
          )}

          {editingZoneStages.map((stage, idx) => (
            <div key={stage.id ?? `stage-${idx}`} className="d-flex align-items-center gap-2 mb-2">
              <i className="bi bi-grip-vertical text-muted" />
              <Form.Control
                type="text"
                size="sm"
                value={stage.name ?? ''}
                onChange={(e) => handleStageNameChange(editingZoneId, idx, e.target.value)}
                style={{ flex: 1, maxWidth: 280 }}
              />
              <Form.Select
                size="sm"
                value={stage.statusType ?? ''}
                onChange={(e) => handleStageStatusTypeChange(editingZoneId, idx, e.target.value as StatusType)}
                style={{ maxWidth: 160 }}
              >
                <option value="">{t('common.selectOption')}</option>
                {editingZoneAllowedTypes.map((st) => (
                  <option key={st} value={st}>
                    {t(`globalSettings.statusTypes.${st}`)}
                  </option>
                ))}
              </Form.Select>
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={idx === 0}
                onClick={() => handleStageMoveInZone(editingZoneId, idx, 'up')}
              >
                <i className="bi bi-arrow-up" />
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={idx === editingZoneStages.length - 1}
                onClick={() => handleStageMoveInZone(editingZoneId, idx, 'down')}
              >
                <i className="bi bi-arrow-down" />
              </Button>
              <Button variant="outline-danger" size="sm" onClick={() => handleRemoveStageFromZone(editingZoneId, idx)}>
                <i className="bi bi-trash" />
              </Button>
            </div>
          ))}

          {editingZoneStages.length === 0 && (
            <span className="text-muted small fst-italic">{t('settings.noStages')}</span>
          )}

          {/* Add stage row */}
          <div className="d-flex align-items-center gap-2 mt-2 pt-2 border-top">
            <i className="bi bi-plus text-muted" />
            <Form.Control
              type="text"
              size="sm"
              placeholder={t('settings.addStage')}
              value={editingNewStage.name}
              onChange={(e) => handleNewStageChange(editingZoneId, 'name', e.target.value)}
              style={{ flex: 1, maxWidth: 280 }}
            />
            <Form.Select
              size="sm"
              value={editingNewStage.statusType}
              onChange={(e) => handleNewStageChange(editingZoneId, 'statusType', e.target.value)}
              style={{ maxWidth: 160 }}
            >
              <option value="">{t('settings.statusCategory')}</option>
              {editingZoneAllowedTypes.map((st) => (
                <option key={st} value={st}>
                  {t(`globalSettings.statusTypes.${st}`)}
                </option>
              ))}
            </Form.Select>
            <Button
              variant="outline-primary"
              size="sm"
              disabled={!editingNewStage.name.trim() || !editingNewStage.statusType}
              onClick={() => handleAddStageToZone(editingZoneId)}
            >
              {t('common.add')}
            </Button>
          </div>
        </div>
        <p className="text-muted small mt-4 pt-3 border-top fst-italic">
          <i className="bi bi-lightbulb text-warning me-2" />
          {t('settings.stageStatusTip')}
        </p>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // Zone List View — configurable zones (add/remove/edit)
  // ════════════════════════════════════════════════════════════════════
  return (
    <div className="d-flex flex-column gap-4">
      {/* Info banner */}
      <div className="alert bg-primary bg-opacity-10 border-primary border-opacity-25 text-primary small mb-0 rounded-3 shadow-sm d-flex gap-3 align-items-start p-3">
        <i className="bi bi-info-circle fs-5 mt-1" />
        <div>
          <div className="fw-medium mb-1">{t('settings.fixedZonesInfo')}</div>
          <div className="opacity-75">{t('settings.zoneTypeHelp')}</div>
        </div>
      </div>

      <div className="border rounded-3 p-4 bg-white shadow-sm">
        <div className="d-flex align-items-center justify-content-between mb-4">
          <div>
            <h5 className="fw-bold mb-1 text-dark">{t('settings.workZones')}</h5>
            <p className="text-muted small mb-0">{t('settings.workZonesHelp')}</p>
          </div>
        </div>

        <div className="d-flex flex-column gap-3 mb-4">
          {sortedZones.map((zone) => {
            const zoneStages = getStagesForZone(zone.id);
            const ticketCount = zone.id ? (zoneTicketCounts.get(zone.id) ?? 0) : 0;
            const isDefault = zone.id === defaultZoneId;
            const canDelete = zones.length > 1 && ticketCount === 0;

            return (
              <div key={zone.id ?? `zone-${zone.zoneType}`} className="card mb-2">
                <div className="card-body py-2 px-3">
                  <div className="d-flex align-items-center gap-2">
                    <span className="fw-semibold">{zone.name}</span>
                    <Badge bg={ZONE_TYPE_BADGE_COLORS[zone.zoneType!] ?? 'secondary'} style={{ fontSize: '0.65rem' }}>
                      {t(`zones.type_${zone.zoneType}`)}
                    </Badge>
                    {isDefault && (
                      <Badge bg="info" style={{ fontSize: '0.65rem' }}>
                        {t('settings.defaultLocationSection')}
                      </Badge>
                    )}
                    {ticketCount > 0 && (
                      <Badge bg="light" text="dark" style={{ fontSize: '0.65rem' }}>
                        {t('tickets.count', { count: ticketCount })}
                      </Badge>
                    )}
                    <div className="ms-auto d-flex align-items-center gap-1">
                      {zone.id && (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-muted"
                          onClick={() => setEditingZoneId(zone.id!)}
                        >
                          <i className="bi bi-pencil" />
                        </Button>
                      )}
                      {zone.id && (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-danger"
                          disabled={!canDelete}
                          title={
                            !canDelete
                              ? zones.length <= 1
                                ? t('settings.cannotDeleteLastZone')
                                : t('settings.cannotDeleteZoneWithTickets')
                              : t('settings.deleteZone')
                          }
                          onClick={() => zone.id && handleDeleteZone(zone.id)}
                        >
                          <i className="bi bi-trash" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Stage flow preview */}
                  {zoneStages.length > 0 && (
                    <div className="d-flex align-items-center gap-1 mt-1 flex-wrap">
                      <small className="text-muted">{t('settings.stages')}:</small>
                      {zoneStages.map((s, i) => (
                        <React.Fragment key={s.id ?? `s-${i}`}>
                          {i > 0 && <small className="text-muted">&rarr;</small>}
                          <small>{s.name}</small>
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Zone */}
        <div className="bg-light rounded-3 p-3 border mt-2">
          <div className="d-flex align-items-center gap-3">
            <Form.Group className="flex-grow-1" style={{ maxWidth: 250 }}>
              <Form.Label className="small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.5px' }}>
                {t('settings.zoneName')}
              </Form.Label>
              <Form.Control
                type="text"
                size="sm"
                placeholder={t('settings.newZoneNamePlaceholder')}
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddZone();
                  }
                }}
              />
            </Form.Group>
            <Form.Group style={{ width: 140 }}>
              <Form.Label className="small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.5px' }}>
                {t('settings.zoneType')}
              </Form.Label>
              <Form.Select size="sm" value={newZoneType} onChange={(e) => setNewZoneType(e.target.value as ZoneType)}>
                {(Object.keys(ZONE_STATUS_TYPES) as ZoneType[]).map((zt) => (
                  <option key={zt} value={zt}>
                    {t(`zones.type_${zt}`)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <div className="d-flex align-items-end mb-1" style={{ height: 50 }}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddZone}
                disabled={!newZoneName.trim()}
                className="d-flex align-items-center gap-2"
              >
                <i className="bi bi-plus" />
                {t('settings.addZone')}
              </Button>
            </div>
          </div>
          <div className="text-muted small mt-2 d-flex align-items-center gap-2 opacity-75">
            <i className="bi bi-info-circle" />
            <span>
              {t(`settings.zoneTypeDesc_${newZoneType}`)}
              {' — '}
              {t('settings.addZoneStagesHint')}
            </span>
          </div>
        </div>
      </div>

      {/* Default Location for New Tickets */}
      <div className="border rounded-3 p-4 bg-white shadow-sm mb-4">
        <h6 className="fw-bold mb-1">{t('settings.defaultLocation')}</h6>
        <p className="text-muted small mb-2">{t('settings.defaultLocationHelp')}</p>
        <Row>
          <Col md={6}>
            <Form.Group className="mb-2">
              <Form.Label className="small">{t('settings.defaultZone')}</Form.Label>
              <Form.Select
                size="sm"
                value={defaultZoneId}
                onChange={(e) => {
                  setDefaultZoneId(e.target.value);
                  setDefaultStageId('');
                }}
              >
                <option value="">{t('zones.selectZone')}</option>
                {sortedZones
                  .filter((z) => z.id)
                  .map((z) => (
                    <option key={z.id} value={z.id!}>
                      {z.name}
                    </option>
                  ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-2">
              <Form.Label className="small">{t('settings.defaultStage')}</Form.Label>
              <Form.Select
                size="sm"
                value={defaultStageId}
                onChange={(e) => setDefaultStageId(e.target.value)}
                disabled={defaultZoneStages.length === 0}
              >
                <option value="">{t('zones.selectStage')}</option>
                {defaultZoneStages.map((s) => (
                  <option key={s.id} value={s.id!}>
                    {s.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
      </div>
    </div>
  );
}
