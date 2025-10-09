import { useEffect, useState } from 'react';
import {
  Container,
  Row,
  Col,
  Tabs,
  Tab,
  Card,
  Button,
  Spinner,
  Modal,
  Alert,
  OverlayTrigger,
  Tooltip,
  Form,
} from 'react-bootstrap';
import { Nav } from '../Components/Nav';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import UserManagement from './UserManagement';
import { useAuth } from '../Providers/AuthProvider';
import { AdminIntegrationsService, type GlobalIntegrationSettingsMap } from '../Services/AdminIntegrationsService';
import { getIntegrationsListFormat, type IntegrationListItem } from '../config/integrationsConfig';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { useNumaRequest } from '../Providers/NumaRequestContext';

const AVAILABLE_INTEGRATIONS: IntegrationListItem[] = getIntegrationsListFormat();

export default function SettingsPage() {
  const { user } = useAuth();
  const { numaGet, numaPut } = useNumaRequest();
  const [activeKey, setActiveKey] = useState<string>('users');

  // Global (admin) settings
  const [globalSettings, setGlobalSettings] = useState<GlobalIntegrationSettingsMap>({});
  const [loadingSettings, setLoadingSettings] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Pipedream feature + relay
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;

  // AWS Lambda client for listing tools (admin view)
  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);

  useEffect(() => {
    const initLambda = async () => {
      if (!user || previewMode) return;
      try {
        const REGION = window.sessionStorage.getItem('REGION') || 'us-east-1';
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        if (!roleArn) return;
        const credentials = fromWebToken({
          webIdentityToken: user.tokens.idToken,
          roleArn,
          roleSessionName: cognitoUserId,
        });
        setLambdaClient(new LambdaClient({ region: REGION, credentials }));
      } catch (e) {
        console.error('Settings: init lambda failed', e);
      }
    };
    initLambda();
  }, [user, previewMode]);

  const loadGlobal = async () => {
    try {
      setLoadingSettings(true);
      if (!user) return;
      const data = await AdminIntegrationsService.listWithNuma(numaGet);
      setGlobalSettings(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load settings');
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    if (previewMode) {
      // Feature disabled: avoid calling the API and clear loading state
      setGlobalSettings({});
      setLoadingSettings(false);
      return;
    }
    loadGlobal();
  }, [user, numaGet, previewMode]);

  // Integrations tab internal state
  const [manageToolsFor, setManageToolsFor] = useState<string | null>(null);
  const [toolsLoading, setToolsLoading] = useState<boolean>(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolList, setToolList] = useState<{ name: string; description?: string }[]>([]);
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({});
  // No need to keep initial snapshot in this view currently

  const openManageTools = async (integrationId: string) => {
    if (!lambdaClient || !user) return;
    try {
      setManageToolsFor(integrationId);
      setToolsLoading(true);
      setToolsError(null);
      const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
      const { tools } = await PipedreamProxyService.listMcpTools(lambdaClient, externalUserId, integrationId);
      const globalDeny = new Set(globalSettings[integrationId]?.denyTools || []);
      const toggles: Record<string, boolean> = {};
      (tools || []).forEach((t) => (toggles[t.name] = !globalDeny.has(t.name)));
      setToolList(tools || []);
      setToolToggles(toggles);
    } catch (e) {
      setToolsError((e as Error).message || 'Failed to load tools');
    } finally {
      setToolsLoading(false);
    }
  };

  const saveManageTools = async () => {
    if (!manageToolsFor) return;
    try {
      const denyTools = Object.entries(toolToggles)
        .filter(([, allowed]) => !allowed)
        .map(([name]) => name);
      await AdminIntegrationsService.updateWithNuma(
        manageToolsFor,
        {
          status: globalSettings[manageToolsFor]?.status || 'disabled',
          denyTools,
        },
        numaPut,
      );
      await loadGlobal();
      setManageToolsFor(null);
    } catch (e) {
      setToolsError((e as Error).message || 'Failed to save');
    }
  };

  const toggleIntegration = async (integrationId: string, nextEnabled: boolean) => {
    try {
      if (!nextEnabled && globalSettings[integrationId]?.status === 'enabled') {
        const ok = window.confirm(`Disabling ${integrationId} will prevent users from accessing it in Numa. Continue?`);
        if (!ok) return;
      }
      await AdminIntegrationsService.updateWithNuma(
        integrationId,
        {
          status: nextEnabled ? 'enabled' : 'disabled',
          denyTools: globalSettings[integrationId]?.denyTools || [],
        },
        numaPut,
      );
      await loadGlobal();
    } catch (e) {
      setError((e as Error).message || 'Failed to update integration');
    }
  };

  const renderIntegrationRow = (integration: IntegrationListItem) => {
    const id = integration.name_slug;
    const enabled = globalSettings[id]?.status === 'enabled';
    const deniedCount = globalSettings[id]?.denyTools?.length || 0;
    const disabledByPreview = previewMode;

    return (
      <div
        key={id}
        className="border rounded-3 p-3 mb-2 bg-white"
        style={{
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          transition: 'all 0.2s ease',
          opacity: enabled || disabledByPreview ? 1 : 0.75,
          cursor: 'default',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
        }}
      >
        <div className="row align-items-center">
          <div className="col-md-6 d-flex align-items-center">
            <div
              className="rounded-2 d-flex align-items-center justify-content-center me-3 flex-shrink-0"
              style={{ width: '48px', height: '48px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}
            >
              <img
                src={integration.img_src}
                alt={integration.name}
                width={32}
                height={32}
                style={{ objectFit: 'contain' }}
              />
            </div>
            <div>
              <div className="fw-semibold" style={{ fontSize: '0.95rem' }}>
                {integration.name}
              </div>
              <div className="text-muted small" style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>
                {integration.description}
              </div>
            </div>
          </div>
          <div className="col-md-6 d-flex justify-content-end gap-2 align-items-center">
            {disabledByPreview ? (
              <OverlayTrigger
                placement="top"
                overlay={
                  <Tooltip>
                    Numa Integrations are not enabled in your Numa environment. Contact your account administrator to
                    request access.
                  </Tooltip>
                }
              >
                <div>
                  <Form.Check
                    type="switch"
                    id={`toggle-${id}`}
                    checked={enabled}
                    disabled
                    onChange={() => {}}
                    label={<span className="small">{enabled ? 'Enabled' : 'Disabled'}</span>}
                  />
                </div>
              </OverlayTrigger>
            ) : (
              <Form.Check
                type="switch"
                id={`toggle-${id}`}
                checked={enabled}
                onChange={() => toggleIntegration(id, !enabled)}
                label={<span className="small">{enabled ? 'Enabled' : 'Disabled'}</span>}
              />
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => openManageTools(id)}
              disabled={disabledByPreview}
              className="d-flex align-items-center"
            >
              <i className="bi bi-sliders me-2"></i>
              Manage Tools{' '}
              {deniedCount > 0 && (
                <span className="ms-1 badge bg-light text-dark" style={{ fontSize: '0.7rem' }}>
                  {deniedCount} off
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard">
      <Nav />
      <main>
        <Container>
          <Row className="mb-3">
            <Col>
              <Breadcrumbs label={'Settings'} clearStack={true} />
              <h1 className="mb-0 fs-3">Settings</h1>
            </Col>
          </Row>

          {/* Note: company-wide banner and preview notice moved into Integrations tab */}

          {error && (
            <Alert variant="danger" className="mb-3">
              {error}
            </Alert>
          )}

          <Card className="border-0 shadow-sm">
            <Card.Body>
              <Tabs activeKey={activeKey} onSelect={(k) => setActiveKey(k || 'users')} className="mb-3">
                <Tab
                  eventKey="users"
                  title={
                    <span>
                      <i className="bi bi-people-fill me-2"></i>Users
                    </span>
                  }
                >
                  <UserManagement />
                </Tab>
                <Tab
                  eventKey="integrations"
                  title={
                    <span>
                      <i className="bi bi-plug-fill me-2"></i>Integrations
                    </span>
                  }
                >
                  <Alert variant="secondary" className="mb-3">
                    <div className="d-flex align-items-start">
                      <i className="bi bi-building-gear me-2 mt-1"></i>
                      <div>
                        <div className="fw-semibold">Company-wide settings</div>
                        <div className="small text-muted">
                          These settings apply to everyone in your Numa environment. Use the toggle to enable/disable
                          each integration for your company, and use <span className="fw-semibold">Manage Tools</span>{' '}
                          to turn specific capabilities off globally.
                        </div>
                      </div>
                    </div>
                  </Alert>
                  {previewMode && (
                    <Alert variant="info" className="mb-3">
                      Numa Integrations are not enabled in your Numa environment. Contact your account administrator to
                      request access.
                    </Alert>
                  )}
                  {loadingSettings ? (
                    <div className="text-center py-5">
                      <Spinner animation="border" variant="primary" />
                    </div>
                  ) : (
                    <div>
                      {AVAILABLE_INTEGRATIONS.sort((a, b) => {
                        const enabledA = globalSettings[a.name_slug]?.status === 'enabled';
                        const enabledB = globalSettings[b.name_slug]?.status === 'enabled';
                        if (enabledA !== enabledB) return enabledA ? -1 : 1;
                        return a.name.localeCompare(b.name);
                      }).map(renderIntegrationRow)}
                    </div>
                  )}
                </Tab>
              </Tabs>
            </Card.Body>
          </Card>

          <Modal show={!!manageToolsFor} onHide={() => setManageToolsFor(null)} centered size="lg">
            <Modal.Header closeButton className="border-0 pb-2">
              <Modal.Title>
                <div className="d-flex align-items-center">
                  <i className="bi bi-sliders me-2 text-primary"></i>
                  Manage Tools – {manageToolsFor}
                </div>
                <div className="small text-muted fw-normal mt-2" style={{ fontSize: '0.85rem' }}>
                  These tool settings are company-wide. Users cannot enable tools you disable here.
                </div>
              </Modal.Title>
            </Modal.Header>
            <Modal.Body className="pt-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {toolsLoading ? (
                <div className="text-center py-5">
                  <Spinner animation="border" variant="primary" />
                  <p className="mt-3 text-muted mb-0">Loading tools...</p>
                </div>
              ) : toolsError ? (
                <Alert variant="danger" className="mb-0">
                  <i className="bi bi-exclamation-triangle-fill me-2"></i>
                  {toolsError}
                </Alert>
              ) : toolList.length === 0 ? (
                <div className="text-center py-5">
                  <i className="bi bi-info-circle text-muted" style={{ fontSize: '2rem' }}></i>
                  <p className="text-muted mt-2 mb-0">No tools found for this integration.</p>
                </div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {toolList.map((t) => {
                    const allowed = toolToggles[t.name] ?? true;

                    // Helper functions for formatting tool names
                    const stripPrefix = (name: string, prefix?: string | null) =>
                      prefix && name.startsWith(prefix + '-') ? name.slice(prefix.length + 1) : name;
                    const toTitle = (s: string) =>
                      s
                        .split('-')
                        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
                        .join(' ');

                    // Parse markdown links in description and clean up display
                    const parseDescription = (desc: string | undefined) => {
                      if (!desc) return null;

                      // Match markdown links: [text](url)
                      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                      const parts: (string | React.ReactElement)[] = [];
                      let lastIndex = 0;
                      let match: RegExpExecArray | null;

                      while ((match = linkRegex.exec(desc)) !== null) {
                        // Add text before the link
                        if (match.index > lastIndex) {
                          parts.push(desc.substring(lastIndex, match.index));
                        }

                        // Replace "See the docs" with "see documentation"
                        const linkText = match[1].toLowerCase().includes('see') ? 'see documentation' : match[1];

                        // Add the link as JSX
                        parts.push(
                          <a
                            key={match.index}
                            href={match[2]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-decoration-none"
                          >
                            [{linkText}]
                          </a>,
                        );

                        lastIndex = match.index + match[0].length;
                      }

                      // Add any remaining text
                      if (lastIndex < desc.length) {
                        parts.push(desc.substring(lastIndex));
                      }

                      return parts.length > 0 ? parts : desc;
                    };

                    const displayName = toTitle(stripPrefix(t.name, manageToolsFor));

                    return (
                      <div
                        key={t.name}
                        className={`d-flex align-items-start justify-content-between p-3 border rounded-3 ${
                          allowed ? 'bg-light bg-opacity-25' : 'bg-light bg-opacity-50'
                        }`}
                        style={{
                          transition: 'all 0.2s ease',
                          borderColor: allowed ? 'var(--bs-border-color)' : 'var(--bs-border-color-translucent)',
                        }}
                      >
                        <div className="flex-grow-1 me-3">
                          <div className="d-flex align-items-center mb-1">
                            <div
                              className={`rounded-circle me-2 ${allowed ? 'bg-success' : 'bg-secondary'}`}
                              style={{ width: '8px', height: '8px', transition: 'all 0.2s ease' }}
                            ></div>
                            <span className={`fw-semibold ${allowed ? 'text-dark' : 'text-muted'}`}>{displayName}</span>
                          </div>
                          {t.description && (
                            <div
                              className={`small ${allowed ? 'text-muted' : 'text-secondary'}`}
                              style={{
                                maxWidth: 720,
                                whiteSpace: 'normal',
                                wordBreak: 'break-word',
                                lineHeight: '1.4',
                                fontSize: '0.85rem',
                              }}
                            >
                              {parseDescription(t.description)}
                            </div>
                          )}
                        </div>
                        <div className="form-check form-switch ms-2">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={allowed}
                            onChange={(e) => setToolToggles({ ...toolToggles, [t.name]: e.target.checked })}
                            style={{
                              transform: 'scale(1.1)',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer
              className="border-top pt-3"
              style={{
                position: 'sticky',
                bottom: 0,
                backgroundColor: 'white',
                zIndex: 1050,
                boxShadow: '0 -2px 8px rgba(0,0,0,0.05)',
              }}
            >
              <div className="d-flex justify-content-between align-items-center w-100">
                <small className="text-muted">
                  {toolList.length > 0 && (
                    <span>
                      <i className="bi bi-info-circle me-1"></i>
                      {Object.values(toolToggles).filter(Boolean).length} of {toolList.length} tools enabled
                    </span>
                  )}
                </small>
                <div>
                  <Button variant="outline-secondary" onClick={() => setManageToolsFor(null)} className="me-2">
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={saveManageTools} disabled={toolsLoading || !!toolsError}>
                    <i className="bi bi-check-lg me-2"></i>
                    Save Changes
                  </Button>
                </div>
              </div>
            </Modal.Footer>
          </Modal>
        </Container>
      </main>
    </div>
  );
}
