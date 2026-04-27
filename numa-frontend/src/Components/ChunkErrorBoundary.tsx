import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasChunkError: boolean;
}

const RELOAD_KEY = 'chunk_error_reload';

/**
 * Catches failed dynamic imports (stale chunks after a deploy) and forces
 * a full page reload so the browser fetches the new index.html with
 * updated chunk references. A sessionStorage flag prevents infinite
 * reload loops if the error persists for another reason.
 */
class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { hasChunkError: false };

  static getDerivedStateFromError(error: Error): State | null {
    if (isChunkLoadError(error)) {
      return { hasChunkError: true };
    }
    return null;
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY);
      if (!alreadyReloaded) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        window.location.reload();
        return;
      }
      // Already tried reloading once -- show fallback instead of looping
    }
  }

  componentDidUpdate() {
    // Clear the reload flag on successful render so future deploys can
    // trigger a reload again.
    if (!this.state.hasChunkError) {
      sessionStorage.removeItem(RELOAD_KEY);
    }
  }

  render() {
    if (this.state.hasChunkError) {
      return (
        <div className="d-flex justify-content-center align-items-center vh-100">
          <div className="text-center">
            <h5>A new version of Numa is available</h5>
            <p className="text-muted">Please refresh the page to continue.</p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function isChunkLoadError(error: Error): boolean {
  // Vite throws TypeError for failed dynamic imports; Webpack uses ChunkLoadError
  return (
    error.name === 'ChunkLoadError' ||
    (error instanceof TypeError && /dynamically imported module|Failed to fetch/.test(error.message)) ||
    /Loading chunk .* failed/.test(error.message)
  );
}

export default ChunkErrorBoundary;
