import { useState, useEffect, useRef, useCallback } from 'react';
import { useNumaApp } from '../Providers/NumaAppContext';
import { Button, ListGroup } from 'react-bootstrap';
import { formatDistanceToNow } from 'date-fns';
import { Preloader } from './Preloader';
import { CheckCircleFill, ArrowClockwise, ExclamationCircleFill, FileEarmarkArrowUp } from 'react-bootstrap-icons';
import { useDrawerBackClose } from '../hooks/useDrawerBackClose';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

const SIDEBAR_NAME_LIMIT = 60;

interface JobHistorySidebarProps {
  hideToggle?: boolean;
}

const JobHistorySidebar = ({ hideToggle = false }: JobHistorySidebarProps) => {
  const { t } = useTranslation('apps');
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
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  const handleClose = useCallback(() => setJobHistorySidebarOpen(false), [setJobHistorySidebarOpen]);

  // Mobile detection
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Enable back button to close drawer on mobile
  useDrawerBackClose({
    isOpen: jobHistorySidebarOpen,
    onClose: handleClose,
    enabled: isMobile,
    stateKey: 'job-history',
  });

  // Hide sidebar if user clicks outside (but not on the history button)
  useEffect(() => {
    if (!jobHistorySidebarOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target?.closest('.job-history-toggle') && !sidebarRef.current?.contains(target)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [jobHistorySidebarOpen, handleClose]);

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
    const appLabel = job.appName || numaAppData?.appName || t('jobHistory.sidebar.appFallback');
    const rawName = (job.name || '').trim();
    const startedAt = job.startedAt || job.dateTime || job.createdAt;

    let baseLabel = rawName;
    if (!baseLabel) {
      try {
        if (startedAt) {
          const date = new Date(startedAt);
          if (!Number.isNaN(date.valueOf())) {
            baseLabel = t('jobHistory.sidebar.runLabel', {
              date: date.toLocaleString(i18n.language, {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              }),
            });
          } else {
            baseLabel = t('jobHistory.sidebar.untitledRun');
          }
        } else {
          baseLabel = t('jobHistory.sidebar.untitledRun');
        }
      } catch (error) {
        console.error('Error formatting run label for sidebar:', error);
        baseLabel = t('jobHistory.sidebar.untitledRun');
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

  // Calculate mobile-aware positioning like ChatHistorySidebar
  const topOffsetPx = isMobile ? 60 : 0;
  const topOffset = `calc(${topOffsetPx}px + env(safe-area-inset-top, 0px))`;
  const sidebarHeight = `calc(100dvh - ${topOffsetPx}px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))`;
  const sidebarWidth = isMobile ? '100%' : '400px';

  return (
    <div className="job-history-sidebar">
      {!hideToggle && (
        <Button
          onClick={handleShow}
          className="job-history-toggle"
          variant="primary"
          size="sm"
          aria-label={t('jobHistory.sidebar.showAria')}
        >
          <i className="bi bi-clock-history me-1"></i>
          {t('jobHistory.sidebar.showButton')}
        </Button>
      )}

      <div
        ref={sidebarRef}
        className={`job-history-content ${jobHistorySidebarOpen ? 'show' : ''}`}
        style={{
          position: 'fixed',
          right: jobHistorySidebarOpen ? '0' : isMobile ? '-100%' : '-400px',
          top: topOffset,
          width: sidebarWidth,
          height: sidebarHeight,
          backgroundColor: 'white',
          boxShadow: '-2px 0 15px rgba(0,0,0,0.2)',
          transition: 'right 0.3s ease-in-out',
          zIndex: 1050,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="sidebar-header d-flex justify-content-between align-items-center border-bottom bg-light py-3 px-3">
          <h6 className="mb-0 d-flex align-items-center">
            <i className="bi bi-clock-history me-2"></i>
            {t('jobHistory.sidebar.headerTitle', {
              appName: numaAppData?.appName || t('jobHistory.sidebar.appFallback'),
            })}
          </h6>
          <Button
            variant="link"
            className="close-button p-0 text-muted"
            aria-label={t('jobHistory.sidebar.closeAria')}
            onClick={handleClose}
          >
            <i className="bi bi-x-lg"></i>
          </Button>
        </div>
        <div
          className="job-history-body p-3"
          style={{
            flex: 1,
            overflowY: 'auto',
            maxHeight: `calc(${sidebarHeight} - 60px)`,
          }}
        >
          {isLoading ? (
            <div className="text-center py-5">
              <Preloader smallscreen={true} />
              <p className="text-muted mt-3">{t('jobHistory.loadingHistory')}</p>
            </div>
          ) : jobs.length === 0 || typeof jobs === 'string' ? (
            <div className="alert alert-light text-center p-4 border shadow-sm">
              <i className="bi bi-info-circle fs-4 mb-3 text-muted d-block"></i>
              <p className="mb-0 text-muted">{t('jobHistory.sidebar.empty')}</p>
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
                              return t('jobHistory.sidebar.unknownTime');
                            }
                            return date.toLocaleString(i18n.language, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: 'numeric',
                              hour12: true,
                            });
                          } catch (error) {
                            console.error('Error formatting date:', error);
                            return t('jobHistory.sidebar.unknownTime');
                          }
                        })()}
                      </div>
                      <small className="text-muted">
                        {(() => {
                          try {
                            const date = new Date(job.startedAt || job.dateTime);
                            // Check if date is valid
                            if (isNaN(date.getTime())) {
                              return t('jobHistory.sidebar.unknownTime');
                            }
                            return formatDistanceToNow(date, { addSuffix: true });
                          } catch (error) {
                            console.error('Error formatting date:', error);
                            return t('jobHistory.sidebar.unknownTime');
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
                                  <span>{t('jobHistory.status.completed')}</span>
                                  {hasFileUploads && (
                                    <FileEarmarkArrowUp
                                      className="ms-2 text-primary"
                                      title={t('jobHistory.fileUploads')}
                                    />
                                  )}
                                </>
                              );
                            case 'running':
                            case 'in-progress':
                              return (
                                <>
                                  <ArrowClockwise className="text-primary me-1 spin" />
                                  <span>{t('jobHistory.status.running')}</span>
                                </>
                              );
                            case 'failed':
                            case 'error':
                              return (
                                <>
                                  <ExclamationCircleFill className="text-danger me-1" />
                                  <span>{t('jobHistory.status.failed')}</span>
                                </>
                              );
                            case 'files-uploaded':
                              return (
                                <>
                                  <FileEarmarkArrowUp className="text-primary me-1" />
                                  <span>{t('jobHistory.status.filesUploaded')}</span>
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
                      title={t('jobHistory.sidebar.jobIdTitle', { jobId: job.jobId })}
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
                          <span className="ms-2">{t('jobHistory.loading')}</span>
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
                                    <span style={{ color: '#0d6efd', fontWeight: '500' }}>
                                      {t('jobHistory.actions.viewProgress')}
                                    </span>{' '}
                                    <i
                                      style={{ lineHeight: '1px', color: '#0d6efd' }}
                                      className="bi bi-arrow-right ms-1"
                                    ></i>
                                  </>
                                );
                              case 'files-uploaded':
                                return (
                                  <>
                                    {t('jobHistory.actions.continue')}{' '}
                                    <i style={{ lineHeight: '1px' }} className="bi bi-arrow-right ms-1"></i>
                                  </>
                                );
                              default:
                                return (
                                  <>
                                    {t('jobHistory.actions.viewResults')}{' '}
                                    <i style={{ lineHeight: '1px' }} className="bi bi-arrow-right ms-1"></i>
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
                      <span style={{ color: '#999' }}>{t('jobHistory.sidebar.loadingMore')}</span>
                    </div>
                  );
                })()}
            </ListGroup>
          )}
        </div>
      </div>
    </div>
  );
};

export { JobHistorySidebar };
