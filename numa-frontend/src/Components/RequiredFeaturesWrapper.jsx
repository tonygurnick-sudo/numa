import { Navigate } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';

/**
 * A flexible wrapper component for feature-based access control.
 *
 * @param {string} requiredFeature - The feature name required to access the content
 * @param {React.ReactNode} children - Content to render if user has the required feature
 * @param {React.ReactNode} fallback - Content to render if user doesn't have the feature (default: null)
 * @param {boolean} requireAuth - Whether authentication is required (default: false)
 * @param {React.ReactNode} loadingFallback - Content to render while loading (default: null)
 * @param {React.ReactNode} noAccessFallback - Default content for users without access (default: null)
 * @param {boolean} redirectToLogin - Whether to redirect to login for unauthenticated users (default: false)
 */
export const FeatureWrapper = ({
  requiredFeature,
  children,
  fallback = null,
  requireAuth = false,
  loadingFallback = null,
  noAccessFallback = null, // don't render anything if no access
  redirectToLogin = false,
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
    return fallback || noAccessFallback;
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
  <FeatureWrapper requiredFeature={requiredFeature} fallback={null}>
    {children}
  </FeatureWrapper>
);

/**
 * Specialized wrapper for protected routes with authentication and feature requirements.
 * Automatically requires authentication and redirects to login if needed.
 *
 * @param {string} requiredFeature - The feature name required to access the route
 * @param {React.ReactNode} children - The page component to render
 */
export const ProtectedRoute = ({ requiredFeature, children }) => (
  <FeatureWrapper requiredFeature={requiredFeature} requireAuth={true} redirectToLogin={true}>
    {children}
  </FeatureWrapper>
);
