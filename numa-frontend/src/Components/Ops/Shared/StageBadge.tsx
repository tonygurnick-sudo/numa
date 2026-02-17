import React from 'react';
import Badge from 'react-bootstrap/Badge';
import type { WorkStage } from '../../../types/ops';
import { getStatusTypeColor, getContrastTextColor } from './colorUtils';

interface StageBadgeProps {
  stageId: string;
  stages: WorkStage[];
}

/**
 * Renders a colored pill badge for a stage.
 * Looks up the stage by ID, uses the statusType color as background,
 * and shows the stage name.
 */
export function StageBadge({ stageId, stages }: StageBadgeProps): React.JSX.Element {
  const stage = stages.find((s) => s.id === stageId);

  if (!stage) {
    return (
      <Badge pill style={{ backgroundColor: '#6c757d', color: '#fff' }}>
        —
      </Badge>
    );
  }

  const bgColor = getStatusTypeColor(stage.statusType ?? 'backlog');
  const textColor = getContrastTextColor(bgColor);

  return (
    <Badge pill style={{ backgroundColor: bgColor, color: textColor }}>
      {stage.name}
    </Badge>
  );
}
