import { Card, Button, Badge } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { BarChart, Play } from 'react-bootstrap-icons'
import type { Tool } from '@/types/tools'

interface ToolCardProps {
  tool: Tool
  disabled?: boolean
}

export function ToolCard({ tool, disabled = false }: ToolCardProps) {
  const navigate = useNavigate()

  const getToolRoute = () => {
    switch (tool.id) {
      case 'usage-report':
        return '/tools/usage-report'
      case 'quota-report':
        return '/tools/quota-report'
      default:
        return '/'
    }
  }

  const handleRunTool = () => {
    navigate(getToolRoute())
  }

  const getIcon = () => {
    switch (tool.id) {
      case 'usage-report':
        return <BarChart className="me-2" />
      case 'quota-report':
        return <BarChart className="me-2" />
      default:
        return <Play className="me-2" />
    }
  }

  const getCategoryBadge = () => {
    const variants: Record<string, string> = {
      analytics: 'primary',
      management: 'secondary',
      maintenance: 'warning',
      deployment: 'info',
    }

    return (
      <Badge bg={variants[tool.category] || 'secondary'} className="mb-2">
        {tool.category}
      </Badge>
    )
  }

  return (
    <Card className="h-100 border-0 shadow-sm tool-card">
      <Card.Body className="p-4 d-flex flex-column">
        <div className="flex-grow-1">
          {getCategoryBadge()}
          <div className="d-flex align-items-center mb-2">
            {getIcon()}
            <h5 className="mb-0">{tool.name}</h5>
          </div>
          <p className="text-muted mb-3">{tool.description}</p>
        </div>

        <div className="mt-auto">
          <Button
            variant="primary"
            onClick={handleRunTool}
            disabled={disabled}
            className="w-100"
          >
            Run Tool
          </Button>
        </div>
      </Card.Body>
    </Card>
  )
}
