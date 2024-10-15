import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { NumaLogin } from './pages/Login';
import { NumaChat } from './pages/NumaChat';

const NumaRoutes = () => {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<NumaLogin />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/chat" element={<NumaChat />} />
      </Routes>
    </Router>
  );
};

export { NumaRoutes };
