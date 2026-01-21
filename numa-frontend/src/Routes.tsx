import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Suspense, lazy, ReactNode } from 'react';
import { useAuth } from './Providers/AuthProvider';
import AppProviders from './Providers/AppProviders';
import { ProtectedRoute } from './Components/RequiredFeaturesWrapper';
import { ROUTE_CONFIG } from './utils/routeConfig';
import AppLayout from './Layouts/AppLayout';
import { useTranslation } from 'react-i18next';

// Lazy load non-critical pages
const ResetPassword = lazy(() => import('./Pages/ResetPassword').then((m) => ({ default: m.ResetPassword })));
const NumaLogin = lazy(() => import('./Pages/Login').then((m) => ({ default: m.NumaLogin })));
const Ian = lazy(() => import('./Pages/Ian').then((m) => ({ default: m.Ian })));

// Component to wrap authenticated routes with AppLayout
const AuthenticatedLayout = ({ children, requiredFeature }: { children: ReactNode; requiredFeature?: string }) => {
  return (
    <AppLayout>
      <ProtectedRoute requiredFeature={requiredFeature}>{children}</ProtectedRoute>
    </AppLayout>
  );
};

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
  const { t } = useTranslation('common');

  if (loading || !tokenValidationComplete) {
    return <div>{t('loading.generic')}</div>;
  }

  return (
    <Suspense
      fallback={<div className="d-flex justify-content-center align-items-center vh-100">{t('loading.generic')}</div>}
    >
      <Routes>
        <Route
          path="/"
          element={<Navigate to={user ? (user?.features?.includes('chat') ? '/chat' : '/dash') : '/login'} replace />}
        />
        <Route
          path="/login"
          element={
            user ? <Navigate to={user?.features?.includes('chat') ? '/chat' : '/dash'} replace /> : <NumaLogin />
          }
        />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/create-password" element={<ResetPassword />} />
        <Route path="/ian" element={<Ian />} />
        {/* Dynamically render all protected routes from ROUTE_CONFIG */}
        {ROUTE_CONFIG.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <AuthenticatedLayout requiredFeature={r.requiredFeature}>{r.element(navigate)}</AuthenticatedLayout>
            }
          />
        ))}
      </Routes>
    </Suspense>
  );
};

export { NumaRoutes };
