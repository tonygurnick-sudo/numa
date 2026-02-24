import React, { useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from 'react-bootstrap';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RunHistoryItem } from '../../types/scheduledRuns';
import { MarkdownContent } from '../Renderers/MarkdownContent';

export interface RunHistoryExpandedRowProps {
  run: RunHistoryItem;
  onDownloadArtifact?: (conversationId: string, userId: string, artifact: string) => void;
  /** When true, conversation messages are shown expanded by default. */
  defaultMessagesOpen?: boolean;
}

export const RunHistoryExpandedRow: React.FC<RunHistoryExpandedRowProps> = ({
  run,
  onDownloadArtifact,
  defaultMessagesOpen = false,
}) => {
  const { t } = useTranslation('agents');
  const [messagesOpen, setMessagesOpen] = useState(defaultMessagesOpen);

  if (run.loading) {
    return (
      <div className="text-center py-3">
        <Spinner animation="border" size="sm" />
        <span className="ms-2">{t('scheduling.details.runHistory.loadingDetails')}</span>
      </div>
    );
  }

  if (run.error) {
    return (
      <Alert variant="danger" className="mb-0">
        {run.error}
      </Alert>
    );
  }

  if (!run.log) {
    return <div className="text-center py-3 text-muted">{t('scheduling.details.runHistory.clickToLoad')}</div>;
  }

  const messageCount = run.log.messages?.length ?? 0;

  return (
    <>
      {run.log.error && (
        <Alert variant="danger">
          <strong>{t('scheduling.details.runHistory.status.failed')}:</strong> {run.log.error}
        </Alert>
      )}
      {/* Agent self-evaluation report */}
      {run.log.agentStatus && (
        <Card className="mb-3 border">
          <Card.Header className="d-flex align-items-center gap-2 py-2">
            <i className="bi bi-clipboard-check" aria-hidden="true"></i>
            <strong>{t('scheduling.details.runHistory.agentStatus.title')}</strong>
            <Badge
              bg={
                run.log.agentStatus.status === 'success'
                  ? 'success'
                  : run.log.agentStatus.status === 'partial'
                    ? 'warning'
                    : 'danger'
              }
              className="ms-auto"
            >
              {t(`scheduling.details.runHistory.status.${run.log.agentStatus.status}`, run.log.agentStatus.status)}
            </Badge>
          </Card.Header>
          <Card.Body className="py-2">
            {/* Summary */}
            <div className="mb-2">
              <small className="text-muted fw-bold text-uppercase">
                {t('scheduling.details.runHistory.agentStatus.summary')}
              </small>
              <div>{run.log.agentStatus.summary}</div>
            </div>
            {/* Artifacts */}
            {run.log.agentStatus.artifacts.length > 0 && (
              <div className="mb-2">
                <small className="text-muted fw-bold text-uppercase">
                  <i className="bi bi-file-earmark me-1" aria-hidden="true"></i>
                  {t('scheduling.details.runHistory.agentStatus.artifacts')}
                </small>
                <ul className="mb-0 ps-3">
                  {run.log.agentStatus.artifacts.map((artifact, i) => (
                    <li key={i}>
                      {run.log?.conversationId && run.log?.userId && onDownloadArtifact ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-decoration-none"
                          onClick={() => onDownloadArtifact(run.log!.conversationId!, run.log!.userId!, artifact)}
                        >
                          <i className="bi bi-download me-1" aria-hidden="true"></i>
                          <code className="small">{artifact}</code>
                        </Button>
                      ) : (
                        <code className="small">{artifact}</code>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Errors */}
            {run.log.agentStatus.errors.length > 0 && (
              <div className="mb-2">
                <small className="text-danger fw-bold text-uppercase">
                  <i className="bi bi-x-circle me-1" aria-hidden="true"></i>
                  {t('scheduling.details.runHistory.agentStatus.errors')}
                </small>
                <ul className="mb-0 ps-3">
                  {run.log.agentStatus.errors.map((err, i) => (
                    <li key={i} className="text-danger small">
                      {err}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Warnings */}
            {run.log.agentStatus.warnings.length > 0 && (
              <div className="mb-0">
                <small className="text-warning fw-bold text-uppercase">
                  <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
                  {t('scheduling.details.runHistory.agentStatus.warnings')}
                </small>
                <ul className="mb-0 ps-3">
                  {run.log.agentStatus.warnings.map((warn, i) => (
                    <li key={i} className="small">
                      {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card.Body>
        </Card>
      )}
      {/* Collapsible conversation messages */}
      {messageCount > 0 ? (
        <div>
          <button
            type="button"
            className="btn btn-sm btn-link text-muted p-0 d-flex align-items-center gap-1"
            onClick={() => setMessagesOpen((prev) => !prev)}
          >
            {messagesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>
              {t('scheduling.details.runHistory.showMessages', {
                count: messageCount,
                defaultValue: 'Conversation ({{count}} messages)',
              })}
            </span>
          </button>
          {messagesOpen && (
            <div className="mt-2">
              {run.log.messages!.map((msg, idx) => (
                <div key={idx} className="mb-3">
                  <div className="fw-bold text-uppercase small text-muted mb-1">{msg.role}</div>
                  <div className="p-2 rounded" style={{ backgroundColor: msg.role === 'user' ? '#e3f2fd' : '#ffffff' }}>
                    {msg.role === 'assistant' ? (
                      <MarkdownContent content={msg.content || t('scheduling.details.runHistory.noContent')} />
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content || t('scheduling.details.runHistory.noContent')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        !run.log.agentStatus && <p className="text-muted mb-0">{t('scheduling.details.runHistory.noMessages')}</p>
      )}
    </>
  );
};

export default RunHistoryExpandedRow;
