import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Collapse, Dropdown, Form, InputGroup, Modal, Row, Spinner } from 'react-bootstrap'
import { Search, FileEarmarkText, Download, Funnel, XCircle } from 'react-bootstrap-icons'
import { useNavigate } from 'react-router-dom'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { Client, getDefaultClientConfigValues, CLIENT_STATUS_VALUES, CLIENT_STATUS_DISPLAY } from '@/types'
import type { ClientMetadata } from '@/types'
import { clientService } from '@/services/clientService'
import { clientMetadataService } from '@/services/clientMetadataService'
import { ClientTableGroup } from '@/components/ClientTableGroup'
import { FileExportService } from '@/utils/fileExport'
import { listAllRecentDeployments } from '@/services/deploymentService'

export default function Configs() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Client | null>(null)
  const [metadataMap, setMetadataMap] = useState<Map<string, ClientMetadata>>(new Map())
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv')
  const [showFilters, setShowFilters] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [trialStartFrom, setTrialStartFrom] = useState('')
  const [trialStartTo, setTrialStartTo] = useState('')
  const [trialEndFrom, setTrialEndFrom] = useState('')
  const [trialEndTo, setTrialEndTo] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [data, metadata] = await Promise.all([
          clientService.getAllClients(),
          clientMetadataService.getAllMetadata(),
        ])
        setClients(data)
        setMetadataMap(metadata)
        if (data.length > 0) setSelected(data[0])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (statusFilter) count++
    if (trialStartFrom || trialStartTo) count++
    if (trialEndFrom || trialEndTo) count++
    return count
  }, [statusFilter, trialStartFrom, trialStartTo, trialEndFrom, trialEndTo])

  const clearFilters = () => {
    setStatusFilter('')
    setTrialStartFrom('')
    setTrialStartTo('')
    setTrialEndFrom('')
    setTrialEndTo('')
  }

  const filtered = useMemo(() => {
    let result = clients

    // Text search (existing)
    const term = search.toLowerCase().trim()
    if (term) {
      result = result.filter(c => c.name.toLowerCase().includes(term))
    }

    // Status filter
    if (statusFilter) {
      result = result.filter(c => {
        const meta = metadataMap.get(c.name)
        if (!meta) return false
        if (statusFilter === 'expired') {
          return meta.status === 'trial' && meta.trialEndDate && new Date(meta.trialEndDate) < new Date()
        }
        return meta.status === statusFilter
      })
    }

    // Trial start date range
    if (trialStartFrom) {
      result = result.filter(c => {
        const meta = metadataMap.get(c.name)
        return meta?.trialStartDate && meta.trialStartDate >= trialStartFrom
      })
    }
    if (trialStartTo) {
      result = result.filter(c => {
        const meta = metadataMap.get(c.name)
        return meta?.trialStartDate && meta.trialStartDate <= trialStartTo
      })
    }

    // Trial end date range
    if (trialEndFrom) {
      result = result.filter(c => {
        const meta = metadataMap.get(c.name)
        return meta?.trialEndDate && meta.trialEndDate >= trialEndFrom
      })
    }
    if (trialEndTo) {
      result = result.filter(c => {
        const meta = metadataMap.get(c.name)
        return meta?.trialEndDate && meta.trialEndDate <= trialEndTo
      })
    }

    return result
  }, [search, clients, statusFilter, trialStartFrom, trialStartTo, trialEndFrom, trialEndTo, metadataMap])

  // Helper function to merge config with defaults
  const mergeConfigWithDefaults = (config: any): any => {
    const defaults = getDefaultClientConfigValues()
    return {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(config).filter(([_, v]) => v !== undefined && v !== null && v !== '')
      )
    }
  }

  // Unified export function
  const performExport = async (format: 'csv' | 'json', withDefaults: boolean) => {
    try {
      // Fetch deployment data
      const deployments = await listAllRecentDeployments(1000).catch(() => [])

      // Group deployments by client
      const deploymentsByClient = new Map()
      deployments.forEach(deploy => {
        if (!deploy.clientName) return
        const list = deploymentsByClient.get(deploy.clientName) || []
        list.push(deploy)
        deploymentsByClient.set(deploy.clientName, list)
      })

      // Enrich clients with deployment data and optionally merge with defaults
      const enrichedClients = filtered.map(client => {
        const clientDeployments = deploymentsByClient.get(client.name) || []
        const lastDeploy = clientDeployments[0] // Already sorted by most recent

        const config = withDefaults ? mergeConfigWithDefaults(client.config) : client.config

        return {
          ...client,
          config,
          lastDeployment: lastDeploy ? {
            timestamp: lastDeploy.startedAt || lastDeploy.startTime || '',
            imageTag: lastDeploy.imageTag || '',
            status: (lastDeploy.status === 'success' || lastDeploy.status === 'failed' || lastDeploy.status === 'running')
              ? lastDeploy.status
              : 'running',
            deploymentId: lastDeploy.deploymentId
          } : client.lastDeployment,
          deploymentCount: clientDeployments.length
        }
      })

      if (format === 'csv') {
        // Prepare CSV data
        const exportData = enrichedClients.map(client => {
          const clientMetadata = metadataMap.get(client.name)
          return {
      name: client.name,
      status: client.status,
      metadataStatus: clientMetadata?.status || '',
      trialStartDate: clientMetadata?.trialStartDate || '',
      trialEndDate: clientMetadata?.trialEndDate || '',
      metadataNotes: clientMetadata?.notes || '',
      deploymentCount: client.deploymentCount,
      clientAccountId: client.config.clientAccountId,
      region: client.config.region,
      devInstance: client.config.devInstance,
      customDomain: client.config.customDomain,
      qBusinessRegion: client.config.qBusinessRegion,
      provisionQResources: client.config.provisionQResources,
      allApps: client.config.allApps,
      allProdApps: client.config.allProdApps,
      apps: JSON.stringify(client.config.apps || {}),
      preferredKnowledgeBase: client.config.preferredKnowledgeBase,
      embeddingModel: client.config.embeddingModel,
      bedrockParserModel: client.config.bedrockParserModel,
      visionModelType: client.config.visionModelType,
      senderEmail: client.config.senderEmail,
      receiverEmails: JSON.stringify(client.config.receiverEmails || []),
      bedrockAccount: client.config.bedrockAccount,
      numaChatAgents: client.config.numaChatAgents,
      allowBedrockQuotaSharing: client.config.allowBedrockQuotaSharing,
      pipedreamIntegrations: client.config.pipedreamIntegrations,
      agents: client.config.agents,
      brandingProviderEnabled: client.config.brandingProviderEnabled,
      webCrawlerConfigs: JSON.stringify(client.config.webCrawlerConfigs || []),
      sharePointConfigs: JSON.stringify(client.config.sharePointConfigs || []),
      boxConfigs: JSON.stringify(client.config.boxConfigs || []),
      teamsConfigs: JSON.stringify(client.config.teamsConfigs || []),
      s3Configs: JSON.stringify(client.config.s3Configs || []),
      budget: JSON.stringify(client.config.budget || null),
    }})

        // Define columns for CSV export
        const columns = exportData.length > 0 ? Object.keys(exportData[0]) as (keyof typeof exportData[0])[] : []
        const csv = FileExportService.arrayToCSV(exportData, columns)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
        const suffix = withDefaults ? '-with-defaults' : '-raw'
        const filename = `client-configs${suffix}-${timestamp}.csv`

        FileExportService.downloadFile({
          name: filename,
          content: csv,
          mimeType: 'text/csv',
          size: new Blob([csv]).size,
        })
      } else {
        // JSON export
        const exportData = enrichedClients.map(client => ({
          name: client.name,
          status: client.status,
          deploymentCount: client.deploymentCount,
          config: client.config,
          metadata: metadataMap.get(client.name) || null,
          lastDeployment: client.lastDeployment,
        }))

        const json = JSON.stringify(exportData, null, 2)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
        const suffix = withDefaults ? '-with-defaults' : '-raw'
        const filename = `client-configs${suffix}-${timestamp}.json`

        FileExportService.downloadFile({
          name: filename,
          content: json,
          mimeType: 'application/json',
          size: new Blob([json]).size,
        })
      }
    } catch (error) {
      console.error('Export failed:', error)
      alert('Export failed. Please try again.')
    }
  }

  // Modal trigger handlers
  const handleExportCSV = () => {
    setExportFormat('csv')
    setShowExportModal(true)
  }

  const handleExportJSON = () => {
    setExportFormat('json')
    setShowExportModal(true)
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="mb-0 d-flex align-items-center">
          <FileEarmarkText className="me-2" />
          Client Configs
        </h2>
        <div className="d-flex align-items-center gap-2">
          <Dropdown>
            <Dropdown.Toggle
              variant="outline-primary"
              size="sm"
              disabled={loading || clients.length === 0}
            >
              <Download className="me-1" />
              Export
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item onClick={handleExportCSV}>
                Export as CSV
              </Dropdown.Item>
              <Dropdown.Item onClick={handleExportJSON}>
                Export as JSON
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
          <Badge bg="secondary">{clients.length}</Badge>
        </div>
      </div>

      <Row>
        <Col xs={12} md={6} className="mb-3">
          <Card className="border shadow-sm">
            <Card.Header>
              <div className="d-flex align-items-center justify-content-between">
                <span className="fw-semibold">Clients</span>
                {loading && <Spinner size="sm" />}
              </div>
            </Card.Header>
            <Card.Body className="p-0">
              <div className="p-3 border-bottom">
                <InputGroup className="mb-2">
                  <InputGroup.Text>
                    <Search />
                  </InputGroup.Text>
                  <Form.Control
                    placeholder="Search clients..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </InputGroup>
                <div className="d-flex align-items-center gap-2">
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
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={clearFilters}
                      title="Clear all filters"
                    >
                      <XCircle size={12} className="me-1" />
                      Clear
                    </Button>
                  )}
                </div>
                <Collapse in={showFilters}>
                  <div className="mt-2 p-2 bg-light rounded border">
                    <Row className="g-2">
                      <Col xs={12}>
                        <Form.Label className="small fw-semibold text-muted mb-1">Status</Form.Label>
                        <Form.Select
                          size="sm"
                          value={statusFilter}
                          onChange={e => setStatusFilter(e.target.value)}
                        >
                          <option value="">All Statuses</option>
                          {CLIENT_STATUS_VALUES.map(s => (
                            <option key={s} value={s}>{CLIENT_STATUS_DISPLAY[s].label}</option>
                          ))}
                          <option value="expired">Trial - Expired</option>
                        </Form.Select>
                      </Col>
                      <Col xs={6}>
                        <Form.Label className="small fw-semibold text-muted mb-1">Trial Start From</Form.Label>
                        <DatePicker
                          selected={trialStartFrom ? new Date(trialStartFrom) : null}
                          onChange={(date: Date | null) => setTrialStartFrom(date ? date.toISOString().split('T')[0] : '')}
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
                          onChange={(date: Date | null) => setTrialStartTo(date ? date.toISOString().split('T')[0] : '')}
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
                          onChange={(date: Date | null) => setTrialEndFrom(date ? date.toISOString().split('T')[0] : '')}
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
                          onChange={(date: Date | null) => setTrialEndTo(date ? date.toISOString().split('T')[0] : '')}
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
              </div>

              {error && (
                <Alert variant="danger" className="m-3 mb-0">
                  {error}
                </Alert>
              )}

              <div style={{ height: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                <ClientTableGroup
                  clients={filtered}
                  selectedClient={selected}
                  onSelectClient={setSelected}
                  onUpdateClient={(client) => navigate(`/tools/update-client-config?clientName=${encodeURIComponent(client.name)}`)}
                  searchTerm={search}
                  metadataMap={metadataMap}
                />
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} md={6}>
          <Card className="border shadow-sm">
            <Card.Header>
              <div className="d-flex align-items-center justify-content-between">
                <span className="fw-semibold">Configuration JSON</span>
                {selected && (
                  <code className="small text-muted">{selected.name}</code>
                )}
              </div>
            </Card.Header>
            <Card.Body>
              {selected ? (
                <div style={{ height: 'calc(100vh - 280px)', overflow: 'auto' }}>
                  <pre className="bg-light p-3 rounded">
{JSON.stringify(selected.config, null, 2)}
                  </pre>
                  {metadataMap.get(selected.name) && (
                    <>
                      <h6 className="text-muted mt-3">Client Metadata</h6>
                      <pre className="bg-light p-3 rounded">
{JSON.stringify(metadataMap.get(selected.name), null, 2)}
                      </pre>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-muted">Select a client to view its configuration.</div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Export Options Modal */}
      <Modal show={showExportModal} onHide={() => setShowExportModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Export Options</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">
            Choose how you want to export the client configurations:
          </p>
          <div className="d-grid gap-2">
            <Button
              variant="outline-primary"
              size="lg"
              onClick={() => {
                setShowExportModal(false)
                performExport(exportFormat, false)
              }}
            >
              <div className="fw-bold">Raw Data</div>
              <div className="small text-muted">Export as-is with actual values only</div>
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                setShowExportModal(false)
                performExport(exportFormat, true)
              }}
            >
              <div className="fw-bold">With Default Values</div>
              <div className="small">Populate missing fields with default values</div>
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  )
}
