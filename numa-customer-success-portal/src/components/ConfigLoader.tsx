import { useEffect, useState } from 'react';
import { Alert, Spinner, Container } from 'react-bootstrap';
import { fetchConfigAndAddToSession, hasConfigInSession } from '@/services/configService';

interface ConfigLoaderProps {
  children: React.ReactNode;
}

export default function ConfigLoader({ children }: ConfigLoaderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        setError(null);
        // If we already have config, render immediately, but trigger a background refresh
        if (hasConfigInSession()) {
          setIsLoading(false);
          // Background refresh respects cache TTL and will reload if changed
          fetchConfigAndAddToSession().catch((e) => console.debug('Background config refresh skipped:', e));
          return;
        }

        // Otherwise, fetch config before rendering
        await fetchConfigAndAddToSession();
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load configuration:', error);
        setError(error instanceof Error ? error.message : 'Failed to load configuration');
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

  if (isLoading) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <Container>
          <div className="text-center">
            <Spinner animation="border" variant="primary" className="mb-3" />
            <h4>Loading Configuration...</h4>
            <p className="text-muted">Please wait while we initialize the portal</p>
          </div>
        </Container>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <Container>
          <div className="text-center">
            <Alert variant="danger">
              <Alert.Heading>Configuration Error</Alert.Heading>
              <p>{error}</p>
              <hr />
              <div className="d-flex justify-content-center">
                <button className="btn btn-outline-danger" onClick={() => window.location.reload()}>
                  Reload Page
                </button>
              </div>
            </Alert>
          </div>
        </Container>
      </div>
    );
  }

  return <>{children}</>;
}
