import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Card, Col, Form, InputGroup, Row, Spinner, Table } from 'react-bootstrap'
import { Search, FileEarmarkText } from 'react-bootstrap-icons'
import { Client } from '@/types'
import { clientService } from '@/services/clientService'

export default function Configs() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Client | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await clientService.getAllClients()
        setClients(data)
        if (data.length > 0) setSelected(data[0])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    if (!term) return clients
    return clients.filter(c => c.name.toLowerCase().includes(term))
  }, [search, clients])

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="mb-0 d-flex align-items-center">
          <FileEarmarkText className="me-2" />
          Client Configs
        </h2>
        <Badge bg="secondary">{clients.length}</Badge>
      </div>

      <Row>
        <Col xs={12} md={6} className="mb-3">
          <Card className="border shadow-sm">
            <Card.Header>
              <div className="d-flex align-items-center justify-content-between">
                <span className="fw-semibold">Clients</span>
                {loading && <Spinner size="sm" />}
              </div>
            </Card.Header>
            <Card.Body className="p-0">
              <div className="p-3 border-bottom">
                <InputGroup>
                  <InputGroup.Text>
                    <Search />
                  </InputGroup.Text>
                  <Form.Control
                    placeholder="Search clients..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </InputGroup>
              </div>

              {error && (
                <Alert variant="danger" className="m-3 mb-0">
                  {error}
                </Alert>
              )}

              <div style={{ height: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                <Table hover responsive className="mb-0 w-100">
                  <thead>
                    <tr>
                      <th style={{ width: '60%' }}>Client</th>
                      <th>Region</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!loading && filtered.length === 0 && (
                      <tr>
                        <td colSpan={2} className="text-center text-muted py-4">
                          No clients found
                        </td>
                      </tr>
                    )}
                    {filtered.map(c => (
                      <tr
                        key={c.name}
                        role="button"
                        onClick={() => setSelected(c)}
                        className={selected?.name === c.name ? 'table-primary' : ''}
                      >
                        <td className="fw-semibold text-truncate" title={c.name}>{c.name}</td>
                        <td>{c.config.region}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} md={6}>
          <Card className="border shadow-sm">
            <Card.Header>
              <div className="d-flex align-items-center justify-content-between">
                <span className="fw-semibold">Configuration JSON</span>
                {selected && (
                  <code className="small text-muted">{selected.name}</code>
                )}
              </div>
            </Card.Header>
            <Card.Body>
              {selected ? (
                <pre className="bg-light p-3 rounded" style={{ height: 'calc(100vh - 280px)', overflow: 'auto' }}>
{JSON.stringify(selected.config, null, 2)}
                </pre>
              ) : (
                <div className="text-muted">Select a client to view its configuration.</div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
