import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { NumaLogin } from './pages/Login';
import { NumaChat } from './pages/NumaChat';
import { AuthProvider, useAuth } from './providers/AuthProvider';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    // You can return a loading spinner or null here
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const AuthenticatedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    // You can return a loading spinner or null here
    return <div>Loading...</div>;
  }

  if (user) {
    return <Navigate to="/chat" replace />;
  }

  return children;
};

const NumaRoutes = () => {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthenticatedRoute>
                <NumaLogin />
              </AuthenticatedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <NumaChat />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </Router>
  );
};

export { NumaRoutes };
