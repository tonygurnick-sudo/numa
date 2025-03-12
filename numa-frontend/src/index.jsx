import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import installOpenTelemetry from './otel-config.jsx';

import { fetchConfigAddtoSession } from './Components/ConfigSetup';
fetchConfigAddtoSession();

installOpenTelemetry(sessionStorage.getItem('HONEYCOMB_KEY'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
