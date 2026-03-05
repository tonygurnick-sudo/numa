import { ReactNode } from 'react';
import { Spinner, Container } from 'react-bootstrap';
import { useAuth } from '@/contexts/AuthContext';
import LoginForm from './LoginForm';

interface ProtectedRouteProps {
  children: ReactNode;
  requireRole?: string;
}

export default function ProtectedRoute({ children, requireRole }: ProtectedRouteProps) {
  const { isAuthenticated, loading, hasRole } = useAuth();

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <div className="text-center">
          <Spinner animation="border" variant="primary" />
          <div className="mt-3 text-muted">Loading...</div>
        </div>
      </div>
    );
  }

  // Show login form if not authenticated
  if (!isAuthenticated) {
    return <LoginForm />;
  }

  // Check role-based access if required
  if (requireRole && !hasRole(requireRole)) {
    return (
      <Container className="mt-5">
        <div className="text-center">
          <h3>Access Denied</h3>
          <p className="text-muted">You don't have the required permissions to access this page.</p>
          <p className="text-muted">
            Required role: <strong>{requireRole}</strong>
          </p>
        </div>
      </Container>
    );
  }

  // Render protected content
  return <>{children}</>;
}
