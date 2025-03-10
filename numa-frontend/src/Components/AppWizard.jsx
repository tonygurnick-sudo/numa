import { useMemo, useCallback } from 'react';
import { Container, Row, Col, Button } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
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
    setSelectedTaskId,
    activeStep,
    setActiveStep,
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

  // Define isStepComplete and isStepDisabled first, before they're used in handleStepClick
  const isStepComplete = useCallback(
    (index) => {
      const task = visibleTasks[index];
      return task ? taskCompletionStatus[task.id] || false : false;
    },
    [visibleTasks, taskCompletionStatus],
  );

  const isStepDisabled = useCallback(
    (index) => {
      const task = visibleTasks[index];
      // For output tasks, only disable if we haven't run yet
      if (task?.type.includes('output')) {
        return !hasRun;
      }

      // For input tasks, check if any previous required task is incomplete
      if (!task?.type.includes('output')) {
        // Only check steps before the current one
        for (let i = 0; i < index; i++) {
          const prevTask = visibleTasks[i];
          // If a previous task is required and incomplete, disable this step
          if (prevTask?.required && !taskCompletionStatus[prevTask.id]) {
            return true;
          }
        }
      }

      // Otherwise, allow the step
      return false;
    },
    [visibleTasks, hasRun, taskCompletionStatus],
  );

  // Now we can use isStepDisabled in handleStepClick
  const handleStepClick = useCallback(
    (index) => {
      const task = visibleTasks[index];
      if (task) {
        // For output tasks, only allow clicking if we have results
        if (task.type.includes('output')) {
          if (hasRun) {
            setActiveStep(index);
            setSelectedTaskId(task.id);
          }
          return;
        }

        // For input tasks, check if any previous required task is incomplete
        if (!task.type.includes('output')) {
          // Check if this step should be disabled
          const isDisabled = isStepDisabled(index);
          if (isDisabled) {
            // Don't allow clicking on disabled steps
            return;
          }

          markDefaultContentComplete(activeStep); // Mark current task if it has default content
          setActiveStep(index);
          setSelectedTaskId(task.id);
        }
      }
    },
    [visibleTasks, activeStep, markDefaultContentComplete, setSelectedTaskId, hasRun, isStepDisabled],
  );

  const handleRunApp = async () => {
    try {
      const updatedStatus = {};
      visibleTasks.forEach((task) => {
        updatedStatus[task.id] = false;
      });
      setTaskCompletionStatus(updatedStatus);

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

  const handleTaskCompletion = (taskId, success = true, results = null) => {
    updateTaskCompletionStatus(taskId, success);
    if (results) {
      console.log('results', results);
      if (results.length === 1) {
        updateTaskInputValue(taskId, results[0].filePath);
      } else {
        updateTaskInputValue(taskId, results);
      }
    }
  };

  const handleTaskInputChange = useCallback(
    (taskId, value) => {
      setTaskInputValues((prev) => ({
        ...prev,
        [taskId]: value,
      }));
      // We don't update completion status here anymore
      // Let the module handle it based on required status
      // updateTaskCompletionStatus(taskId, Boolean(value));
      updateTaskInputValue(taskId, value);
    },
    [setTaskInputValues, updateTaskInputValue],
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

  // Navigation control flags
  const isLastInputStep = activeStep + 1 === preRunTasks.length;
  const nextDisabled = isLastInputStep && !appRunning;
  const isLastVisibleStep = activeStep === visibleTasks.length - 1;
  const isCurrentStepIncomplete = !taskCompletionStatus[visibleTasks[activeStep]?.id];

  const renderTask = (task) => {
    const handleComplete = (results) => handleTaskCompletion(task.id, true, results);
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
                      disabled={isLastVisibleStep || isCurrentStepIncomplete || nextDisabled}
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
