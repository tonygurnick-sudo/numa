import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, Form, Button, Row, Col, Alert, Spinner, Modal } from 'react-bootstrap'
import { clientService } from '@/services/clientService'
import { getDefaultClientConfigValues, type ClientConfig, clientConfigSchema } from '@/types'
import { DEFAULT_ADMIN_FEATURES, DEFAULT_STANDARD_FEATURES, featuresListToString, stringToFeatures } from '@/constants/features'
import { FeatureChecklist } from '@/components/FeatureChecklist'
import { ConfigField } from '@/components/ConfigField'
import { validateClientName, sanitizeClientName } from '@/utils/clientValidation'

const REGION_OPTIONS = [
  { label: 'US East (N. Virginia) us-east-1', value: 'us-east-1' },
  { label: 'Asia Pacific (Sydney) ap-southeast-2', value: 'ap-southeast-2' },
]

// All apps from infrastructure appLibrary + devAppLibrary (sorted alphabetically)
// Matches infra/stacks/numa-client-stack.ts appLibrary and devAppLibrary
const ALL_APPS = [
  'beyond-expectations',
  'candidate-screening',
  'company-profile',
  'contract-analysis',
  'council-recourse-consents',
  'costing-calculator',
  'data-analysis',
  'document-summariser',
  'e2e-test',
  'financial-analysis',
  'gdsr-assessment',
  'infringement-review',
  'meeting-analyser',
  'nolia',
  'nzsba-policy-builder',
  'policy-drafter',
  'policy-reviewer',
  'procurement-rfp-assessment',
  'rfp-response-comparison',
  'tor-assessment',
]

// Production apps only (isProdApp: true in infra/stacks/numa-client-stack.ts)
const PROD_APPS = [
  'candidate-screening',
  'company-profile',
  'contract-analysis',
  'document-summariser',
  'financial-analysis',
  'meeting-analyser',
  'policy-drafter',
  'policy-reviewer',
]

export default function CreateClientConfig() {
  const [searchParams] = useSearchParams()
  const defaults = getDefaultClientConfigValues()

  const [clientName, setClientName] = useState('')
  const [clientNameError, setClientNameError] = useState<string | null>(null)
  const [clientAccountId, setClientAccountId] = useState('')
  const [region, setRegion] = useState(defaults.qBusinessRegion)
  const [allProdApps, setAllProdApps] = useState(true)
  const [allApps, setAllApps] = useState<boolean>(false)
  const [selectedApps, setSelectedApps] = useState<string[]>([])
  const [pipedream, setPipedream] = useState(false) // default: false, not in defaults helper
  const [devInstance, setDevInstance] = useState(defaults.devInstance)
  const [customDomain, setCustomDomain] = useState('')
  const [allowQuotaSharing, setAllowQuotaSharing] = useState(defaults.allowBedrockQuotaSharing)
  const [bedrockAccount, setBedrockAccount] = useState('')
  const [provisionQResources, setProvisionQResources] = useState(defaults.provisionQResources)
  const [preferredKnowledgeBase, setPreferredKnowledgeBase] = useState<"q" | "bedrock">(defaults.preferredKnowledgeBase)
  const [agents, setAgents] = useState(defaults.agents)
  const [brandingProviderEnabled, setBrandingProviderEnabled] = useState(defaults.brandingProviderEnabled)
  const [groupAdmin, setGroupAdmin] = useState(featuresListToString(DEFAULT_ADMIN_FEATURES))
  const [groupStandard, setGroupStandard] = useState(featuresListToString(DEFAULT_STANDARD_FEATURES))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [pendingConfig, setPendingConfig] = useState<ClientConfig | null>(null)
  // developer JSON create
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [uploadedConfig, setUploadedConfig] = useState<ClientConfig | null>(null)
  const [showJsonPreview, setShowJsonPreview] = useState(false)

  // Prefill from query params when available
  useEffect(() => {
    const qClient = (searchParams.get('clientName') || '').trim()
    const qAccount = (searchParams.get('accountId') || '').trim()
    if (qClient && !clientName) setClientName(qClient)
    if (qAccount && !clientAccountId) setClientAccountId(qAccount)
    // only run once on mount
  }, [])

  // Validate client name whenever it changes
  useEffect(() => {
    if (clientName.trim().length > 0) {
      const error = validateClientName(clientName)
      setClientNameError(error)
    } else {
      setClientNameError(null)
    }
  }, [clientName])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!clientName || !clientAccountId) {
      setError('Client name and account ID are required')
      return
    }
    // Check for client name validation errors
    if (clientNameError) {
      setError(`Invalid client name: ${clientNameError}`)
      return
    }

    // Build minimal config: include only required and non-default options
    const minimal: Record<string, unknown> = {
      clientAccountId,
      region,
    }

    if (devInstance !== defaults.devInstance) minimal['devInstance'] = devInstance
    if (customDomain && customDomain.trim()) minimal['customDomain'] = customDomain.trim()
    if (allowQuotaSharing !== defaults.allowBedrockQuotaSharing) minimal['allowBedrockQuotaSharing'] = allowQuotaSharing
    if (bedrockAccount && bedrockAccount.trim()) minimal['bedrockAccount'] = bedrockAccount.trim()
    if (allApps) {
      minimal['allApps'] = true
    } else if (allProdApps !== defaults.allProdApps) {
      minimal['allProdApps'] = allProdApps
    }

    // Include apps array when not using allApps
    if (!allApps) {
      const appsToInclude = allProdApps
        ? selectedApps.filter(a => !PROD_APPS.includes(a))  // Only dev apps when allProdApps is true
        : selectedApps;  // All selected apps when allProdApps is false

      if (appsToInclude.length > 0) {
        minimal['apps'] = Object.fromEntries(appsToInclude.map(a => [a, {}]))
      }
    }
    if (pipedream) minimal['pipedreamIntegrations'] = true
    if (agents) minimal['agents'] = true
    if (brandingProviderEnabled !== defaults.brandingProviderEnabled) minimal['brandingProviderEnabled'] = brandingProviderEnabled

    // Always include these two fields so defaults are written explicitly
    minimal['provisionQResources'] = provisionQResources
    minimal['preferredKnowledgeBase'] = preferredKnowledgeBase

    // groups if provided and advanced mode is enabled
    const admin = stringToFeatures(groupAdmin)
    const standard = stringToFeatures(groupStandard)
    if (showAdvanced && (admin.length || standard.length)) {
      minimal['groups'] = {
        ...(standard.length ? { standard } : {}),
        ...(admin.length ? { admin } : {}),
      }
    }
    setPendingConfig(minimal as ClientConfig)
    setShowPreview(true)
  }

  return (
    <div>
      <Card className="border-0 shadow-sm">
        <Card.Header>
          <h5 className="mb-0">Create Client Config</h5>
          <p className="text-muted small mb-0 mt-2">
            Create a new client configuration. All fields show defaults and are ready to deploy immediately.
            For advanced features like data sources or custom domains, contact a developer.
          </p>
        </Card.Header>
        <Card.Body>
          <Form onSubmit={onSubmit}>
            {/* Required Fields Row */}
            <Row className="mb-4">
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="fw-semibold">
                    Client Name <span className="text-danger">*</span>
                  </Form.Label>
                  <Form.Control
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    placeholder="e.g. arcanum-demo"
                    className={clientNameError ? 'border-danger' : clientName ? 'border-success' : ''}
                    isInvalid={!!clientNameError}
                  />
                  {clientNameError ? (
                    <>
                      <Form.Control.Feedback type="invalid">
                        {clientNameError}
                      </Form.Control.Feedback>
                      {sanitizeClientName(clientName) && sanitizeClientName(clientName) !== clientName && (
                        <Form.Text className="text-info">
                          Suggested: <strong>{sanitizeClientName(clientName)}</strong>
                        </Form.Text>
                      )}
                    </>
                  ) : (
                    <Form.Text className="text-muted">
                      Unique identifier for this client deployment
                    </Form.Text>
                  )}
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="fw-semibold">
                    Account ID <span className="text-danger">*</span>
                  </Form.Label>
                  <Form.Control
                    value={clientAccountId}
                    onChange={e => setClientAccountId(e.target.value)}
                    placeholder="12-digit AWS account ID"
                    className={clientAccountId ? 'border-primary' : ''}
                  />
                  <Form.Text className="text-muted">
                    AWS account where resources will be deployed
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>

            {/* Core Settings Row */}
            <Row className="mb-4">
              <Col md={6}>
                <ConfigField
                  label="Region"
                  value={region}
                  defaultValue={defaults.qBusinessRegion}
                  onChange={setRegion}
                  type="select"
                  options={REGION_OPTIONS}
                  helpText="AWS region for deployment"
                />
              </Col>
              <Col md={6}>
                <ConfigField
                  label="Development Instance"
                  value={devInstance}
                  defaultValue={defaults.devInstance}
                  onChange={(v: boolean) => {
                    setDevInstance(v)
                    if (v && allApps === false) setAllApps(true)
                  }}
                  type="switch"
                  helpText="Mark as development/demo environment"
                />
              </Col>
            </Row>

            {/* Custom Domain Row */}
            <Row className="mb-4">
              <Col md={12}>
                <ConfigField
                  label="Custom Domain"
                  value={customDomain}
                  defaultValue=""
                  onChange={setCustomDomain}
                  type="text"
                  helpText="Custom domain name (e.g., acme.numa.arcanum.ai). Leave empty for auto-generated domain based on client name."
                />
              </Col>
            </Row>

            {/* App Configuration Row */}
            <Row className="mb-4">
              <Col md={6}>
                {devInstance && (
                  <ConfigField
                    label="All Apps (Dev)"
                    value={allApps}
                    defaultValue={true}
                    onChange={setAllApps}
                    type="switch"
                    helpText="Enable all applications when using a development instance"
                  />
                )}
                <ConfigField
                  label="All Production Apps"
                  value={allProdApps}
                  defaultValue={true}
                  onChange={setAllProdApps}
                  type="switch"
                  helpText="Enable all production applications"
                >
                  <Form.Group className="mt-3">
                    <Form.Label className="small">
                      {allProdApps || allApps ? 'Included Apps' : 'Select Specific Apps'}
                    </Form.Label>
                    {allApps && (
                      <Alert variant="info" className="py-2 px-3 mb-2 small">
                        All apps are automatically enabled when 'All Apps (Dev)' is selected
                      </Alert>
                    )}
                    {allProdApps && !allApps && (
                      <Alert variant="info" className="py-2 px-3 mb-2 small">
                        All production apps are automatically enabled when 'All Production Apps' is selected
                      </Alert>
                    )}
                    <div className="d-flex flex-column gap-1">
                      {ALL_APPS.map(a => {
                        const isProdApp = PROD_APPS.includes(a)
                        const isChecked = allApps || (allProdApps && isProdApp) || selectedApps.includes(a)
                        const isDisabled = allApps || (allProdApps && isProdApp)
                        return (
                          <Form.Check
                            key={a}
                            type="checkbox"
                            id={`app-${a}`}
                            label={a}
                            checked={isChecked}
                            disabled={isDisabled}
                            onChange={e => {
                              const checked = e.currentTarget.checked
                              setSelectedApps(prev =>
                                checked
                                  ? Array.from(new Set([...prev, a]))
                                  : prev.filter(x => x !== a)
                              )
                            }}
                          />
                        )
                      })}
                    </div>
                    <Form.Text className="text-muted">
                      {allApps
                        ? 'All applications are included'
                        : allProdApps
                        ? 'All production apps are included (dev apps can be selected individually)'
                        : 'Tick one or more applications'}
                    </Form.Text>
                  </Form.Group>
                </ConfigField>
              </Col>
              <Col md={6}>
                <ConfigField
                  label="Pipedream Integrations"
                  value={pipedream}
                  defaultValue={false}
                  onChange={setPipedream}
                  type="switch"
                  helpText="Enable external API integrations"
                />
                <ConfigField
                  label="Agents"
                  value={agents}
                  defaultValue={defaults.agents}
                  onChange={setAgents}
                  type="switch"
                  helpText="Enable Agents UI and related functionality"
                />
                <ConfigField
                  label="Allow Bedrock Quota Sharing"
                  value={allowQuotaSharing}
                  defaultValue={defaults.allowBedrockQuotaSharing}
                  onChange={setAllowQuotaSharing}
                  type="switch"
                  helpText="When enabled, OTHER Numa accounts can use THIS account's Bedrock quotas"
                />
                <ConfigField
                  label="Bedrock Account"
                  value={bedrockAccount}
                  defaultValue=""
                  onChange={setBedrockAccount}
                  type="text"
                  helpText="AWS account ID that THIS account will use for Bedrock quotas (instead of its own). Leave empty to use this account's own quota."
                />
                <ConfigField
                  label="Branding Provider"
                  value={brandingProviderEnabled}
                  defaultValue={defaults.brandingProviderEnabled}
                  onChange={setBrandingProviderEnabled}
                  type="switch"
                  helpText="Enable custom branding UI and runtime asset loading"
                />
                <ConfigField
                  label="Provision Q Resources"
                  value={provisionQResources}
                  defaultValue={defaults.provisionQResources}
                  onChange={setProvisionQResources}
                  type="switch"
                  helpText="Provision Q Business resources in this account"
                />
                <ConfigField
                  label="Preferred Knowledge Base"
                  value={preferredKnowledgeBase}
                  defaultValue={defaults.preferredKnowledgeBase}
                  onChange={(v: any) => setPreferredKnowledgeBase(v as 'q' | 'bedrock')}
                  type="select"
                  options={[
                    { label: 'Bedrock', value: 'bedrock' },
                    { label: 'Q Business', value: 'q' },
                  ]}
                  helpText="Select knowledge base service to use by default"
                />
              </Col>
            </Row>

            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            {/* Actions */}
            <div className="d-flex align-items-center gap-3 mb-4">
              <Button
                type="submit"
                disabled={submitting || !!clientNameError}
                className="px-4"
              >
                {submitting ? (
                  <>
                    <Spinner size="sm" className="me-2"/>
                    Creating...
                  </>
                ) : (
                  'Create Configuration'
                )}
              </Button>
              <div className="text-muted small">
                {clientNameError ? 'Fix validation errors to continue' : 'Default values are applied automatically for unspecified settings'}
              </div>
            </div>

            {/* Advanced Section */}
            <div className="border-top pt-3">
              <Form.Check
                type="switch"
                id="showAdvanced"
                label="Advanced Configuration"
                checked={showAdvanced}
                onChange={e => setShowAdvanced(e.currentTarget.checked)}
                className="mb-3"
              />
              {showAdvanced && (
                <div className="bg-light rounded p-3">
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Standard User Features</Form.Label>
                        <FeatureChecklist value={groupStandard} onChange={setGroupStandard} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Admin User Features</Form.Label>
                        <FeatureChecklist value={groupAdmin} onChange={setGroupAdmin} />
                      </Form.Group>
                    </Col>
                  </Row>
                  <div className="text-muted small">
                    Leave unchanged to use system defaults. Modify only if you need to override the recommended groups.
                  </div>
                </div>
              )}
            </div>
          </Form>
        </Card.Body>
      </Card>
      <Card className="border-0 shadow-sm mt-4">
        <Card.Header>
          <h6 className="mb-0">Create from JSON (Developers)</h6>
          <p className="text-muted small mb-0 mt-2">
            Upload a full JSON config and create using the Client Name above. Validation is strict and mirrors replace semantics in the CLI.
          </p>
        </Card.Header>
        <Card.Body>
          <Row className="align-items-end g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label className="fw-semibold">Upload JSON file</Form.Label>
                <Form.Control
                  type="file"
                  accept="application/json,.json"
                  onChange={async e => {
                    setJsonError(null)
                    setUploadedConfig(null)
                    const file = e.currentTarget.files?.[0]
                    if (!file) return
                    try {
                      const text = await file.text()
                      const parsed = JSON.parse(text)
                      const validated = clientConfigSchema.strict().parse(parsed)
                      setUploadedConfig(validated as ClientConfig)
                    } catch (err: any) {
                      setJsonError(err?.message || 'Invalid JSON or schema mismatch')
                    }
                  }}
                />
                <Form.Text className="text-muted">Provide a complete JSON config. Unknown fields are not allowed.</Form.Text>
              </Form.Group>
            </Col>
            <Col md={6} className="d-flex gap-2">
              <Button
                variant="secondary"
                disabled={!uploadedConfig || !clientName || !!clientNameError}
                onClick={() => setShowJsonPreview(true)}
              >
                Preview JSON
              </Button>
              <Button
                variant="primary"
                disabled={!uploadedConfig || !clientName || !!clientNameError || submitting}
                onClick={async () => {
                  if (!uploadedConfig || !clientName || clientNameError) return
                  setError(null)
                  try {
                    setSubmitting(true)
                    await clientService.createClientConfig(clientName, uploadedConfig)
                    setSuccess('Client configuration created successfully')
                    setShowJsonPreview(false)
                    setUploadedConfig(null)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to create client config')
                  } finally {
                    setSubmitting(false)
                  }
                }}
              >Create From JSON</Button>
            </Col>
          </Row>
          {jsonError && <Alert variant="danger" className="mt-3">{jsonError}</Alert>}
        </Card.Body>
      </Card>
      <Modal show={showPreview} onHide={() => setShowPreview(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Create</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Please review the configuration to be created for <strong>{clientName || '—'}</strong>:</p>
          <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {JSON.stringify(pendingConfig, null, 2)}
          </pre>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPreview(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={submitting}
            onClick={async () => {
              if (!pendingConfig) return
              setError(null)
              try {
                setSubmitting(true)
                await clientService.createClientConfig(clientName, pendingConfig)
                setSuccess('Client configuration created successfully')
                setShowPreview(false)
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to create client config')
              } finally {
                setSubmitting(false)
              }
            }}
          >{submitting ? (<><Spinner size="sm" className="me-2"/>Creating…</>) : 'Confirm Create'}</Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showJsonPreview} onHide={() => setShowJsonPreview(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>JSON Preview</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Creating configuration for <strong>{clientName || '—'}</strong> with uploaded JSON:</p>
          <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {uploadedConfig ? JSON.stringify(uploadedConfig, null, 2) : ''}
          </pre>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowJsonPreview(false)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
