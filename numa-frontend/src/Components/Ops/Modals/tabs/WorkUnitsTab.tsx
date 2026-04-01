import React from 'react';
import { Form, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkUnitSeriesConfig } from '../../../../types/ops';

interface WorkUnitsTabProps {
  workUnitSeries: WorkUnitSeriesConfig;
  onWorkUnitSeriesChange: (wus: WorkUnitSeriesConfig) => void;
}

export function WorkUnitsTab({ workUnitSeries, onWorkUnitSeriesChange }: WorkUnitsTabProps): React.JSX.Element {
  const { t } = useTranslation('ops');

  const wuEnabled = Boolean(workUnitSeries?.enabled);
  const wuLabel = workUnitSeries?.label ?? 'Sprint';
  const wuPatternStart = workUnitSeries?.patternStart ?? 1;

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
    </>
  );
}
