import { useState, useEffect } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';

import { useNavigate } from 'react-router-dom';

import { addAppToLibrary, deleteQAppById } from '../qAppHelper';
import { useAuth } from '../Providers/AuthProvider';
import { StartQAppSessionCommand } from '@aws-sdk/client-qapps';

const QAppDetailHeader = ({ appId, runActive }) => {
  const navigate = useNavigate();

  const { qAppsClient, loading: authLoading } = useAuth();
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const [qSsessionId, setQSessionId] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  const [app, setApp] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [inputValues, setInputValues] = useState({});

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  console.log('run is active: ', runActive);
  const handleRunApp = async () => {
    try {
      const payload = {
        instanceId: APPLICATION_ID,
        appId: app.appId,
        appVersion: app.appVersion,
        initialValues: app.appDefinition.cards
          .map((card) => {
            const cardId = card[Object.keys(card)[0]].id;
            const defaultValue = card[Object.keys(card)[0]].defaultValue;
            const value = inputValues[cardId] || defaultValue || '';
            return value ? { cardId, value } : null; // Only include cards with a value
          })
          .filter(Boolean), // Filter out nulls
      };

      const start_command = new StartQAppSessionCommand(payload);
      const start_response = await qAppsClient.send(start_command);

      if (start_response) {
        setQSessionId(start_response.sessionId); // Store sessionId
      }
    } catch (error) {
      console.error('Error starting app session:', error);
      setError(error); // Set error state
    }
  };

  // DELETE
  const handleDeleteApp = async () => {
    if (!qAppsClient || !appId) return;

    deleteQAppById({ qAppsClient, appId, setLoading, setError, setResponse });
  };

  useEffect(() => {
    if (response?.type === 'delete') {
      // Redirect to the app list page after delete
      navigate('/dash');
    }

    if (response?.type === 'add-app-to-lib') {
      navigate('/dash');
    }
  }, [response]);

  // ADD APP TO LIB
  const handleAddAppToLib = async () => {
    if (!qAppsClient || !appId) return;

    addAppToLibrary({ qAppsClient, appId, setLoading, setError, setResponse });
  };

  return (
    <>
      <div className="d-flex gap-2">
        <Button
          variant="secondary"
          className="w-auto"
          onClick={handleAddAppToLib}
        >
          <i className="bi bi-plus-circle me-2"></i> Add to Library
        </Button>

        <Button variant="danger" className="w-auto" onClick={handleDeleteApp}>
          <i className="bi bi-trash-fill"></i>
        </Button>
      </div>

      <Button
        type="submit"
        id="submit"
        className="btn btn-primary run_btn w-auto"
        disabled={runActive || loading}
        onClick={handleRunApp}
      >
        <i className="bi bi-play-fill me-2"></i> Run
      </Button>
    </>
  );
};
export { QAppDetailHeader };
