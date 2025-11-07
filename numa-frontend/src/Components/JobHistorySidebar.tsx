import { useState, useEffect, useRef, useCallback } from 'react';
import { useNumaApp } from '../Providers/NumaAppContext';
import { Button, ListGroup, Offcanvas } from 'react-bootstrap';
import { formatDistanceToNow } from 'date-fns';
import { Preloader } from './Preloader';
import { CheckCircleFill, ArrowClockwise, ExclamationCircleFill, FileEarmarkArrowUp } from 'react-bootstrap-icons';

const SIDEBAR_NAME_LIMIT = 60;

const JobHistorySidebar = () => {
  const {
    getAppJobs,
    loadAppJobs,
    loadJobResults,
    numaAppData,
    jobHistorySidebarOpen,
    setJobHistorySidebarOpen,
    loadingJobId,
  } = useNumaApp();
  const [isLoading, setIsLoading] = useState(false);
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
    try {
      // Set the jobId as a query parameter in the URL
      const url = new URL(window.location);
      url.searchParams.set('jobId', jobId);
      window.history.pushState({}, '', url);

      await loadJobResults(jobId);
    } catch (error) {
      console.error('Error loading job results:', error);
    }
  };

  // Don't load jobs for policy-builder-app
  const jobs = numaAppData?.id === 'policy-builder-app' ? [] : getAppJobs() || [];

  const loadMoreJobs = useCallback(async () => {
    // Prevent multiple simultaneous loads or if no more items to load
    if (loadingMore || !hasMore || !jobHistorySidebarOpen) {
      return;
    }

    setLoadingMore(true);

    try {
      // If nextToken is a string, parse it first
      const tokenToUse = typeof nextToken === 'string' ? JSON.parse(nextToken) : nextToken;
      const response = await loadAppJobs({
        nextToken: tokenToUse,
        append: true,
      });

      if (!response?.nextToken) {
        setHasMore(false);
        return;
      }

      const newNextToken = response?.nextToken;

      // If we got a new token, update the state
      if (newNextToken) {
        // Check if tokens are the same
        let isSameToken = false;
        if (nextToken) {
          if (nextToken.jobId && newNextToken.jobId) {
            isSameToken = nextToken.jobId === newNextToken.jobId;
          } else {
            isSameToken = JSON.stringify(nextToken) === JSON.stringify(newNextToken);
          }
        }

        if (!isSameToken) {
          setNextToken(newNextToken);
          setHasMore(true);
        } else {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Error loading more jobs:', error);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadAppJobs, nextToken, loadingMore, hasMore, jobHistorySidebarOpen]);

  const formatRunLabel = (job) => {
    const appLabel = job.appName || numaAppData?.appName || 'App';
    const rawName = (job.name || '').trim();
    const startedAt = job.startedAt || job.dateTime || job.createdAt;

    let baseLabel = rawName;
    if (!baseLabel) {
      try {
        if (startedAt) {
          const date = new Date(startedAt);
          if (!Number.isNaN(date.valueOf())) {
            baseLabel = `Run ${date.toLocaleString('en-NZ', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })}`;
          } else {
            baseLabel = 'Untitled run';
          }
        } else {
          baseLabel = 'Untitled run';
        }
      } catch (error) {
        console.error('Error formatting run label for sidebar:', error);
        baseLabel = 'Untitled run';
      }
    }

    const suffix = ` — ${appLabel}`;
    const available = Math.max(SIDEBAR_NAME_LIMIT - suffix.length, 10);
    let truncatedBase = baseLabel;
    if (baseLabel.length > available) {
      truncatedBase = `${baseLabel.slice(0, available - 1)}…`;
    }

    return `${truncatedBase}${suffix}`;
  };

  // Intersection Observer setup
  useEffect(() => {
    if (!loaderRef.current) return;

    const currentLoader = loaderRef.current;
    let observer;

    const handleIntersection = (entries) => {
      const isIntersecting = entries[0]?.isIntersecting;

      if (isIntersecting && hasMore && !loadingMore) {
        loadMoreJobs();
      }
    };

    // Create the observer with a small delay to avoid rapid firing
    const timeoutId = setTimeout(() => {
      observer = new IntersectionObserver(handleIntersection, {
        threshold: 0.1,
        rootMargin: '100px',
      });
      observer.observe(currentLoader);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      if (observer) {
        observer.unobserve(currentLoader);
      }
    };
  }, [loadMoreJobs, hasMore, loadingMore, nextToken]);

  // Don't render anything for policy-builder-app
  if (numaAppData?.id === 'policy-builder-app') {
    return null;
  }

  return (
    <>
      <Button
        onClick={handleShow}
        className="job-history-toggle"
        variant="primary"
        size="sm"
        aria-label="Show Job History"
      >
        <i className="bi bi-clock-history me-1"></i>
        Job History
      </Button>

      <Offcanvas
        show={jobHistorySidebarOpen}
        onHide={handleClose}
        placement="end"
        style={{ width: '400px', boxShadow: '0 0 15px rgba(0,0,0,0.2)' }}
      >
        <Offcanvas.Header closeButton className="border-bottom bg-light py-3">
          <Offcanvas.Title className="d-flex align-items-center">
            <i className="bi bi-clock-history me-2"></i>
            Job History - {numaAppData?.appName || 'App'}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="p-3">
          {isLoading ? (
            <div className="text-center py-5">
              <Preloader smallscreen={true} />
              <p className="text-muted mt-3">Loading job history...</p>
            </div>
          ) : jobs.length === 0 || typeof jobs === 'string' ? (
            <div className="alert alert-light text-center p-4 border shadow-sm">
              <i className="bi bi-info-circle fs-4 mb-3 text-muted d-block"></i>
              <p className="mb-0 text-muted">No job history available</p>
            </div>
          ) : (
            <ListGroup className="job-history-list">
              {jobs.map((job) => (
                <ListGroup.Item key={job.jobId} className="mb-2 rounded shadow-sm border">
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="fw-semibold text-break">{formatRunLabel(job)}</div>
                      <div className="fw-bold">
                        {(() => {
                          try {
                            const date = new Date(job.startedAt || job.dateTime);
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
                      <div className="text-muted small d-flex align-items-center job-status-icon mt-1 fw-medium">
                        {(() => {
                          const status = job.status || 'completed';

                          // Check if job has file uploads
                          const hasFileUploads =
                            job.fileUploads || job.files || (job.input && (job.input.files || job.input.fileUploads));

                          switch (status) {
                            case 'SUCCESS':
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
                      variant={(() => {
                        const status = job.status || 'completed';
                        switch (status) {
                          case 'running':
                          case 'in-progress':
                            return 'light';
                          case 'files-uploaded':
                            return 'outline-success';
                          case 'failed':
                          case 'error':
                            return 'danger';
                          default:
                            return 'primary';
                        }
                      })()}
                      size="sm"
                      onClick={() => handleViewResults(job.jobId)}
                      disabled={loadingJobId === job.jobId}
                      title={`Job ID: ${job.jobId}`}
                      className="shadow-sm"
                      style={(() => {
                        const status = job.status || 'completed';
                        if (status === 'running' || status === 'PROCESSING' || status === 'in-progress') {
                          return {
                            minWidth: '120px',
                            padding: '6px 12px',
                            border: '1px solid #0d6efd',
                          };
                        }
                        return { minWidth: '120px', padding: '6px 12px' };
                      })()}
                    >
                      {loadingJobId === job.jobId ? (
                        <div className="d-flex align-items-center">
                          <Preloader smallscreen={true} />
                          <span className="ms-2">Loading...</span>
                        </div>
                      ) : (
                        <>
                          {(() => {
                            const status = job.status || 'completed';

                            switch (status) {
                              case 'running':
                              case 'in-progress':
                                return (
                                  <>
                                    <span style={{ color: '#0d6efd', fontWeight: '500' }}>View Progress</span>{' '}
                                    <i
                                      style={{ lineHeight: '1px', color: '#0d6efd' }}
                                      className="bi bi-arrow-right ms-1 bounce-icon"
                                    ></i>
                                  </>
                                );
                              case 'files-uploaded':
                                return (
                                  <>
                                    Continue{' '}
                                    <i style={{ lineHeight: '1px' }} className="bi bi-arrow-right ms-1 bounce-icon"></i>
                                  </>
                                );
                              default:
                                return (
                                  <>
                                    View Results{' '}
                                    <i style={{ lineHeight: '1px' }} className="bi bi-arrow-right ms-1 bounce-icon"></i>
                                  </>
                                );
                            }
                          })()}
                        </>
                      )}
                    </Button>
                  </div>
                </ListGroup.Item>
              ))}
              {hasMore &&
                (() => {
                  return (
                    <div
                      ref={loaderRef}
                      style={{
                        height: 40,
                        background: 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span style={{ color: '#999' }}>Loading more...</span>
                    </div>
                  );
                })()}
            </ListGroup>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export { JobHistorySidebar };
