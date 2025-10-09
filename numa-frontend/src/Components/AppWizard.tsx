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

import type { ReactElement } from 'react';

export type TaskId = string;

export type FileResult = {
  s3_key: string;
  [key: string]: unknown;
};

export type TaskCompletionHandler = (taskId: TaskId, results?: FileResult[] | null) => void;

type InputTaskType = 'text-input' | 's3-upload' | 'dropdown' | 'dropdown-table';
type OutputTaskType = 'text-output';
// other task types that we explicitly hide from the wizard flow:
type HiddenTaskType = 'q-app' | 'http-request';

export type TaskType = InputTaskType | OutputTaskType | HiddenTaskType | (string & {}); // permit forward-compat

export type ManifestTask = {
  id: TaskId;
  type: TaskType;
  title?: string;
  hidden?: boolean;
  required?: boolean;
  defaultContent?: string;
};

export type Manifest = {
  tasks: ManifestTask[];
  typicalDurationMinutes?: number;
};

export type VisibleTask = ManifestTask & { hidden?: false };

export type TaskCompletionStatus<T extends ManifestTask[]> = {
  [K in T[number]['id']]?: boolean;
};

export type TaskInputValue = unknown;
export type HandleTaskInputChange = (taskId: TaskId, value: TaskInputValue) => void;
export type HandleStepNavigation = () => void;

type ActiveTab = 'inputs' | 'results';

type NextDisableInputs<T extends VisibleTask[]> = {
  tasks: T;
  completion: TaskCompletionStatus<T>;
  activeIndex: number;
  preRunCount: number;
  appRunning: boolean;
  includeIncompleteCheck: boolean;
};

type AppWizardProps = { manifest?: Manifest };

/* ========= Results model (strict, discriminated) ========= */
/* keep local to avoid react-refresh lint; move to its own file if you need reuse */

const OUTPUT_CONTENT_TYPE = {
  Markdown: 'text/markdown',
  PlainText: 'text/plain',
  Html: 'text/html',
  Csv: 'text/csv',
  Json: 'application/json',
} as const;

type OutputContentMime = (typeof OUTPUT_CONTENT_TYPE)[keyof typeof OUTPUT_CONTENT_TYPE];

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | { [k: string]: JsonValue } | JsonValue[];

type MarkdownOutput = { title?: string; content_type: typeof OUTPUT_CONTENT_TYPE.Markdown; data: string };
type PlainTextOutput = { title?: string; content_type: typeof OUTPUT_CONTENT_TYPE.PlainText; data: string };
type HtmlOutput = { title?: string; content_type: typeof OUTPUT_CONTENT_TYPE.Html; data: string };
type CsvOutput = { title?: string; content_type: typeof OUTPUT_CONTENT_TYPE.Csv; data: string };
type JsonOutput = { title?: string; content_type: typeof OUTPUT_CONTENT_TYPE.Json; data: JsonValue };

type UnknownOutput<TCT extends string = string> = {
  title?: string;
  content_type: Exclude<TCT, OutputContentMime>;
  data: unknown;
};

type Output = MarkdownOutput | PlainTextOutput | HtmlOutput | CsvOutput | JsonOutput | UnknownOutput;

type JobResult<T extends Output = Output> = { outputs: T[] };
type JobLike<T extends Output = Output> = { results?: JobResult<T>[] } | null | undefined;

/* Type guards (file-local to dodge react-refresh rule) */

const isMarkdownOutput = (o: Output): o is MarkdownOutput => o.content_type === OUTPUT_CONTENT_TYPE.Markdown;
const isJsonOutput = (o: Output): o is JsonOutput => o.content_type === OUTPUT_CONTENT_TYPE.Json;
const isPlainTextOutput = (o: Output): o is PlainTextOutput => o.content_type === OUTPUT_CONTENT_TYPE.PlainText;

const isHtmlOutput = (o: Output): o is HtmlOutput => o.content_type === OUTPUT_CONTENT_TYPE.Html;
const isCsvOutput = (o: Output): o is CsvOutput => o.content_type === OUTPUT_CONTENT_TYPE.Csv;

/* ========= Type guards / helpers ========= */

const isVisibleTask = (task: ManifestTask): task is VisibleTask =>
  !task.hidden && task.type !== 'q-app' && task.type !== 'http-request';

const isOutputTask = (task: ManifestTask | VisibleTask): boolean =>
  typeof task.type === 'string' && task.type.includes('output');

const isFileResultArray = (x: unknown): x is FileResult[] =>
  Array.isArray(x) && x.every((f) => f && typeof (f as FileResult).s3_key === 'string');

/* ========= Component ========= */

const DEFAULT_MANIFEST: Manifest = { tasks: [], typicalDurationMinutes: 0 };

const AppWizard: React.FC<AppWizardProps> = ({ manifest = DEFAULT_MANIFEST }) => {
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

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => (job?.results ? 'results' : 'inputs'));

  useEffect(() => {
    setActiveTab(job && (job as JobLike)?.results ? 'results' : 'inputs');
  }, [job]);

  const visibleTasks = useMemo<VisibleTask[]>(() => manifest?.tasks?.filter(isVisibleTask) ?? [], [manifest?.tasks]);

  const preRunTasks = useMemo<VisibleTask[]>(() => visibleTasks.filter((task) => !isOutputTask(task)), [visibleTasks]);

  const postRunTasks = useMemo<VisibleTask[]>(() => visibleTasks.filter((task) => isOutputTask(task)), [visibleTasks]);

  const markDefaultContentComplete = useCallback(
    (taskIndex: number) => {
      const currentTask = visibleTasks[taskIndex];
      if (currentTask?.defaultContent && !taskCompletionStatus[currentTask.id]) {
        updateTaskCompletionStatus(currentTask.id, true);
      }
    },
    [visibleTasks, taskCompletionStatus, updateTaskCompletionStatus],
  );

  function isStepCompleteOriginal<T extends VisibleTask[]>(
    tasks: T,
    comp: TaskCompletionStatus<T>,
    index: number,
  ): boolean {
    const task = tasks[index];
    if (!task) return false;
    return comp[task.id] ?? false;
  }

  const isStepComplete = useCallback(
    (index: number) =>
      isStepCompleteOriginal(
        visibleTasks as VisibleTask[],
        taskCompletionStatus as TaskCompletionStatus<VisibleTask[]>,
        index,
      ),
    [visibleTasks, taskCompletionStatus],
  );

  const isStepDisabled = useCallback(
    (index: number) => {
      const task = visibleTasks[index];
      if (isOutputTask(task)) return !hasRun;

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
    (index: number) => {
      if (index >= preRunTasks.length) {
        if (hasRun) setActiveStep(index);
        return;
      }

      const task = visibleTasks[index];
      if (!task) return;

      if (isOutputTask(task)) {
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
      setActiveStep,
    ],
  );

  const handleRunApp = async (): Promise<void> => {
    try {
      const updatedStatus: Record<TaskId, boolean> = {};
      visibleTasks.forEach((task) => {
        updatedStatus[task.id] = false;
      });
      setTaskCompletionStatus(updatedStatus);

      const firstOutputTask = visibleTasks.find(isOutputTask);
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
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppRunning(false);
    }
  };

  const handleTaskCompletion: TaskCompletionHandler = (taskId, results = null) => {
    const validFiles: FileResult[] = isFileResultArray(results) ? results.filter((f) => f.s3_key.length > 0) : [];

    updateTaskInputValue(taskId, validFiles);

    // success only if at least one valid file
    updateTaskCompletionStatus(taskId, validFiles.length > 0);
  };

  const handleTaskInputChange: HandleTaskInputChange = useCallback(
    (taskId, value) => {
      if (hasRun) return;

      setTaskInputValues((prev: Record<TaskId, TaskInputValue>) => ({
        ...prev,
        [taskId]: value,
      }));

      updateTaskInputValue(taskId, value);
    },
    [setTaskInputValues, updateTaskInputValue, hasRun],
  );

  const handlePrevStep: HandleStepNavigation = () => {
    if (activeStep > 0) {
      const newStep = activeStep - 1;
      setActiveStep(newStep);
      markDefaultContentComplete(newStep);
    }
  };

  const handleNextStep: HandleStepNavigation = () => {
    const totalSteps = visibleTasks.length;
    if (activeStep < totalSteps - 1) {
      const newStep = activeStep + 1;
      setActiveStep(newStep);
      markDefaultContentComplete(newStep);
    }
  };

  function isNextInputDisabledTyped<T extends VisibleTask[]>(i: NextDisableInputs<T>): boolean {
    const total = i.tasks.length;
    const current = i.activeIndex;

    if (total === 0 || current >= total - 1) return true;

    // crossing from last input to first output
    const atLastInputStep = current + 1 === i.preRunCount;
    if (atLastInputStep && !i.appRunning) return true;

    if (i.includeIncompleteCheck) {
      const task = i.tasks[current];
      if (!task) return true;
      const done = !!i.completion[task.id];
      if (!done) return true;
    }

    return false;
  }

  const isNextInputDisabled = useCallback(
    (includeIncompleteCheck = true) =>
      isNextInputDisabledTyped({
        tasks: visibleTasks as VisibleTask[],
        completion: taskCompletionStatus as TaskCompletionStatus<VisibleTask[]>,
        activeIndex: activeStep,
        preRunCount: preRunTasks.length,
        appRunning,
        includeIncompleteCheck,
      }),
    [activeStep, visibleTasks, preRunTasks.length, appRunning, taskCompletionStatus],
  );

  const renderTask = (task: VisibleTask, index: number): ReactElement | null => {
    const jobLike = job as JobLike;
    if (index >= preRunTasks.length && jobLike?.results?.length) {
      let outputIndex = index - preRunTasks.length;
      let currentOutput: Output | null = null; // ← was JobOutput

      for (const result of jobLike.results) {
        if (outputIndex < result.outputs.length) {
          currentOutput = result.outputs[outputIndex] ?? null;
          break;
        }
        outputIndex -= result.outputs.length;
      }

      if (currentOutput) {
        return (
          <div className="result-output" key={`result-${index}`}>
            <h3>{currentOutput.title ?? `Output ${outputIndex + 1}`}</h3>
            <div>
              {isMarkdownOutput(currentOutput) ? (
                <MarkdownContent content={currentOutput.data} />
              ) : isJsonOutput(currentOutput) ? (
                <pre>{JSON.stringify(currentOutput.data, null, 2)}</pre>
              ) : isPlainTextOutput(currentOutput) || isCsvOutput(currentOutput) ? (
                <pre>{currentOutput.data}</pre>
              ) : isHtmlOutput(currentOutput) ? (
                <div>{currentOutput.data}</div>
              ) : (
                <pre>{JSON.stringify(currentOutput.data, null, 2)}</pre>
              )}
            </div>
          </div>
        );
      }

      return <p key={`no-output-${index}`}>No output found at index {index}</p>;
    }

    // Traditional task
    const handleComplete = (results?: FileResult[] | null) => handleTaskCompletion(task.id, results ?? null);
    const handleNotComplete = (results?: FileResult[] | null) => handleTaskCompletion(task.id, results ?? null);

    const commonProps = {
      task,
      onComplete: handleComplete,
      onNotComplete: handleNotComplete,
      value: (taskInputValues as Record<TaskId, TaskInputValue>)[task.id],
      onChange: (value: TaskInputValue) => handleTaskInputChange(task.id, value),
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
            results={(job as JobLike)?.results}
            typicalDurationMinutes={manifest.typicalDurationMinutes}
          />
        </Col>
      </Row>

      <Row>
        <Col xs={12} className="px-2 px-md-4 position-relative">
          {(job as JobLike)?.results && (job as JobLike)?.results!.length > 0 ? (
            <Tabs
              activeKey={activeTab}
              onSelect={(k: string | null) => {
                if (k === 'inputs' || k === 'results') setActiveTab(k);
              }}
              className="mb-4"
            >
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
                          {/* Results tab ignores incomplete-step rule (original behaviour) */}
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
                <ResultsRenderer results={(job as JobLike)?.results} />
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
