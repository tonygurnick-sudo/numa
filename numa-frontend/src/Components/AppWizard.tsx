import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Col, Container, Row, Tab, Tabs } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { TextInputModule } from '../Modules/TextInputModule';
import { TextOutputModule } from '../Modules/TextOutputModule';
import { DropdownTableModule } from '../Modules/DropdownTableModule';
import { DropdownModule } from '../Modules/DropdownModule';
import { WizardNavigation } from './WizardNavigation';
import { Preloader } from '../Components/Preloader';
import { ResultsRenderer } from './ResultsRenderer';
import { MarkdownContent } from './MarkdownContent';
import { RunActiveState } from '@/types/apps.ts';

type ManifestTask = {
  id: string;
  type: string;
  title?: string;
  hidden?: boolean;
  required?: boolean;
  defaultContent?: string;
};

type Manifest = {
  tasks: ManifestTask[];
  typicalDurationMinutes?: number;
};

const AppWizard: React.FC<{ manifest: Manifest }> = ({ manifest }) => {
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
    job,
    loadingJobId,
  } = useNumaApp();

  const [activeTab, setActiveTab] = useState(() => {
    if (job?.results) return 'results';
    return 'inputs';
  });

  useEffect(() => {
    if (job && job.results) {
      setActiveTab('results');
    } else {
      setActiveTab('inputs');
    }
  }, [job]);

  const visibleTasks = useMemo(
    () =>
      manifest?.tasks?.filter((task) => !task.hidden && task.type !== 'q-app' && task.type !== 'http-request') || [],
    [manifest?.tasks],
  );

  const preRunTasks = useMemo(() => visibleTasks.filter((task) => !task.type.includes('output')), [visibleTasks]);
  const postRunTasks = useMemo(() => visibleTasks.filter((task) => task.type.includes('output')), [visibleTasks]);

  const markDefaultContentComplete = useCallback(
    (taskIndex) => {
      const currentTask = visibleTasks[taskIndex];
      if (currentTask?.defaultContent && !taskCompletionStatus[currentTask.id]) {
        updateTaskCompletionStatus(currentTask.id, true);
      }
    },
    [visibleTasks, taskCompletionStatus, updateTaskCompletionStatus],
  );

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
      if (task?.type.includes('output')) return !hasRun;

      // For input tasks, disable if any earlier required task is incomplete
      for (let i = 0; i < index; i++) {
        const prevTask = visibleTasks[i];
        if (prevTask?.required && !taskCompletionStatus[prevTask.id]) {
          return true;
        }
      }
      return false;
    },
    [visibleTasks, hasRun, taskCompletionStatus],
  );

  const handleStepClick = useCallback(
    (index) => {
      // If this is a results step (>= preRunTasks.length), only allow if we've run
      if (index >= preRunTasks.length) {
        if (hasRun) setActiveStep(index);
        return;
      }

      // Traditional task navigation
      const task = visibleTasks[index];
      if (!task) return;

      if (task.type.includes('output')) {
        if (hasRun) {
          setActiveStep(index);
          setSelectedTaskId(task.id);
        }
        return;
      }

      const disabled = isStepDisabled(index);
      if (disabled) return;

      markDefaultContentComplete(activeStep);
      setActiveStep(index);
      setSelectedTaskId(task.id);
    },
    [
      visibleTasks,
      activeStep,
      markDefaultContentComplete,
      setSelectedTaskId,
      hasRun,
      isStepDisabled,
      preRunTasks.length,
    ],
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
      setActiveTab('results');
      await handleRunButtonClick(numaAppData);
    } catch (error) {
      console.error('Error running app:', error);
      setError(error);
    } finally {
      setAppRunning(false);
    }
  };

  const handleTaskCompletion = (taskId, success = true, results = null) => {
    if (results) {
      const validFiles = results.filter((file) => file && file.s3_key);
      updateTaskInputValue(taskId, validFiles);
      success = validFiles.length > 0;
    }
    updateTaskCompletionStatus(taskId, success);
  };

  const handleTaskInputChange = useCallback(
    (taskId, value) => {
      if (hasRun) return;
      setTaskInputValues((prev) => ({
        ...prev,
        [taskId]: value,
      }));
      updateTaskInputValue(taskId, value);
    },
    [setTaskInputValues, updateTaskInputValue, hasRun],
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

  // ---- Consolidated "Next" disabled logic (single source of truth) ----
  // includeIncompleteCheck:
  //   - true  -> enforce current-step completeness (Inputs view)
  //   - false -> ignore completeness (Results tab)
  const isNextInputDisabled = useCallback(
    (includeIncompleteCheck = true) => {
      const totalSteps = visibleTasks.length;
      const current = activeStep;

      // 1) At last visible step: no next step exists
      const atLastVisibleStep = totalSteps === 0 || current >= totalSteps - 1;
      if (atLastVisibleStep) return true;

      // 2) At the boundary: next index would be first result step
      const inputStepCount = visibleTasks.filter((t) => !t?.type?.includes('output')).length;
      const atLastInputStep = current + 1 === inputStepCount;
      if (atLastInputStep && !appRunning) return true;

      // 3) Optionally require current step completed (inputs view only)
      if (includeIncompleteCheck) {
        const currentTaskId = visibleTasks[current]?.id;
        const stepIsComplete = !!(currentTaskId && taskCompletionStatus[currentTaskId]);
        if (!stepIsComplete) return true;
      }

      return false;
    },
    [activeStep, visibleTasks, appRunning, taskCompletionStatus],
  );

  const renderTask = (task, index) => {
    // Results step
    if (index >= preRunTasks.length && job?.results && job?.results.length > 0) {
      let outputIndex = index - preRunTasks.length;
      let currentOutput = null;

      for (const result of job.results) {
        if (outputIndex < result.outputs.length) {
          currentOutput = result.outputs[outputIndex];
          break;
        }
        outputIndex -= result.outputs.length;
      }

      if (currentOutput) {
        return (
          <div className="result-output">
            <h3>{currentOutput.title || `Output ${outputIndex + 1}`}</h3>
            <div>
              {currentOutput.content_type === 'text/markdown' ? (
                <MarkdownContent content={currentOutput.data} />
              ) : (
                <pre>{JSON.stringify(currentOutput.data, null, 2)}</pre>
              )}
            </div>
          </div>
        );
      }

      return <p>No output found at index {index}</p>;
    }

    // Traditional task
    const handleComplete = (results) => handleTaskCompletion(task.id, true, results);
    const handleNotComplete = (results) => handleTaskCompletion(task.id, false, results);

    const commonProps = {
      task,
      onComplete: handleComplete,
      onNotComplete: handleNotComplete,
      value: taskInputValues[task.id],
      onChange: (value) => handleTaskInputChange(task.id, value),
      disabled: hasRun,
    };

    switch (task.type) {
      case 'text-input':
        return <TextInputModule hasRun={hasRun} key={task.id} {...commonProps} />;
      case 's3-upload':
        return <S3UploadModule disabled={hasRun} key={task.id} {...commonProps} />;
      case 'dropdown':
        return <DropdownModule hasRun={hasRun} key={task.id} {...commonProps} />;
      case 'dropdown-table':
        return <DropdownTableModule hasRun={hasRun} key={task.id} {...commonProps} />;
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

  if (loadingJobId) {
    return (
      <div>
        <Preloader smallscreen={true} overlayParent={true} />
        <div className="text-center mt-3">
          <p>Loading job results...</p>
        </div>
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
              disabled: runActive === RunActiveState.Disabled,
              isRunning: appRunning,
              onClick: handleRunApp,
            }}
            processingProgress={processingProgress}
            processingStatus={processingStatus}
            hasRun={hasRun}
            results={job?.results}
            typicalDurationMinutes={manifest.typicalDurationMinutes}
          />
        </Col>
      </Row>

      <Row>
        <Col xs={12} className="px-2 px-md-4 position-relative">
          {job?.results && job?.results.length > 0 ? (
            <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k)} className="mb-4">
              <Tab eventKey="inputs" title="Inputs">
                {activeStep < visibleTasks.length ? (
                  <div className="mb-4 position-relative">
                    {renderTask(visibleTasks[activeStep], activeStep)}
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
                          {/* Results tab ignores incomplete-step rule (original behavior) */}
                          <Button variant="primary" onClick={handleNextStep} disabled={isNextInputDisabled(false)}>
                            Next Input
                            <i className="bi bi-arrow-right ms-2"></i>
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </Tab>
              <Tab eventKey="results" title="Results">
                <ResultsRenderer results={job?.results} />
              </Tab>
            </Tabs>
          ) : (
            <div className="mb-4 position-relative">
              {activeStep < visibleTasks.length && (
                <>
                  {renderTask(visibleTasks[activeStep], activeStep)}
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
                        {/* Inputs view enforces completeness (original logic) */}
                        <Button variant="primary" onClick={handleNextStep} disabled={isNextInputDisabled()}>
                          Next Input
                          <i className="bi bi-arrow-right ms-2"></i>
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default AppWizard;
