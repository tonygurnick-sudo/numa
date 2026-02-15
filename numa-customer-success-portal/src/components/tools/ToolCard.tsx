import { Card, Button, Badge } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { BarChart, Play, Search, People } from 'react-bootstrap-icons'
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
      case 'config-search':
        return '/tools/config-search'
      case 'all-users-report':
        return '/tools/all-users-report'
      case 'setup-nextgen-client':
        return '/tools/setup-nextgen-client'
      case 'setup-non-nextgen-client':
        return '/tools/setup-non-nextgen-client'
      case 'create-client-config':
        return '/tools/create-client-config'
      case 'update-client-config':
        return '/tools/update-client-config'
      case 'delete-client-config':
        return '/tools/delete-client-config'
      case 'get-system-user-secret':
        return '/tools/get-system-user-secret'
      case 'bulk-update-client-config':
        return '/tools/bulk-update-client-config'
      case 'support-docs-manager':
        return '/tools/support-docs-manager'
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
      case 'config-search':
        return <Search className="me-2" />
      case 'all-users-report':
        return <People className="me-2" />
      case 'setup-nextgen-client':
        return <Play className="me-2" />
      case 'setup-non-nextgen-client':
        return <Play className="me-2" />
      case 'create-client-config':
      case 'update-client-config':
      case 'delete-client-config':
      case 'get-system-user-secret':
      case 'bulk-update-client-config':
      case 'support-docs-manager':
        return <Play className="me-2" />
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
