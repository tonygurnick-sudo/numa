import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Form, Alert, Row, Col, ListGroup, Badge, Container, Table } from 'react-bootstrap';
import { ArrowLeft, Download, People } from 'react-bootstrap-icons';
import { ProgressTracker } from '@/components/tools/ProgressTracker';
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector';
import { getSelectionDisplayText } from '@/components/tools/clientSelectionUtils';
import { useToolExecution } from '@/hooks/useToolExecution';
import { AllUsersReportService } from '@/services/allUsersReportService';
import { FileExportService } from '@/utils/fileExport';
import { clientService } from '@/services/clientService';
import type { Client } from '@/types';
import type { ToolResult, ToolResultFile, AllUsersReportParameters, UserRecord } from '@/types/tools';

export default function AllUsersReportTool() {
  const navigate = useNavigate();
  const [parameters, setParameters] = useState<AllUsersReportParameters>({
    clientNames: [],
    userTypeFilter: 'all',
    outputFormat: 'csv',
    includeLastLogin: false,
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [resultFiles, setResultFiles] = useState<ToolResultFile[]>([]);

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
    // If all clients are selected, pass empty array to indicate "all clients"
    const clientNamesToUse = parameters.clientNames.length === clients.length ? [] : parameters.clientNames;
    const paramsToUse = { ...parameters, clientNames: clientNamesToUse };

    await execute('all-users-report', paramsToUse, async (params, onProgress, _signal) => {
      const { result, files } = await AllUsersReportService.generateReport(
        params as AllUsersReportParameters,
        onProgress
      );

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
    setParameters({
      clientNames: [],
      userTypeFilter: 'all',
      outputFormat: 'csv',
      includeLastLogin: false,
    });
  };

  const isFormValid = () => {
    return parameters.clientNames.length > 0 && parameters.outputFormat;
  };

  const getClientSelectionText = () => {
    return getSelectionDisplayText(clients, parameters.clientNames);
  };

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
            <People className="me-2 text-primary" size={24} />
            <h2 className="mb-0">All Users Report</h2>
          </div>
          <p className="text-muted mb-0">
            Extract all users from one or all client accounts with email addresses, user type, and customer attribution.
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

                  {/* User Type Filter */}
                  <Form.Group className="mb-3">
                    <Form.Label>User Type Filter</Form.Label>
                    <Form.Select
                      value={parameters.userTypeFilter}
                      onChange={(e) =>
                        setParameters((prev) => ({
                          ...prev,
                          userTypeFilter: e.target.value as 'all' | 'admin' | 'user',
                        }))
                      }
                      disabled={isRunning}
                    >
                      <option value="all">All Users</option>
                      <option value="admin">Admins Only</option>
                      <option value="user">Regular Users Only</option>
                    </Form.Select>
                    <Form.Text className="text-muted">Filter by user type (admin group membership)</Form.Text>
                  </Form.Group>

                  {/* Output Format */}
                  <Form.Group className="mb-3">
                    <Form.Label>
                      Output Format <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Select
                      value={parameters.outputFormat}
                      onChange={(e) =>
                        setParameters((prev) => ({
                          ...prev,
                          outputFormat: e.target.value as 'csv' | 'json',
                        }))
                      }
                      disabled={isRunning}
                    >
                      <option value="csv">CSV File</option>
                      <option value="json">JSON File</option>
                    </Form.Select>
                  </Form.Group>

                  {/* Include Last Login Toggle */}
                  <Form.Group className="mb-4">
                    <Form.Check
                      type="switch"
                      id="include-last-login"
                      label="Include Last Login Time"
                      checked={parameters.includeLastLogin}
                      onChange={(e) =>
                        setParameters((prev) => ({
                          ...prev,
                          includeLastLogin: e.target.checked,
                        }))
                      }
                      disabled={isRunning}
                    />
                    <Form.Text className="text-muted">
                      Enabling this will slow down report generation as it requires an additional API call for each
                      user.
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
                    <strong>Clients:</strong> {getClientSelectionText()}
                  </div>
                  <div className="mb-2">
                    <strong>User Type:</strong>{' '}
                    {parameters.userTypeFilter === 'all'
                      ? 'All Users'
                      : parameters.userTypeFilter === 'admin'
                        ? 'Admins Only'
                        : 'Regular Users Only'}
                  </div>
                  <div className="mb-2">
                    <strong>Output Format:</strong> {parameters.outputFormat.toUpperCase()}
                  </div>
                  <div className="mb-4">
                    <strong>Include Last Login:</strong> {parameters.includeLastLogin ? 'Yes' : 'No'}
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
                  <People size={48} className="mb-3" />
                  <h5>Configure and Generate Users Report</h5>
                  <p>Select clients and user type filter to get started.</p>
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
                  <Alert.Heading>No Users Found</Alert.Heading>
                  <p className="mb-0">
                    {execution.result?.data?.message || 'No users were found for the selected clients.'}
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

                  <ListGroup className="mb-4">
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
                    <div className="p-3 bg-light rounded mb-4">
                      <h6 className="mb-2">Report Summary</h6>
                      <Row>
                        <Col sm={2}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-primary">
                              {execution.result.data.metadata.clientsProcessed}
                            </div>
                            <small className="text-muted">Clients</small>
                          </div>
                        </Col>
                        <Col sm={3}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-success">{execution.result.data.metadata.totalUsers}</div>
                            <small className="text-muted">Total Users</small>
                          </div>
                        </Col>
                        <Col sm={2}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-warning">{execution.result.data.metadata.adminUsers}</div>
                            <small className="text-muted">Admins</small>
                          </div>
                        </Col>
                        <Col sm={3}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-info">{execution.result.data.metadata.regularUsers}</div>
                            <small className="text-muted">Regular Users</small>
                          </div>
                        </Col>
                        <Col sm={2}>
                          <div className="text-center">
                            <div className="h4 mb-0 text-danger">{execution.result.data.metadata.clientsFailed}</div>
                            <small className="text-muted">Failed</small>
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

      {/* Users Table */}
      {execution?.status === 'completed' && execution?.result?.data?.users?.length > 0 && (
        <Card className="border-0 shadow-sm mt-4">
          <Card.Header>
            <div className="d-flex align-items-center justify-content-between">
              <h5 className="mb-0">Users ({execution.result.data.users.length})</h5>
              <small className="text-muted">{execution.result.data.metadata.clientsProcessed} client(s)</small>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="table-responsive" style={{ maxHeight: '60vh' }}>
              <Table hover className="align-middle mb-0">
                <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Client</th>
                    <th>Email</th>
                    <th>Username</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Enabled</th>
                    <th>Last Login</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {execution.result.data.users.map((user: UserRecord, i: number) => (
                    <tr key={i}>
                      <td>
                        <Badge bg="secondary">{user.clientName}</Badge>
                      </td>
                      <td>{user.email}</td>
                      <td>
                        <code>{user.username}</code>
                      </td>
                      <td>
                        <Badge bg={user.userType === 'admin' ? 'warning' : 'info'}>{user.userType}</Badge>
                      </td>
                      <td>{user.status}</td>
                      <td>
                        <Badge bg={user.enabled ? 'success' : 'danger'}>{user.enabled ? 'Yes' : 'No'}</Badge>
                      </td>
                      <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</td>
                      <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card.Body>
        </Card>
      )}
    </Container>
  );
}
