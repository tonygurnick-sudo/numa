import { useState, useEffect } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';

import { useNavigate } from 'react-router-dom';

import { Nav } from './Nav';
import { Breadcrumbs } from './Breadcrumbs';
import { AppCard } from './AppCard';
import { Preloader } from './Preloader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { useAuth } from '../Providers/AuthProvider';
import { GetQAppCommand, GetQAppSessionCommand } from '@aws-sdk/client-qapps';
import { NumaChat } from '../Pages/NumaChat';

const QAppDetail = ({ setRunActive, numaAppData }) => {
  const navigate = useNavigate();

  const { qAppsClient, loading: authLoading } = useAuth();
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const [sessionId, setSessionId] = useState(null); // Initialize sessionId
  const [sessionDetails, setSessionDetails] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  const [app, setApp] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [inputValues, setInputValues] = useState({});

  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  // Update specific card's input value
  const handleInputChange = (cardId, value) => {
    console.log('input changed');
    setInputValues((prevValues) => ({
      ...prevValues,
      [cardId]: value,
    }));
    checkRequiredInputs(); // Check required inputs whenever an input changes
  };

  const checkRequiredInputs = () => {
    const incompleteCards = app?.appDefinition?.cards.some((card) => {
      const cardId = card[Object.keys(card)[0]].id;
      const isTextInput = card[Object.keys(card)[0]].type === 'text-input';
      const defaultValue = card[Object.keys(card)[0]].defaultValue;
      const userInput = inputValues[cardId];

      return isTextInput && !userInput && !defaultValue; // Check if required input is missing
    });
    console.log('set run to active');
    setRunActive(incompleteCards); // Enable/disable based on completeness
  };

  const fetchApp = async () => {
    if (!qAppsClient || authLoading) return;

    try {
      const input = { instanceId: APPLICATION_ID, appId: numaAppData.qAppId };
      const command = new GetQAppCommand(input);
      const response = await qAppsClient.send(command);
      setApp(response); // Set app details in state
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
      setError(error); // Set error state
    } finally {
      setIsLoading(false); // Stop loading
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    const fetchSessionDetails = async () => {
      try {
        setLoading(true);
        const input = {
          instanceId: APPLICATION_ID,
          sessionId: sessionId,
        };
        const command = new GetQAppSessionCommand(input);
        const response = await qAppsClient.send(command);

        setSessionDetails(response);
      } catch (err) {
        setError(err);
        console.error('Error fetching session details:', err);
      } finally {
        setLoading(false);
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
  }, [sessionId, qAppsClient, isPolling]);

  // Fetch app details on mount
  useEffect(() => {
    fetchApp();
  }, [numaAppData]); //

  // Check required inputs whenever app details change
  useEffect(() => {
    if (app?.appDefinition?.cards) {
      checkRequiredInputs();
    }
  }, [app]);

  // Start polling when the session is active
  useEffect(() => {
    if (
      sessionDetails &&
      (sessionDetails.status === 'WAITING' ||
        sessionDetails.status === 'IN_PROGRESS')
    ) {
      setIsPolling(true);
      setRunActive('disabled');
    } else {
      setIsPolling(false); // Stop polling if status changes
    }
  }, [sessionDetails]);

  // update input values when session details change
  useEffect(() => {
    if (sessionDetails && sessionDetails.cardStatus) {
      const updatedInputValues = {};

      Object.entries(sessionDetails.cardStatus).forEach(([cardId, status]) => {
        updatedInputValues[cardId] = status.currentValue;
      });

      setInputValues((prevValues) => ({
        ...prevValues,
        ...updatedInputValues,
      }));
    }
  }, [sessionDetails]);

  return (
    <>
      {isLoading ? (
        <Preloader />
      ) : app ? (
        app.name === 'Numa Chat' ? (
          <NumaChat />
        ) : (
          app.appDefinition?.cards?.map((card) => {
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
                  appsCards={app.appDefinition.cards}
                  onInputChange={handleInputChange}
                  inputValue={inputValues[cardData.id] || cardData.defaultValue}
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
