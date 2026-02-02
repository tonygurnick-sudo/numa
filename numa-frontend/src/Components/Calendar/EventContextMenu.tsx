import React from 'react';
import { Dropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { AgentSchedule } from '../../types/agentSchedules';

interface EventContextMenuProps {
  schedule: AgentSchedule;
  onEdit: (schedule: AgentSchedule) => void;
  onPause: (schedule: AgentSchedule) => void;
  onResume: (schedule: AgentSchedule) => void;
  onDelete: (schedule: AgentSchedule) => void;
  loading?: boolean;
}

export const EventContextMenu: React.FC<EventContextMenuProps> = ({
  schedule,
  onEdit,
  onPause,
  onResume,
  onDelete,
  loading = false,
}) => {
  const { t } = useTranslation('agents');
  const isActive = schedule.status === 'active';
  const isPaused = schedule.status === 'paused';
  const isDeleted = schedule.status === 'deleted';

  const handleAction = (action: 'edit' | 'pause' | 'resume' | 'delete', event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (loading) return;

    switch (action) {
      case 'edit':
        onEdit(schedule);
        break;
      case 'pause':
        onPause(schedule);
        break;
      case 'resume':
        onResume(schedule);
        break;
      case 'delete':
        onDelete(schedule);
        break;
    }
  };

  return (
    <Dropdown.Menu show className="event-context-menu">
      <Dropdown.Item onClick={(e) => handleAction('edit', e)} disabled={loading || isDeleted}>
        <i className="bi bi-pencil-square me-2"></i>
        {t('scheduling.actions.edit')}
      </Dropdown.Item>

      <Dropdown.Divider />

      {isActive && (
        <Dropdown.Item onClick={(e) => handleAction('pause', e)} disabled={loading}>
          <i className="bi bi-pause-circle me-2"></i>
          {t('scheduling.actions.pause')}
        </Dropdown.Item>
      )}

      {isPaused && (
        <Dropdown.Item onClick={(e) => handleAction('resume', e)} disabled={loading}>
          <i className="bi bi-play-circle me-2"></i>
          {t('scheduling.actions.resume')}
        </Dropdown.Item>
      )}

      {!isDeleted && (
        <>
          <Dropdown.Divider />
          <Dropdown.Item onClick={(e) => handleAction('delete', e)} disabled={loading} className="text-danger">
            <i className="bi bi-trash me-2"></i>
            {t('scheduling.actions.delete')}
          </Dropdown.Item>
        </>
      )}
    </Dropdown.Menu>
  );
};
