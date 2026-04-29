import { useState, useEffect } from 'react';
import { Modal, Table, Button, Alert, Spinner, OverlayTrigger, Tooltip, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { AgentSummary } from '../../types/agents';
import type { AgentSchedule } from '../../types/agentSchedules';
import { ScheduleService } from '../../Services/ScheduleService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useConfirm } from '../../Providers/ConfirmContext';
import { describeCronExpression } from '../../utils/cronUtils';

type ScheduleListModalProps = {
  show: boolean;
  onHide: () => void;
  agent: AgentSummary | null;
  onScheduleChange: () => void; // Called when schedules are modified
  onEditSchedule: (schedule: AgentSchedule) => void;
  onCreateSchedule?: () => void; // Called when creating a new schedule
};

const formatTimestamp = (timestamp: number | undefined, labels: { never: string; invalid: string }): string => {
  if (!timestamp) return labels.never;
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return labels.invalid;
  }
};

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case 'active':
      return 'success';
    case 'paused':
      return 'warning';
    case 'deleted':
      return 'danger';
    default:
      return 'secondary';
  }
};

export const AgentScheduleListModal = ({
  show,
  onHide,
  agent,
  onScheduleChange,
  onEditSchedule,
  onCreateSchedule,
}: ScheduleListModalProps) => {
  const { t } = useTranslation('agents');
  const { t: tCommon } = useTranslation('common');
  const { numaGet, numaDelete, numaPut } = useNumaRequest();
  const confirm = useConfirm();
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const getStatusLabel = (status: string) => t(`scheduling.status.${status}`, status);

  const loadSchedules = async () => {
    if (!agent) return;

    try {
      setLoading(true);
      setError(null);
      const agentSchedules = await ScheduleService.getByAgent(numaGet, agent.agentId);
      setSchedules(agentSchedules);
    } catch (err) {
      console.error('Failed to load schedules:', err);
      setError((err as Error)?.message ?? t('scheduling.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (show && agent) {
      loadSchedules();
    }
  }, [show, agent]);

  const handleDeleteSchedule = async (schedule: AgentSchedule) => {
    const ok = await confirm({
      message: t('scheduling.confirmDelete', { label: schedule.label || t('scheduling.labels.unnamed') }),
      confirmLabel: tCommon('confirm.delete'),
      variant: 'danger',
    });
    if (!ok) return;

    try {
      setDeletingId(schedule.scheduleId);
      await ScheduleService.delete(numaDelete, schedule.scheduleId);
      await loadSchedules();
      onScheduleChange(); // Notify parent to refresh schedule indicators
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      setError((err as Error)?.message ?? t('scheduling.errors.delete'));
    } finally {
      setDeletingId(null);
    }
  };

  const handlePauseSchedule = async (schedule: AgentSchedule) => {
    try {
      await ScheduleService.update(numaPut, schedule.scheduleId, {
        status: schedule.status === 'active' ? 'paused' : 'active',
      });
      await loadSchedules();
      onScheduleChange(); // Notify parent to refresh schedule indicators
    } catch (err) {
      console.error('Failed to pause/resume schedule:', err);
      setError((err as Error)?.message ?? t('scheduling.errors.update'));
    }
  };

  const handleEditSchedule = (schedule: AgentSchedule) => {
    onEditSchedule(schedule);
    onHide(); // Close this modal to show edit modal
  };

  const handleCreateSchedule = () => {
    if (onCreateSchedule) {
      onCreateSchedule();
      onHide(); // Close this modal to show create modal
    }
  };

  if (!agent) return null;

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>{t('scheduling.list.title', { agent: agent.title })}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}

        {loading ? (
          <div className="d-flex justify-content-center align-items-center py-4">
            <Spinner animation="border" className="me-2" />
            <span>{t('scheduling.loading')}</span>
          </div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-4">
            <i className="bi bi-clock text-muted" style={{ fontSize: '3rem' }}></i>
            <h5 className="mt-3 mb-2">{t('scheduling.list.emptyTitle')}</h5>
            <p className="text-muted mb-0">{t('scheduling.list.emptyBody')}</p>
          </div>
        ) : (
          <div className="table-responsive">
            <Table hover>
              <thead>
                <tr>
                  <th>{t('scheduling.list.columns.schedule')}</th>
                  <th>{t('scheduling.list.columns.prompt')}</th>
                  <th>{t('scheduling.list.columns.frequency')}</th>
                  <th>{t('scheduling.list.columns.status')}</th>
                  <th>{t('scheduling.list.columns.lastRun')}</th>
                  <th width="120">{t('scheduling.list.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.scheduleId}>
                    <td>
                      <div className="fw-medium">{schedule.label || t('scheduling.labels.unnamed')}</div>
                      <small className="text-muted">
                        {t('scheduling.list.createdAt', {
                          timestamp: formatTimestamp(schedule.createdAt, {
                            never: t('scheduling.labels.never'),
                            invalid: t('scheduling.labels.invalidDate'),
                          }),
                        })}
                      </small>
                    </td>
                    <td>
                      <div
                        style={{
                          maxWidth: '250px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={schedule.promptText}
                      >
                        {schedule.promptText}
                      </div>
                    </td>
                    <td>
                      <div className="small">{describeCronExpression(schedule.cronExpression)}</div>
                      <small className="text-muted">{schedule.timezone}</small>
                    </td>
                    <td>
                      <Badge bg={getStatusBadgeVariant(schedule.status)}>{getStatusLabel(schedule.status)}</Badge>
                    </td>
                    <td>
                      <small className="text-muted">
                        {formatTimestamp(schedule.lastRunEpoch, {
                          never: t('scheduling.labels.never'),
                          invalid: t('scheduling.labels.invalidDate'),
                        })}
                      </small>
                    </td>
                    <td>
                      <div className="d-flex gap-1">
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip id={`edit-${schedule.scheduleId}`}>{t('scheduling.actions.edit')}</Tooltip>}
                        >
                          <Button variant="outline-primary" size="sm" onClick={() => handleEditSchedule(schedule)}>
                            <i className="bi bi-pencil"></i>
                          </Button>
                        </OverlayTrigger>

                        <OverlayTrigger
                          placement="top"
                          overlay={
                            <Tooltip id={`pause-${schedule.scheduleId}`}>
                              {schedule.status === 'active'
                                ? t('scheduling.actions.pause')
                                : t('scheduling.actions.resume')}
                            </Tooltip>
                          }
                        >
                          <Button
                            variant={schedule.status === 'active' ? 'outline-warning' : 'outline-success'}
                            size="sm"
                            onClick={() => handlePauseSchedule(schedule)}
                          >
                            <i className={`bi bi-${schedule.status === 'active' ? 'pause' : 'play'}`}></i>
                          </Button>
                        </OverlayTrigger>

                        <OverlayTrigger
                          placement="top"
                          overlay={
                            <Tooltip id={`delete-${schedule.scheduleId}`}>{t('scheduling.actions.delete')}</Tooltip>
                          }
                        >
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => handleDeleteSchedule(schedule)}
                            disabled={deletingId === schedule.scheduleId}
                          >
                            {deletingId === schedule.scheduleId ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              <i className="bi bi-trash"></i>
                            )}
                          </Button>
                        </OverlayTrigger>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('scheduling.actions.close')}
        </Button>
        {onCreateSchedule && (
          <Button variant="primary" onClick={handleCreateSchedule}>
            <i className="bi bi-plus-circle me-2"></i>
            {t('scheduling.actions.create')}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default AgentScheduleListModal;
