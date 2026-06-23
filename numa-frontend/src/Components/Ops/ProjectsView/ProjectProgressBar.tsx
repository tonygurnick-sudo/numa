import { useTranslation } from 'react-i18next';

type ProjectProgressBarProps = {
  /** Tickets in the project whose statusType is `completed` or `ended`. */
  done: number;
  /** Total tickets in the project. */
  total: number;
  /**
   * `card` — compact, percent-only label (project grid cards).
   * `detail` — fuller "done/total · percent%" label (project detail header).
   */
  variant?: 'card' | 'detail';
};

/**
 * ProjectProgressBar — completion bar for a project, derived from its tickets.
 * `completed` + `ended` count as done, matching ZoneProgressBar and the rest of
 * Ops. Reuses the `.ops-zone-progress*` styles (loaded via OpsHeader) so it reads
 * as the same visual language as the sprint/zone bars.
 */
const ProjectProgressBar: React.FC<ProjectProgressBarProps> = ({ done, total, variant = 'card' }) => {
  const { t } = useTranslation('ops');

  if (total <= 0) return null;

  const percent = Math.round((done / total) * 100);
  const full = t('projects.progressDetail', { done, total, percent });
  const label = variant === 'detail' ? full : t('projects.progressComplete', { percent });

  return (
    <div className="ops-zone-progress-wrapper" style={{ margin: 0 }}>
      <div className="ops-zone-progress-label" title={full}>
        {label}
      </div>
      <div
        className="ops-zone-progress"
        role="progressbar"
        aria-label={full}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="ops-zone-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

export default ProjectProgressBar;
