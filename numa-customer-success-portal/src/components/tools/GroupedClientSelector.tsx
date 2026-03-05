import { Form, Badge, Button } from 'react-bootstrap';
import { X } from 'react-bootstrap-icons';
import { groupClientsByType } from '@/services/clientService';
import type { Client } from '@/types';

interface GroupedClientSelectorProps {
  clients: Client[];
  selectedClientNames: string[];
  onClientToggle: (clientName: string) => void;
  onSelectClients: (clientNames: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * A reusable component for selecting clients with grouping by type
 * (Internal/Dev accounts vs Production/Client accounts)
 *
 * Allows bulk selection via checkboxes while still permitting
 * individual client selection/deselection at any time.
 */
export function GroupedClientSelector({
  clients,
  selectedClientNames,
  onClientToggle,
  onSelectClients,
  disabled = false,
  loading = false,
}: GroupedClientSelectorProps) {
  const { devClients, productionClients } = groupClientsByType(clients);

  const allInternalSelected = devClients.length > 0 && devClients.every((c) => selectedClientNames.includes(c.name));
  const someInternalSelected = devClients.some((c) => selectedClientNames.includes(c.name));

  const allClientsSelected =
    productionClients.length > 0 && productionClients.every((c) => selectedClientNames.includes(c.name));
  const someClientsSelected = productionClients.some((c) => selectedClientNames.includes(c.name));

  const allSelected = clients.length > 0 && clients.every((c) => selectedClientNames.includes(c.name));

  const handleSelectAllToggle = () => {
    if (allSelected) {
      onSelectClients([]);
    } else {
      onSelectClients(clients.map((c) => c.name));
    }
  };

  const handleInternalToggle = () => {
    if (allInternalSelected) {
      // Remove all internal clients from selection
      const internalNames = new Set(devClients.map((c) => c.name));
      onSelectClients(selectedClientNames.filter((name) => !internalNames.has(name)));
    } else {
      // Add all internal clients to selection
      const newSelection = new Set(selectedClientNames);
      devClients.forEach((c) => newSelection.add(c.name));
      onSelectClients(Array.from(newSelection));
    }
  };

  const handleClientsToggle = () => {
    if (allClientsSelected) {
      // Remove all client accounts from selection
      const clientNames = new Set(productionClients.map((c) => c.name));
      onSelectClients(selectedClientNames.filter((name) => !clientNames.has(name)));
    } else {
      // Add all client accounts to selection
      const newSelection = new Set(selectedClientNames);
      productionClients.forEach((c) => newSelection.add(c.name));
      onSelectClients(Array.from(newSelection));
    }
  };

  const handleUnselectAll = () => {
    onSelectClients([]);
  };

  // Determine indeterminate state for checkboxes
  const isInternalIndeterminate = someInternalSelected && !allInternalSelected;
  const isClientsIndeterminate = someClientsSelected && !allClientsSelected;

  return (
    <div>
      {/* Quick Selection Checkboxes */}
      <div className="mb-2 p-2 bg-light rounded">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <Form.Check
              type="checkbox"
              id="select-all-clients"
              label={<strong>Select All Clients ({clients.length})</strong>}
              checked={allSelected}
              onChange={handleSelectAllToggle}
              disabled={disabled || loading}
              className="mb-1"
            />
            <div className="ms-4">
              <Form.Check
                type="checkbox"
                id="select-all-internal"
                ref={(el: HTMLInputElement | null) => {
                  if (el) el.indeterminate = isInternalIndeterminate;
                }}
                label={
                  <span>
                    Internal / Dev Accounts{' '}
                    <Badge bg="warning" text="dark" className="ms-1">
                      {devClients.length}
                    </Badge>
                  </span>
                }
                checked={allInternalSelected}
                onChange={handleInternalToggle}
                disabled={disabled || loading || devClients.length === 0}
                className="mb-1"
              />
              <Form.Check
                type="checkbox"
                id="select-all-production"
                ref={(el: HTMLInputElement | null) => {
                  if (el) el.indeterminate = isClientsIndeterminate;
                }}
                label={
                  <span>
                    Client Accounts{' '}
                    <Badge bg="success" className="ms-1">
                      {productionClients.length}
                    </Badge>
                  </span>
                }
                checked={allClientsSelected}
                onChange={handleClientsToggle}
                disabled={disabled || loading || productionClients.length === 0}
              />
            </div>
          </div>
          {selectedClientNames.length > 0 && (
            <Button size="sm" variant="outline-secondary" onClick={handleUnselectAll} disabled={disabled || loading}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Individual Client Selection - Always visible */}
      <div className="border rounded p-2" style={{ maxHeight: '250px', overflowY: 'auto' }}>
        {/* Internal/Dev Clients Section */}
        {devClients.length > 0 && (
          <div className="mb-3">
            <div className="text-muted small mb-1 d-flex align-items-center">
              <Badge bg="warning" text="dark" className="me-1">
                Internal
              </Badge>
              Dev / Test Accounts
            </div>
            {devClients.map((client) => (
              <Form.Check
                key={client.name}
                type="checkbox"
                id={`client-${client.name}`}
                label={client.name}
                checked={selectedClientNames.includes(client.name)}
                onChange={() => onClientToggle(client.name)}
                disabled={disabled || loading}
                className="ms-2"
              />
            ))}
          </div>
        )}

        {/* Production/Client Accounts Section */}
        {productionClients.length > 0 && (
          <div>
            <div className="text-muted small mb-1 d-flex align-items-center">
              <Badge bg="success" className="me-1">
                Client
              </Badge>
              Production Accounts
            </div>
            {productionClients.map((client) => (
              <Form.Check
                key={client.name}
                type="checkbox"
                id={`client-${client.name}`}
                label={client.name}
                checked={selectedClientNames.includes(client.name)}
                onChange={() => onClientToggle(client.name)}
                disabled={disabled || loading}
                className="ms-2"
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected Client Badges */}
      {selectedClientNames.length > 0 && (
        <div className="mt-2 d-flex flex-wrap gap-1">
          {selectedClientNames.slice(0, 5).map((name) => {
            const isInternal = devClients.some((c) => c.name === name);
            return (
              <Badge
                key={name}
                bg={isInternal ? 'warning' : 'success'}
                text={isInternal ? 'dark' : undefined}
                className="d-flex align-items-center"
                style={{ cursor: 'pointer' }}
                onClick={() => !disabled && !loading && onClientToggle(name)}
              >
                {name}
                <X className="ms-1" size={12} />
              </Badge>
            );
          })}
          {selectedClientNames.length > 5 && <Badge bg="secondary">+{selectedClientNames.length - 5} more</Badge>}
        </div>
      )}

      <Form.Text className="text-muted">Select individual clients or use group checkboxes above</Form.Text>
    </div>
  );
}
