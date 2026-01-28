import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, Form, Button, Row, Col, Alert, Spinner, Modal } from 'react-bootstrap'
import { ClientSelectGroup } from '@/components/ClientSelectGroup'
import { FeatureChecklist } from '@/components/FeatureChecklist'
import { ConfigField } from '@/components/ConfigField'
import { clientService } from '@/services/clientService'
import { Client, ClientConfig, clientConfigSchema, getDefaultClientConfigValues } from '@/types'
import { FileExportService } from '@/utils/fileExport'
import { DEFAULT_ADMIN_FEATURES, DEFAULT_STANDARD_FEATURES, featuresListToString, sameMembers, stringToFeatures } from '@/constants/features'

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

export default function UpdateClientConfig() {
  const [searchParams] = useSearchParams()
  const defaults = getDefaultClientConfigValues()

  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientName, setSelectedClientName] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // editable fields
  const [region, setRegion] = useState('us-east-1')
  const [allProdApps, setAllProdApps] = useState(true)
  const [allApps, setAllApps] = useState<boolean>(false)
  const [selectedApps, setSelectedApps] = useState<string[]>([])
  const [pipedream, setPipedream] = useState<boolean>(false)
  const [dataConnectorsEnabled, setDataConnectorsEnabled] = useState<boolean>(false)
  const [agents, setAgents] = useState<boolean>(false)
  const [devInstance, setDevInstance] = useState<boolean>(false)
  const [customDomain, setCustomDomain] = useState<string>('')
  const [allowQuotaSharing, setAllowQuotaSharing] = useState<boolean>(false)
  const [bedrockAccount, setBedrockAccount] = useState<string>('')
  const [provisionQResources, setProvisionQResources] = useState<boolean>(false)
  const [preferredKnowledgeBase, setPreferredKnowledgeBase] = useState<'q' | 'bedrock'>(defaults.preferredKnowledgeBase)
  const [brandingProviderEnabled, setBrandingProviderEnabled] = useState<boolean>(false)
  const [numaWorkspaceChat, setNumaWorkspaceChat] = useState<boolean>(false)
  const [mfa, setMfa] = useState<boolean>(false)
  const [groupAdmin, setGroupAdmin] = useState(featuresListToString(DEFAULT_ADMIN_FEATURES))
  const [groupStandard, setGroupStandard] = useState(featuresListToString(DEFAULT_STANDARD_FEATURES))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [beforeJson, setBeforeJson] = useState('')
  const [afterJson, setAfterJson] = useState('')
  // developer JSON replace
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [uploadedConfig, setUploadedConfig] = useState<ClientConfig | null>(null)
  const [showReplacePreview, setShowReplacePreview] = useState(false)

  // Prefill selected client from query params (if present)
  useEffect(() => {
    const qClient = (searchParams.get('clientName') || '').trim()
    if (qClient) setSelectedClientName(qClient)
  }, [])

  useEffect(() => {
    (async () => {
      try {
        setWorking(true)
        const list = await clientService.getAllClients()
        setClients(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients')
      } finally {
        setWorking(false)
      }
    })()
  }, [])

  useEffect(() => {
    const client = clients.find(c => c.name === selectedClientName)
    if (!client) return
    const cfg = client.config
    setRegion(cfg.region || 'us-east-1')
    const ap = Boolean(cfg.allProdApps)
    setAllProdApps(ap)
    const aa = (cfg as any).allApps
    const isDev = Boolean(cfg.devInstance)
    // Default allApps to true for dev instances when not explicitly set
    setAllApps(aa === undefined ? (isDev ? true : false) : Boolean(aa))
    const appsRecord = (!ap && cfg.apps ? (cfg.apps as Record<string, { enabled?: boolean }>) : undefined)
    const apps = appsRecord ? Object.keys(appsRecord) : []
    setSelectedApps(apps)
    const pd = (cfg as unknown as Record<string, unknown>)['pipedreamIntegrations']
    setPipedream(Boolean(pd))
    const dc = (cfg as unknown as Record<string, unknown>)['dataConnectorsEnabled']
    setDataConnectorsEnabled(Boolean(dc))
    const ag = (cfg as unknown as Record<string, unknown>)['agents']
    setAgents(Boolean(ag))
    setDevInstance(Boolean(cfg.devInstance))
    setCustomDomain(cfg.customDomain || '')
    setAllowQuotaSharing(Boolean(cfg.allowBedrockQuotaSharing))
    setBedrockAccount(cfg.bedrockAccount || '')
    setProvisionQResources(Boolean((cfg as any).provisionQResources))
    setPreferredKnowledgeBase(((cfg as any).preferredKnowledgeBase as 'q' | 'bedrock') || defaults.preferredKnowledgeBase)
    setBrandingProviderEnabled(Boolean((cfg as any).brandingProviderEnabled))
    setNumaWorkspaceChat(Boolean((cfg as any).numaWorkspaceChat))
    setMfa(Boolean((cfg as any).mfa))
    const groups = (cfg as unknown as Record<string, unknown>)['groups'] as { admin?: string[]; standard?: string[] } | undefined
    const adminList = (groups?.admin && groups.admin.length > 0) ? groups.admin : DEFAULT_ADMIN_FEATURES
    const standardList = (groups?.standard && groups.standard.length > 0) ? groups.standard : DEFAULT_STANDARD_FEATURES
    setGroupAdmin(featuresListToString(adminList))
    setGroupStandard(featuresListToString(standardList))
  }, [selectedClientName, clients])

  const buildUpdates = (current?: ClientConfig): Partial<ClientConfig> => {
    const eff = {
      region: current?.region,
      allProdApps: current?.allProdApps ?? defaults.allProdApps,
      allApps: (current as any)?.allApps ?? false,
      apps: current?.apps,
      devInstance: current?.devInstance ?? defaults.devInstance,
      customDomain: current?.customDomain ?? '',
      allowBedrockQuotaSharing: current?.allowBedrockQuotaSharing ?? defaults.allowBedrockQuotaSharing,
      bedrockAccount: current?.bedrockAccount ?? '',
      pipedreamIntegrations: current?.pipedreamIntegrations ?? false,
      dataConnectorsEnabled: (current as any)?.dataConnectorsEnabled ?? false,
      agents: (current as any)?.agents ?? false,
      brandingProviderEnabled: (current as any)?.brandingProviderEnabled ?? defaults.brandingProviderEnabled,
      numaWorkspaceChat: (current as any)?.numaWorkspaceChat ?? defaults.numaWorkspaceChat,
      provisionQResources: (current as any)?.provisionQResources ?? defaults.provisionQResources,
      preferredKnowledgeBase: ((current as any)?.preferredKnowledgeBase as 'q' | 'bedrock') ?? defaults.preferredKnowledgeBase,
      mfa: (current as any)?.mfa ?? defaults.mfa,
    }

    const updates: Partial<ClientConfig> = {}

    // Only include region if changed
    if (region && eff.region !== region) updates.region = region

    // Only include allApps/allProdApps if changed
    if (eff.allApps !== allApps) updates.allApps = allApps
    if (!allApps && eff.allProdApps !== allProdApps) updates.allProdApps = allProdApps

    // Handle apps array: when allApps is true, don't include apps (all apps deployed automatically)
    // When allProdApps is true, only include selected dev apps
    // When both false, include all selected apps
    if (!allApps) {
      const appsToInclude = allProdApps
        ? selectedApps.filter(a => !PROD_APPS.includes(a))  // Only dev apps when allProdApps is true
        : selectedApps;  // All selected apps when allProdApps is false

      const currentApps = Object.keys(eff.apps || {});
      const hasChanged = !sameMembers(currentApps, appsToInclude);

      if (hasChanged) {
        updates.apps = appsToInclude.length > 0
          ? Object.fromEntries(appsToInclude.map(a => [a, {}]))
          : {};
      }
    }

    // Only include pipedreamIntegrations if changed
    if (eff.pipedreamIntegrations !== pipedream) updates.pipedreamIntegrations = pipedream
    if (eff.dataConnectorsEnabled !== dataConnectorsEnabled) updates.dataConnectorsEnabled = dataConnectorsEnabled

    // Only include agents if changed
    if (eff.agents !== agents) updates.agents = agents

    // Only include other flags if changed vs effective current
    if (eff.devInstance !== devInstance) updates.devInstance = devInstance
    if (eff.customDomain !== customDomain.trim()) {
      if (customDomain.trim()) {
        updates.customDomain = customDomain.trim()
      } else if (current?.customDomain) {
        // Remove customDomain if it was set but now cleared
        updates.customDomain = undefined as any
      }
    }
    if (eff.allowBedrockQuotaSharing !== allowQuotaSharing) updates.allowBedrockQuotaSharing = allowQuotaSharing
    if (eff.bedrockAccount !== bedrockAccount.trim()) {
      if (bedrockAccount.trim()) {
        updates.bedrockAccount = bedrockAccount.trim()
      } else if (current?.bedrockAccount) {
        // Remove bedrockAccount if it was set but now cleared
        updates.bedrockAccount = undefined as any
      }
    }
    if (eff.brandingProviderEnabled !== brandingProviderEnabled) updates.brandingProviderEnabled = brandingProviderEnabled
    if (eff.numaWorkspaceChat !== numaWorkspaceChat) updates.numaWorkspaceChat = numaWorkspaceChat
    if (eff.mfa !== mfa) updates.mfa = mfa

    // Ensure these new fields are written even if default and currently missing
    if ((current as any)?.provisionQResources === undefined) {
      updates.provisionQResources = provisionQResources
    } else if (eff.provisionQResources !== provisionQResources) {
      updates.provisionQResources = provisionQResources
    }
    if ((current as any)?.preferredKnowledgeBase === undefined) {
      updates.preferredKnowledgeBase = preferredKnowledgeBase
    } else if (eff.preferredKnowledgeBase !== preferredKnowledgeBase) {
      updates.preferredKnowledgeBase = preferredKnowledgeBase
    }

    // Groups: only include if advanced mode enabled and values differ from current effective
    const admin = stringToFeatures(groupAdmin)
    const standard = stringToFeatures(groupStandard)
    const currentGroups = (current as unknown as Record<string, unknown>)?.['groups'] as { admin?: string[]; standard?: string[] } | undefined
    const currentAdmin = currentGroups?.admin ?? DEFAULT_ADMIN_FEATURES
    const currentStandard = currentGroups?.standard ?? DEFAULT_STANDARD_FEATURES
    if (showAdvanced && (!sameMembers(admin, currentAdmin) || !sameMembers(standard, currentStandard))) {
      ;(updates as unknown as Record<string, unknown>)['groups'] = {
        ...(standard.length ? { standard } : {}),
        ...(admin.length ? { admin } : {}),
      }
    }

    return updates
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!selectedClientName) { setError('Select a client'); return }
    const current = clients.find(c => c.name === selectedClientName)?.config
    const updates: Partial<ClientConfig> = buildUpdates(current)
    const merged = { ...(current || {}), ...updates }
    setBeforeJson(JSON.stringify(current, null, 2))
    setAfterJson(JSON.stringify(merged, null, 2))
    setShowPreview(true)
  }

  const selectedClient = clients.find(c => c.name === selectedClientName)

  return (
    <div>
      <Card className="border-0 shadow-sm">
        <Card.Header>
          <h5 className="mb-0">Update Client Config</h5>
          <p className="text-muted small mb-0 mt-2">
            Modify an existing client configuration. Values that differ from defaults are highlighted.
            For advanced features like data sources or custom domains, contact a developer.
          </p>
        </Card.Header>
        <Card.Body>
          <Form onSubmit={onSubmit}>
            {/* Client Selection */}
            <Form.Group className="mb-4">
              <Form.Label className="fw-semibold">Select Client</Form.Label>
              <ClientSelectGroup
                value={selectedClientName}
                onChange={setSelectedClientName}
                clients={clients}
              />
              {selectedClient && (
                <Form.Text className="text-muted">
                  Account: {selectedClient.config.clientAccountId} |
                  Type: {selectedClient.config.devInstance ? 'Development' : 'Production'}
                </Form.Text>
              )}
            </Form.Group>

            {selectedClientName && (
              <>
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
                      onChange={setDevInstance}
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
                      defaultValue={defaults.allProdApps}
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
                      label="Data Connectors"
                      value={dataConnectorsEnabled}
                      defaultValue={defaults.dataConnectorsEnabled}
                      onChange={setDataConnectorsEnabled}
                      type="switch"
                      helpText="Show data connectors in the frontend"
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
                      label="Numa Workspace Chat"
                      value={numaWorkspaceChat}
                      defaultValue={defaults.numaWorkspaceChat}
                      onChange={setNumaWorkspaceChat}
                      type="switch"
                      helpText="Feature flag for Numa Chat V2 testing"
                    />
                    <ConfigField
                      label="Multi-Factor Authentication (MFA)"
                      value={mfa}
                      defaultValue={defaults.mfa}
                      onChange={setMfa}
                      type="switch"
                      helpText="Require TOTP-based two-factor authentication for all users"
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
                    disabled={working}
                    className="px-4"
                  >
                    {working ? (
                      <>
                        <Spinner size="sm" className="me-2"/>
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                  <div className="text-muted small">
                    Only modified values will be updated in the configuration
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
              </>
            )}
          </Form>
        </Card.Body>
      </Card>

      {/* Developer JSON Replace */}
      <Card className="border-0 shadow-sm mt-4">
        <Card.Header>
          <h6 className="mb-0">Replace Config from JSON (Developers)</h6>
          <p className="text-muted small mb-0 mt-2">
            Upload a full JSON config to replace the current configuration. Validation is strict. This mirrors the CLI write-config replace behavior.
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
                      const msg = err?.message || 'Invalid JSON or schema mismatch'
                      setJsonError(msg)
                    }
                  }}
                />
                <Form.Text className="text-muted">Only valid JSON matching the strict schema is accepted.</Form.Text>
              </Form.Group>
            </Col>
            <Col md={6} className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                disabled={!selectedClient}
                onClick={() => {
                  if (!selectedClient) return
                  const content = JSON.stringify(selectedClient.config, null, 2)
                  FileExportService.downloadFile({
                    name: `${selectedClient.name}.json`,
                    content,
                    mimeType: 'application/json',
                    size: new Blob([content]).size,
                  })
                }}
              >
                Download current JSON
              </Button>
              <Button
                variant="primary"
                disabled={!uploadedConfig || !selectedClientName || working}
                onClick={() => {
                  try {
                    setJsonError(null)
                    const before = clients.find(c => c.name === selectedClientName)?.config
                    setBeforeJson(JSON.stringify(before, null, 2))
                    setAfterJson(JSON.stringify(uploadedConfig, null, 2))
                    setShowReplacePreview(true)
                  } catch (err: any) {
                    setJsonError(err?.message || 'Unable to prepare preview')
                  }
                }}
              >
                Preview Replace
              </Button>
            </Col>
          </Row>
          {jsonError && <Alert variant="danger" className="mt-3">{jsonError}</Alert>}
        </Card.Body>
      </Card>

    <Modal show={showPreview} onHide={() => setShowPreview(false)} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Confirm Update</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row>
          <Col md={6}>
            <h6 className="text-muted">Current</h6>
            <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>{beforeJson}</pre>
          </Col>
          <Col md={6}>
            <h6 className="text-muted">Updated</h6>
            <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>{afterJson}</pre>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowPreview(false)}>Cancel</Button>
        <Button
          variant="primary"
          disabled={working}
          onClick={async () => {
            try {
              setWorking(true)
              // Recompute updates from afterJson – safer to reuse local updates by parsing the diff is overkill; call update with our 'updates' closure values
              const current = clients.find(c => c.name === selectedClientName)?.config
              const finalUpdates = buildUpdates(current)
              await clientService.updateClientConfig(selectedClientName, finalUpdates)
              setSuccess('Configuration updated')
              setShowPreview(false)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to update config')
            } finally {
              setWorking(false)
            }
          }}
        >{working ? (<><Spinner size="sm" className="me-2"/>Saving…</>) : 'Confirm Update'}</Button>
      </Modal.Footer>
    </Modal>

    <Modal show={showReplacePreview} onHide={() => setShowReplacePreview(false)} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Confirm Replace</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted">This will replace the entire configuration for <strong>{selectedClientName || '—'}</strong>.</p>
        <Row>
          <Col md={6}>
            <h6 className="text-muted">Current</h6>
            <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>{beforeJson}</pre>
          </Col>
          <Col md={6}>
            <h6 className="text-muted">New</h6>
            <pre className="bg-light p-3 rounded" style={{ maxHeight: '50vh', overflow: 'auto' }}>{afterJson}</pre>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowReplacePreview(false)}>Cancel</Button>
        <Button
          variant="primary"
          disabled={working || !uploadedConfig || !selectedClientName}
          onClick={async () => {
            if (!uploadedConfig || !selectedClientName) return
            try {
              setWorking(true)
              await clientService.replaceClientConfig(selectedClientName, uploadedConfig)
              setSuccess('Configuration replaced')
              setShowReplacePreview(false)
              setUploadedConfig(null)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to replace config')
            } finally {
              setWorking(false)
            }
          }}
        >{working ? (<><Spinner size="sm" className="me-2"/>Replacing…</>) : 'Confirm Replace'}</Button>
      </Modal.Footer>
    </Modal>
    </div>
  )
}

// FeatureChecklist moved to shared component
