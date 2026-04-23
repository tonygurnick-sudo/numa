import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
import App from './App.tsx';

// Recover from stale dynamic-import chunks after a new portal build has been deployed.
// The hashed chunk in index.html no longer exists on S3/CloudFront, so the first
// dynamic import throws. Reload once per session to pick up the new index.html.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('csp-preload-reloaded') === '1') {
    return;
  }
  sessionStorage.setItem('csp-preload-reloaded', '1');
  console.warn('Stale chunk detected, reloading to pick up new build', event);
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
