import { useState, useEffect } from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { useParams } from 'react-router-dom';

import { Nav } from '../Components/Nav';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { AppCard } from '../Components/AppCard';
import { Preloader } from '../Components/Preloader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { useAuth } from '../Providers/AuthProvider';
import {
  GetQAppCommand,
  GetQAppSessionCommand,
  StartQAppSessionCommand,
} from '@aws-sdk/client-qapps';
import { NumaChat } from '../Pages/NumaChat';

const AppDetail = () => {
  const { qAppsClient, loading: authLoading } = useAuth();
  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';
  const { appId } = useParams(); // Get appId from URL

  const [sessionId, setSessionId] = useState(null); // Initialize sessionId
  const [sessionDetails, setSessionDetails] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [sessionLoading, setLoading] = useState(false);

  const [app, setApp] = useState([]);
  const [runActive, setRunActive] = useState('disabled');
  const [isLoading, setIsLoading] = useState(true);
  const [inputValues, setInputValues] = useState({});

  const [error, setError] = useState(null);

  // Update specific card's input value
  const handleInputChange = (cardId, value) => {
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

    setRunActive(incompleteCards); // Enable/disable based on completeness
  };

  const fetchApp = async () => {
    if (!qAppsClient || authLoading) return;

    try {
      const input = { instanceId: APPLICATION_ID, appId: appId };
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
        setSessionId(start_response.sessionId); // Store sessionId
      }
    } catch (error) {
      console.error('Error starting app session:', error);
      setError(error); // Set error state
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
  }, []); //

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
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row className="align-items-end">
              <Col lg={8} className="px-5">
                {!isLoading && <Breadcrumbs label={app?.title} />}
                <h1>{app?.title}</h1>
                <p>{app?.description}</p>
              </Col>
              <Col lg={4} className="px-5 text-end">
                <div className="d-flex flex-column justify-content-end h-100">
                  <span>
                    Created:{' '}
                    {app?.createdAt
                      ? new Date(app.createdAt).toLocaleString()
                      : ''}
                  </span>
                  <span>Status: {app?.status}</span>
                  <button
                    type="submit"
                    id="submit"
                    className="btn btn-primary x-5 float-end run_btn"
                    disabled={runActive || isPolling || sessionLoading}
                    onClick={handleRunApp}
                  >
                    Run
                  </button>
                </div>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
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
                        inputValue={
                          inputValues[cardData.id] || cardData.defaultValue
                        }
                      />
                    </Col>
                  );
                })
              )
            ) : (
              <p>Error fetching app details</p>
            )}
          </Row>
        </LayoutDashboard>

        <Nav nav1on="on" nav2on="" nav3on="" />
      </div>
    </>
  );
};

export default AppDetail;
