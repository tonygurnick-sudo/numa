import { useEffect, useState } from 'react';
import { Card, Form, Button, Row, Col, Alert, Spinner, InputGroup } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { nextgenBrokerService } from '@/services/nextgenBrokerService';
import { clientService } from '@/services/clientService';
import type { Client } from '@/types';
import { ClientSelectGroup } from '@/components/ClientSelectGroup';

export default function GetSystemUserSecret() {
  const [searchParams] = useSearchParams();
  // Client selection and derived fields
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientName, setSelectedClientName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [secretName, setSecretName] = useState('');
  const [secretNameDirty, setSecretNameDirty] = useState(false);
  const [autoSecretName, setAutoSecretName] = useState<string | null>(null);
  const [region, setRegion] = useState('us-east-1');
  // Fetching + result
  const [fetching, setFetching] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [secretUser, setSecretUser] = useState<string | null>(null);
  const [secretPass, setSecretPass] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const qAccount = (searchParams.get('accountId') || '').trim();
    const qSecret = (searchParams.get('secretName') || '').trim();
    const qClient = (searchParams.get('clientName') || '').trim();
    if (qAccount) setAccountId(qAccount);
    if (qSecret) {
      setSecretName(qSecret);
      setSecretNameDirty(true);
      setAutoSecretName(null);
    }
    if (qClient) setSelectedClientName(qClient);
    // Load clients list
    (async () => {
      try {
        const list = await clientService.getAllClients();
        setClients(list);
        // If clientName was provided, derive fields
        if (qClient) {
          const c = list.find((x) => x.name === qClient);
          if (c) {
            setRegion(c.config.region || 'us-east-1');
            setAccountId(c.config.clientAccountId || '');
            if (!qSecret) {
              const defName = `${c.name}-system-user-password`;
              setSecretName(defName);
              setAutoSecretName(defName);
              setSecretNameDirty(false);
            }
          }
        }
      } catch {
        // non-fatal; manual entry still works
      }
    })();
  }, []);

  const canFetch = accountId.trim().length === 12;

  const onSelectClient = (name: string) => {
    setSelectedClientName(name);
    const c = clients.find((x) => x.name === name);
    if (!c) return;
    setAccountId(c.config.clientAccountId || '');
    setRegion(c.config.region || 'us-east-1');
    // Set default secret if user hasn't typed, or if the current value equals the last auto value
    const defName = `${c.name}-system-user-password`;
    if (!secretNameDirty || secretName === autoSecretName) {
      setSecretName(defName);
      setAutoSecretName(defName);
      setSecretNameDirty(false);
    } else {
      // Keep the user's custom value
      setAutoSecretName(null);
    }
  };

  const onSecretNameChange = (value: string) => {
    setSecretName(value);
    if (value.trim().length === 0) {
      // Clearing means revert to non-dirty; next client select will re-default
      setSecretNameDirty(false);
      setAutoSecretName(null);
    } else {
      setSecretNameDirty(true);
      setAutoSecretName(null);
    }
  };

  const onFetch = async () => {
    setErr(null);
    setSecret(null);
    setSecretUser(null);
    setSecretPass(null);
    try {
      setFetching(true);
      const res = await nextgenBrokerService.getSystemUserSecret(
        accountId.trim(),
        secretName.trim() || undefined,
        region
      );
      const raw = res.secretString || '';
      setSecret(raw);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setSecretUser(parsed.username || parsed.user || null);
          setSecretPass(parsed.password || parsed.pass || null);
        }
      } catch {}
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to retrieve secret');
    } finally {
      setFetching(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header>
        <h5 className="mb-0">Retrieve System User Secret</h5>
        <p className="text-muted small mb-0 mt-2">
          Fetch the system user password/secret for a client account via the NextGen broker.
        </p>
      </Card.Header>
      <Card.Body>
        {/* Client selection (optional) */}
        <Form.Group className="mb-4">
          <Form.Label className="fw-semibold">Select Client (optional)</Form.Label>
          <ClientSelectGroup value={selectedClientName} onChange={onSelectClient} clients={clients} />
          {selectedClientName && (
            <Form.Text className="text-muted">
              Account: {accountId || '—'} | Region: {region}
            </Form.Text>
          )}
        </Form.Group>
        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">AWS Account ID</Form.Label>
              <Form.Control
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="12-digit account id"
              />
              <Form.Text className="text-muted">Client account ID</Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">Secret Name (optional)</Form.Label>
              <Form.Control
                value={secretName}
                onChange={(e) => onSecretNameChange(e.target.value)}
                placeholder="e.g. numa-system-user-password"
              />
              <Form.Text className="text-muted">Leave blank to use default</Form.Text>
            </Form.Group>
          </Col>
        </Row>
        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label className="fw-semibold">Region</Form.Label>
              <Form.Select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="us-east-1">US East (N. Virginia) us-east-1</option>
                <option value="ap-southeast-2">Asia Pacific (Sydney) ap-southeast-2</option>
              </Form.Select>
              <Form.Text className="text-muted">Region where the secret is stored</Form.Text>
            </Form.Group>
          </Col>
        </Row>

        <div className="d-flex align-items-center gap-2 mb-3">
          <Button onClick={onFetch} disabled={!canFetch || fetching}>
            {fetching ? (
              <>
                <Spinner size="sm" className="me-2" />
                Fetching…
              </>
            ) : (
              'Retrieve Secret'
            )}
          </Button>
          {(secretUser || secretPass) && (
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {!!secretUser && <span className="text-muted small">user:</span>}
              {!!secretUser && <code className="bg-light px-2 py-1 rounded">{secretUser}</code>}
              {!!secretPass && <span className="text-muted small ms-2">password:</span>}
              {!!secretPass && <code className="bg-light px-2 py-1 rounded">{secretPass}</code>}
            </div>
          )}
          {!secretUser && !secretPass && secret && (
            <InputGroup style={{ maxWidth: 520 }}>
              <Form.Control readOnly value={secret} />
              <Button variant="outline-secondary" onClick={() => navigator.clipboard.writeText(secret)}>
                Copy
              </Button>
            </InputGroup>
          )}
        </div>
        {err && (
          <Alert variant="danger" className="mt-2 mb-0">
            {err}
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
}
