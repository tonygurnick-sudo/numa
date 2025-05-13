import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { reloadFavourites } from './utils/navigation';
import { ResetPassword } from './Pages/ResetPassword';
import { Dash } from './Pages/Dash';
import AppDetail from './Pages/AppDetail';
import UserManagement from './Pages/UserManagement';

import { useAuth } from './Providers/AuthProvider';
import { NumaLogin } from './Pages/Login';
import { NumaChat } from './Pages/NumaChat';
import { S3Uploader } from './Pages/S3Uploader';
import { CompanyInfo } from './Pages/CompanyInfo';
import AppProviders from './Providers/AppProviders';

const NumaRoutes = () => {
  return (
    <AppProviders>
      <Router>
        <AppRoutes />
      </Router>
    </AppProviders>
  );
};

const AppRoutes = () => {
  const { user, loading, tokenValidationComplete } = useAuth();
  const navigate = useNavigate();

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

  return (
    <Routes>
      <Route path="/" element={<Navigate to={user ? '/dash' : '/login'} replace />} />
      <Route path="/login" element={user ? <Navigate to="/dash" replace /> : <NumaLogin />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/create-password" element={<ResetPassword />} />

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
            <Dash onClick={() => reloadFavourites(navigate)} showFavorites={true} />
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
