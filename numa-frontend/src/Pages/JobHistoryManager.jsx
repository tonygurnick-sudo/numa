import { useState, useEffect, useContext } from 'react';
import { Container, Row, Col, Card, Table, Button, Form, Pagination, Spinner, Badge } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { useJobsApi } from '../Services/jobsApi';
import { manifestService } from '../Services/manifestService';
import { Nav } from '../Components/Nav';
import { useAuth } from '../Providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { Search, FileEarmarkArrowUp, ArrowClockwise } from 'react-bootstrap-icons';
import { JobStatusContext } from '../Providers/JobStatusContext';

const JobHistoryManager = () => {
  useAuth();
  const { setNumaAppId } = useNumaApp();
  const jobsApi = useJobsApi();

  // Access job status from the global context
  const {
    jobs: jobStatusJobs,
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

  // Use JobStatusContext data when available
  useEffect(() => {
    if (jobStatusHasLoaded) {
      // Filter jobs based on selected app
      const filteredJobs =
        selectedApp === 'all' ? jobStatusJobs : jobStatusJobs.filter((job) => job.app === selectedApp);

      // Transform jobs to match our expected format
      const formattedJobs = filteredJobs.map((job) => ({
        jobId: job.id,
        appName: job.appName || job.app,
        appId: job.app,
        displayId: job.id?.substring(0, 8) || 'Unknown',
        status: job.status || 'Unknown',
        date: job.started || new Date().toISOString(),
        startedAt: job.started,
      }));

      setJobs(formattedJobs);
      setIsLoading(false);
    }
  }, [jobStatusJobs, jobStatusLoading, jobStatusHasLoaded, selectedApp]);

  // Set loading state based on JobStatusContext loading state
  useEffect(() => {
    // Sync our local loading state with the global context
    if (jobStatusLoading) {
      setIsLoading(true);
    } else if (jobStatusHasLoaded) {
      // Small delay to ensure UI updates properly
      setTimeout(() => setIsLoading(false), 300);
    }
  }, [jobStatusLoading, jobStatusHasLoaded]);

  // Main function to load jobs - simplified as we primarily use JobStatusContext
  const loadJobs = async () => {
    if (selectedApp !== 'all') {
      setIsLoading(true);
      try {
        const response = await jobsApi.getJobsByAppId(selectedApp, null);
        const appJobs = response?.items || [];

        const formattedJobs = appJobs.map((job) => ({
          ...job,
          appName: manifestApps.find((app) => app.id === selectedApp)?.appName || selectedApp,
          appId: selectedApp,
          displayId: job.jobId?.substring(0, 8) || 'Unknown',
          status: job.status || 'Unknown',
          date: job.startedAt || job.dateTime || new Date().toISOString(),
          startedAt: job.startedAt || job.dateTime || new Date().toISOString(),
        }));
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

                  // Determine job status
                  const status = (job.status || '').toUpperCase();
                  const isRunning = status === 'RUNNING' || status === 'IN-PROGRESS' || status === 'PROCESSING';
                  const isFilesUploaded = status === 'FILES-UPLOADED';
                  const isFailed = status === 'FAILED' || status === 'ERROR' || status === 'FAILURE';

                  // Get the end time reference
                  const endTimeStr = job.completedAt || job.finishedAt || job.lastUpdated || null;

                  // Calculate duration
                  let duration = null;

                  // For completed jobs with both start and end times
                  if (!isRunning && !isFilesUploaded && !isFailed && startedAt && endTimeStr) {
                    try {
                      const startTime = new Date(startedAt);
                      const endTime = new Date(endTimeStr);

                      if (!isNaN(startTime) && !isNaN(endTime)) {
                        duration = Math.max(0, (endTime - startTime) / 1000); // Duration in seconds, minimum 0
                      }
                    } catch (error) {
                      console.error(`Error calculating duration for job ${job.jobId}:`, error);
                    }
                  }

                  // For running jobs with start time
                  if (isRunning && startedAt) {
                    try {
                      const startTime = new Date(startedAt);
                      const now = new Date();
                      if (!isNaN(startTime)) {
                        duration = Math.max(0, (now - startTime) / 1000); // Running duration in seconds
                      }
                    } catch (error) {
                      console.error(`Error calculating running duration for job ${job.jobId}:`, error);
                    }
                  }

                  return {
                    ...job,
                    appName: app.appName || app.id,
                    appId: app.id,
                    displayId: job.jobId?.substring(0, 8) || 'Unknown',
                    status: job.status || 'Unknown',
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

  // Setup effect to load jobs when component mounts or when selected app changes
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

    // Only load jobs if JobStatusContext hasn't loaded yet
    if (!jobStatusHasLoaded) {
      loadJobs();
    }
    // Cleanup function to prevent state updates after unmount and abort any pending requests
    return () => {
      isMounted = false;
      abortController.abort();
      clearTimeout(loadingTimeout);
    };
  }, [selectedApp, manifestApps, jobStatusHasLoaded]);

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

  // Filter and sort jobs
  const filteredJobs = jobs
    .filter((job) => {
      // Apply status filter
      if (filterStatus !== 'all') {
        const status = job.status || 'completed';
        if (filterStatus === 'completed' && status !== 'SUCCESS' && status !== 'completed') {
          return false;
        }
        if (filterStatus === 'running' && status !== 'running' && status !== 'in-progress' && status !== 'PROCESSING') {
          return false;
        }
        if (filterStatus === 'failed' && status !== 'failed' && status !== 'error' && status !== 'FAILURE') {
          return false;
        }
        if (filterStatus === 'files-uploaded' && status !== 'files-uploaded') {
          return false;
        }
      }

      // Apply search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        return (
          (job.appName && job.appName.toLowerCase().includes(searchLower)) ||
          (job.jobId && job.jobId.toLowerCase().includes(searchLower))
        );
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
        const nameA = (a.appName || '').toLowerCase();
        const nameB = (b.appName || '').toLowerCase();
        return sortDirection === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      }
      if (sortField === 'jobId') {
        const idA = (a.jobId || '').toLowerCase();
        const idB = (b.jobId || '').toLowerCase();
        return sortDirection === 'asc' ? idA.localeCompare(idB) : idB.localeCompare(idA);
      }
      if (sortField === 'status') {
        const statusA = (a.status || 'completed').toLowerCase();
        const statusB = (b.status || 'completed').toLowerCase();
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

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-NZ', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid Date';
    }
  };

  // Format duration for display
  const formatDuration = (durationInSeconds, job) => {
    if (durationInSeconds === null || durationInSeconds === undefined) {
      // Check if the job status indicates it hasn't started or failed
      const jobStatus = job?.status?.toUpperCase() || '';

      if (
        jobStatus === 'FILES-UPLOADED' ||
        jobStatus === 'FAILED' ||
        jobStatus === 'ERROR' ||
        jobStatus === 'FAILURE'
      ) {
        return '-';
      }

      return 'In progress';
    }

    // Handle zero or near-zero durations
    if (durationInSeconds < 1) {
      return '<1s';
    }

    // Handle negative durations (could happen with clock skew)
    if (durationInSeconds < 0) {
      return '-';
    }

    // Format the duration
    if (durationInSeconds < 60) {
      // Less than a minute
      return `${Math.round(durationInSeconds)}s`;
    } else if (durationInSeconds < 3600) {
      // Less than an hour
      const minutes = Math.floor(durationInSeconds / 60);
      const seconds = Math.round(durationInSeconds % 60);
      return `${minutes}m ${seconds}s`;
    } else {
      // Hours or more
      const hours = Math.floor(durationInSeconds / 3600);
      const minutes = Math.floor((durationInSeconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  };

  // Render status badge
  const renderStatusBadge = (job) => {
    const status = job.status || 'completed';

    // Check if job has file uploads
    const hasFileUploads = job.fileUploads || job.files || (job.input && (job.input.files || job.input.fileUploads));

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

    const statusInfo = getStatusInfo(status);
    return (
      <div className="d-flex align-items-center">
        <Badge bg={statusInfo.variant} className="small">
          {statusInfo.text}
        </Badge>
        {hasFileUploads && <FileEarmarkArrowUp className="ms-2 text-primary" title="Contains file uploads" />}
      </div>
    );
  };

  // Render action button
  const renderActionButton = (job) => {
    const status = job.status || 'completed';

    return (
      <Button
        variant={(() => {
          switch (status) {
            case 'running':
            case 'in-progress':
            case 'PROCESSING':
              return 'primary';
            case 'files-uploaded':
              return 'primary';
            case 'failed':
            case 'error':
            case 'FAILURE':
              return 'primary';
            default:
              return 'primary';
          }
        })()}
        size="sm"
        onClick={() => handleViewResults(job.jobId, job.appId)}
        disabled={loadingJobId === job.jobId}
        title={`Job ID: ${job.jobId}`}
        className="d-flex align-items-center"
      >
        {loadingJobId === job.jobId ? (
          <div className="d-flex align-items-center">
            <Spinner animation="border" size="sm" />
            <span className="ms-2">Loading...</span>
          </div>
        ) : (
          <>
            {(() => {
              switch (status) {
                case 'running':
                case 'in-progress':
                case 'PROCESSING':
                  return <>View Progress</>;
                case 'files-uploaded':
                  return <>View Files</>;
                case 'failed':
                case 'error':
                case 'FAILURE':
                  return <>View Error</>;
                default:
                  return <>View Results</>;
              }
            })()}
          </>
        )}
      </Button>
    );
  };

  return (
    <>
      <Nav />
      <div className="dashboard" data-testid="layout-dashboard">
        <header className="mb-1">
          <Container fluid>
            <Row>
              <Col lg={12}>
                <h1>Job History</h1>
                <p>View and manage job history across all Numa apps.</p>
                <div className="d-flex align-items-center mb-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={refreshJobs}
                    disabled={jobStatusLoading}
                    className="d-flex align-items-center me-3"
                  >
                    {jobStatusLoading ? (
                      <div className="d-flex align-items-center">
                        <Spinner animation="border" size="sm" />
                        <span className="ms-2">Loading...</span>
                      </div>
                    ) : (
                      <>
                        <ArrowClockwise className={jobStatusLoading ? 'spin' : ''} />
                        <span className="ms-1">Refresh Now</span>
                      </>
                    )}
                  </Button>
                  {nextRefreshIn && (
                    <small className="text-muted">
                      Auto-refresh in {Math.floor(nextRefreshIn / 60)}:
                      {(nextRefreshIn % 60).toString().padStart(2, '0')}
                    </small>
                  )}
                </div>
              </Col>
            </Row>
          </Container>
        </header>

        <Container fluid>
          <Card className="mb-4">
            <Card.Body>
              <Row className="mb-3">
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Filter by App</Form.Label>
                    {/* Form.Select is disabled during loading to prevent users from changing the app selection while data is being fetched */}
                    <Form.Select
                      value={selectedApp}
                      onChange={handleAppChange}
                      disabled={isLoading}
                      aria-label="Filter by application"
                    >
                      <option value="all">All Apps</option>
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
                    <Form.Label>Filter by Status</Form.Label>
                    <Form.Select value={filterStatus} onChange={handleStatusFilterChange}>
                      <option value="all">All Statuses</option>
                      <option value="completed">Completed</option>
                      <option value="running">Running</option>
                      <option value="failed">Failed</option>
                      <option value="files-uploaded">Files Uploaded</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={5}>
                  <Form.Group>
                    <Form.Label>Search</Form.Label>
                    <div className="position-relative">
                      <Form.Control
                        type="text"
                        placeholder="Search by app name or job ID..."
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
                    <span className="visually-hidden">Loading…</span>
                  </div>
                  <p className="mt-3 text-muted small mb-0">Loading job history...</p>
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="text-center bg-light rounded p-4">
                  <p className="mb-0 text-muted">No job history available matching your filters</p>
                </div>
              ) : (
                <>
                  <div className="table-responsive file-table-container scrollable">
                    <Table hover className="mb-0 file-table auto-layout">
                      <thead className="sticky-table-header numa-table-header">
                        <tr>
                          <th onClick={() => handleSort('appId')} className="sortable-header">
                            App{' '}
                            {sortField === 'appId' && (
                              <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                            )}
                          </th>
                          <th onClick={() => handleSort('jobId')} className="sortable-header">
                            Job ID{' '}
                            {sortField === 'jobId' && (
                              <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                            )}
                          </th>
                          <th onClick={() => handleSort('startedAt')} className="sortable-header">
                            Started{' '}
                            {sortField === 'startedAt' && (
                              <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                            )}
                          </th>
                          <th onClick={() => handleSort('status')} className="sortable-header">
                            Status{' '}
                            {sortField === 'status' && (
                              <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                            )}
                          </th>
                          <th onClick={() => handleSort('duration')} className="sortable-header">
                            Duration{' '}
                            {sortField === 'duration' && (
                              <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                            )}
                          </th>
                          <th className="sortable-header">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentJobs.map((job) => (
                          <tr key={job.jobId}>
                            <td>
                              <div className="text-muted">
                                {manifestApps.find((app) => app.id === job.appId)?.appName || job.appId || 'Unknown'}
                              </div>
                            </td>
                            <td>
                              <div className="text-primary">
                                {job.displayId || job.jobId?.substring(0, 8) || 'Unknown'}
                              </div>
                            </td>

                            <td>
                              <div className="text-muted small">{formatDate(job.startedAt || job.dateTime)}</div>
                            </td>
                            <td>{renderStatusBadge(job)}</td>
                            <td>
                              <div className="text-muted small">{formatDuration(job.duration, job)}</div>
                            </td>
                            <td className="text-end align-middle">{renderActionButton(job)}</td>
                          </tr>
                        ))}
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
    </>
  );
};

export default JobHistoryManager;
