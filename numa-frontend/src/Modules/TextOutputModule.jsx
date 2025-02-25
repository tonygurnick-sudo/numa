import { useNumaApp } from '../Providers/NumaAppContext';
import { Preloader } from '../Components/Preloader';
import { MarkdownContent } from '../Components/MarkdownContent';
import { ResultActions } from '../Components/ResultActions';

function TextOutputModule({ task }) {
  const { error, numaTaskResponses, appRunning, selectedTaskId } = useNumaApp();

  const taskResponse = numaTaskResponses?.find((response) => response?.taskId === task.id);

  const isSelected = selectedTaskId === task.id;

  if (!task) return null;

  return (
    <div className={`output-module ${isSelected ? 'selected' : ''}`}>
      <div className="output-text markdown-content">
        {appRunning && !taskResponse?.result && <Preloader smallscreen={true} />}
        {error && <div className="text-danger">{error instanceof Error ? error.message : 'An error occurred'}</div>}
        {taskResponse?.result && !error && (
          <>
            <MarkdownContent content={taskResponse.result} />
            <ResultActions content={taskResponse.result} title={task.title || 'Result'} />
          </>
        )}
      </div>
    </div>
  );
}

export { TextOutputModule };
