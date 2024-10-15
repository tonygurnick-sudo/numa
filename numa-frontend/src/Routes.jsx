import { NumaLogin } from './pages/login';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';

const NumaRoutes = () => {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<NumaLogin />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
};

export { NumaRoutes };
