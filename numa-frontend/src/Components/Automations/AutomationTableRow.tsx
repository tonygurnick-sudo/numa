import { useCallback } from 'react';
import { Badge, Dropdown, Form } from 'react-bootstrap';
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

type AutomationTableRowProps = {
  automation: AgentSchedule;
  agent?: AgentSummary | null;
  onToggleStatus: (automation: AgentSchedule) => void;
  onDelete: (automation: AgentSchedule) => void;
  onRunNow: (automation: AgentSchedule) => void;
  isRunning?: boolean;
};

const formatDateTime = (epoch?: number): string => {
  if (!epoch) return '—';
  const date = new Date(epoch > 1e12 ? epoch : epoch * 1000);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getNextRunLabel = (automation: AgentSchedule): string => {
  if (automation.status !== 'active') return '—';
  try {
    const nextRuns = getNextRunTimes(automation.cronExpression, automation.timezone, 1);
    if (nextRuns.length > 0) {
      return nextRuns[0].toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  } catch {
    // Ignore parse errors
  }
  return '—';
};

export const AutomationTableRow = ({
  automation,
  agent,
  onToggleStatus,
  onDelete,
  onRunNow,
  isRunning,
}: AutomationTableRowProps) => {
  const { t } = useTranslation('automations');
  const navigate = useNavigate();

  const displayName = automation.label || automation.agentTitle || t('card.noSchedule');
  const scheduleDescription = describeCronExpression(automation.cronExpression);
  const isActive = automation.status === 'active';
  const derivedStatus = getDerivedAutomationStatus(automation);
  const usesCompanyQuota = automationUsesCompanyQuota(automation);
  const canToggle = automation.status === 'active' || automation.status === 'paused';
  const runsLabel =
    automation.maxRuns && automation.maxRuns > 0
      ? `${automation.totalRuns || 0} / ${automation.maxRuns}`
      : `${automation.totalRuns || 0}`;

  const handleRowClick = useCallback(() => {
    navigate(`/automations/${automation.scheduleId}`);
  }, [navigate, automation.scheduleId]);

  return (
    <tr className="automation-table-row" onClick={handleRowClick} role="button">
      <td className="align-middle">
        <div className="d-flex align-items-center gap-2">
          <Clock size={14} className="text-muted flex-shrink-0" />
          <span className="fw-medium text-truncate" style={{ maxWidth: 200 }}>
            {displayName}
          </span>
        </div>
      </td>
      <td className="align-middle">
        <div className="d-flex align-items-center gap-2">
          <AgentAvatar agent={agent ?? undefined} size={24} />
          <span className="text-truncate" style={{ maxWidth: 150 }}>
            {agent?.title || automation.agentTitle || '—'}
          </span>
        </div>
      </td>
      <td className="align-middle text-muted small">{scheduleDescription}</td>
      <td className="align-middle" onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2">
          <Form.Check
            type="switch"
            checked={isActive}
            onChange={() => onToggleStatus(automation)}
            disabled={!canToggle}
            aria-label={isActive ? t('actions.pause') : t('actions.resume')}
          />
          <Badge bg={automationStatusBadgeVariant(derivedStatus)} className="small">
            {t(`status.${derivedStatus}`)}
          </Badge>
          {usesCompanyQuota && (
            <span
              className="text-muted"
              style={{ fontSize: '0.7rem' }}
              title={t('card.companyQuotaTooltip', {
                defaultValue: 'Admin-approved — runs against the company quota only, not your personal monthly cap.',
              })}
            >
              {t('card.companyQuota', { defaultValue: 'company quota' })}
            </span>
          )}
        </div>
      </td>
      <td className="align-middle text-muted small">{formatDateTime(automation.lastRunEpoch)}</td>
      <td className="align-middle text-muted small">{getNextRunLabel(automation)}</td>
      <td className="align-middle text-muted small text-center">{runsLabel}</td>
      <td className="align-middle" onClick={(e) => e.stopPropagation()}>
        <Dropdown align="end">
          <Dropdown.Toggle as="button" className="btn btn-sm btn-link text-muted p-1" aria-label="Actions">
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
      </td>
    </tr>
  );
};

export default AutomationTableRow;
