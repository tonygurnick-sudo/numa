import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { useAuth } from './Providers/AuthProvider';
import AppProviders from './Providers/AppProviders';
import { ProtectedRoute } from './Components/RequiredFeaturesWrapper';
import { ROUTE_CONFIG } from './utils/routeConfig';

// Lazy load non-critical pages
const ResetPassword = lazy(() => import('./Pages/ResetPassword').then((m) => ({ default: m.ResetPassword })));
const NumaLogin = lazy(() => import('./Pages/Login').then((m) => ({ default: m.NumaLogin })));
const Ian = lazy(() => import('./Pages/Ian').then((m) => ({ default: m.Ian })));

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
    <Suspense fallback={<div className="d-flex justify-content-center align-items-center vh-100">Loading...</div>}>
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
    </Suspense>
  );
};

export { NumaRoutes };
