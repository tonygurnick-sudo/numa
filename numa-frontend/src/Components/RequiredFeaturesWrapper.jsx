import { Navigate } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';
import { Container, Row, Col, Card, Button } from 'react-bootstrap';

/**
 * Default access denied component that shows when user lacks required feature
 */
const AccessDeniedFallback = ({ onRedirectToDash }) => (
  <Container className="mt-5">
    <Row className="justify-content-center">
      <Col md={6}>
        <Card className="text-center">
          <Card.Body>
            <div className="mb-3">
              <i className="bi bi-shield-exclamation text-warning" style={{ fontSize: '3rem' }}></i>
            </div>
            <Card.Title>Access Not Available</Card.Title>
            <Card.Text className="text-muted">You don&apos;t have access to this feature.</Card.Text>
            <Card.Text className="text-muted">Please contact your administrator to request access.</Card.Text>
            <Button variant="primary" onClick={onRedirectToDash} className="me-2">
              <i className="bi bi-house-door me-1"></i>
              Go to Dashboard
            </Button>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  </Container>
);

/**
 * A flexible wrapper component for feature-based access control.
 *
 * @param {string} requiredFeature - The feature name required to access the content
 * @param {React.ReactNode} children - Content to render if user has the required feature
 * @param {React.ReactNode} fallback - Content to render if user doesn't have the feature (default: AccessDeniedFallback)
 * @param {boolean} requireAuth - Whether authentication is required (default: false)
 * @param {React.ReactNode} loadingFallback - Content to render while loading (default: null)
 * @param {React.ReactNode} noAccessFallback - Default content for users without access (default: AccessDeniedFallback)
 * @param {boolean} redirectToLogin - Whether to redirect to login for unauthenticated users (default: false)
 * @param {boolean} showAccessDenied - Whether to show access denied message instead of null (default: true for routes, false for components)
 */
export const FeatureWrapper = ({
  requiredFeature,
  children,
  fallback = null,
  requireAuth = false,
  loadingFallback = null,
  noAccessFallback = null,
  redirectToLogin = false,
  showAccessDenied = false, // Default to false to maintain existing behavior for components
}) => {
  const { user, loading, tokenValidationComplete } = useAuth();

  // Handle loading states
  if (loading || !tokenValidationComplete) {
    return loadingFallback;
  }

  // Handle authentication requirement
  if (requireAuth && !user) {
    return redirectToLogin ? <Navigate to="/login" replace /> : <Navigate to="/login" replace />;
  }

  // If no required feature, just return children (after auth checks if needed)
  if (!requiredFeature) {
    return children;
  }

  // Check if user has the required feature
  const hasFeature = user?.features?.includes(requiredFeature);

  if (!hasFeature) {
    // If a custom fallback is provided, use it
    if (fallback) {
      return fallback;
    }

    // If noAccessFallback is provided, use it
    if (noAccessFallback) {
      return noAccessFallback;
    }

    // If showAccessDenied is true, show the access denied component
    if (showAccessDenied) {
      return (
        <AccessDeniedFallback
          requiredFeature={requiredFeature}
          onRedirectToDash={() => (window.location.href = '/dash')}
        />
      );
    }

    // Default behavior: return null (for backward compatibility with nav items, etc.)
    return null;
  }

  return children;
};

/**
 * Specialized wrapper for navigation items that automatically handles null fallback.
 * Use this for nav menu items that should be hidden when user lacks the required feature.
 *
 * @param {string} requiredFeature - The feature name required to show the nav item
 * @param {React.ReactNode} children - The navigation item to render
 */
export const NavFeatureWrapper = ({ requiredFeature, children }) => (
  <FeatureWrapper requiredFeature={requiredFeature} fallback={null} showAccessDenied={false}>
    {children}
  </FeatureWrapper>
);

/**
 * Specialized wrapper for protected routes with authentication and feature requirements.
 * Automatically requires authentication and redirects to login if needed.
 * Shows access denied message when user lacks required feature.
 *
 * @param {string} requiredFeature - The feature name required to access the route
 * @param {React.ReactNode} children - The page component to render
 */
export const ProtectedRoute = ({ requiredFeature, children }) => (
  <FeatureWrapper requiredFeature={requiredFeature} requireAuth={true} redirectToLogin={true} showAccessDenied={true}>
    {children}
  </FeatureWrapper>
);
