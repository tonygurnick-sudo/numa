import { useState, useEffect, useRef, useCallback } from 'react';
import { useNumaApp } from '../Providers/NumaAppContext';
import { Button, ListGroup, Offcanvas } from 'react-bootstrap';
import { formatDistanceToNow } from 'date-fns';
import { Preloader } from './Preloader';
import { CheckCircleFill, ArrowClockwise, ExclamationCircleFill, FileEarmarkArrowUp } from 'react-bootstrap-icons';

const JobHistorySidebar = () => {
  const { getAppJobs, loadAppJobs, loadJobResults, numaAppData, jobHistorySidebarOpen, setJobHistorySidebarOpen } =
    useNumaApp();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState(null);
  const [nextToken, setNextToken] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loaderRef = useRef(null);

  const handleClose = () => setJobHistorySidebarOpen(false);
  const handleShow = async () => {
    setJobHistorySidebarOpen(true);
    setIsLoading(true);
    try {
      // Reset pagination when opening sidebar
      setNextToken(null);
      setHasMore(true);
      await loadAppJobs();
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewResults = async (jobId) => {
    setLoadingJobId(jobId);
    try {
      await loadJobResults(jobId);
    } finally {
      setLoadingJobId(null);
    }
  };

  const jobs = getAppJobs() || [];

  const loadMoreJobs = useCallback(async () => {
    if (loadingMore || !hasMore || !jobHistorySidebarOpen) return;

    setLoadingMore(true);
    try {
      const response = await loadAppJobs({ nextToken, append: true });

      // Update next token and check if we have more results
      setNextToken(response.nextToken);
      setHasMore(!!response.nextToken);
    } catch (error) {
      console.error('Error loading more jobs:', error);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [nextToken, loadingMore, hasMore, jobHistorySidebarOpen]);

  // Intersection Observer setup
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreJobs();
        }
      },
      { threshold: 0.5 },
    );

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
    };
  }, [loadMoreJobs]);

  return (
    <>
      <Button onClick={handleShow} className="job-history-toggle" variant="primary" size="sm">
        Recent Runs
      </Button>

      <Offcanvas show={jobHistorySidebarOpen} onHide={handleClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Recent Jobs - {numaAppData?.appName || 'App'}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {isLoading ? (
            <div className="text-center py-5">
              <Preloader smallscreen={true} />
            </div>
          ) : jobs.length === 0 || typeof jobs === 'string' ? (
            <p className="text-muted">No job history available</p>
          ) : (
            <ListGroup className="job-history-list">
              {jobs.map((job) => (
                <ListGroup.Item key={job.jobID} className="mb-2">
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
                              hour12: true,
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
                      <div className="text-muted small d-flex align-items-center job-status-icon">
                        {(() => {
                          const status = job.status || 'completed';

                          // Check if job has file uploads
                          const hasFileUploads =
                            job.fileUploads || job.files || (job.input && (job.input.files || job.input.fileUploads));

                          switch (status) {
                            case 'completed':
                              return (
                                <>
                                  <CheckCircleFill className="text-success me-1" />
                                  <span>Completed</span>
                                  {hasFileUploads && (
                                    <FileEarmarkArrowUp className="ms-2 text-primary" title="Contains file uploads" />
                                  )}
                                </>
                              );
                            case 'running':
                            case 'in-progress':
                              return (
                                <>
                                  <ArrowClockwise className="text-primary me-1 spin" />
                                  <span>Running</span>
                                </>
                              );
                            case 'failed':
                            case 'error':
                              return (
                                <>
                                  <ExclamationCircleFill className="text-danger me-1" />
                                  <span>Failed</span>
                                </>
                              );
                            case 'files-uploaded':
                              return (
                                <>
                                  <FileEarmarkArrowUp className="text-primary me-1" />
                                  <span>Files Uploaded</span>
                                </>
                              );
                            default:
                              return <span>{status}</span>;
                          }
                        })()}
                      </div>
                    </div>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleViewResults(job.jobID)}
                      disabled={loadingJobId === job.jobID}
                      title={`Job ID: ${job.jobID}`}
                    >
                      {loadingJobId === job.jobID ? (
                        <div className="d-flex align-items-center">
                          <Preloader smallscreen={true} />
                          <span className="ms-2">Loading...</span>
                        </div>
                      ) : (
                        'View Results'
                      )}
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
