import { useState, useMemo, useCallback, useEffect } from 'react';
import { Container, Row, Col, Button } from 'react-bootstrap';
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

  // Move to first output step when app starts running
  useEffect(() => {
    if (appRunning && outputCards.length > 0) {
      setActiveStep(inputCards.length); // First output step is after all input steps
    }
  }, [appRunning, inputCards.length, outputCards.length]);

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
      setProcessingProgress(0);

      // Mark all input steps as complete
      const newCompletedSteps = { ...completedSteps };
      inputCards.forEach(card => {
        const cardData = getCardData(card);
        newCompletedSteps[cardData.id] = true;
      });
      setCompletedSteps(newCompletedSteps);

      await onRunApp();
    } catch (error) {
      console.error('Error running app:', error);
      setAppRunning(false);
      setProcessingProgress(0);
    }
  }, [completedSteps, inputCards, onRunApp, setAppRunning, getCardData, setProcessingProgress]);

  // Effect to track session results and update progress
  useEffect(() => {
    if (sessionResults?.status) {
      // Calculate progress based on card statuses
      if (sessionResults.cardStatus) {
        const cards = Object.values(sessionResults.cardStatus);
        const totalCards = cards.length;
        const completedCards = cards.filter(card => card.currentState === 'COMPLETED').length;
        const runningCards = cards.filter(card => card.currentState === 'RUNNING').length;

        // Calculate progress percentage
        const progress = Math.round(((completedCards + (runningCards * 0.5)) / totalCards) * 100);

        if (appRunning || isPolling) {
          setProcessingProgress(progress);
          setProcessingStatus(progress === 100 ? 'Complete!' : 'Processing...');
        }
      }

      // Update app running state
      if (!['WAITING', 'IN_PROGRESS'].includes(sessionResults.status)) {
        setProcessingProgress(100);
        setProcessingStatus('Analysis complete');
        setAppRunning(false);
      }
    }
  }, [sessionResults, setAppRunning, setProcessingProgress, setProcessingStatus, appRunning, isPolling]);

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

  const handlePrevStep = () => {
    if (activeStep > 0) {
      const newStep = activeStep - 1;
      setActiveStep(newStep);
    }
  };

  const handleNextStep = () => {
    if (activeStep < inputCards.length - 1) {
      const newStep = activeStep + 1;
      setActiveStep(newStep);
    }
  };

  if (!qAppData?.appDefinition?.cards) {
    return <div>
              { <Preloader smallscreen={true} overlayParent={true} />}</div>;
  }

  // Show results section after clicking Run
  const showResults = appRunning || isPolling;

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
                handlePrevStep={handlePrevStep}
                handleNextStep={handleNextStep}
                visibleTasks={preRunSteps}
                taskCompletionStatus={completedSteps}
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
              {/* Show either the current card or results */}
              {showResults ? (
                <div className="results-section">
                  {outputCards.map((card) => {
                    const cardData = getCardData(card);
                    return (
                      <AppCard
                        key={cardData.id}
                        card={card}
                        dependencies={cardData.dependencies || []}
                        appsCards={qAppData.appDefinition.cards}
                        sessionResults={sessionResults}
                      />
                    );
                  })}
                </div>
              ) : (
                currentCard && (
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
                  </>
                )
              )}
            </div>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export { QAppWizard };
