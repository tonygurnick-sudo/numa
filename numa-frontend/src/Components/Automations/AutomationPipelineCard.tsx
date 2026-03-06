import { useCallback, useMemo } from 'react';
import { Card, Dropdown, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Play, Pencil, Trash2, Eye, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { AgentAvatar } from '../Agents/AgentAvatar';
import { describeCronExpression, getNextRunTimes } from '../../utils/cronUtils';
import { formatRelativeTime } from '../../utils/automationUtils';
import type { DerivedAutomationStatus } from '../../utils/automationUtils';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { AgentSummary } from '../../types/agents';

type AutomationPipelineCardProps = {
  automation: AgentSchedule;
  agent?: AgentSummary | null;
  derivedStatus: DerivedAutomationStatus;
  onToggleStatus: (automation: AgentSchedule) => void;
  onDelete: (automation: AgentSchedule) => void;
  onRunNow: (automation: AgentSchedule) => void;
  isRunning?: boolean;
};

const statusAccent = (status: DerivedAutomationStatus): string => {
  switch (status) {
    case 'active':
      return '#198754';
    case 'paused':
      return '#ffc107';
    case 'completed':
      return '#6c757d';
  }
};

const lastRunStatus = (automation: AgentSchedule) => {
  if (!automation.lastRunEpoch) return null;
  if (automation.lastStatus === 'failed' || automation.lastError) {
    return { icon: <XCircle size={12} />, color: '#dc3545', label: 'Failed' };
  }
  return { icon: <CheckCircle2 size={12} />, color: '#198754', label: 'Success' };
};

export const AutomationPipelineCard = ({
  automation,
  agent,
  derivedStatus,
  onToggleStatus,
  onDelete,
  onRunNow,
  isRunning,
}: AutomationPipelineCardProps) => {
  const { t } = useTranslation('automations');
  const navigate = useNavigate();

  const scheduleDescription = useMemo(
    () => describeCronExpression(automation.cronExpression),
    [automation.cronExpression]
  );
  const nextRunDate = useMemo(() => {
    if (derivedStatus !== 'active') return null;
    const times = getNextRunTimes(automation.cronExpression, automation.timezone, 1);
    return times.length > 0 ? times[0] : null;
  }, [automation.cronExpression, automation.timezone, derivedStatus]);
  const lastRunLabel = formatRelativeTime(automation.lastRunEpoch);
  const displayName = automation.label || automation.agentTitle || t('card.untitled');
  const isActive = automation.status === 'active';
  const isCompleted = derivedStatus === 'completed';
  const accentColor = statusAccent(derivedStatus);
  const runStatus = lastRunStatus(automation);

  const handleCardClick = useCallback(() => {
    navigate(`/automations/${automation.scheduleId}`);
  }, [navigate, automation.scheduleId]);

  return (
    <Card
      className="automation-pipeline-card h-100 border-0 shadow-sm"
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <Card.Body className="d-flex flex-column p-3">
        {/* Header: Name + Controls */}
        <div className="d-flex align-items-start justify-content-between mb-3">
          <h6 className="mb-0 fw-semibold text-truncate flex-grow-1" style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>
            {displayName}
          </h6>
          <div className="d-flex align-items-center gap-1 flex-shrink-0 ms-2" onClick={(e) => e.stopPropagation()}>
            {!isCompleted && (
              <Form.Check
                type="switch"
                checked={isActive}
                onChange={() => onToggleStatus(automation)}
                className="automation-card__toggle"
                aria-label={isActive ? t('actions.pause') : t('actions.resume')}
              />
            )}
            <Dropdown align="end">
              <Dropdown.Toggle
                as="button"
                className="btn btn-sm btn-link text-muted p-0 automation-card__menu-btn"
                aria-label="Actions"
              >
                <MoreVertical size={16} />
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => navigate(`/automations/${automation.scheduleId}`)}>
                  <Eye size={14} className="me-2" />
                  {t('actions.view')}
                </Dropdown.Item>
                <Dropdown.Item onClick={() => navigate(`/automations/${automation.scheduleId}/edit`)}>
                  <Pencil size={14} className="me-2" />
                  {t('actions.edit')}
                </Dropdown.Item>
                <Dropdown.Item onClick={() => onRunNow(automation)} disabled={isRunning}>
                  <Play size={14} className="me-2" />
                  {isRunning ? t('actions.running') : t('actions.runNow')}
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item className="text-danger" onClick={() => onDelete(automation)}>
                  <Trash2 size={14} className="me-2" />
                  {t('actions.delete')}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>

        {/* Vertical flow: Schedule → Agent */}
        <div className="pipeline-vertical flex-grow-1">
          {/* Schedule row */}
          <div className="pipeline-v-row">
            <div className="pipeline-v-dot pipeline-v-dot--schedule">
              <Clock size={10} />
            </div>
            <span className="text-muted" style={{ fontSize: '0.8rem' }}>
              {scheduleDescription || '\u2014'}
            </span>
          </div>

          {/* Connecting line */}
          <div className="pipeline-v-connector" />

          {/* Agent row */}
          <div className="pipeline-v-row">
            <AgentAvatar agent={agent ?? undefined} size={20} />
            <span style={{ fontSize: '0.8rem' }}>{agent?.title || automation.agentTitle || '\u2014'}</span>
          </div>
        </div>

        {/* Footer: Last run + Next run */}
        <div className="mt-3 pt-2 border-top d-flex flex-column gap-1" style={{ fontSize: '0.75rem' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-1 text-muted">
              <span>{t('card.lastRun')}:</span>
              <span>{lastRunLabel || t('card.never')}</span>
              {runStatus && (
                <span className="d-inline-flex align-items-center gap-1 ms-1" style={{ color: runStatus.color }}>
                  {runStatus.icon} {runStatus.label}
                </span>
              )}
            </div>
            <span className="text-muted flex-shrink-0">
              {automation.totalRuns || 0} {t('runs.title').toLowerCase().replace('all ', '')}
            </span>
          </div>
          <div className="d-flex align-items-center gap-1 text-muted">
            <span>{t('card.nextRun')}:</span>
            <span>
              {nextRunDate
                ? nextRunDate.toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : t('card.noMoreRuns')}
            </span>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default AutomationPipelineCard;
