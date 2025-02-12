import { Button, ProgressBar } from 'react-bootstrap';

const WizardNavigation = ({
  preRunSteps,
  postRunSteps,
  activeStep,
  handlePrevStep,
  handleNextStep,
  visibleTasks,
  taskCompletionStatus,
  onStepClick,
  isStepComplete,
  isStepDisabled,
  runButtonProps,
  processingProgress,
  processingStatus,
  hasRun,
}) => {
  const { isRunning, disabled, onClick, ...otherRunButtonProps } = runButtonProps;

  // Show post-run steps if app is running or has been run (has results)
  const hasBeenRun = isRunning || hasRun;

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
                  } ${isStepComplete?.(index) ? 'completed' : ''}`}
                  onClick={() => !isStepDisabled?.(index) && onStepClick(index)}
                >
                  <span className="step-number">{index + 1}</span>
                  <div className="step-label-container">
                    <span className="step-label">{step.title}</span>
                    {step?.required && (
                      <span className="required-label" title="Required item to run">
                        req
                      </span>
                    )}
                  </div>
                </div>
                {index < preRunSteps.length - 1 && <div className="step-connector" />}
              </div>
            ))}
          </div>
        </div>
      </div>

<<<<<<< HEAD
      <div className="task-navigation">
        {activeStep < preRunSteps.length && (
          <>
            <Button variant="primary" onClick={handlePrevStep} disabled={activeStep === 0}>
              <i className="bi bi-arrow-left me-2"></i>
              Previous Input
            </Button>
            <Button
              variant="primary"
              onClick={handleNextStep}
              disabled={activeStep === preRunSteps.length - 1 || !taskCompletionStatus[visibleTasks[activeStep].id]}
            >
              Next Input
              <i className="bi bi-arrow-right ms-2"></i>
            </Button>
          </>
        )}
      </div>

=======
>>>>>>> fa4cca1 (fix: moved prevv next btns)
      <div className="run-button-wrapper">
        <Button
          type="submit"
          id="submit"
          className="run-app-button"
          disabled={disabled}
          onClick={onClick}
          {...otherRunButtonProps}
        >
          {isRunning ? (
            <>
<<<<<<< HEAD
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
=======
              <span
                className="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
              ></span>
>>>>>>> fa4cca1 (fix: moved prevv next btns)
              <span className="ms-2">Running...</span>
            </>
          ) : (
            <>
              Run App{' '}
<<<<<<< HEAD
              <i style={{ lineHeight: '1px' }} className={`bi bi-arrow-right ${!disabled ? 'bounce-icon' : ''}`}></i>
            </>
          )}
        </Button>
        <div className="run-status-text">{!isRunning && disabled && <>Complete the required inputs to run</>}</div>
=======
              <i
                style={{ lineHeight: '1px' }}
                className={`bi bi-arrow-right ${
                  !disabled ? 'bounce-icon' : ''
                }`}
              ></i>
            </>
          )}
        </Button>
        <div className="run-status-text">
          {!isRunning && disabled && (
            <>Complete the required inputs to run</>
          )}
        </div>
>>>>>>> fa4cca1 (fix: moved prevv next btns)
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

        <div className={`section-label step-group post-run ${hasBeenRun ? 'show' : ''}`}>Results</div>
        <div className={`step-group post-run ${hasBeenRun ? 'show' : ''}`}>
<<<<<<< HEAD
=======

>>>>>>> fa4cca1 (fix: moved prevv next btns)
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
