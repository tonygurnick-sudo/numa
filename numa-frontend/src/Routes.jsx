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
  const { user } = useAuth();

  if (!user) {
    // Redirect to login if there's no user (i.e., no valid JWT)
    return <Navigate to="/login" replace />;
  }

  return children;
};

const NumaRoutes = () => {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<NumaLogin />} />
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
