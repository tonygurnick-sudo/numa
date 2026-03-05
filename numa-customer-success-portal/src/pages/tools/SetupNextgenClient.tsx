import { useState, useEffect } from 'react';
import { Card, Form, Button, Row, Col, Alert, Spinner } from 'react-bootstrap';
import { nextgenBrokerService } from '@/services/nextgenBrokerService';
import { clientService } from '@/services/clientService';
import { activityService } from '@/services/activityService';
import { validateClientName, sanitizeClientName } from '@/utils/clientValidation';

export default function SetupNextgenClient() {
  const [accountId, setAccountId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientIdError, setClientIdError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameOk, setRenameOk] = useState<null | { accountId: string; name: string }>(null);
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [secretUser, setSecretUser] = useState<string | null>(null);
  const [secretPass, setSecretPass] = useState<string | null>(null);
  const [secretErr, setSecretErr] = useState<string | null>(null);
  const [gettingSecret, setGettingSecret] = useState(false);

  // Validate client ID whenever it changes
  useEffect(() => {
    if (clientId.trim().length > 0) {
      const error = validateClientName(clientId);
      setClientIdError(error);
    } else {
      setClientIdError(null);
    }
  }, [clientId]);

  const canRename = accountId.trim().length === 12 && !!clientId && !clientIdError;

  const onRename = async () => {
    setRenameErr(null);
    setRenameOk(null);
    try {
      setRenaming(true);
      const res = await nextgenBrokerService.updateAccountName(accountId.trim(), clientId.trim());
      setRenameOk(res);
      // Log activity on success (non-blocking)
      activityService
        .logActivity({
          type: 'system',
          action: 'account-rename',
          resourceType: 'aws-account',
          resourceId: accountId.trim(),
          details: { metadata: { newName: clientId.trim() } },
          success: true,
        })
        .catch(() => {});
    } catch (e) {
      setRenameErr(e instanceof Error ? e.message : 'Rename failed');
      // Attempt to log failure (non-blocking)
      activityService
        .logActivity({
          type: 'system',
          action: 'account-rename',
          resourceType: 'aws-account',
          resourceId: accountId.trim(),
          details: { metadata: { newName: clientId.trim() } },
          success: false,
          errorMessage: e instanceof Error ? e.message : 'Unknown error',
        })
        .catch(() => {});
    } finally {
      setRenaming(false);
    }
  };

  const onGetSecret = async () => {
    setSecretErr(null);
    setSecret(null);
    setSecretUser(null);
    setSecretPass(null);
    try {
      setGettingSecret(true);
      const name = clientId.trim() ? `${clientId.trim()}-system-user-password` : 'system-user-password';
      // Try to resolve region from client config if clientId provided
      let region: string | undefined = undefined;
      try {
        const client = clientId.trim() ? await clientService.getClient(clientId.trim()) : undefined;
        region = client?.config?.region || undefined;
      } catch {}
      const res = await nextgenBrokerService.getSystemUserSecret(accountId.trim(), name, region);
      const raw = res.secretString || '';
      setSecret(raw);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setSecretUser(parsed.username || parsed.user || null);
          setSecretPass(parsed.password || parsed.pass || null);
        }
      } catch {
        // ignore JSON parse errors; show raw
      }
    } catch (e) {
      setSecretErr(e instanceof Error ? e.message : 'Failed to retrieve secret');
    } finally {
      setGettingSecret(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header>
        <h5 className="mb-0">Setup NextGen Client</h5>
        <p className="text-muted small mb-0 mt-2">
          Guided flow to rename the account, create/update client config, deploy, and retrieve the system user password.
        </p>
      </Card.Header>
      <Card.Body>
        <Row className="mb-4">
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">AWS Account ID</Form.Label>
              <Form.Control
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="12-digit account id"
              />
              <Form.Text className="text-muted">NextGen client account id</Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">Client ID</Form.Label>
              <Form.Control
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="e.g. arcanum-demo"
                className={clientIdError ? 'border-danger' : clientId ? 'border-success' : ''}
                isInvalid={!!clientIdError}
              />
              {clientIdError ? (
                <>
                  <Form.Control.Feedback type="invalid">{clientIdError}</Form.Control.Feedback>
                  {sanitizeClientName(clientId) && sanitizeClientName(clientId) !== clientId && (
                    <Form.Text className="text-info">
                      Suggested: <strong>{sanitizeClientName(clientId)}</strong>
                    </Form.Text>
                  )}
                </>
              ) : (
                <Form.Text className="text-muted">Used as the account name and portal client name</Form.Text>
              )}
            </Form.Group>
          </Col>
        </Row>

        {/* Step A: Rename account (broker) */}
        <div className="mb-4">
          <h6 className="fw-semibold">Step A: Rename AWS Account</h6>
          <div className="d-flex align-items-center gap-2">
            <Button onClick={onRename} disabled={!canRename || renaming}>
              {renaming ? (
                <>
                  <Spinner size="sm" className="me-2" />
                  Renaming…
                </>
              ) : (
                'Rename Account'
              )}
            </Button>
            {renameOk && (
              <span className="text-success">
                Renamed to <strong>{renameOk.name}</strong>
              </span>
            )}
          </div>
          {renameErr && (
            <Alert variant="danger" className="mt-2 mb-0">
              {renameErr}
            </Alert>
          )}
        </div>

        {/* Step B: Client config (portal tool) */}
        <div className="mb-4">
          <h6 className="fw-semibold">Step B: Create/Update Client Config</h6>
          <p className="text-muted small mb-2">
            Use the portal tool to create or update the client configuration (supports JSON upload/replace).
          </p>
          <div className="d-flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                const url = `/tools/create-client-config?clientName=${encodeURIComponent(clientId.trim())}&accountId=${encodeURIComponent(accountId.trim())}`;
                window.open(url, '_blank', 'noreferrer');
              }}
            >
              Open Create (new tab)
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const url = `/tools/update-client-config?clientName=${encodeURIComponent(clientId.trim())}`;
                window.open(url, '_blank', 'noreferrer');
              }}
            >
              Open Update (new tab)
            </Button>
          </div>
        </div>

        {/* Step C: Plan/Deploy via SFN */}
        <div className="mb-4">
          <h6 className="fw-semibold">Step C: Plan/Deploy</h6>
          <p className="text-muted small mb-2">
            Use the Deployments page to run deploy by using Start Deployment. View live logs and manage locks.
          </p>
          <Button variant="primary" onClick={() => window.open('/deployments', '_blank', 'noreferrer')}>
            Open Deployments (new tab)
          </Button>
        </div>

        {/* Step D: Retrieve Secret (broker) */}
        <div className="mb-1">
          <h6 className="fw-semibold">Step D: Retrieve System User Password</h6>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Button variant="primary" onClick={onGetSecret} disabled={!accountId || gettingSecret}>
              {gettingSecret ? (
                <>
                  <Spinner size="sm" className="me-2" />
                  Fetching…
                </>
              ) : (
                'Retrieve Secret'
              )}
            </Button>
            {!!secretUser && <span className="text-muted small">user:</span>}
            {!!secretUser && <code className="bg-light px-2 py-1 rounded">{secretUser}</code>}
            {!!secretPass && <span className="text-muted small ms-2">password:</span>}
            {!!secretPass && <code className="bg-light px-2 py-1 rounded">{secretPass}</code>}
            {!secretUser && !secretPass && !!secret && <code className="bg-light px-2 py-1 rounded">{secret}</code>}
          </div>
          {secretErr && (
            <Alert variant="danger" className="mt-2 mb-0">
              {secretErr}
            </Alert>
          )}
        </div>

        {/* Client URL */}
        <div className="mt-4">
          <h6 className="fw-semibold">Client Portal URL</h6>
          <p className="text-muted small mb-2">
            Quick link to the deployed client portal (constructed from Client ID).
          </p>
          {clientId.trim() ? (
            <a href={`https://${clientId.trim()}.numa.arcanum.ai`} target="_blank" rel="noreferrer">
              https://{clientId.trim()}.numa.arcanum.ai
            </a>
          ) : (
            <span className="text-muted small">Enter a Client ID above to show the link</span>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
