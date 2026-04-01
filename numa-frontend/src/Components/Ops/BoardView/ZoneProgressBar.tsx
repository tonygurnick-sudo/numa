import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket, WorkUnit } from '../../../types/ops';

type ZoneProgressBarProps = {
  tickets: Ticket[];
  /** When set, shows sprint-specific labelling (e.g. "Sprint 3: 7/12 (58%)") */
  activeWorkUnit?: WorkUnit | null;
};

/**
 * ZoneProgressBar — thin completion bar rendered at the top of each zone,
 * above the kanban columns. Calculates done/total from ticket statusType.
 * `completed` + `ended` = done.
 */
const ZoneProgressBar: React.FC<ZoneProgressBarProps> = ({ tickets, activeWorkUnit }) => {
  const { t } = useTranslation('ops');

  const { done, total, percent } = useMemo(() => {
    const total = tickets.length;
    const done = tickets.filter((tk) => tk.statusType === 'completed' || tk.statusType === 'ended').length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  }, [tickets]);

  if (total === 0) return null;

  const label = activeWorkUnit
    ? `${activeWorkUnit.name}: ${t('sprints.sprintProgress', { done, total })} (${percent}%)`
    : t('sprints.zoneProgress', { percent });

  return (
    <div className="ops-zone-progress-label" title={label}>
      <span>{label}</span>
      <div
        className="ops-zone-progress"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="ops-zone-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

export default ZoneProgressBar;
