import React from 'react';
import type { WorkStage } from '../../../types/ops';
import { getStatusTypeColor } from './colorUtils';

interface StageBadgeProps {
  stageId: string;
  stages: WorkStage[];
}

/**
 * Renders a stage as plain colored text matching the CEO's design.
 * Lowercase label, coloured by statusType.
 */
export function StageBadge({ stageId, stages }: StageBadgeProps): React.JSX.Element {
  const stage = stages.find((s) => s.id === stageId);

  if (!stage) {
    return <span className="text-muted">—</span>;
  }

  const color = getStatusTypeColor(stage.statusType ?? 'backlog');

  return <span style={{ color, fontWeight: 500 }}>{stage.name}</span>;
}
