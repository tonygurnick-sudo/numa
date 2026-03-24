import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { QAppWizard } from './QAppWizard';
import { Preloader } from '../Preloader';

import { useAuth } from '../../Providers/AuthProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';

import { GetQAppCommand, GetQAppSessionCommand, StartQAppSessionCommand } from '@aws-sdk/client-qapps';

const QAppDetail = () => {
  const { t } = useTranslation('apps');
  const { qAppsClient } = useAuth();
  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');

  const {
    setError,
    setRunActive,
    qSsessionId,
    isPolling,
    setIsPolling,
    numaAppData,
    setqAppData,
    qAppData,
    setQCardInputValues,
    qCardInputValues,
    setQSessionId,
  } = useNumaApp();

  const qAppId = numaAppData?.qAppId;

  const [qSessionDetails, setQSessionDetails] = useState(null);

  // Update specific card's input value
  const handleInputChange = (cardId, value) => {
    setQCardInputValues((prevValues) => ({
      ...prevValues,
      [cardId]: value,
    }));
    checkRequiredInputs(); // Check required inputs whenever an input changes
  };

  const handleRunApp = async () => {
    if (!qAppsClient || !qAppId || !qAppData) return;

    try {
      const payload = {
        instanceId: Q_APPLICATION_ID,
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
    if (!qAppsClient || !qAppId) return;

    try {
      const input = { instanceId: Q_APPLICATION_ID, appId: qAppId };

      const command = new GetQAppCommand(input);

      const response = await qAppsClient.send(command);

      setqAppData(response);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
      setError(error);
    }
  };

  useEffect(() => {
    if (!qSsessionId) return;

    const fetchSessionDetails = async () => {
      try {
        const input = {
          instanceId: Q_APPLICATION_ID,
          sessionId: qSsessionId,
        };
        const command = new GetQAppSessionCommand(input);
        const response = await qAppsClient.send(command);
        console.log('Session details fetched:', response);
        setQSessionDetails(response);
      } catch (err) {
        setError(err);
        console.error('Error fetching session details:', err);
      }
    };

    fetchSessionDetails();

    const intervalId = setInterval(() => {
      if (isPolling) {
        fetchSessionDetails();
      }
    }, 2000);

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
      {qAppData && qCardInputValues ? (
        <QAppWizard
          qAppData={qAppData}
          onInputChange={handleInputChange}
          qCardInputValues={qCardInputValues}
          onRunApp={handleRunApp}
          sessionResults={qSessionDetails}
        />
      ) : (
        <div>{t('qApps.errors.details')}</div>
      )}
    </>
  );
};

export { QAppDetail };
