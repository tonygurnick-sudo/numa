/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, act } from '@testing-library/react';
import { WizardNavigation } from '../../Components/WizardNavigation';

describe('WizardNavigation Component', () => {
  const mockOnStepClick = vi.fn();
  const mockIsStepComplete = vi.fn();
  const mockIsStepDisabled = vi.fn();
  const mockRunButtonClick = vi.fn();

  const defaultProps = {
    preRunSteps: [
      { id: 'step1', title: 'Step 1', required: true },
      { id: 'step2', title: 'Step 2' },
      { id: 'step3', title: 'Step 3' },
    ],
    postRunSteps: [
      { id: 'result1', title: 'Result 1' },
      { id: 'result2', title: 'Result 2' },
    ],
    activeStep: 0,
    onStepClick: mockOnStepClick,
    isStepComplete: mockIsStepComplete,
    isStepDisabled: mockIsStepDisabled,
    runButtonProps: {
      isRunning: false,
      disabled: false,
      onClick: mockRunButtonClick,
    },
    processingProgress: 0,
    processingStatus: '',
    hasRun: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStepComplete.mockImplementation(() => false);
    mockIsStepDisabled.mockImplementation(() => false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should apply disabled class to steps when isStepDisabled returns true', () => {
    // Setup: Make step 2 disabled
    mockIsStepDisabled.mockImplementation((index) => index === 1);

    // Render the component
    const { container } = render(<WizardNavigation {...defaultProps} />);

    // Get all step indicators
    const stepIndicators = container.querySelectorAll('.step-indicator');

    // Verify step 2 has the disabled class
    expect(stepIndicators[1]).toHaveClass('disabled');

    // Verify other steps don't have the disabled class
    expect(stepIndicators[0]).not.toHaveClass('disabled');
    expect(stepIndicators[2]).not.toHaveClass('disabled');
  });

  it('should not trigger onClick for disabled steps', () => {
    // Setup: Make step 2 disabled
    mockIsStepDisabled.mockImplementation((index) => index === 1);

    // Render the component
    const { container } = render(<WizardNavigation {...defaultProps} />);

    // Get all step indicators
    const stepIndicators = container.querySelectorAll('.step-indicator');

    // Click on step 2 (disabled)
    fireEvent.click(stepIndicators[1]);

    // Verify onStepClick was not called for the disabled step
    expect(mockOnStepClick).not.toHaveBeenCalledWith(1);

    // Click on step 3 (not disabled)
    fireEvent.click(stepIndicators[2]);

    // Verify onStepClick was called for the non-disabled step
    expect(mockOnStepClick).toHaveBeenCalledWith(2);
  });

  it('should show completed steps with check icon', () => {
    // Setup: Make step 1 completed
    mockIsStepComplete.mockImplementation((index) => index === 0);

    // Render the component
    const { container } = render(<WizardNavigation {...defaultProps} />);

    // Get all step indicators
    const stepIndicators = container.querySelectorAll('.step-indicator');

    // Verify step 1 has the completed class
    expect(stepIndicators[0]).toHaveClass('completed');

    // Verify the check icon is present in step 1
    const checkIcon = stepIndicators[0].querySelector('.step-complete-icon');
    expect(checkIcon).toBeInTheDocument();
  });

  it('should show required label for incomplete required steps', () => {
    // Setup: Step 1 is required and not complete
    mockIsStepComplete.mockImplementation(() => false);

    // Render the component
    const { container } = render(<WizardNavigation {...defaultProps} />);

    // Check for the required label in step 1
    const requiredLabel = container.querySelector('.required-label');
    expect(requiredLabel).toBeInTheDocument();
    expect(requiredLabel).toHaveTextContent('req');
  });

  it('should show post-run steps when hasRun is true', () => {
    // Render with hasRun = true
    const { container } = render(<WizardNavigation {...defaultProps} hasRun={true} />);

    // Check that post-run steps are visible
    const postRunGroup = container.querySelector('.step-group.post-run.show');
    expect(postRunGroup).toBeInTheDocument();

    // Check that both result steps are rendered
    const resultSteps = container.querySelectorAll('.step-group.post-run.show .step-indicator');
    expect(resultSteps.length).toBe(2);
  });

  it('should show processing status when app is running', () => {
    // Render with isRunning = true
    const props = {
      ...defaultProps,
      runButtonProps: {
        ...defaultProps.runButtonProps,
        isRunning: true,
      },
      processingProgress: 75,
      processingStatus: 'Processing data...',
    };

    const { container } = render(<WizardNavigation {...props} />);

    // Check that progress bar is shown
    const progressBar = container.querySelector('.progress-bar');
    expect(progressBar).toBeInTheDocument();

    // Check progress percentage
    expect(progressBar).toHaveAttribute('aria-valuenow', '75');

    // Check status text
    const statusText = container.querySelector('.processing-status');
    expect(statusText).toHaveTextContent('Processing data...');
  });

  it('should highlight run button when it becomes enabled', () => {
    // First render with disabled button
    const props = {
      ...defaultProps,
      runButtonProps: {
        ...defaultProps.runButtonProps,
        disabled: true,
      },
    };

    const { container, rerender } = render(<WizardNavigation {...props} />);

    // Now rerender with enabled button
    const enabledProps = {
      ...defaultProps,
      runButtonProps: {
        ...defaultProps.runButtonProps,
        disabled: false,
      },
    };

    rerender(<WizardNavigation {...enabledProps} />);

    // Check that highlight class is applied
    const runButton = container.querySelector('.run-app-button');
    expect(runButton).toHaveClass('highlight-ready');

    // Advance timers to remove highlight
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Check that highlight is removed
    expect(runButton).not.toHaveClass('highlight-ready');
  });

  it('should show run button with correct text based on state', () => {
    // Test running state
    const runningProps = {
      ...defaultProps,
      runButtonProps: {
        ...defaultProps.runButtonProps,
        isRunning: true,
      },
    };

    const { getByText, rerender } = render(<WizardNavigation {...runningProps} />);
    expect(getByText('Running...')).toBeInTheDocument();

    // Test not running state
    rerender(<WizardNavigation {...defaultProps} />);
    expect(getByText('Run App')).toBeInTheDocument();
  });

  it('should show status text when button is disabled', () => {
    // Test with disabled button
    const disabledProps = {
      ...defaultProps,
      runButtonProps: {
        ...defaultProps.runButtonProps,
        disabled: true,
        isRunning: false,
      },
    };

    const { getByText } = render(<WizardNavigation {...disabledProps} />);
    expect(getByText('Complete the required inputs to run')).toBeInTheDocument();
  });

  it('should handle run button click', () => {
    const { container } = render(<WizardNavigation {...defaultProps} />);

    // Find and click the run button
    const runButton = container.querySelector('.run-app-button');
    fireEvent.click(runButton);

    // Verify the click handler was called
    expect(mockRunButtonClick).toHaveBeenCalledTimes(1);
  });
});
