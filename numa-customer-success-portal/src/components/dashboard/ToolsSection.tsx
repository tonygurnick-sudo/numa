import { Row, Col, Card } from 'react-bootstrap'
import { ToolCard } from '@/components/tools/ToolCard'
import type { Tool } from '@/types/tools'

interface ToolsSectionProps {
  tools: Tool[]
  disabled?: boolean
}

interface ToolCategory {
  id: string
  name: string
  description: string
  tools: Tool[]
  priority: number
}

export function ToolsSection({
  tools,
  disabled = false
}: ToolsSectionProps) {

  // Organize tools by category
  const categories: ToolCategory[] = [
    {
      id: 'client-management',
      name: 'Client Operations',
      description: 'Configuration and user management tools',
      tools: tools.filter(tool =>
        [
          'update-client-config',
          'delete-client-config',
          'create-client-config',
          'setup-nextgen-client',
          'setup-non-nextgen-client',
          'get-system-user-secret',
          'bulk-update-client-config',
          'support-docs-manager',
        ].includes(tool.id)
      ),
      priority: 1
    },
    {
      id: 'analytics',
      name: 'Analytics & Reports',
      description: 'System monitoring and usage analytics',
      tools: tools.filter(tool =>
        tool.category === 'analytics'
      ),
      priority: 2
    }
  ].filter(category => category.tools.length > 0)
    .sort((a, b) => a.priority - b.priority)

  const renderToolCategories = () => {
    const otherCategories = categories

    if (otherCategories.length === 0) return null

    return (
      <>
        <div className="d-flex align-items-center justify-content-between mb-4">
          <div>
            <h4 className="mb-1 fw-bold text-dark">All Tools</h4>
            <p className="text-muted mb-0">Complete toolkit for customer success operations</p>
          </div>
          <div className="text-muted small">
            {otherCategories.reduce((sum, cat) => sum + cat.tools.length, 0)} tools
          </div>
        </div>

        {otherCategories.map((category) => (
          <div key={category.id} className="mb-4">
            <Card className="border-0 bg-light">
              <Card.Body className="p-3">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div>
                    <h5 className="mb-1 fw-semibold text-primary">{category.name}</h5>
                    <p className="text-muted small mb-0">{category.description}</p>
                  </div>
                </div>

                <Row className="g-3">
                  {category.tools.map((tool) => (
                    <Col lg={4} md={6} key={tool.id}>
                      <ToolCard
                        tool={tool}
                        disabled={disabled}
                      />
                    </Col>
                  ))}
                </Row>
              </Card.Body>
            </Card>
          </div>
        ))}
      </>
    )
  }

  if (tools.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <Card.Body className="text-center py-4">
          <div className="text-muted">
            <div className="mb-2">No tools available</div>
            <small>Tools will appear here when services are configured</small>
          </div>
        </Card.Body>
      </Card>
    )
  }

  return (
    <div>
      {renderToolCategories()}
    </div>
  )
}

export default ToolsSection
