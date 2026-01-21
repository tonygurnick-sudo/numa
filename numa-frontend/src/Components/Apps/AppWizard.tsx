import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Col, Container, Row, Tab, Tabs, Modal, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { S3UploadModule } from '../../Modules/S3UploadModule';
import { TextInputModule } from '../../Modules/TextInputModule';
import { TextOutputModule } from '../../Modules/TextOutputModule';
import { DropdownTableModule } from '../../Modules/DropdownTableModule';
import { DropdownModule } from '../../Modules/DropdownModule';
import { WizardNavigation } from '../WizardNavigation';
import { Preloader } from '../Preloader';
import { ResultsRenderer } from '../Renderers/ResultsRenderer';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import { RunActiveState } from '@/types/apps.ts';

import type { ReactElement } from 'react';

const JOB_NAME_MAX_LENGTH = 60;

export type TaskId = string;

export type FileResult = {
  s3_key: string;
  [key: string]: unknown;
};

export type TaskCompletionHandler = (taskId: TaskId, isComplete: boolean, results?: FileResult[] | null) => void;

type InputTaskType = 'text-input' | 's3-upload' | 'dropdown' | 'dropdown-table';
type OutputTaskType = 'text-output';

type HiddenTaskType = 'q-app' | 'http-request';

export type TaskType = InputTaskType | OutputTaskType | HiddenTaskType | (string & {}); // permit forward-compat

type TaskParameters = {
  minFiles?: number;
  maxFiles?: number;
  userMessage?: string;
  [k: string]: unknown;
};

export type ManifestTask = {
  id: TaskId;
  type: TaskType;
  title?: string;
  hidden?: boolean;
  required?: boolean;
  defaultContent?: string;

  /** Optional validation rule for file uploads; supports both task.minFiles and task.parameters.minFiles */
  minFiles?: number;
  parameters?: TaskParameters;
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

/* ========= Helper: read minFiles from either shape ========= */

function getMinFiles(task: ManifestTask | undefined): number {
  // Default for uploads is 1 unless manifest raises it.
  if (!task) return 1;
  if (typeof task.minFiles === 'number') return task.minFiles;
  const p = task.parameters as TaskParameters | undefined;
  if (p && typeof p.minFiles === 'number') return p.minFiles;
  // If you wanted a different default per type, do it here:
  // if (task.type === 's3-upload') return 1;
  return 1;
}

/* ========= DEBUG: Next-button state explainer ========= */

type NextStateDiag = {
  context: 'inputs' | 'results';
  activeIndex: number;
  total: number;
  preRunCount: number;
  appRunning: boolean;
  includeIncompleteCheck: boolean;
  atLastInputStep: boolean;
  crossingToOutputs: boolean;
  isLastStep: boolean;
  currentTaskId?: string;
  currentTaskRequired?: boolean;
  currentTaskComplete?: boolean;
  disabled: boolean;
  reasons: string[];
};

function explainNextDisabled<T extends VisibleTask[]>(
  i: NextDisableInputs<T>,
  context: 'inputs' | 'results',
): NextStateDiag {
  const reasons: string[] = [];
  const total = i.tasks.length;
  const current = i.activeIndex;

  const isLastStep = total === 0 || current >= total - 1;
  if (total === 0) reasons.push('no tasks');
  if (current >= total - 1) reasons.push('already at or beyond last step');

  const atLastInputStep = current + 1 === i.preRunCount;
  const crossingToOutputs = atLastInputStep;

  if (atLastInputStep && !i.appRunning) {
    reasons.push('crossing from last input → first output, but app not running');
  }

  let currentTaskId: string | undefined;
  let currentTaskRequired: boolean | undefined;
  let currentTaskComplete: boolean | undefined;

  if (i.tasks[current]) {
    currentTaskId = i.tasks[current].id;
    currentTaskRequired = !!i.tasks[current].required;
    if (i.includeIncompleteCheck) {
      currentTaskComplete = !!i.completion[i.tasks[current].id];
      if (!currentTaskComplete) reasons.push('current required check failed (task incomplete)');
    }
  }

  const disabled =
    isLastStep || (atLastInputStep && !i.appRunning) || (i.includeIncompleteCheck && !(currentTaskComplete ?? false));

  return {
    context,
    activeIndex: current,
    total,
    preRunCount: i.preRunCount,
    appRunning: i.appRunning,
    includeIncompleteCheck: i.includeIncompleteCheck,
    atLastInputStep,
    crossingToOutputs,
    isLastStep,
    currentTaskId,
    currentTaskRequired,
    currentTaskComplete,
    disabled,
    reasons: reasons.length ? reasons : ['enabled'],
  };
}

const DEFAULT_MANIFEST: Manifest = { tasks: [], typicalDurationMinutes: 0 };

const AppWizard: React.FC<AppWizardProps> = ({ manifest = DEFAULT_MANIFEST }) => {
  const { t } = useTranslation('apps');
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
    setRunName,
    isJobNamingEnabled,
  } = useNumaApp();

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => (job?.results ? 'results' : 'inputs'));
  const [showRunNameModal, setShowRunNameModal] = useState(false);
  const [runNameDraft, setRunNameDraft] = useState('');
  const [runNameError, setRunNameError] = useState('');
  const [isRunNameSubmitting, setIsRunNameSubmitting] = useState(false);

  useEffect(() => {
    setActiveTab(job && (job as JobLike)?.results ? 'results' : 'inputs');
  }, [job]);

  useEffect(() => {
    if (showRunNameModal) {
      setRunNameError('');
    }
  }, [showRunNameModal]);

  const visibleTasks = useMemo<VisibleTask[]>(() => manifest?.tasks?.filter(isVisibleTask) ?? [], [manifest?.tasks]);

  const preRunTasks = useMemo<VisibleTask[]>(() => visibleTasks.filter((task) => !isOutputTask(task)), [visibleTasks]);

  const postRunTasks = useMemo<VisibleTask[]>(() => visibleTasks.filter((task) => isOutputTask(task)), [visibleTasks]);

  const findTask = useCallback((taskId: TaskId) => visibleTasks.find((t) => t.id === taskId), [visibleTasks]);

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

  const runApp = async (runNameOverride?: string): Promise<void> => {
    const sanitizedRunName = runNameOverride?.trim() ?? '';
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
      const runNameOption = sanitizedRunName.length > 0 ? sanitizedRunName : undefined;
      setRunName(sanitizedRunName);
      await handleRunButtonClick(numaAppData, { runName: runNameOption });
    } catch (error) {
      console.error('Error running app:', error);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppRunning(false);
    }
  };

  const handleRunAppClick = async (): Promise<void> => {
    if (isJobNamingEnabled) {
      setRunNameDraft('');
      setRunNameError('');
      setShowRunNameModal(true);
      return;
    }

    setRunName('');
    await runApp();
  };

  const handleRunNameModalClose = () => {
    if (isRunNameSubmitting) {
      return;
    }
    setShowRunNameModal(false);
    setRunNameError('');
  };

  const handleRunNameSubmit = async () => {
    const trimmedName = runNameDraft.trim();
    if (!trimmedName) {
      setRunNameError(t('wizard.runName.required'));
      return;
    }

    setIsRunNameSubmitting(true);
    setShowRunNameModal(false);
    try {
      await runApp(trimmedName);
      setRunNameDraft(trimmedName);
    } catch (error) {
      console.error('Failed to run app with named job:', error);
      setShowRunNameModal(true);
    } finally {
      setIsRunNameSubmitting(false);
    }
  };

  const runNameRemaining = Math.max(0, JOB_NAME_MAX_LENGTH - runNameDraft.length);
  const canSubmitRunName = runNameDraft.trim().length > 0 && !isRunNameSubmitting;

  // --- completion reflects minFiles (reads parameters.minFiles too) ---
  const handleTaskCompletion: TaskCompletionHandler = (taskId, isComplete, results = null) => {
    const taskDef = findTask(taskId);
    const minFiles = getMinFiles(taskDef);

    if (isFileResultArray(results)) {
      const validFiles: FileResult[] = results.filter((f) => f.s3_key.length > 0);
      updateTaskInputValue(taskId, validFiles);
      const complete = isComplete && validFiles.length >= minFiles;
      updateTaskCompletionStatus(taskId, complete);

      return;
    }

    if (!isComplete) {
      updateTaskCompletionStatus(taskId, false);
      if (results == null) updateTaskInputValue(taskId, []);

      return;
    }

    updateTaskCompletionStatus(taskId, true);
  };

  // --- auto-toggle completion when value is a FileResult[] (keeps state in sync on add/remove) ---
  const handleTaskInputChange: HandleTaskInputChange = useCallback(
    (taskId, value) => {
      if (hasRun) return;

      setTaskInputValues((prev: Record<TaskId, TaskInputValue>) => ({
        ...prev,
        [taskId]: value,
      }));

      updateTaskInputValue(taskId, value);

      if (isFileResultArray(value)) {
        const taskDef = findTask(taskId);
        const minFiles = getMinFiles(taskDef);
        const validFiles = value.filter((f) => f.s3_key && f.s3_key.length > 0);
        const complete = validFiles.length >= minFiles;
        updateTaskCompletionStatus(taskId, complete);
      }
    },
    [setTaskInputValues, updateTaskInputValue, updateTaskCompletionStatus, hasRun, findTask],
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

  const isNextInputDisabled = useCallback(
    (includeIncompleteCheck = true) => {
      const base: NextDisableInputs<VisibleTask[]> = {
        tasks: visibleTasks as VisibleTask[],
        completion: taskCompletionStatus as TaskCompletionStatus<VisibleTask[]>,
        activeIndex: activeStep,
        preRunCount: preRunTasks.length,
        appRunning,
        includeIncompleteCheck,
      };

      const diagInputs = explainNextDisabled(base, 'inputs');

      const diagResults = explainNextDisabled({ ...base, includeIncompleteCheck: false }, 'results');

      return includeIncompleteCheck ? diagInputs.disabled : diagResults.disabled;
    },
    [activeStep, visibleTasks, preRunTasks.length, appRunning, taskCompletionStatus],
  );

  const nextDisabledInputsView = isNextInputDisabled(true);
  const nextDisabledResultsView = isNextInputDisabled(false);

  const renderTask = (task: VisibleTask, index: number): ReactElement | null => {
    const jobLike = job as JobLike;
    if (index >= preRunTasks.length && jobLike?.results?.length) {
      let outputIndex = index - preRunTasks.length;
      let currentOutput: Output | null = null;

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
            <h3>{currentOutput.title ?? t('wizard.results.outputTitle', { index: outputIndex + 1 })}</h3>
            <div>
              {isMarkdownOutput(currentOutput) ? <MarkdownContent content={currentOutput.data} /> : null}
              {isJsonOutput(currentOutput) ? <pre>{JSON.stringify(currentOutput.data, null, 2)}</pre> : null}
              {isPlainTextOutput(currentOutput) || isCsvOutput(currentOutput) ? <pre>{currentOutput.data}</pre> : null}
              {isHtmlOutput(currentOutput) ? <div>{currentOutput.data}</div> : null}
              {!isMarkdownOutput(currentOutput) &&
              !isJsonOutput(currentOutput) &&
              !isPlainTextOutput(currentOutput) &&
              !isCsvOutput(currentOutput) &&
              !isHtmlOutput(currentOutput) ? (
                <pre>{JSON.stringify(currentOutput.data, null, 2)}</pre>
              ) : null}
            </div>
          </div>
        );
      }

      return <p key={`no-output-${index}`}>{t('wizard.results.noOutput', { index })}</p>;
    }

    // Traditional task
    const handleComplete = (results?: FileResult[] | null) => handleTaskCompletion(task.id, true, results ?? null);
    const handleNotComplete = (results?: FileResult[] | null) => handleTaskCompletion(task.id, false, results ?? null);

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
        return <p key={task.id}>{t('wizard.tasks.unknownType')}</p>;
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
          <p>{t('wizard.loadingJobResults')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Modal
        show={showRunNameModal}
        onHide={handleRunNameModalClose}
        centered
        size="sm"
        dialogClassName="run-name-modal"
        contentClassName="run-name-modal__content"
      >
        <Modal.Header closeButton className="run-name-modal__header">
          <div>
            <Modal.Title className="run-name-modal__title">{t('wizard.runName.title')}</Modal.Title>
            <p className="run-name-modal__subtitle mb-0">{t('wizard.runName.subtitle')}</p>
          </div>
        </Modal.Header>
        <Modal.Body className="run-name-modal__body">
          <Form.Group controlId="job-name-input">
            <Form.Label className="run-name-modal__label">{t('wizard.runName.label')}</Form.Label>
            <Form.Control
              type="text"
              placeholder={t('wizard.runName.placeholder')}
              value={runNameDraft}
              autoFocus
              maxLength={JOB_NAME_MAX_LENGTH}
              onChange={(event) => {
                setRunNameDraft(event.target.value);
                if (runNameError) {
                  setRunNameError('');
                }
              }}
              disabled={isRunNameSubmitting}
              isInvalid={!!runNameError}
              className="run-name-modal__input"
            />
            <Form.Control.Feedback type="invalid" className="run-name-modal__feedback">
              {runNameError}
            </Form.Control.Feedback>
            <Form.Text className="run-name-modal__hint">{t('wizard.runName.hint')}</Form.Text>
            <span className={`run-name-modal__counter ${runNameRemaining <= 10 ? 'text-danger' : 'text-muted'}`}>
              {t('wizard.runName.remaining', { count: runNameRemaining })}
            </span>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="run-name-modal__footer">
          <div className="run-name-modal__actions">
            <Button
              variant="outline-secondary"
              onClick={handleRunNameModalClose}
              disabled={isRunNameSubmitting}
              className="run-name-modal__button"
            >
              {t('wizard.runName.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleRunNameSubmit}
              disabled={!canSubmitRunName}
              className="run-name-modal__button"
            >
              {isRunNameSubmitting ? t('wizard.runName.saving') : t('wizard.runName.saveAndRun')}
            </Button>
          </div>
        </Modal.Footer>
      </Modal>

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
                onClick: handleRunAppClick,
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
                <Tab eventKey="inputs" title={t('wizard.tabs.inputs')}>
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
                              {t('wizard.navigation.previous')}
                            </Button>
                            {/* Results tab ignores incomplete-step rule (original behaviour) */}
                            <Button variant="primary" onClick={handleNextStep} disabled={nextDisabledResultsView}>
                              {t('wizard.navigation.next')}
                              <i className="bi bi-arrow-right ms-2"></i>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </Tab>
                <Tab eventKey="results" title={t('wizard.tabs.results')}>
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
                            {t('wizard.navigation.previous')}
                          </Button>
                          {/* Inputs view enforces completeness (original logic) */}
                          <Button variant="primary" onClick={handleNextStep} disabled={nextDisabledInputsView}>
                            {t('wizard.navigation.next')}
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
    </>
  );
};

export default AppWizard;
