import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App.jsx';
import installOpenTelemetry from './otel-config.jsx';
import i18n from './i18n';

import { fetchConfigAddtoSession } from './Components/ConfigSetup';
import { NicetyProvider } from './Providers/NicetyProvider';
import { ToastProvider } from './Providers/ToastProvider';
import { startVersionChecker } from './utils/versionChecker';

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
    <I18nextProvider i18n={i18n}>
      <Suspense
        fallback={
          <div className="d-flex justify-content-center align-items-center vh-100">
            <div className="spinner-border text-primary" role="status" aria-hidden="true"></div>
          </div>
        }
      >
        <ToastProvider>
          <NicetyProvider>
            <App />
          </NicetyProvider>
        </ToastProvider>
      </Suspense>
    </I18nextProvider>
  </StrictMode>,
);

// Start background version checking to prompt or reload when a new deploy appears.
// This helps clients with stale index.html or long-lived tabs pick up new releases.
// We use a simple confirm dialog here which is easy and low-risk. Teams may
// replace this with a nicer banner/modal if desired.
try {
  startVersionChecker(
    () => {
      try {
        // Non-blocking, minimal UX: ask user to reload. For chat-heavy pages, change to show a banner.
        const prompt = i18n.t('common:version.reloadPrompt', {
          defaultValue: 'A new version of Numa is available. Reload to update?',
        });
        if (confirm(prompt)) {
          window.location.reload();
        }
      } catch {
        // fallback to hard reload if confirm fails for any reason
        window.location.reload();
      }
    },
    5 * 60 * 1000,
  );
} catch {
  // ignore errors from version polling
}
