import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';
import { MarkdownContent } from '../Components/MarkdownContent';
import { ResultActions } from '../Components/ResultActions';

function TextOutputModule({ task }) {
  const { loading, numaTaskResponses } = useNumaApp();
  const taskResponse = numaTaskResponses.find(
    (response) => response.taskId === task.id,
  );

  if (!task) return;

  return (
    <div className="output-module">
      {task.title && <h4>{task.title}</h4>}
      <div className="output-text markdown-content">
        {loading && <Preloader smallscreen={true} />}
        {taskResponse?.result && (
          <>
            <MarkdownContent content={taskResponse.result} />
            <ResultActions
              content={taskResponse.result}
              title={task.title || 'Result'}
            />
          </>
        )}
      </div>
    </div>
  );
}

export { TextOutputModule };
