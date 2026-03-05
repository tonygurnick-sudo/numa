import { Form } from 'react-bootstrap';
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
  const { devClients, productionClients } = groupClientsByType(clients);

  const renderClientOption = (client: Client) => {
    const count =
      showCounts && deploymentCounts[client.name] !== undefined ? ` (${deploymentCounts[client.name]})` : '';
    return (
      <option key={client.name} value={client.name}>
        {client.name}
        {count}
      </option>
    );
  };

  return (
    <Form.Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      size={size}
      className={className}
      style={style}
    >
      {/* Show all clients option if counts are provided */}
      {showCounts && <option value="all">All Clients ({clients.length})</option>}

      {/* Dev/Demo Stacks */}
      {devClients.length > 0 && (
        <>
          <optgroup label="Dev/Demo Stacks">{devClients.map(renderClientOption)}</optgroup>
        </>
      )}

      {/* Client Stacks */}
      {productionClients.length > 0 && (
        <>
          <optgroup label="Client Stacks">{productionClients.map(renderClientOption)}</optgroup>
        </>
      )}
    </Form.Select>
  );
}
