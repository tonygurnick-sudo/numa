import { useEffect, useState } from 'react'
import { Row, Col, Card, Form, Button, Badge, Spinner, Alert, ButtonGroup } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { Clock, Filter, Search, ArrowLeft, ArrowRight, Funnel } from 'react-bootstrap-icons'
import { activityService } from '@/services/activityService'
import { listAllRecentDeployments } from '@/services/deploymentService'
import { getConfigValue } from '@/services/configService'
import type { ActivityFilter, ActivitySummary } from '@/types/activity'

const ITEMS_PER_PAGE = 25

// Quick time range filters
const TIME_RANGES = [
  { label: '1 Hour', value: '1h', hours: 1 },
  { label: '1 Day', value: '1d', hours: 24 },
  { label: '1 Week', value: '1w', hours: 24 * 7 },
  { label: '1 Month', value: '1m', hours: 24 * 30 }
] as const

export default function Activity() {
  const [activities, setActivities] = useState<ActivitySummary[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedTimeRange, setSelectedTimeRange] = useState('1w')
  const deploymentsTable = getConfigValue('DEPLOYMENTS_TABLE')

  // Filter state with default 1 week range
  const [filters, setFilters] = useState<ActivityFilter>({
    limit: ITEMS_PER_PAGE,
    startTime: new Date(Date.now() - (24 * 7 * 60 * 60 * 1000)).toISOString(), // 1 week ago
  })

  const loadActivities = async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch both activity records and deployment records
      const [activityRecords, deploymentRecords] = await Promise.all([
        activityService.getRecentActivities({
          ...filters,
          limit: ITEMS_PER_PAGE
        }),
        deploymentsTable ? listAllRecentDeployments(100).catch(() => []) : Promise.resolve([])
      ])

      // Convert activity records to summaries
      const activitySummaries = activityRecords.map(activity =>
        activityService.convertToActivitySummary(activity)
      )

      // Convert deployments to activity summaries
      const deploymentActivities: ActivitySummary[] = deploymentRecords
        .map(deployment => {
          // Handle different timestamp field names from different interfaces
          const timestamp = (deployment as any).startTime ||
                          (deployment as any).startedAt ||
                          new Date().toISOString()

          return {
            id: `deployment-${deployment.deploymentId}`,
            type: 'deployment' as const,
            title: `Deployment to ${deployment.clientName}`,
            subtitle: `Image: ${deployment.imageTag || 'latest'}`,
            timestamp,
            status: deployment.status === 'success' ? 'success' :
                    deployment.status === 'running' || deployment.status === 'retrying' ? 'running' :
                    deployment.status === 'failed' ? 'failed' : 'warning',
            link: `/deployments/${deployment.deploymentId}/logs`,
            user: deployment.initiatedBy?.split('@')[0]
          }
        })

      // Apply time range filtering to deployment activities
      const filteredDeploymentActivities = deploymentActivities.filter(activity => {
        if (!filters.startTime) return true
        const activityTime = new Date(activity.timestamp)
        const filterStartTime = new Date(filters.startTime)
        const filterEndTime = filters.endTime ? new Date(filters.endTime) : new Date()
        return activityTime >= filterStartTime && activityTime <= filterEndTime
      })

      // Combine and sort all activities
      const allActivities = [...activitySummaries, ...filteredDeploymentActivities]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, ITEMS_PER_PAGE)

      setActivities(allActivities)
      setTotalItems(allActivities.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities')
      setActivities([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadActivities()
  }, [filters])

  const handleFilterChange = (key: keyof ActivityFilter, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }))
    setCurrentPage(1)
  }

  const handleTimeRangeChange = (rangeValue: string) => {
    setSelectedTimeRange(rangeValue)
    const range = TIME_RANGES.find(r => r.value === rangeValue)
    if (range) {
      const startTime = new Date(Date.now() - (range.hours * 60 * 60 * 1000)).toISOString()
      setFilters(prev => ({
        ...prev,
        startTime,
        endTime: undefined // Clear end time when using quick ranges
      }))
    }
    setCurrentPage(1)
  }

  const clearFilters = () => {
    setFilters({
      limit: ITEMS_PER_PAGE,
      startTime: new Date(Date.now() - (24 * 7 * 60 * 60 * 1000)).toISOString(), // Keep 1 week default
    })
    setSelectedTimeRange('1w')
    setCurrentPage(1)
  }

  const getActivityIcon = (type: string) => {
    const icons = {
      deployment: '🚀',
      config: '📄',
      user: '👤',
      system: '⚙️'
    }
    return icons[type as keyof typeof icons] || '📋'
  }

  const getStatusBadge = (status?: string) => {
    if (!status) return null

    const variants = {
      success: 'success',
      running: 'warning',
      failed: 'danger',
      warning: 'warning'
    }

    return (
      <Badge bg={variants[status as keyof typeof variants] || 'secondary'}>
        {status}
      </Badge>
    )
  }

  const formatDateTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date()
    const then = new Date(timestamp)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  if (error) {
    return (
      <div>
        <div className="d-flex align-items-center justify-content-between mb-4">
          <h1 className="h3 mb-0 d-flex align-items-center">
            <Clock className="me-2" />
            Activity Log
          </h1>
        </div>

        <Alert variant="danger">
          <strong>Error:</strong> {error}
          <div className="mt-2">
            <Button variant="outline-danger" size="sm" onClick={loadActivities}>
              Try Again
            </Button>
          </div>
        </Alert>
      </div>
    )
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-4">
        <h1 className="h3 mb-0 d-flex align-items-center">
          <Clock className="me-2" />
          Activity Log
        </h1>

        <div className="d-flex align-items-center gap-3">
          {/* Quick Time Range Filters */}
          <div className="d-flex align-items-center">
            <span className="small text-muted me-2">Quick filters:</span>
            <ButtonGroup size="sm">
              {TIME_RANGES.map((range) => (
                <Button
                  key={range.value}
                  variant={selectedTimeRange === range.value ? 'primary' : 'outline-primary'}
                  onClick={() => handleTimeRangeChange(range.value)}
                >
                  {range.label}
                </Button>
              ))}
            </ButtonGroup>
          </div>

          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="d-flex align-items-center"
          >
            <Funnel className="me-2" size={14} />
            Advanced
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <Card className="mb-4">
          <Card.Header>
            <h6 className="mb-0 d-flex align-items-center">
              <Filter className="me-2" size={16} />
              Filter Activities
            </h6>
          </Card.Header>
          <Card.Body>
            <Row>
              <Col md={3}>
                <Form.Group>
                  <Form.Label>Activity Type</Form.Label>
                  <Form.Select
                    value={filters.type || ''}
                    onChange={(e) => handleFilterChange('type', e.target.value || undefined)}
                  >
                    <option value="">All Types</option>
                    <option value="config">Configuration</option>
                    <option value="user">User Management</option>
                    <option value="deployment">Deployments</option>
                    <option value="system">System</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group>
                  <Form.Label>Start Date</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={filters.startTime ? new Date(filters.startTime).toISOString().slice(0, 16) : ''}
                    onChange={(e) => handleFilterChange('startTime', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
                  />
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group>
                  <Form.Label>End Date</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={filters.endTime ? new Date(filters.endTime).toISOString().slice(0, 16) : ''}
                    onChange={(e) => handleFilterChange('endTime', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
                  />
                </Form.Group>
              </Col>

              <Col md={3} className="d-flex align-items-end">
                <Button variant="outline-secondary" onClick={clearFilters} className="me-2">
                  Clear
                </Button>
                <Button variant="primary" onClick={loadActivities}>
                  <Search className="me-1" size={14} />
                  Apply
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>
      )}

      {/* Activities List */}
      <Card className="border-0 shadow-sm">
        <Card.Header className="bg-white d-flex justify-content-between align-items-center">
          <h6 className="mb-0">
            Recent Activities
            {totalItems > 0 && (
              <span className="text-muted ms-2">({totalItems} total)</span>
            )}
          </h6>
          {loading && (
            <Spinner animation="border" size="sm" />
          )}
        </Card.Header>

        <Card.Body className="p-0">
          {loading && activities.length === 0 ? (
            <div className="text-center py-5">
              <Spinner animation="border" className="mb-3" />
              <div className="text-muted">Loading activities...</div>
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center text-muted py-5">
              <Clock size={48} className="mb-3 opacity-25" />
              <div className="h6">No activities found</div>
              <div className="small">
                {Object.keys(filters).length > 1 ?
                  'Try adjusting your filters or check back later' :
                  'Activity will appear here when actions are performed'
                }
              </div>
            </div>
          ) : (
            activities.map((activity, index) => (
              <div
                key={activity.id}
                className={`d-flex align-items-start p-4 ${
                  index < activities.length - 1 ? 'border-bottom' : ''
                }`}
              >
                <div className="me-3 mt-1" style={{ fontSize: '1.25rem' }}>
                  {getActivityIcon(activity.type)}
                </div>

                <div className="flex-grow-1 min-w-0">
                  <div className="d-flex align-items-start justify-content-between">
                    <div className="flex-grow-1">
                      <div className="fw-medium mb-1">
                        {activity.link ? (
                          <Link
                            to={activity.link}
                            className="text-decoration-none text-dark"
                          >
                            {activity.title}
                          </Link>
                        ) : (
                          activity.title
                        )}
                        {activity.status && <span className="ms-2">{getStatusBadge(activity.status)}</span>}
                      </div>

                      <div className="text-muted small">
                        {activity.subtitle}
                        {activity.user && (
                          <span className="ms-2">• by <strong>{activity.user}</strong></span>
                        )}
                      </div>
                    </div>

                    <div className="text-end ms-3 flex-shrink-0">
                      <div className="small text-muted">
                        {formatTimeAgo(activity.timestamp)}
                      </div>
                      <div className="small text-muted" style={{ fontSize: '0.75rem' }}>
                        {formatDateTime(activity.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </Card.Body>

        {/* Pagination placeholder - could be enhanced with real pagination */}
        {activities.length >= ITEMS_PER_PAGE && (
          <Card.Footer className="bg-light text-center">
            <Button variant="outline-primary" size="sm" disabled>
              <ArrowLeft className="me-1" size={14} />
              Previous
            </Button>
            <span className="mx-3 text-muted small">
              Page {currentPage}
            </span>
            <Button variant="outline-primary" size="sm" disabled>
              Next
              <ArrowRight className="ms-1" size={14} />
            </Button>
          </Card.Footer>
        )}
      </Card>
    </div>
  )
}
