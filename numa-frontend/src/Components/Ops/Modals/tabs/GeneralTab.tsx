/* eslint-disable i18next/no-literal-string */
import React, { useMemo } from 'react';
import { Form, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { BOARD_COLORS } from '../../Shared/colorUtils';
import { StaffAvatar } from '../../Shared/StaffAvatar';
import type { WorkZone, WorkStage, WorkUnitSeriesConfig, StaffProfile } from '../../../../types/ops';

interface GeneralTabProps {
  name: string;
  setName: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  workUnitSeries: WorkUnitSeriesConfig;
  onWorkUnitSeriesChange: (wus: WorkUnitSeriesConfig) => void;
  defaultZoneId: string;
  setDefaultZoneId: (v: string) => void;
  defaultStageId: string;
  setDefaultStageId: (v: string) => void;
  zones: Partial<WorkZone>[];
  stages: Partial<WorkStage>[];
  createdBy?: string;
  staff?: StaffProfile[];
}

export function GeneralTab({
  name,
  setName,
  color,
  setColor,
  workUnitSeries,
  onWorkUnitSeriesChange,
  defaultZoneId,
  setDefaultZoneId,
  defaultStageId,
  setDefaultStageId,
  zones,
  stages,
  createdBy,
  staff,
}: GeneralTabProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  const owner = useMemo(
    () => (createdBy && staff ? staff.find((s) => s.id === createdBy) : undefined),
    [createdBy, staff]
  );

  const wuEnabled = Boolean(workUnitSeries?.enabled);
  const wuLabel = workUnitSeries?.label ?? 'Sprint';
  const wuPatternStart = workUnitSeries?.patternStart ?? 1;

  const sortedZones = [...zones].filter((z) => z.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const defaultZoneStages = defaultZoneId
    ? stages.filter((s) => s.zoneId === defaultZoneId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  const handleWuToggle = (enabled: boolean) => {
    if (enabled) {
      onWorkUnitSeriesChange({
        enabled: true,
        label: wuLabel || 'Sprint',
        labelPlural: `${wuLabel || 'Sprint'}s`,
        patternType: 'sequential',
        patternStart: wuPatternStart,
        allowOverlap: false,
      });
    } else {
      onWorkUnitSeriesChange(null);
    }
  };

  const handleWuLabelChange = (label: string) => {
    if (!workUnitSeries) return;
    onWorkUnitSeriesChange({
      ...workUnitSeries,
      label,
      labelPlural: `${label}s`,
    });
  };

  const handleWuStartChange = (start: number) => {
    if (!workUnitSeries) return;
    onWorkUnitSeriesChange({ ...workUnitSeries, patternStart: start });
  };

  return (
    <>
      {/* Team owner */}
      {owner && (
        <div className="d-flex align-items-center gap-2 mb-3 p-2 bg-light rounded">
          <StaffAvatar staff={owner} size={28} />
          <div>
            <div className="small text-muted">{t('teams.owner')}</div>
            <div style={{ fontSize: '0.85rem' }}>{owner.name || owner.email}</div>
          </div>
        </div>
      )}

      {/* Team name & color */}
      <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
        <h6 className="fw-bold text-dark mb-3">Basic Information</h6>
        <Form.Group className="mb-3">
          <Form.Label className="small fw-medium text-muted">{t('teams.name')}</Form.Label>
          <Form.Control type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Group>

        <Form.Group>
          <Form.Label className="small fw-medium text-muted">{t('teams.color')}</Form.Label>
          <div className="d-flex flex-wrap gap-2">
            {BOARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="border-0 p-0 d-flex align-items-center justify-content-center"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: c,
                  cursor: 'pointer',
                  outline: color === c ? '3px solid #333' : 'none',
                  outlineOffset: 2,
                }}
              >
                {color === c && <i className="bi bi-check-lg" style={{ color: '#fff', fontSize: 16 }} />}
              </button>
            ))}
          </div>
        </Form.Group>
      </div>

      {/* Work Units */}
      <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
        <h6 className="fw-bold text-dark mb-1">{t('settings.workUnitsToggle')}</h6>
        <p className="text-muted small mb-3">{t('settings.workUnitsHelp')}</p>

        <Form.Check
          type="switch"
          id="enable-work-units"
          label={t('settings.enableWorkUnits')}
          className="mb-3 fw-medium"
          checked={wuEnabled}
          onChange={(e) => handleWuToggle(e.target.checked)}
        />

        {wuEnabled && (
          <div className="bg-light p-3 rounded border">
            <Row>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label className="small fw-medium text-muted">{t('settings.workUnitLabel')}</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    value={wuLabel}
                    onChange={(e) => handleWuLabelChange(e.target.value)}
                    placeholder={t('settings.workUnitLabelPlaceholder')}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label className="small fw-medium text-muted">{t('settings.workUnitStartNumber')}</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    min={1}
                    value={wuPatternStart}
                    onChange={(e) => handleWuStartChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    style={{ maxWidth: 120 }}
                  />
                </Form.Group>
              </Col>
            </Row>
          </div>
        )}
      </div>

      {/* Default Location */}
      {sortedZones.length > 0 && (
        <div className="border rounded-3 p-3 bg-white mb-4 shadow-sm">
          <h6 className="fw-bold text-dark mb-1">{t('settings.defaultLocation')}</h6>
          <p className="text-muted small mb-3">{t('settings.defaultLocationHelp')}</p>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label className="small fw-medium text-muted">{t('settings.defaultZone')}</Form.Label>
                <Form.Select
                  size="sm"
                  value={defaultZoneId}
                  onChange={(e) => {
                    setDefaultZoneId(e.target.value);
                    setDefaultStageId('');
                  }}
                >
                  <option value="">{t('zones.selectZone')}</option>
                  {sortedZones.map((z) => (
                    <option key={z.id} value={z.id!}>
                      {z.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label className="small fw-medium text-muted">{t('settings.defaultStage')}</Form.Label>
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
      )}
    </>
  );
}
