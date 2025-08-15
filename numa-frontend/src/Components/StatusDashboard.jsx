import { useContext } from 'react';
import { Col, Row, Badge, Table, Card, Button, Spinner } from 'react-bootstrap';
import { JobStatusContext } from '../Providers/JobStatusContext';
import { useNavigate } from 'react-router-dom';
import { useNumaApp } from '../Providers/NumaAppContext';
import { NicetyContext } from '../Providers/NicetyContext';

const JOB_DISPLAY_LIMIT = 5;

export const StatusDashboard = () => {
  const { jobs, loading, hasLoaded, refreshJobs, nextRefreshIn } = useContext(JobStatusContext);

  return (
    <Row className="g-4">
      <Col xs={12}>
        <Card>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <Card.Title className="mb-0">Current and recent jobs</Card.Title>
            <div className="d-flex align-items-center">
              <Button
                variant="primary"
                size="sm"
                onClick={refreshJobs}
                disabled={loading && !hasLoaded}
                className="d-flex align-items-center me-2"
              >
                {loading && !hasLoaded ? (
                  <div className="d-flex align-items-center">
                    <Spinner animation="border" size="sm" />
                    <span className="ms-2">Loading...</span>
                  </div>
                ) : (
                  <>
                    <span className="ms-1">Refresh</span>
                  </>
                )}
              </Button>
              {nextRefreshIn && (
                <small className="text-muted">
                  Auto-refresh in {Math.floor(nextRefreshIn / 60)}:{(nextRefreshIn % 60).toString().padStart(2, '0')}
                </small>
              )}
            </div>
          </Card.Header>
          <Card.Body>
            {jobs.length === 0 && !loading ? (
              <div className="text-center bg-light rounded empty-state">
                <p className="mt-2 text-muted mb-0">No recent jobs to display.</p>
              </div>
            ) : (
              <div className="file-table-container scrollable">
                <Table hover className="mb-0 file-table auto-layout">
                  <thead className="sticky-table-header">
                    <tr>
                      <th className="text-start" style={{ width: '40%' }}>
                        App
                      </th>
                      <th className="text-start" style={{ width: '30%' }}>
                        Started
                      </th>
                      <th className="text-start" style={{ width: '30%' }}>
                        Status
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

  const openJob = async (appId, jobId) => {
    setNumaAppId(appId);
    nav(`/app/${appId}?jobId=${jobId}`);
  };

  const parsedDate = job ? new Date(job.started) : null;

  const getStatusInfo = (status) => {
    if (!status) {
      return { variant: 'secondary', text: 'Unknown' };
    }

    const upperStatus = status.toUpperCase();

    switch (upperStatus) {
      // Success states
      case 'SUCCESS':
      case 'COMPLETED':
        return { variant: 'success', text: 'Completed' };

      // Failure states
      case 'FAILURE':
      case 'FAILED':
      case 'ERROR':
        return { variant: 'danger', text: 'Failed' };

      // Processing states
      case 'PROCESSING':
      case 'RUNNING':
      case 'IN-PROGRESS':
        return { variant: 'primary', text: 'Running' };

      // Queued states
      case 'QUEUED':
      case 'PENDING':
        return { variant: 'warning', text: 'Queued' };

      // Files uploaded state
      case 'FILES_UPLOADED':
      case 'FILES-UPLOADED':
        return { variant: 'info', text: 'Files Uploaded' };

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
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } else {
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
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
