import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  Alert,
  Table,
  Badge,
  Button,
  Spinner,
  Modal,
  Form,
  ButtonGroup,
  Dropdown,
} from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown, ChevronRight, Check, RefreshCw } from 'lucide-react';
import { PageHeader } from '../Components/PageHeader';
import { StickyToolbar } from '../Components/StickyToolbar';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { ScheduleService } from '../Services/ScheduleService';
import type { AgentSchedule } from '../types/agentSchedules';
import type { RunHistoryItem, ScheduledRunLog } from '../types/scheduledRuns';
import { AgentScheduleModal } from '../Components/Agents/AgentScheduleModal';
import { RunHistoryExpandedRow } from '../Components/Scheduling/RunHistoryExpandedRow';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { getNextRunTimes, describeCronExpression } from '../utils/cronUtils';
import { listObjectsInFolder, fetchFileFromS3, downloadFileFromS3 } from '../utils/s3Utils';
import { jwtDecode } from 'jwt-decode';
import { useTranslation } from 'react-i18next';

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case 'active':
      return 'success';
    case 'paused':
      return 'warning';
    case 'deleted':
      return 'danger';
    case 'inactive':
      return 'secondary';
    default:
      return 'secondary';
  }
};

const formatDate = (date: Date | null, labels: { notAvailable: string }, timezone?: string): string => {
  if (!date) return labels.notAvailable;
  try {
    return date.toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined);
  } catch {
    return date.toLocaleString();
  }
};

type ScheduleWithNextRun = AgentSchedule & { nextRun: Date | null };

type SortField = 'name' | 'agent' | 'schedule' | 'nextRun' | 'lastRun' | 'status' | 'timezone';
type FilterOption = { value: string; label: string };

interface FilterDropdownProps {
  id: string;
  ariaLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (nextValue: string) => void;
}

const FilterDropdown: React.FC<FilterDropdownProps> = ({ id, ariaLabel, value, options, onChange }) => {
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <Dropdown className="scheduling-filter-dropdown">
      <Dropdown.Toggle id={id} className="scheduling-filter-dropdown-toggle" aria-label={ariaLabel}>
        <span className="scheduling-filter-dropdown-label">{selectedOption?.label ?? ''}</span>
        <ChevronDown size={16} className="scheduling-filter-dropdown-chevron" aria-hidden="true" />
      </Dropdown.Toggle>
      <Dropdown.Menu className="scheduling-filter-dropdown-menu">
        {options.map((option) => (
          <Dropdown.Item
            key={option.value}
            onClick={() => onChange(option.value)}
            active={option.value === value}
            className="scheduling-filter-dropdown-item"
          >
            <span>{option.label}</span>
            {option.value === value && (
              <Check size={14} className="scheduling-filter-dropdown-check" aria-hidden="true" />
            )}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};

const isOneTimeCron = (cronExpression: string) => {
  if (!cronExpression?.startsWith('cron(') || !cronExpression.endsWith(')')) return false;
  const parts = cronExpression.slice(5, -1).trim().split(/\s+/);
  if (parts.length < 6) return false;
  const dayOfMonth = parts[2];
  const month = parts[3];
  const dayOfWeek = parts[4];
  const year = parts[5];
  return dayOfMonth !== '*' && month !== '*' && dayOfWeek === '?' && !!year && year !== '*';
};

const getDerivedStatus = (schedule: ScheduleWithNextRun) => {
  if (schedule.status === 'active' && isOneTimeCron(schedule.cronExpression) && !schedule.nextRun) {
    return 'inactive';
  }
  return schedule.status;
};

const formatDuration = (startedAt?: string, completedAt?: string): string | null => {
  if (!startedAt || !completedAt) return null;
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
};

const getRunSortTime = (run: RunHistoryItem): number => {
  const fromLog = run.log?.completedAt || run.log?.startedAt;
  if (fromLog) {
    const parsed = Date.parse(fromLog);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return run.timestamp?.getTime?.() ?? 0;
};

export const SchedulingPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('agents');
  const { numaGet, numaPut, numaDelete } = useNumaRequest();
  const { getCredentials, region: authRegion, getAccessToken } = useAuth();
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<AgentSchedule | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<AgentSchedule | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [timezoneFilter, setTimezoneFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showDebugIds, setShowDebugIds] = useState(false);

  // Run history expansion state
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);
  const [runHistoryBySchedule, setRunHistoryBySchedule] = useState<Record<string, RunHistoryItem[]>>({});
  const [runHistoryLoading, setRunHistoryLoading] = useState<Record<string, boolean>>({});

  const outputsBucket = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  }, []);

  const region = authRegion || (typeof window !== 'undefined' ? window.sessionStorage.getItem('REGION') : null);

  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const scheduleEvents = await ScheduleService.getActiveSchedules(numaGet);
      setSchedules(scheduleEvents);
    } catch (err) {
      console.error('Failed to load schedules:', err);
      setError((err as Error)?.message ?? t('scheduling.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const handleScheduleClick = useCallback(
    (schedule: AgentSchedule) => {
      navigate(`/scheduling/${schedule.scheduleId}`, { state: { schedule } });
    },
    [navigate]
  );

  const handleEditSchedule = useCallback((e: React.MouseEvent, schedule: AgentSchedule) => {
    e.stopPropagation();
    setEditingSchedule(schedule);
    setShowEditModal(true);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setShowEditModal(false);
    setEditingSchedule(null);
  }, []);

  const handleUpdateSchedule = useCallback(
    async (payload: { promptText: string; cronExpression: string; timezone: string; label?: string }) => {
      if (!editingSchedule) return;

      await ScheduleService.update(numaPut, editingSchedule.scheduleId, {
        promptText: payload.promptText,
        cronExpression: payload.cronExpression,
        timezone: payload.timezone,
        label: payload.label,
      });

      await loadSchedules();
    },
    [editingSchedule, numaPut, loadSchedules]
  );

  const handleTogglePause = useCallback(
    async (e: React.MouseEvent, schedule: AgentSchedule) => {
      e.stopPropagation();
      const newStatus = schedule.status === 'active' ? 'paused' : 'active';
      setActionLoading(schedule.scheduleId);
      try {
        await ScheduleService.update(numaPut, schedule.scheduleId, { status: newStatus });
        await loadSchedules();
      } catch (err) {
        console.error('Failed to update schedule status:', err);
        setError((err as Error)?.message ?? t('scheduling.errors.updateStatus'));
      } finally {
        setActionLoading(null);
      }
    },
    [numaPut, loadSchedules, t]
  );

  const handleDeleteClick = useCallback((e: React.MouseEvent, schedule: AgentSchedule) => {
    e.stopPropagation();
    setScheduleToDelete(schedule);
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!scheduleToDelete) return;
    setActionLoading(scheduleToDelete.scheduleId);
    try {
      await ScheduleService.delete(numaDelete, scheduleToDelete.scheduleId);
      setShowDeleteConfirm(false);
      setScheduleToDelete(null);
      await loadSchedules();
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      setError((err as Error)?.message ?? t('scheduling.errors.delete'));
    } finally {
      setActionLoading(null);
    }
  }, [scheduleToDelete, numaDelete, loadSchedules, t]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setScheduleToDelete(null);
  }, []);

  // --- Run history helpers ---

  const extractUserIdFromS3Key = useCallback((s3Key: string | undefined): string | null => {
    if (!s3Key) return null;
    const parts = s3Key.split('/');
    if (parts.length >= 4 && parts[0] === 'numa-chat' && parts[1] === 'scheduled-runs') {
      return parts[2];
    }
    return null;
  }, []);

  const getUserIdFromToken = useCallback(async (): Promise<string | null> => {
    try {
      const accessToken = await getAccessToken();
      if (accessToken) {
        const decoded = jwtDecode<{ sub?: string }>(accessToken);
        if (decoded.sub) return decoded.sub;
      }
    } catch {
      // Fall through
    }
    try {
      const idToken = localStorage.getItem('idToken');
      if (idToken) {
        const decoded = jwtDecode<{ sub?: string }>(idToken);
        return decoded.sub ?? null;
      }
    } catch {
      // Give up
    }
    return null;
  }, [getAccessToken]);

  const handleDownloadArtifact = useCallback(
    async (conversationId: string, userId: string, filename: string) => {
      if (!outputsBucket || !region || !getCredentials) return;
      const s3Key = `numa-chat/workspace/${userId}/conversations/${conversationId}/outputs/${filename}`;
      try {
        await downloadFileFromS3(s3Key, outputsBucket, region, getCredentials, filename);
      } catch (err) {
        console.error('Failed to download artifact:', err);
      }
    },
    [outputsBucket, region, getCredentials]
  );

  const loadRunHistoryForSchedule = useCallback(
    async (schedule: AgentSchedule) => {
      if (!outputsBucket || !region || !getCredentials) return;

      setRunHistoryLoading((prev) => ({ ...prev, [schedule.scheduleId]: true }));

      try {
        let userId = extractUserIdFromS3Key(schedule.lastRunS3Key);
        if (!userId) {
          userId = await getUserIdFromToken();
        }
        if (!userId) {
          setRunHistoryLoading((prev) => ({ ...prev, [schedule.scheduleId]: false }));
          return;
        }

        const prefix = `numa-chat/scheduled-runs/${userId}/${schedule.scheduleId}/`;
        const keys = await listObjectsInFolder(prefix, outputsBucket, region, getCredentials);

        const runs: RunHistoryItem[] = keys
          .filter((key) => key && key.endsWith('.json'))
          .map((key) => ({
            runId: key.split('/').pop()?.replace('.json', '') ?? '',
            s3Key: key,
            timestamp: new Date(0),
          }));

        // Batch-load logs for all runs (up to 10 most recent)
        const toLoad = runs.slice(0, 5);
        const loaded = await Promise.all(
          toLoad.map(async (run) => {
            try {
              const blob = await fetchFileFromS3(run.s3Key, outputsBucket, region, getCredentials);
              const text = await blob.text();
              const log = JSON.parse(text) as ScheduledRunLog;
              return {
                ...run,
                log,
                timestamp: log.startedAt ? new Date(log.startedAt) : run.timestamp,
              };
            } catch {
              return { ...run, error: t('scheduling.errors.loadRunLog') };
            }
          })
        );

        // Sort newest first
        loaded.sort((a, b) => getRunSortTime(b) - getRunSortTime(a));
        setRunHistoryBySchedule((prev) => ({ ...prev, [schedule.scheduleId]: loaded }));
      } catch (err) {
        console.error('Failed to load run history:', err);
      } finally {
        setRunHistoryLoading((prev) => ({ ...prev, [schedule.scheduleId]: false }));
      }
    },
    [outputsBucket, region, getCredentials, extractUserIdFromS3Key, getUserIdFromToken, fetchFileFromS3, t]
  );

  const handleToggleScheduleExpand = useCallback(
    (e: React.MouseEvent, schedule: AgentSchedule) => {
      e.stopPropagation();
      const id = schedule.scheduleId;
      if (expandedScheduleId === id) {
        setExpandedScheduleId(null);
      } else {
        setExpandedScheduleId(id);
        if (!runHistoryBySchedule[id] && !runHistoryLoading[id]) {
          loadRunHistoryForSchedule(schedule);
        }
      }
    },
    [expandedScheduleId, runHistoryBySchedule, runHistoryLoading, loadRunHistoryForSchedule]
  );

  // Compute next run for each schedule
  const schedulesWithNextRun = useMemo<ScheduleWithNextRun[]>(() => {
    return schedules.map((schedule) => {
      // Paused or deleted schedules have no next run
      if (schedule.status !== 'active') {
        return {
          ...schedule,
          nextRun: null,
        };
      }
      const nextRuns = getNextRunTimes(schedule.cronExpression, schedule.timezone ?? 'UTC', 1);
      return {
        ...schedule,
        nextRun: nextRuns[0] ?? null,
      };
    });
  }, [schedules]);

  const timezoneOptions = useMemo(() => {
    const zones = new Set<string>();
    schedulesWithNextRun.forEach((schedule) => {
      zones.add(schedule.timezone ?? 'unknown');
    });
    return Array.from(zones).sort((a, b) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return a.localeCompare(b);
    });
  }, [schedulesWithNextRun]);

  const agentOptions = useMemo(() => {
    const map = new Map<string, string>();
    schedulesWithNextRun.forEach((schedule) => {
      const value = schedule.agentId || schedule.agentTitle || 'unknown';
      const label = schedule.agentTitle || schedule.agentId || t('scheduling.filters.agent.unknown');
      map.set(value, label);
    });
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => {
        if (a.value === 'unknown') return 1;
        if (b.value === 'unknown') return -1;
        return a.label.localeCompare(b.label);
      });
  }, [schedulesWithNextRun, t]);

  const agentFilterOptions = useMemo<FilterOption[]>(
    () => [{ value: 'all', label: t('scheduling.filters.agent.all') }, ...agentOptions],
    [agentOptions, t]
  );

  const statusFilterOptions = useMemo<FilterOption[]>(
    () => [
      { value: 'all', label: t('scheduling.filters.status.all') },
      { value: 'active', label: t('scheduling.status.active') },
      { value: 'inactive', label: t('scheduling.status.inactive') },
      { value: 'paused', label: t('scheduling.status.paused') },
      { value: 'deleted', label: t('scheduling.status.deleted') },
    ],
    [t]
  );

  const timezoneFilterOptions = useMemo<FilterOption[]>(
    () => [
      { value: 'all', label: t('scheduling.filters.timezone.all') },
      ...timezoneOptions.map((timezone) => ({
        value: timezone,
        label: timezone === 'unknown' ? t('scheduling.filters.timezone.unknown') : timezone,
      })),
    ],
    [timezoneOptions, t]
  );

  const filteredSchedules = useMemo(() => {
    let result = schedulesWithNextRun;
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (normalizedSearch) {
      result = result.filter((schedule) => {
        const nameMatch = schedule.label?.toLowerCase().includes(normalizedSearch) ?? false;
        const agentValue = schedule.agentTitle || schedule.agentId || '';
        const agentMatch = agentValue.toLowerCase().includes(normalizedSearch);
        return nameMatch || agentMatch;
      });
    }

    if (statusFilter !== 'all') {
      result = result.filter((schedule) => getDerivedStatus(schedule) === statusFilter);
    }

    if (timezoneFilter !== 'all') {
      result = result.filter((schedule) => (schedule.timezone ?? 'unknown') === timezoneFilter);
    }

    if (agentFilter !== 'all') {
      result = result.filter((schedule) => {
        const value = schedule.agentId || schedule.agentTitle || 'unknown';
        return value === agentFilter;
      });
    }

    return result;
  }, [schedulesWithNextRun, searchTerm, statusFilter, timezoneFilter, agentFilter]);

  const sortedSchedules = useMemo(() => {
    if (!sortField) return filteredSchedules;

    const direction = sortDirection === 'asc' ? 1 : -1;

    const getSortMeta = (schedule: ScheduleWithNextRun) => {
      switch (sortField) {
        case 'name':
          return { value: (schedule.label || '').toLowerCase(), missing: !schedule.label, type: 'string' as const };
        case 'agent': {
          const agentValue = schedule.agentTitle || schedule.agentId || '';
          return { value: agentValue.toLowerCase(), missing: !agentValue, type: 'string' as const };
        }
        case 'schedule':
          return {
            value: (schedule.cronExpression || '').toLowerCase(),
            missing: !schedule.cronExpression,
            type: 'string' as const,
          };
        case 'nextRun':
          return {
            value: schedule.nextRun?.getTime() ?? 0,
            missing: !schedule.nextRun,
            type: 'number' as const,
          };
        case 'lastRun':
          return {
            value: schedule.lastRunEpoch ?? 0,
            missing: !schedule.lastRunEpoch,
            type: 'number' as const,
          };
        case 'status':
          return {
            value: getDerivedStatus(schedule).toLowerCase(),
            missing: !getDerivedStatus(schedule),
            type: 'string' as const,
          };
        case 'timezone':
          return {
            value: (schedule.timezone || '').toLowerCase(),
            missing: !schedule.timezone,
            type: 'string' as const,
          };
        default:
          return { value: '', missing: true, type: 'string' as const };
      }
    };

    return [...filteredSchedules].sort((a, b) => {
      const aMeta = getSortMeta(a);
      const bMeta = getSortMeta(b);

      if (aMeta.missing && bMeta.missing) return 0;
      if (aMeta.missing) return 1;
      if (bMeta.missing) return -1;

      if (aMeta.type === 'number' && bMeta.type === 'number') {
        return (aMeta.value - bMeta.value) * direction;
      }

      return String(aMeta.value).localeCompare(String(bMeta.value)) * direction;
    });
  }, [filteredSchedules, sortDirection, sortField]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((current) => {
      if (current === field) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        return current;
      }
      setSortDirection('asc');
      return field;
    });
  }, []);

  // Build a minimal agent object for the edit modal
  const editingAgent = useMemo(() => {
    if (!editingSchedule) return null;
    return {
      agentId: editingSchedule.agentId,
      title: editingSchedule.agentTitle || editingSchedule.agentId,
    };
  }, [editingSchedule]);

  return (
    <div className="dashboard scheduling-page">
      <PageHeader
        title={t('scheduling.page.title')}
        subtitle={t('scheduling.page.subtitle')}
        actions={
          <>
            <Button
              variant="secondary"
              className="standard-refresh-btn text-nowrap"
              onClick={() => setShowDebugIds((current) => !current)}
            >
              <i className="bi bi-bug standard-refresh-btn__icon" aria-hidden="true"></i>
              <span className="standard-refresh-btn__label">
                {showDebugIds ? t('scheduling.debug.hideIds') : t('scheduling.debug.showIds')}
              </span>
            </Button>
            <Button
              variant="secondary"
              className="standard-refresh-btn text-nowrap"
              onClick={loadSchedules}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  <span className="standard-refresh-btn__label">{t('scheduling.actions.refresh')}</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} className="standard-refresh-btn__icon" aria-hidden="true" />
                  <span className="standard-refresh-btn__label">{t('scheduling.actions.refresh')}</span>
                </>
              )}
            </Button>
          </>
        }
      />
      <LayoutDashboard>
        <Container fluid className="scheduling-content">
          {error && (
            <Alert variant="danger" onClose={() => setError(null)} dismissible className="mb-4">
              {error}
            </Alert>
          )}

          <Row className="g-0">
            <Col>
              <StickyToolbar className="scheduling-toolbar">
                <Row className="g-3 align-items-end scheduling-toolbar-row">
                  <Col md={3}>
                    <Form.Group className="scheduling-search-group">
                      <div className="position-relative">
                        <Form.Control
                          type="text"
                          placeholder={t('scheduling.filters.search.shortPlaceholder')}
                          value={searchTerm}
                          aria-label={t('scheduling.filters.search.label')}
                          className="scheduling-search-input"
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search size={16} className="scheduling-search-icon" aria-hidden="true" />
                      </div>
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <FilterDropdown
                        id="scheduling-agent-filter"
                        ariaLabel={t('scheduling.filters.agent.aria')}
                        value={agentFilter}
                        options={agentFilterOptions}
                        onChange={setAgentFilter}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <FilterDropdown
                        id="scheduling-status-filter"
                        ariaLabel={t('scheduling.filters.status.aria')}
                        value={statusFilter}
                        options={statusFilterOptions}
                        onChange={setStatusFilter}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <FilterDropdown
                        id="scheduling-timezone-filter"
                        ariaLabel={t('scheduling.filters.timezone.aria')}
                        value={timezoneFilter}
                        options={timezoneFilterOptions}
                        onChange={setTimezoneFilter}
                      />
                    </Form.Group>
                  </Col>
                </Row>
              </StickyToolbar>
              <Card className="scheduling-table-card">
                <Card.Body className="p-0">
                  {loading && schedules.length === 0 ? (
                    <div className="text-center py-5">
                      <Spinner animation="border" />
                      <p className="mt-3 text-muted">{t('scheduling.loading')}</p>
                    </div>
                  ) : schedules.length === 0 ? (
                    <div className="text-center py-5">
                      <i className="bi bi-calendar-x fs-1 text-muted"></i>
                      <p className="mt-3 text-muted">{t('scheduling.page.empty')}</p>
                    </div>
                  ) : filteredSchedules.length === 0 ? (
                    <div className="text-center py-5">
                      <i className="bi bi-funnel fs-1 text-muted"></i>
                      <p className="mt-3 text-muted">{t('scheduling.page.emptyFiltered')}</p>
                    </div>
                  ) : (
                    <div className="table-responsive file-table-container scrollable scheduling-table-wrap">
                      <Table hover className="mb-0 file-table auto-layout scheduling-table">
                        <thead className="sticky-table-header numa-table-header">
                          <tr>
                            <th style={{ width: '2.5rem' }} aria-label={t('scheduling.page.runHistory.expand')}></th>
                            <th onClick={() => handleSort('name')} className="sortable-header">
                              {t('scheduling.page.columns.name')}{' '}
                              {sortField === 'name' && (
                                <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                              )}
                            </th>
                            <th onClick={() => handleSort('agent')} className="sortable-header">
                              {t('scheduling.page.columns.agent')}{' '}
                              {sortField === 'agent' && (
                                <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                              )}
                            </th>
                            <th onClick={() => handleSort('schedule')} className="sortable-header">
                              {t('scheduling.page.columns.schedule')}{' '}
                              {sortField === 'schedule' && (
                                <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                              )}
                            </th>
                            <th onClick={() => handleSort('nextRun')} className="sortable-header">
                              {t('scheduling.page.columns.nextRun')}{' '}
                              {sortField === 'nextRun' && (
                                <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                              )}
                            </th>
                            <th onClick={() => handleSort('lastRun')} className="sortable-header">
                              {t('scheduling.page.columns.lastRun')}{' '}
                              {sortField === 'lastRun' && (
                                <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                              )}
                            </th>
                            <th onClick={() => handleSort('status')} className="sortable-header">
                              {t('scheduling.page.columns.status')}{' '}
                              {sortField === 'status' && (
                                <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                              )}
                            </th>
                            <th onClick={() => handleSort('timezone')} className="sortable-header">
                              {t('scheduling.page.columns.timezone')}{' '}
                              {sortField === 'timezone' && (
                                <i className={`bi bi-caret-${sortDirection === 'asc' ? 'up' : 'down'}-fill ms-1`}></i>
                              )}
                            </th>
                            <th className="scheduling-actions-column">{t('scheduling.page.columns.actions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedSchedules.map((schedule) => {
                            const derivedStatus = getDerivedStatus(schedule);
                            const isExpanded = expandedScheduleId === schedule.scheduleId;
                            const runs = runHistoryBySchedule[schedule.scheduleId] ?? [];
                            const isLoadingRuns = runHistoryLoading[schedule.scheduleId] ?? false;
                            return (
                              <React.Fragment key={schedule.scheduleId}>
                                <tr onClick={() => handleScheduleClick(schedule)} className="scheduling-table-row">
                                  <td
                                    onClick={(e) => handleToggleScheduleExpand(e, schedule)}
                                    style={{ cursor: 'pointer', textAlign: 'center', verticalAlign: 'middle' }}
                                    aria-label={t('scheduling.page.runHistory.expand')}
                                  >
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  </td>
                                  <td>
                                    <strong>{schedule.label || t('scheduling.labels.unnamed')}</strong>
                                    {showDebugIds && (
                                      <>
                                        <br />
                                        <small className="text-muted">{schedule.scheduleId}</small>
                                      </>
                                    )}
                                  </td>
                                  <td>{schedule.agentTitle || schedule.agentId || '-'}</td>
                                  <td>
                                    <span>{describeCronExpression(schedule.cronExpression)}</span>
                                    {showDebugIds && (
                                      <>
                                        <br />
                                        <small className="text-muted font-monospace">{schedule.cronExpression}</small>
                                      </>
                                    )}
                                  </td>
                                  <td>
                                    {formatDate(
                                      schedule.nextRun,
                                      { notAvailable: t('scheduling.labels.notAvailable') },
                                      schedule.timezone
                                    )}
                                  </td>
                                  <td>
                                    {schedule.lastRunEpoch
                                      ? formatDate(
                                          new Date(schedule.lastRunEpoch),
                                          { notAvailable: t('scheduling.labels.notAvailable') },
                                          schedule.timezone
                                        )
                                      : t('scheduling.labels.never')}
                                    {schedule.lastStatus && (
                                      <>
                                        <br />
                                        <small className="text-muted">{schedule.lastStatus}</small>
                                      </>
                                    )}
                                  </td>
                                  <td>
                                    <Badge bg={getStatusBadgeVariant(derivedStatus)}>
                                      {t(`scheduling.status.${derivedStatus}`, derivedStatus)}
                                    </Badge>
                                  </td>
                                  <td>
                                    <small>{schedule.timezone}</small>
                                  </td>
                                  <td>
                                    <ButtonGroup size="sm" className="scheduling-action-group">
                                      <Button
                                        variant="outline-secondary"
                                        onClick={(e) => handleEditSchedule(e, schedule)}
                                        title={t('scheduling.actions.edit')}
                                        disabled={actionLoading === schedule.scheduleId}
                                      >
                                        <i className="bi bi-pencil"></i>
                                      </Button>
                                      <Button
                                        variant={schedule.status === 'active' ? 'outline-warning' : 'outline-success'}
                                        onClick={(e) => handleTogglePause(e, schedule)}
                                        title={
                                          schedule.status === 'active'
                                            ? t('scheduling.actions.pause')
                                            : t('scheduling.actions.resume')
                                        }
                                        disabled={actionLoading === schedule.scheduleId}
                                      >
                                        {actionLoading === schedule.scheduleId ? (
                                          <Spinner animation="border" size="sm" />
                                        ) : (
                                          <i
                                            className={
                                              schedule.status === 'active' ? 'bi bi-pause-fill' : 'bi bi-play-fill'
                                            }
                                          ></i>
                                        )}
                                      </Button>
                                      <Button
                                        variant="outline-danger"
                                        onClick={(e) => handleDeleteClick(e, schedule)}
                                        title={t('scheduling.actions.delete')}
                                        disabled={actionLoading === schedule.scheduleId}
                                      >
                                        <i className="bi bi-trash"></i>
                                      </Button>
                                    </ButtonGroup>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr>
                                    <td
                                      colSpan={9}
                                      className="p-0 border-0"
                                      style={
                                        {
                                          backgroundColor: '#f8f9fa',
                                          '--bs-table-hover-bg': '#f8f9fa',
                                        } as React.CSSProperties
                                      }
                                    >
                                      <div className="p-3">
                                        <div className="d-flex align-items-center justify-content-between mb-3">
                                          <h6 className="mb-0">
                                            <i className="bi bi-clock-history me-2" aria-hidden="true"></i>
                                            {t('scheduling.page.runHistory.title')}
                                          </h6>
                                          <Button
                                            variant="outline-secondary"
                                            size="sm"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigate(`/scheduling/${schedule.scheduleId}`, { state: { schedule } });
                                            }}
                                          >
                                            {t('scheduling.page.runHistory.viewAll')}
                                            <i className="bi bi-arrow-right ms-1" aria-hidden="true"></i>
                                          </Button>
                                        </div>
                                        {isLoadingRuns ? (
                                          <div className="text-center py-3">
                                            <Spinner animation="border" size="sm" />
                                            <span className="ms-2 text-muted">
                                              {t('scheduling.details.runHistory.loading')}
                                            </span>
                                          </div>
                                        ) : runs.length === 0 ? (
                                          <div className="text-center py-3 text-muted fst-italic">
                                            {t('scheduling.page.runHistory.noRuns')}
                                          </div>
                                        ) : (
                                          <div className="d-flex flex-column gap-3">
                                            {runs.map((run) => {
                                              const statusBadge = run.error ? (
                                                <Badge bg="danger">
                                                  {t('scheduling.details.runHistory.status.error')}
                                                </Badge>
                                              ) : run.log?.error ? (
                                                <Badge bg="danger">
                                                  {t('scheduling.details.runHistory.status.failed')}
                                                </Badge>
                                              ) : run.log?.agentStatus ? (
                                                <Badge
                                                  bg={
                                                    run.log.agentStatus.status === 'success'
                                                      ? 'success'
                                                      : run.log.agentStatus.status === 'partial'
                                                        ? 'warning'
                                                        : 'danger'
                                                  }
                                                >
                                                  {t(
                                                    `scheduling.details.runHistory.status.${run.log.agentStatus.status}`,
                                                    run.log.agentStatus.status
                                                  )}
                                                </Badge>
                                              ) : run.log ? (
                                                <Badge bg="success">
                                                  {t('scheduling.details.runHistory.status.completed')}
                                                </Badge>
                                              ) : (
                                                <Badge bg="secondary">
                                                  {t('scheduling.details.runHistory.placeholder')}
                                                </Badge>
                                              );

                                              const startedStr = run.log?.startedAt
                                                ? new Date(run.log.startedAt).toLocaleString(
                                                    undefined,
                                                    schedule.timezone ? { timeZone: schedule.timezone } : undefined
                                                  )
                                                : null;
                                              const duration = formatDuration(run.log?.startedAt, run.log?.completedAt);

                                              return (
                                                <Card
                                                  key={run.runId}
                                                  className="border"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  <Card.Header className="d-flex align-items-center gap-2 py-2 px-3">
                                                    {statusBadge}
                                                    {startedStr && (
                                                      <small className="text-muted">
                                                        <i className="bi bi-clock me-1" aria-hidden="true"></i>
                                                        {startedStr}
                                                      </small>
                                                    )}
                                                    {duration && <small className="text-muted">{duration}</small>}
                                                  </Card.Header>
                                                  <Card.Body className="py-2 px-3">
                                                    <RunHistoryExpandedRow
                                                      run={run}
                                                      onDownloadArtifact={handleDownloadArtifact}
                                                    />
                                                  </Card.Body>
                                                </Card>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </LayoutDashboard>

      {editingAgent && (
        <AgentScheduleModal
          show={showEditModal}
          onHide={handleCloseEditModal}
          agent={editingAgent}
          editingSchedule={editingSchedule}
          onCreate={handleUpdateSchedule}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteConfirm} onHide={handleCancelDelete} centered>
        <Modal.Header closeButton>
          <Modal.Title className="text-danger">
            <i className="bi bi-exclamation-triangle-fill me-2"></i>
            {t('scheduling.delete.title')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            {t('scheduling.delete.confirmPrefix')}{' '}
            <strong>{scheduleToDelete?.label || t('scheduling.labels.unnamed')}</strong>
            {t('scheduling.delete.confirmSuffix')}
          </p>
          <Alert variant="warning" className="mb-0">
            <i className="bi bi-exclamation-triangle me-2"></i>
            <strong>{t('scheduling.delete.warningTitle')}</strong> {t('scheduling.delete.warningBody')}
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCancelDelete} disabled={actionLoading !== null}>
            {t('scheduling.actions.cancel')}
          </Button>
          <Button variant="danger" onClick={handleConfirmDelete} disabled={actionLoading !== null}>
            {actionLoading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                {t('scheduling.delete.deleting')}
              </>
            ) : (
              <>
                <i className="bi bi-trash me-2"></i>
                {t('scheduling.delete.confirmButton')}
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default SchedulingPage;
