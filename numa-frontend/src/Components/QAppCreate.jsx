import { useState } from 'react';
import { Button, Alert } from 'react-bootstrap';

import { useAuth } from '../Providers/AuthProvider';
import { createQApp } from '../qAppHelper';

const QAppCreate = () => {
  const { qAppsClient, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [response, setResponse] = useState(null);

  const handleCreateApp = async () => {
    if (!qAppsClient || authLoading) return;

    // TODO
    // create a UI form to take in a new app
    const appPayload = '{ToDo}';
    createQApp({ qAppsClient, appPayload, setLoading, setError, setResponse });
  };

  return (
    <>
      {error && (
        <Alert variant="danger" onClose={() => setError(null)} dismissible>
          {error}
        </Alert>
      )}

      {response && (
        <Alert variant="success" onClose={() => setResponse(null)} dismissible>
          App created successfully!
        </Alert>
      )}

      <Button
        type="submit"
        id="submit"
        className="btn btn-primary x-5 float-end"
        onClick={handleCreateApp}
        disabled={loading || authLoading}
      >
        {loading ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Creating...
          </>
        ) : (
          <>
            <i className="bi bi-plus-circle me-2"></i>
            Create New App (deploy a Q demo)
          </>
        )}
      </Button>
    </>
  );
};

export { QAppCreate };
