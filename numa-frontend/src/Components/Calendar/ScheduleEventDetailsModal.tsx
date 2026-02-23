import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Badge, Button, Alert, Spinner } from 'react-bootstrap';
import type { CalendarEvent } from './CalendarScheduleView';
import { describeCronExpression } from '../../utils/cronUtils';
import { ScheduleService } from '../../Services/ScheduleService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAuth } from '../../Providers/AuthProvider';
import { fetchFileFromS3 } from '../../utils/s3Utils';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';

interface ScheduleEventDetailsModalProps {
  show: boolean;
  onHide: () => void;
  event: CalendarEvent | null;
  onEdit?: (schedule: CalendarEvent['resource']) => void;
  onTogglePause?: (schedule: CalendarEvent['resource']) => void;
  onDelete?: (schedule: CalendarEvent['resource']) => void;
  actionLoading?: string | null;
}

type ScheduledRunMessage = {
  role: string;
  content: string;
};

type ScheduledRunLog = {
  scheduleId?: string;
  scheduleLabel?: string | null;
  runId?: string;
  conversationId?: string;
  userId?: string;
  prompt?: string;
  startedAt?: string;
  completedAt?: string;
  messages?: ScheduledRunMessage[];
};

const formatTimestamp = (
  timestamp: number | undefined,
  labels: { never: string; invalid: string },
  timezone?: string,
): string => {
  if (!timestamp) return labels.never;
  try {
    return new Date(timestamp).toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined);
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

const getEventTypeIcon = (eventType: string) => {
  if (eventType === 'agent') return <Bot size={16} />;
  const cls =
    eventType === 'application' ? 'bi-app' : eventType === 'data_sync' ? 'bi-arrow-repeat' : 'bi-calendar-event';
  return <i className={cls} />;
};

export const ScheduleEventDetailsModal: React.FC<ScheduleEventDetailsModalProps> = ({
  show,
  onHide,
  event,
  onEdit,
  onTogglePause,
  onDelete,
  actionLoading,
}) => {
  const { t } = useTranslation('agents');
  const { numaPost } = useNumaRequest();
  const { getCredentials, region: authRegion } = useAuth();
  const [runLoading, setRunLoading] = useState(false);
  const [runLogLoading, setRunLogLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<ScheduledRunLog | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [runPreview, setRunPreview] = useState<{ prompt: string; assistant: string; conversationId?: string } | null>(
    null,
  );
  const [runLogKey, setRunLogKey] = useState<string | null>(null);
  const resource = event?.resource;

  const outputsBucket = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  }, []);

  const region = authRegion || (typeof window !== 'undefined' ? window.sessionStorage.getItem('REGION') : null);
  const canRun = Boolean(resource) && resource.status !== 'deleted' && (resource.eventType ?? 'agent') === 'agent';

  useEffect(() => {
    if (!resource?.scheduleId) return;
    setRunError(null);
    setRunLog(null);
    setRunPreview(null);
    setRunLogKey(resource.lastRunS3Key ?? null);
    setIsPolling(false);
  }, [resource?.scheduleId]);

  useEffect(() => {
    if (show) return;
    setRunLoading(false);
    setRunLogLoading(false);
    setRunError(null);
    setRunLog(null);
    setRunPreview(null);
    setRunLogKey(null);
    setIsPolling(false);
  }, [show]);

  const fetchRunLog = useCallback(
    async (s3Key: string) => {
      if (!outputsBucket || !region) {
        throw new Error(t('scheduling.errors.outputsBucketMissing'));
      }
      if (!getCredentials) {
        throw new Error(t('scheduling.errors.credentialsMissing'));
      }
      const blob = await fetchFileFromS3(s3Key, outputsBucket, region, getCredentials);
      const text = await blob.text();
      return JSON.parse(text) as ScheduledRunLog;
    },
    [getCredentials, outputsBucket, region, t],
  );

  const loadRunLog = useCallback(
    async (s3Key: string) => {
      setRunLogLoading(true);
      try {
        const parsed = await fetchRunLog(s3Key);
        setRunLog(parsed);
        setRunLogKey(s3Key);
      } finally {
        setRunLogLoading(false);
      }
    },
    [fetchRunLog],
  );

  const pollForRunLog = useCallback(
    async (s3Key: string, attempts = 0) => {
      const maxAttempts = 20;
      if (attempts >= maxAttempts) {
        setIsPolling(false);
        return;
      }
      try {
        const parsed = await fetchRunLog(s3Key);
        setRunLog(parsed);
        setRunLogKey(s3Key);
        setIsPolling(false);
      } catch {
        window.setTimeout(() => {
          pollForRunLog(s3Key, attempts + 1);
        }, 3000);
      }
    },
    [fetchRunLog],
  );

  const isNotFoundError = (err: unknown) => {
    if (!err) return false;
    const message = err instanceof Error ? err.message : String(err);
    return message.includes('Not Found') || message.includes('404');
  };

  const handleRunAgent = useCallback(async () => {
    if (!resource.scheduleId) return;
    setRunError(null);
    setRunLog(null);
    setRunPreview(null);
    setRunLogKey(null);
    setIsPolling(false);
    setRunLoading(true);

    try {
      const response = await ScheduleService.run(numaPost, resource.scheduleId);
      if (response.assistantMessage) {
        setRunPreview({
          prompt: resource.promptText,
          assistant: response.assistantMessage,
          conversationId: response.conversationId,
        });
      }

      if (response.status === 'queued') {
        if (response.runLogS3Key) {
          setRunLogKey(response.runLogS3Key);
          setIsPolling(true);
          pollForRunLog(response.runLogS3Key);
        }
      } else if (response.runLogS3Key) {
        try {
          await loadRunLog(response.runLogS3Key);
        } catch (err) {
          if (isNotFoundError(err)) {
            setIsPolling(true);
            pollForRunLog(response.runLogS3Key);
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('scheduling.errors.run');
      setRunError(message);
    } finally {
      setRunLoading(false);
    }
  }, [loadRunLog, numaPost, pollForRunLog, resource.promptText, resource.scheduleId, t]);

  const latestRunKey = runLogKey || resource?.lastRunS3Key || null;

  const handleLoadLastRun = useCallback(async () => {
    if (!latestRunKey) return;
    setRunError(null);
    setRunLog(null);
    setRunPreview(null);
    setIsPolling(false);

    try {
      await loadRunLog(latestRunKey);
    } catch (err) {
      if (isNotFoundError(err)) {
        setIsPolling(true);
        pollForRunLog(latestRunKey);
        return;
      }
      const message = err instanceof Error ? err.message : t('scheduling.errors.loadRunLog');
      setRunError(message);
    }
  }, [latestRunKey, loadRunLog, pollForRunLog, t]);

  const runMessages = useMemo(() => {
    if (runLog?.messages?.length) {
      return runLog.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
    }
    if (runPreview) {
      return [
        { role: 'user', content: runPreview.prompt },
        { role: 'assistant', content: runPreview.assistant },
      ];
    }
    return [];
  }, [runLog, runPreview]);

  if (!event || !resource) return null;

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center">
          <span className="me-2">{getEventTypeIcon(event.eventType)}</span>
          {t('scheduling.details.cardTitle')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="row g-3">
          {/* Event Title and Status */}
          <div className="col-12">
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h5 className="mb-1">{resource.label || t('scheduling.labels.unnamed')}</h5>
                <small className="text-muted">
                  {t('scheduling.details.fields.scheduleId')}: {resource.scheduleId}
                </small>
              </div>
              <Badge bg={getStatusBadgeVariant(resource.status)} className="fs-6">
                {t(`scheduling.status.${resource.status}`, resource.status)}
              </Badge>
            </div>
          </div>

          {/* Schedule Frequency */}
          <div className="col-12">
            <div className="card border-primary border-opacity-25">
              <div className="card-body py-3">
                <h6 className="card-title mb-2">
                  <i className="bi bi-clock me-1"></i>
                  {t('scheduling.details.frequencyTitle')}
                </h6>
                <p className="card-text mb-1 fw-medium">{describeCronExpression(resource.cronExpression)}</p>
                <small className="text-muted">
                  {t('scheduling.details.frequencyMeta', {
                    timezone: resource.timezone,
                    cron: resource.cronExpression,
                  })}
                </small>
              </div>
            </div>
          </div>

          {/* Agent Information */}
          {resource.agentTitle && (
            <div className="col-md-6">
              <div className="card border-success border-opacity-25">
                <div className="card-body py-3">
                  <h6 className="card-title mb-2">
                    <Bot size={16} className="me-1" />
                    {t('scheduling.details.fields.agent')}
                  </h6>
                  <p className="card-text mb-1">{resource.agentTitle}</p>
                  <small className="text-muted">
                    {t('scheduling.details.fields.id')}: {resource.agentId}
                  </small>
                </div>
              </div>
            </div>
          )}

          {/* Conversation Information */}
          <div className="col-md-6">
            <div className="card border-info border-opacity-25">
              <div className="card-body py-3">
                <h6 className="card-title mb-2">
                  <i className="bi bi-chat-dots me-1"></i>
                  {t('scheduling.details.fields.conversation')}
                </h6>
                <small className="text-muted">
                  {t('scheduling.details.fields.id')}: {resource.conversationId}
                </small>
              </div>
            </div>
          </div>

          {/* Prompt Text */}
          <div className="col-12">
            <div className="card border-warning border-opacity-25">
              <div className="card-body py-3">
                <h6 className="card-title mb-2">
                  <i className="bi bi-chat-text me-1"></i>
                  {t('scheduling.details.promptTitle')}
                </h6>
                <p className="card-text">{resource.promptText || t('scheduling.details.promptEmpty')}</p>
              </div>
            </div>
          </div>

          {/* Timing Information */}
          <div className="col-12">
            <div className="card border-secondary border-opacity-25">
              <div className="card-body py-3">
                <h6 className="card-title mb-3">
                  <i className="bi bi-info-circle me-1"></i>
                  {t('scheduling.details.timingTitle')}
                </h6>
                <div className="row g-2 small">
                  <div className="col-md-4">
                    <strong>{t('scheduling.details.fields.created')}:</strong>
                    <br />
                    {formatTimestamp(
                      resource.createdAt,
                      {
                        never: t('scheduling.labels.never'),
                        invalid: t('scheduling.labels.invalidDate'),
                      },
                      resource.timezone,
                    )}
                  </div>
                  <div className="col-md-4">
                    <strong>{t('scheduling.details.fields.updated')}:</strong>
                    <br />
                    {formatTimestamp(
                      resource.updatedAt,
                      {
                        never: t('scheduling.labels.never'),
                        invalid: t('scheduling.labels.invalidDate'),
                      },
                      resource.timezone,
                    )}
                  </div>
                  <div className="col-md-4">
                    <strong>{t('scheduling.details.fields.lastRun')}:</strong>
                    <br />
                    {formatTimestamp(
                      resource.lastRunEpoch,
                      {
                        never: t('scheduling.labels.never'),
                        invalid: t('scheduling.labels.invalidDate'),
                      },
                      resource.timezone,
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Event Time Range */}
          <div className="col-12">
            <div className="card border-dark border-opacity-25">
              <div className="card-body py-3">
                <h6 className="card-title mb-2">
                  <i className="bi bi-calendar-range me-1"></i>
                  {t('scheduling.details.eventTimeTitle')}
                </h6>
                <div className="row g-2 small">
                  <div className="col-md-6">
                    <strong>{t('scheduling.details.eventTime.start')}:</strong>
                    <br />
                    {event.start.toLocaleString(
                      undefined,
                      resource.timezone ? { timeZone: resource.timezone } : undefined,
                    )}
                  </div>
                  <div className="col-md-6">
                    <strong>{t('scheduling.details.eventTime.end')}:</strong>
                    <br />
                    {event.end.toLocaleString(
                      undefined,
                      resource.timezone ? { timeZone: resource.timezone } : undefined,
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Latest Run Output */}
          <div className="col-12">
            <div className="card border-info border-opacity-25">
              <div className="card-body py-3">
                <h6 className="card-title mb-2">
                  <i className="bi bi-terminal me-1"></i>
                  {t('scheduling.details.latestRunTitle')}
                </h6>
                {runError && (
                  <Alert variant="danger" className="py-2">
                    {runError}
                  </Alert>
                )}
                {(runLoading || runLogLoading) && (
                  <div className="d-flex align-items-center text-muted small">
                    <Spinner animation="border" size="sm" className="me-2" />
                    {t('scheduling.details.latestRunLoading')}
                  </div>
                )}
                {isPolling && !runLoading && !runLogLoading && (
                  <div className="text-muted small">{t('scheduling.details.latestRunProcessing')}</div>
                )}
                {!runLoading && !runLogLoading && !isPolling && runMessages.length === 0 && (
                  <div className="text-muted small">{t('scheduling.details.latestRunEmpty')}</div>
                )}
                {!runLoading && !runLogLoading && runMessages.length > 0 && (
                  <div className="d-flex flex-column gap-2">
                    {runMessages.map((message, index) => (
                      <div key={`${message.role}-${index}`} className="border rounded p-2 bg-light">
                        <div className="small text-uppercase text-muted fw-semibold">{message.role}</div>
                        <div className="text-break small">
                          {message.content || t('scheduling.details.latestRunNoContent')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {latestRunKey && (
                  <div className="text-muted small mt-2">
                    {t('scheduling.details.latestRunLogKey', { key: latestRunKey })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer className="d-flex flex-wrap gap-2">
        <Button
          variant="outline-secondary"
          onClick={handleLoadLastRun}
          disabled={!latestRunKey || runLoading || runLogLoading}
        >
          {t('scheduling.actions.viewLastRun')}
        </Button>
        {onEdit && (
          <Button
            variant="outline-primary"
            onClick={() => onEdit(resource)}
            disabled={resource.status === 'deleted' || actionLoading === resource.scheduleId}
          >
            <i className="bi bi-pencil me-2"></i>
            {t('scheduling.actions.edit')}
          </Button>
        )}
        {onTogglePause && (
          <Button
            variant={resource.status === 'active' ? 'outline-warning' : 'outline-success'}
            onClick={() => onTogglePause(resource)}
            disabled={resource.status === 'deleted' || actionLoading === resource.scheduleId}
          >
            {actionLoading === resource.scheduleId ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <>
                <i className={resource.status === 'active' ? 'bi bi-pause-fill me-2' : 'bi bi-play-fill me-2'}></i>
                {resource.status === 'active' ? t('scheduling.actions.pause') : t('scheduling.actions.resume')}
              </>
            )}
          </Button>
        )}
        {onDelete && (
          <Button
            variant="outline-danger"
            onClick={() => onDelete(resource)}
            disabled={resource.status === 'deleted' || actionLoading === resource.scheduleId}
          >
            <i className="bi bi-trash me-2"></i>
            {t('scheduling.actions.delete')}
          </Button>
        )}
        <Button variant="primary" onClick={handleRunAgent} disabled={!canRun || runLoading || runLogLoading}>
          {runLoading ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              {t('scheduling.actions.running')}
            </>
          ) : (
            t('scheduling.actions.runAgent')
          )}
        </Button>
        <Button variant="secondary" onClick={onHide}>
          {t('scheduling.actions.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ScheduleEventDetailsModal;
