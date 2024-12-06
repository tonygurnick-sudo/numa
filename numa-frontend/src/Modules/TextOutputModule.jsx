import { Row, Col } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';

function TextOutputModule({ task }) {
  const { loading, numaTaskResponses } = useNumaApp();
  const taskResponse = numaTaskResponses.find(
    (response) => response.taskId === task.id,
  );

  if (!task) return;

  return (
    <div>

        {/* Textarea for displaying data */}
        <p className="output-text">
          {loading && <Preloader smallscreen={true}  />}
          {taskResponse?.result || ''}
        </p>
    </div>
  );
}

export { TextOutputModule };
