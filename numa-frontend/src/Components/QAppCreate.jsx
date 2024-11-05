import { createQApp } from '../qAppHelper';

const QAppCreate = ({ qAppsClient, setLoading, setError, setResponse }) => {
  const handleCreateApp = async () => {
    if (!qAppsClient) return;

    // TODO
    // create a UI form to take in a new app
    const appPayload = '{ToDo}';
    createQApp({ qAppsClient, appPayload, setLoading, setError, setResponse });
  };

  return (
    <>
      {/* TODO  - create app form UI */}

      <button
        type="submit"
        id="submit"
        className="btn btn-primary x-5 float-end"
        onClick={handleCreateApp}
      >
        <i className="bi bi-plus-circle me-2"></i>
        Create New App (deploy demo)
      </button>
    </>
  );
};

export { QAppCreate };
