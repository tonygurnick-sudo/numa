import { useEffect, useState, useMemo, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Button,
  Alert,
  Modal,
  Badge,
  Spinner,
  ProgressBar,
  Table,
  Container,
  Row,
  Col,
} from 'react-bootstrap'
import { ArrowLeft, ArrowRight, Upload, CheckCircle, Download, FolderPlus } from 'react-bootstrap-icons'
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector'
import { clientService } from '@/services/clientService'
import { saveDeploymentGroup } from '@/services/deploymentService'
import { clientConfigSchema, type Client } from '@/types'
import { parseClientNamesFromCSV, exportClientNamesToCSV } from '@/utils/csvUtils'

// Bulk-updatable fields configuration
interface FieldConfig {
  key: string
  label: string
  type: 'boolean' | 'enum' | 'string' | 'number' | 'json'
  options?: { label: string; value: string }[]
  description: string
  allowUnset?: boolean
}

const REGION_OPTIONS = [
  { label: 'US East (N. Virginia) us-east-1', value: 'us-east-1' },
  { label: 'Asia Pacific (Sydney) ap-southeast-2', value: 'ap-southeast-2' },
]

const BULK_UPDATABLE_FIELDS: FieldConfig[] = [
  {
    key: 'region',
    label: 'Region',
    type: 'enum',
    options: REGION_OPTIONS,
    description: 'AWS region for deployment',
  },
  {
    key: 'brandingProviderEnabled',
    label: 'Branding Provider',
    type: 'boolean',
    description: 'Enable custom branding UI and runtime asset loading',
  },
  {
    key: 'agents',
    label: 'Agents',
    type: 'boolean',
    description: 'Enable Agents UI and related functionality',
  },
  {
    key: 'pipedreamIntegrations',
    label: 'Pipedream Integrations',
    type: 'boolean',
    description: 'Enable external API integrations',
  },
  {
    key: 'dataConnectorsEnabled',
    label: 'Data Connectors',
    type: 'boolean',
    description: 'Show data connectors in the frontend',
  },
  {
    key: 'numaWorkspaceChat',
    label: 'Numa Workspace Chat',
    type: 'boolean',
    description: 'Enable Numa Workspace Chat (V2). On by default.',
  },
  {
    key: 'scheduling',
    label: 'Agent Scheduling',
    type: 'boolean',
    description: 'Enable agent scheduling and notifications features',
  },
  {
    key: 'workspaceChatModelSelection',
    label: 'Workspace Chat Model Selection',
    type: 'boolean',
    description: 'Allow users to select AI models in Chat V2',
  },
  {
    key: 'allowBedrockQuotaSharing',
    label: 'Allow Bedrock Quota Sharing',
    type: 'boolean',
    description: 'Allow OTHER accounts to use THIS account\'s Bedrock quotas',
  },
  {
    key: 'allApps',
    label: 'All Apps',
    type: 'boolean',
    description: 'Deploy all apps automatically',
  },
  {
    key: 'allProdApps',
    label: 'All Production Apps',
    type: 'boolean',
    description: 'Enable all production applications',
  },
  {
    key: 'apps',
    label: 'Apps Configuration',
    type: 'json',
    description: 'JSON object mapping app IDs to config (e.g. {"meeting-analyser": {}})',
  },
  {
    key: 'devInstance',
    label: 'Development Instance',
    type: 'boolean',
    description: 'Mark as development/demo environment',
  },
  {
    key: 'customDomain',
    label: 'Custom Domain',
    type: 'string',
    allowUnset: true,
    description: 'Custom domain name (leave empty for auto-generated domain)',
  },
  {
    key: 'bedrockAccount',
    label: 'Bedrock Account',
    type: 'string',
    allowUnset: true,
    description: 'Optional Bedrock account ID (unset to remove override)',
  },
  {
    key: 'preferredKnowledgeBase',
    label: 'Preferred Knowledge Base',
    type: 'enum',
    options: [
      { label: 'Bedrock', value: 'bedrock' },
      { label: 'Q Business', value: 'q' },
    ],
    description: 'Select knowledge base service to use by default',
  },
  {
    key: 'provisionQResources',
    label: 'Provision Q Resources',
    type: 'boolean',
    description: 'Provision Q Business resources in this account',
  },
  {
    key: 'mfa',
    label: 'Multi-Factor Authentication (MFA)',
    type: 'boolean',
    description: 'Require TOTP-based two-factor authentication for all users',
  },
  {
    key: 'groups',
    label: 'Groups (Advanced)',
    type: 'json',
    allowUnset: true,
    description: 'JSON override for feature groups (e.g. {"standard":["chat"],"admin":["chat","manageUsers"]})',
  },
]

interface PreviewRow {
  clientName: string
  currentValue: unknown
  newValue: unknown
  willChange: boolean
}

interface UpdateResult {
  clientName: string
  success: boolean
  error?: string
  skipped?: boolean
}

export default function BulkUpdateClientConfig() {
  const navigate = useNavigate()

  // Client data
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Selection state
  const [selectedClientNames, setSelectedClientNames] = useState<string[]>([])

  // Field selection
  const [selectedField, setSelectedField] = useState<string>('')
  const [booleanDraft, setBooleanDraft] = useState(false)
  const [enumDraft, setEnumDraft] = useState('')
  const [textDraft, setTextDraft] = useState('')
  const [unsetField, setUnsetField] = useState(false)
  const [valueError, setValueError] = useState<string | null>(null)

  // Preview modal
  const [showPreview, setShowPreview] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewRow[]>([])
  const [previewAccepted, setPreviewAccepted] = useState(false)
  const [previewSelectedClient, setPreviewSelectedClient] = useState<string>('')

  // Execution state
  const [executing, setExecuting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<UpdateResult[] | null>(null)

  // CSV import state
  const [csvImportMessage, setCsvImportMessage] = useState<string | null>(null)

  // Save as deployment group modal state
  const [showSaveGroupModal, setShowSaveGroupModal] = useState(false)
  const [saveGroupName, setSaveGroupName] = useState('')
  const [saveGroupDescription, setSaveGroupDescription] = useState('')
  const [saveGroupError, setSaveGroupError] = useState('')
  const [saveGroupBusy, setSaveGroupBusy] = useState(false)

  // Load clients on mount
  useEffect(() => {
    loadClients()
  }, [])

  // Reset value when field changes
  useEffect(() => {
    const fieldConfig = BULK_UPDATABLE_FIELDS.find(f => f.key === selectedField)
    if (fieldConfig) {
      setUnsetField(false)
      setValueError(null)
      if (fieldConfig.type === 'boolean') {
        setBooleanDraft(false)
      } else if (fieldConfig.type === 'enum' && fieldConfig.options) {
        setEnumDraft(fieldConfig.options[0].value)
        setTextDraft('')
      } else {
        setTextDraft('')
        setEnumDraft('')
      }
    }
  }, [selectedField])

  // If inputs change after preview, require a fresh preview acceptance
  useEffect(() => {
    setPreviewAccepted(false)
  }, [selectedClientNames, selectedField, booleanDraft, enumDraft, textDraft, unsetField])

  const loadClients = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await clientService.getAllClients()
      setClients(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clients')
    } finally {
      setLoading(false)
    }
  }

  const handleClientToggle = (clientName: string) => {
    setSelectedClientNames(prev =>
      prev.includes(clientName)
        ? prev.filter(n => n !== clientName)
        : [...prev, clientName]
    )
  }

  const handleSelectClients = (clientNames: string[]) => {
    setSelectedClientNames(clientNames)
  }

  const handleCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setCsvImportMessage(null)
    try {
      const text = await file.text()
      const parsedNames = parseClientNamesFromCSV(text)

      if (parsedNames.length === 0) {
        setCsvImportMessage('No client names found in CSV. Ensure the file has a "Client Name" column.')
        return
      }

      // Match against loaded clients
      const validClientNames = clients.map(c => c.name)
      const matchedNames = parsedNames.filter(name => validClientNames.includes(name))
      const unmatchedCount = parsedNames.length - matchedNames.length

      // Add to selection (union with existing)
      const newSelection = [...new Set([...selectedClientNames, ...matchedNames])]
      setSelectedClientNames(newSelection)

      if (unmatchedCount > 0) {
        setCsvImportMessage(`Imported ${matchedNames.length} clients. ${unmatchedCount} names in CSV did not match any known client.`)
      } else {
        setCsvImportMessage(`Imported ${matchedNames.length} clients from CSV.`)
      }
    } catch {
      setCsvImportMessage('Failed to parse CSV file.')
    }

    // Reset file input
    e.target.value = ''
  }

  const selectedFieldConfig = useMemo(
    () => BULK_UPDATABLE_FIELDS.find(f => f.key === selectedField),
    [selectedField]
  )

  const canPreview = selectedClientNames.length > 0 && selectedField !== ''

  const validateGroupsValue = (value: unknown): string | null => {
    if (value === undefined) return null
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Groups must be a JSON object'
    const obj = value as Record<string, unknown>
    const admin = obj.admin
    const standard = obj.standard
    const isStringArray = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string')
    if (admin !== undefined && !isStringArray(admin)) return '"admin" must be an array of strings'
    if (standard !== undefined && !isStringArray(standard)) return '"standard" must be an array of strings'
    return null
  }

  const parseAndValidateNewValue = (): { ok: true; value: unknown } | { ok: false; error: string } => {
    if (!selectedFieldConfig) return { ok: false, error: 'Select a field to update' }

    if (selectedFieldConfig.allowUnset && unsetField) {
      return { ok: true, value: undefined }
    }

    let value: unknown
    if (selectedFieldConfig.type === 'boolean') {
      value = booleanDraft
    } else if (selectedFieldConfig.type === 'enum') {
      value = enumDraft
    } else if (selectedFieldConfig.type === 'string') {
      value = textDraft
    } else if (selectedFieldConfig.type === 'number') {
      if (textDraft.trim() === '') return { ok: false, error: 'Enter a number' }
      const num = Number(textDraft)
      if (!Number.isFinite(num)) return { ok: false, error: 'Invalid number' }
      value = num
    } else if (selectedFieldConfig.type === 'json') {
      if (textDraft.trim() === '') return { ok: false, error: 'Enter valid JSON' }
      try {
        value = JSON.parse(textDraft)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' }
      }
    } else {
      return { ok: false, error: 'Unsupported field type' }
    }

    // Validate values where possible (mirror Update Client Config strictness where available)
    if (selectedFieldConfig.key === 'groups') {
      const groupsError = validateGroupsValue(value)
      if (groupsError) return { ok: false, error: groupsError }
      return { ok: true, value }
    }

    try {
      clientConfigSchema.partial().pick({ [selectedFieldConfig.key]: true } as any).parse({ [selectedFieldConfig.key]: value } as any)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Value failed validation' }
    }

    return { ok: true, value }
  }

  const areValuesEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (a === undefined || b === undefined) return false
    if (a === null || b === null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }

  const handlePreview = () => {
    if (!canPreview || !selectedFieldConfig) return

    const parsed = parseAndValidateNewValue()
    if (!parsed.ok) {
      setValueError(parsed.error)
      return
    }
    setValueError(null)

    const nextValue = parsed.value
    const preview: PreviewRow[] = selectedClientNames.map(clientName => {
      const client = clients.find(c => c.name === clientName)
      const currentValue = (client?.config as any)?.[selectedFieldConfig.key]
      return {
        clientName,
        currentValue,
        newValue: nextValue,
        willChange: !areValuesEqual(currentValue, nextValue),
      }
    })

    setPreviewData(preview)
    setPreviewAccepted(false)
    setPreviewSelectedClient(preview[0]?.clientName || '')
    setShowPreview(true)
  }

  const handleExecute = async () => {
    if (!selectedFieldConfig || previewData.length === 0 || !previewAccepted) return

    setExecuting(true)
    setProgress(0)
    setResults(null)

    const updateResults: UpdateResult[] = []

    for (let i = 0; i < previewData.length; i++) {
      const { clientName, willChange, newValue } = previewData[i]

      if (!willChange) {
        // Skip clients that don't need updating
        updateResults.push({ clientName, success: true, skipped: true })
      } else {
        try {
          await clientService.updateClientConfig(clientName, { [selectedFieldConfig.key]: newValue } as any)
          updateResults.push({ clientName, success: true })
        } catch (err) {
          updateResults.push({
            clientName,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }

      setProgress(Math.round(((i + 1) / previewData.length) * 100))
    }

    setResults(updateResults)
    setExecuting(false)
    setShowPreview(false)

    // Refresh client list to show updated values
    await loadClients()
  }

  // Export clients that will change to CSV
  const handleExportChangedClients = () => {
    const changedClients = previewData.filter(row => row.willChange).map(r => r.clientName)
    if (changedClients.length === 0) return
    exportClientNamesToCSV(changedClients, `changed-clients-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  // Open save as deployment group modal
  const handleOpenSaveGroupModal = () => {
    setSaveGroupName('')
    setSaveGroupDescription('')
    setSaveGroupError('')
    setShowSaveGroupModal(true)
  }

  // Save changed clients as a deployment group
  const handleSaveAsDeploymentGroup = async () => {
    const changedClients = previewData.filter(row => row.willChange).map(r => r.clientName)
    if (changedClients.length === 0) return

    if (!saveGroupName.trim()) {
      setSaveGroupError('Group name is required.')
      return
    }

    setSaveGroupBusy(true)
    setSaveGroupError('')

    try {
      await saveDeploymentGroup({
        groupName: saveGroupName.trim(),
        clients: changedClients,
        description: saveGroupDescription.trim() || undefined,
      })
      setShowSaveGroupModal(false)
      // Show success via results or alert
      alert(`Deployment group "${saveGroupName}" created with ${changedClients.length} clients.`)
    } catch (err) {
      setSaveGroupError(err instanceof Error ? err.message : 'Failed to save deployment group.')
    } finally {
      setSaveGroupBusy(false)
    }
  }

  const successCount = results?.filter(r => r.success).length ?? 0
  const failureCount = results?.filter(r => !r.success).length ?? 0
  const changedCount = previewData.filter(p => p.willChange).length
  const previewNewValue = previewData.length > 0 ? previewData[0].newValue : undefined
  const previewSelectedClientConfig = clients.find(c => c.name === previewSelectedClient)?.config
  const previewClientIndex = previewData.findIndex(p => p.clientName === previewSelectedClient)

  const goToAdjacentPreviewClient = (direction: 'prev' | 'next') => {
    if (previewData.length === 0) return
    const currentIndex = previewClientIndex >= 0 ? previewClientIndex : 0
    const nextIndex = direction === 'prev'
      ? (currentIndex - 1 + previewData.length) % previewData.length
      : (currentIndex + 1) % previewData.length
    setPreviewSelectedClient(previewData[nextIndex].clientName)
  }

  const buildUpdatedConfigForPreview = (config: unknown, key: string, value: unknown): unknown => {
    if (!key) return config
    if (!config || typeof config !== 'object') return config
    let next: any
    try {
      next = JSON.parse(JSON.stringify(config))
    } catch {
      next = { ...(config as any) }
    }
    if (value === undefined) {
      delete next[key]
      return next
    }
    next[key] = value
    return next
  }

  const formatJson = (value: unknown): string => {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  const formatValue = (value: unknown): string => {
    if (value === undefined) return '(not set)'
    if (value === null) return '(null)'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'object') {
      try {
        const s = JSON.stringify(value)
        return s.length > 160 ? `${s.slice(0, 157)}...` : s
      } catch {
        return '(object)'
      }
    }
    return String(value)
  }

  return (
    <Container fluid>
      {/* Header */}
      <div className="d-flex align-items-center mb-4">
        <Button
          variant="secondary"
          onClick={() => navigate('/tools')}
          className="me-3"
        >
          <ArrowLeft className="me-1" />
          Back to Tools
        </Button>
        <div>
          <h2 className="mb-0">Bulk Update Client Config</h2>
          <p className="text-muted mb-0">
            Update a single configuration field across multiple clients at once
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Results Summary (shown after execution) */}
      {results && (
        <Alert
          variant={failureCount === 0 ? 'success' : 'warning'}
          dismissible
          onClose={() => setResults(null)}
        >
          <Alert.Heading>
            {failureCount === 0 ? 'All updates completed successfully!' : 'Updates completed with some failures'}
          </Alert.Heading>
          <p className="mb-2">
            <strong>{successCount}</strong> succeeded, <strong>{failureCount}</strong> failed
          </p>
          {failureCount > 0 && (
            <div>
              <strong>Failed clients:</strong>
              <ul className="mb-0">
                {results.filter(r => !r.success).map(r => (
                  <li key={r.clientName}>
                    {r.clientName}: {r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Alert>
      )}

      <div className="row">
        {/* Left Column: Client Selection */}
        <div className="col-lg-6 mb-4">
          <Card className="border-0 shadow-sm h-100">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">1. Select Clients</h5>
            </Card.Header>
            <Card.Body>
              {/* CSV Import */}
              <div className="mb-3">
                <Form.Label className="fw-semibold">Import from CSV</Form.Label>
                <div className="d-flex align-items-center gap-2">
                  <Form.Control
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                    disabled={loading}
                    size="sm"
                  />
                  <Upload className="text-muted" />
                </div>
                <Form.Text className="text-muted">
                  Upload a CSV from Config Search to auto-select clients by name
                </Form.Text>
                {csvImportMessage && (
                  <Alert variant="info" className="mt-2 mb-0 py-2">
                    {csvImportMessage}
                  </Alert>
                )}
              </div>

              <hr />

              {/* Manual Selection */}
              <Form.Label className="fw-semibold">Or select manually</Form.Label>
              {loading ? (
                <div className="text-center py-4">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Loading clients...
                </div>
              ) : (
                <GroupedClientSelector
                  clients={clients}
                  selectedClientNames={selectedClientNames}
                  onClientToggle={handleClientToggle}
                  onSelectClients={handleSelectClients}
                  disabled={loading}
                />
              )}

              {/* Selection Summary */}
              <div className="mt-3 pt-3 border-top">
                <Badge bg={selectedClientNames.length > 0 ? 'primary' : 'secondary'} className="fs-6">
                  {selectedClientNames.length} client{selectedClientNames.length !== 1 ? 's' : ''} selected
                </Badge>
              </div>
            </Card.Body>
          </Card>
        </div>

        {/* Right Column: Field Selection & Action */}
        <div className="col-lg-6 mb-4">
          <Card className="border-0 shadow-sm h-100">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">2. Configure Update</h5>
            </Card.Header>
            <Card.Body>
              {/* Field Selection */}
              <Form.Group className="mb-4">
                <Form.Label className="fw-semibold">Field to Update</Form.Label>
                <Form.Select
                  value={selectedField}
                  onChange={e => setSelectedField(e.target.value)}
                  disabled={loading}
                >
                  <option value="">-- Select a field --</option>
                  {BULK_UPDATABLE_FIELDS.map(field => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </Form.Select>
                {selectedFieldConfig && (
                  <Form.Text className="text-muted">
                    {selectedFieldConfig.description}
                  </Form.Text>
                )}
              </Form.Group>

              {/* Value Input */}
              {selectedFieldConfig && (
                <Form.Group className="mb-4">
                  <Form.Label className="fw-semibold">New Value</Form.Label>
                  {selectedFieldConfig.allowUnset && (
                    <Form.Check
                      className="mb-2"
                      type="checkbox"
                      id="unset-field"
                      checked={unsetField}
                      onChange={e => {
                        setUnsetField(e.target.checked)
                        setValueError(null)
                      }}
                      label="Unset (remove this field from the config)"
                    />
                  )}
                  {selectedFieldConfig.type === 'boolean' ? (
                    <Form.Check
                      type="switch"
                      id="value-switch"
                      label={booleanDraft ? 'Enabled (true)' : 'Disabled (false)'}
                      checked={booleanDraft === true}
                      onChange={e => {
                        setBooleanDraft(e.target.checked)
                        setValueError(null)
                      }}
                      disabled={unsetField}
                    />
                  ) : selectedFieldConfig.type === 'enum' && selectedFieldConfig.options ? (
                    <Form.Select
                      value={enumDraft}
                      onChange={e => {
                        setEnumDraft(e.target.value)
                        setValueError(null)
                      }}
                      disabled={unsetField}
                    >
                      {selectedFieldConfig.options.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Form.Select>
                  ) : selectedFieldConfig.type === 'string' ? (
                    <Form.Control
                      type="text"
                      value={textDraft}
                      onChange={e => {
                        setTextDraft(e.target.value)
                        setValueError(null)
                      }}
                      disabled={unsetField}
                      placeholder="Enter a value"
                    />
                  ) : selectedFieldConfig.type === 'number' ? (
                    <Form.Control
                      type="number"
                      value={textDraft}
                      onChange={e => {
                        setTextDraft(e.target.value)
                        setValueError(null)
                      }}
                      disabled={unsetField}
                      placeholder="Enter a number"
                    />
                  ) : selectedFieldConfig.type === 'json' ? (
                    <Form.Control
                      as="textarea"
                      rows={6}
                      value={textDraft}
                      onChange={e => {
                        setTextDraft(e.target.value)
                        setValueError(null)
                      }}
                      disabled={unsetField}
                      placeholder='Enter JSON, e.g. {"key":"value"}'
                      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
                    />
                  ) : null}
                  {valueError && (
                    <Alert variant="danger" className="mt-2 mb-0">
                      {valueError}
                    </Alert>
                  )}
                </Form.Group>
              )}

              {/* Preview Button */}
              <div className="d-grid">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handlePreview}
                  disabled={!canPreview || loading}
                >
                  Preview Changes
                </Button>
              </div>

              {!canPreview && (
                <Form.Text className="text-muted d-block text-center mt-2">
                  Select at least one client and a field to update
                </Form.Text>
              )}
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal
        show={showPreview}
        onHide={() => !executing && setShowPreview(false)}
        size="lg"
        centered
        backdrop={executing ? 'static' : true}
      >
        <Modal.Header closeButton={!executing}>
          <Modal.Title>
            {executing ? 'Applying Updates...' : 'Preview Changes'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {executing ? (
            <div className="py-4">
              <ProgressBar
                now={progress}
                label={`${progress}%`}
                animated
                striped
              />
              <p className="text-center text-muted mt-3">
                Updating clients... Please wait.
              </p>
            </div>
          ) : (
            <>
              <Alert variant="info" className="mb-3">
                <strong>Field:</strong> {selectedFieldConfig?.label}<br />
                <strong>New Value:</strong> {formatValue(previewNewValue)}<br />
                <strong>Clients to update:</strong> {changedCount} of {previewData.length} will be changed
              </Alert>

              <Row className="g-3 mb-3">
                <Col md={12}>
                  <Form.Label className="fw-semibold">Preview client config</Form.Label>
                  <div className="d-flex gap-2 align-items-center">
                    <Button
                      variant="outline-secondary"
                      onClick={() => goToAdjacentPreviewClient('prev')}
                      disabled={previewData.length <= 1}
                      aria-label="Previous client"
                    >
                      <ArrowLeft />
                    </Button>
                    <Form.Select
                      value={previewSelectedClient}
                      onChange={e => setPreviewSelectedClient(e.target.value)}
                      aria-label="Select client to preview"
                    >
                      {previewData.map(row => (
                        <option key={row.clientName} value={row.clientName}>
                          {row.clientName}
                        </option>
                      ))}
                    </Form.Select>
                    <Button
                      variant="outline-secondary"
                      onClick={() => goToAdjacentPreviewClient('next')}
                      disabled={previewData.length <= 1}
                      aria-label="Next client"
                    >
                      <ArrowRight />
                    </Button>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="text-muted small mb-1">Current</div>
                  <pre className="bg-light p-2 rounded border" style={{ maxHeight: '38vh', overflow: 'auto' }}>
                    {formatJson(previewSelectedClientConfig)}
                  </pre>
                </Col>
                <Col md={6}>
                  <div className="text-muted small mb-1">Updated</div>
                  <pre className="bg-light p-2 rounded border" style={{ maxHeight: '38vh', overflow: 'auto' }}>
                    {formatJson(buildUpdatedConfigForPreview(previewSelectedClientConfig, selectedFieldConfig?.key || '', previewData.find(r => r.clientName === previewSelectedClient)?.newValue))}
                  </pre>
                </Col>
              </Row>

              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <Table striped bordered hover size="sm">
                  <thead className="sticky-top bg-white">
                    <tr>
                      <th>Client Name</th>
                      <th>Current Value</th>
                      <th>New Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map(row => (
                      <tr key={row.clientName}>
                        <td>{row.clientName}</td>
                        <td>
                          <code>{formatValue(row.currentValue)}</code>
                        </td>
                        <td>
                          <code>{formatValue(row.newValue)}</code>
                        </td>
                        <td>
                          {row.willChange ? (
                            <Badge bg="warning" text="dark">Will Change</Badge>
                          ) : (
                            <Badge bg="secondary">No Change</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <Form.Check
                className="mt-3"
                type="checkbox"
                id="bulk-update-accept-preview"
                checked={previewAccepted}
                onChange={e => setPreviewAccepted(e.target.checked)}
                label="I have reviewed this preview and want to proceed."
              />
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          {!executing && (
            <>
              <Button variant="secondary" onClick={() => setShowPreview(false)}>
                Cancel
              </Button>
              <Button
                variant="outline-secondary"
                onClick={handleExportChangedClients}
                disabled={changedCount === 0}
              >
                <Download className="me-1" />
                Export Changed
              </Button>
              <Button
                variant="outline-secondary"
                onClick={handleOpenSaveGroupModal}
                disabled={changedCount === 0}
              >
                <FolderPlus className="me-1" />
                Save as Group
              </Button>
              <Button
                variant="primary"
                onClick={handleExecute}
                disabled={changedCount === 0 || !previewAccepted}
              >
                <CheckCircle className="me-1" />
                Apply Changes ({changedCount} client{changedCount !== 1 ? 's' : ''})
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>

      {/* Save as Deployment Group Modal */}
      <Modal show={showSaveGroupModal} onHide={() => !saveGroupBusy && setShowSaveGroupModal(false)} centered>
        <Modal.Header closeButton={!saveGroupBusy}>
          <Modal.Title>Save as Deployment Group</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {saveGroupError && <Alert variant="danger">{saveGroupError}</Alert>}
          <p className="text-muted mb-3">
            Create a new deployment group with the {changedCount} client{changedCount !== 1 ? 's' : ''} that will be changed.
          </p>
          <Form.Group className="mb-3">
            <Form.Label>Group Name</Form.Label>
            <Form.Control
              type="text"
              value={saveGroupName}
              onChange={e => setSaveGroupName(e.target.value)}
              placeholder="e.g. Bulk Update - Region Change"
              disabled={saveGroupBusy}
            />
            <Form.Text>Group names must be unique.</Form.Text>
          </Form.Group>
          <Form.Group>
            <Form.Label>Description (optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={saveGroupDescription}
              onChange={e => setSaveGroupDescription(e.target.value)}
              placeholder="Optional notes about this group"
              disabled={saveGroupBusy}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSaveGroupModal(false)} disabled={saveGroupBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveAsDeploymentGroup} disabled={saveGroupBusy || !saveGroupName.trim()}>
            {saveGroupBusy ? <Spinner size="sm" className="me-2" /> : null}
            Create Group
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  )
}
