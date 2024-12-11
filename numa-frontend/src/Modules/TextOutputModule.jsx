import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';

function TextOutputModule({ task }) {
  const { loading, numaTaskResponses } = useNumaApp();
  const taskResponse = numaTaskResponses.find(
    (response) => response.taskId === task.id,
  );

  if (!task) return;
  console.log("task",task);

  return (
    <div>
        {task.title && <h3>{task.title}</h3>}
        <p className="output-text">
          {loading && <Preloader smallscreen={true}  />}
          {taskResponse?.result || ''}
        </p>
    </div>
  );
}

export { TextOutputModule };
