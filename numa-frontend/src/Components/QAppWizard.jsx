import { useState, useMemo, useCallback, useEffect } from 'react';
import { Container, Row, Col, Card, Button } from 'react-bootstrap';
import { AppCard } from './AppCard';
import { WizardNavigation } from './WizardNavigation';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';


const QAppWizard = ({ qAppData, onInputChange, qCardInputValues, onRunApp, sessionResults }) => {
  const {
    runActive,
    appRunning,
    processingProgress,
    processingStatus,
    isPolling,
    setAppRunning,
    setProcessingProgress,
    setProcessingStatus,
  } = useNumaApp();

  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState({});

  // Reset appRunning when session is complete
  useEffect(() => {
    if (sessionResults?.status && !['WAITING', 'IN_PROGRESS'].includes(sessionResults.status)) {
      setAppRunning(false);
    }
  }, [sessionResults, setAppRunning]);

  // Initialize completedSteps with default values
  useEffect(() => {
    if (qAppData?.appDefinition?.cards) {
      const newCompletedSteps = { ...completedSteps };
      qAppData.appDefinition.cards.forEach(card => {
        const cardData = getCardData(card);
        if (cardData.defaultValue) {
          newCompletedSteps[cardData.id] = true;
        }
      });
      setCompletedSteps(newCompletedSteps);
    }
  }, [qAppData]);

  // Update completedSteps when input changes
  useEffect(() => {
    const newCompletedSteps = { ...completedSteps };
    Object.entries(qCardInputValues).forEach(([cardId, value]) => {
      newCompletedSteps[cardId] = Boolean(value);
    });
    setCompletedSteps(newCompletedSteps);
  }, [qCardInputValues]);

  // Memoize the getCardData function
  const getCardData = useCallback((card) => {
    const cardType = Object.keys(card)[0];
    return card[cardType];
  }, []);

  // Get all dependencies from cards
  const cardDependencies = useMemo(() => {
    if (!qAppData?.appDefinition?.cards) return new Set();

    const deps = new Set();
    qAppData.appDefinition.cards.forEach(card => {
      const cardData = getCardData(card);
      if (cardData.dependencies && Array.isArray(cardData.dependencies)) {
        cardData.dependencies.forEach(dep => deps.add(dep));
      }
    });
    return deps;
  }, [qAppData, getCardData]);

  // Check if a card is required (is a dependency for another card)
  const isCardRequired = useCallback((cardId) => {
    return cardDependencies.has(cardId);
  }, [cardDependencies]);

  // Organize cards by type
  const cards = useMemo(() =>
    qAppData?.appDefinition?.cards || [],
    [qAppData]
  );

  const inputCards = useMemo(() =>
    cards.filter(card => {
      const cardData = getCardData(card);
      return cardData.type === 'text-input' || cardData.type === 'file-input';
    }),
    [cards, getCardData]
  );

  const outputCards = useMemo(() =>
    cards.filter(card => {
      const cardData = getCardData(card);
      return cardData.type === 'q-query' || cardData.type === 'text-output';
    }),
    [cards, getCardData]
  );

  // Memoize step completion check
  const isStepComplete = useCallback((index) => {
    const allCards = [...inputCards, ...outputCards];
    const card = allCards[index];
    if (!card) return false;

    const cardData = getCardData(card);
    const cardId = cardData.id;

    // For input cards, check if they have a value
    if (index < inputCards.length) {
      return Boolean(qCardInputValues[cardId] || cardData.defaultValue || completedSteps[cardId]);
    }

    // For output cards, they're complete if their status is COMPLETED
    return sessionResults?.cardStatus?.[cardId]?.currentState === 'COMPLETED';
  }, [inputCards, outputCards, qCardInputValues, completedSteps, sessionResults, getCardData]);

  const handleStepClick = useCallback((index) => {
    const maxAllowedStep = [...inputCards, ...outputCards].findIndex((card, i) => !isStepComplete(i) && i !== activeStep);
    if (maxAllowedStep === -1 || index <= maxAllowedStep) {
      setActiveStep(index);
    }
  }, [inputCards, outputCards, isStepComplete, activeStep]);

  const handleRunApp = useCallback(async (e) => {
    e.preventDefault();
    try {
      setAppRunning(true);
      // Mark all input steps as complete
      const newCompletedSteps = { ...completedSteps };
      inputCards.forEach(card => {
        const cardData = getCardData(card);
        newCompletedSteps[cardData.id] = true;
      });
      setCompletedSteps(newCompletedSteps);

      // Move to first output step
      if (outputCards.length > 0) {
        const targetStep = inputCards.length;
        setActiveStep(targetStep);
      }

      await onRunApp();
    } catch (error) {
      console.error('Error running app:', error);
      setAppRunning(false);
    }
  }, [completedSteps, inputCards, outputCards, onRunApp, setAppRunning, getCardData]);

  // Add effect to handle active state when running app
  useEffect(() => {
    if (appRunning && outputCards.length > 0) {
      const targetStep = inputCards.length;
      setActiveStep(targetStep);
    }
  }, [appRunning, outputCards.length, inputCards.length]);

  // Check if all required tasks are complete
  const areRequiredTasksComplete = useCallback(() => {
    return inputCards.every(card => {
      const cardData = getCardData(card);
      if (isCardRequired(cardData.id)) {
        return Boolean(qCardInputValues[cardData.id] || cardData.defaultValue);
      }
      return true;
    });
  }, [inputCards, getCardData, isCardRequired, qCardInputValues]);

  // Format cards for the wizard navigation
  const preRunSteps = useMemo(() =>
    inputCards.map(card => {
      const cardData = getCardData(card);
      return {
        id: cardData.id,
        title: cardData.title || 'Untitled',
        required: isCardRequired(cardData.id),
      };
    }),
    [inputCards, getCardData, isCardRequired]
  );

  const postRunSteps = useMemo(() =>
    outputCards.map(card => {
      const cardData = getCardData(card);
      return {
        id: cardData.id,
        title: cardData.title || 'Untitled',
      };
    }),
    [outputCards, getCardData]
  );

  const isStepDisabled = useCallback((index) => {
    const maxAllowedStep = [...inputCards, ...outputCards].findIndex((card, i) => !isStepComplete(i) && i !== activeStep);
    return maxAllowedStep !== -1 && index > maxAllowedStep;
  }, [inputCards, outputCards, isStepComplete, activeStep]);

  const allCards = useMemo(() =>
    [...inputCards, ...outputCards],
    [inputCards, outputCards]
  );

  const currentCard = useMemo(() =>
    allCards[activeStep],
    [allCards, activeStep]
  );

  // Calculate progress based on completed output cards
  const calculateProgress = useCallback(() => {
    if (!outputCards.length || !sessionResults?.cardStatus) return 0;

    const completedCards = outputCards.filter(card => {
      const cardData = getCardData(card);
      return sessionResults.cardStatus[cardData.id]?.currentState === 'COMPLETED';
    });

    return (completedCards.length / outputCards.length) * 100;
  }, [outputCards, sessionResults, getCardData]);

  useEffect(() => {
    if (appRunning || isPolling) {
      const progress = calculateProgress();
      setProcessingProgress(progress);
      setProcessingStatus(progress === 100 ? 'Complete!' : 'Processing...');
    } else {
      setProcessingProgress(0);
      setProcessingStatus('');
    }
  }, [appRunning, isPolling, calculateProgress, sessionResults]);

  const handlePrevStep = () => {
    if (activeStep > 0) {
      const newStep = activeStep - 1;
      setActiveStep(newStep);
    }
  };

  const handleNextStep = () => {
    if (activeStep < preRunSteps.length - 1) {
      const newStep = activeStep + 1;
      setActiveStep(newStep);
    }
  };

  if (!qAppData?.appDefinition?.cards) {
    return <div>
              { <Preloader smallscreen={true} overlayParent={true} />}</div>;
  }

  // Show results section after clicking Run
  const showResults = appRunning || isPolling || (sessionResults && sessionResults.status === 'COMPLETED');

  return (
    <Container fluid className="app-wizard py-3 py-md-4">
      <Row className="g-3 mx-0">
        <Col xs={12} className="px-2">
          <div className="app-wizard">
            <div className="wizard-container">
              <WizardNavigation
                preRunSteps={preRunSteps}
                postRunSteps={postRunSteps}
                activeStep={activeStep}
                onStepClick={handleStepClick}
                isStepComplete={isStepComplete}
                isStepDisabled={isStepDisabled}
                processingProgress={processingProgress}
                processingStatus={processingStatus}
                runButtonProps={{
                  isRunning: appRunning || isPolling,
                  disabled: !areRequiredTasksComplete() || appRunning || isPolling,
                  onClick: handleRunApp,
                }}
              />
            </div>

            <div className="wizard-content">
              {/* Show current card during input phase */}
              {currentCard && !showResults && (
                <>

                  <AppCard
                    key={getCardData(currentCard).id}
                    card={currentCard}
                    dependencies={getCardData(currentCard).dependencies || []}
                    appsCards={qAppData.appDefinition.cards}
                    onInputChange={(value) => {
                      const cardData = getCardData(currentCard);
                      onInputChange(cardData.id, value);
                    }}
                    inputValue={qCardInputValues[getCardData(currentCard).id]}
                    sessionResults={sessionResults}
                  />
                  <div className="task-navigation">
                    <Button
                      variant="primary"
                      onClick={handlePrevStep}
                      disabled={activeStep === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleNextStep}
                      disabled={
                        activeStep === preRunSteps.length - 1 ||
                        (!completedSteps[getCardData(currentCard).id] &&
                         !getCardData(currentCard).defaultValue)
                      }
                    >
                      Next
                    </Button>
                  </div>
                  </>
              )}

              {/* Show results section after running */}
              {showResults && (
                <div className="results-section">
                  {outputCards.map(card => (
                    <div key={getCardData(card).id} className="mb-3">

                          <AppCard
                            card={card}
                            dependencies={getCardData(card).dependencies || []}
                            appsCards={qAppData.appDefinition.cards}
                            onInputChange={() => {}}
                            sessionResults={sessionResults}
                          />


                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export { QAppWizard };
