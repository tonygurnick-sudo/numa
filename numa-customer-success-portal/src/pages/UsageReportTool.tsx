import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Form, Alert, Row, Col, ListGroup, Badge, Collapse, Container, Dropdown } from 'react-bootstrap';
import { ArrowLeft, Download, BarChart, Funnel, XCircle } from 'react-bootstrap-icons';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Tabs, Tab } from 'react-bootstrap';
import { ProgressTracker } from '@/components/tools/ProgressTracker';
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector';
import { getSelectionDisplayText } from '@/components/tools/clientSelectionUtils';
import { useToolExecution } from '@/hooks/useToolExecution';
import { UsageReportService } from '@/services/usageReportService';
import { FileExportService } from '@/utils/fileExport';
import { DateUtils } from '@/utils/dateUtils';
import { clientService } from '@/services/clientService';
import { clientMetadataService } from '@/services/clientMetadataService';
import type { Client, ClientMetadata } from '@/types';
import { CLIENT_STATUS_DISPLAY, CLIENT_STATUS_VALUES } from '@/types';
import type { ClientStatusValue } from '@/types';
import type {
  AgentRecord,
  AgentUsageRecord,
  AppRunRecord,
  ChatMessageRecord,
  IntegrationRecord,
  IntegrationChatUsageRecord,
  AgentIntegrationUsageRecord,
  KnowledgeBaseRecord,
  ToolResult,
  ToolResultFile,
  UsageReportParameters,
  UsageReportResult,
  UsageReportType,
  UsageSummary,
} from '@/types/tools';

const DEFAULT_REPORT_TYPES: UsageReportType[] = [
  'summary',
  'app-runs',
  'chat-messages',
  'agents',
  'agent-usage',
  'scheduled-agent-usage',
  'integrations',
  'integration-chat-usage',
  'agent-integration-usage',
  'knowledge-bases',
];

const REPORT_OPTIONS: { value: UsageReportType; label: string; description: string }[] = [
  {
    value: 'summary',
    label: 'User Usage Summary',
    description: 'App runs, chat, agents, integrations, and KBs per user across selected clients',
  },
  { value: 'app-runs', label: 'App Runs', description: 'Raw application run records across selected clients' },
  { value: 'chat-messages', label: 'Chat Messages', description: 'Chat message activity (including meta/tool events)' },
  { value: 'agents', label: 'Agents Directory', description: 'All public and personal agents with creator details' },
  {
    value: 'agent-usage',
    label: 'Agent Usage',
    description: 'User-initiated agent conversations (excludes scheduled runs)',
  },
  {
    value: 'scheduled-agent-usage',
    label: 'Scheduled Agent Runs',
    description: 'Agent conversations triggered by automated schedules',
  },
  {
    value: 'integrations',
    label: 'Integrations',
    description: 'Integration settings per client with statuses and deny tool lists',
  },
  {
    value: 'integration-chat-usage',
    label: 'Chat With Integrations',
    description: 'Tool calls to integrations in chat conversations',
  },
  {
    value: 'agent-integration-usage',
    label: 'Agents With Integrations',
    description: 'Agent conversations that invoked integration tools',
  },
  {
    value: 'knowledge-bases',
    label: 'Knowledge Bases',
    description: 'Knowledge bases configured per client with file counts',
  },
];

export default function UsageReportTool() {
  const navigate = useNavigate();
  const [parameters, setParameters] = useState<UsageReportParameters>({
    clientNames: [],
    timePeriod: 'current-year',
    customStartDate: '',
    customEndDate: '',
    timeGranularity: 'month',
    outputFormat: 'json',
    reports: DEFAULT_REPORT_TYPES,
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [resultFiles, setResultFiles] = useState<ToolResultFile[]>([]);
  const [activeTab, setActiveTab] = useState<string>('summary');
  // Separate state for month inputs to allow free editing
  const [startMonthInput, setStartMonthInput] = useState('');
  const [endMonthInput, setEndMonthInput] = useState('');
  // Client filter state
  const [metadataMap, setMetadataMap] = useState<Map<string, ClientMetadata>>(new Map());
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [trialStartFrom, setTrialStartFrom] = useState('');
  const [trialStartTo, setTrialStartTo] = useState('');
  const [trialEndFrom, setTrialEndFrom] = useState('');
  const [trialEndTo, setTrialEndTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { execution, isRunning, execute, cancel, reset } = useToolExecution({
    onCompleted: (result) => {
      if (result.files) {
        setResultFiles(result.files);
      }
    },
    onFailed: (error) => {
      console.error('Tool execution failed:', error);
    },
  });

  // Load clients on component mount
  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    const reportsFromResult = execution?.result?.data?.metadata?.selectedReports || [];
    if (execution?.status === 'completed' && reportsFromResult.length > 0) {
      if (!reportsFromResult.includes(activeTab as UsageReportType)) {
        setActiveTab(reportsFromResult[0]);
      }
    }
  }, [execution, activeTab]);

  const loadClients = async () => {
    setLoadingClients(true);
    try {
      const [allClients, metadata] = await Promise.all([
        clientService.getAllClients(),
        clientMetadataService.getAllMetadata(),
      ]);
      setClients(allClients);
      setMetadataMap(metadata);
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoadingClients(false);
    }
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilters.length > 0) count++;
    if (trialStartFrom || trialStartTo) count++;
    if (trialEndFrom || trialEndTo) count++;
    return count;
  }, [statusFilters, trialStartFrom, trialStartTo, trialEndFrom, trialEndTo]);

  const clearFilters = () => {
    setStatusFilters([]);
    setTrialStartFrom('');
    setTrialStartTo('');
    setTrialEndFrom('');
    setTrialEndTo('');
  };

  const handleStatusToggle = (value: string) => {
    setStatusFilters((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  };

  const statusOptions: { value: string; label: string }[] = [
    ...CLIENT_STATUS_VALUES.map((s) => ({ value: s, label: CLIENT_STATUS_DISPLAY[s].label })),
    { value: 'expired', label: 'Trial - Expired' },
    { value: 'unset', label: 'No Status Set' },
  ];

  const filteredClients = useMemo(() => {
    let result = clients;

    if (statusFilters.length > 0) {
      result = result.filter((c) => {
        const meta = metadataMap.get(c.name);
        if (!meta) return statusFilters.includes('unset');
        const isExpired = meta.status === 'trial' && meta.trialEndDate && new Date(meta.trialEndDate) < new Date();
        return statusFilters.some((f) => {
          if (f === 'expired') return isExpired;
          if (f === 'unset') return false;
          return meta.status === f;
        });
      });
    }

    if (trialStartFrom) {
      result = result.filter((c) => {
        const meta = metadataMap.get(c.name);
        return meta?.trialStartDate && meta.trialStartDate >= trialStartFrom;
      });
    }
    if (trialStartTo) {
      result = result.filter((c) => {
        const meta = metadataMap.get(c.name);
        return meta?.trialStartDate && meta.trialStartDate <= trialStartTo;
      });
    }

    if (trialEndFrom) {
      result = result.filter((c) => {
        const meta = metadataMap.get(c.name);
        return meta?.trialEndDate && meta.trialEndDate >= trialEndFrom;
      });
    }
    if (trialEndTo) {
      result = result.filter((c) => {
        const meta = metadataMap.get(c.name);
        return meta?.trialEndDate && meta.trialEndDate <= trialEndTo;
      });
    }

    return result;
  }, [clients, statusFilters, trialStartFrom, trialStartTo, trialEndFrom, trialEndTo, metadataMap]);

  // Remove selected clients that are no longer in the filtered list
  useEffect(() => {
    const filteredNames = new Set(filteredClients.map((c) => c.name));
    const validSelections = parameters.clientNames.filter((n) => filteredNames.has(n));
    if (validSelections.length !== parameters.clientNames.length) {
      setParameters((prev) => ({ ...prev, clientNames: validSelections }));
    }
  }, [filteredClients]);

  const handleClientToggle = (clientName: string) => {
    setParameters((prev) => {
      const newClientNames = prev.clientNames.includes(clientName)
        ? prev.clientNames.filter((n) => n !== clientName)
        : [...prev.clientNames, clientName];
      return { ...prev, clientNames: newClientNames };
    });
  };

  const handleSelectClients = (clientNames: string[]) => {
    setParameters((prev) => ({ ...prev, clientNames }));
  };

  const handleReportToggle = (report: UsageReportType) => {
    setParameters((prev) => {
      const nextReports = prev.reports.includes(report)
        ? prev.reports.filter((r) => r !== report)
        : [...prev.reports, report];
      return { ...prev, reports: nextReports };
    });
  };

  const handleSelectAllReports = () => {
    setParameters((prev) => {
      return { ...prev, reports: REPORT_OPTIONS.map((r) => r.value) };
    });
  };

  const handleClearReports = () => {
    setParameters((prev) => ({ ...prev, reports: [] }));
  };

  const handleParameterChange = (field: keyof UsageReportParameters, value: string) => {
    setParameters((prev) => {
      if (field === 'timePeriod' && value !== 'custom') {
        return { ...prev, timePeriod: value, customStartDate: '', customEndDate: '' };
      }
      if (field === 'timeGranularity') {
        const nextPeriod =
          value === 'day' ? 'custom' : prev.timePeriod === 'custom' ? 'current-month' : prev.timePeriod;
        return { ...prev, timeGranularity: value as 'month' | 'day', timePeriod: nextPeriod };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleExecute = async () => {
    if (parameters.timePeriod === 'custom' && !isCustomRangeValid) {
      return;
    }
    // If all clients are selected, pass empty array to indicate "all clients"
    const clientNamesToUse = parameters.clientNames.length === clients.length ? [] : parameters.clientNames;
    const paramsToUse = { ...parameters, clientNames: clientNamesToUse };
    if (parameters.reports.length > 0) {
      setActiveTab(parameters.reports[0]);
    }

    await execute('usage-report', paramsToUse, async (params, onProgress, _signal) => {
      const { result, files } = await UsageReportService.generateReport(params as UsageReportParameters, onProgress);

      return {
        type: 'file',
        files,
        data: result,
      } as ToolResult;
    });
  };

  const handleDownloadFile = (file: ToolResultFile) => {
    FileExportService.downloadFile(file);
  };

  const handleDownloadAll = () => {
    FileExportService.downloadFiles(resultFiles);
  };

  const handleReset = () => {
    reset();
    setResultFiles([]);
    setActiveTab('summary');
    setStartMonthInput('');
    setEndMonthInput('');
    clearFilters();
    setShowFilters(false);
    setParameters({
      clientNames: [],
      timePeriod: 'current-year',
      customStartDate: '',
      customEndDate: '',
      timeGranularity: 'month',
      outputFormat: 'json',
      reports: DEFAULT_REPORT_TYPES,
    });
  };

  const isCustomRange = parameters.timePeriod === 'custom';
  const isCustomRangeValid =
    !isCustomRange ||
    (!!parameters.customStartDate &&
      !!parameters.customEndDate &&
      parameters.customStartDate <= parameters.customEndDate);

  const isFormValid = () => {
    // For monthly granularity, also check month input validation
    const monthInputsValid = parameters.timeGranularity !== 'month' || !hasMonthValidationError;
    return (
      parameters.clientNames.length > 0 &&
      parameters.timePeriod &&
      (!isCustomRange || isCustomRangeValid) &&
      monthInputsValid &&
      !monthValidationError &&
      parameters.outputFormat &&
      parameters.reports.length > 0
    );
  };

  const timePeriodOptions = DateUtils.getTimePeriodOptions();

  const currentMonthValue = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };
  const previousMonthValue = () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  };
  const isValidMonth = (month: string) => /^\d{4}-\d{2}$/.test(month);
  const monthToStartDate = (month: string) => `${month}-01`;
  const monthToEndDate = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    const end = new Date(y, m, 0); // last day of month
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  };

  // Get display values - use input state if set, otherwise derive from parameters
  const startMonthValue =
    startMonthInput || (parameters.customStartDate ? parameters.customStartDate.slice(0, 7) : currentMonthValue());
  const endMonthValue =
    endMonthInput || (parameters.customEndDate ? parameters.customEndDate.slice(0, 7) : startMonthValue);

  // Validation for month inputs
  const isStartMonthInputValid = !startMonthInput || isValidMonth(startMonthInput);
  const isEndMonthInputValid = !endMonthInput || isValidMonth(endMonthInput);
  const hasMonthValidationError = !isStartMonthInputValid || !isEndMonthInputValid;

  // Get validation error message for month inputs
  const getMonthValidationError = (): string | null => {
    if (startMonthInput && !isValidMonth(startMonthInput)) {
      return 'Start month format is invalid. Use YYYY-MM format (e.g., 2025-01).';
    }
    if (endMonthInput && !isValidMonth(endMonthInput)) {
      return 'End month format is invalid. Use YYYY-MM format (e.g., 2025-12).';
    }
    if (
      parameters.customStartDate &&
      parameters.customEndDate &&
      parameters.customStartDate > parameters.customEndDate
    ) {
      return 'Start month must be on or before end month.';
    }
    return null;
  };
  const monthValidationError = getMonthValidationError();

  // Handlers for month inputs - update input state immediately, sync to parameters only when valid
  const handleStartMonthChange = (value: string) => {
    setStartMonthInput(value);
    if (isValidMonth(value)) {
      setParameters((prev) => ({
        ...prev,
        timePeriod: 'custom',
        customStartDate: monthToStartDate(value),
        // If end is not set or is before start, also update end
        customEndDate:
          !prev.customEndDate || prev.customEndDate < monthToStartDate(value)
            ? monthToEndDate(value)
            : prev.customEndDate,
      }));
    }
  };

  const handleEndMonthChange = (value: string) => {
    setEndMonthInput(value);
    if (isValidMonth(value)) {
      setParameters((prev) => ({
        ...prev,
        timePeriod: 'custom',
        customEndDate: monthToEndDate(value),
      }));
    }
  };

  const setMonthRange = (startMonth: string, endMonth: string) => {
    setStartMonthInput(startMonth);
    setEndMonthInput(endMonth);
    if (isValidMonth(startMonth) && isValidMonth(endMonth)) {
      setParameters((prev) => ({
        ...prev,
        timePeriod: 'custom',
        customStartDate: monthToStartDate(startMonth),
        customEndDate: monthToEndDate(endMonth),
      }));
    }
  };

  const getTimePeriodLabel = () => {
    if (isCustomRange && parameters.customStartDate && parameters.customEndDate) {
      return `${parameters.customStartDate} to ${parameters.customEndDate}`;
    }
    if (/^\d{4}-\d{2}$/.test(parameters.timePeriod)) {
      return parameters.timePeriod;
    }
    return timePeriodOptions.find((opt) => opt.value === parameters.timePeriod)?.label || 'Select time period...';
  };

  const getClientSelectionText = () => {
    return getSelectionDisplayText(clients, parameters.clientNames);
  };

  const formatReportList = (reports: UsageReportType[]) => {
    if (reports.length === 0) return 'Select reports...';
    if (reports.length === REPORT_OPTIONS.length) return `All Reports (${REPORT_OPTIONS.length})`;
    if (reports.length === 1) {
      const selected = REPORT_OPTIONS.find((r) => r.value === reports[0]);
      return selected?.label || reports[0];
    }
    return `${reports.length} reports selected`;
  };

  const getReportSelectionText = () => {
    return formatReportList(parameters.reports);
  };

  const buildSummaryCards = (metadata: UsageReportResult['metadata']) => {
    const cards: { label: string; value: string | number; variant: string }[] = [
      { label: 'Clients', value: metadata.clientsProcessed, variant: 'primary' },
    ];

    if (metadata.totalAppRuns !== undefined) {
      cards.push({ label: 'App Runs', value: metadata.totalAppRuns.toLocaleString(), variant: 'primary' });
    }
    if (metadata.totalChatMessages !== undefined) {
      cards.push({ label: 'Chat Messages', value: metadata.totalChatMessages.toLocaleString(), variant: 'success' });
    }
    if (metadata.uniqueUsers !== undefined) {
      cards.push({ label: 'Unique Users', value: metadata.uniqueUsers.toLocaleString(), variant: 'info' });
    }
    if (metadata.totalAgents !== undefined) {
      cards.push({ label: 'Agents', value: metadata.totalAgents.toLocaleString(), variant: 'secondary' });
    }
    if (metadata.agentConversationCount !== undefined) {
      cards.push({
        label: 'Agent Conversations',
        value: metadata.agentConversationCount.toLocaleString(),
        variant: 'warning',
      });
    }
    if (metadata.scheduledAgentConversationCount !== undefined) {
      cards.push({
        label: 'Scheduled Agent Runs',
        value: metadata.scheduledAgentConversationCount.toLocaleString(),
        variant: 'info',
      });
    }
    if (metadata.uniqueAgentUsers !== undefined) {
      cards.push({ label: 'Agent Users', value: metadata.uniqueAgentUsers.toLocaleString(), variant: 'dark' });
    }
    if (metadata.totalIntegrations !== undefined) {
      cards.push({ label: 'Integrations', value: metadata.totalIntegrations.toLocaleString(), variant: 'secondary' });
    }
    if (metadata.totalIntegrationChats !== undefined) {
      cards.push({
        label: 'Chat + Integrations',
        value: metadata.totalIntegrationChats.toLocaleString(),
        variant: 'info',
      });
    }
    if (metadata.totalAgentIntegrationRuns !== undefined) {
      cards.push({
        label: 'Agent + Integrations',
        value: metadata.totalAgentIntegrationRuns.toLocaleString(),
        variant: 'primary',
      });
    }
    if (metadata.totalKnowledgeBases !== undefined) {
      cards.push({ label: 'Knowledge Bases', value: metadata.totalKnowledgeBases.toLocaleString(), variant: 'info' });
    }
    if (metadata.totalKnowledgeBaseFiles !== undefined) {
      cards.push({ label: 'KB Files', value: metadata.totalKnowledgeBaseFiles.toLocaleString(), variant: 'secondary' });
    }

    cards.push({ label: 'Time Period', value: metadata.displayName, variant: 'warning' });

    return cards;
  };

  const selectedReportsFromResult = execution?.result?.data?.metadata?.selectedReports || [];
  const summaryRows = execution?.result?.data?.summary || [];
  const appRunRows = execution?.result?.data?.appRuns || [];
  const chatRows = execution?.result?.data?.chatMessages || [];
  const agentRows = execution?.result?.data?.agents || [];
  const agentUsageRows = execution?.result?.data?.agentUsage || [];
  const scheduledAgentUsageRows = execution?.result?.data?.scheduledAgentUsage || [];
  const integrationRows = execution?.result?.data?.integrations || [];
  const integrationChatRows = execution?.result?.data?.integrationChatUsage || [];
  const agentIntegrationRows = execution?.result?.data?.agentIntegrationUsage || [];
  const knowledgeBaseRows = execution?.result?.data?.knowledgeBases || [];

  const renderStatusBadge = (status?: string) => {
    if (!status) return <span className="text-muted">-</span>;
    const display = CLIENT_STATUS_DISPLAY[status as ClientStatusValue];
    return display ? <Badge bg={display.variant}>{display.label}</Badge> : <span>{status}</span>;
  };

  const renderSummaryTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>User ID</th>
            <th>User Email</th>
            <th>Date</th>
            <th>App Runs</th>
            <th>Chat Messages</th>
            <th>App Runs by App</th>
            <th>Chat Messages by Type</th>
          </tr>
        </thead>
        <tbody>
          {summaryRows.length === 0 && (
            <tr>
              <td colSpan={9} className="text-center text-muted">
                No summary records found.
              </td>
            </tr>
          )}
          {summaryRows.map((row: UsageSummary, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.userId}</td>
              <td>{row.userEmail}</td>
              <td>{row.month}</td>
              <td>{row.appRuns}</td>
              <td>{row.chatMessages}</td>
              <td>
                <code className="text-muted">{JSON.stringify(row.appRunsByApp)}</code>
              </td>
              <td>
                <code className="text-muted">{JSON.stringify(row.chatMessagesByType)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderAppRunsTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Client Status</th>
            <th>User ID</th>
            <th>User Email</th>
            <th>App ID</th>
            <th>App Name</th>
            <th>Date</th>
            <th>Job ID</th>
            <th>Started At</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {appRunRows.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-muted">
                No app runs found for the selected period.
              </td>
            </tr>
          )}
          {appRunRows.map((row: AppRunRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.userId}</td>
              <td>{row.userEmail}</td>
              <td>{row.appId}</td>
              <td>{row.appName}</td>
              <td>{row.month}</td>
              <td>{row.jobId}</td>
              <td>{row.startedAt}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderChatTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>User ID</th>
            <th>User Email</th>
            <th>Date</th>
            <th>Conversation ID</th>
            <th>Message Type</th>
            <th>Role</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {chatRows.length === 0 && (
            <tr>
              <td colSpan={9} className="text-center text-muted">
                No chat messages found for the selected period.
              </td>
            </tr>
          )}
          {chatRows.map((row: ChatMessageRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.userId}</td>
              <td>{row.userEmail}</td>
              <td>{row.month}</td>
              <td>{row.conversationId}</td>
              <td>{row.messageType}</td>
              <td>{row.role}</td>
              <td>{row.timestamp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderAgentsTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>Agent ID</th>
            <th>Agent Name</th>
            <th>Visibility</th>
            <th>Agent Type</th>
            <th>Created By (ID)</th>
            <th>Created By (Email)</th>
            <th>Created At</th>
            <th>Scope</th>
          </tr>
        </thead>
        <tbody>
          {agentRows.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-muted">
                No agents found for the selected clients.
              </td>
            </tr>
          )}
          {agentRows.map((row: AgentRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.agentId}</td>
              <td>{row.agentName}</td>
              <td>{row.visibility}</td>
              <td>{row.agentType}</td>
              <td>{row.createdBy}</td>
              <td>{row.createdByEmail}</td>
              <td>{row.createdAt}</td>
              <td>{row.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderAgentUsageTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>Agent ID</th>
            <th>Agent Name</th>
            <th>User ID</th>
            <th>User Email</th>
            <th>Date</th>
            <th>Conversations</th>
            <th>Visibility</th>
            <th>Agent Type</th>
          </tr>
        </thead>
        <tbody>
          {agentUsageRows.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-muted">
                No agent usage found for the selected period.
              </td>
            </tr>
          )}
          {agentUsageRows.map((row: AgentUsageRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.agentId}</td>
              <td>{row.agentName}</td>
              <td>{row.userId}</td>
              <td>{row.userEmail}</td>
              <td>{row.month}</td>
              <td>{row.conversationCount}</td>
              <td>{row.visibility}</td>
              <td>{row.agentType}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderScheduledAgentUsageTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>Agent ID</th>
            <th>Agent Name</th>
            <th>User ID</th>
            <th>User Email</th>
            <th>Date</th>
            <th>Conversations</th>
            <th>Visibility</th>
            <th>Agent Type</th>
          </tr>
        </thead>
        <tbody>
          {scheduledAgentUsageRows.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-muted">
                No scheduled agent runs found for the selected period.
              </td>
            </tr>
          )}
          {scheduledAgentUsageRows.map((row: AgentUsageRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.agentId}</td>
              <td>{row.agentName}</td>
              <td>{row.userId}</td>
              <td>{row.userEmail}</td>
              <td>{row.month}</td>
              <td>{row.conversationCount}</td>
              <td>{row.visibility}</td>
              <td>{row.agentType}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderIntegrationsTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Client Status</th>
            <th>Integration</th>
            <th>Status</th>
            <th>Deny Tools</th>
            <th>Updated At</th>
            <th>Updated By</th>
          </tr>
        </thead>
        <tbody>
          {integrationRows.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-muted">
                No integrations found for the selected clients.
              </td>
            </tr>
          )}
          {integrationRows.map((row: IntegrationRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.integration}</td>
              <td>{row.status}</td>
              <td>
                <code className="text-muted">{row.denyTools?.join('; ')}</code>
              </td>
              <td>{row.updatedAt || ''}</td>
              <td>{row.updatedBy || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderIntegrationChatUsageTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>Integration</th>
            <th>User ID</th>
            <th>User Email</th>
            <th>Conversation ID</th>
            <th>Date</th>
            <th>Tool Name</th>
          </tr>
        </thead>
        <tbody>
          {integrationChatRows.length === 0 && (
            <tr>
              <td colSpan={8} className="text-center text-muted">
                No integration tool calls found in chat for the selected period.
              </td>
            </tr>
          )}
          {integrationChatRows.map((row: IntegrationChatUsageRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.integration}</td>
              <td>{row.userId}</td>
              <td>{row.userEmail}</td>
              <td>{row.conversationId}</td>
              <td>{row.month}</td>
              <td>{row.toolName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderAgentIntegrationUsageTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>Integration</th>
            <th>Agent ID</th>
            <th>Agent Name</th>
            <th>User ID</th>
            <th>User Email</th>
            <th>Conversation ID</th>
            <th>Date</th>
            <th>Tool Name</th>
          </tr>
        </thead>
        <tbody>
          {agentIntegrationRows.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-muted">
                No agent conversations invoking integrations for the selected period.
              </td>
            </tr>
          )}
          {agentIntegrationRows.map((row: AgentIntegrationUsageRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.integration}</td>
              <td>{row.agentId}</td>
              <td>{row.agentName}</td>
              <td>{row.userId}</td>
              <td>{row.userEmail}</td>
              <td>{row.conversationId}</td>
              <td>{row.month}</td>
              <td>{row.toolName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderKnowledgeBasesTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>KB Type</th>
            <th>Scope</th>
            <th>Name</th>
            <th>KB ID</th>
            <th>Bucket</th>
            <th>Prefix</th>
            <th>File Count</th>
            <th>Created By</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {knowledgeBaseRows.length === 0 && (
            <tr>
              <td colSpan={11} className="text-center text-muted">
                No knowledge bases found for the selected clients.
              </td>
            </tr>
          )}
          {knowledgeBaseRows.map((row: KnowledgeBaseRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{renderStatusBadge(row.clientStatus)}</td>
              <td>{row.kbType}</td>
              <td>{row.scope}</td>
              <td>{row.name}</td>
              <td>{row.kbId || ''}</td>
              <td>{row.bucket || ''}</td>
              <td>
                <code className="text-muted">{row.prefix || ''}</code>
              </td>
              <td>{row.fileCount}</td>
              <td>{row.createdBy || ''}</td>
              <td>{row.notes || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const tabConfigs: { key: UsageReportType; title: string; content: JSX.Element }[] = [];

  if (selectedReportsFromResult.includes('summary')) {
    tabConfigs.push({
      key: 'summary',
      title: `User/Month Summary (${summaryRows.length})`,
      content: renderSummaryTable(),
    });
  }
  if (selectedReportsFromResult.includes('app-runs')) {
    tabConfigs.push({
      key: 'app-runs',
      title: `App Runs (${appRunRows.length})`,
      content: renderAppRunsTable(),
    });
  }
  if (selectedReportsFromResult.includes('chat-messages')) {
    tabConfigs.push({
      key: 'chat-messages',
      title: `Chat Messages (${chatRows.length})`,
      content: renderChatTable(),
    });
  }
  if (selectedReportsFromResult.includes('agents')) {
    tabConfigs.push({
      key: 'agents',
      title: `Agents (${agentRows.length})`,
      content: renderAgentsTable(),
    });
  }
  if (selectedReportsFromResult.includes('agent-usage')) {
    tabConfigs.push({
      key: 'agent-usage',
      title: `Agent Usage (${agentUsageRows.length})`,
      content: renderAgentUsageTable(),
    });
  }
  if (selectedReportsFromResult.includes('scheduled-agent-usage')) {
    tabConfigs.push({
      key: 'scheduled-agent-usage',
      title: `Scheduled Agent Runs (${scheduledAgentUsageRows.length})`,
      content: renderScheduledAgentUsageTable(),
    });
  }
  if (selectedReportsFromResult.includes('integrations')) {
    tabConfigs.push({
      key: 'integrations',
      title: `Integrations (${integrationRows.length})`,
      content: renderIntegrationsTable(),
    });
  }
  if (selectedReportsFromResult.includes('integration-chat-usage')) {
    tabConfigs.push({
      key: 'integration-chat-usage',
      title: `Chat + Integrations (${integrationChatRows.length})`,
      content: renderIntegrationChatUsageTable(),
    });
  }
  if (selectedReportsFromResult.includes('agent-integration-usage')) {
    tabConfigs.push({
      key: 'agent-integration-usage',
      title: `Agent + Integrations (${agentIntegrationRows.length})`,
      content: renderAgentIntegrationUsageTable(),
    });
  }
  if (selectedReportsFromResult.includes('knowledge-bases')) {
    tabConfigs.push({
      key: 'knowledge-bases',
      title: `Knowledge Bases (${knowledgeBaseRows.length})`,
      content: renderKnowledgeBasesTable(),
    });
  }

  return (
    <Container fluid>
      {/* Header */}
      <div className="d-flex align-items-center mb-4">
        <Button variant="secondary" onClick={() => navigate('/tools')} className="me-3" disabled={isRunning}>
          <ArrowLeft className="me-1" />
          Back to Tools
        </Button>
        <div>
          <div className="d-flex align-items-center">
            <BarChart className="me-2 text-primary" size={24} />
            <h2 className="mb-0">Usage Report Generator</h2>
          </div>
          <p className="text-muted mb-0">
            Generate comprehensive usage analytics for one or all clients including app runs, chat messages, and user
            activity summaries.
          </p>
        </div>
      </div>

      <Row>
        {/* Configuration Panel */}
        <Col lg={4}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">Configuration</h5>
            </Card.Header>
            <Card.Body>
              {!execution && (
                <Form>
                  {/* Client Selection */}
                  <Form.Group className="mb-3">
                    <Form.Label>
                      Clients <span className="text-danger">*</span>
                    </Form.Label>

                    <div className="d-flex align-items-center gap-2 mb-2">
                      <Button
                        variant={activeFilterCount > 0 ? 'primary' : 'outline-secondary'}
                        size="sm"
                        onClick={() => setShowFilters(!showFilters)}
                      >
                        <Funnel size={12} className="me-1" />
                        Filters
                        {activeFilterCount > 0 && (
                          <Badge bg="light" text="dark" pill className="ms-1">
                            {activeFilterCount}
                          </Badge>
                        )}
                      </Button>
                      {activeFilterCount > 0 && (
                        <Button variant="outline-danger" size="sm" onClick={clearFilters} title="Clear all filters">
                          <XCircle size={12} className="me-1" />
                          Clear
                        </Button>
                      )}
                    </div>
                    <Collapse in={showFilters}>
                      <div className="mb-2 p-2 bg-light rounded border">
                        <Row className="g-2">
                          <Col xs={12}>
                            <Form.Label className="small fw-semibold text-muted mb-1">Status</Form.Label>
                            <Dropdown autoClose="outside">
                              <Dropdown.Toggle variant="outline-secondary" size="sm" className="w-100 text-start">
                                {statusFilters.length === 0
                                  ? 'All Statuses'
                                  : statusFilters
                                      .map((f) => statusOptions.find((o) => o.value === f)?.label)
                                      .join(', ')}
                              </Dropdown.Toggle>
                              <Dropdown.Menu className="w-100">
                                {statusOptions.map((opt) => (
                                  <Dropdown.Item
                                    key={opt.value}
                                    as="div"
                                    className="py-1"
                                    onClick={() => handleStatusToggle(opt.value)}
                                  >
                                    <Form.Check
                                      type="checkbox"
                                      label={opt.label}
                                      checked={statusFilters.includes(opt.value)}
                                      onChange={() => handleStatusToggle(opt.value)}
                                    />
                                  </Dropdown.Item>
                                ))}
                              </Dropdown.Menu>
                            </Dropdown>
                          </Col>
                          <Col xs={6}>
                            <Form.Label className="small fw-semibold text-muted mb-1">Trial Start From</Form.Label>
                            <DatePicker
                              selected={trialStartFrom ? new Date(trialStartFrom) : null}
                              onChange={(date: Date | null) =>
                                setTrialStartFrom(date ? date.toISOString().split('T')[0] : '')
                              }
                              dateFormat="yyyy-MM-dd"
                              className="form-control form-control-sm"
                              placeholderText="Select date"
                              isClearable
                              showMonthDropdown
                              showYearDropdown
                              dropdownMode="select"
                            />
                          </Col>
                          <Col xs={6}>
                            <Form.Label className="small fw-semibold text-muted mb-1">Trial Start To</Form.Label>
                            <DatePicker
                              selected={trialStartTo ? new Date(trialStartTo) : null}
                              onChange={(date: Date | null) =>
                                setTrialStartTo(date ? date.toISOString().split('T')[0] : '')
                              }
                              dateFormat="yyyy-MM-dd"
                              className="form-control form-control-sm"
                              placeholderText="Select date"
                              isClearable
                              showMonthDropdown
                              showYearDropdown
                              dropdownMode="select"
                              minDate={trialStartFrom ? new Date(trialStartFrom) : undefined}
                            />
                          </Col>
                          <Col xs={6}>
                            <Form.Label className="small fw-semibold text-muted mb-1">Trial End From</Form.Label>
                            <DatePicker
                              selected={trialEndFrom ? new Date(trialEndFrom) : null}
                              onChange={(date: Date | null) =>
                                setTrialEndFrom(date ? date.toISOString().split('T')[0] : '')
                              }
                              dateFormat="yyyy-MM-dd"
                              className="form-control form-control-sm"
                              placeholderText="Select date"
                              isClearable
                              showMonthDropdown
                              showYearDropdown
                              dropdownMode="select"
                            />
                          </Col>
                          <Col xs={6}>
                            <Form.Label className="small fw-semibold text-muted mb-1">Trial End To</Form.Label>
                            <DatePicker
                              selected={trialEndTo ? new Date(trialEndTo) : null}
                              onChange={(date: Date | null) =>
                                setTrialEndTo(date ? date.toISOString().split('T')[0] : '')
                              }
                              dateFormat="yyyy-MM-dd"
                              className="form-control form-control-sm"
                              placeholderText="Select date"
                              isClearable
                              showMonthDropdown
                              showYearDropdown
                              dropdownMode="select"
                              minDate={trialEndFrom ? new Date(trialEndFrom) : undefined}
                            />
                          </Col>
                        </Row>
                      </div>
                    </Collapse>

                    <GroupedClientSelector
                      clients={filteredClients}
                      selectedClientNames={parameters.clientNames}
                      onClientToggle={handleClientToggle}
                      onSelectClients={handleSelectClients}
                      disabled={isRunning}
                      loading={loadingClients}
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>
                      Reports <span className="text-danger">*</span>
                    </Form.Label>
                    <div className="p-2 bg-light rounded border">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <Form.Check
                          type="checkbox"
                          id="select-all-reports"
                          label={<strong>Select All Reports ({REPORT_OPTIONS.length})</strong>}
                          checked={parameters.reports.length === REPORT_OPTIONS.length}
                          ref={(el: HTMLInputElement | null) => {
                            if (el)
                              el.indeterminate =
                                parameters.reports.length > 0 && parameters.reports.length < REPORT_OPTIONS.length;
                          }}
                          onChange={handleSelectAllReports}
                          disabled={isRunning}
                          className="mb-0"
                        />
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={handleClearReports}
                          disabled={isRunning || parameters.reports.length === 0}
                        >
                          Clear
                        </Button>
                      </div>
                      <div className="border rounded p-2 bg-white">
                        {REPORT_OPTIONS.map((option) => (
                          <Form.Check
                            key={option.value}
                            type="checkbox"
                            id={`report-${option.value}`}
                            label={
                              <div>
                                <div className="fw-semibold">{option.label}</div>
                                <div className="text-muted small">{option.description}</div>
                              </div>
                            }
                            checked={parameters.reports.includes(option.value)}
                            onChange={() => handleReportToggle(option.value)}
                            disabled={isRunning}
                            className="mb-2"
                          />
                        ))}
                      </div>
                      <Form.Text className="text-muted">{getReportSelectionText()}</Form.Text>
                    </div>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Time Granularity</Form.Label>
                    <Form.Select
                      value={parameters.timeGranularity || 'month'}
                      onChange={(e) => handleParameterChange('timeGranularity', e.target.value)}
                      disabled={isRunning}
                    >
                      <option value="month">Monthly (default)</option>
                      <option value="day">Daily</option>
                    </Form.Select>
                    <Form.Text className="text-muted">
                      Controls how periods are grouped in the CSV/JSON output.
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>
                      Time Period <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Text className="text-muted d-block mb-2">
                      {parameters.timeGranularity === 'day'
                        ? 'Select a start and end date (inclusive).'
                        : 'Select a start and end month (inclusive).'}
                    </Form.Text>

                    {parameters.timeGranularity === 'day' ? (
                      <div className="d-flex flex-column gap-2">
                        <div className="d-flex gap-2">
                          <Form.Control
                            type="date"
                            value={parameters.customStartDate}
                            onChange={(e) =>
                              setParameters((prev) => ({
                                ...prev,
                                customStartDate: e.target.value,
                                timePeriod: 'custom',
                              }))
                            }
                            disabled={isRunning}
                          />
                          <span className="align-self-center">to</span>
                          <Form.Control
                            type="date"
                            value={parameters.customEndDate}
                            onChange={(e) =>
                              setParameters((prev) => ({
                                ...prev,
                                customEndDate: e.target.value,
                                timePeriod: 'custom',
                              }))
                            }
                            disabled={isRunning}
                          />
                        </div>
                        {!isCustomRangeValid && (
                          <Form.Text className="text-danger">
                            Start date must be set, end date must be set, and start must be on or before end.
                          </Form.Text>
                        )}
                      </div>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        <div className="d-flex gap-2">
                          <Form.Control
                            type="month"
                            value={startMonthValue}
                            onChange={(e) => handleStartMonthChange(e.target.value)}
                            disabled={isRunning}
                            isInvalid={!isStartMonthInputValid}
                          />
                          <span className="align-self-center">to</span>
                          <Form.Control
                            type="month"
                            value={endMonthValue}
                            onChange={(e) => handleEndMonthChange(e.target.value)}
                            disabled={isRunning}
                            isInvalid={!isEndMonthInputValid}
                          />
                        </div>
                        <div className="d-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => setMonthRange(currentMonthValue(), currentMonthValue())}
                            disabled={isRunning}
                          >
                            Current Month
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => setMonthRange(previousMonthValue(), previousMonthValue())}
                            disabled={isRunning}
                          >
                            Previous Month
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => setMonthRange(previousMonthValue(), currentMonthValue())}
                            disabled={isRunning}
                          >
                            Prev → Current
                          </Button>
                        </div>
                        {monthValidationError && <Form.Text className="text-danger">{monthValidationError}</Form.Text>}
                      </div>
                    )}
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Label>
                      Output Format <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Select
                      value={parameters.outputFormat}
                      onChange={(e) => handleParameterChange('outputFormat', e.target.value as 'csv' | 'json')}
                      disabled={isRunning}
                    >
                      <option value="">Select format...</option>
                      <option value="csv">CSV Files (separate files for each data type)</option>
                      <option value="json">JSON File (single comprehensive file)</option>
                    </Form.Select>
                    <Form.Text className="text-muted">Choose between CSV files or single JSON file</Form.Text>
                  </Form.Group>

                  <div className="d-grid">
                    <Button
                      variant="primary"
                      onClick={handleExecute}
                      disabled={!isFormValid() || isRunning || loadingClients}
                      size="lg"
                    >
                      {isRunning ? 'Generating Report...' : 'Generate Report'}
                    </Button>
                  </div>
                </Form>
              )}

              {execution && (
                <div>
                  <h6 className="mb-3">Current Parameters</h6>
                  <div className="mb-2">
                    <strong>Clients:</strong> {getClientSelectionText()}
                  </div>
                  <div className="mb-2">
                    <strong>Reports:</strong> {getReportSelectionText()}
                  </div>
                  <div className="mb-2">
                    <strong>Time Period:</strong> {getTimePeriodLabel()}
                  </div>
                  <div className="mb-2">
                    <strong>Granularity:</strong> {parameters.timeGranularity === 'day' ? 'Daily' : 'Monthly'}
                  </div>
                  <div className="mb-4">
                    <strong>Output Format:</strong> {parameters.outputFormat.toUpperCase()}
                  </div>

                  {isRunning && (
                    <div className="d-grid">
                      <Button variant="outline-danger" onClick={cancel}>
                        Cancel Generation
                      </Button>
                    </div>
                  )}

                  {execution.status === 'completed' && (
                    <div className="d-grid">
                      <Button variant="outline-primary" onClick={handleReset}>
                        Generate New Report
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {loadingClients && <Alert variant="info">Loading client configurations...</Alert>}
            </Card.Body>
          </Card>
        </Col>

        {/* Progress & Results Panel */}
        <Col lg={8}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">{execution ? 'Execution Progress' : 'Ready to Generate'}</h5>
              {execution?.status && (
                <Badge
                  bg={
                    execution.status === 'completed'
                      ? 'success'
                      : execution.status === 'failed'
                        ? 'danger'
                        : execution.status === 'running'
                          ? 'primary'
                          : 'secondary'
                  }
                >
                  {execution.status.charAt(0).toUpperCase() + execution.status.slice(1)}
                </Badge>
              )}
            </Card.Header>
            <Card.Body>
              {!execution && (
                <div className="text-center text-muted py-5">
                  <BarChart size={48} className="mb-3" />
                  <h5>Configure and Generate Usage Report</h5>
                  <p>Select clients and time period to get started.</p>
                </div>
              )}

              {execution && (
                <div className="mb-4">
                  <ProgressTracker
                    status={execution.status}
                    progress={execution.progress}
                    error={execution.error}
                    startedAt={execution.startedAt}
                    completedAt={execution.completedAt}
                  />
                </div>
              )}

              {/* No Content Message */}
              {execution?.status === 'completed' && resultFiles.length === 0 && (
                <Alert variant="warning" className="mb-4">
                  <Alert.Heading>No Content Found</Alert.Heading>
                  <p className="mb-0">
                    {execution.result?.data?.message ||
                      'No usage data was found for the selected clients and time period.'}
                  </p>
                </Alert>
              )}

              {/* Failed Clients Warning */}
              {execution?.status === 'completed' && execution.result?.data?.failedClients?.length > 0 && (
                <Alert variant="warning" className="mb-4">
                  <Alert.Heading>Some Clients Failed</Alert.Heading>
                  <p>The following clients could not be processed:</p>
                  <ul className="mb-0">
                    {execution.result.data.failedClients.map((f: { clientName: string; error: string }) => (
                      <li key={f.clientName}>
                        <strong>{f.clientName}:</strong> {f.error}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              {/* Results Section */}
              {resultFiles.length > 0 && (
                <div>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h6 className="mb-0">Generated Files ({resultFiles.length})</h6>
                    <Button variant="success" onClick={handleDownloadAll}>
                      <Download className="me-1" />
                      Download All Files
                    </Button>
                  </div>

                  <ListGroup>
                    {resultFiles.map((file, index) => (
                      <ListGroup.Item key={index} className="d-flex justify-content-between align-items-center">
                        <div>
                          <div className="fw-semibold">{file.name}</div>
                          <small className="text-muted">
                            {file.mimeType} • {FileExportService.formatFileSize(file.size)}
                          </small>
                        </div>
                        <Button variant="outline-primary" size="sm" onClick={() => handleDownloadFile(file)}>
                          <Download />
                        </Button>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>

                  {execution?.result?.data && (
                    <div className="mt-4 p-3 bg-light rounded">
                      <h6 className="mb-2">Report Summary</h6>
                      <Row className="g-3">
                        {buildSummaryCards(execution.result.data.metadata).map((card, idx) => (
                          <Col sm={3} md={2} key={`${card.label}-${idx}`}>
                            <div className="text-center">
                              <div className={`h4 mb-0 text-${card.variant}`}>{card.value}</div>
                              <small className="text-muted">{card.label}</small>
                            </div>
                          </Col>
                        ))}
                      </Row>
                      <div className="mt-2 text-muted small">
                        Selected Reports: {formatReportList(execution.result.data.metadata.selectedReports)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Full-width Tables Below */}
      {execution?.status === 'completed' && execution?.result?.data && (
        <Card className="border-0 shadow-sm mt-4">
          <Card.Header>
            <div className="d-flex align-items-center justify-content-between">
              <h5 className="mb-0">Usage Report Tables</h5>
              <small className="text-muted">
                {execution.result.data.metadata.displayName} • {execution.result.data.metadata.clientsProcessed}{' '}
                client(s)
              </small>
            </div>
          </Card.Header>
          <Card.Body>
            {tabConfigs.length === 0 ? (
              <div className="text-center text-muted py-4">No report tabs available for the selection.</div>
            ) : (
              <Tabs
                activeKey={tabConfigs.find((tab) => tab.key === activeTab)?.key || tabConfigs[0].key}
                onSelect={(k) => k && setActiveTab(k)}
                id="usage-report-tabs"
                className="mb-3"
              >
                {tabConfigs.map((tab) => (
                  <Tab eventKey={tab.key} title={tab.title} key={tab.key}>
                    {tab.content}
                  </Tab>
                ))}
              </Tabs>
            )}
          </Card.Body>
        </Card>
      )}
    </Container>
  );
}
