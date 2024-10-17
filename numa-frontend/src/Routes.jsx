import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { NumaLogin } from './Pages/Login';
import { NumaChat } from './Pages/NumaChat';
import { ResetPassword } from './Pages/ResetPassword';
import { Dash } from './Pages/Dash';

import { isAuthenticated } from './auth'

const NumaRoutes = () => {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={isAuthenticated() ? <Navigate to="/dash" replace /> : <NumaLogin />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/" element={<Navigate to={isAuthenticated() ? "/dash" : "/login"} replace />} />

        <Route path="/dash" element={isAuthenticated() ? <Dash /> : <Navigate to="/login" replace />} />
        <Route path="/chat" element={isAuthenticated() ? <NumaChat /> : <Navigate to="/login" replace />} />

      </Routes>
    </Router>
  );
};

export { NumaRoutes };
