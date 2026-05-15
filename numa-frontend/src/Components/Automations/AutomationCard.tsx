import { useCallback } from 'react';
import { Card, Badge, Dropdown, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock, MoreVertical, Play, Pencil, Trash2, Eye } from 'lucide-react';
import { AgentAvatar } from '../Agents/AgentAvatar';
import { describeCronExpression, getNextRunTimes } from '../../utils/cronUtils';
import {
  getDerivedAutomationStatus,
  automationStatusBadgeVariant,
  automationUsesCompanyQuota,
} from '../../utils/automationUtils';
import type { AgentSchedule } from '../../types/agentSchedules';
import type { AgentSummary } from '../../types/agents';

type AutomationCardProps = {
  automation: AgentSchedule;
  agent?: AgentSummary | null;
  onToggleStatus: (automation: AgentSchedule) => void;
  onDelete: (automation: AgentSchedule) => void;
  onRunNow: (automation: AgentSchedule) => void;
  isRunning?: boolean;
};

const formatRelativeTime = (epoch?: number): string => {
  if (!epoch) return '';
  const date = new Date(epoch > 1e12 ? epoch : epoch * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const getNextRunLabel = (automation: AgentSchedule): string => {
  if (automation.status !== 'active') return '';
  try {
    const nextRuns = getNextRunTimes(automation.cronExpression, automation.timezone, 1);
    if (nextRuns.length > 0) {
      const next = nextRuns[0];
      const now = new Date();
      const diffMs = next.getTime() - now.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 60) return `in ${diffMins}m`;
      if (diffHours < 24) return `in ${diffHours}h`;
      return `in ${diffDays}d`;
    }
  } catch {
    // Ignore parse errors
  }
  return '';
};

export const AutomationCard = ({
  automation,
  agent,
  onToggleStatus,
  onDelete,
  onRunNow,
  isRunning,
}: AutomationCardProps) => {
  const { t } = useTranslation('automations');
  const navigate = useNavigate();

  const scheduleDescription = describeCronExpression(automation.cronExpression);
  const lastRunLabel = formatRelativeTime(automation.lastRunEpoch);
  const nextRunLabel = getNextRunLabel(automation);
  const displayName = automation.label || automation.agentTitle || t('card.noSchedule');
  const isActive = automation.status === 'active';
  const derivedStatus = getDerivedAutomationStatus(automation);
  const usesCompanyQuota = automationUsesCompanyQuota(automation);
  // Owner can only flip the toggle on schedules they actually control —
  // pending_approval (awaiting admin) and admin_locked are not toggleable
  // from this card. Showing the switch as off + disabled makes that obvious.
  const canToggle = automation.status === 'active' || automation.status === 'paused';

  const handleCardClick = useCallback(() => {
    navigate(`/automations/${automation.scheduleId}`);
  }, [navigate, automation.scheduleId]);

  const runsLabel =
    automation.maxRuns && automation.maxRuns > 0
      ? t('card.runs', { current: automation.totalRuns || 0, max: automation.maxRuns })
      : t('card.runsUnlimited', { current: automation.totalRuns || 0 });

  return (
    <Card
      className="automation-card h-100"
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
    >
      <Card.Body className="d-flex flex-column gap-3">
        {/* Header: type badge + status + actions */}
        <div className="d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center gap-2">
            <Badge bg="light" text="dark" className="d-flex align-items-center gap-1 automation-card__type-badge">
              <Clock size={12} />
              <span>{t('card.scheduled')}</span>
            </Badge>
            <Badge bg={automationStatusBadgeVariant(derivedStatus)} className="automation-card__status-badge">
              {t(`status.${derivedStatus}`)}
            </Badge>
            {usesCompanyQuota && (
              <span
                className="text-muted small"
                title={t('card.companyQuotaTooltip', {
                  defaultValue: 'Admin-approved — runs against the company quota only, not your personal monthly cap.',
                })}
              >
                {t('card.companyQuota', { defaultValue: 'company quota' })}
              </span>
            )}
          </div>
          <div className="d-flex align-items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Form.Check
              type="switch"
              checked={isActive}
              onChange={() => onToggleStatus(automation)}
              disabled={!canToggle}
              className="automation-card__toggle"
              aria-label={isActive ? t('actions.pause') : t('actions.resume')}
            />
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
                {automation.triggerType !== 'event' && (
                  <Dropdown.Item onClick={() => onRunNow(automation)} disabled={isRunning}>
                    <Play size={14} className="me-2" />
                    {isRunning ? t('actions.running') : t('actions.runNow')}
                  </Dropdown.Item>
                )}
                <Dropdown.Divider />
                <Dropdown.Item className="text-danger" onClick={() => onDelete(automation)}>
                  <Trash2 size={14} className="me-2" />
                  {t('actions.delete')}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>

        {/* Agent + Name */}
        <div className="d-flex align-items-center gap-3">
          <AgentAvatar agent={agent ?? undefined} size={40} />
          <div className="flex-grow-1 min-w-0">
            <div className="fw-semibold text-truncate">{displayName}</div>
            <div className="text-muted small text-truncate">{agent?.title || automation.agentTitle || ''}</div>
          </div>
        </div>

        {/* Schedule description */}
        <div className="text-muted small automation-card__schedule">
          <Clock size={12} className="me-1" />
          {scheduleDescription}
        </div>

        {/* Footer: runs + last/next run */}
        <div className="mt-auto d-flex justify-content-between align-items-center text-muted small">
          <span>{runsLabel}</span>
          <div className="d-flex gap-3">
            {lastRunLabel && <span title={t('card.lastRun')}>{lastRunLabel}</span>}
            {nextRunLabel && (
              <span className="text-primary" title={t('card.nextRun')}>
                {nextRunLabel}
              </span>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default AutomationCard;
