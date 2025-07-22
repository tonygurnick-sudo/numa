import { useContext } from 'react';
import { Card, CardHeader, CardBody, Col, Row } from 'react-bootstrap';
import { JobStatusContext } from '../Providers/JobStatusContext';
import { useNavigate } from 'react-router-dom';
import { useNumaApp } from '../Providers/NumaAppContext';
import { NicetyContext } from '../Providers/NicetyContext';
import { Preloader } from './Preloader';

const JOB_DISPLAY_LIMIT = 5;

export const StatusDashboard = () => {
  const jobStatus = useContext(JobStatusContext);

  const jobs = jobStatus.jobs;

  return (
    <Row className="g-4">
      <Col xs={12}>
        <div className="status-dashboard-container">
          <Card>
            <CardHeader>Current and recent jobs</CardHeader>
            <CardBody>
              {jobStatus.loading && !jobStatus.hasLoaded ? (
                <div className="preloader-wrapper">
                  <Preloader smallscreen={true} />
                </div>
              ) : jobStatus.jobs.length === 0 ? (
                <p className="no-jobs">No recent jobs to display.</p>
              ) : (
                <table className="status-dashboard-table">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>App</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.slice(0, JOB_DISPLAY_LIMIT).map((job) => (
                      <StatusDashboardJob key={job.id} job={job} />
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
          {/* </div> */}
        </div>
      </Col>
    </Row>
  );
};

const StatusDashboardJob = ({ job }) => {
  const niceties = useContext(NicetyContext);
  const nav = useNavigate();
  const { setNumaAppId, loadJobResults } = useNumaApp();
  const openJob = async (appId, jobId) => {
    // TODO: set loading
    // TODO: Fix issue on first click throwing manifest error
    setNumaAppId(appId);
    loadJobResults(jobId).then(() => {
      nav(`/app/${appId}`);
    });
  };
  const parsedDate = new Date(job.started);
  return (
    <tr onClick={() => niceties.isEnabled('open-job-on-dashboard-click') && openJob(job.app, job.id)}>
      <td className="date">
        <span>{parsedDate.toLocaleDateString() + ' ' + parsedDate.toLocaleTimeString()}</span>
      </td>
      <td>
        <span>{job.appName}</span>
      </td>
      <td className={`status-${job.status}`}>{job.status}</td>
    </tr>
  );
};
