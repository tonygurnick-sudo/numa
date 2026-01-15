import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import { DataConnectorsService } from '../../Services/DataConnectorsService';
import type { DataConnectorStatus } from '../../types/dataConnectors';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { SynergyConnectorCard } from './SynergyConnectorCard';
import type { GlobalDataConnectorSettingsMap } from '../../Services/AdminDataConnectorsService';

type DataConnectorsTabProps = {
  adminSettings?: GlobalDataConnectorSettingsMap;
};

export const DataConnectorsTab = ({ adminSettings }: DataConnectorsTabProps) => {
  const { numaGet, numaPost } = useNumaRequest();
  const [statusItems, setStatusItems] = useState<DataConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<'connect' | 'settings' | 'test' | null>(null);
  const [server, setServer] = useState('');
  const [token, setToken] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const items = await DataConnectorsService.listStatus(numaGet);
      setStatusItems(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load data connectors.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnect = async (payload: { server: string; access_token: string }) => {
    try {
      setConnecting(true);
      setConnectError(null);
      setSuccess(null);
      const response = (await DataConnectorsService.connect(numaPost, {
        connector_id: 'synergy',
        config: payload,
      })) as { test_result?: { message?: string; jobs_found?: number | null } };
      const message =
        response?.test_result?.message ||
        (response?.test_result?.jobs_found !== null && response?.test_result?.jobs_found !== undefined
          ? `Connected successfully. Found ${response.test_result.jobs_found} jobs.`
          : 'Connected successfully.');
      setSuccess(message);
      setModalMode(null);
      setToken('');
      await loadStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to Synergy.';
      setConnectError(message);
    } finally {
      setConnecting(false);
    }
  };

  const synergyStatus = statusItems.find((item) => item.connector_id === 'synergy');
  const isConnected = synergyStatus?.status === 'connected';
  const adminDisabled = adminSettings?.synergy?.status === 'disabled';

  useEffect(() => {
    if (synergyStatus?.config?.server) setServer(synergyStatus.config.server);
  }, [synergyStatus?.config?.server]);

  const openModal = (mode: 'connect' | 'settings' | 'test') => {
    setConnectError(null);
    setSuccess(null);
    setModalMode(mode);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await handleConnect({
      server: server.trim(),
      access_token: token.trim(),
    });
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">Loading data connectors...</p>
      </div>
    );
  }

  return (
    <div>
      {loadError && (
        <Alert variant="danger" className="mb-3">
          {loadError}
        </Alert>
      )}
      {adminDisabled && (
        <Alert variant="info" className="mb-3">
          This data connector has been disabled by your administrator.
        </Alert>
      )}
      <div className="mb-4">
        <h4 className="text-primary mb-0 d-flex align-items-center">
          <i className="bi bi-grid-3x3-gap me-2"></i>
          <span>Available Data Connectors (1)</span>
        </h4>
      </div>
      <SynergyConnectorCard
        status={synergyStatus}
        onConnect={() => openModal('connect')}
        onTest={() => openModal('test')}
        onSettings={() => openModal('settings')}
        isConnecting={connecting}
        adminDisabled={adminDisabled}
      />

      <Modal show={!!modalMode} onHide={() => setModalMode(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {modalMode === 'connect' && 'Connect to Synergy'}
            {modalMode === 'settings' && 'Synergy Settings'}
            {modalMode === 'test' && 'Test Synergy Connection'}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSubmit}>
          <Modal.Body>
            {adminDisabled && (
              <Alert variant="warning" className="py-2">
                This connector is disabled by your administrator.
              </Alert>
            )}
            {connectError && (
              <Alert variant="danger" className="py-2">
                {connectError}
              </Alert>
            )}
            {success && (
              <Alert variant="success" className="py-2">
                {success}
              </Alert>
            )}
            <Row className="g-3">
              <Col md={12}>
                <Form.Group>
                  <Form.Label className="small fw-semibold">Server</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="https://synergy.myserver.com:8080"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={12}>
                <Form.Group>
                  <Form.Label className="small fw-semibold">Personal Access Token</Form.Label>
                  <Form.Control
                    type="password"
                    placeholder="Paste token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                  />
                </Form.Group>
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setModalMode(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={connecting || adminDisabled}>
              {connecting ? (
                <>
                  <Spinner size="sm" className="me-2" /> Saving...
                </>
              ) : (
                <>
                  <i className="bi bi-plug me-2"></i>
                  {modalMode === 'test' ? 'Test Connection' : isConnected ? 'Save Changes' : 'Connect'}
                </>
              )}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
};
