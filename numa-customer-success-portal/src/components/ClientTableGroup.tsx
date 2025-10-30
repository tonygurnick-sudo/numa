import { Table } from 'react-bootstrap'
import { Client } from '@/types'
import { groupClientsByType } from '@/services/clientService'

interface ClientTableGroupProps {
  clients: Client[]
  selectedClient?: Client
  onSelectClient?: (client: Client) => void
  searchTerm?: string
}

export function ClientTableGroup({
  clients,
  selectedClient,
  onSelectClient,
  searchTerm = ''
}: ClientTableGroupProps) {
  // Filter clients by search term if provided
  const filteredClients = searchTerm
    ? clients.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : clients

  const { devClients, productionClients } = groupClientsByType(filteredClients)

  const renderClientRow = (client: Client) => (
    <tr
      key={client.name}
      role="button"
      onClick={() => onSelectClient?.(client)}
      className={selectedClient?.name === client.name ? 'table-primary' : ''}
    >
      <td className="fw-semibold text-truncate" title={client.name}>
        {client.name}
      </td>
      <td>{client.config.region}</td>
    </tr>
  )

  const renderSectionHeader = (title: string) => (
    <tr style={{ backgroundColor: 'var(--bs-primary-bg-subtle)' }}>
      <td colSpan={2} className="fw-bold py-2 px-3" style={{ color: 'var(--arcanum-purple)' }}>
        {title}
      </td>
    </tr>
  )

  const hasResults = devClients.length > 0 || productionClients.length > 0

  return (
    <Table hover responsive className="mb-0 w-100">
      <thead>
        <tr>
          <th style={{ width: '60%' }}>Client</th>
          <th>Region</th>
        </tr>
      </thead>
      <tbody>
        {!hasResults && (
          <tr>
            <td colSpan={2} className="text-center text-muted py-4">
              No clients found
            </td>
          </tr>
        )}

        {/* Dev/Demo Stacks Section */}
        {devClients.length > 0 && (
          <>
            {renderSectionHeader('Dev/Demo Stacks')}
            {devClients.map(renderClientRow)}
          </>
        )}

        {/* Client Stacks Section */}
        {productionClients.length > 0 && (
          <>
            {renderSectionHeader('Client Stacks')}
            {productionClients.map(renderClientRow)}
          </>
        )}
      </tbody>
    </Table>
  )
}
