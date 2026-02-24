import { useContext } from 'react';
import { Col, Row, Badge, Table, Card, Button, Spinner } from 'react-bootstrap';
import { JobStatusContext } from '../../Providers/JobStatusContext';
import { useNavigate } from 'react-router-dom';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { NicetyContext } from '../../Providers/NicetyContext';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { RefreshCw } from 'lucide-react';

const JOB_DISPLAY_LIMIT = 5;

export const StatusDashboard = () => {
  const { jobs, loading, hasLoaded, refreshJobs, nextRefreshIn } = useContext(JobStatusContext);
  const { t } = useTranslation('apps');

  return (
    <Row className="g-4">
      <Col xs={12}>
        <Card>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <Card.Title className="mb-0">{t('statusDashboard.title')}</Card.Title>
            <div className="d-flex align-items-center">
              <Button
                variant="secondary"
                onClick={refreshJobs}
                disabled={loading && !hasLoaded}
                className="standard-refresh-btn me-2"
              >
                {loading && !hasLoaded ? (
                  <>
                    <Spinner animation="border" size="sm" />
                    <span className="standard-refresh-btn__label">{t('statusDashboard.loading')}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} className="standard-refresh-btn__icon" aria-hidden="true" />
                    <span className="standard-refresh-btn__label">{t('statusDashboard.refresh')}</span>
                  </>
                )}
              </Button>
              {nextRefreshIn && (
                <small className="text-muted">
                  {t('statusDashboard.autoRefresh', {
                    time: `${Math.floor(nextRefreshIn / 60)}:${(nextRefreshIn % 60).toString().padStart(2, '0')}`,
                  })}
                </small>
              )}
            </div>
          </Card.Header>
          <Card.Body>
            {jobs.length === 0 && !loading ? (
              <div className="text-center bg-light rounded empty-state">
                <p className="mt-2 text-muted mb-0">{t('statusDashboard.empty')}</p>
              </div>
            ) : (
              <div className="file-table-container scrollable">
                <Table hover className="mb-0 file-table auto-layout">
                  <thead className="sticky-table-header">
                    <tr>
                      <th className="text-start" style={{ width: '40%' }}>
                        {t('statusDashboard.columns.app')}
                      </th>
                      <th className="text-start" style={{ width: '30%' }}>
                        {t('statusDashboard.columns.started')}
                      </th>
                      <th className="text-start" style={{ width: '30%' }}>
                        {t('statusDashboard.columns.status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !hasLoaded
                      ? Array.from({ length: JOB_DISPLAY_LIMIT }).map((_, index) => (
                          <StatusDashboardJobSkeleton key={index} />
                        ))
                      : jobs.slice(0, JOB_DISPLAY_LIMIT).map((job) => <StatusDashboardJob key={job.id} job={job} />)}
                  </tbody>
                </Table>
              </div>
            )}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

const StatusDashboardJob = ({ job }) => {
  const niceties = useContext(NicetyContext);
  const nav = useNavigate();
  const { setNumaAppId } = useNumaApp();
  const { t } = useTranslation('apps');

  const openJob = async (appId, jobId) => {
    setNumaAppId(appId);
    nav(`/app/${appId}?jobId=${jobId}`);
  };

  const parsedDate = job ? new Date(job.started) : null;

  const getStatusInfo = (status) => {
    if (!status) {
      return { variant: 'secondary', text: t('statusDashboard.status.unknown') };
    }

    const upperStatus = status.toUpperCase();

    switch (upperStatus) {
      // Success states
      case 'SUCCESS':
      case 'COMPLETED':
        return { variant: 'success', text: t('statusDashboard.status.completed') };

      // Failure states
      case 'FAILURE':
      case 'FAILED':
      case 'ERROR':
        return { variant: 'danger', text: t('statusDashboard.status.failed') };

      // Processing states
      case 'PROCESSING':
      case 'RUNNING':
      case 'IN-PROGRESS':
        return { variant: 'primary', text: t('statusDashboard.status.running') };

      // Queued states
      case 'QUEUED':
      case 'PENDING':
        return { variant: 'warning', text: t('statusDashboard.status.queued') };

      // Files uploaded state
      case 'FILES_UPLOADED':
      case 'FILES-UPLOADED':
        return { variant: 'info', text: t('statusDashboard.status.filesUploaded') };

      default:
        return {
          variant: 'secondary',
          text: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase(),
        };
    }
  };

  const formatDateTime = (date) => {
    const now = new Date();
    const diffInHours = (now - date) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true });
    } else {
      return `${date.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    }
  };

  const isClickable = job && niceties.isEnabled('job-status-dashboard');

  return (
    <tr
      className={isClickable ? 'border-bottom' : 'border-bottom'}
      onClick={() => isClickable && openJob(job.app, job.id)}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => isClickable && e.key === 'Enter' && openJob(job.app, job.id)}
      style={isClickable ? { cursor: 'pointer' } : {}}
    >
      <td className="p-3 align-middle">
        <div className="d-flex align-items-center">
          {job ? <span className="fw-semibold">{job.appName}</span> : <span className="fw-semibold skeleton-text" />}
        </div>
      </td>
      <td className="p-3 align-middle">
        {job ? (
          <span className="text-muted small text-start d-block">{formatDateTime(parsedDate)}</span>
        ) : (
          <span className="text-muted small skeleton-text" />
        )}
      </td>
      <td className="p-3 align-middle">
        {job ? (
          <Badge bg={getStatusInfo(job.status).variant} className="small">
            {getStatusInfo(job.status).text}
          </Badge>
        ) : (
          <span className="badge rounded-pill skeleton-badge" />
        )}
      </td>
    </tr>
  );
};

const StatusDashboardJobSkeleton = () => {
  return <StatusDashboardJob job={null} />;
};
