import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Suspense, lazy, ReactNode } from 'react';
import { useAuth } from './Providers/AuthProvider';
import AppProviders from './Providers/AppProviders';
import { ProtectedRoute } from './Components/RequiredFeaturesWrapper';
import { ROUTE_CONFIG } from './utils/routeConfig';
import AppLayout from './Layouts/AppLayout';
import DemoLayout from './Layouts/DemoLayout';
import { useTranslation } from 'react-i18next';
import { getFlag } from './utils/featureFlags';
import { useBrowserNotificationRouteTracker } from './hooks/useBrowserNotification';
import SSOCallbackHandler from './Components/Auth/SSOCallbackHandler';

// Lazy load non-critical pages
const ResetPassword = lazy(() => import('./Pages/ResetPassword').then((m) => ({ default: m.ResetPassword })));
const NumaLogin = lazy(() => import('./Pages/Login').then((m) => ({ default: m.NumaLogin })));
const Ian = lazy(() => import('./Pages/Ian').then((m) => ({ default: m.Ian })));
const SharedDocumentChat = lazy(() =>
  import('./Pages/SharedDocumentChat').then((m) => ({ default: m.SharedDocumentChat }))
);
const SharedAnalytics = lazy(() => import('./Pages/SharedAnalytics').then((m) => ({ default: m.SharedAnalytics })));
const DropZonePage = lazy(() => import('./Pages/DropZonePage').then((m) => ({ default: m.DropZonePage })));
const FilePreviewFullScreen = lazy(() =>
  import('./Pages/FilePreviewFullScreen').then((m) => ({ default: m.FilePreviewFullScreen }))
);
const PublicDemoChat = lazy(() => import('./Pages/PublicDemoChat').then((m) => ({ default: m.PublicDemoChat })));
const PublicDemoFilePreview = lazy(() =>
  import('./Pages/PublicDemoFilePreview').then((m) => ({ default: m.PublicDemoFilePreview }))
);

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
  useBrowserNotificationRouteTracker();
  const isFeatureEnabled = (flag?: string) => {
    if (!flag) return true;
    return getFlag(flag);
  };

  if (loading || !tokenValidationComplete) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status" aria-hidden="true"></div>
          <div className="mt-3 text-muted">{t('loading.generic')}</div>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={<div className="d-flex justify-content-center align-items-center vh-100">{t('loading.generic')}</div>}
    >
      <Routes>
        <Route
          path="/"
          element={
            <SSOCallbackHandler>
              <Navigate to={user ? (user?.features?.includes('chat') ? '/chat' : '/dash') : '/login'} replace />
            </SSOCallbackHandler>
          }
        />
        <Route
          path="/login"
          element={
            user ? <Navigate to={user?.features?.includes('chat') ? '/chat' : '/dash'} replace /> : <NumaLogin />
          }
        />
        {/* Redirect legacy /chat-v2 to /chat */}
        <Route path="/chat-v2" element={<Navigate to="/chat" replace />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/create-password" element={<ResetPassword />} />
        <Route path="/ian" element={<Ian />} />
        {/* Public shared document Q&A page - no authentication required */}
        <Route path="/shared/:uuid" element={<SharedDocumentChat />} />
        {/* Public drop zone upload page - no authentication required */}
        <Route path="/dropzone/:uuid" element={<DropZonePage />} />
        {/* Public demo chat page - no authentication required, unlisted URL */}
        {getFlag('PUBLIC_DEMO') && (
          <Route
            path="/demo"
            element={
              <DemoLayout>
                <PublicDemoChat />
              </DemoLayout>
            }
          />
        )}
        {/* Public demo file preview - no authentication required */}
        {getFlag('PUBLIC_DEMO') && <Route path="/demo/file-preview" element={<PublicDemoFilePreview />} />}
        {/* Protected share analytics page - only accessible to share creator */}
        <Route
          path="/analyze/shared/:uuid"
          element={
            <AuthenticatedLayout>
              <SharedAnalytics />
            </AuthenticatedLayout>
          }
        />
        {/* Full-screen file preview — authenticated but no AppLayout (opens in new tab) */}
        <Route path="/file-preview" element={user ? <FilePreviewFullScreen /> : <Navigate to="/login" replace />} />
        {/* Dynamically render all protected routes from ROUTE_CONFIG */}
        {ROUTE_CONFIG.map((r) => {
          const featureEnabled = isFeatureEnabled(r.featureFlag);
          return (
            <Route
              key={r.path}
              path={r.path}
              element={
                featureEnabled ? (
                  <AuthenticatedLayout requiredFeature={r.requiredFeature}>{r.element(navigate)}</AuthenticatedLayout>
                ) : (
                  <Navigate to="/dash" replace />
                )
              }
            />
          );
        })}
      </Routes>
    </Suspense>
  );
};

export { NumaRoutes };
