import { Routes, Route } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import NavigationBar from './components/NavigationBar';
import ProtectedRoute from './components/ProtectedRoute';
import ConfigLoader from './components/ConfigLoader';
import { AuthProvider } from './contexts/AuthContext';
import './styles/arcanum-theme.css';
import Configs from './pages/Configs';
import Containers from './pages/Containers';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import CreatePassword from './pages/CreatePassword';
import UsageReportTool from './pages/UsageReportTool';
import QuotaReportTool from './pages/QuotaReportTool';
import ConfigSearchTool from './pages/ConfigSearchTool';
import AllUsersReportTool from './pages/AllUsersReportTool';
import CostAnalyticsTool from './pages/CostAnalyticsTool';
import NumaDashboard from './pages/NumaDashboard';
import NumaCredits from './pages/NumaCredits';
import Deployments from './pages/Deployments';
import GroupDeploymentDetail from './pages/GroupDeploymentDetail';
import CreateClientConfig from './pages/tools/CreateClientConfig';
import UpdateClientConfig from './pages/tools/UpdateClientConfig';
import DeleteClientConfig from './pages/tools/DeleteClientConfig';
import SetupNextgenClient from './pages/tools/SetupNextgenClient';
import SetupNonNextgenClient from './pages/tools/SetupNonNextgenClient';
import GetSystemUserSecret from './pages/tools/GetSystemUserSecret';
import BulkUpdateClientConfig from './pages/tools/BulkUpdateClientConfig';
import SupportDocsManager from './pages/tools/SupportDocsManager';
import PlatformSettings from './pages/tools/PlatformSettings';
import ResetClientPasswordTool from './pages/tools/ResetClientPasswordTool';
import DeploymentLogs from './pages/DeploymentLogs';
import Activity from './pages/Activity';
import Tools from './pages/Tools';
import Docs from './pages/Docs';
import PublicDemoConversations from './pages/PublicDemoConversations';

function App() {
  return (
    <ConfigLoader>
      <AuthProvider>
        <Routes>
          {/* Public routes (no authentication required) */}
          <Route path="/create-password" element={<CreatePassword />} />

          {/* Protected routes (authentication required) */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <div className="min-vh-100" style={{ background: 'var(--nd-bg)', color: 'var(--nd-text-dim)' }}>
                  <NavigationBar />
                  <Container fluid className="py-4">
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/numa-dashboard" element={<NumaDashboard />} />
                      <Route path="/numa-credits" element={<NumaCredits />} />
                      <Route path="/configs" element={<Configs />} />
                      <Route path="/containers" element={<Containers />} />
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/tools" element={<Tools />} />
                      <Route path="/docs" element={<Docs />} />
                      <Route path="/tools/usage-report" element={<UsageReportTool />} />
                      <Route path="/tools/quota-report" element={<QuotaReportTool />} />
                      <Route path="/tools/config-search" element={<ConfigSearchTool />} />
                      <Route path="/tools/all-users-report" element={<AllUsersReportTool />} />
                      <Route path="/tools/cost-analytics" element={<CostAnalyticsTool />} />
                      <Route path="/tools/create-client-config" element={<CreateClientConfig />} />
                      <Route path="/tools/setup-nextgen-client" element={<SetupNextgenClient />} />
                      <Route path="/tools/setup-non-nextgen-client" element={<SetupNonNextgenClient />} />
                      <Route path="/tools/update-client-config" element={<UpdateClientConfig />} />
                      <Route path="/tools/delete-client-config" element={<DeleteClientConfig />} />
                      <Route path="/tools/get-system-user-secret" element={<GetSystemUserSecret />} />
                      <Route path="/tools/bulk-update-client-config" element={<BulkUpdateClientConfig />} />
                      <Route path="/tools/support-docs-manager" element={<SupportDocsManager />} />
                      <Route path="/tools/platform-settings" element={<PlatformSettings />} />
                      <Route path="/tools/reset-client-password" element={<ResetClientPasswordTool />} />
                      <Route path="/deployments" element={<Deployments />} />
                      <Route path="/deployments/:id/logs" element={<DeploymentLogs />} />
                      <Route path="/deployments/group/:groupRunId" element={<GroupDeploymentDetail />} />
                      <Route path="/activity" element={<Activity />} />
                      <Route path="/public-demo-conversations/:clientName" element={<PublicDemoConversations />} />
                    </Routes>
                  </Container>
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </ConfigLoader>
  );
}

export default App;
