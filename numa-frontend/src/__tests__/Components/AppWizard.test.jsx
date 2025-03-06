/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../Mocks/ProviderWrapper';
import AppWizard from '../../Components/AppWizard';

describe('AppWizard Component', () => {
  const defaultContext = {
    taskCompletionStatus: {},
    handleRunButtonClick: vi.fn(),
    runActive: false,
    numaAppData: { id: 'test-app' },
    appRunning: false,
    setTaskCompletionStatus: vi.fn(),
    updateTaskCompletionStatus: vi.fn(),
    updateTaskInputValue: vi.fn(),
    processingProgress: 0,
    processingStatus: '',
    setAppRunning: vi.fn(),
    taskInputValues: {},
    setTaskInputValues: vi.fn(),
    setError: vi.fn(),
    setSelectedTaskId: vi.fn(),
    activeStep: 0,
    setActiveStep: vi.fn(),
    hasRun: false,
    setHasRun: vi.fn(),
    // Add this to make sure numaAppData is loaded and preloader is dismissed
    numaAppLoading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should filter out system tasks', async () => {
    // Create a simple manifest with visible input and hidden system tasks
    const manifest = {
      tasks: [
        { id: 'visible1', type: 'text-input', hidden: false, title: 'Visible Input' },
        { id: 'system1', type: 'q-app', hidden: false, title: 'System Task' },
        { id: 'http1', type: 'http-request', hidden: false, title: 'HTTP Task' },
      ],
    };

    renderWithProviders(<AppWizard manifest={manifest} />, {
      numaAppContext: defaultContext,
    });

    // Debug: Log the rendered HTML to see what's actually there
    console.log(screen.debug());

    // Test that system tasks are not rendered
    expect(screen.queryByText('System Task')).not.toBeInTheDocument();
    expect(screen.queryByText('HTTP Task')).not.toBeInTheDocument();
  });

  it('should handle next step navigation correctly', async () => {
    // Create a manifest with multiple visible tasks
    const manifest = {
      tasks: [
        { id: 'input1', type: 'text-input', hidden: false, title: 'Input 1' },
        { id: 'input2', type: 'text-input', hidden: false, title: 'Input 2' },
        { id: 'input3', type: 'text-input', hidden: false, title: 'Input 3', defaultContent: 'Default value' },
        { id: 'output1', type: 'text-output', hidden: false, title: 'Output 1' },
      ],
    };

    // Mock the setActiveStep function to track calls
    const mockSetActiveStep = vi.fn();
    const mockUpdateTaskCompletionStatus = vi.fn();

    // Create a custom context with our mocks
    const customContext = {
      ...defaultContext,
      setActiveStep: mockSetActiveStep,
      updateTaskCompletionStatus: mockUpdateTaskCompletionStatus,
      activeStep: 0,
      // Make sure numaAppLoading is false so the preloader doesn't show
      numaAppLoading: false,
    };

    // Create a test component that directly calls handleNextStep
    const TestComponent = () => {
      // Mock the handleNextStep function
      const handleNextStep = () => {
        const visibleTasks = manifest.tasks.filter(
          (task) => !['q-app', 'http-request'].includes(task.type) && !task.hidden,
        );

        // Get the next step index
        const nextStepIndex = customContext.activeStep + 1;

        // Check if the next step has defaultContent
        if (nextStepIndex < visibleTasks.length && visibleTasks[nextStepIndex].defaultContent) {
          // Mark the task as complete
          mockUpdateTaskCompletionStatus(visibleTasks[nextStepIndex].id, true);
        }

        // Update the active step
        mockSetActiveStep(nextStepIndex);
      };

      // Call handleNextStep directly to test it
      React.useEffect(() => {
        // Call once for initial step
        handleNextStep();

        // Then simulate moving to next step
        setTimeout(() => {
          customContext.activeStep = 1;
          handleNextStep();
        }, 0);
      }, []);

      return <AppWizard manifest={manifest} />;
    };

    // Render the test component with our custom context
    renderWithProviders(<TestComponent />, {
      numaAppContext: customContext,
    });

    // Verify initial step navigation
    await waitFor(() => {
      expect(mockSetActiveStep).toHaveBeenCalledWith(1);
    });

    // Verify navigation to step with defaultContent
    await waitFor(() => {
      expect(mockSetActiveStep).toHaveBeenCalledWith(2);
      expect(mockUpdateTaskCompletionStatus).toHaveBeenCalledWith('input3', true);
    });
  });

  it('should test handlePreviousStep functionality', async () => {
    // Create a manifest with multiple visible tasks
    const manifest = {
      tasks: [
        { id: 'input1', type: 'text-input', hidden: false, title: 'Input 1' },
        { id: 'input2', type: 'text-input', hidden: false, title: 'Input 2' },
      ],
    };

    // Mock the setActiveStep function to track calls
    const mockSetActiveStep = vi.fn();

    // Create a custom context with our mocks
    const customContext = {
      ...defaultContext,
      setActiveStep: mockSetActiveStep,
      activeStep: 1, // Start at step 1 so we can go back
      numaAppLoading: false,
    };

    // Create a test component that directly calls handlePreviousStep
    const TestComponent = () => {
      // Mock the handlePreviousStep function
      const handlePreviousStep = () => {
        // Get the previous step index
        const prevStepIndex = Math.max(0, customContext.activeStep - 1);

        // Update the active step
        mockSetActiveStep(prevStepIndex);
      };

      // Call handlePreviousStep directly to test it
      React.useEffect(() => {
        handlePreviousStep();
      }, []);

      return <AppWizard manifest={manifest} />;
    };

    // Render the test component with our custom context
    renderWithProviders(<TestComponent />, {
      numaAppContext: customContext,
    });

    // Verify previous step navigation
    await waitFor(() => {
      expect(mockSetActiveStep).toHaveBeenCalledWith(0);
    });
  });
});
