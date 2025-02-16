import { useState, useMemo, useCallback } from 'react';
import { Container, Row, Col, Card, Button, Alert } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { TextInputModule } from '../Modules/TextInputModule';
import { TextOutputModule } from '../Modules/TextOutputModule';
import { WizardNavigation } from './WizardNavigation';
import { Preloader } from '../Components/Preloader';

const AppWizard = ({ manifest }) => {
  const {
    taskCompletionStatus,
    handleRunButtonClick,
    runActive,
    numaAppData,
    appRunning,
    setTaskCompletionStatus,
    updateTaskCompletionStatus,
    updateTaskInputValue,
    processingProgress,
    processingStatus,
    setAppRunning,
    taskInputValues,
    setTaskInputValues,
    setError,
    selectedTaskId,
    setSelectedTaskId,
    activeStep,
    setActiveStep,
    error,
    hasRun,
    setHasRun,
  } = useNumaApp();

  // Filter out hidden tasks and system tasks (q-app and http-request)
  const visibleTasks = useMemo(
    () =>
      manifest?.tasks?.filter((task) => !task.hidden && task.type !== 'q-app' && task.type !== 'http-request') || [],
    [manifest?.tasks],
  );

  // Split tasks into pre-run and post-run groups
  const preRunTasks = useMemo(() => visibleTasks.filter((task) => !task.type.includes('output')), [visibleTasks]);

  const postRunTasks = useMemo(() => visibleTasks.filter((task) => task.type.includes('output')), [visibleTasks]);

  // Mark tasks with default content as complete when navigating
  const markDefaultContentComplete = useCallback(
    (taskIndex) => {
      const currentTask = visibleTasks[taskIndex];
      if (currentTask?.defaultContent && !taskCompletionStatus[currentTask.id]) {
        updateTaskCompletionStatus(currentTask.id, true);
      }
    },
    [visibleTasks, taskCompletionStatus, updateTaskCompletionStatus],
  );

  const handleStepClick = useCallback(
    (index) => {
      const task = visibleTasks[index];
      if (task) {
        // For output tasks, always allow clicking if there are results
        if (task.type.includes('output')) {
          setActiveStep(index);
          setSelectedTaskId(task.id);
          return;
        }

        // For input tasks, check if we can navigate there
        const maxAllowedStep = visibleTasks.findIndex((task, i) => !taskCompletionStatus[task.id] && i !== activeStep);
        if (maxAllowedStep === -1 || index <= maxAllowedStep) {
          markDefaultContentComplete(activeStep); // Mark current task if it has default content
          setActiveStep(index);
          setSelectedTaskId(task.id);
        }
      }
    },
    [visibleTasks, taskCompletionStatus, activeStep, markDefaultContentComplete, setSelectedTaskId],
  );

  const handleRunApp = async () => {
    try {
      // Reset task completion status
      const updatedStatus = {};
      visibleTasks.forEach((task) => {
        updatedStatus[task.id] = false;
      });
      setTaskCompletionStatus(updatedStatus);

      // Find and set the first output task as active immediately
      const firstOutputTask = visibleTasks.find((task) => task.type.includes('output'));

      if (firstOutputTask) {
        const outputIndex = visibleTasks.indexOf(firstOutputTask);
        setActiveStep(outputIndex);
        setSelectedTaskId(firstOutputTask.id);
      }

      setHasRun(true);
      setAppRunning(true);
      await handleRunButtonClick(numaAppData);
    } catch (error) {
      console.error('Error running app:', error);
      setError(error);
    } finally {
      setAppRunning(false);
    }
  };

  const isStepComplete = useCallback(
    (index) => {
      const task = visibleTasks[index];
      return task ? taskCompletionStatus[task.id] || false : false;
    },
    [visibleTasks, taskCompletionStatus],
  );

  const isStepDisabled = useCallback(
    (index) => {
      const maxAllowedStep = visibleTasks.findIndex((task, i) => !taskCompletionStatus[task.id] && i !== activeStep);
      return maxAllowedStep !== -1 && index > maxAllowedStep;
    },
    [visibleTasks, taskCompletionStatus, activeStep],
  );

  const handleTaskCompletion = (taskId, success = true) => {
    updateTaskCompletionStatus(taskId, success);
  };

  const handleTaskInputChange = useCallback(
    (taskId, value) => {
      setTaskInputValues((prev) => ({
        ...prev,
        [taskId]: value,
      }));
      updateTaskCompletionStatus(taskId, Boolean(value));
      // Call updateTaskInputValue to ensure proper state management
      updateTaskInputValue(taskId, value);
    },
    [setTaskInputValues, updateTaskCompletionStatus, updateTaskInputValue],
  );

  const handlePrevStep = () => {
    if (activeStep > 0) {
      const newStep = activeStep - 1;
      setActiveStep(newStep);
      markDefaultContentComplete(newStep);
    }
  };

  const handleNextStep = () => {
    if (activeStep < visibleTasks.length - 1) {
      const newStep = activeStep + 1;
      setActiveStep(newStep);
      markDefaultContentComplete(newStep);
    }
  };

  const renderTask = (task) => {
    const handleComplete = () => handleTaskCompletion(task.id, true);
    const handleNotComplete = () => handleTaskCompletion(task.id, false);

    const commonProps = {
      task: task,
      onComplete: handleComplete,
      onNotComplete: handleNotComplete,
      value: taskInputValues[task.id],
      onChange: (value) => handleTaskInputChange(task.id, value),
    };

    switch (task.type) {
      case 'text-input':
        return <TextInputModule key={task.id} {...commonProps} />;
      case 's3-upload':
        return <S3UploadModule key={task.id} {...commonProps} />;
      case 'text-output':
        return <TextOutputModule key={task.id} task={task} />;
      default:
        return <p key={task.id}>Unknown task type</p>;
    }
  };

  if (!numaAppData) {
    return (
      <div>
        <Preloader smallscreen={true} overlayParent={true} />
      </div>
    );
  }

  return (
    <Container fluid className="app-wizard">
      <Row>
        <Col xs={12} className="px-2 px-md-4">
          <WizardNavigation
            preRunSteps={preRunTasks}
            postRunSteps={postRunTasks}
            activeStep={activeStep}
            handlePrevStep={handlePrevStep}
            handleNextStep={handleNextStep}
            visibleTasks={visibleTasks}
            taskCompletionStatus={taskCompletionStatus}
            onStepClick={handleStepClick}
            isStepComplete={isStepComplete}
            isStepDisabled={isStepDisabled}
            runButtonProps={{
              disabled: runActive === 'disabled',
              isRunning: appRunning,
              onClick: handleRunApp,
            }}
            processingProgress={processingProgress}
            processingStatus={processingStatus}
            hasRun={hasRun}
          />

          {/* Error and Processing Status */}
          <div className="mt-2" style={{ maxWidth: '600px', margin: '0 auto' }}>
            {error && (
              <Alert variant="danger" onClose={() => setError(null)} dismissible className="py-2">
                {error.message || error}
              </Alert>
            )}
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12} className="px-2 px-md-4 position-relative">
          {activeStep < visibleTasks.length && (
            <div className="mb-4 position-relative">
              {renderTask(visibleTasks[activeStep])}
              <div
                className="task-navigation position-absolute start-0 end-0 d-flex justify-content-between"
                style={{ bottom: '-50px' }}
              >
                {activeStep < visibleTasks.length && (
                  <>
                    <Button variant="primary" onClick={handlePrevStep} disabled={activeStep === 0}>
                      <i className="bi bi-arrow-left me-2"></i>
                      Previous Input
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleNextStep}
                      disabled={
                        activeStep === visibleTasks.length - 1 || !taskCompletionStatus[visibleTasks[activeStep].id]
                      }
                    >
                      Next Input
                      <i className="bi bi-arrow-right ms-2"></i>
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default AppWizard;
