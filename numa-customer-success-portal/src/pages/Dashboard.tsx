import { useEffect, useState } from 'react';
import { Button, Col, Modal, Row } from 'react-bootstrap';
import {
  BoxSeam,
  FileEarmarkText,
  Rocket,
  People,
  BarChart,
  Globe,
  Plus,
  FileText,
  Download,
} from 'react-bootstrap-icons';
import { Client, getDefaultClientConfigValues } from '@/types';
import { clientService } from '@/services/clientService';
import { listAllRecentDeployments, type DeploymentRecord } from '@/services/deploymentService';
import { getConfigValue } from '@/services/configService';
import { FileExportService } from '@/utils/fileExport';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { WorkflowHub } from '@/components/dashboard/WorkflowHub';
import { WelcomeBanner } from '@/components/dashboard/WelcomeBanner';
import { ToolsSection } from '@/components/dashboard/ToolsSection';
import { PublicDemoStats } from '@/components/dashboard/PublicDemoStats';
import { fetchPublicDemoStats, type PublicDemoStats as PublicDemoStatsType } from '@/services/publicDemoService';
import { AVAILABLE_TOOLS } from '@/data/tools';

export default function Dashboard() {
  const [clients, setClients] = useState<Client[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [publicDemoStats, setPublicDemoStats] = useState<PublicDemoStatsType[]>([]);
  const [publicDemoLoading, setPublicDemoLoading] = useState(false);
  const [publicDemoError, setPublicDemoError] = useState<string | undefined>();
  const deploymentsTable = getConfigValue('DEPLOYMENTS_TABLE');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [clientData, deploymentData] = await Promise.all([
          clientService.getAllClients(),
          deploymentsTable ? listAllRecentDeployments(50).catch(() => []) : Promise.resolve([]),
        ]);
        setClients(clientData);
        setDeployments(deploymentData);

        // Fetch public demo stats asynchronously (don't block dashboard)
        const demoClients = clientData.filter((c) => c.config.publicDemo);
        if (demoClients.length > 0) {
          setPublicDemoLoading(true);
          fetchPublicDemoStats(clientData)
            .then(setPublicDemoStats)
            .catch((e) => setPublicDemoError(e instanceof Error ? e.message : 'Failed to load demo stats'))
            .finally(() => setPublicDemoLoading(false));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [deploymentsTable]);

  // Calculate stats
  const total = clients.length;
  const devClients = clients.filter((c) => c.config.devInstance).length;
  const prodClients = total - devClients;
  const countByRegion = (regionCode: string) =>
    clients.filter((c) => (c.config.region || '').toLowerCase() === regionCode.toLowerCase()).length;
  const countUSEast1 = countByRegion('us-east-1');
  const countSydney = countByRegion('ap-southeast-2');

  // Deployment stats
  const runningDeployments = deployments.filter(
    (d) => (d.status || '').toLowerCase() === 'running' || (d.status || '').toLowerCase() === 'retrying'
  );

  const last24Hours = deployments.filter((d) => {
    const deployTime = new Date(d.startTime || '');
    const now = new Date();
    return now.getTime() - deployTime.getTime() < 24 * 60 * 60 * 1000;
  });

  // Filter deployments to last week for success rate calculation
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const lastWeekDeployments = deployments.filter((d) => {
    const deployTime = new Date((d as any).startTime || (d as any).startedAt || d.startTime || new Date());
    return deployTime >= oneWeekAgo;
  });

  const successfulDeployments = lastWeekDeployments.filter((d) => d.status === 'success').length;
  const totalLastWeekDeployments = lastWeekDeployments.length;
  const successRate =
    totalLastWeekDeployments > 0 ? Math.round((successfulDeployments / totalLastWeekDeployments) * 100) : 0;

  // Helper function to merge config with defaults
  const mergeConfigWithDefaults = (config: any): any => {
    const defaults = getDefaultClientConfigValues();
    return {
      ...defaults,
      ...Object.fromEntries(Object.entries(config).filter(([_, v]) => v !== undefined && v !== null && v !== '')),
    };
  };

  // Unified export function
  const performExport = async (format: 'csv' | 'json', withDefaults: boolean) => {
    try {
      // Group deployments by client (deployments already loaded in state)
      const deploymentsByClient = new Map();
      deployments.forEach((deploy) => {
        if (!deploy.clientName) return;
        const list = deploymentsByClient.get(deploy.clientName) || [];
        list.push(deploy);
        deploymentsByClient.set(deploy.clientName, list);
      });

      // Enrich clients with deployment data and optionally merge with defaults
      const enrichedClients = clients.map((client) => {
        const clientDeployments = deploymentsByClient.get(client.name) || [];
        const lastDeploy = clientDeployments[0]; // Already sorted by most recent

        const config = withDefaults ? mergeConfigWithDefaults(client.config) : client.config;

        return {
          ...client,
          config,
          lastDeployment: lastDeploy
            ? {
                timestamp: lastDeploy.startedAt || lastDeploy.startTime || '',
                imageTag: lastDeploy.imageTag || '',
                status:
                  lastDeploy.status === 'success' || lastDeploy.status === 'failed' || lastDeploy.status === 'running'
                    ? lastDeploy.status
                    : 'running',
                deploymentId: lastDeploy.deploymentId,
              }
            : client.lastDeployment,
          deploymentCount: clientDeployments.length,
        };
      });

      if (format === 'csv') {
        // Prepare CSV data
        const exportData = enrichedClients.map((client) => ({
          name: client.name,
          status: client.status,
          deploymentCount: client.deploymentCount,
          clientAccountId: client.config.clientAccountId,
          region: client.config.region,
          devInstance: client.config.devInstance,
          customDomain: client.config.customDomain,
          qBusinessRegion: client.config.qBusinessRegion,
          provisionQResources: client.config.provisionQResources,
          allApps: client.config.allApps,
          allProdApps: client.config.allProdApps,
          apps: JSON.stringify(client.config.apps || {}),
          preferredKnowledgeBase: client.config.preferredKnowledgeBase,
          embeddingModel: client.config.embeddingModel,
          bedrockParserModel: client.config.bedrockParserModel,
          visionModelType: client.config.visionModelType,
          senderEmail: client.config.senderEmail,
          receiverEmails: JSON.stringify(client.config.receiverEmails || []),
          bedrockAccount: client.config.bedrockAccount,
          numaChatAgents: client.config.numaChatAgents,
          allowBedrockQuotaSharing: client.config.allowBedrockQuotaSharing,
          pipedreamIntegrations: client.config.pipedreamIntegrations,
          agents: client.config.agents,
          brandingProviderEnabled: client.config.brandingProviderEnabled,
          webCrawlerConfigs: JSON.stringify(client.config.webCrawlerConfigs || []),
          sharePointConfigs: JSON.stringify(client.config.sharePointConfigs || []),
          boxConfigs: JSON.stringify(client.config.boxConfigs || []),
          teamsConfigs: JSON.stringify(client.config.teamsConfigs || []),
          s3Configs: JSON.stringify(client.config.s3Configs || []),
          budget: JSON.stringify(client.config.budget || null),
        }));

        const columns = exportData.length > 0 ? (Object.keys(exportData[0]) as (keyof (typeof exportData)[0])[]) : [];
        const csv = FileExportService.arrayToCSV(exportData, columns);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const suffix = withDefaults ? '-with-defaults' : '-raw';
        const filename = `client-configs${suffix}-${timestamp}.csv`;

        FileExportService.downloadFile({
          name: filename,
          content: csv,
          mimeType: 'text/csv',
          size: new Blob([csv]).size,
        });
      } else {
        // JSON export
        const exportData = enrichedClients.map((client) => ({
          name: client.name,
          status: client.status,
          deploymentCount: client.deploymentCount,
          config: client.config,
          lastDeployment: client.lastDeployment,
        }));

        const json = JSON.stringify(exportData, null, 2);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const suffix = withDefaults ? '-with-defaults' : '-raw';
        const filename = `client-configs${suffix}-${timestamp}.json`;

        FileExportService.downloadFile({
          name: filename,
          content: json,
          mimeType: 'application/json',
          size: new Blob([json]).size,
        });
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    }
  };

  // Modal trigger handlers
  const handleExportCSV = () => {
    setExportFormat('csv');
    setShowExportModal(true);
  };

  const handleExportJSON = () => {
    setExportFormat('json');
    setShowExportModal(true);
  };

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
    );
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
          lastChecked: new Date().toISOString(),
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
              variant: runningDeployments.length > 0 ? 'warning' : 'success',
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
              isPositive: true,
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

      {/* Public Demo Stats */}
      {(publicDemoStats.length > 0 || publicDemoLoading || publicDemoError) && (
        <Row className="g-4 mb-5">
          <Col lg={10}>
            <PublicDemoStats stats={publicDemoStats} loading={publicDemoLoading} error={publicDemoError} />
          </Col>
        </Row>
      )}

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
                  icon: <FileText />,
                }}
                secondaryActions={[
                  {
                    label: 'New Client',
                    link: '/tools/create-client-config',
                    icon: <Plus />,
                    variant: 'primary',
                  },
                  {
                    label: 'CSV',
                    onClick: handleExportCSV,
                    icon: <Download />,
                    variant: 'outline-success',
                  },
                  {
                    label: 'JSON',
                    onClick: handleExportJSON,
                    icon: <Download />,
                    variant: 'outline-info',
                  },
                ]}
                stats={[
                  { label: 'Total Clients', value: total },
                  { label: 'Production', value: prodClients },
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
                  icon: <Rocket />,
                }}
                secondaryActions={[
                  {
                    label: 'View Images',
                    link: '/containers',
                    icon: <BoxSeam />,
                  },
                ]}
                stats={[
                  { label: 'Running', value: runningDeployments.length },
                  { label: 'Success Rate', value: `${successRate}%` },
                ]}
                color="success"
              />
            </Col>
          </Row>
        </Col>
      </Row>

      {/* Tools Section */}
      <ToolsSection tools={AVAILABLE_TOOLS} disabled={loading} />

      {error && (
        <div className="alert alert-danger mt-4" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Export Options Modal */}
      <Modal show={showExportModal} onHide={() => setShowExportModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Export Options</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">Choose how you want to export the client configurations:</p>
          <div className="d-grid gap-2">
            <Button
              variant="outline-primary"
              size="lg"
              onClick={() => {
                setShowExportModal(false);
                performExport(exportFormat, false);
              }}
            >
              <div className="fw-bold">Raw Data</div>
              <div className="small text-muted">Export as-is with actual values only</div>
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                setShowExportModal(false);
                performExport(exportFormat, true);
              }}
            >
              <div className="fw-bold">With Default Values</div>
              <div className="small">Populate missing fields with default values</div>
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
}
