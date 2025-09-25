import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Row, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { BoxSeam, FileEarmarkText } from 'react-bootstrap-icons'
import { Client } from '@/types'
import { clientService } from '@/services/clientService'
import { ToolCard } from '@/components/tools/ToolCard'
import type { Tool } from '@/types/tools'

export default function Dashboard() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await clientService.getAllClients()
        setClients(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load clients')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Available tools
  const availableTools: Tool[] = [
    {
      id: 'usage-report',
      name: 'Usage Report Generator',
      description: 'Generate comprehensive usage analytics for clients including app runs, chat messages, and user activity summaries.',
      category: 'analytics',
      parameters: [
        {
          name: 'clientName',
          label: 'Client',
          type: 'select',
          required: true,
          description: 'Select the client to generate the report for',
        },
        {
          name: 'timePeriod',
          label: 'Time Period',
          type: 'select',
          required: true,
          defaultValue: 'current-year',
          description: 'Select the time period for the usage report',
        },
        {
          name: 'outputFormat',
          label: 'Output Format',
          type: 'select',
          required: true,
          defaultValue: 'csv',
          description: 'Choose between CSV files or single JSON file',
        },
      ],
    },
    {
      id: 'quota-report',
      name: 'Quota Report',
      description: 'Fetch Bedrock RPM quotas across client accounts and regions, download CSV, and view as a table.',
      category: 'analytics',
      parameters: [],
    },
  ]

  const total = clients.length
  const countByRegion = (regionCode: string) => clients.filter(c => (c.config.region || '').toLowerCase() === regionCode.toLowerCase()).length
  const countUSEast1 = countByRegion('us-east-1')
  const countSydney = countByRegion('ap-southeast-2')

  return (
    <div>
      {/* Top Stats Banner */}
      <Card className="border-0 shadow-sm mb-4">
        <Card.Body>
          <Row className="g-3">
            <Col sm={4} xs={12}>
              <div className="d-flex justify-content-between align-items-center p-3 bg-light rounded">
                <div>
                  <div className="text-muted small">Total Clients</div>
                  <div className="fs-4 fw-semibold">{loading ? <Spinner size="sm" /> : total}</div>
                </div>
                <Badge bg="primary">All</Badge>
              </div>
            </Col>
            <Col sm={4} xs={12}>
              <div className="d-flex justify-content-between align-items-center p-3 bg-light rounded">
                <div>
                  <div className="text-muted small">us-east-1</div>
                  <div className="fs-4 fw-semibold">{loading ? <Spinner size="sm" /> : countUSEast1}</div>
                </div>
                <Badge bg="secondary">US</Badge>
              </div>
            </Col>
            <Col sm={4} xs={12}>
              <div className="d-flex justify-content-between align-items-center p-3 bg-light rounded">
                <div>
                  <div className="text-muted small">ap-southeast-2</div>
                  <div className="fs-4 fw-semibold">{loading ? <Spinner size="sm" /> : countSydney}</div>
                </div>
                <Badge bg="secondary">Sydney</Badge>
              </div>
            </Col>
          </Row>
          {error && (
            <Alert variant="danger" className="mt-3 mb-0">{error}</Alert>
          )}
        </Card.Body>
      </Card>

      {/* Main Features */}
      <Row className="g-4 mb-4">
        <Col md={6}>
          <Card as={Link} to="/configs" className="h-100 border-0 shadow-sm text-decoration-none">
            <Card.Body className="p-4 d-flex flex-column justify-content-between">
              <div>
                <div className="d-flex align-items-center mb-2">
                  <FileEarmarkText className="me-2" />
                  <h5 className="mb-0">Client Configs</h5>
                </div>
                <div className="text-muted">Browse all client configurations in JSON</div>
              </div>
              <div className="mt-3">
                <Button variant="primary">Open</Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card as={Link} to="/containers" className="h-100 border-0 shadow-sm text-decoration-none">
            <Card.Body className="p-4 d-flex flex-column justify-content-between">
              <div>
                <div className="d-flex align-items-center mb-2">
                  <BoxSeam className="me-2" />
                  <h5 className="mb-0">Deployment Images</h5>
                </div>
                <div className="text-muted">View available ECR images for deployment</div>
              </div>
              <div className="mt-3">
                <Button variant="primary">Open</Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Tools Section */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h6 className="mb-0">Tools</h6>
        <span className="text-muted small">{availableTools.length} tool{availableTools.length !== 1 ? 's' : ''} available</span>
      </div>
      <Row className="g-4">
        {availableTools.map((tool) => (
          <Col md={4} key={tool.id}>
            <ToolCard
              tool={tool}
              disabled={loading}
            />
          </Col>
        ))}
      </Row>
    </div>
  )
}
