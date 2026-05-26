import { useMemo, useState } from 'react';
import { Badge, Button, Form, InputGroup } from 'react-bootstrap';
import { Search, X } from 'react-bootstrap-icons';
import { Client } from '@/types';
import { groupClientsByType } from '@/services/clientService';

interface ClientSelectGroupProps {
  value: string;
  onChange: (value: string) => void;
  clients: Client[];
  disabled?: boolean;
  showCounts?: boolean;
  deploymentCounts?: Record<string, number>;
  size?: 'sm' | 'lg';
  className?: string;
  style?: React.CSSProperties;
}

export function ClientSelectGroup({
  value,
  onChange,
  clients,
  disabled = false,
  showCounts = false,
  deploymentCounts = {},
  size,
  className,
  style,
}: ClientSelectGroupProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDev, setShowDev] = useState(true);
  const [showProd, setShowProd] = useState(true);

  const { devClients, productionClients } = groupClientsByType(clients);

  const lowerSearch = searchTerm.toLowerCase();
  const applySearch = (list: Client[]) =>
    searchTerm ? list.filter((c) => c.name.toLowerCase().includes(lowerSearch)) : list;

  const filteredDev = showDev ? applySearch(devClients) : [];
  const filteredProd = showProd ? applySearch(productionClients) : [];
  const hasResults = filteredDev.length > 0 || filteredProd.length > 0;

  const isDevSelected = useMemo(() => devClients.some((c) => c.name === value), [devClients, value]);

  const listHeight = size === 'sm' ? 180 : 240;

  const renderClientRow = (client: Client) => {
    const selected = value === client.name;
    const count =
      showCounts && deploymentCounts[client.name] !== undefined ? ` (${deploymentCounts[client.name]})` : '';
    return (
      <div
        key={client.name}
        role="button"
        aria-pressed={selected}
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) onChange(client.name);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onChange(client.name);
          }
        }}
        className={`ms-2 px-2 py-1 rounded d-flex align-items-center ${selected ? 'bg-primary text-white' : ''}`}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: size === 'sm' ? '0.875rem' : undefined,
          userSelect: 'none',
        }}
      >
        <span className="text-truncate">
          {client.name}
          {count}
        </span>
      </div>
    );
  };

  return (
    <div className={className} style={style}>
      {/* Group Filters */}
      <div className="mb-2 p-2 bg-light rounded d-flex flex-wrap gap-3 align-items-center">
        <Form.Check
          type="checkbox"
          id="client-picker-filter-dev"
          checked={showDev}
          onChange={(e) => setShowDev(e.currentTarget.checked)}
          disabled={disabled || devClients.length === 0}
          label={
            <span>
              Internal / Dev{' '}
              <Badge bg="warning" text="dark" className="ms-1">
                {devClients.length}
              </Badge>
            </span>
          }
        />
        <Form.Check
          type="checkbox"
          id="client-picker-filter-prod"
          checked={showProd}
          onChange={(e) => setShowProd(e.currentTarget.checked)}
          disabled={disabled || productionClients.length === 0}
          label={
            <span>
              Client Accounts{' '}
              <Badge bg="success" className="ms-1">
                {productionClients.length}
              </Badge>
            </span>
          }
        />
      </div>

      {/* Search */}
      <InputGroup size="sm" className="mb-2">
        <InputGroup.Text>
          <Search size={14} />
        </InputGroup.Text>
        <Form.Control
          type="text"
          placeholder="Search clients..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={disabled}
        />
        {searchTerm && (
          <Button variant="outline-secondary" onClick={() => setSearchTerm('')} disabled={disabled}>
            <X size={14} />
          </Button>
        )}
      </InputGroup>

      {/* Client List */}
      <div className="client-picker-list border rounded p-2" style={{ height: listHeight, overflowY: 'scroll' }}>
        {filteredDev.length > 0 && (
          <div className="mb-2">
            <div className="text-muted small mb-1 d-flex align-items-center">
              <Badge bg="warning" text="dark" className="me-1">
                Internal
              </Badge>
              Dev / Test Accounts
            </div>
            {filteredDev.map(renderClientRow)}
          </div>
        )}

        {filteredProd.length > 0 && (
          <div>
            <div className="text-muted small mb-1 d-flex align-items-center">
              <Badge bg="success" className="me-1">
                Client
              </Badge>
              Production Accounts
            </div>
            {filteredProd.map(renderClientRow)}
          </div>
        )}

        {!hasResults && (
          <div className="text-muted text-center py-2 small">
            {!showDev && !showProd
              ? 'Select at least one group to show clients'
              : searchTerm
                ? `No clients matching "${searchTerm}"`
                : 'No clients to show'}
          </div>
        )}
      </div>

      {/* Selected indicator — "selected" is a brand state, not a status, so
       * we use the primary purple pill regardless of dev/prod. The dev/prod
       * distinction is already conveyed by the orange Internal badge inline
       * with the client name in the picker list. */}
      {value && (
        <div className="mt-2 d-flex align-items-center gap-2">
          <span className="text-muted small">Selected:</span>
          <Badge
            bg="primary"
            className="d-flex align-items-center"
            style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            onClick={() => !disabled && onChange('')}
            title="Click to clear"
          >
            {value}
            {isDevSelected && <span className="ms-1 opacity-75">· dev</span>}
            <X className="ms-1" size={12} />
          </Badge>
        </div>
      )}
    </div>
  );
}
