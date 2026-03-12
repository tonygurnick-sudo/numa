import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Form, Alert, Row, Col, ListGroup, Badge, Container } from 'react-bootstrap';
import { ArrowLeft, Download, BarChart } from 'react-bootstrap-icons';
import { useToolExecution } from '@/hooks/useToolExecution';
import { ProgressTracker } from '@/components/tools/ProgressTracker';
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector';
import { clientService } from '@/services/clientService';
import { FileExportService } from '@/utils/fileExport';
import { QuotaReportService } from '@/services/quotaReportService';
import type { Client } from '@/types';
import type {
  QuotaReportParameters,
  ToolResult,
  ToolResultFile,
  QuotaDescriptor,
  QuotaReportRow,
  ModelFamily,
  QuotaMetric,
  QuotaType,
} from '@/types/tools';

const DEFAULT_TYPES: QuotaType[] = ['On-demand', 'Cross-region', 'Global cross-region'];
const DEFAULT_FAMILIES: ModelFamily[] = ['sonnet', 'opus', 'haiku', 'nova'];
const DEFAULT_METRICS: QuotaMetric[] = ['requests-per-minute', 'tokens-per-minute'];

const FAMILY_LABELS: Record<ModelFamily, string> = {
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
  nova: 'Nova',
};

const METRIC_LABELS: Record<QuotaMetric, string> = {
  'requests-per-minute': 'Requests/min',
  'tokens-per-minute': 'Tokens/min',
};

export default function QuotaReportTool() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [selectedClientNames, setSelectedClientNames] = useState<string[]>([]);
  const [useArcanumInternal, setUseArcanumInternal] = useState(false);
  const [resultFiles, setResultFiles] = useState<ToolResultFile[]>([]);
  const [resultQuotas, setResultQuotas] = useState<QuotaDescriptor[]>([]);
  const [resultRows, setResultRows] = useState<QuotaReportRow[]>([]);

  const [parameters, setParameters] = useState<Omit<QuotaReportParameters, 'clientScope' | 'clients'>>({
    regionMode: 'client-region',
    modelFamilies: DEFAULT_FAMILIES,
    quotaMetrics: DEFAULT_METRICS,
    advancedFilter: '',
    types: DEFAULT_TYPES,
    output: 'table+csv',
  });

  const { execution, isRunning, execute, cancel, reset } = useToolExecution({
    onCompleted: (result) => {
      if (result.files) setResultFiles(result.files);
      if (result.data?.quotas) setResultQuotas(result.data.quotas);
      if (result.data?.rows) setResultRows(result.data.rows);
    },
    onFailed: (error) => {
      console.error('Tool execution failed:', error);
    },
  });

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    setLoadingClients(true);
    try {
      const allClients = await clientService.getAllClients();
      setClients(allClients);
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoadingClients(false);
    }
  };

  const handleParamChange = (patch: Partial<Omit<QuotaReportParameters, 'clientScope' | 'clients'>>) => {
    setParameters((prev) => ({ ...prev, ...patch }));
  };

  const handleClientToggle = (clientName: string) => {
    setSelectedClientNames((prev) =>
      prev.includes(clientName) ? prev.filter((n) => n !== clientName) : [...prev, clientName]
    );
  };

  const handleSelectClients = (clientNames: string[]) => {
    setSelectedClientNames(clientNames);
  };

  const buildExecutionParams = (): QuotaReportParameters => {
    if (useArcanumInternal) {
      return { ...parameters, clientScope: 'arcanum-internal', clients: [] };
    }
    if (selectedClientNames.length === clients.length && clients.length > 0) {
      return { ...parameters, clientScope: 'all', clients: [] };
    }
    return { ...parameters, clientScope: 'selected', clients: selectedClientNames };
  };

  const handleExecute = async () => {
    setResultFiles([]);
    setResultQuotas([]);
    setResultRows([]);
    const execParams = buildExecutionParams();
    await execute('quota-report', execParams, async (params, onProgress) => {
      const { result, files } = await QuotaReportService.generateReport(params as QuotaReportParameters, onProgress);
      return { type: 'file', files, data: result } as ToolResult;
    });
  };

  const handleDownloadFile = (file: ToolResultFile) => FileExportService.downloadFile(file);
  const handleDownloadAll = () => FileExportService.downloadFiles(resultFiles);

  const handleReset = () => {
    reset();
    setResultFiles([]);
    setResultQuotas([]);
    setResultRows([]);
    setSelectedClientNames([]);
    setUseArcanumInternal(false);
    setParameters({
      regionMode: 'client-region',
      modelFamilies: DEFAULT_FAMILIES,
      quotaMetrics: DEFAULT_METRICS,
      advancedFilter: '',
      types: DEFAULT_TYPES,
      output: 'table+csv',
    });
  };

  const isFormValid = () => {
    if (!useArcanumInternal && selectedClientNames.length === 0) return false;
    if (!parameters.modelFamilies || parameters.modelFamilies.length === 0) return false;
    if (!parameters.quotaMetrics || parameters.quotaMetrics.length === 0) return false;
    if (!parameters.types || parameters.types.length === 0) return false;
    if (!parameters.output) return false;
    return true;
  };

  const quotaColumns = useMemo(
    () =>
      resultQuotas.map((q) => {
        const metricSuffix = q.Metric === 'tokens-per-minute' ? ' (TPM)' : ' (RPM)';
        return `${q.Model}-${q.Type}${metricSuffix}`;
      }),
    [resultQuotas]
  );

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
            <h2 className="mb-0">Quota Report</h2>
          </div>
          <p className="text-muted mb-0">
            Fetch Bedrock quotas (RPM & TPM) across client accounts. Dev accounts are consolidated and always check both
            regions.
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
                  <Form.Group className="mb-3">
                    <Form.Label>
                      Clients <span className="text-danger">*</span>
                    </Form.Label>
                    <GroupedClientSelector
                      clients={clients}
                      selectedClientNames={selectedClientNames}
                      onClientToggle={handleClientToggle}
                      onSelectClients={handleSelectClients}
                      disabled={isRunning || useArcanumInternal}
                      loading={loadingClients}
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Check
                      type="checkbox"
                      id="arcanum-internal-toggle"
                      label={
                        <span>
                          Query Arcanum Internal AWS Accounts{' '}
                          <Badge bg="info" className="ms-1">
                            Direct
                          </Badge>
                        </span>
                      }
                      checked={useArcanumInternal}
                      onChange={(e) => setUseArcanumInternal(e.target.checked)}
                      disabled={isRunning}
                    />
                    <Form.Text className="text-muted">
                      Query all Arcanum dev/prod AWS accounts directly (both regions)
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Region Mode</Form.Label>
                    <Form.Select
                      value={parameters.regionMode}
                      onChange={(e) =>
                        handleParamChange({ regionMode: e.target.value as 'client-region' | 'all-regions' })
                      }
                      disabled={isRunning}
                    >
                      <option value="client-region">Client&apos;s configured region</option>
                      <option value="all-regions">All regions (us-east-1 + ap-southeast-2)</option>
                    </Form.Select>
                    <Form.Text className="text-muted">Dev accounts always check both regions regardless</Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>
                      Model Families <span className="text-danger">*</span>
                    </Form.Label>
                    <div className="d-flex flex-wrap gap-3">
                      {(Object.keys(FAMILY_LABELS) as ModelFamily[]).map((family) => (
                        <Form.Check
                          key={family}
                          type="checkbox"
                          label={FAMILY_LABELS[family]}
                          checked={parameters.modelFamilies.includes(family)}
                          onChange={(e) => {
                            const next = new Set(parameters.modelFamilies);
                            if (e.target.checked) next.add(family);
                            else next.delete(family);
                            handleParamChange({ modelFamilies: Array.from(next) });
                          }}
                          disabled={isRunning}
                        />
                      ))}
                    </div>
                    <Form.Text className="text-muted">Select model families to include</Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>
                      Quota Metrics <span className="text-danger">*</span>
                    </Form.Label>
                    <div className="d-flex gap-3">
                      {(Object.keys(METRIC_LABELS) as QuotaMetric[]).map((metric) => (
                        <Form.Check
                          key={metric}
                          type="checkbox"
                          label={METRIC_LABELS[metric]}
                          checked={parameters.quotaMetrics.includes(metric)}
                          onChange={(e) => {
                            const next = new Set(parameters.quotaMetrics);
                            if (e.target.checked) next.add(metric);
                            else next.delete(metric);
                            handleParamChange({ quotaMetrics: Array.from(next) });
                          }}
                          disabled={isRunning}
                        />
                      ))}
                    </div>
                    <Form.Text className="text-muted">Requests per minute and/or tokens per minute</Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Advanced Filter</Form.Label>
                    <Form.Control
                      type="text"
                      value={parameters.advancedFilter || ''}
                      onChange={(e) => handleParamChange({ advancedFilter: e.target.value })}
                      placeholder="e.g., 'Claude 3.5', 'Nova Premier'"
                      disabled={isRunning}
                    />
                    <Form.Text className="text-muted">Optional text to narrow quotas</Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>
                      Quota Types <span className="text-danger">*</span>
                    </Form.Label>
                    <div className="d-flex gap-3">
                      <Form.Check
                        type="checkbox"
                        label="On-demand"
                        checked={parameters.types.includes('On-demand')}
                        onChange={(e) => {
                          const next = new Set(parameters.types);
                          if (e.target.checked) next.add('On-demand');
                          else next.delete('On-demand');
                          handleParamChange({ types: Array.from(next) as QuotaType[] });
                        }}
                        disabled={isRunning}
                      />
                      <Form.Check
                        type="checkbox"
                        label="Cross-region"
                        checked={parameters.types.includes('Cross-region')}
                        onChange={(e) => {
                          const next = new Set(parameters.types);
                          if (e.target.checked) next.add('Cross-region');
                          else next.delete('Cross-region');
                          handleParamChange({ types: Array.from(next) as QuotaType[] });
                        }}
                        disabled={isRunning}
                      />
                      <Form.Check
                        type="checkbox"
                        label="Global cross-region"
                        checked={parameters.types.includes('Global cross-region')}
                        onChange={(e) => {
                          const next = new Set(parameters.types);
                          if (e.target.checked) next.add('Global cross-region');
                          else next.delete('Global cross-region');
                          handleParamChange({ types: Array.from(next) as QuotaType[] });
                        }}
                        disabled={isRunning}
                      />
                    </div>
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Label>
                      Output <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Select
                      value={parameters.output}
                      onChange={(e) => handleParamChange({ output: e.target.value as 'table+csv' | 'csv' })}
                      disabled={isRunning}
                    >
                      <option value="table+csv">Table + CSV download</option>
                      <option value="csv">CSV only</option>
                    </Form.Select>
                  </Form.Group>

                  <div className="d-grid">
                    <Button variant="primary" size="lg" onClick={handleExecute} disabled={!isFormValid() || isRunning}>
                      {isRunning ? 'Running…' : 'Run Quota Report'}
                    </Button>
                  </div>
                </Form>
              )}

              {execution && (
                <div>
                  <h6 className="mb-3">Current Parameters</h6>
                  <div className="mb-2">
                    <strong>Scope:</strong>{' '}
                    {useArcanumInternal
                      ? 'Arcanum Internal Accounts'
                      : selectedClientNames.length === clients.length && clients.length > 0
                        ? `All clients (${clients.length})`
                        : `${selectedClientNames.length} client${selectedClientNames.length !== 1 ? 's' : ''} selected`}
                  </div>
                  {!useArcanumInternal &&
                    selectedClientNames.length > 0 &&
                    selectedClientNames.length < clients.length && (
                      <div className="mb-2">
                        <strong>Clients:</strong> {selectedClientNames.join(', ')}
                      </div>
                    )}
                  <div className="mb-2">
                    <strong>Region Mode:</strong>{' '}
                    {parameters.regionMode === 'client-region' ? "Client's region" : 'All regions'}
                  </div>
                  <div className="mb-2">
                    <strong>Families:</strong> {parameters.modelFamilies.map((f) => FAMILY_LABELS[f]).join(', ')}
                  </div>
                  <div className="mb-2">
                    <strong>Metrics:</strong> {parameters.quotaMetrics.map((m) => METRIC_LABELS[m]).join(', ')}
                  </div>
                  {parameters.advancedFilter && (
                    <div className="mb-2">
                      <strong>Advanced Filter:</strong> {parameters.advancedFilter}
                    </div>
                  )}
                  <div className="mb-4">
                    <strong>Types:</strong> {parameters.types.join(', ')}
                  </div>

                  {isRunning && (
                    <div className="d-grid">
                      <Button variant="outline-danger" onClick={cancel}>
                        Cancel
                      </Button>
                    </div>
                  )}

                  {execution.status === 'completed' && (
                    <div className="d-grid">
                      <Button variant="outline-primary" onClick={handleReset}>
                        Run New Report
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {loadingClients && (
                <Alert variant="info" className="mt-3">
                  Loading client configurations...
                </Alert>
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* Progress & File Results Panel */}
        <Col lg={8}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">{execution ? 'Execution Progress' : 'Ready to Run'}</h5>
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
                  <h5>Configure and Run Quota Report</h5>
                  <p>Select parameters and run to fetch quotas.</p>
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

              {execution?.status === 'completed' && resultFiles.length === 0 && (
                <Alert variant="warning" className="mb-0">
                  No results generated. Adjust filters and try again.
                </Alert>
              )}

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
                    {resultFiles.map((file, idx) => (
                      <ListGroup.Item key={idx} className="d-flex justify-content-between align-items-center">
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
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Full-width Table Below */}
      {parameters.output !== 'csv' && resultRows.length > 0 && (
        <Card className="border-0 shadow-sm mt-4">
          <Card.Header>
            <h5 className="mb-0">Quota Report Table</h5>
          </Card.Header>
          <Card.Body>
            {resultQuotas.some((q) => q.isPriority) && (
              <Alert variant="success" className="mb-3">
                <strong>Key Models (4.5/4.6)</strong>{' '}
                <span className="text-muted">
                  {resultQuotas
                    .filter((q) => q.isPriority)
                    .map((q) => q.Model)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(', ')}
                  {' \u2014 '}
                  {resultQuotas.filter((q) => q.isPriority).length} quota column
                  {resultQuotas.filter((q) => q.isPriority).length !== 1 ? 's' : ''} highlighted in green
                </span>
              </Alert>
            )}
            <div className="table-responsive" style={{ maxHeight: '60vh' }}>
              <table className="table table-sm table-hover align-middle">
                <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Account Name</th>
                    <th>Stack Names</th>
                    <th>Account ID</th>
                    <th>Region</th>
                    <th>Dev?</th>
                    <th>Quota Sharing</th>
                    {quotaColumns.map((name, i) => (
                      <th
                        key={i}
                        style={{ whiteSpace: 'nowrap' }}
                        className={resultQuotas[i]?.isPriority ? 'table-success fw-bold' : ''}
                      >
                        {resultQuotas[i]?.isPriority && <span className="me-1">*</span>}
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map((row, i) => (
                    <tr key={i} className={row.isDev ? 'table-info' : ''}>
                      <td>{row.accountName}</td>
                      <td>{row.stackNames?.join(', ') || '—'}</td>
                      <td>
                        <code className="small">{row.accountId}</code>
                      </td>
                      <td>{row.region}</td>
                      <td>{row.isDev ? <Badge bg="info">Dev</Badge> : '—'}</td>
                      <td>
                        {row.bedrockAccount ? (
                          <Badge bg="success" title={row.bedrockAccount}>
                            Enabled
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      {resultQuotas.map((q, j) => (
                        <td key={j} className={q.isPriority ? 'fw-semibold' : ''}>
                          {row.values[q.QuotaCode] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card.Body>
        </Card>
      )}
    </Container>
  );
}
