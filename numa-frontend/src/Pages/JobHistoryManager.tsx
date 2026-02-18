import { useState, useEffect, useContext, useMemo } from 'react';
import { Container, Row, Col, Card, Table, Button, Form, Pagination, Spinner, Badge, Dropdown } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { useJobsApi } from '../Services/jobsApi';
import { manifestService } from '../Services/manifestService';
import { useAuth } from '../Providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { Search, FileEarmarkArrowUp } from 'react-bootstrap-icons';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { JobStatusContext } from '../Providers/JobStatusContext';
import { PageHeader } from '../Components/PageHeader';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';
import { useTranslation } from 'react-i18next';
import { StickyToolbar } from '../Components/StickyToolbar';
import { useScheduledAgentJobs } from '../hooks/useScheduledAgentJobs';

import { getDisplayStatusUpper } from '../utils/jobStatus';

const JOB_NAME_DISPLAY_LIMIT = 60;
const getJobSortTime = (job) => {
  const completed = job.completedAt || job.finishedAt || job.lastUpdated;
  const started = job.startedAt || job.dateTime || job.createdAt || job.date;
  const candidate = completed || started || 0;
  const parsed = new Date(candidate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

type FilterOption = { value: string; label: string };

interface FilterDropdownProps {
  id: string;
  ariaLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (nextValue: string) => void;
  disabled?: boolean;
}

const FilterDropdown = ({ id, ariaLabel, value, options, onChange, disabled = false }: FilterDropdownProps) => {
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <Dropdown className="job-history-filter-dropdown">
      <Dropdown.Toggle
        id={id}
        className="job-history-filter-dropdown-toggle"
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className="job-history-filter-dropdown-label">{selectedOption?.label ?? ''}</span>
        <ChevronDown size={16} className="job-history-filter-dropdown-chevron" aria-hidden="true" />
      </Dropdown.Toggle>
      <Dropdown.Menu className="job-history-filter-dropdown-menu">
        {options.map((option) => (
          <Dropdown.Item
            key={option.value}
            onClick={() => onChange(option.value)}
            active={option.value === value}
            className="job-history-filter-dropdown-item"
          >
            <span>{option.label}</span>
            {option.value === value && (
              <Check size={14} className="job-history-filter-dropdown-check" aria-hidden="true" />
            )}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};

const JobHistoryManager = () => {
  const { t, i18n } = useTranslation('apps');
  const { user, loading: authLoading } = useAuth();
  const { setNumaAppId } = useNumaApp();
  const jobsApi = useJobsApi();
  const { getScheduledAgentJobs } = useScheduledAgentJobs();
  const userId = user?.decoded_tokens?.idToken?.['sub'];

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
  const [jobType, setJobType] = useState('all'); // 'all', 'apps', 'agents'
  const [sortField, setSortField] = useState('startedAt');
  const [sortDirection, setSortDirection] = useState('desc');
  const [loadingJobId, setLoadingJobId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('all');

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

  // Main function to load jobs - handles both apps and scheduled agents
  const loadJobs = async () => {
    setIsLoading(true);
    let allJobs = [];

    try {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      // Load app jobs if jobType is 'all' or 'apps'
      if (jobType === 'all' || jobType === 'apps') {
        if (selectedApp !== 'all') {
          const response = await jobsApi.getJobsByAppId(selectedApp, null);
          const appJobs = response?.items || [];

          const formattedAppJobs = appJobs.map((job) => ({
            ...job,
            appName: manifestApps.find((app) => app.id === selectedApp)?.appName || selectedApp,
            appId: selectedApp,
            displayId: job.jobId?.substring(0, 8) || t('jobHistory.unknown'),
            status: job.status || t('jobHistory.unknown'),
            date: job.startedAt || job.dateTime || job.createdAt || null,
            startedAt: job.startedAt || job.dateTime || job.createdAt || null,
            completedAt: job.completedAt || job.finishedAt || job.lastUpdated || null,
            isScheduledAgent: false,
          }));

          allJobs = [...allJobs, ...formattedAppJobs];
        } else {
          for (const app of manifestApps) {
            if (app.id === 'policy-builder-app' || app.id === 'policy-reviewer-app') continue;

            try {
              const response = await jobsApi.getJobsByAppId(app.id, null);
              const appJobs = response?.items || [];

              const formattedAppJobs = appJobs.map((job) => ({
                ...job,
                appName: app.appName || app.id,
                appId: app.id,
                displayId: job.jobId?.substring(0, 8) || t('jobHistory.unknown'),
                status: job.status || t('jobHistory.unknown'),
                date: job.startedAt || job.dateTime || job.createdAt || null,
                startedAt: job.startedAt || job.dateTime || job.createdAt || null,
                completedAt: job.completedAt || job.finishedAt || job.lastUpdated || null,
                isScheduledAgent: false,
              }));

              allJobs = [...allJobs, ...formattedAppJobs];
            } catch (error) {
              console.error(`Failed to load jobs for app ${app.id}:`, error);
            }
          }
        }
      }

      // Load scheduled agent jobs if jobType is 'all' or 'agents'
      if (jobType === 'all' || jobType === 'agents') {
        const agentJobsResponse = await getScheduledAgentJobs();
        const agentJobs = agentJobsResponse?.items || [];
        allJobs = [...allJobs, ...agentJobs];
      }

      // Sort jobs by date (most recent first)
      allJobs.sort((a, b) => getJobSortTime(b) - getJobSortTime(a));

      setJobs(allJobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Setup effect to load jobs when component mounts or when selected app/manifests/context state changes
  useEffect(() => {
    let isMounted = true;
    let abortController = new AbortController();
    let loadingTimeout;

    if (authLoading) {
      return () => {
        isMounted = false;
        abortController.abort();
      };
    }

    if (selectedApp === 'all' && manifestApps.length === 0) {
      setIsLoading(false);
      return () => {
        isMounted = false;
        abortController.abort();
      };
    }

    // Set a safety timeout to ensure loading state is cleared even if something goes wrong
    loadingTimeout = setTimeout(() => {
      if (isMounted && isLoading) {
        console.warn('Loading timeout reached, forcing loading state to clear');
        setIsLoading(false);
      }
    }, 35000);

    loadJobs();
    return () => {
      isMounted = false;
      abortController.abort();
      clearTimeout(loadingTimeout);
    };
  }, [selectedApp, manifestApps, jobStatusHasLoaded, jobType, authLoading, userId]);

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
  const handleAppChange = (appId) => {
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
  const handleStatusFilterChange = (statusValue) => {
    setFilterStatus(statusValue);
    setCurrentPage(1); // Reset to first page when filter changes
  };

  const handleJobTypeChange = (nextJobType: 'all' | 'apps' | 'agents') => {
    setJobType(nextJobType);
    if (nextJobType === 'apps') {
      setSelectedAgent('all');
    }
    setCurrentPage(1);
  };

  const jobTypeTabs = useMemo(
    () => [
      { key: 'all', label: t('jobHistory.filters.jobType.all') },
      { key: 'apps', label: t('jobHistory.filters.jobType.apps') },
      { key: 'agents', label: t('jobHistory.filters.jobType.agents') },
    ],
    [t],
  );

  const appFilterOptions = useMemo(
    () => [
      { value: 'all', label: t('jobHistory.filters.app.all') },
      ...manifestApps
        .filter((app) => app.id !== 'policy-builder-app' && app.id !== 'policy-reviewer-app')
        .map((app) => ({ value: app.id, label: app.appName || app.id })),
    ],
    [manifestApps, t],
  );

  const statusFilterOptions = useMemo(
    () => [
      { value: 'all', label: t('jobHistory.filters.status.all') },
      { value: 'completed', label: t('jobHistory.status.completed') },
      { value: 'running', label: t('jobHistory.status.running') },
      { value: 'failed', label: t('jobHistory.status.failed') },
      { value: 'files-uploaded', label: t('jobHistory.status.filesUploaded') },
    ],
    [t],
  );

  const agentFilterOptions = useMemo(() => {
    const map = new Map<string, string>();

    jobs.forEach((job) => {
      if (!job.isScheduledAgent) return;
      const value = job.agentId || job.agentTitle || 'unknown';
      const label = job.agentTitle || job.agentId || t('jobHistory.filters.agent.unknown');
      if (!map.has(value)) {
        map.set(value, label);
      }
    });

    const sortedAgents = Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [{ value: 'all', label: t('jobHistory.filters.agent.all') }, ...sortedAgents];
  }, [jobs, t]);

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
    // Handle scheduled agents
    if (job.isScheduledAgent) {
      return t('jobHistory.scheduledAgents');
    }

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
    // Handle scheduled agents
    if (job.isScheduledAgent) {
      return t('jobHistory.scheduledAgentRun', { agent: job.agentTitle, prompt: job.promptText });
    }

    const rawName = (job.name || '').trim();
    if (rawName) {
      return rawName;
    }
    return t('jobHistory.untitledRun');
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
      // Apply agent filter
      if (selectedAgent !== 'all' && jobType !== 'apps') {
        const agentValue = job.agentId || job.agentTitle || 'unknown';
        if (!job.isScheduledAgent || agentValue !== selectedAgent) {
          return false;
        }
      }

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
        const timeA = getJobSortTime(a);
        const timeB = getJobSortTime(b);
        return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
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
        <Badge bg={statusInfo.variant} className="job-history-status-badge">
          {statusInfo.text}
        </Badge>
        {hasFileUploads && <FileEarmarkArrowUp className="ms-2 text-primary" title={t('jobHistory.fileUploads')} />}
      </div>
    );
  };

  // Render action button
  const renderActionButton = (job) => {
    const statusUpper = getDisplayStatusUpper(job);

    if (job.isScheduledAgent) {
      return (
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => navigate(`/scheduling/${job.scheduleId || job.results?.scheduleId}`)}
          className="d-flex align-items-center job-history-action-btn"
        >
          {t('jobHistory.actions.viewSchedule')}
        </Button>
      );
    }

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
        className="d-flex align-items-center job-history-action-btn"
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
    <div className="dashboard job-history-page" data-testid="layout-dashboard">
      <PageHeader
        title={t('jobHistory.title')}
        subtitle={t('jobHistory.subtitle')}
        actionsClassName="job-history-header-actions"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={onRefreshClick}
              disabled={jobStatusLoading}
              className="standard-refresh-btn"
            >
              {jobStatusLoading ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  <span className="standard-refresh-btn__label">{t('jobHistory.loading')}</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} className="standard-refresh-btn__icon" aria-hidden="true" />
                  <span className="standard-refresh-btn__label">{t('jobHistory.actions.refresh')}</span>
                </>
              )}
            </Button>
            {nextRefreshIn && (
              <small className="text-muted job-history-refresh-meta">
                {t('jobHistory.autoRefresh', {
                  time: `${Math.floor(nextRefreshIn / 60)}:${(nextRefreshIn % 60).toString().padStart(2, '0')}`,
                })}
              </small>
            )}
          </>
        }
      />
      <SubHeaderTabBar
        items={jobTypeTabs}
        activeKey={jobType}
        onSelect={(key) => handleJobTypeChange((key as 'all' | 'apps' | 'agents') || 'all')}
        ariaLabel={t('jobHistory.filters.jobType.label')}
      />

      <Container fluid className="job-history-content">
        <StickyToolbar className="job-history-toolbar">
          <Row className="g-3 align-items-end mb-0 job-history-toolbar-row">
            <Col md={jobType === 'all' ? 4 : 6}>
              <Form.Group className="job-history-search-group">
                <div className="position-relative">
                  <Form.Control
                    type="text"
                    placeholder={t('jobHistory.filters.search.shortPlaceholder')}
                    value={searchTerm}
                    onChange={handleSearch}
                    aria-label={t('jobHistory.filters.search.label')}
                    className="job-history-search-input"
                  />
                  <Search className="job-history-search-icon" />
                </div>
              </Form.Group>
            </Col>
            {jobType !== 'agents' && (
              <Col md={jobType === 'all' ? 3 : 4}>
                <Form.Group>
                  <FilterDropdown
                    id="job-history-app-filter"
                    ariaLabel={t('jobHistory.filters.app.aria')}
                    value={selectedApp}
                    onChange={handleAppChange}
                    options={appFilterOptions}
                    disabled={isLoading}
                  />
                </Form.Group>
              </Col>
            )}
            {jobType !== 'apps' && (
              <Col md={jobType === 'all' ? 3 : 4}>
                <Form.Group>
                  <FilterDropdown
                    id="job-history-agent-filter"
                    ariaLabel={t('jobHistory.filters.agent.aria')}
                    value={selectedAgent}
                    onChange={(agentValue) => {
                      setSelectedAgent(agentValue);
                      setCurrentPage(1);
                    }}
                    options={agentFilterOptions}
                    disabled={isLoading}
                  />
                </Form.Group>
              </Col>
            )}
            <Col md={2}>
              <Form.Group>
                <FilterDropdown
                  id="job-history-status-filter"
                  ariaLabel={t('jobHistory.filters.status.label')}
                  value={filterStatus}
                  onChange={handleStatusFilterChange}
                  options={statusFilterOptions}
                />
              </Form.Group>
            </Col>
          </Row>
        </StickyToolbar>

        <Card className="job-history-table-card">
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
                  <Table hover className="mb-0 file-table auto-layout job-history-table">
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
                            <td className="text-end align-middle pe-3">{renderActionButton(job)}</td>
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
