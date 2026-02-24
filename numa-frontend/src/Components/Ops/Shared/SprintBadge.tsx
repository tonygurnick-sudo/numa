import React from 'react';
import Badge from 'react-bootstrap/Badge';
import type { WorkUnit } from '../../../types/ops';

// Dot + pill style matching CEO's design
const STATUS_COLORS: Record<string, string> = {
  active: '#198754',
  planning: '#0d6efd',
  completed: '#6c757d',
};

interface SprintBadgeProps {
  workUnit: WorkUnit | null | undefined;
}

/**
 * Renders a coloured pill badge for a sprint / work-unit.
 * Shows a small dot prefix + name inside a soft pill.
 */
export function SprintBadge({ workUnit }: SprintBadgeProps): React.JSX.Element | null {
  if (!workUnit) return null;

  const dotColor = STATUS_COLORS[workUnit.status] ?? STATUS_COLORS.planning;

  return (
    <Badge
      pill
      className="d-inline-flex align-items-center gap-1 fw-normal"
      style={{
        backgroundColor: `${dotColor}18`,
        color: dotColor,
        border: `1px solid ${dotColor}40`,
        fontSize: '0.8rem',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: dotColor,
          flexShrink: 0,
        }}
      />
      {workUnit.name}
    </Badge>
  );
}
