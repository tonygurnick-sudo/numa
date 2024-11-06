import { Button } from 'react-bootstrap';

import { useAuth } from '../Providers/AuthProvider';
import { createQApp } from '../qAppHelper';
const QAppCreate = ({ setLoading, setError, setResponse }) => {
  const { qAppsClient, loading: authLoading } = useAuth();

  const handleCreateApp = async () => {
    if (!qAppsClient || authLoading) return;

    // TODO
    // create a UI form to take in a new app
    const appPayload = '{ToDo}';
    createQApp({ qAppsClient, appPayload, setLoading, setError, setResponse });
  };

  return (
    <>
      {/* TODO  - create app form UI */}

      <Button
        type="submit"
        id="submit"
        className="btn btn-primary x-5 float-end"
        onClick={handleCreateApp}
      >
        <i className="bi bi-plus-circle me-2"></i>
        Create New App (deploy a Q demo)
      </Button>
    </>
  );
};

export { QAppCreate };
