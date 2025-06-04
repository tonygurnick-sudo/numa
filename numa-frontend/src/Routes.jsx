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

  const ProtectedRoute = ({ children, requiredFeature }) => {
    const features = user?.features;
    if (loading) {
      return <div>Loading...</div>;
    }

    if (!tokenValidationComplete) {
      return <div>Loading...</div>;
    }

    if (!user) {
      return <Navigate to="/login" replace />;
    }

    if (requiredFeature && !features.includes(requiredFeature)) {
      // Display a simple message to the user
      return <div>You do not have access to this feature.</div>;
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
          <ProtectedRoute requiredFeature="editCompanyData">
            <S3Uploader />
          </ProtectedRoute>
        }
      />

      <Route
        path="/chat"
        element={
          <ProtectedRoute requiredFeature="chat">
            <NumaChat />
          </ProtectedRoute>
        }
      />

      <Route
        path="/company-info"
        element={
          <ProtectedRoute requiredFeature="editCompanyData">
            <CompanyInfo />
          </ProtectedRoute>
        }
      />

      <Route
        path="/user-management"
        element={
          <ProtectedRoute requiredFeature="manageUsers">
            <UserManagement />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

export { NumaRoutes };
