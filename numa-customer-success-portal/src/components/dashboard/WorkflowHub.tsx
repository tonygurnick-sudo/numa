import { Card, Row, Col, Button } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { ReactNode } from 'react'

interface WorkflowAction {
  label: string
  link?: string
  onClick?: () => void
  variant?: string
  icon?: ReactNode
}

interface WorkflowHubProps {
  title: string
  description: string
  icon: ReactNode
  primaryAction: WorkflowAction
  secondaryActions?: WorkflowAction[]
  stats?: {
    label: string
    value: string | number
  }[]
  gradient?: boolean
  color?: 'primary' | 'success' | 'info' | 'warning' | 'danger'
}

export function WorkflowHub({
  title,
  description,
  icon,
  primaryAction,
  secondaryActions = [],
  stats,
  gradient = true,
  color = 'primary'
}: WorkflowHubProps) {
  const getColorClasses = () => {
    const baseClasses = 'border-0 shadow-sm h-100'
    if (gradient) {
      return `${baseClasses} workflow-hub-${color}`
    }
    return baseClasses
  }

  return (
    <Card className={getColorClasses()}>
      <Card.Body className="p-4">
        {/* Header Section */}
        <div className="d-flex align-items-start justify-content-between mb-3">
          <div className="flex-grow-1">
            <div className="d-flex align-items-center mb-2">
              <div className={`text-${color} me-2`} style={{ fontSize: '1.5rem' }}>
                {icon}
              </div>
              <h5 className="mb-0 fw-semibold">{title}</h5>
            </div>
            <p className="text-muted mb-0 small">
              {description}
            </p>
          </div>
        </div>

        {/* Stats Section */}
        {stats && stats.length > 0 && (
          <Row className="g-3 mb-3">
            {stats.map((stat, index) => (
              <Col xs={6} key={index}>
                <div className="text-center p-2 bg-light rounded">
                  <div className="fw-bold text-dark">{stat.value}</div>
                  <div className="small text-muted">{stat.label}</div>
                </div>
              </Col>
            ))}
          </Row>
        )}

        {/* Actions Section */}
        <div className="d-grid gap-2">
          <Button
            as={Link}
            to={primaryAction.link}
            variant={primaryAction.variant || color}
            className="d-flex align-items-center justify-content-center"
          >
            {primaryAction.icon && (
              <span className="me-2">{primaryAction.icon}</span>
            )}
            {primaryAction.label}
          </Button>

          {secondaryActions.length > 0 && (
            <div className="d-flex gap-2">
              {secondaryActions.map((action, index) => (
                action.link ? (
                  <Button
                    key={index}
                    as={Link}
                    to={action.link}
                    variant={action.variant || 'outline-secondary'}
                    size="sm"
                    className="flex-fill d-flex align-items-center justify-content-center"
                  >
                    {action.icon && (
                      <span className="me-1">{action.icon}</span>
                    )}
                    {action.label}
                  </Button>
                ) : (
                  <Button
                    key={index}
                    onClick={action.onClick}
                    variant={action.variant || 'outline-secondary'}
                    size="sm"
                    className="flex-fill d-flex align-items-center justify-content-center"
                  >
                    {action.icon && (
                      <span className="me-1">{action.icon}</span>
                    )}
                    {action.label}
                  </Button>
                )
              ))}
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  )
}

export default WorkflowHub
