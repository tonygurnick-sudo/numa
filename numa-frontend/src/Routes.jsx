import { NumaLogin } from './pages/login';
import { BrowserRouter as Router, Routes, Route, } from 'react-router-dom';

const NumaRoutes = () => {


  return (
    <Router>

        <Routes>

          <Route exact path="/login" element={<NumaLogin  />} />

        </Routes>

    </Router>
  );
};

export { NumaRoutes };
