import { Button, ProgressBar } from 'react-bootstrap';
import { CheckCircleFill } from 'react-bootstrap-icons';
import { useEffect, useState } from 'react';
import { useNumaApp } from '../Providers/NumaAppContext';

const WizardNavigation = ({
  preRunSteps,
  postRunSteps,
  activeStep,
  onStepClick,
  isStepComplete,
  isStepDisabled,
  runButtonProps,
  processingProgress,
  processingStatus,
  hasRun,
}) => {
  const { resetAppState } = useNumaApp();
  const { isRunning, disabled, onClick, ...otherRunButtonProps } = runButtonProps;
  const [wasDisabled, setWasDisabled] = useState(true);
  const [showHighlight, setShowHighlight] = useState(false);

  // Show post-run steps if app is running or has been run (has results)
  const hasBeenRun = isRunning || hasRun;

  useEffect(() => {
    if (wasDisabled && !disabled) {
      setShowHighlight(true);
      const timer = setTimeout(() => setShowHighlight(false), 2000);
      return () => clearTimeout(timer);
    }
    setWasDisabled(disabled);
  }, [disabled, wasDisabled]);

  return (
    <div className="wizard-navigation">
      <div className="input-section-wrapper">
        <div className="step-section">
          <div className="section-label">Inputs</div>
          <div className="step-group pre-run">
            {preRunSteps.map((step, index) => (
              <div key={step.id} className="step-container">
                <div
                  className={`step-indicator ${
                    activeStep === index ? 'active' : ''
                  } ${isStepComplete?.(index) ? 'completed' : ''} ${isStepDisabled?.(index) ? 'disabled' : ''}`}
                  onClick={() => !isStepDisabled?.(index) && onStepClick(index)}
                >
                  <span className="step-number">{index + 1}</span>
                  <div className="step-label-container">
                    <span className="step-label">{step.title}</span>
                    {step?.required && !isStepComplete?.(index) && (
                      <span className="required-label" title="Required item to run">
                        req
                      </span>
                    )}
                  </div>
                  {isStepComplete?.(index) && <CheckCircleFill className="step-complete-icon text-success" />}
                </div>
                {index < preRunSteps.length - 1 && <div className="step-connector" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="run-button-wrapper">
        {hasRun ? (
          <Button type="submit" id="reset" className="reset-app-button" onClick={resetAppState}>
            <i className="bi bi-arrow-counterclockwise me-2"></i>
            Reset App
          </Button>
        ) : (
          <>
            <Button
              type="submit"
              id="submit"
              className={`run-app-button ${showHighlight ? 'highlight-ready' : ''}`}
              disabled={disabled}
              onClick={onClick}
              {...otherRunButtonProps}
            >
              {isRunning ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  <span className="ms-2">Running...</span>
                </>
              ) : (
                <div data-testid="run-app-button">
                  Run App{' '}
                  <i
                    style={{ lineHeight: '1px' }}
                    className={`bi bi-arrow-right ${!disabled ? 'bounce-icon' : ''}`}
                  ></i>
                </div>
              )}
            </Button>
            <div className="run-status-text">{!isRunning && disabled && <>Complete the required inputs to run</>}</div>
          </>
        )}
      </div>

      <div className="step-section">
        {isRunning && (
          <div className="processing-container">
            <ProgressBar
              now={processingProgress}
              label={`${Math.round(processingProgress)}%`}
              animated
              variant="primary"
              style={{
                width: '50%',
                margin: '0 auto 10px auto',
              }}
            />
            <div className="processing-status">{processingStatus}</div>
          </div>
        )}

        <div className={`step-group post-run ${hasBeenRun ? 'show' : ''}`}>
          {postRunSteps.map((step, index) => {
            const stepIndex = index + preRunSteps.length;
            return (
              <div key={step.id} className="step-container">
                <div
                  className={`step-indicator ${
                    activeStep === stepIndex ? 'active' : ''
                  } ${isStepComplete?.(stepIndex) ? 'completed' : ''} ${isStepDisabled?.(stepIndex) ? 'disabled' : ''}`}
                  onClick={() => !isStepDisabled?.(stepIndex) && onStepClick(stepIndex)}
                >
                  <div className="step-label-container">
                    <span className="step-label">{step.title}</span>
                  </div>
                </div>
                {index < postRunSteps.length - 1 && <div className="step-connector" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export { WizardNavigation };
