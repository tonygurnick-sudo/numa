import { useEffect, useState } from 'react'
import { Col, Row } from 'react-bootstrap'
import {
  BoxSeam,
  FileEarmarkText,
  Rocket,
  People,
  BarChart,
  Globe,
  Plus,
  FileText
} from 'react-bootstrap-icons'
import { Client } from '@/types'
import { clientService } from '@/services/clientService'
import { listAllRecentDeployments, type DeploymentRecord } from '@/services/deploymentService'
import { getConfigValue } from '@/services/configService'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { WorkflowHub } from '@/components/dashboard/WorkflowHub'
import { WelcomeBanner } from '@/components/dashboard/WelcomeBanner'
import { ToolsSection } from '@/components/dashboard/ToolsSection'
import { AVAILABLE_TOOLS } from '@/data/tools'


export default function Dashboard() {
  const [clients, setClients] = useState<Client[]>([])
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const deploymentsTable = getConfigValue('DEPLOYMENTS_TABLE')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [clientData, deploymentData] = await Promise.all([
          clientService.getAllClients(),
          deploymentsTable ? listAllRecentDeployments(50).catch(() => []) : Promise.resolve([])
        ])
        setClients(clientData)
        setDeployments(deploymentData)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [deploymentsTable])



  // Calculate stats
  const total = clients.length
  const devClients = clients.filter(c => c.config.devInstance).length
  const prodClients = total - devClients
  const countByRegion = (regionCode: string) => clients.filter(c => (c.config.region || '').toLowerCase() === regionCode.toLowerCase()).length
  const countUSEast1 = countByRegion('us-east-1')
  const countSydney = countByRegion('ap-southeast-2')

  // Deployment stats
  const runningDeployments = deployments.filter(d =>
    (d.status || '').toLowerCase() === 'running' ||
    (d.status || '').toLowerCase() === 'retrying'
  )

  const last24Hours = deployments.filter(d => {
    const deployTime = new Date(d.startTime || '')
    const now = new Date()
    return (now.getTime() - deployTime.getTime()) < 24 * 60 * 60 * 1000
  })

  // Filter deployments to last week for success rate calculation
  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

  const lastWeekDeployments = deployments.filter(d => {
    const deployTime = new Date((d as any).startTime || (d as any).startedAt || d.startTime || new Date())
    return deployTime >= oneWeekAgo
  })

  const successfulDeployments = lastWeekDeployments.filter(d => d.status === 'success').length
  const totalLastWeekDeployments = lastWeekDeployments.length
  const successRate = totalLastWeekDeployments > 0 ? Math.round((successfulDeployments / totalLastWeekDeployments) * 100) : 0

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <div className="text-muted">Loading dashboard...</div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Welcome Banner */}
      <WelcomeBanner
        systemStatus={{
          overall: error ? 'error' : runningDeployments.length > 0 ? 'warning' : 'healthy',
          services: [
            { name: 'Configs', status: 'healthy' },
            { name: 'Deploy', status: runningDeployments.length > 0 ? 'warning' : 'healthy' },
            { name: 'Analytics', status: 'healthy' },
          ],
          lastChecked: new Date().toISOString()
        }}
      />

      {/* Enhanced Stats Cards */}
      <Row className="g-4 mb-5">
        <Col lg={3} md={6}>
          <StatsCard
            title="Total Clients"
            value={total}
            subtitle={`${prodClients} production, ${devClients} development`}
            icon={<People />}
            badge={{ text: 'Active', variant: 'success' }}
            status="success"
          />
        </Col>
        <Col lg={3} md={6}>
          <StatsCard
            title="Active Deployments"
            value={runningDeployments.length}
            subtitle={`${last24Hours.length} in last 24h`}
            icon={<Rocket />}
            status={runningDeployments.length > 0 ? 'warning' : 'success'}
            badge={{
              text: runningDeployments.length > 0 ? 'Running' : 'Idle',
              variant: runningDeployments.length > 0 ? 'warning' : 'success'
            }}
          />
        </Col>
        <Col lg={3} md={6}>
          <StatsCard
            title="Success Rate"
            value={`${successRate}%`}
            subtitle={`${successfulDeployments}/${totalLastWeekDeployments} deployments (last 7 days)`}
            icon={<BarChart />}
            status={successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'danger'}
            trend={{
              value: 5,
              label: 'vs previous week',
              isPositive: true
            }}
          />
        </Col>
        <Col lg={3} md={6}>
          <StatsCard
            title="Global Coverage"
            value={2}
            subtitle={`US: ${countUSEast1}, AU: ${countSydney}`}
            icon={<Globe />}
            badge={{ text: 'Regions', variant: 'info' }}
            status="info"
          />
        </Col>
      </Row>

      {/* Activity Feed and Workflow Hubs */}
      <Row className="g-4 mb-5">
        <Col lg={5}>
          <ActivityFeed deployments={deployments} maxItems={6} />
        </Col>
        <Col lg={7}>
          <Row className="g-4">
            <Col md={6}>
              <WorkflowHub
                title="Client Management"
                description="Configure clients and manage user accounts"
                icon={<FileEarmarkText />}
                primaryAction={{
                  label: 'Browse Configs',
                  link: '/configs',
                  icon: <FileText />
                }}
                secondaryActions={[
                  {
                    label: 'New Client',
                    link: '/tools/create-client-config',
                    icon: <Plus />,
                    variant: 'primary'
                  }
                ]}
                stats={[
                  { label: 'Total Clients', value: total },
                  { label: 'Production', value: prodClients }
                ]}
                color="primary"
              />
            </Col>
            <Col md={6}>
              <WorkflowHub
                title="Deployment Center"
                description="Deploy updates and monitor deployment status"
                icon={<Rocket />}
                primaryAction={{
                  label: 'Start Deploy',
                  link: '/deployments',
                  icon: <Rocket />
                }}
                secondaryActions={[
                  {
                    label: 'View Images',
                    link: '/containers',
                    icon: <BoxSeam />
                  }
                ]}
                stats={[
                  { label: 'Running', value: runningDeployments.length },
                  { label: 'Success Rate', value: `${successRate}%` }
                ]}
                color="success"
              />
            </Col>
          </Row>
        </Col>
      </Row>

      {/* Tools Section */}
      <ToolsSection
        tools={AVAILABLE_TOOLS}
        disabled={loading}
      />

      {error && (
        <div className="alert alert-danger mt-4" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}
