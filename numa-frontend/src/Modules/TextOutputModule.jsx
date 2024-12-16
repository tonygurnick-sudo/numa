import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';

function TextOutputModule({ task }) {
  const { loading, numaTaskResponses } = useNumaApp();
  const taskResponse = numaTaskResponses.find(
    (response) => response.taskId === task.id,
  );

  if (!task) return;
  console.log('task', task);

  return (
    <div className="output-module">
      {task.title && <h4>{task.title}</h4>}
      <div className="output-text">
        {loading && <Preloader smallscreen={true} />}
        <p>{taskResponse?.result || ''}</p>
      </div>
    </div>
  );
}

export { TextOutputModule };
