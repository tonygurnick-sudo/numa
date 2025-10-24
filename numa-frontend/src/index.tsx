import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import installOpenTelemetry from './otel-config.jsx';

import { fetchConfigAddtoSession } from './Components/ConfigSetup';
import { NicetyProvider } from './Providers/NicetyProvider';
import { ToastProvider } from './Providers/ToastProvider';

// Initialize config with caching
fetchConfigAddtoSession().catch((error) => {
  console.error('Failed to initialize config:', error);
});

// Only install OpenTelemetry if not running on localhost
if (!window.location.hostname.includes('localhost')) {
  installOpenTelemetry(sessionStorage.getItem('HONEYCOMB_KEY'));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <NicetyProvider>
        <App />
      </NicetyProvider>
    </ToastProvider>
  </StrictMode>,
);
