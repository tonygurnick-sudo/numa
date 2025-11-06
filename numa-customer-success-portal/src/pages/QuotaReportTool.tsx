import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Button,
  Form,
  Alert,
  Row,
  Col,
  ListGroup,
  Badge,
  Container,
} from 'react-bootstrap'
import { ArrowLeft, Download, BarChart } from 'react-bootstrap-icons'
import { useToolExecution } from '@/hooks/useToolExecution'
import { ProgressTracker } from '@/components/tools/ProgressTracker'
import { clientService } from '@/services/clientService'
import { FileExportService } from '@/utils/fileExport'
import { QuotaReportService } from '@/services/quotaReportService'
import type { QuotaReportParameters, ToolResult, ToolResultFile, QuotaDescriptor, QuotaReportRow } from '@/types/tools'

const DEFAULT_REGIONS = ['us-east-1', 'ap-southeast-2']
const DEFAULT_TYPES: ('On-demand' | 'Cross-region')[] = ['On-demand', 'Cross-region']
const DEFAULT_FAMILIES: ('claude' | 'nova')[] = ['claude', 'nova']

export default function QuotaReportTool() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Array<{ name: string }>>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [resultFiles, setResultFiles] = useState<ToolResultFile[]>([])
  const [resultQuotas, setResultQuotas] = useState<QuotaDescriptor[]>([])
  const [resultRows, setResultRows] = useState<QuotaReportRow[]>([])

  const [parameters, setParameters] = useState<QuotaReportParameters>({
    clientScope: 'all',
    clients: [],
    regions: DEFAULT_REGIONS,
    modelFamilies: DEFAULT_FAMILIES,
    advancedFilter: '',
    types: DEFAULT_TYPES,
    output: 'table+csv',
  })

  const { execution, isRunning, execute, cancel, reset } = useToolExecution({
    onCompleted: (result) => {
      if (result.files) setResultFiles(result.files)
      if (result.data?.quotas) setResultQuotas(result.data.quotas)
      if (result.data?.rows) setResultRows(result.data.rows)
    },
    onFailed: (error) => {
      console.error('Tool execution failed:', error)
    },
  })

  useEffect(() => { loadClients() }, [])

  const loadClients = async () => {
    setLoadingClients(true)
    try {
      const allClients = await clientService.getAllClients()
      setClients(allClients)
    } catch (err) {
      console.error('Failed to load clients:', err)
    } finally {
      setLoadingClients(false)
    }
  }

  const handleParamChange = (patch: Partial<QuotaReportParameters>) => {
    setParameters(prev => ({ ...prev, ...patch }))
  }

  const handleExecute = async () => {
    setResultFiles([])
    setResultQuotas([])
    setResultRows([])
    await execute('quota-report', parameters, async (params, onProgress) => {
      const { result, files } = await QuotaReportService.generateReport(
        params as QuotaReportParameters,
        onProgress,
      )
      return { type: 'file', files, data: result } as ToolResult
    })
  }

  const handleDownloadFile = (file: ToolResultFile) => FileExportService.downloadFile(file)
  const handleDownloadAll = () => FileExportService.downloadFiles(resultFiles)

  const handleReset = () => {
    reset()
    setResultFiles([])
    setResultQuotas([])
    setResultRows([])
    setParameters({
      clientScope: 'all',
      clients: [],
      regions: DEFAULT_REGIONS,
      modelFamilies: DEFAULT_FAMILIES,
      advancedFilter: '',
      types: DEFAULT_TYPES,
      output: 'table+csv',
    })
  }

  const isFormValid = () => {
    if (!parameters.clientScope) return false
    if (parameters.clientScope === 'selected' && (!parameters.clients || parameters.clients.length === 0)) return false
    if (!parameters.regions || parameters.regions.length === 0) return false
    if (!parameters.modelFamilies || parameters.modelFamilies.length === 0) return false
    if (!parameters.types || parameters.types.length === 0) return false
    if (!parameters.output) return false
    return true
  }

  const quotaColumns = useMemo(() => resultQuotas.map(q => `${q.Model}-${q.Type}`), [resultQuotas])

  return (
    <Container fluid>
      {/* Header */}
      <div className="d-flex align-items-center mb-4">
        <Button
          variant="secondary"
          onClick={() => navigate('/')}
          className="me-3"
          disabled={isRunning}
        >
          <ArrowLeft className="me-1" />
          Back to Dashboard
        </Button>
        <div>
          <div className="d-flex align-items-center">
            <BarChart className="me-2 text-primary" size={24} />
            <h2 className="mb-0">Quota Report</h2>
          </div>
          <p className="text-muted mb-0">
            Fetch Bedrock RPM quotas across client accounts and regions. Download CSV and view a full-width table below.
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
                    <Form.Label>Client Scope <span className="text-danger">*</span></Form.Label>
                    <Form.Select
                      value={parameters.clientScope}
                      onChange={(e) => handleParamChange({ clientScope: e.target.value as 'all' | 'selected' })}
                      disabled={isRunning}
                    >
                      <option value="all">All clients</option>
                      <option value="selected">Selected clients</option>
                    </Form.Select>
                    <Form.Text className="text-muted">Choose whether to run across all or selected clients</Form.Text>
                  </Form.Group>

                  {parameters.clientScope === 'selected' && (
                    <Form.Group className="mb-3">
                      <Form.Label>Clients <span className="text-danger">*</span></Form.Label>
                      <Form.Select
                        multiple
                        value={parameters.clients || []}
                        onChange={(e) => {
                          const opts = Array.from(e.target.selectedOptions).map(o => o.value)
                          handleParamChange({ clients: opts })
                        }}
                        disabled={isRunning || loadingClients}
                        style={{ minHeight: 140 }}
                      >
                        {clients.map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </Form.Select>
                      <Form.Text className="text-muted">Hold Cmd/Ctrl to select multiple</Form.Text>
                    </Form.Group>
                  )}

                  <Form.Group className="mb-3">
                    <Form.Label>Regions <span className="text-danger">*</span></Form.Label>
                    <Form.Select
                      multiple
                      value={parameters.regions}
                      onChange={(e) => {
                        const opts = Array.from(e.target.selectedOptions).map(o => o.value)
                        handleParamChange({ regions: opts })
                      }}
                      disabled={isRunning}
                      style={{ minHeight: 110 }}
                    >
                      {DEFAULT_REGIONS.map(r => (<option key={r} value={r}>{r}</option>))}
                    </Form.Select>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Model Families <span className="text-danger">*</span></Form.Label>
                    <div className="d-flex gap-3">
                      <Form.Check
                        type="checkbox"
                        label="Claude"
                        checked={parameters.modelFamilies.includes('claude')}
                        onChange={(e) => {
                          const next = new Set(parameters.modelFamilies)
                          if (e.target.checked) next.add('claude'); else next.delete('claude')
                          handleParamChange({ modelFamilies: Array.from(next) as ModelFamily[] })
                        }}
                        disabled={isRunning}
                      />
                      <Form.Check
                        type="checkbox"
                        label="Nova"
                        checked={parameters.modelFamilies.includes('nova')}
                        onChange={(e) => {
                          const next = new Set(parameters.modelFamilies)
                          if (e.target.checked) next.add('nova'); else next.delete('nova')
                          handleParamChange({ modelFamilies: Array.from(next) as ModelFamily[] })
                        }}
                        disabled={isRunning}
                      />
                    </div>
                    <Form.Text className="text-muted">Include one or both families (Claude, Nova)</Form.Text>
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
                    <Form.Label>Quota Types <span className="text-danger">*</span></Form.Label>
                    <div className="d-flex gap-3">
                      <Form.Check
                        type="checkbox"
                        label="On-demand"
                        checked={parameters.types.includes('On-demand')}
                        onChange={(e) => {
                          const next = new Set(parameters.types)
                          if (e.target.checked) next.add('On-demand'); else next.delete('On-demand')
                          handleParamChange({ types: Array.from(next) as QuotaType[] })
                        }}
                        disabled={isRunning}
                      />
                      <Form.Check
                        type="checkbox"
                        label="Cross-region"
                        checked={parameters.types.includes('Cross-region')}
                        onChange={(e) => {
                          const next = new Set(parameters.types)
                          if (e.target.checked) next.add('Cross-region'); else next.delete('Cross-region')
                          handleParamChange({ types: Array.from(next) as QuotaType[] })
                        }}
                        disabled={isRunning}
                      />
                    </div>
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Label>Output <span className="text-danger">*</span></Form.Label>
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
                  <div className="mb-2"><strong>Scope:</strong> {parameters.clientScope}</div>
                  {parameters.clientScope === 'selected' && (
                    <div className="mb-2"><strong>Clients:</strong> {parameters.clients?.join(', ') || '—'}</div>
                  )}
                  <div className="mb-2"><strong>Regions:</strong> {parameters.regions.join(', ')}</div>
                  <div className="mb-2"><strong>Families:</strong> {parameters.modelFamilies.join(', ')}</div>
                  {parameters.advancedFilter && (
                    <div className="mb-2"><strong>Advanced Filter:</strong> {parameters.advancedFilter}</div>
                  )}
                  <div className="mb-4"><strong>Types:</strong> {parameters.types.join(', ')}</div>

                  {isRunning && (
                    <div className="d-grid">
                      <Button variant="outline-danger" onClick={cancel}>Cancel</Button>
                    </div>
                  )}

                  {execution.status === 'completed' && (
                    <div className="d-grid">
                      <Button variant="outline-primary" onClick={handleReset}>Run New Report</Button>
                    </div>
                  )}
                </div>
              )}

              {loadingClients && (
                <Alert variant="info" className="mt-3">Loading client configurations...</Alert>
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
                <Badge bg={
                  execution.status === 'completed' ? 'success' :
                    execution.status === 'failed' ? 'danger' :
                      execution.status === 'running' ? 'primary' : 'secondary'
                }>
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
                <Alert variant="warning" className="mb-0">No results generated. Adjust filters and try again.</Alert>
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
                          <small className="text-muted">{file.mimeType} • {FileExportService.formatFileSize(file.size)}</small>
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
            <div className="table-responsive" style={{ maxHeight: '60vh' }}>
              <table className="table table-sm table-hover align-middle">
                <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Account Name</th>
                    <th>Account ID</th>
                    <th>Region</th>
                    {quotaColumns.map((name, i) => (
                      <th key={i}>{name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map((row, i) => (
                    <tr key={i}>
                      <td>{row.accountName}</td>
                      <td>{row.accountId}</td>
                      <td>{row.region}</td>
                      {resultQuotas.map((q, j) => (
                        <td key={j}>{row.values[q.QuotaCode] ?? ''}</td>
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
  )
}
