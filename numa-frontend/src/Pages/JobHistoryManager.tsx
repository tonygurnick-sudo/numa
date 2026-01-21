import { useState, useEffect, useContext } from 'react';
import { Container, Row, Col, Card, Table, Button, Form, Pagination, Spinner, Badge } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { useJobsApi } from '../Services/jobsApi';
import { manifestService } from '../Services/manifestService';
import { useAuth } from '../Providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { Search, FileEarmarkArrowUp } from 'react-bootstrap-icons';
import { JobStatusContext } from '../Providers/JobStatusContext';
import { PageHeader } from '../Components/PageHeader';
import { useTranslation } from 'react-i18next';

import { getDisplayStatusUpper } from '../utils/jobStatus';

const JOB_NAME_DISPLAY_LIMIT = 60;

const JobHistoryManager = () => {
  const { t, i18n } = useTranslation('apps');
  useAuth();
  const { setNumaAppId } = useNumaApp();
  const jobsApi = useJobsApi();

  // Access job status from the global context
  const {
    loading: jobStatusLoading,
    hasLoaded: jobStatusHasLoaded,
    refreshJobs,
    nextRefreshIn,
  } = useContext(JobStatusContext);

  // State for job history
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [manifestApps, setManifestApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState('all');
  const [sortField, setSortField] = useState('startedAt');
  const [sortDirection, setSortDirection] = useState('desc');
  const [loadingJobId, setLoadingJobId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Load apps from manifest on initial load
  useEffect(() => {
    const loadApps = async () => {
      try {
        const appsFromManifest = await manifestService.fetchAppsFromManifest();
        setManifestApps(appsFromManifest);
      } catch (error) {
        console.error('Error loading apps from manifest:', error);
      }
    };

    loadApps();
  }, []);

  // Removed: mapping jobs from JobStatusContext directly because it lacks duration/end timestamps

  // Set loading state based on JobStatusContext loading state
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (jobStatusLoading) {
      setIsLoading(true);
    } else if (jobStatusHasLoaded) {
      // In SSR/test environments window may not exist; fall back to immediate update
      if (typeof window === 'undefined') {
        setIsLoading(false);
      } else {
        timer = window.setTimeout(() => setIsLoading(false), 300);
      }
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [jobStatusLoading, jobStatusHasLoaded]);

  // Main function to load jobs - simplified as we primarily use JobStatusContext
  const loadJobs = async () => {
    if (selectedApp !== 'all') {
      setIsLoading(true);
      try {
        const response = await jobsApi.getJobsByAppId(selectedApp, null);
        const appJobs = response?.items || [];

        const formattedJobs = appJobs.map((job) => {
          // Get the start time
          const startedAt = job.startedAt || job.dateTime || job.createdAt || null;

          // Get the end time reference
          const endTimeStr = job.completedAt || job.finishedAt || job.lastUpdated || null;

          // Calculate duration
          let duration = null;

          // // For completed jobs with both start and end times
          // if (!isRunning && !isFilesUploaded && !isFailed && startedAt && endTimeStr) {
          //   try {
          //     const startTime = new Date(startedAt);
          //     const endTime = new Date(endTimeStr);
          //     if (!isNaN(startTime) && !isNaN(endTime)) {
          //       duration = Math.max(0, (endTime - startTime) / 1000);
          //     }
          //   } catch (error) {
          //     console.error(`Error calculating duration for job ${job.jobId}:`, error);
          //   }
          // }

          // // For running jobs with start time
          // if (isRunning && startedAt) {
          //   try {
          //     const startTime = new Date(startedAt);
          //     const now = new Date();
          //     if (!isNaN(startTime)) {
          //       duration = Math.max(0, (now - startTime) / 1000);
          //     }
          //   } catch (error) {
          //     console.error(`Error calculating running duration for job ${job.jobId}:`, error);
          //   }
          // }

          return {
            ...job,
            appName: manifestApps.find((app) => app.id === selectedApp)?.appName || selectedApp,
            appId: selectedApp,
            displayId: job.jobId?.substring(0, 8) || t('jobHistory.unknown'),
            status: job.status || t('jobHistory.unknown'),
            date: startedAt,
            startedAt: startedAt,
            completedAt: endTimeStr,
            duration: duration,
          };
        });
        setJobs(formattedJobs);
      } catch (error) {
        console.error('Error fetching jobs:', error);
      } finally {
        setIsLoading(false);
      }
    } else {
      setIsLoading(true);
      let allJobs = [];

      try {
        // Only proceed if we have apps to fetch
        if (manifestApps.length === 0) {
          setIsLoading(false);
          return;
        }

        // Track unique app IDs to prevent duplicate fetches
        const uniqueApps = [];
        const processedAppIds = new Set();

        // Filter out duplicate apps
        manifestApps.forEach((app) => {
          if (!processedAppIds.has(app.id)) {
            processedAppIds.add(app.id);
            uniqueApps.push(app);
          }
        });

        // Create an array of promises for each app's job fetch
        const jobFetchPromises = uniqueApps.map((app) => {
          return Promise.race([
            jobsApi
              .getJobsByAppId(app.id, null)
              .then((response) => {
                const appJobs = response?.items || [];

                return appJobs.map((job) => {
                  // Get the start time
                  const startedAt = job.startedAt || job.dateTime || job.createdAt || null;

                  // Get the end time reference
                  const endTimeStr = job.completedAt || job.finishedAt || job.lastUpdated || null;

                  // Calculate duration
                  let duration = null;

                  // // For completed jobs with both start and end times
                  // if (!isRunning && !isFilesUploaded && !isFailed && startedAt && endTimeStr) {
                  //   try {
                  //     const startTime = new Date(startedAt);
                  //     const endTime = new Date(endTimeStr);

                  //     if (!isNaN(startTime) && !isNaN(endTime)) {
                  //       duration = Math.max(0, (endTime - startTime) / 1000); // Duration in seconds, minimum 0
                  //     }
                  //   } catch (error) {
                  //     console.error(`Error calculating duration for job ${job.jobId}:`, error);
                  //   }
                  // }

                  // // For running jobs with start time
                  // if (isRunning && startedAt) {
                  //   try {
                  //     const startTime = new Date(startedAt);
                  //     const now = new Date();
                  //     if (!isNaN(startTime)) {
                  //       duration = Math.max(0, (now - startTime) / 1000); // Running duration in seconds
                  //     }
                  //   } catch (error) {
                  //     console.error(`Error calculating running duration for job ${job.jobId}:`, error);
                  //   }
                  // }

                  return {
                    ...job,
                    appName: app.appName || app.id,
                    appId: app.id,
                    displayId: job.jobId?.substring(0, 8) || t('jobHistory.unknown'),
                    status: job.status || t('jobHistory.unknown'),
                    date: startedAt,
                    startedAt: startedAt,
                    completedAt: endTimeStr,
                    duration: duration,
                  };
                });
              })
              .catch((error) => {
                console.error(`API call failed for app ${app.id}:`, error);
                return []; // Return empty array on error
              }),
            // Add timeout for each request - increased to 20 seconds
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timeout for app ${app.id}`)), 20000)),
          ]).catch((error) => {
            console.error(`Error fetching jobs for app ${app.id}:`, error);
            return []; // Return empty array on error
          });
        });

        // Wait for all promises to resolve
        const jobsArrays = await Promise.all(jobFetchPromises);

        // Flatten the array of job arrays
        allJobs = jobsArrays.flat();

        // Sort all jobs by date (newest first)
        if (allJobs.length > 0) {
          allJobs.sort((a, b) => new Date(b.date) - new Date(a.date));
          setJobs(allJobs);
        }
      } catch (error) {
        console.error('Error fetching jobs:', error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Setup effect to load jobs when component mounts or when selected app/manifests/context state changes
  useEffect(() => {
    let isMounted = true;
    let abortController = new AbortController();
    let loadingTimeout;

    // Set a safety timeout to ensure loading state is cleared even if something goes wrong
    loadingTimeout = setTimeout(() => {
      if (isMounted && isLoading) {
        console.warn('Loading timeout reached, forcing loading state to clear');
        setIsLoading(false);
      }
    }, 35000);

    // Always load jobs so we compute durations with full job records
    loadJobs();
    // Cleanup function to prevent state updates after unmount and abort any pending requests
    return () => {
      isMounted = false;
      abortController.abort();
      clearTimeout(loadingTimeout);
    };
  }, [selectedApp, manifestApps, jobStatusHasLoaded]);

  // Refresh handler to force both context refresh and local job reload
  const onRefreshClick = () => {
    try {
      refreshJobs();
    } catch {
      // no-op
    }
    loadJobs();
  };

  // Handle app selection change
  const handleAppChange = (e) => {
    const appId = e.target.value;
    setSelectedApp(appId);
    setCurrentPage(1); // Reset to first page

    // Clear jobs immediately to prevent flashing
    setJobs([]);

    if (appId === 'all') {
      // Set app ID to null for "All Apps" view
      setNumaAppId(null);
    } else {
      // Set app ID for specific app view
      setNumaAppId(appId);
    }
  };

  // Use navigate for routing
  const navigate = useNavigate();

  // Handle viewing job results
  const handleViewResults = async (jobId, appId) => {
    try {
      // Set loading state
      setLoadingJobId(jobId);

      // Set the app ID
      setNumaAppId(appId);

      // Navigate to the app page with the job ID
      navigate(`/app/${appId}?jobId=${jobId}`);

      // Reset loading state
      setLoadingJobId(null);
    } catch (error) {
      console.error('Error loading job results:', error);
      setLoadingJobId(null);
    }
  };

  // Handle sorting
  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Default to descending for new field
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Handle status filter change
  const handleStatusFilterChange = (e) => {
    setFilterStatus(e.target.value);
    setCurrentPage(1); // Reset to first page when filter changes
  };

  // Handle search
  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page when search changes
  };

  const formatDate = (dateString) => {
    if (!dateString) return t('jobHistory.unknown');
    try {
      const date = new Date(dateString);
      return date.toLocaleString(i18n.language, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch (error) {
      console.error('Error formatting date:', error);
      return t('jobHistory.unknown');
    }
  };

  const getAppDisplayName = (job) => {
    const manifestApp = manifestApps.find((app) => app.id === job.appId);
    if (manifestApp?.appName) {
      return manifestApp.appName;
    }
    if (job.appName) {
      return job.appName;
    }
    return job.appId || t('jobHistory.unknown');
  };

  const getBaseJobName = (job) => {
    const rawName = (job.name || '').trim();
    if (rawName) {
      return rawName;
    }
    return 'Untitled run';
  };

  const formatJobDisplayName = (job) => {
    const appLabel = getAppDisplayName(job);
    const baseName = getBaseJobName(job);
    const suffix = ` — ${appLabel}`;
    const available = Math.max(JOB_NAME_DISPLAY_LIMIT - suffix.length, 10);

    let truncatedBase = baseName;
    if (baseName.length > available) {
      truncatedBase = `${baseName.slice(0, available - 1)}…`;
    }

    return `${truncatedBase}${suffix}`;
  };

  const getSearchableText = (job) => {
    const parts = [
      (job.name || '').toLowerCase(),
      getAppDisplayName(job).toLowerCase(),
      formatJobDisplayName(job).toLowerCase(),
    ];

    return parts.join(' ');
  };

  // Status logic centralised in utils/jobStatus.js via getDisplayStatusUpper

  // Filter and sort jobs
  const filteredJobs = jobs
    .filter((job) => {
      // Apply status filter
      if (filterStatus !== 'all') {
        const statusUpper = getDisplayStatusUpper(job);
        if (filterStatus === 'completed' && statusUpper !== 'SUCCESS' && statusUpper !== 'COMPLETED') {
          return false;
        }
        if (filterStatus === 'running' && !['RUNNING', 'IN-PROGRESS', 'PROCESSING'].includes(statusUpper)) {
          return false;
        }
        if (filterStatus === 'failed' && !['FAILED', 'ERROR', 'FAILURE', 'FAILED-STUCK'].includes(statusUpper)) {
          return false;
        }
        if (filterStatus === 'files-uploaded' && !['FILES-UPLOADED', 'FILES_UPLOADED'].includes(statusUpper)) {
          return false;
        }
      }

      // Apply search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        if (!getSearchableText(job).includes(searchLower)) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Apply sorting
      if (sortField === 'startedAt') {
        const dateA = new Date(a.startedAt || a.date || 0);
        const dateB = new Date(b.startedAt || b.date || 0);
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      }
      if (sortField === 'appId') {
        const nameA = getAppDisplayName(a).toLowerCase();
        const nameB = getAppDisplayName(b).toLowerCase();
        return sortDirection === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      }
      if (sortField === 'name') {
        const runNameA = formatJobDisplayName(a).toLowerCase();
        const runNameB = formatJobDisplayName(b).toLowerCase();
        return sortDirection === 'asc' ? runNameA.localeCompare(runNameB) : runNameB.localeCompare(runNameA);
      }
      if (sortField === 'jobId') {
        const idA = (a.jobId || '').toLowerCase();
        const idB = (b.jobId || '').toLowerCase();
        return sortDirection === 'asc' ? idA.localeCompare(idB) : idB.localeCompare(idA);
      }
      if (sortField === 'status') {
        const statusA = (getDisplayStatusUpper(a) || 'UNKNOWN').toLowerCase();
        const statusB = (getDisplayStatusUpper(b) || 'UNKNOWN').toLowerCase();
        return sortDirection === 'asc' ? statusA.localeCompare(statusB) : statusB.localeCompare(statusA);
      }
      if (sortField === 'duration') {
        // Handle null/undefined duration values (in-progress jobs)
        const durationA = a.duration === null || a.duration === undefined ? Number.MAX_SAFE_INTEGER : a.duration;
        const durationB = b.duration === null || b.duration === undefined ? Number.MAX_SAFE_INTEGER : b.duration;
        return sortDirection === 'asc' ? durationA - durationB : durationB - durationA;
      }
      return 0;
    });

  // Pagination
  const totalPages = Math.ceil(filteredJobs.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentJobs = filteredJobs.slice(indexOfFirstItem, indexOfLastItem);

  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  // Duration formatting centralised in utils/jobStatus.js via formatDuration

  // Render status badge
  const renderStatusBadge = (job) => {
    const status = getDisplayStatusUpper(job) || 'UNKNOWN';

    // Check if job has file uploads
    const hasFileUploads = job.fileUploads || job.files || (job.input && (job.input.files || job.input.fileUploads));

    const getStatusInfo = (status) => {
      if (!status) {
        return { variant: 'secondary', text: t('jobHistory.status.unknown') };
      }

      const upperStatus = status.toUpperCase();

      switch (upperStatus) {
        // Success states
        case 'SUCCESS':
        case 'COMPLETED':
          return { variant: 'success', text: t('jobHistory.status.completed') };

        // Failure states
        case 'FAILURE':
        case 'FAILED':
        case 'ERROR':
        case 'FAILED-STUCK':
          return { variant: 'danger', text: t('jobHistory.status.failed') };

        // Processing states
        case 'PROCESSING':
        case 'RUNNING':
        case 'IN-PROGRESS':
          return { variant: 'primary', text: t('jobHistory.status.running') };

        // Queued states
        case 'QUEUED':
        case 'PENDING':
          return { variant: 'warning', text: t('jobHistory.status.queued') };

        // Files uploaded state
        case 'FILES_UPLOADED':
        case 'FILES-UPLOADED':
          return { variant: 'info', text: t('jobHistory.status.filesUploaded') };

        default:
          return {
            variant: 'secondary',
            text: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase(),
          };
      }
    };

    const statusInfo = getStatusInfo(status);
    return (
      <div className="d-flex align-items-center">
        <Badge bg={statusInfo.variant} className="small">
          {statusInfo.text}
        </Badge>
        {hasFileUploads && <FileEarmarkArrowUp className="ms-2 text-primary" title={t('jobHistory.fileUploads')} />}
      </div>
    );
  };

  // Render action button
  const renderActionButton = (job) => {
    const statusUpper = getDisplayStatusUpper(job);

    return (
      <Button
        variant={(() => {
          switch (statusUpper) {
            case 'RUNNING':
            case 'IN-PROGRESS':
            case 'PROCESSING':
              return 'primary';
            case 'FILES-UPLOADED':
            case 'FILES_UPLOADED':
              return 'primary';
            case 'FAILED':
            case 'ERROR':
            case 'FAILURE':
            case 'FAILED-STUCK':
              return 'primary';
            default:
              return 'primary';
          }
        })()}
        size="sm"
        onClick={() => handleViewResults(job.jobId, job.appId)}
        disabled={loadingJobId === job.jobId}
        className="d-flex align-items-center"
      >
        {loadingJobId === job.jobId ? (
          <div className="d-flex align-items-center">
            <Spinner animation="border" size="sm" />
            <span className="ms-2">{t('jobHistory.loading')}</span>
          </div>
        ) : (
          <>
            {(() => {
              switch (statusUpper) {
                case 'RUNNING':
                case 'IN-PROGRESS':
                case 'PROCESSING':
                  return <>{t('jobHistory.actions.viewProgress')}</>;
                case 'FILES-UPLOADED':
                case 'FILES_UPLOADED':
                  return <>{t('jobHistory.actions.viewFiles')}</>;
                case 'FAILED':
                case 'ERROR':
                case 'FAILURE':
                case 'FAILED-STUCK':
                  return <>{t('jobHistory.actions.viewError')}</>;
                default:
                  return <>{t('jobHistory.actions.viewResults')}</>;
              }
            })()}
          </>
        )}
      </Button>
    );
  };

  return (
    <div className="dashboard" data-testid="layout-dashboard">
      <PageHeader
        title={t('jobHistory.title')}
        subtitle={t('jobHistory.subtitle')}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={onRefreshClick}
              disabled={jobStatusLoading}
              className="d-flex align-items-center"
            >
              {jobStatusLoading ? (
                <>
                  <Spinner animation="border" size="sm" />
                  <span className="ms-2">{t('jobHistory.loading')}</span>
                </>
              ) : (
                <>
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  {t('jobHistory.actions.refresh')}
                </>
              )}
            </Button>
            {nextRefreshIn && (
              <small className="text-muted">
                {t('jobHistory.autoRefresh', {
                  time: `${Math.floor(nextRefreshIn / 60)}:${(nextRefreshIn % 60).toString().padStart(2, '0')}`,
                })}
              </small>
            )}
          </>
        }
      />

      <Container fluid>
        <Card className="mb-4">
          <Card.Body>
            <Row className="mb-3">
              <Col md={4}>
                <Form.Group>
                  <Form.Label>{t('jobHistory.filters.app.label')}</Form.Label>
                  {/* Form.Select is disabled during loading to prevent users from changing the app selection while data is being fetched */}
                  <Form.Select
                    value={selectedApp}
                    onChange={handleAppChange}
                    disabled={isLoading}
                    aria-label={t('jobHistory.filters.app.aria')}
                  >
                    <option value="all">{t('jobHistory.filters.app.all')}</option>
                    {manifestApps
                      .filter((app) => app.id !== 'policy-builder-app' && app.id !== 'policy-reviewer-app')
                      .map((app) => (
                        <option key={app.id} value={app.id}>
                          {app.appName || app.id}
                        </option>
                      ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group>
                  <Form.Label>{t('jobHistory.filters.status.label')}</Form.Label>
                  <Form.Select value={filterStatus} onChange={handleStatusFilterChange}>
                    <option value="all">{t('jobHistory.filters.status.all')}</option>
                    <option value="completed">{t('jobHistory.status.completed')}</option>
                    <option value="running">{t('jobHistory.status.running')}</option>
                    <option value="failed">{t('jobHistory.status.failed')}</option>
                    <option value="files-uploaded">{t('jobHistory.status.filesUploaded')}</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={5}>
                <Form.Group>
                  <Form.Label>{t('jobHistory.filters.search.label')}</Form.Label>
                  <div className="position-relative">
                    <Form.Control
                      type="text"
                      placeholder={t('jobHistory.filters.search.placeholder')}
                      value={searchTerm}
                      onChange={handleSearch}
                    />
                    <Search className="position-absolute" style={{ right: '10px', top: '10px', color: '#6c757d' }} />
                  </div>
                </Form.Group>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        <Card>
          <Card.Body className="p-0">
            {isLoading ? (
              <div className="text-center p-4">
                <div className="spinner-border text-primary">
                  <span className="visually-hidden">{t('jobHistory.loading')}</span>
                </div>
                <p className="mt-3 text-muted small mb-0">{t('jobHistory.loadingHistory')}</p>
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="text-center bg-light rounded p-4">
                <p className="mb-0 text-muted">{t('jobHistory.empty')}</p>
              </div>
            ) : (
              <>
                <div className="table-responsive file-table-container scrollable">
                  <Table hover className="mb-0 file-table auto-layout">
                    <thead className="sticky-table-header numa-table-header">
                      <tr>
                        <th onClick={() => handleSort('startedAt')} className="sortable-header">
                          {t('jobHistory.columns.started')}{' '}
                          {sortField === 'startedAt' && (
                            <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                          )}
                        </th>
                        <th onClick={() => handleSort('name')} className="sortable-header">
                          {t('jobHistory.columns.run')}{' '}
                          {sortField === 'name' && (
                            <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                          )}
                        </th>
                        <th onClick={() => handleSort('status')} className="sortable-header">
                          {t('jobHistory.columns.status')}{' '}
                          {sortField === 'status' && (
                            <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                          )}
                        </th>
                        <th className="sortable-header">{t('jobHistory.columns.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentJobs.map((job) => {
                        const startedLabel = formatDate(job.startedAt || job.dateTime);
                        const displayName = formatJobDisplayName(job);

                        return (
                          <tr key={`${job.appId}-${job.jobId}`}>
                            <td>
                              <div className="text-muted small">{startedLabel}</div>
                            </td>
                            <td>
                              <div className="fw-medium text-break">{displayName}</div>
                            </td>
                            <td>{renderStatusBadge(job)}</td>
                            <td className="text-end align-middle">{renderActionButton(job)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="d-flex justify-content-center py-3">
                    <Pagination>
                      <Pagination.Prev onClick={() => paginate(currentPage - 1)} disabled={currentPage === 1} />
                      {[...Array(totalPages)].map((_, index) => (
                        <Pagination.Item
                          key={index + 1}
                          active={index + 1 === currentPage}
                          onClick={() => paginate(index + 1)}
                        >
                          {index + 1}
                        </Pagination.Item>
                      ))}
                      <Pagination.Next
                        onClick={() => paginate(currentPage + 1)}
                        disabled={currentPage === totalPages}
                      />
                    </Pagination>
                  </div>
                )}
              </>
            )}
          </Card.Body>
        </Card>
      </Container>
    </div>
  );
};

export default JobHistoryManager;
