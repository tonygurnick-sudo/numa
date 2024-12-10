import { useState, useEffect } from 'react';
import { Alert } from 'react-bootstrap';

import { QAppWizard } from './QAppWizard';
import { Preloader } from './Preloader';
import { NumaChat } from '../Pages/NumaChat';

import { useAuth } from '../Providers/AuthProvider';
import { useNumaApp } from '../Providers/NumaAppProvider';

import { GetQAppCommand, GetQAppSessionCommand, StartQAppSessionCommand } from '@aws-sdk/client-qapps';

const QAppDetail = () => {
  const { qAppsClient, loading: authLoading } = useAuth();
  // TODO: Make these values dynamic
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';
  const {
    setRunActive,
    qSsessionId,
    isPolling,
    setIsPolling,
    loading,
    setLoading,
    numaAppData,
    setqAppData,
    qAppData,
    setQCardInputValues,
    qCardInputValues,
    setQSessionId
  } = useNumaApp();

  const qAppId = numaAppData?.qAppId;

  const [qSessionDetails, setQSessionDetails] = useState(null);
  const [error, setError] = useState(null);

  // Update specific card's input value
  const handleInputChange = (cardId, value) => {
    setQCardInputValues((prevValues) => ({
      ...prevValues,
      [cardId]: value,
    }));
    checkRequiredInputs(); // Check required inputs whenever an input changes
  };

  const handleRunApp = async () => {
    if (!qAppsClient || authLoading || !qAppId || !qAppData) return;

    try {
      const payload = {
        instanceId: APPLICATION_ID,
        appId: qAppId,
        appVersion: qAppData.appVersion,
        initialValues: qAppData.appDefinition.cards
          .map((card) => {
            const cardData = card[Object.keys(card)[0]];
            const cardId = cardData.id;
            const defaultValue = cardData.defaultValue;
            const value = qCardInputValues[cardId] || defaultValue || '';
            return value ? { cardId, value } : null;
          })
          .filter(Boolean),
      };

      const start_command = new StartQAppSessionCommand(payload);
      const start_response = await qAppsClient.send(start_command);

      if (start_response) {
        setIsPolling(true);
        setQSessionId(start_response.sessionId);
      }
    } catch (error) {
      console.error('Error starting app session:', error);
      setError(error);
    }
  };

  const checkRequiredInputs = () => {
    if (!qAppData?.appDefinition?.cards) return;

    const incompleteCards = qAppData.appDefinition.cards.some((card) => {
      const cardData = card[Object.keys(card)[0]];
      const cardId = cardData.id;
      const isTextInput = cardData.type === 'text-input';
      const defaultValue = cardData.defaultValue;
      const userInput = qCardInputValues[cardId];

      return isTextInput && !userInput && !defaultValue;
    });
    setRunActive(incompleteCards);
  };

  const fetchApp = async () => {
    if (!qAppsClient || authLoading || !qAppId) return;

    try {
      setLoading(true);
      const input = { instanceId: APPLICATION_ID, appId: qAppId };
      const command = new GetQAppCommand(input);
      const response = await qAppsClient.send(command);
      setqAppData(response);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!qSsessionId) return;

    const fetchSessionDetails = async () => {
      try {
        setLoading(true);
        const input = {
          instanceId: APPLICATION_ID,
          sessionId: qSsessionId,
        };
        const command = new GetQAppSessionCommand(input);
        const response = await qAppsClient.send(command);
        setQSessionDetails(response);
      } catch (err) {
        setError(err);
        console.error('Error fetching session details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSessionDetails();

    const intervalId = setInterval(() => {
      if (isPolling) {
        fetchSessionDetails();
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [qSsessionId, qAppsClient, isPolling]);

  useEffect(() => {
    fetchApp();
  }, [qAppId]);

  useEffect(() => {
    if (qAppData?.appDefinition?.cards) {
      checkRequiredInputs();
    }
  }, [qAppData]);

  useEffect(() => {
    if (!qSessionDetails) return;

    if (qSessionDetails.status === 'WAITING' || qSessionDetails.status === 'IN_PROGRESS') {
      setIsPolling(true);
      setRunActive('disabled');
    } else {
      setIsPolling(false);
      setRunActive('enabled');
    }
  }, [qSessionDetails, setIsPolling, setRunActive]);

  useEffect(() => {
    if (qSessionDetails?.cardStatus) {
      const updatedInputValues = {};
      Object.entries(qSessionDetails.cardStatus).forEach(([cardId, status]) => {
        updatedInputValues[cardId] = status.currentValue;
      });

      setQCardInputValues((prevValues) => ({
        ...prevValues,
        ...updatedInputValues,
      }));
    }
  }, [qSessionDetails]);

  if (!numaAppData) {
    return <Preloader />;
  }

  return (
    <>
      {error && <Alert variant="danger">{error.message || 'An error occurred'}</Alert>}
      {loading ? (
        <Preloader />
      ) : qAppData ? (
        <QAppWizard
          qAppData={qAppData}
          onInputChange={handleInputChange}
          qCardInputValues={qCardInputValues}
          onRunApp={handleRunApp}
          sessionResults={qSessionDetails}
        />
      ) : (
        <div>Error fetching app details</div>
      )}
    </>
  );
};

export { QAppDetail };
