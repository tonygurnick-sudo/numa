import { useState } from 'react'
import { Card, Form, Button, Row, Col, Alert, Spinner, InputGroup } from 'react-bootstrap'
import { nextgenBrokerService } from '@/services/nextgenBrokerService'

export default function SetupNonNextgenClient() {
  const [accountId, setAccountId] = useState('')
  const [clientId, setClientId] = useState('')
  const [roleName, setRoleName] = useState('ArcanumAIAccess')
  const [checking, setChecking] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [region, setRegion] = useState('us-east-1')
  const [secretName, setSecretName] = useState('')
  const [fetching, setFetching] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [secretUser, setSecretUser] = useState<string | null>(null)
  const [secretPass, setSecretPass] = useState<string | null>(null)

  const precheck = async () => {
    setOkMsg(null)
    setErrMsg(null)
    try {
      setChecking(true)
      const res = await nextgenBrokerService.precheckAssumeClientRole(accountId.trim(), roleName.trim())
      setOkMsg(`Assumed ${res.assumedRoleArn}`)
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Pre-check failed')
    } finally {
      setChecking(false)
    }
  }

  const onRetrieve = async () => {
    setErrMsg(null)
    setSecret(null)
    setSecretUser(null)
    setSecretPass(null)
    try {
      setFetching(true)
      const roleArn = `arn:aws:iam::${accountId.trim()}:role/${roleName.trim() || 'ArcanumAIAccess'}`
      const res = await nextgenBrokerService.getSystemUserSecret(accountId.trim(), secretName.trim() || undefined, region, roleArn)
      const raw = res.secretString || ''
      setSecret(raw)
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setSecretUser(parsed.username || parsed.user || null)
          setSecretPass(parsed.password || parsed.pass || null)
        }
      } catch {}
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to retrieve secret')
    } finally {
      setFetching(false)
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header>
        <h5 className="mb-0">Setup Non‑NextGen Client</h5>
        <p className="text-muted small mb-0 mt-2">
          Verify cross-account role/trust, then create/update client config and deploy via SFN. Retrieve system user password if present.
        </p>
      </Card.Header>
      <Card.Body>
        {/* Pre-checks */}
        <Row className="mb-4">
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">AWS Account ID</Form.Label>
              <Form.Control value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="12-digit account id" />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">Role Name</Form.Label>
              <Form.Control value={roleName} onChange={e => setRoleName(e.target.value)} />
              <Form.Text className="text-muted">Default: ArcanumAIAccess</Form.Text>
            </Form.Group>
          </Col>
        </Row>
        <Row className="mb-4">
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">Client ID</Form.Label>
              <Form.Control value={clientId} onChange={e => setClientId(e.target.value)} placeholder="e.g. arcanum-demo" />
              <Form.Text className="text-muted">Used to form the client portal URL</Form.Text>
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex align-items-center gap-2 mb-2">
          <Button variant="primary" onClick={precheck} disabled={!accountId || !roleName || checking}>
            {checking ? (<><Spinner size="sm" className="me-2"/>Checking…</>) : 'Run Pre‑checks'}
          </Button>
          {okMsg && <span className="text-success">{okMsg}</span>}
        </div>
        {errMsg && <Alert variant="danger" className="mt-2">{errMsg}</Alert>}

        {/* Next actions */}
        <div className="mt-4">
          <h6 className="fw-semibold">Next Steps</h6>
          <div className="d-flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                const url = `/tools/create-client-config?accountId=${encodeURIComponent(accountId.trim())}`
                window.open(url, '_blank', 'noreferrer')
              }}
            >
              Open Create Config (new tab)
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const url = '/tools/update-client-config'
                window.open(url, '_blank', 'noreferrer')
              }}
            >
              Open Update Config (new tab)
            </Button>
            <Button
              variant="primary"
              onClick={() => window.open('/deployments', '_blank', 'noreferrer')}
            >
              Open Deployments (new tab)
            </Button>
          </div>
        </div>

        {/* Client URL */}
        <div className="mt-4">
          <h6 className="fw-semibold">Client Portal URL</h6>
          {clientId.trim() ? (
            <a href={`https://${clientId.trim()}.numa.arcanum.ai`} target="_blank" rel="noreferrer">
              https://{clientId.trim()}.numa.arcanum.ai
            </a>
          ) : (
            <span className="text-muted small">Enter a Client ID to show the link</span>
          )}
        </div>

        {/* Retrieve Secret */}
        <div className="mt-4">
          <h6 className="fw-semibold">Retrieve System User Password</h6>
          <Row className="mb-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label className="fw-semibold">Region</Form.Label>
                <Form.Select value={region} onChange={e => setRegion(e.target.value)}>
                  <option value="us-east-1">US East (N. Virginia) us-east-1</option>
                  <option value="ap-southeast-2">Asia Pacific (Sydney) ap-southeast-2</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label className="fw-semibold">Secret Name (optional)</Form.Label>
                <Form.Control value={secretName} onChange={e => setSecretName(e.target.value)} placeholder="e.g. clientid-system-user-password" />
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Button variant="primary" onClick={onRetrieve} disabled={!accountId || fetching}>
              {fetching ? (<><Spinner size="sm" className="me-2"/>Fetching…</>) : 'Retrieve Secret'}
            </Button>
            {(secretUser || secretPass) && (
              <>
                {!!secretUser && <span className="text-muted small">user:</span>}
                {!!secretUser && <code className="bg-light px-2 py-1 rounded">{secretUser}</code>}
                {!!secretPass && <span className="text-muted small ms-2">password:</span>}
                {!!secretPass && <code className="bg-light px-2 py-1 rounded">{secretPass}</code>}
              </>
            )}
            {!secretUser && !secretPass && secret && (
              <InputGroup style={{ maxWidth: 520 }}>
                <Form.Control readOnly value={secret} />
                <Button variant="outline-secondary" onClick={() => navigator.clipboard.writeText(secret!)}>Copy</Button>
              </InputGroup>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  )
}
