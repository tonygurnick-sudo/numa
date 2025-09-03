import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ResetPassword } from './Pages/ResetPassword';

import { useAuth } from './Providers/AuthProvider';
import { NumaLogin } from './Pages/Login';
import AppProviders from './Providers/AppProviders';
import { ProtectedRoute } from './Components/RequiredFeaturesWrapper';
import { ROUTE_CONFIG } from './utils/routeConfig.jsx';
import { Ian } from './Pages/Ian.jsx';

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

  return (
    <Routes>
      <Route path="/" element={<Navigate to={user ? '/dash' : '/login'} replace />} />
      <Route path="/login" element={user ? <Navigate to="/dash" replace /> : <NumaLogin />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/create-password" element={<ResetPassword />} />
      <Route path="/ian" element={<Ian />} />
      {/* Dynamically render all protected routes from ROUTE_CONFIG */}
      {ROUTE_CONFIG.map((r) => (
        <Route
          key={r.path}
          path={r.path}
          element={<ProtectedRoute requiredFeature={r.requiredFeature}>{r.element(navigate)}</ProtectedRoute>}
        />
      ))}
    </Routes>
  );
};

export { NumaRoutes };
