import { Fragment, useCallback, useEffect, useMemo, useState, useRef, type ChangeEvent } from 'react';
import {
  Card,
  Row,
  Col,
  Form,
  Button,
  Table,
  Alert,
  Badge,
  Spinner,
  Modal,
  Tabs,
  Tab,
  InputGroup,
  ButtonGroup,
  ToggleButton,
  ListGroup,
} from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { Upload } from 'react-bootstrap-icons';
import { clientService } from '@/services/clientService';
import { ClientSelectGroup } from '@/components/ClientSelectGroup';
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector';
import { parseClientNamesFromCSV } from '@/utils/csvUtils';
import { ecrService } from '@/services/ecrService';
import { useAuth } from '@/contexts/AuthContext';
import {
  startDeployment,
  listDeploymentsByTimeRange,
  listDeploymentGroups,
  saveDeploymentGroup,
  deleteDeploymentGroup,
  startGroupDeployment,
  buildCloudwatchLogsUrl,
  getDeploymentById,
  buildStepFunctionsUrl,
  buildEcsTaskUrl,
  type DeploymentRecord,
  overrideDeploymentStatus,
  listDeploymentLocks,
  releaseDeploymentLock,
  type DeploymentLockRecord,
  stopDeployment,
  stopGroupDeployment,
  getGroupConcurrencyBounds,
  type ListByTimeRangeResult,
} from '@/services/deploymentService';
import { getConfigValue } from '@/services/configService';
import type { ECRImage, Client, DeploymentGroup } from '@/types';

export default function Deployments() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [images, setImages] = useState<ECRImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [deploymentLabel, setDeploymentLabel] = useState<string>('');
  const [groupDeploymentLabel, setGroupDeploymentLabel] = useState<string>('');
  const [history, setHistory] = useState<DeploymentRecord[]>([]);
  const [historyNextKey, setHistoryNextKey] = useState<Record<string, unknown> | undefined>(undefined);
  const [historyPeriod, setHistoryPeriod] = useState<'7d' | '14d' | '30d' | '90d'>('7d');
  const [hideGroupMembers, setHideGroupMembers] = useState<boolean>(true);
  const [locks, setLocks] = useState<DeploymentLockRecord[]>([]);
  const [filteredClient, setFilteredClient] = useState<string>('all');
  const [isSingleSubmitting, setIsSingleSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'history' | 'groups' | 'locks'>('history');
  const [lockActionId, setLockActionId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const concurrencyBounds = useMemo(() => getGroupConcurrencyBounds(), []);
  const defaultGroupConcurrency = concurrencyBounds.default ?? 10;
  const absoluteMaxGroupConcurrency = concurrencyBounds.max ?? 30;
  const clampGroupConcurrencyValue = useCallback(
    (value: number) => Math.max(1, Math.min(value, absoluteMaxGroupConcurrency)),
    [absoluteMaxGroupConcurrency]
  );
  const [deployMode, setDeployMode] = useState<'single' | 'group'>('single');
  const [groups, setGroups] = useState<DeploymentGroup[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [selectedGroupName, setSelectedGroupName] = useState<string>('');
  const [groupConcurrency, setGroupConcurrency] = useState<number>(defaultGroupConcurrency);
  const [isGroupSubmitting, setIsGroupSubmitting] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalError, setGroupModalError] = useState<string | null>(null);
  const [groupModalBusy, setGroupModalBusy] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DeploymentGroup | null>(null);
  const [groupForm, setGroupForm] = useState<{
    groupName: string;
    clients: string[];
    description: string;
    maxConcurrency?: number;
  }>({
    groupName: '',
    clients: [],
    description: '',
    maxConcurrency: undefined,
  });
  const groupCsvInputRef = useRef<HTMLInputElement>(null);
  const [groupCsvFeedback, setGroupCsvFeedback] = useState<string | null>(null);
  const sfnArn = getConfigValue('DEPLOYMENT_SFN_ARN');
  const groupSfnArn = getConfigValue('DEPLOYMENT_GROUP_SFN_ARN');
  const deploymentsTable = getConfigValue('DEPLOYMENTS_TABLE');
  const groupsTable = getConfigValue('DEPLOYMENT_GROUPS_TABLE');
  const awsRegion = getConfigValue('AWS_REGION') || 'us-east-1';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [cs, imgs] = await Promise.all([clientService.getAllClients(), ecrService.getAllImages()]);

        setClients(cs);
        setImages(imgs);
        if (cs[0]) setSelectedClient(cs[0].name);
        const latest = imgs.find((i) => i.tag === 'latest') || imgs[0];
        if (latest) setSelectedTag(latest.tag);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime());
  }, [images]);

  const formatPushedAt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const formatStartedNz = (iso?: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
    } catch {
      return iso;
    }
  };

  const formatDuration = (start?: string, end?: string): string => {
    if (!start) return '';
    const startMs = Date.parse(start);
    const endMs = end ? Date.parse(end) : Date.now();
    if (isNaN(startMs) || isNaN(endMs)) return '';
    let secs = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const h = Math.floor(secs / 3600);
    secs -= h * 3600;
    const m = Math.floor(secs / 60);
    secs -= m * 60;
    const parts: string[] = [];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
  };

  const computeFromIso = useCallback(() => {
    const now = Date.now();
    const days = historyPeriod === '7d' ? 7 : historyPeriod === '14d' ? 14 : historyPeriod === '30d' ? 30 : 90;
    return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  }, [historyPeriod]);

  const loadHistory = useCallback(async () => {
    if (!deploymentsTable) {
      setLocks([]);
      return;
    }
    setIsRefreshing(true);
    try {
      const fromIso = computeFromIso();
      const [firstPage, lockItems] = await Promise.all([
        listDeploymentsByTimeRange({ fromIso, pageSize: 100 }),
        listDeploymentLocks(),
      ]);
      setHistory(firstPage.items);
      setHistoryNextKey(firstPage.lastEvaluatedKey);
      setLocks(lockItems);
    } catch (error) {
      console.warn('Failed to load deployment history', error);
      setLocks([]);
    } finally {
      setIsRefreshing(false);
    }
  }, [deploymentsTable, computeFromIso]);

  const loadMoreHistory = useCallback(async () => {
    if (!deploymentsTable || !historyNextKey) return;
    try {
      const fromIso = computeFromIso();
      const page: ListByTimeRangeResult = await listDeploymentsByTimeRange({
        fromIso,
        exclusiveStartKey: historyNextKey,
        pageSize: 100,
      });
      setHistory((prev) => [...prev, ...page.items]);
      setHistoryNextKey(page.lastEvaluatedKey);
    } catch (e) {
      console.warn('Failed to load more history', e);
    }
  }, [deploymentsTable, historyNextKey, computeFromIso]);

  const loadGroups = useCallback(async () => {
    setIsLoadingGroups(true);
    try {
      const items = await listDeploymentGroups();
      setGroups(items);
    } catch (e) {
      console.error('Failed to load deployment groups:', e);
      setError(e instanceof Error ? e.message : 'Failed to load deployment groups');
    } finally {
      setIsLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (groups.length === 0) {
      if (selectedGroupName) setSelectedGroupName('');
      return;
    }
    if (!selectedGroupName || !groups.some((group) => group.groupName === selectedGroupName)) {
      const first = groups[0];
      setSelectedGroupName(first.groupName);
      const initial = clampGroupConcurrencyValue(first.maxConcurrency ?? defaultGroupConcurrency);
      setGroupConcurrency(initial);
    }
  }, [groups, selectedGroupName, defaultGroupConcurrency, clampGroupConcurrencyValue]);

  useEffect(() => {
    const group = groups.find((g) => g.groupName === selectedGroupName);
    if (!group) return;
    const recommended = clampGroupConcurrencyValue(group.maxConcurrency ?? defaultGroupConcurrency);
    setGroupConcurrency((prev) => (prev === recommended ? prev : recommended));
  }, [groups, selectedGroupName, defaultGroupConcurrency, clampGroupConcurrencyValue]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.groupName === selectedGroupName) ?? null,
    [groups, selectedGroupName]
  );
  const selectedGroupIsManaged = Boolean(selectedGroup?.managed);
  const selectedGroupClientCount = selectedGroup?.clients.length ?? 0;
  const canGroupDeploy = useMemo(
    () => Boolean(selectedGroup && groupSfnArn && selectedTag && !isGroupSubmitting && selectedGroupClientCount > 0),
    [selectedGroup, groupSfnArn, selectedTag, isGroupSubmitting, selectedGroupClientCount]
  );
  const groupConfigMissing = !groupSfnArn || !groupsTable;

  const isGroupRecord = (record: DeploymentRecord): boolean => {
    // True group summary records:
    // - explicitly marked entityType === 'group'
    // - clientName prefixed with 'group#'
    // - deploymentId is a groupRunId (starts with 'group-' and has no '#' child suffix)
    if (record.entityType === 'group') return true;
    if (record.clientName?.startsWith('group#')) return true;
    return record.deploymentId.startsWith('group-') && !record.deploymentId.includes('#');
  };

  const groupRecords = useMemo(() => {
    return history
      .filter(isGroupRecord)
      .slice()
      .sort((a, b) => {
        const timeA = a.startedAt ? Date.parse(a.startedAt) : 0;
        const timeB = b.startedAt ? Date.parse(b.startedAt) : 0;
        return timeB - timeA;
      });
  }, [history]);

  const filteredHistory = useMemo(() => {
    let items = history;
    if (hideGroupMembers) {
      items = items.filter((r) => !(r.groupRunId && r.deploymentId.includes('#')));
    }
    if (filteredClient === 'all') return items;
    return items.filter((h) => h.clientName === filteredClient);
  }, [history, filteredClient, hideGroupMembers]);

  const sortedLocks = useMemo(() => {
    return [...locks].sort((a, b) => {
      const aTime = a.startedAt ? Date.parse(a.startedAt) : 0;
      const bTime = b.startedAt ? Date.parse(b.startedAt) : 0;
      return bTime - aTime;
    });
  }, [locks]);

  const hasInFlight = useMemo(() => {
    // Check for in-flight deployments only for the selected client (for deployment form)
    const deploymentRunning = history.some((h) => {
      const s = (h.status || '').toLowerCase();
      const isRunning = s === 'running' || s === 'retrying';
      return isRunning && h.clientName === selectedClient;
    });
    const lockHeld = locks.some((lock) => lock.clientName === selectedClient);
    return deploymentRunning || lockHeld;
  }, [history, selectedClient, locks]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const canSingleDeploy = useMemo(
    () =>
      Boolean(
        selectedClient &&
        selectedTag &&
        !isSingleSubmitting &&
        sfnArn &&
        !hasInFlight &&
        deploymentLabel.trim().length > 0
      ),
    [selectedClient, selectedTag, isSingleSubmitting, sfnArn, hasInFlight, deploymentLabel]
  );

  const handleTabSelect = (key: string | null) => {
    if (!key) return;
    setActiveTab(key as 'history' | 'groups' | 'locks');
  };

  const renderGroupRow = (record: DeploymentRecord) => {
    const summaryTotal = record.clientsTotal ?? record.clients?.length ?? 0;
    const summaryCompleted = record.clientsCompleted ?? 0;
    const summarySucceeded = record.clientsSucceeded ?? 0;
    const summaryFailed = record.clientsFailed ?? 0;
    const statusLabel = (record.status || '').toString();
    const statusLower = statusLabel.toLowerCase();
    const statusWithAttempt = record.attemptLabel ? `${statusLabel} (${record.attemptLabel})` : statusLabel;
    const isExpanded = Boolean(expanded[record.deploymentId]);

    let logsGroup = record.logsGroup;
    let logsStream = record.logsStream;
    if (!logsGroup && record.ecsTaskArn) logsGroup = '/ecs/numa-portal-deploy';
    if (!logsStream && record.ecsTaskArn) {
      const taskId = record.ecsTaskArn.split('/').pop() || record.ecsTaskArn;
      logsStream = `ecs/deployer/${taskId}`;
    }

    const logsUrl = buildCloudwatchLogsUrl(awsRegion, logsGroup, logsStream);
    const sfnUrl = buildStepFunctionsUrl(awsRegion, record.sfnExecutionArn);

    let statusVariant: string = 'secondary';
    if (statusLower === 'success') statusVariant = 'primary';
    else if (statusLower === 'failed') statusVariant = 'danger';
    else if (statusLower === 'running' || statusLower === 'retrying' || statusLower === 'partial')
      statusVariant = 'warning';
    const isRunning = statusLower === 'running';
    const isRetrying = statusLower === 'retrying';

    return (
      <Fragment key={record.deploymentId}>
        <tr className="align-middle table-light">
          <td className="py-3">
            <small className="text-muted">{formatStartedNz(record.startedAt)}</small>
          </td>
          <td className="py-3">
            <div className="d-flex align-items-center gap-2">
              <Badge bg="info" text="dark">
                Group
              </Badge>
              <span className="fw-semibold">{record.groupName || record.clientName.replace('group#', '')}</span>
            </div>
          </td>
          <td className="py-3">
            <small className="text-muted">{record.initiatedBy?.split('@')[0] || ''}</small>
          </td>
          <td className="py-3">{record.imageTag || '—'}</td>
          <td className="py-3 text-muted">—</td>
          <td className="py-3">
            <div className="d-flex flex-column">
              <small>{formatDuration(record.startedAt, record.endedAt)}</small>
              {summaryTotal > 0 && (
                <small className="text-muted">
                  {summaryCompleted}/{summaryTotal} complete
                </small>
              )}
            </div>
          </td>
          <td className="py-3">
            <Badge bg={statusVariant}>{statusWithAttempt || '—'}</Badge>
            {summaryTotal > 0 && (
              <div className="small text-muted mt-1">
                <span className="text-success me-2">{summarySucceeded} ✓</span>
                <span className="text-danger">{summaryFailed} ✗</span>
              </div>
            )}
          </td>
          <td className="py-3">
            <div className="d-flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline-primary"
                onClick={() => navigate(`/deployments/group/${record.deploymentId}`)}
              >
                View
              </Button>
              {logsUrl && (
                <Button
                  as="a"
                  href={logsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  variant="outline-secondary"
                >
                  CloudWatch
                </Button>
              )}
              {(isRunning || isRetrying) && (
                <Button
                  size="sm"
                  variant="outline-danger"
                  onClick={() => {
                    setStoppingId(record.deploymentId);
                    void stopGroupDeployment(record, user?.email || 'unknown')
                      .then(loadHistory)
                      .finally(() => setStoppingId(null));
                  }}
                  disabled={stoppingId === record.deploymentId}
                >
                  {stoppingId === record.deploymentId ? <Spinner size="sm" /> : 'Stop'}
                </Button>
              )}
              <Button size="sm" variant="outline-secondary" onClick={() => toggleExpanded(record.deploymentId)}>
                {isExpanded ? 'Hide' : 'Summary'}
              </Button>
              {sfnUrl && (
                <Button
                  as="a"
                  href={sfnUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  variant="outline-secondary"
                >
                  StepFn
                </Button>
              )}
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr>
            <td colSpan={8} className="bg-light">
              <div className="p-3">
                <div className="mb-2">
                  <strong>Group Run ID:</strong> {record.deploymentId}
                </div>
                {record.sfnExecutionArn && (
                  <div className="mb-2">
                    <strong>State Machine Execution:</strong> {record.sfnExecutionArn}
                  </div>
                )}
                <div className="small text-muted">Started: {record.startedAt || 'unknown'}</div>
                <div className="small text-muted">Ended: {record.endedAt || '—'}</div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const handleDeployClick = () => {
    setShowConfirmModal(true);
  };

  const handleConfirmDeploy = async () => {
    if (!user?.email) return;
    setShowConfirmModal(false);
    setIsSingleSubmitting(true);
    setError(null);
    try {
      const { deploymentId } = await startDeployment({
        clientName: selectedClient,
        imageTag: selectedTag,
        initiatedBy: user.email,
        deploymentLabel: deploymentLabel || undefined,
      });

      // Poll the single item with ConsistentRead to ensure visibility after start
      // Poll for the deployment record to ensure it's visible
      const start = Date.now();
      const deadline = start + 15000;
      while (Date.now() < deadline) {
        const rec = await getDeploymentById(deploymentId, true);
        if (rec) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Refresh deployment history
      await loadHistory();

      // Auto-refresh 5 seconds after deployment to catch ECS task ARN
      setTimeout(async () => {
        await loadHistory();
      }, 5000);

      // Clear deployment label after successful submission
      setDeploymentLabel('');
    } catch (e) {
      console.error('Failed to start deployment:', e);
      setError(e instanceof Error ? e.message : 'Failed to start deployment');
    } finally {
      setIsSingleSubmitting(false);
    }
  };

  const handlePlanOnly = async () => {
    if (!user?.email) return;
    setIsSingleSubmitting(true);
    setError(null);
    try {
      const { deploymentId } = await startDeployment({
        clientName: selectedClient,
        imageTag: selectedTag,
        initiatedBy: user.email,
        deploymentLabel: deploymentLabel || undefined,
        mode: 'plan',
      });
      const start = Date.now();
      const deadline = start + 15000;
      while (Date.now() < deadline) {
        const rec = await getDeploymentById(deploymentId, true);
        if (rec) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      await loadHistory();
      setTimeout(async () => {
        await loadHistory();
      }, 5000);
    } catch (e) {
      console.error('Failed to start plan-only:', e);
      setError(e instanceof Error ? e.message : 'Failed to start plan-only');
    } finally {
      setIsSingleSubmitting(false);
    }
  };

  const handleCancelDeploy = () => {
    setShowConfirmModal(false);
  };

  const handleReleaseLock = async (lock: DeploymentLockRecord) => {
    if (
      !confirm(
        `Release lock for ${lock.clientName}?\n\nOnly do this if the Step Function and ECS task have fully stopped.`
      )
    )
      return;
    setLockActionId(lock.deploymentId);
    setError(null);
    try {
      await releaseDeploymentLock(lock.clientName);
      await loadHistory();
    } catch (e) {
      console.error('Failed to release lock:', e);
      setError(e instanceof Error ? e.message : 'Failed to release lock');
    } finally {
      setLockActionId(null);
    }
  };

  const handleDeployModeChange = (mode: 'single' | 'group') => {
    setDeployMode(mode);
  };

  const openCreateGroupModal = () => {
    setEditingGroup(null);
    setGroupForm({ groupName: '', clients: [], description: '', maxConcurrency: undefined });
    setGroupModalError(null);
    setGroupCsvFeedback(null);
    setGroupModalOpen(true);
  };

  const openEditGroupModal = (group: DeploymentGroup) => {
    if (group.managed) {
      return;
    }
    setEditingGroup(group);
    setGroupForm({
      groupName: group.groupName,
      clients: [...group.clients],
      description: group.description ?? '',
      maxConcurrency: group.maxConcurrency,
    });
    setGroupModalError(null);
    setGroupCsvFeedback(null);
    setGroupModalOpen(true);
  };

  const handleGroupModalClose = () => {
    if (groupModalBusy) return;
    setGroupModalOpen(false);
    setGroupModalError(null);
  };

  const handleGroupCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setGroupCsvFeedback(null);

    try {
      const text = await file.text();
      const parsedNames = parseClientNamesFromCSV(text);

      if (parsedNames.length === 0) {
        setGroupCsvFeedback('No client names found in CSV. Ensure the file has a "Client Name" column.');
        return;
      }

      // Match against loaded clients
      const validClientNames = clients.map((c) => c.name);
      const matchedNames = parsedNames.filter((name) => validClientNames.includes(name));
      const unmatchedCount = parsedNames.length - matchedNames.length;

      // Add to selection (union with existing)
      const newSelection = [...new Set([...groupForm.clients, ...matchedNames])];
      setGroupForm((prev) => ({ ...prev, clients: newSelection }));

      if (unmatchedCount > 0) {
        setGroupCsvFeedback(
          `Added ${matchedNames.length} clients. ${unmatchedCount} names in CSV did not match any known client.`
        );
      } else {
        setGroupCsvFeedback(`Added ${matchedNames.length} clients from CSV.`);
      }
    } catch {
      setGroupCsvFeedback('Failed to parse CSV file.');
    }

    // Reset file input
    e.target.value = '';
  };

  const handleGroupFieldChange =
    (key: 'groupName' | 'description') => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setGroupForm((prev) => ({ ...prev, [key]: value }));
    };

  const handleGroupMaxConcurrencyChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (value === '') {
      setGroupForm((prev) => ({ ...prev, maxConcurrency: undefined }));
      return;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    setGroupForm((prev) => ({ ...prev, maxConcurrency: clampGroupConcurrencyValue(parsed) }));
  };

  const handleSaveGroup = async () => {
    if (groupModalBusy) return;
    if (editingGroup?.managed) {
      setGroupModalError('This group is automatically managed and cannot be edited.');
      return;
    }
    const trimmedName = groupForm.groupName.trim();
    if (!trimmedName) {
      setGroupModalError('Group name is required');
      return;
    }
    if (groupForm.clients.length === 0) {
      setGroupModalError('Select at least one client');
      return;
    }
    const existingName = groups.find((g) => g.groupName.toLowerCase() === trimmedName.toLowerCase());
    if (!editingGroup && existingName) {
      setGroupModalError('A group with this name already exists');
      return;
    }
    setGroupModalBusy(true);
    try {
      const payload: DeploymentGroup = {
        groupName: trimmedName,
        clients: Array.from(new Set(groupForm.clients.map((c) => c.trim()).filter(Boolean))).sort(),
        description: groupForm.description?.trim() || undefined,
        maxConcurrency: groupForm.maxConcurrency ? clampGroupConcurrencyValue(groupForm.maxConcurrency) : undefined,
      };
      await saveDeploymentGroup(payload);
      await loadGroups();
      setSelectedGroupName(trimmedName);
      setGroupModalOpen(false);
      setGroupModalError(null);
    } catch (e) {
      console.error('Failed to save deployment group:', e);
      setGroupModalError(e instanceof Error ? e.message : 'Failed to save deployment group');
    } finally {
      setGroupModalBusy(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!editingGroup || groupModalBusy) return;
    if (editingGroup.managed) {
      setGroupModalError('This group is automatically managed and cannot be deleted.');
      return;
    }
    if (!confirm(`Delete deployment group "${editingGroup.groupName}"?`)) return;
    setGroupModalBusy(true);
    try {
      await deleteDeploymentGroup(editingGroup.groupName);
      await loadGroups();
      setGroupModalOpen(false);
      setGroupModalError(null);
    } catch (e) {
      console.error('Failed to delete deployment group:', e);
      setGroupModalError(e instanceof Error ? e.message : 'Failed to delete deployment group');
    } finally {
      setGroupModalBusy(false);
    }
  };

  const handleGroupDeploy = async () => {
    if (!user?.email || !selectedGroup) return;
    setError(null);
    setIsGroupSubmitting(true);
    try {
      const concurrencyValue = clampGroupConcurrencyValue(groupConcurrency);
      const { groupRunId } = await startGroupDeployment({
        groupName: selectedGroup.groupName,
        clients: selectedGroup.clients,
        imageTag: selectedTag,
        initiatedBy: user.email,
        deploymentLabel: groupDeploymentLabel || selectedGroup.groupName,
        maxConcurrency: concurrencyValue,
      });
      await loadHistory();
      setTimeout(async () => {
        await loadHistory();
      }, 5000);
      navigate(`/deployments/group/${groupRunId}`);
    } catch (e) {
      console.error('Failed to start group deployment:', e);
      setError(e instanceof Error ? e.message : 'Failed to start group deployment');
    } finally {
      setIsGroupSubmitting(false);
    }
  };

  const openManageSelectedGroup = () => {
    if (selectedGroupIsManaged) {
      return;
    }
    if (selectedGroup) {
      openEditGroupModal(selectedGroup);
    } else {
      openCreateGroupModal();
    }
  };

  return (
    <div>
      {!sfnArn && (
        <Alert variant="warning">
          Deployments are not configured for this environment. Missing <code>DEPLOYMENT_SFN_ARN</code> in config.
        </Alert>
      )}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h1 className="mb-1">Deployments</h1>
          <p className="text-muted mb-0">Deploy and monitor your applications across environments</p>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Card>
        <Card.Header className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <h5 className="mb-0">Start New Deployment</h5>
          <ButtonGroup>
            <ToggleButton
              id="deploy-mode-single"
              type="radio"
              variant={deployMode === 'single' ? 'primary' : 'outline-primary'}
              value="single"
              checked={deployMode === 'single'}
              onChange={() => handleDeployModeChange('single')}
            >
              Single
            </ToggleButton>
            <ToggleButton
              id="deploy-mode-group"
              type="radio"
              variant={deployMode === 'group' ? 'primary' : 'outline-primary'}
              value="group"
              checked={deployMode === 'group'}
              onChange={() => handleDeployModeChange('group')}
            >
              Group
            </ToggleButton>
          </ButtonGroup>
        </Card.Header>
        <Card.Body>
          {deployMode === 'single' ? (
            <>
              <Row>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Client</Form.Label>
                    <ClientSelectGroup
                      value={selectedClient}
                      onChange={setSelectedClient}
                      clients={clients}
                      disabled={loading || isSingleSubmitting}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Image Tag</Form.Label>
                    <Form.Select
                      value={selectedTag}
                      onChange={(e) => setSelectedTag(e.target.value)}
                      disabled={loading || isSingleSubmitting}
                    >
                      {sortedImages.map((i) => {
                        const isLatest = i.tag === 'latest';
                        const displayName = i.customName || i.tag;
                        const meta: string[] = [];
                        if (i.gitCommit && i.gitCommit !== 'unknown') meta.push(i.gitCommit);
                        if (i.gitBranch && i.gitBranch !== 'feature') meta.push(i.gitBranch);
                        const label = `${isLatest ? displayName + ' ★' : displayName} — ${formatPushedAt(i.pushedAt)}${meta.length ? ' — ' + meta.join(' • ') : ''}`;
                        return (
                          <option key={i.digest + i.tag} value={i.tag}>
                            {label}
                          </option>
                        );
                      })}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>
                      Deployment Label <Badge bg="secondary">Required</Badge>
                    </Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="e.g. Stable release v2.1"
                      value={deploymentLabel}
                      onChange={(e) => setDeploymentLabel(e.target.value)}
                      disabled={loading || isSingleSubmitting}
                    />
                  </Form.Group>
                </Col>
              </Row>

              {hasInFlight && (
                <Alert variant="warning" className="mb-3">
                  A deployment is already running for this client
                </Alert>
              )}

              <Button variant="primary" onClick={handleDeployClick} disabled={!canSingleDeploy}>
                {isSingleSubmitting ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    Deploying...
                  </>
                ) : (
                  'Start Deployment'
                )}
              </Button>
              <Button className="ms-2" variant="outline-primary" onClick={handlePlanOnly} disabled={!canSingleDeploy}>
                Plan Only
              </Button>
            </>
          ) : (
            <>
              {groupConfigMissing && (
                <Alert variant="info" className="mb-3">
                  Group deployments are not fully configured for this environment. Ensure{' '}
                  <code>DEPLOYMENT_GROUP_SFN_ARN</code> and <code>DEPLOYMENT_GROUPS_TABLE</code> are present in the
                  portal config.
                </Alert>
              )}
              {groups.length === 0 ? (
                <Alert variant="secondary" className="mb-3">
                  No deployment groups defined yet.
                  <Button variant="outline-primary" size="sm" className="ms-2" onClick={openCreateGroupModal}>
                    Create Group
                  </Button>
                </Alert>
              ) : (
                <Row>
                  <Col md={5}>
                    <Form.Group className="mb-3">
                      <Form.Label>Deployment Group</Form.Label>
                      <InputGroup>
                        <Form.Select
                          value={selectedGroupName}
                          onChange={(e) => setSelectedGroupName(e.target.value)}
                          disabled={isGroupSubmitting || isLoadingGroups}
                        >
                          {groups.map((group) => {
                            const label = `${group.groupName} (${group.clients.length})${group.managed ? ' • Auto' : ''}`;
                            return (
                              <option key={group.groupName} value={group.groupName}>
                                {label}
                              </option>
                            );
                          })}
                        </Form.Select>
                        <Button
                          variant="outline-secondary"
                          onClick={openManageSelectedGroup}
                          disabled={isGroupSubmitting || isLoadingGroups || selectedGroupIsManaged}
                          title={selectedGroupIsManaged ? 'Auto-managed groups cannot be edited' : undefined}
                        >
                          Manage
                        </Button>
                      </InputGroup>
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group className="mb-3">
                      <Form.Label>Max Concurrency</Form.Label>
                      <InputGroup>
                        <Form.Control
                          type="number"
                          min={1}
                          max={absoluteMaxGroupConcurrency}
                          value={groupConcurrency}
                          onChange={(e) => setGroupConcurrency(clampGroupConcurrencyValue(Number(e.target.value) || 1))}
                          disabled={isGroupSubmitting}
                        />
                        <InputGroup.Text>tasks</InputGroup.Text>
                      </InputGroup>
                      <div className="form-text">
                        Up to {absoluteMaxGroupConcurrency} tasks in parallel
                        {selectedGroup?.maxConcurrency
                          ? ` (group default ${selectedGroup.maxConcurrency})`
                          : ` (default ${defaultGroupConcurrency})`}
                        .
                      </div>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Image Tag</Form.Label>
                      <Form.Select
                        value={selectedTag}
                        onChange={(e) => setSelectedTag(e.target.value)}
                        disabled={isGroupSubmitting}
                      >
                        {sortedImages.map((i) => {
                          const isLatest = i.tag === 'latest';
                          const displayName = i.customName || i.tag;
                          const meta: string[] = [];
                          if (i.gitCommit && i.gitCommit !== 'unknown') meta.push(i.gitCommit);
                          if (i.gitBranch && i.gitBranch !== 'feature') meta.push(i.gitBranch);
                          const label = `${isLatest ? displayName + ' ★' : displayName} — ${formatPushedAt(i.pushedAt)}${meta.length ? ' — ' + meta.join(' • ') : ''}`;
                          return (
                            <option key={i.digest + i.tag} value={i.tag}>
                              {label}
                            </option>
                          );
                        })}
                      </Form.Select>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Deployment Label</Form.Label>
                      <Form.Control
                        type="text"
                        value={groupDeploymentLabel}
                        onChange={(e) => setGroupDeploymentLabel(e.target.value)}
                        placeholder={selectedGroup?.groupName || 'Label for this group run'}
                        disabled={isGroupSubmitting}
                      />
                    </Form.Group>
                  </Col>
                </Row>
              )}

              {selectedGroup && (
                <>
                  {selectedGroup.managed && (
                    <Alert variant="info" className="mb-3">
                      This group updates automatically to include every non-development client stack plus{' '}
                      <code>arcanum-prod-trial</code>, <code>arcanum-prod-numa-demo</code>, and{' '}
                      <code>arcanum-council-trial</code>.
                    </Alert>
                  )}
                  <div className="mb-3">
                    <Form.Label className="fw-semibold">Clients ({selectedGroupClientCount})</Form.Label>
                    <div className="d-flex flex-wrap gap-2">
                      {selectedGroup.clients.map((client) => (
                        <Badge bg="light" key={client} text="dark" className="border">
                          {client}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="d-flex align-items-center gap-2">
                <Button variant="primary" onClick={handleGroupDeploy} disabled={!canGroupDeploy || groupConfigMissing}>
                  {isGroupSubmitting ? (
                    <>
                      <Spinner size="sm" className="me-2" />
                      Starting...
                    </>
                  ) : (
                    'Deploy Group'
                  )}
                </Button>
                <Button variant="outline-secondary" onClick={openCreateGroupModal} disabled={isGroupSubmitting}>
                  New Group
                </Button>
              </div>
            </>
          )}
        </Card.Body>
      </Card>

      <Card className="mt-4">
        <Card.Header>
          <h5 className="mb-0">Deployment Activity</h5>
        </Card.Header>
        <Card.Body className="p-0">
          {!deploymentsTable ? (
            <div className="p-3 text-muted">
              Deployment history table not configured. Missing <code>DEPLOYMENTS_TABLE</code> in config.
            </div>
          ) : (
            <div className="p-3 pb-0">
              <Tabs
                activeKey={activeTab}
                onSelect={handleTabSelect}
                className="nav-pills-custom mb-3"
                variant="pills"
                mountOnEnter
                unmountOnExit={false}
              >
                <Tab eventKey="history" title="History">
                  <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
                    <ClientSelectGroup
                      size="sm"
                      value={filteredClient}
                      onChange={setFilteredClient}
                      clients={clients}
                      showCounts={true}
                      deploymentCounts={clients.reduce(
                        (acc, c) => {
                          acc[c.name] = history.filter((h) => h.clientName === c.name).length;
                          return acc;
                        },
                        {} as Record<string, number>
                      )}
                      style={{ width: '220px' }}
                    />
                    <div className="d-flex align-items-center gap-2">
                      <Form.Select
                        size="sm"
                        value={historyPeriod}
                        onChange={(e) => setHistoryPeriod(e.target.value as any)}
                        style={{ width: 140 }}
                      >
                        <option value="7d">Last 7 days</option>
                        <option value="14d">Last 14 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="90d">Last 90 days</option>
                      </Form.Select>
                      <Form.Check
                        type="checkbox"
                        id="toggle-hide-members"
                        label="Hide group members"
                        checked={hideGroupMembers}
                        onChange={(e) => setHideGroupMembers(e.currentTarget.checked)}
                      />
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={loadHistory}
                        disabled={loading || isSingleSubmitting || isGroupSubmitting || isRefreshing}
                      >
                        {isRefreshing ? (
                          <>
                            <Spinner size="sm" className="me-1" />
                            Refreshing
                          </>
                        ) : (
                          'Refresh'
                        )}
                      </Button>
                    </div>
                  </div>
                  <Table hover responsive className="mb-0">
                    <thead>
                      <tr>
                        <th>Started (NZ)</th>
                        <th>Client</th>
                        <th>Initiated By</th>
                        <th>Version</th>
                        <th>Deployment Label</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-4 text-muted">
                            No deployments yet.
                          </td>
                        </tr>
                      ) : (
                        filteredHistory.map((d) => {
                          const isExpanded = Boolean(expanded[d.deploymentId]);
                          let logsGroup = d.logsGroup;
                          let logsStream = d.logsStream;
                          if (!logsGroup && d.ecsTaskArn) logsGroup = '/ecs/numa-portal-deploy';
                          if (!logsStream && d.ecsTaskArn) {
                            const taskId = d.ecsTaskArn.split('/').pop() || d.ecsTaskArn;
                            logsStream = `ecs/deployer/${taskId}`;
                          }
                          const logsUrl = buildCloudwatchLogsUrl(awsRegion, logsGroup, logsStream);
                          const sfnUrl = buildStepFunctionsUrl(awsRegion, d.sfnExecutionArn);
                          const ecsUrl = buildEcsTaskUrl(awsRegion, d.ecsTaskArn);
                          const statusLabel = (d.status || '').toString();
                          const statusLower = statusLabel.toLowerCase();
                          const statusWithAttempt = d.attemptLabel ? `${statusLabel} (${d.attemptLabel})` : statusLabel;
                          const isRunning = statusLower === 'running';
                          const isRetrying = statusLower === 'retrying';
                          const isFailed = statusLower === 'failed';
                          const isSuccess = statusLower === 'success';
                          let statusVariant: string = 'secondary';
                          if (isSuccess) statusVariant = 'primary';
                          else if (isRunning || isRetrying || statusLower === 'partial') statusVariant = 'warning';
                          else if (isFailed) statusVariant = 'danger';

                          if (isGroupRecord(d)) {
                            return renderGroupRow(d);
                          }

                          const isStale =
                            isRunning && d.startedAt
                              ? Date.now() - Date.parse(d.startedAt) > 2 * 60 * 60 * 1000
                              : false;
                          // Mark superseded child attempts as retried (older attempt for same client within a group run)
                          const isChildOfGroup = Boolean(d.groupRunId) && d.deploymentId.includes('#');
                          let isSuperseded = false;
                          if (isChildOfGroup) {
                            const newest = filteredHistory.find(
                              (x) =>
                                x.deploymentId.includes('#') &&
                                x.groupRunId === d.groupRunId &&
                                x.clientName === d.clientName
                            );
                            if (newest && newest.deploymentId !== d.deploymentId) isSuperseded = true;
                          }
                          return (
                            <Fragment key={d.deploymentId}>
                              <tr className={`align-middle${isSuperseded ? ' text-muted' : ''}`}>
                                <td className="py-3">
                                  <small className="text-muted">{formatStartedNz(d.startedAt)}</small>
                                </td>
                                <td className="py-3">
                                  <div className="d-flex align-items-center">
                                    <div className="me-2">
                                      <div
                                        className="rounded-circle d-inline-block"
                                        style={{
                                          width: '8px',
                                          height: '8px',
                                          backgroundColor:
                                            d.clientName.includes('demo') || d.clientName.includes('dev')
                                              ? '#ffc107'
                                              : '#28a745',
                                        }}
                                      ></div>
                                    </div>
                                    <span className="fw-medium">{d.clientName}</span>
                                  </div>
                                </td>
                                <td className="py-3">
                                  <small className="text-muted">{d.initiatedBy?.split('@')[0] || ''}</small>
                                </td>
                                <td className="py-3">
                                  {(() => {
                                    const matchingImage = images.find((img) => img.tag === d.imageTag);
                                    return matchingImage?.customName || d.imageTag || '';
                                  })()}
                                </td>
                                <td className="py-3">
                                  {d.deploymentLabel ? (
                                    <span
                                      className="text-truncate"
                                      style={{ maxWidth: '220px', display: 'inline-block' }}
                                    >
                                      {d.deploymentLabel}
                                    </span>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                                <td className="py-3">
                                  <small>{formatDuration(d.startedAt, d.endedAt)}</small>
                                  {isStale && <div className="small text-danger">Stuck?</div>}
                                </td>
                                <td className="py-3">
                                  <Badge bg={statusVariant}>{statusWithAttempt || 'unknown'}</Badge>
                                  {isSuperseded && <span className="ms-2 small text-muted">retried</span>}
                                </td>
                                <td className="py-3">
                                  <div className="d-flex flex-wrap gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline-secondary"
                                      onClick={() => toggleExpanded(d.deploymentId)}
                                    >
                                      {isExpanded ? 'Hide' : 'Details'}
                                    </Button>
                                    <Button
                                      as={Link}
                                      to={`/deployments/${encodeURIComponent(d.deploymentId)}/logs`}
                                      size="sm"
                                      variant="outline-primary"
                                    >
                                      Portal Logs
                                    </Button>
                                    {logsUrl && (
                                      <Button
                                        as="a"
                                        href={logsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        size="sm"
                                        variant="outline-secondary"
                                      >
                                        CloudWatch
                                      </Button>
                                    )}
                                    {sfnUrl && (
                                      <Button
                                        as="a"
                                        href={sfnUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        size="sm"
                                        variant="outline-secondary"
                                      >
                                        StepFn
                                      </Button>
                                    )}
                                    {ecsUrl && (
                                      <Button
                                        as="a"
                                        href={ecsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        size="sm"
                                        variant="outline-secondary"
                                      >
                                        ECS
                                      </Button>
                                    )}
                                    {(isRunning || isRetrying) && (
                                      <Button
                                        size="sm"
                                        variant="outline-danger"
                                        onClick={() => {
                                          setStoppingId(d.deploymentId);
                                          void stopDeployment(d, user?.email || 'unknown')
                                            .then(loadHistory)
                                            .finally(() => setStoppingId(null));
                                        }}
                                        disabled={stoppingId === d.deploymentId}
                                      >
                                        {stoppingId === d.deploymentId ? <Spinner size="sm" /> : 'Stop'}
                                      </Button>
                                    )}
                                    {isFailed && (
                                      <Button
                                        size="sm"
                                        variant="outline-success"
                                        onClick={() => {
                                          void overrideDeploymentStatus(d.deploymentId, 'resolved').then(loadHistory);
                                        }}
                                      >
                                        Mark Resolved
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={8} className="bg-light">
                                    <div className="p-3">
                                      <div className="mb-2">
                                        <strong>Deployment ID:</strong> {d.deploymentId}
                                      </div>
                                      {d.message && (
                                        <div className="mb-2">
                                          <strong>Message:</strong> {d.message}
                                        </div>
                                      )}
                                      {d.error && (
                                        <div className="mb-2">
                                          <strong>Error:</strong> {d.error}
                                        </div>
                                      )}
                                      {d.ecsTaskArn && (
                                        <div className="mb-2">
                                          <strong>ECS Task:</strong> {d.ecsTaskArn}
                                        </div>
                                      )}
                                      {d.sfnExecutionArn && (
                                        <div className="mb-2">
                                          <strong>State Machine Execution:</strong> {d.sfnExecutionArn}
                                        </div>
                                      )}
                                      <div className="small text-muted">Started: {d.startedAt || 'unknown'}</div>
                                      <div className="small text-muted">Ended: {d.endedAt || '—'}</div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </Table>
                  {historyNextKey && (
                    <div className="text-center py-3">
                      <Button variant="outline-secondary" size="sm" onClick={loadMoreHistory}>
                        Load More
                      </Button>
                    </div>
                  )}
                </Tab>
                <Tab
                  eventKey="groups"
                  title={
                    <span>
                      Groups
                      {groupRecords.length > 0 && (
                        <Badge bg="secondary" className="ms-1">
                          {groupRecords.length}
                        </Badge>
                      )}
                    </span>
                  }
                >
                  <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
                    <span className="small text-muted">Multi-client deployment runs started from the portal.</span>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={loadHistory}
                      disabled={loading || isSingleSubmitting || isGroupSubmitting || isRefreshing}
                    >
                      {isRefreshing ? (
                        <>
                          <Spinner size="sm" className="me-1" />
                          Refreshing
                        </>
                      ) : (
                        'Refresh'
                      )}
                    </Button>
                  </div>
                  <Table hover responsive className="mb-0">
                    <thead>
                      <tr>
                        <th>Started (NZ)</th>
                        <th>Group</th>
                        <th>Initiated By</th>
                        <th>Version</th>
                        <th>Deployment Label</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRecords.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-4 text-muted">
                            No group deployments yet.
                          </td>
                        </tr>
                      ) : (
                        groupRecords.map(renderGroupRow)
                      )}
                    </tbody>
                  </Table>
                </Tab>
                <Tab eventKey="locks" title={`Locks${locks.length ? ` (${locks.length})` : ''}`}>
                  <div className="mb-3">
                    <Alert variant="warning">
                      Deployment locks prevent concurrent runs per client. Only release a lock after confirming the Step
                      Function and ECS task have finished.
                    </Alert>
                  </div>
                  <Table hover responsive className="mb-0">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Acquired (NZ)</th>
                        <th>Lock ID</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLocks.map((lock) => {
                        const isReleasing = lockActionId === lock.deploymentId;
                        return (
                          <tr key={lock.deploymentId} className="align-middle">
                            <td className="py-3 fw-medium">{lock.clientName}</td>
                            <td className="py-3">
                              <small className="text-muted">{formatStartedNz(lock.startedAt)}</small>
                            </td>
                            <td className="py-3">
                              <code>{lock.deploymentId}</code>
                            </td>
                            <td className="py-3">
                              <Button
                                variant="outline-danger"
                                size="sm"
                                disabled={isReleasing || isRefreshing}
                                onClick={() => handleReleaseLock(lock)}
                              >
                                {isReleasing ? (
                                  <>
                                    <Spinner size="sm" className="me-1" />
                                    Releasing...
                                  </>
                                ) : (
                                  'Release Lock'
                                )}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                      {!loading && sortedLocks.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center py-4 text-muted">
                            No active locks detected.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </Table>
                </Tab>
              </Tabs>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Deployment Confirmation Modal */}
      <Modal show={showConfirmModal} onHide={handleCancelDeploy} centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Deployment</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to start a new deployment with the following configuration?</p>
          <div className="bg-light p-3 rounded">
            <div>
              <strong>Client:</strong> {selectedClient}
            </div>
            <div>
              <strong>Version:</strong>{' '}
              {(() => {
                const matchingImage = images.find((img) => img.tag === selectedTag);
                return matchingImage?.customName || selectedTag || '';
              })()}
            </div>
            {deploymentLabel && (
              <div>
                <strong>Deployment Label:</strong> {deploymentLabel}
              </div>
            )}
          </div>
          <div className="mt-3">
            <small className="text-muted">
              This will trigger a deployment process that may take several minutes to complete.
            </small>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCancelDeploy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirmDeploy}>
            Confirm Deploy
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={groupModalOpen} onHide={handleGroupModalClose} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingGroup ? `Edit Group: ${editingGroup.groupName}` : 'Create Deployment Group'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {groupModalError && <Alert variant="danger">{groupModalError}</Alert>}
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Group Name</Form.Label>
              <Form.Control
                type="text"
                value={groupForm.groupName}
                onChange={handleGroupFieldChange('groupName')}
                placeholder="e.g. Tier-1 customers"
                disabled={Boolean(editingGroup) || groupModalBusy}
              />
              {!editingGroup && <Form.Text>Group names must be unique.</Form.Text>}
            </Form.Group>
            <Form.Group className="mb-3">
              <div className="d-flex align-items-center gap-2 mb-2">
                <Form.Label className="mb-0">Clients</Form.Label>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => groupCsvInputRef.current?.click()}
                  disabled={groupModalBusy}
                >
                  <Upload className="me-1" /> Upload CSV
                </Button>
                <input
                  type="file"
                  ref={groupCsvInputRef}
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={handleGroupCsvUpload}
                />
              </div>
              {groupCsvFeedback && (
                <Alert variant="info" className="py-1 mb-2">
                  {groupCsvFeedback}
                </Alert>
              )}
              <GroupedClientSelector
                clients={clients}
                selectedClientNames={groupForm.clients}
                onClientToggle={(name) => {
                  setGroupForm((prev) => ({
                    ...prev,
                    clients: prev.clients.includes(name)
                      ? prev.clients.filter((c) => c !== name)
                      : [...prev.clients, name],
                  }));
                }}
                onSelectClients={(names) => setGroupForm((prev) => ({ ...prev, clients: names }))}
                disabled={groupModalBusy}
              />
            </Form.Group>
            <Row className="gy-3">
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={groupForm.description}
                    onChange={handleGroupFieldChange('description')}
                    placeholder="Optional notes about this group"
                    disabled={groupModalBusy}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Group Default Concurrency</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="number"
                      min={1}
                      max={absoluteMaxGroupConcurrency}
                      value={groupForm.maxConcurrency ?? ''}
                      onChange={handleGroupMaxConcurrencyChange}
                      placeholder={String(defaultGroupConcurrency)}
                      disabled={groupModalBusy}
                    />
                    <InputGroup.Text>tasks</InputGroup.Text>
                  </InputGroup>
                  <Form.Text>
                    Leave blank to use the portal default ({defaultGroupConcurrency}). Hard limit{' '}
                    {absoluteMaxGroupConcurrency}.
                  </Form.Text>
                </Form.Group>
                {editingGroup && (
                  <ListGroup variant="flush" className="small mt-3">
                    <ListGroup.Item className="px-0">Clients: {editingGroup.clients.length}</ListGroup.Item>
                    <ListGroup.Item className="px-0">
                      Last updated:{' '}
                      {editingGroup.updatedAt ? new Date(editingGroup.updatedAt).toLocaleString() : 'unknown'}
                    </ListGroup.Item>
                  </ListGroup>
                )}
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          {editingGroup && (
            <Button variant="outline-danger" onClick={handleDeleteGroup} disabled={groupModalBusy}>
              {groupModalBusy ? <Spinner size="sm" className="me-2" /> : null}
              Delete
            </Button>
          )}
          <Button variant="outline-secondary" onClick={handleGroupModalClose} disabled={groupModalBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveGroup} disabled={groupModalBusy}>
            {groupModalBusy ? <Spinner size="sm" className="me-2" /> : null}
            Save
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
