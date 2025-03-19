import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { NumaLogin } from './Pages/Login';
import { ResetPassword } from './Pages/ResetPassword';
import { Dash } from './Pages/Dash';
import AppDetail from './Pages/AppDetail';
import UserManagement from './Pages/UserManagement';

import { AuthProvider, useAuth } from './Providers/AuthProvider';
import { NumaAppProvider } from './Providers/NumaAppProvider';
import { NumaChat } from './Pages/NumaChat';
import { S3Uploader } from './Pages/S3Uploader';
import { CompanyInfo } from './Pages/CompanyInfo';
import { NumaRequestProvider } from './Providers/RequestProvider';

const NumaRoutes = () => {
  return (
    <AuthProvider>
      <NumaRequestProvider>
        <NumaAppProvider>
          <Router>
            <AppRoutes />
          </Router>
        </NumaAppProvider>
      </NumaRequestProvider>
    </AuthProvider>
  );
};

const AppRoutes = () => {
  const navigate = useNavigate();

  const { user, loading, tokenValidationComplete } = useAuth();

  if (loading || !tokenValidationComplete) {
    return <div>Loading...</div>;
  }

  const ProtectedRoute = ({ children }) => {
    if (!tokenValidationComplete) {
      return <div>Loading...</div>;
    }

    if (!user) {
      return <Navigate to="/login" replace />;
    }
    return children;
  };

  const reloadFavsToRefresh = () => {
    navigate('/favourite-apps');
    window.location.reload();
  };

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dash" replace /> : <NumaLogin />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/" element={<Navigate to={user ? '/dash' : '/login'} replace />} />

      <Route
        path="/dash"
        element={
          <ProtectedRoute>
            <Dash />
          </ProtectedRoute>
        }
      />

      <Route
        path="/favourite-apps"
        element={
          <ProtectedRoute>
            <Dash onClick={reloadFavsToRefresh} showFavorites={true} />
          </ProtectedRoute>
        }
      />

      {/* Route for app details */}
      <Route
        path="/app/:appId"
        element={
          <ProtectedRoute>
            <AppDetail />
          </ProtectedRoute>
        }
      />

      {/* Route for S3 uploads */}
      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            <S3Uploader />
          </ProtectedRoute>
        }
      />

      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <NumaChat />
          </ProtectedRoute>
        }
      />

      <Route
        path="/company-info"
        element={
          <ProtectedRoute>
            <CompanyInfo />
          </ProtectedRoute>
        }
      />

      <Route
        path="/user-management"
        element={
          <ProtectedRoute>
            <UserManagement />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

export { NumaRoutes };
