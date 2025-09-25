import { Routes, Route } from 'react-router-dom'
import { Container } from 'react-bootstrap'
import NavigationBar from './components/NavigationBar'
import ProtectedRoute from './components/ProtectedRoute'
import ConfigLoader from './components/ConfigLoader'
import { AuthProvider } from './contexts/AuthContext'
import './styles/arcanum-theme.css'
import Configs from './pages/Configs'
import Containers from './pages/Containers'
import Dashboard from './pages/Dashboard'
import UserManagement from './pages/UserManagement'
import CreatePassword from './pages/CreatePassword'
import UsageReportTool from './pages/UsageReportTool'
import QuotaReportTool from './pages/QuotaReportTool'

function App() {
  return (
    <ConfigLoader>
      <AuthProvider>
        <Routes>
          {/* Public routes (no authentication required) */}
          <Route path="/create-password" element={<CreatePassword />} />

          {/* Protected routes (authentication required) */}
          <Route path="/*" element={
            <ProtectedRoute>
              <div className="min-vh-100 bg-light text-dark">
                <NavigationBar />
                <Container fluid className="py-4">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/configs" element={<Configs />} />
                    <Route path="/containers" element={<Containers />} />
                    <Route path="/users" element={<UserManagement />} />
                    <Route path="/tools/usage-report" element={<UsageReportTool />} />
                    <Route path="/tools/quota-report" element={<QuotaReportTool />} />
                  </Routes>
                </Container>
              </div>
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </ConfigLoader>
  )
}

export default App
