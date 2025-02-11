import { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';

import { useNavigate } from 'react-router-dom';

import { addAppToLibrary, deleteQAppById } from '../qAppHelper';
import { useAuth } from '../Providers/AuthProvider';
import { StartQAppSessionCommand } from '@aws-sdk/client-qapps';
import { useNumaApp } from '../Providers/NumaAppProvider';

const QAppDetailHeader = () => {
  const navigate = useNavigate();
  const { runActive, setQSessionId, setIsPolling, qAppData, qCardInputValues, setError } = useNumaApp();
  const qAppId = qAppData.appId;

  const { qAppsClient, loading: authLoading } = useAuth();
  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);

  const handleRunApp = async () => {
    if (!qAppsClient || authLoading) return;

    try {
      const payload = {
        instanceId: Q_APPLICATION_ID,
        appId: qAppId,
        appVersion: qAppData.appVersion,
        initialValues: qAppData.appDefinition.cards
          .map((card) => {
            const cardId = card[Object.keys(card)[0]].id;
            const defaultValue = card[Object.keys(card)[0]].defaultValue;
            const value = qCardInputValues[cardId] || defaultValue || '';
            return value ? { cardId, value } : null; // Only include cards with a value
          })
          .filter(Boolean), // Filter out nulls
      };

      const start_command = new StartQAppSessionCommand(payload);
      const start_response = await qAppsClient.send(start_command);

      if (start_response) {
        setIsPolling(true);
        setQSessionId(start_response.sessionId); // Store sessionId
      }
    } catch (error) {
      console.error('Error starting app session:', error);
      setError(error); // Set error state
    }
  };

  // DELETE
  const handleDeleteApp = async () => {
    if (!qAppsClient || !qAppId) return;

    deleteQAppById({ qAppsClient, qAppId, setLoading, setError, setResponse });
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
    if (!qAppsClient || !qAppId) return;

    addAppToLibrary({ qAppsClient, qAppId, setLoading, setError, setResponse });
  };

  return (
    <>
      <div className="d-flex gap-2">
        <Button variant="secondary" className="w-auto" onClick={handleAddAppToLib}>
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
