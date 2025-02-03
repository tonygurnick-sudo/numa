import React, { useState } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Button, ListGroup, Offcanvas } from 'react-bootstrap';
import { formatDistanceToNow } from 'date-fns';

const JobHistorySidebar = () => {
  const {
    getAppJobs,
    loadAppJobs,
    loadJobResults,
    numaAppData,
    jobHistorySidebarOpen,
    setJobHistorySidebarOpen
  } = useNumaApp();

  const handleClose = () => setJobHistorySidebarOpen(false);
  const handleShow = async () => {
    setJobHistorySidebarOpen(true);
    await loadAppJobs();
  };

  const jobs = getAppJobs() || [];

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

      <Offcanvas show={jobHistorySidebarOpen} onHide={handleClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            Recent Jobs - {numaAppData?.appName || 'App'}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {jobs.length === 0 || typeof jobs === 'string' ? (
            <p className="text-muted">No job history available</p>
          ) : (
            <ListGroup>
              {jobs
                .sort((a, b) => {
                  const dateA = new Date(a.startedAt || a.dateTime);
                  const dateB = new Date(b.startedAt || b.dateTime);
                  return dateB - dateA;
                })
                .map((job) => (
                <ListGroup.Item
                  key={job.jobID}
                  className="mb-2"
                >
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="fw-bold">
                        {(() => {
                          try {
                            const date = new Date(job.startedAt || job.dateTime);
                            // Check if date is valid
                            if (isNaN(date.getTime())) {
                              return 'Unknown time';
                            }
                            return date.toLocaleString('en-NZ', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: 'numeric',
                              hour12: true
                            });
                          } catch (error) {
                            console.error('Error formatting date:', error);
                            return 'Unknown time';
                          }
                        })()}
                      </div>
                      <small className="text-muted">
                        {(() => {
                          try {
                            const date = new Date(job.startedAt || job.dateTime);
                            // Check if date is valid
                            if (isNaN(date.getTime())) {
                              return 'Unknown time';
                            }
                            return formatDistanceToNow(date, { addSuffix: true });
                          } catch (error) {
                            console.error('Error formatting date:', error);
                            return 'Unknown time';
                          }
                        })()}
                      </small>
                      <div className="text-muted small">
                        Status: {job.status || 'completed'}
                      </div>
                    </div>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => loadJobResults(job.jobID)}
                      disabled={job.status === 'running'}
                    >
                      View Results
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
