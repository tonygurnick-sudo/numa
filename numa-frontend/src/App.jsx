import React from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import './assets/css/Styles.scss';
import { NumaRoutes } from './Routes';

function App() {
  return (
    <React.StrictMode>
      <NumaRoutes />
    </React.StrictMode>
  );
}

export default App;
