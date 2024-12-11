import { useState, useMemo, useCallback } from 'react';
import { Container, Row, Col, Card, Button } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { TextInputModule } from '../Modules/TextInputModule';
import { TextOutputModule } from '../Modules/TextOutputModule';
import { WizardNavigation } from './WizardNavigation';
import { Preloader } from '../Components/Preloader'; // Assuming Preloader is imported from this location

const AppWizard = ({ manifest }) => {
  const {
    taskCompletionStatus,
    handleRunButtonClick,
    runActive,
    numaAppData,
    appRunning,
    setTaskCompletionStatus,
    updateTaskCompletionStatus,
    processingProgress,
    processingStatus,
    setAppRunning,
    taskInputValues,
    setTaskInputValues
  } = useNumaApp();
  const [activeStep, setActiveStep] = useState(0);
  const [hasRun, setHasRun] = useState(false);

  // Filter out hidden tasks and system tasks (q-app and http-request)
  const visibleTasks = useMemo(() => manifest.tasks.filter(task =>
    !task.hidden &&
    task.type !== 'q-app' &&
    task.type !== 'http-request'
  ), [manifest.tasks]);

  // Split tasks into pre-run and post-run groups
  const preRunTasks = useMemo(() =>
    visibleTasks.filter(task => !task.type.includes('output')),
    [visibleTasks]
  );

  const postRunTasks = useMemo(() =>
    visibleTasks.filter(task => task.type.includes('output')),
    [visibleTasks]
  );

  // Mark tasks with default content as complete when navigating
  const markDefaultContentComplete = useCallback((taskIndex) => {
    const currentTask = visibleTasks[taskIndex];
    if (currentTask?.defaultContent && !taskCompletionStatus[currentTask.id]) {
      updateTaskCompletionStatus(currentTask.id, true);
    }
  }, [visibleTasks, taskCompletionStatus, updateTaskCompletionStatus]);

  const handleStepClick = useCallback((index) => {
    const maxAllowedStep = visibleTasks.findIndex((task, i) => !taskCompletionStatus[task.id] && i !== activeStep);
    if (maxAllowedStep === -1 || index <= maxAllowedStep) {
      markDefaultContentComplete(activeStep); // Mark current task if it has default content
      setActiveStep(index);
    }
  }, [visibleTasks, taskCompletionStatus, activeStep, markDefaultContentComplete]);

  const handleRunApp = async (e) => {
    e.preventDefault();
    try {
      // Mark all tasks as complete immediately when running
      const updatedStatus = { ...taskCompletionStatus };
      visibleTasks.forEach(task => {
        updatedStatus[task.id] = true;
      });
      setTaskCompletionStatus(updatedStatus);

      // Find the first output task and set it as active
      const firstOutputIndex = visibleTasks.findIndex(task => task.type.includes('output'));
      if (firstOutputIndex !== -1) {
        setActiveStep(firstOutputIndex);
      }

      setHasRun(true);
      setAppRunning(true);
      await handleRunButtonClick(numaAppData);
    } catch (error) {
      console.error('Error running app:', error);
    } finally {
      // Reset appRunning state after completion
      setAppRunning(false);
    }
  };

  const isStepComplete = useCallback((index) => {
    const task = visibleTasks[index];
    return task ? taskCompletionStatus[task.id] || false : false;
  }, [visibleTasks, taskCompletionStatus]);

  const isStepDisabled = useCallback((index) => {
    const maxAllowedStep = visibleTasks.findIndex((task, i) => !taskCompletionStatus[task.id] && i !== activeStep);
    return maxAllowedStep !== -1 && index > maxAllowedStep;
  }, [visibleTasks, taskCompletionStatus, activeStep]);

  const handleTaskCompletion = (taskId, success = true) => {
    console.log('Task completion called', { taskId, success });
    updateTaskCompletionStatus(taskId, success);
  };

  const handleTaskInputChange = useCallback((taskId, value) => {
    setTaskInputValues(prev => ({
      ...prev,
      [taskId]: value
    }));
    updateTaskCompletionStatus(taskId, Boolean(value));
  }, [setTaskInputValues, updateTaskCompletionStatus]);

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
      onChange: (value) => handleTaskInputChange(task.id, value)
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
    return <div>
      <Preloader smallscreen={true} overlayParent={true} />
    </div>;
  }

  return (
    <Container fluid className="app-wizard">
      <Row>
        <Col xs={12} className="px-2 px-md-4">
          <WizardNavigation
            preRunSteps={preRunTasks}
            postRunSteps={postRunTasks}
            activeStep={activeStep}
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
          />
        </Col>
      </Row>

      <Row>
        <Col xs={12} className="px-2 px-md-4">
          {activeStep < visibleTasks.length && (
            <div className="mb-4">
              {renderTask(visibleTasks[activeStep])}
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
                    activeStep === visibleTasks.length - 1 ||
                    !taskCompletionStatus[visibleTasks[activeStep].id]
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default AppWizard;
