import { ProgressBar, Alert } from 'react-bootstrap';
import { CheckCircleFill, XCircleFill, Clock } from 'react-bootstrap-icons';
import type { ToolProgress, ToolExecutionStatus } from '@/types/tools';

interface ProgressTrackerProps {
  status: ToolExecutionStatus;
  progress?: ToolProgress;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export function ProgressTracker({ status, progress, error, startedAt, completedAt }: ProgressTrackerProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <CheckCircleFill className="text-success me-2" />;
      case 'failed':
      case 'cancelled':
        return <XCircleFill className="text-danger me-2" />;
      case 'running':
        return <Clock className="text-primary me-2" />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'idle':
        return 'Ready to start';
      case 'running':
        return 'Running...';
      case 'completed':
        return 'Completed successfully';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Unknown status';
    }
  };

  const getVariant = () => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
      case 'cancelled':
        return 'danger';
      case 'running':
        return 'primary';
      default:
        return 'secondary';
    }
  };

  const formatDuration = () => {
    if (!startedAt) return '';

    const endTime = completedAt || new Date();
    const durationMs = endTime.getTime() - startedAt.getTime();
    const seconds = Math.floor(durationMs / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const progressValue = progress ? (progress.current / progress.total) * 100 : 0;
  const progressPercentage = parseFloat(progressValue.toFixed(2)).toString();

  return (
    <div className="progress-tracker">
      {/* Status Header */}
      <div className="d-flex align-items-center justify-content-between mb-2">
        <div className="d-flex align-items-center">
          {getStatusIcon()}
          <span className="fw-semibold">{getStatusText()}</span>
        </div>
        {startedAt && (
          <small className="text-muted">
            {status === 'running' ? 'Running for ' : 'Duration: '}
            {formatDuration()}
          </small>
        )}
      </div>

      {/* Progress Bar */}
      {status === 'running' && progress && (
        <div className="mb-3">
          <ProgressBar
            variant={getVariant()}
            now={progressValue}
            label={`${progressPercentage}%`}
            className="mb-2"
            style={{ height: '8px' }}
          />
          <div className="d-flex justify-content-between align-items-center">
            <small className="text-muted">{progress.message}</small>
            <small className="text-muted">
              {progress.current.toFixed(2)} / {progress.total}
            </small>
          </div>
          {progress.details && <small className="text-muted d-block mt-1">{progress.details}</small>}
        </div>
      )}

      {/* Completed Progress Bar */}
      {status === 'completed' && (
        <ProgressBar variant="success" now={100} label="100%" className="mb-2" style={{ height: '8px' }} />
      )}

      {/* Error Display */}
      {status === 'failed' && error && (
        <Alert variant="danger" className="mb-0 mt-2">
          <small>{error}</small>
        </Alert>
      )}

      {/* Cancelled Display */}
      {status === 'cancelled' && (
        <Alert variant="warning" className="mb-0 mt-2">
          <small>Operation was cancelled</small>
        </Alert>
      )}
    </div>
  );
}
