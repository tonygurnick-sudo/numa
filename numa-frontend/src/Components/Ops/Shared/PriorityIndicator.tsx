import React from 'react';
import type { TicketPriority } from '../../../types/ops';
import { getPriorityColor } from './colorUtils';

interface PriorityIndicatorProps {
  priority: TicketPriority;
  showLabel?: boolean;
}

/**
 * Renders a small colored dot representing ticket priority.
 * When showLabel is true, the priority name (capitalized) is shown beside the dot.
 */
export function PriorityIndicator({ priority, showLabel = false }: PriorityIndicatorProps): React.JSX.Element {
  const color = getPriorityColor(priority);
  const label = priority.charAt(0).toUpperCase() + priority.slice(1);

  return (
    <span className="d-inline-flex align-items-center gap-1">
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {showLabel && <span>{label}</span>}
    </span>
  );
}
