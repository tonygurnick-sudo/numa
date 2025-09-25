import { useState, useEffect } from 'react'
import { Modal, Button, Form, Alert, Row, Col, ListGroup } from 'react-bootstrap'
import { Download, X } from 'react-bootstrap-icons'
import { ProgressTracker } from './ProgressTracker'
import { useToolExecution } from '@/hooks/useToolExecution'
import { UsageReportService } from '@/services/usageReportService'
import { FileExportService } from '@/utils/fileExport'
import { DateUtils } from '@/utils/dateUtils'
import { clientService } from '@/services/clientService'
import type { Tool, ToolResult, ToolResultFile, ToolParameter, UsageReportParameters } from '@/types/tools'

interface ToolExecutionModalProps {
  tool: Tool | null
  show: boolean
  onHide: () => void
}

export function ToolExecutionModal({ tool, show, onHide }: ToolExecutionModalProps) {
  const [parameters, setParameters] = useState<Record<string, unknown>>({})
  const [clients, setClients] = useState<Array<{ name: string }>>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [resultFiles, setResultFiles] = useState<ToolResultFile[]>([])

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

  // Load clients when modal opens
  useEffect(() => {
    if (show && tool?.id === 'usage-report') {
      loadClients()
    }
  }, [show, tool])

  // Initialize parameters with defaults when tool changes
  useEffect(() => {
    if (tool) {
      const defaultParams: Record<string, unknown> = {}
      tool.parameters.forEach(param => {
        if (param.defaultValue !== undefined) {
          defaultParams[param.name] = param.defaultValue
        }
      })
      setParameters(defaultParams)
    }
  }, [tool])

  // Reset state when modal closes
  useEffect(() => {
    if (!show) {
      reset()
      setResultFiles([])
      setParameters({})
    }
  }, [show, reset])

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

  const handleParameterChange = (paramName: string, value: unknown) => {
    setParameters(prev => ({ ...prev, [paramName]: value }))
  }

  const handleExecute = async () => {
    if (!tool) return

    if (tool.id === 'usage-report') {
      await execute(tool.id, parameters, async (params, onProgress, _signal) => {
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
  }

  const handleDownloadFile = (file: ToolResultFile) => {
    FileExportService.downloadFile(file)
  }

  const handleDownloadAll = () => {
    FileExportService.downloadFiles(resultFiles)
  }

  const renderParameterInput = (param: ToolParameter) => {
    switch (param.type) {
      case 'select':
        if (param.name === 'clientName') {
          return (
            <Form.Select
              value={parameters[param.name] || ''}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              disabled={isRunning || loadingClients}
            >
              <option value="">Select a client...</option>
              {clients.map(client => (
                <option key={client.name} value={client.name}>
                  {client.name}
                </option>
              ))}
            </Form.Select>
          )
        }

        if (param.name === 'timePeriod') {
          const options = DateUtils.getTimePeriodOptions()
          return (
            <Form.Select
              value={parameters[param.name] || ''}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              disabled={isRunning}
            >
              <option value="">Select time period...</option>
              {options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Form.Select>
          )
        }

        if (param.name === 'outputFormat') {
          return (
            <Form.Select
              value={parameters[param.name] || ''}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              disabled={isRunning}
            >
              <option value="">Select format...</option>
              <option value="csv">CSV Files</option>
              <option value="json">JSON File</option>
            </Form.Select>
          )
        }

        return (
          <Form.Select
            value={parameters[param.name] || ''}
            onChange={(e) => handleParameterChange(param.name, e.target.value)}
            disabled={isRunning}
          >
            <option value="">Select...</option>
            {param.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Form.Select>
        )

      case 'text':
        return (
          <Form.Control
            type="text"
            value={parameters[param.name] || ''}
            onChange={(e) => handleParameterChange(param.name, e.target.value)}
            placeholder={param.placeholder}
            disabled={isRunning}
          />
        )

      case 'number':
        return (
          <Form.Control
            type="number"
            value={parameters[param.name] || ''}
            onChange={(e) => handleParameterChange(param.name, Number(e.target.value))}
            placeholder={param.placeholder}
            disabled={isRunning}
          />
        )

      case 'boolean':
        return (
          <Form.Check
            type="checkbox"
            checked={parameters[param.name] || false}
            onChange={(e) => handleParameterChange(param.name, e.target.checked)}
            disabled={isRunning}
          />
        )

      default:
        return null
    }
  }

  const isFormValid = () => {
    if (!tool) return false

    return tool.parameters.every(param => {
      if (!param.required) return true
      const value = parameters[param.name]
      return value !== undefined && value !== null && value !== ''
    })
  }

  if (!tool) return null

  return (
    <Modal show={show} onHide={onHide} size="lg" centered backdrop="static">
      <Modal.Header closeButton={!isRunning}>
        <Modal.Title>{tool.name}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <p className="text-muted mb-4">{tool.description}</p>

        {/* Parameters Form */}
        {!execution && (
          <Form>
            <Row>
              {tool.parameters.map((param) => (
                <Col md={param.type === 'boolean' ? 12 : 6} key={param.name} className="mb-3">
                  <Form.Group>
                    <Form.Label>
                      {param.label}
                      {param.required && <span className="text-danger ms-1">*</span>}
                    </Form.Label>
                    {renderParameterInput(param)}
                    {param.description && (
                      <Form.Text className="text-muted">{param.description}</Form.Text>
                    )}
                  </Form.Group>
                </Col>
              ))}
            </Row>
          </Form>
        )}

        {/* Execution Progress */}
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

        {/* Results */}
        {resultFiles.length > 0 && (
          <div>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="mb-0">Generated Files</h6>
              <Button variant="outline-primary" size="sm" onClick={handleDownloadAll}>
                <Download className="me-1" />
                Download All
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
          </div>
        )}

        {/* Loading state */}
        {loadingClients && (
          <Alert variant="info">Loading client configurations...</Alert>
        )}
      </Modal.Body>

      <Modal.Footer>
        <div className="d-flex justify-content-between w-100">
          <div>
            {isRunning && (
              <Button variant="outline-danger" onClick={cancel}>
                <X className="me-1" />
                Cancel
              </Button>
            )}
          </div>

          <div className="d-flex gap-2">
            <Button
              variant="secondary"
              onClick={onHide}
              disabled={isRunning}
            >
              {execution?.status === 'completed' ? 'Close' : 'Cancel'}
            </Button>

            {!execution && (
              <Button
                variant="primary"
                onClick={handleExecute}
                disabled={!isFormValid() || isRunning || loadingClients}
              >
                Run Tool
              </Button>
            )}
          </div>
        </div>
      </Modal.Footer>
    </Modal>
  )
}
