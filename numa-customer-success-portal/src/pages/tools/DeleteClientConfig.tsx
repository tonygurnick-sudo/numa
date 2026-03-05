import { useEffect, useState } from 'react';
import { Card, Form, Button, Alert, Spinner, Modal } from 'react-bootstrap';
import { ClientSelectGroup } from '@/components/ClientSelectGroup';
import { clientService } from '@/services/clientService';
import { Client } from '@/types';

export default function DeleteClientConfig() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientName, setSelectedClientName] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await clientService.getAllClients();
        setClients(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients');
      }
    })();
  }, []);

  const handleDeleteClick = () => {
    setError(null);
    setSuccess(null);
    if (!selectedClientName) {
      setError('Please select a client to delete');
      return;
    }
    setShowConfirmModal(true);
  };

  const confirmDelete = async () => {
    try {
      setWorking(true);
      await clientService.deleteClientConfig(selectedClientName);
      setSuccess(`Configuration for ${selectedClientName} has been deleted successfully`);
      setSelectedClientName('');
      setShowConfirmModal(false);

      // Refresh client list
      const list = await clientService.getAllClients();
      setClients(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete configuration');
    } finally {
      setWorking(false);
    }
  };

  const selectedClient = clients.find((c) => c.name === selectedClientName);

  return (
    <div>
      <Card className="border-0 shadow-sm">
        <Card.Header>
          <h5 className="mb-0">Delete Client Config</h5>
          <p className="text-muted small mb-0 mt-2">
            Permanently remove a client configuration from the system. This action cannot be undone and will only affect
            the configuration data, not deployed resources.
          </p>
        </Card.Header>
        <Card.Body>
          <Form>
            <Form.Group className="mb-4">
              <Form.Label className="fw-semibold">Select Client to Delete</Form.Label>
              <ClientSelectGroup value={selectedClientName} onChange={setSelectedClientName} clients={clients} />
              {selectedClient && (
                <div className="mt-2 p-3 bg-light rounded">
                  <div className="text-muted small">
                    <strong>Selected Configuration:</strong>
                  </div>
                  <div className="mt-1">
                    <strong>{selectedClient.name}</strong>
                  </div>
                  <div className="text-muted small">
                    Account: {selectedClient.config.clientAccountId} | Region: {selectedClient.config.region} | Type:{' '}
                    {selectedClient.config.devInstance ? 'Development' : 'Production'}
                  </div>
                </div>
              )}
            </Form.Group>

            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <div className="d-flex align-items-center gap-3">
              <Button
                variant="danger"
                onClick={handleDeleteClick}
                disabled={working || !selectedClientName}
                className="px-4"
              >
                {working ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    Deleting...
                  </>
                ) : (
                  'Delete Configuration'
                )}
              </Button>
              {selectedClientName && (
                <div className="text-muted small">
                  This will permanently remove the configuration for <strong>{selectedClientName}</strong>
                </div>
              )}
            </div>
          </Form>
        </Card.Body>
      </Card>

      {/* Confirmation Modal */}
      <Modal show={showConfirmModal} onHide={() => setShowConfirmModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="text-center">
            <div className="mb-3">
              <i className="bi bi-exclamation-triangle text-warning" style={{ fontSize: '3rem' }}></i>
            </div>
            <h6>Are you sure you want to delete this configuration?</h6>
            <p className="text-muted mb-0">
              This will permanently remove the configuration for <strong>{selectedClientName}</strong>. This action
              cannot be undone.
            </p>
            {selectedClient && (
              <div className="mt-3 p-2 bg-light rounded small">
                <div>
                  <strong>Client:</strong> {selectedClient.name}
                </div>
                <div>
                  <strong>Account:</strong> {selectedClient.config.clientAccountId}
                </div>
                <div>
                  <strong>Region:</strong> {selectedClient.config.region}
                </div>
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowConfirmModal(false)} disabled={working}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={working}>
            {working ? (
              <>
                <Spinner size="sm" className="me-2" />
                Deleting...
              </>
            ) : (
              'Yes, Delete Configuration'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
