import React from 'react';
import Badge from 'react-bootstrap/Badge';
import { useTranslation } from 'react-i18next';
import type { Status } from '../../../types/ops';
import { getStatusTypeColor, getContrastTextColor } from './colorUtils';

interface StatusBadgeProps {
  statusId: string;
  statuses: Status[];
}

/**
 * Renders a colored pill badge for a given status.
 * Looks up the status by ID, applies the status-type color as background,
 * and shows an optional icon plus the status name.
 */
export function StatusBadge({ statusId, statuses }: StatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const status = statuses.find((s) => s.id === statusId);

  if (!status) {
    return (
      <Badge pill style={{ backgroundColor: '#6c757d', color: '#fff' }}>
        {t('errors.notFound')}
      </Badge>
    );
  }

  const bgColor = getStatusTypeColor(status.type);
  const textColor = getContrastTextColor(bgColor);

  return (
    <Badge pill style={{ backgroundColor: bgColor, color: textColor }}>
      {status.icon && <i className={`bi bi-${status.icon} me-1`} />}
      {status.name}
    </Badge>
  );
}
