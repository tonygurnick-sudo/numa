import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { NumaLogin } from './Pages/Login';
import { ResetPassword } from './Pages/ResetPassword';
import { Dash } from './Pages/Dash';
import AppDetail from './Pages/AppDetail';

import { AuthProvider, useAuth } from './Providers/AuthProvider';
import { NumaAppProvider } from './Providers/NumaAppProvider';
import { NumaChat } from './Pages/NumaChat';
import { S3Uploader } from './Pages/S3Uploader';

const NumaRoutes = () => {
  return (
    <AuthProvider>
      <NumaAppProvider>
        <Router>
          <AppRoutes />
        </Router>
      </NumaAppProvider>
    </AuthProvider>
  );
};

const AppRoutes = () => {
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

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dash" replace /> : <NumaLogin />}
      />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        path="/"
        element={<Navigate to={user ? '/dash' : '/login'} replace />}
      />

      <Route
        path="/dash"
        element={
          <ProtectedRoute>
            <Dash />
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
    </Routes>
  );
};

export { NumaRoutes };
