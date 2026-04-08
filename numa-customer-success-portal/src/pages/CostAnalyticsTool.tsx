import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Form, Alert, Row, Col, Badge, Container } from 'react-bootstrap';
import { ArrowLeft, Download, CurrencyDollar } from 'react-bootstrap-icons';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Tabs, Tab } from 'react-bootstrap';
import { ProgressTracker } from '@/components/tools/ProgressTracker';
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector';
import { getSelectionDisplayText } from '@/components/tools/clientSelectionUtils';
import { useToolExecution } from '@/hooks/useToolExecution';
import { CostAnalyticsService } from '@/services/costAnalyticsService';
import { FileExportService } from '@/utils/fileExport';
import { clientService } from '@/services/clientService';
import type { Client } from '@/types';
import type {
  CostAnalyticsParameters,
  CostAnalyticsResult,
  CostRecord,
  CostSummaryRecord,
  ToolResult,
  ToolResultFile,
} from '@/types/tools';

const TIME_PERIOD_OPTIONS = [
  { value: 'last-1-month', label: 'Last 1 Month' },
  { value: 'last-3-months', label: 'Last 3 Months' },
  { value: 'last-6-months', label: 'Last 6 Months' },
  { value: 'current-year', label: 'Current Year' },
  { value: 'custom', label: 'Custom Range' },
];

export default function CostAnalyticsTool() {
  const navigate = useNavigate();
  const [parameters, setParameters] = useState<CostAnalyticsParameters>({
    clientNames: [],
    timePeriod: 'last-3-months',
    granularity: 'MONTHLY',
    includeForecast: true,
    outputFormat: 'csv',
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [resultFiles, setResultFiles] = useState<ToolResultFile[]>([]);
  const [activeTab, setActiveTab] = useState<string>('summary');

  const { execution, isRunning, execute, cancel, reset } = useToolExecution({
    onCompleted: (result) => {
      if (result.files) {
        setResultFiles(result.files);
      }
    },
    onFailed: (error) => {
      console.error('Cost analytics failed:', error);
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
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoadingClients(false);
    }
  };

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

  const handleExecute = async () => {
    const clientNamesToUse = parameters.clientNames.length === clients.length ? [] : parameters.clientNames;
    const paramsToUse = { ...parameters, clientNames: clientNamesToUse };

    await execute('cost-analytics', paramsToUse as unknown as Record<string, unknown>, async (params, onProgress) => {
      const { result, files } = await CostAnalyticsService.generateReport(
        params as unknown as CostAnalyticsParameters,
        onProgress
      );
      return { type: 'file', files, data: result } as ToolResult;
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
    setParameters({
      clientNames: [],
      timePeriod: 'last-3-months',
      granularity: 'MONTHLY',
      includeForecast: true,
      outputFormat: 'csv',
    });
  };

  const isFormValid = () => {
    if (parameters.clientNames.length === 0) return false;
    if (parameters.timePeriod === 'custom') {
      return (
        !!parameters.customStartDate &&
        !!parameters.customEndDate &&
        parameters.customStartDate <= parameters.customEndDate
      );
    }
    return true;
  };

  const getClientSelectionText = () => {
    return getSelectionDisplayText(clients, parameters.clientNames);
  };

  // Extract result data
  const resultData = execution?.result?.data as CostAnalyticsResult | undefined;
  const summaryRows = resultData?.summary || [];
  const serviceBreakdownRows = resultData?.serviceBreakdown || [];
  const failedClientRows = resultData?.failedClients || [];

  // Build aggregated summary by client (across all periods)
  const clientTotals = useMemo(() => {
    const totals = new Map<string, { totalCost: number; forecastedCost?: number; periods: number }>();
    for (const row of summaryRows) {
      const existing = totals.get(row.clientName);
      if (existing) {
        existing.totalCost += row.totalCost;
        existing.periods++;
        if (row.forecastedCost) {
          existing.forecastedCost = (existing.forecastedCost || 0) + row.forecastedCost;
        }
      } else {
        totals.set(row.clientName, {
          totalCost: row.totalCost,
          forecastedCost: row.forecastedCost,
          periods: 1,
        });
      }
    }
    return Array.from(totals.entries())
      .map(([clientName, data]) => ({ clientName, ...data }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [summaryRows]);

  // Build service totals across all clients
  const serviceTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of serviceBreakdownRows) {
      totals.set(row.service, (totals.get(row.service) || 0) + row.unblendedCost);
    }
    return Array.from(totals.entries())
      .map(([service, cost]) => ({ service, cost: Math.round(cost * 100) / 100 }))
      .sort((a, b) => b.cost - a.cost);
  }, [serviceBreakdownRows]);

  const formatCost = (cost: number | undefined) => {
    if (cost === undefined || cost === null) return '-';
    return `$${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatChange = (change: number | undefined, percent: number | undefined) => {
    if (change === undefined || change === null) return '-';
    const sign = change >= 0 ? '+' : '';
    const color = change > 0 ? 'text-danger' : change < 0 ? 'text-success' : 'text-muted';
    const pctStr = percent !== undefined ? ` (${sign}${percent}%)` : '';
    return (
      <span className={color}>
        {sign}
        {formatCost(change)}
        {pctStr}
      </span>
    );
  };

  const renderSummaryTable = () => (
    <div>
      {/* Aggregate summary cards */}
      {resultData && (
        <Row className="mb-3 g-2">
          <Col xs={6} md={3}>
            <Card className="text-center border-0 bg-primary bg-opacity-10">
              <Card.Body className="py-2">
                <div className="small text-muted">Total Cost</div>
                <div className="fw-bold fs-5">{formatCost(resultData.metadata.totalCost)}</div>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={6} md={3}>
            <Card className="text-center border-0 bg-info bg-opacity-10">
              <Card.Body className="py-2">
                <div className="small text-muted">Clients Processed</div>
                <div className="fw-bold fs-5">{resultData.metadata.clientsProcessed}</div>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={6} md={3}>
            <Card className="text-center border-0 bg-secondary bg-opacity-10">
              <Card.Body className="py-2">
                <div className="small text-muted">Period</div>
                <div className="fw-bold small">
                  {resultData.metadata.startDate} to {resultData.metadata.endDate}
                </div>
              </Card.Body>
            </Card>
          </Col>
          {resultData.metadata.clientsFailed > 0 && (
            <Col xs={6} md={3}>
              <Card className="text-center border-0 bg-danger bg-opacity-10">
                <Card.Body className="py-2">
                  <div className="small text-muted">Failed</div>
                  <div className="fw-bold fs-5 text-danger">{resultData.metadata.clientsFailed}</div>
                </Card.Body>
              </Card>
            </Col>
          )}
        </Row>
      )}

      {/* Client totals */}
      <h6 className="mb-2">Cost by Client</h6>
      <div className="table-responsive" style={{ maxHeight: '40vh' }}>
        <table className="table table-sm table-hover align-middle">
          <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th>Client</th>
              <th className="text-end">Total Cost</th>
              {parameters.includeForecast && <th className="text-end">Forecasted (Current Month)</th>}
              <th className="text-end">Periods</th>
            </tr>
          </thead>
          <tbody>
            {clientTotals.length === 0 && (
              <tr>
                <td colSpan={parameters.includeForecast ? 4 : 3} className="text-center text-muted">
                  No cost data found.
                </td>
              </tr>
            )}
            {clientTotals.map((row, i) => (
              <tr key={i}>
                <td>
                  <Badge bg="secondary">{row.clientName}</Badge>
                </td>
                <td className="text-end fw-semibold">{formatCost(row.totalCost)}</td>
                {parameters.includeForecast && <td className="text-end">{formatCost(row.forecastedCost)}</td>}
                <td className="text-end">{row.periods}</td>
              </tr>
            ))}
            {clientTotals.length > 1 && (
              <tr className="table-primary fw-bold">
                <td>Total</td>
                <td className="text-end">{formatCost(clientTotals.reduce((s, r) => s + r.totalCost, 0))}</td>
                {parameters.includeForecast && <td className="text-end">-</td>}
                <td className="text-end">-</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTrendTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Period</th>
            <th className="text-end">Total Cost</th>
            {parameters.includeForecast && <th className="text-end">Forecast</th>}
            <th className="text-end">Change</th>
            <th>Top Services</th>
          </tr>
        </thead>
        <tbody>
          {summaryRows.length === 0 && (
            <tr>
              <td colSpan={parameters.includeForecast ? 6 : 5} className="text-center text-muted">
                No cost data found.
              </td>
            </tr>
          )}
          {summaryRows.map((row: CostSummaryRecord, i: number) => (
            <tr key={i}>
              <td>
                <Badge bg="secondary">{row.clientName}</Badge>
              </td>
              <td>{row.period}</td>
              <td className="text-end fw-semibold">{formatCost(row.totalCost)}</td>
              {parameters.includeForecast && <td className="text-end">{formatCost(row.forecastedCost)}</td>}
              <td className="text-end">{formatChange(row.costChange, row.costChangePercent)}</td>
              <td>
                <small className="text-muted">
                  {row.topServices
                    .slice(0, 3)
                    .map((t) => `${t.service}: ${formatCost(t.cost)}`)
                    .join(' | ')}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderServiceBreakdownTable = () => (
    <div>
      {/* Aggregate service totals */}
      <h6 className="mb-2">Service Totals (All Clients)</h6>
      <div className="table-responsive mb-3" style={{ maxHeight: '30vh' }}>
        <table className="table table-sm table-hover align-middle">
          <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th>Service</th>
              <th className="text-end">Total Cost</th>
              <th className="text-end">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {serviceTotals.map((row, i) => {
              const totalAll = serviceTotals.reduce((s, r) => s + r.cost, 0);
              const pct = totalAll > 0 ? Math.round((row.cost / totalAll) * 10000) / 100 : 0;
              return (
                <tr key={i}>
                  <td>{row.service}</td>
                  <td className="text-end fw-semibold">{formatCost(row.cost)}</td>
                  <td className="text-end">{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detailed breakdown */}
      <h6 className="mb-2">Detailed Breakdown</h6>
      <div className="table-responsive" style={{ maxHeight: '30vh' }}>
        <table className="table table-sm table-hover align-middle">
          <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th>Client</th>
              <th>Period</th>
              <th>Service</th>
              <th className="text-end">Cost</th>
            </tr>
          </thead>
          <tbody>
            {serviceBreakdownRows.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-muted">
                  No service breakdown data found.
                </td>
              </tr>
            )}
            {serviceBreakdownRows.map((row: CostRecord, i: number) => (
              <tr key={i}>
                <td>
                  <Badge bg="secondary">{row.clientName}</Badge>
                </td>
                <td>{row.period}</td>
                <td>{row.service}</td>
                <td className="text-end">{formatCost(row.unblendedCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderFailedClientsTable = () => (
    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
      <table className="table table-sm table-hover align-middle">
        <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            <th>Client</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {failedClientRows.map((row, i) => (
            <tr key={i}>
              <td>
                <Badge bg="danger">{row.clientName}</Badge>
              </td>
              <td>
                <code className="text-danger">{row.error}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
            <CurrencyDollar className="me-2 text-primary" size={24} />
            <h2 className="mb-0">Cost Analytics</h2>
          </div>
          <p className="text-muted mb-0">
            Analyze AWS costs per client with service breakdowns, monthly trends, and spend forecasts.
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
                    <GroupedClientSelector
                      clients={clients}
                      selectedClientNames={parameters.clientNames}
                      onClientToggle={handleClientToggle}
                      onSelectClients={handleSelectClients}
                      disabled={isRunning}
                      loading={loadingClients}
                    />
                  </Form.Group>

                  {/* Time Period */}
                  <Form.Group className="mb-3">
                    <Form.Label>Time Period</Form.Label>
                    <Form.Select
                      value={parameters.timePeriod}
                      onChange={(e) =>
                        setParameters((prev) => ({
                          ...prev,
                          timePeriod: e.target.value,
                          ...(e.target.value !== 'custom'
                            ? { customStartDate: undefined, customEndDate: undefined }
                            : {}),
                        }))
                      }
                      disabled={isRunning}
                    >
                      {TIME_PERIOD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>

                  {/* Custom Date Range */}
                  {parameters.timePeriod === 'custom' && (
                    <Row className="mb-3 g-2">
                      <Col xs={6}>
                        <Form.Label className="small">Start Date</Form.Label>
                        <DatePicker
                          selected={parameters.customStartDate ? new Date(parameters.customStartDate) : null}
                          onChange={(date: Date | null) =>
                            setParameters((prev) => ({
                              ...prev,
                              customStartDate: date ? date.toISOString().split('T')[0] : undefined,
                            }))
                          }
                          dateFormat="yyyy-MM-dd"
                          className="form-control form-control-sm"
                          placeholderText="Start date"
                          isClearable
                          showMonthDropdown
                          showYearDropdown
                          dropdownMode="select"
                        />
                      </Col>
                      <Col xs={6}>
                        <Form.Label className="small">End Date</Form.Label>
                        <DatePicker
                          selected={parameters.customEndDate ? new Date(parameters.customEndDate) : null}
                          onChange={(date: Date | null) =>
                            setParameters((prev) => ({
                              ...prev,
                              customEndDate: date ? date.toISOString().split('T')[0] : undefined,
                            }))
                          }
                          dateFormat="yyyy-MM-dd"
                          className="form-control form-control-sm"
                          placeholderText="End date"
                          isClearable
                          showMonthDropdown
                          showYearDropdown
                          dropdownMode="select"
                        />
                      </Col>
                    </Row>
                  )}

                  {/* Granularity */}
                  <Form.Group className="mb-3">
                    <Form.Label>Granularity</Form.Label>
                    <div>
                      <Form.Check
                        inline
                        type="radio"
                        label="Monthly"
                        name="granularity"
                        checked={parameters.granularity === 'MONTHLY'}
                        onChange={() => setParameters((prev) => ({ ...prev, granularity: 'MONTHLY' }))}
                        disabled={isRunning}
                      />
                      <Form.Check
                        inline
                        type="radio"
                        label="Daily"
                        name="granularity"
                        checked={parameters.granularity === 'DAILY'}
                        onChange={() => setParameters((prev) => ({ ...prev, granularity: 'DAILY' }))}
                        disabled={isRunning}
                      />
                    </div>
                  </Form.Group>

                  {/* Forecast toggle */}
                  <Form.Group className="mb-3">
                    <Form.Check
                      type="switch"
                      label="Include cost forecast"
                      checked={parameters.includeForecast}
                      onChange={(e) => setParameters((prev) => ({ ...prev, includeForecast: e.target.checked }))}
                      disabled={isRunning}
                    />
                    <Form.Text className="text-muted">
                      Forecasts the current month&apos;s total based on spend-to-date.
                    </Form.Text>
                  </Form.Group>

                  {/* Output format */}
                  <Form.Group className="mb-3">
                    <Form.Label>Export Format</Form.Label>
                    <Form.Select
                      value={parameters.outputFormat}
                      onChange={(e) =>
                        setParameters((prev) => ({ ...prev, outputFormat: e.target.value as 'csv' | 'json' }))
                      }
                      disabled={isRunning}
                    >
                      <option value="csv">CSV</option>
                      <option value="json">CSV + JSON</option>
                    </Form.Select>
                  </Form.Group>

                  <Alert variant="info" className="py-2 small">
                    Cost Explorer data has a ~24hr delay. Each API call costs $0.01.
                  </Alert>

                  <div className="d-grid">
                    <Button variant="primary" onClick={handleExecute} disabled={!isFormValid() || isRunning}>
                      Analyze Costs
                    </Button>
                  </div>
                </Form>
              )}

              {/* Execution summary when running/completed */}
              {execution && (
                <div>
                  <div className="mb-3">
                    <strong>Clients:</strong> <span className="text-muted">{getClientSelectionText()}</span>
                  </div>
                  <div className="mb-3">
                    <strong>Period:</strong>{' '}
                    <span className="text-muted">
                      {TIME_PERIOD_OPTIONS.find((o) => o.value === parameters.timePeriod)?.label ||
                        parameters.timePeriod}
                    </span>
                  </div>
                  <div className="mb-3">
                    <strong>Granularity:</strong> <span className="text-muted">{parameters.granularity}</span>
                  </div>

                  <ProgressTracker
                    status={execution.status}
                    progress={execution.progress}
                    error={execution.error}
                    startedAt={execution.startedAt}
                    completedAt={execution.completedAt}
                  />

                  <div className="d-flex gap-2 mt-3">
                    {isRunning && (
                      <Button variant="outline-danger" onClick={cancel} size="sm">
                        Cancel
                      </Button>
                    )}
                    {!isRunning && (
                      <Button variant="outline-secondary" onClick={handleReset} size="sm">
                        New Analysis
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* Results Panel */}
        <Col lg={8}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Results</h5>
              {resultFiles.length > 0 && (
                <div className="d-flex gap-2">
                  {resultFiles.map((file, idx) => (
                    <Button key={idx} variant="outline-primary" size="sm" onClick={() => handleDownloadFile(file)}>
                      <Download size={12} className="me-1" />
                      {file.name.split('-').slice(0, 2).join('-')}
                    </Button>
                  ))}
                  {resultFiles.length > 1 && (
                    <Button variant="primary" size="sm" onClick={handleDownloadAll}>
                      <Download size={12} className="me-1" />
                      Download All
                    </Button>
                  )}
                </div>
              )}
            </Card.Header>
            <Card.Body>
              {!execution && (
                <div className="text-center text-muted py-5">
                  <CurrencyDollar size={48} className="mb-3 opacity-25" />
                  <p>Configure and run cost analysis to see results here.</p>
                </div>
              )}

              {execution?.status === 'failed' && (
                <Alert variant="danger">
                  <strong>Error:</strong> {execution.error}
                </Alert>
              )}

              {execution?.status === 'completed' && resultData && (
                <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k || 'summary')} className="mb-3">
                  <Tab eventKey="summary" title={`Summary (${clientTotals.length})`}>
                    {renderSummaryTable()}
                  </Tab>
                  <Tab eventKey="trend" title={`Trend (${summaryRows.length})`}>
                    {renderTrendTable()}
                  </Tab>
                  <Tab eventKey="services" title={`Services (${serviceTotals.length})`}>
                    {renderServiceBreakdownTable()}
                  </Tab>
                  {failedClientRows.length > 0 && (
                    <Tab
                      eventKey="failed"
                      title={<span className="text-danger">Failed ({failedClientRows.length})</span>}
                    >
                      {renderFailedClientsTable()}
                    </Tab>
                  )}
                </Tabs>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
