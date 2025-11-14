import type React from 'react';
import { Button } from 'react-bootstrap';
import { CheckCircleFill } from 'react-bootstrap-icons';
import { useEffect, useState } from 'react';
import { useNumaApp } from '../Providers/NumaAppContext';
import EventStreamViewer from './EventStreamViewer';

/* ---------- Local types ---------- */

type Step = {
  id: string;
  title?: string;
  required?: boolean;
};

type RunButtonProps = {
  /** Whether the run is currently happening */
  isRunning: boolean;
  /** Whether the button should be disabled */
  disabled: boolean;
  /** Click handler used on the Button (allowing async handlers too) */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
} & Omit<React.ComponentProps<typeof Button>, 'disabled' | 'onClick'>;

type WizardNavigationProps = {
  preRunSteps: Step[];
  postRunSteps: Step[];
  activeStep: number;
  onStepClick: (index: number) => void;
  isStepComplete?: (index: number) => boolean;
  isStepDisabled?: (index: number) => boolean;
  runButtonProps: RunButtonProps;
  processingProgress: number; // 0..100
  processingStatus: string;
  hasRun: boolean;
  typicalDurationMinutes?: number;

  /* ---- Optional extras passed by AppWizard (not used here, but allowed) ---- */
  handlePrevStep?: () => void;
  handleNextStep?: () => void;
  visibleTasks?: Step[];
  taskCompletionStatus?: Record<string, boolean>;
  results?: readonly unknown[];
};

/* ---------- Component ---------- */

const WizardNavigation: React.FC<WizardNavigationProps> = ({
  preRunSteps,
  postRunSteps,
  activeStep,
  onStepClick,
  isStepComplete,
  isStepDisabled,
  runButtonProps,
  processingProgress: _processingProgress,
  processingStatus: _processingStatus,
  hasRun,
  typicalDurationMinutes,
}) => {
  const { resetAppState, jobEvents, appRunning, numaAppData, job } = useNumaApp();
  const { isRunning, disabled, onClick, ...otherRunButtonProps } = runButtonProps;

  const [wasDisabled, setWasDisabled] = useState<boolean>(true);
  const [showHighlight, setShowHighlight] = useState<boolean>(false);

  // Show post-run steps if app is running or has been run (has results)
  const hasBeenRun: boolean = isRunning || hasRun;

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
            <div className="run-status-text">
              {!isRunning && (
                <>
                  {disabled && (
                    <>
                      Complete the required inputs to run.
                      <br />
                    </>
                  )}
                  {typeof typicalDurationMinutes === 'number' && (
                    <>
                      This app typically takes {typicalDurationMinutes} minute
                      {typicalDurationMinutes > 1 ? 's' : ''}.
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="step-section">
        {(appRunning || (job && jobEvents && jobEvents.length > 0)) && (
          <div className="processing-container">
            <EventStreamViewer
              events={jobEvents || []}
              isRunning={appRunning}
              appName={numaAppData?.manifest?.appName}
              typicalDurationMinutes={typicalDurationMinutes}
              jobStatus={job?.status}
            />
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
