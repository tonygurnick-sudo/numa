import { useState, useEffect } from 'react';
import { Alert, Col } from 'react-bootstrap';

import { AppCard } from './AppCard';
import { Preloader } from './Preloader';

import { useAuth } from '../Providers/AuthProvider';
import { GetQAppCommand, GetQAppSessionCommand } from '@aws-sdk/client-qapps';
import { NumaChat } from '../Pages/NumaChat';

const QAppDetail = ({
  setRunActive,
  qAppId,
  setqAppData,
  qAppData,
  setIsPolling,
  isPolling,
  qSsessionId,
  setCardInputValues,
  cardInputValues,
}) => {
  const { qAppsClient, loading: authLoading } = useAuth();
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const [isLoading, setIsLoading] = useState(true);
  const [qSessionDetails, setQSessionDetails] = useState(null);
  const [error, setError] = useState(null);

  // Update specific card's input value
  const handleInputChange = (cardId, value) => {
    setCardInputValues((prevValues) => ({
      ...prevValues,
      [cardId]: value,
    }));
    checkRequiredInputs(); // Check required inputs whenever an input changes
  };

  const checkRequiredInputs = () => {
    const incompleteCards = qAppData?.appDefinition?.cards.some((card) => {
      const cardId = card[Object.keys(card)[0]].id;
      const isTextInput = card[Object.keys(card)[0]].type === 'text-input';
      const defaultValue = card[Object.keys(card)[0]].defaultValue;
      const userInput = cardInputValues[cardId];

      return isTextInput && !userInput && !defaultValue; // Check if required input is missing
    });
    setRunActive(incompleteCards); // Enable/disable based on completeness
  };

  const fetchApp = async () => {
    if (!qAppsClient || authLoading) return;

    try {
      const input = { instanceId: APPLICATION_ID, appId: qAppId };
      const command = new GetQAppCommand(input);
      const response = await qAppsClient.send(command);
      setqAppData(response);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
      setError(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!qSsessionId) return;

    const fetchSessionDetails = async () => {
      try {
        setIsLoading(true);
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
        setIsLoading(false);
      }
    };

    fetchSessionDetails();

    // Set up polling
    const intervalId = setInterval(() => {
      if (isPolling) {
        fetchSessionDetails();
      }
    }, 5000); // Poll every 5 seconds

    // Clear interval on component unmount or when sessionId changes
    return () => clearInterval(intervalId);
  }, [qSsessionId, qAppsClient, isPolling]);

  // Fetch app details on mount
  useEffect(() => {
    fetchApp();
  }, [qAppId]); //

  // Check required inputs whenever app details change
  useEffect(() => {
    if (qAppData?.appDefinition?.cards) {
      checkRequiredInputs();
    }
  }, [qAppData]);

  // Start polling when the session is active
  useEffect(() => {
    if (
      qSessionDetails &&
      (qSessionDetails.status === 'WAITING' ||
        qSessionDetails.status === 'IN_PROGRESS')
    ) {
      setIsPolling(true);
      setRunActive('disabled');
    } else {
      setIsPolling(false);
    }
  }, [qSessionDetails]);

  // update input values when session details change
  useEffect(() => {
    if (qSessionDetails && qSessionDetails.cardStatus) {
      const updatedInputValues = {};

      Object.entries(qSessionDetails.cardStatus).forEach(([cardId, status]) => {
        updatedInputValues[cardId] = status.currentValue;
      });

      setCardInputValues((prevValues) => ({
        ...prevValues,
        ...updatedInputValues,
      }));
    }
  }, [qSessionDetails]);

  return (
    <>
      {error && <Alert variant="danger">{error}</Alert>}
      {isLoading ? (
        <Preloader />
      ) : qAppData ? (
        qAppData.name === 'Numa Chat' ? (
          <NumaChat />
        ) : (
          qAppData.appDefinition?.cards?.map((card) => {
            const cardKey = Object.keys(card)[0];
            const cardData = card[cardKey];
            return (
              <Col
                key={cardData.id}
                sm={12}
                md={6}
                lg={6}
                xl={6}
                className="flex"
              >
                <AppCard
                  card={card}
                  dependencies={cardData.dependencies || []}
                  appsCards={qAppData.appDefinition.cards}
                  onInputChange={handleInputChange}
                  inputValue={
                    cardInputValues[cardData.id] || cardData.defaultValue
                  }
                />
              </Col>
            );
          })
        )
      ) : (
        <p>Error fetching app details</p>
      )}
    </>
  );
};

export { QAppDetail };
