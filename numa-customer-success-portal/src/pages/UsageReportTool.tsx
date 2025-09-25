import { useState, useEffect } from 'react'
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
  Container
} from 'react-bootstrap'
import { ArrowLeft, Download, BarChart } from 'react-bootstrap-icons'
import { Tabs, Tab } from 'react-bootstrap'
import { ProgressTracker } from '@/components/tools/ProgressTracker'
import { useToolExecution } from '@/hooks/useToolExecution'
import { UsageReportService } from '@/services/usageReportService'
import { FileExportService } from '@/utils/fileExport'
import { DateUtils } from '@/utils/dateUtils'
import { clientService } from '@/services/clientService'
import type { ToolResult, ToolResultFile, UsageReportParameters } from '@/types/tools'

export default function UsageReportTool() {
  const navigate = useNavigate()
  const [parameters, setParameters] = useState<UsageReportParameters>({
    clientName: '',
    timePeriod: 'current-year',
    outputFormat: 'csv',
  })
  const [clients, setClients] = useState<Array<{ name: string }>>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [resultFiles, setResultFiles] = useState<ToolResultFile[]>([])
  const [activeTab, setActiveTab] = useState<string>('summary')

  const { execution, isRunning, execute, cancel, reset } = useToolExecution({
    onCompleted: (result) => {
      if (result.files) {
        setResultFiles(result.files)
      }
    },
    onFailed: (error) => {
      console.error('Tool execution failed:', error)
    },
  })

  // Load clients on component mount
  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    setLoadingClients(true)
    try {
      const allClients = await clientService.getAllClients()
      setClients(allClients)
    } catch (error) {
      console.error('Failed to load clients:', error)
    } finally {
      setLoadingClients(false)
    }
  }

  const handleParameterChange = (field: keyof UsageReportParameters, value: string) => {
    setParameters(prev => ({ ...prev, [field]: value }))
  }

  const handleExecute = async () => {
    await execute('usage-report', parameters, async (params, onProgress, _signal) => {
      const { result, files } = await UsageReportService.generateReport(
        params as UsageReportParameters,
        onProgress
      )

      return {
        type: 'file',
        files,
        data: result,
      } as ToolResult
    })
  }

  const handleDownloadFile = (file: ToolResultFile) => {
    FileExportService.downloadFile(file)
  }

  const handleDownloadAll = () => {
    FileExportService.downloadFiles(resultFiles)
  }

  const handleReset = () => {
    reset()
    setResultFiles([])
    setActiveTab('summary')
    setParameters({
      clientName: '',
      timePeriod: 'current-year',
      outputFormat: 'csv',
    })
  }

  const isFormValid = () => {
    return parameters.clientName && parameters.timePeriod && parameters.outputFormat
  }

  const timePeriodOptions = DateUtils.getTimePeriodOptions()

  return (
    <Container fluid>
      {/* Header */}
      <div className="d-flex align-items-center mb-4">
        <Button
          variant="outline-secondary"
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
            <h2 className="mb-0">Usage Report Generator</h2>
          </div>
          <p className="text-muted mb-0">
            Generate comprehensive usage analytics for clients including app runs, chat messages, and user activity summaries.
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
                      Client <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Select
                      value={parameters.clientName}
                      onChange={(e) => handleParameterChange('clientName', e.target.value)}
                      disabled={isRunning || loadingClients}
                    >
                      <option value="">Select a client...</option>
                      {clients.map(client => (
                        <option key={client.name} value={client.name}>
                          {client.name}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Text className="text-muted">
                      Select the client to generate the report for
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>
                      Time Period <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Select
                      value={parameters.timePeriod}
                      onChange={(e) => handleParameterChange('timePeriod', e.target.value)}
                      disabled={isRunning}
                    >
                      <option value="">Select time period...</option>
                      {timePeriodOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Text className="text-muted">
                      Select the time period for the usage report
                    </Form.Text>
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
                    <Form.Text className="text-muted">
                      Choose between CSV files or single JSON file
                    </Form.Text>
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
                    <strong>Client:</strong> {parameters.clientName}
                  </div>
                  <div className="mb-2">
                    <strong>Time Period:</strong> {
                      timePeriodOptions.find(opt => opt.value === parameters.timePeriod)?.label
                    }
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

              {loadingClients && (
                <Alert variant="info">Loading client configurations...</Alert>
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* Progress & Results Panel */}
        <Col lg={8}>
          <Card className="border-0 shadow-sm h-100">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">
                {execution ? 'Execution Progress' : 'Ready to Generate'}
              </h5>
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
                  <h5>Configure and Generate Usage Report</h5>
                  <p>Select a client and time period to get started.</p>
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
                      'No usage data was found for the selected client and time period.'}
                  </p>
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
                      <ListGroup.Item
                        key={index}
                        className="d-flex justify-content-between align-items-center"
                      >
                        <div>
                          <div className="fw-semibold">{file.name}</div>
                          <small className="text-muted">
                            {file.mimeType} • {FileExportService.formatFileSize(file.size)}
                          </small>
                        </div>
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => handleDownloadFile(file)}
                        >
                          <Download />
                        </Button>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>

                  {execution?.result?.data && (
                    <div className="mt-4 p-3 bg-light rounded">
                      <h6 className="mb-2">Report Summary</h6>
                      <Row>
                        <Col sm={3}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-primary">
                              {execution.result.data.metadata.totalAppRuns.toLocaleString()}
                            </div>
                            <small className="text-muted">App Runs</small>
                          </div>
                        </Col>
                        <Col sm={3}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-success">
                              {execution.result.data.metadata.totalChatMessages.toLocaleString()}
                            </div>
                            <small className="text-muted">Chat Messages</small>
                          </div>
                        </Col>
                        <Col sm={3}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-info">
                              {execution.result.data.metadata.uniqueUsers}
                            </div>
                            <small className="text-muted">Unique Users</small>
                          </div>
                        </Col>
                        <Col sm={3}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-warning">
                              {execution.result.data.metadata.displayName}
                            </div>
                            <small className="text-muted">Time Period</small>
                          </div>
                        </Col>
                      </Row>
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
                {execution.result.data.metadata.displayName} • {parameters.clientName}
              </small>
            </div>
          </Card.Header>
          <Card.Body>
            <Tabs
              activeKey={activeTab}
              onSelect={(k) => k && setActiveTab(k)}
              id="usage-report-tabs"
              className="mb-3"
            >
              <Tab eventKey="summary" title={`Summary (${execution.result.data.summary.length})`}>
                <div className="table-responsive" style={{ maxHeight: '60vh' }}>
                  <table className="table table-sm table-hover align-middle">
                    <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th>User ID</th>
                        <th>User Email</th>
                        <th>Month</th>
                        <th>App Runs</th>
                        <th>Chat Messages</th>
                        <th>App Runs by App</th>
                        <th>Chat Messages by Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {execution.result.data.summary.map((row: UsageSummary, i: number) => (
                        <tr key={i}>
                          <td>{row.userId}</td>
                          <td>{row.userEmail}</td>
                          <td>{row.month}</td>
                          <td>{row.appRuns}</td>
                          <td>{row.chatMessages}</td>
                          <td><code className="text-muted">{JSON.stringify(row.appRunsByApp)}</code></td>
                          <td><code className="text-muted">{JSON.stringify(row.chatMessagesByType)}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Tab>
              <Tab eventKey="appRuns" title={`App Runs (${execution.result.data.appRuns.length})`}>
                <div className="table-responsive" style={{ maxHeight: '60vh' }}>
                  <table className="table table-sm table-hover align-middle">
                    <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th>User ID</th>
                        <th>User Email</th>
                        <th>App ID</th>
                        <th>App Name</th>
                        <th>Month</th>
                        <th>Job ID</th>
                        <th>Started At</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {execution.result.data.appRuns.map((row: AppRunRecord, i: number) => (
                        <tr key={i}>
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
              </Tab>
              <Tab eventKey="chat" title={`Chat Messages (${execution.result.data.chatMessages.length})`}>
                <div className="table-responsive" style={{ maxHeight: '60vh' }}>
                  <table className="table table-sm table-hover align-middle">
                    <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th>User ID</th>
                        <th>User Email</th>
                        <th>Month</th>
                        <th>Conversation ID</th>
                        <th>Message Type</th>
                        <th>Role</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {execution.result.data.chatMessages.map((row: ChatMessageRecord, i: number) => (
                        <tr key={i}>
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
              </Tab>
            </Tabs>
          </Card.Body>
        </Card>
      )}
    </Container>
  )
}
