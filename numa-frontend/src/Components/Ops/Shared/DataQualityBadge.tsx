import React from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { DataQualityResult } from './dataQuality';

interface DataQualityBadgeProps {
  result: DataQualityResult;
  /** Tooltip placement override. Defaults to top. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Small inline badge that surfaces data-quality issues — a triangle icon
 * tinted red for missing required fields, amber for overdue. Hover shows the
 * list of issues. Renders nothing when the result is ok.
 */
export function DataQualityBadge({ result, placement = 'top' }: DataQualityBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation('ops');
  if (result.severity === 'ok') return null;

  const colour = result.severity === 'error' ? '#dc3545' : '#f59e0b';
  const tooltip = (
    <Tooltip id="data-quality-tooltip">
      <div className="text-start small">
        <div className="fw-bold mb-1">{t('dataQuality.issuesTitle', 'Data quality issues')}</div>
        <ul className="mb-0 ps-3">
          {result.issues.map((issue, idx) => (
            <li key={`${issue.fieldId}-${String(idx)}`}>
              {issue.reason === 'missing-required'
                ? t('dataQuality.missingRequired', { field: issue.fieldName, defaultValue: '{{field}} is required' })
                : t('dataQuality.overdue', { field: issue.fieldName, defaultValue: '{{field}} is past' })}
            </li>
          ))}
        </ul>
      </div>
    </Tooltip>
  );

  return (
    <OverlayTrigger placement={placement} overlay={tooltip}>
      <i
        className="bi bi-exclamation-triangle-fill"
        style={{ color: colour, fontSize: '0.85rem' }}
        aria-label={t('dataQuality.issuesTitle', 'Data quality issues')}
      />
    </OverlayTrigger>
  );
}
