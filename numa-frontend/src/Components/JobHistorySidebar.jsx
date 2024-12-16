import React, { useState } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Button, ListGroup, Offcanvas } from 'react-bootstrap';
import { formatDistanceToNow } from 'date-fns';

const JobHistorySidebar = () => {
  const { getAppJobs, numaAppData } = useNumaApp();
  const [show, setShow] = useState(false);

  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  const jobs = getAppJobs();

  return (
    <>
      <Button
        onClick={handleShow}
        className="job-history-toggle"
        variant="primary"
        size="sm"
      >
        Recent Runs
      </Button>

      <Offcanvas show={show} onHide={handleClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            Recent Jobs - {numaAppData?.appName || 'App'}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {jobs.length === 0 ? (
            <p className="text-muted">No job history available</p>
          ) : (
            <ListGroup>
              {jobs.map((job) => (
                <ListGroup.Item
                  key={job.jobID}
                  className="mb-2"
                  style={{ cursor: 'pointer' }}
                >
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="fw-bold">
                        Job {job.jobID.slice(0, 8)}...
                      </div>
                      <small className="text-muted">
                        {formatDistanceToNow(new Date(job.dateTime), {
                          addSuffix: true,
                        })}
                      </small>
                    </div>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => {
                        // TODO: Implement view job details
                        console.log('View job details:', job);
                      }}
                    >
                      View
                    </Button>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export { JobHistorySidebar };
