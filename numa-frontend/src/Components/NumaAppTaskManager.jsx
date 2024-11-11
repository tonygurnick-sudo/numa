import { useState, useEffect } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';

import { Col } from 'react-bootstrap';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { QAppModule } from '../Modules/QAppModule';
import { NumaRequestModule } from '../Modules/NumaRequestModule';
import { TextInputModule } from '../Modules/TextInputModule';
import { TextOutputModule } from '../Modules/TextOutputModule';

const NumaAppTaskManager = () => {
  const [taskCompletionStatus, setTaskCompletionStatus] = useState({});
  const { setRunActive, numaAppData } = useNumaApp();

  useEffect(() => {
    const allTasksCompleted = numaAppData.tasks.every((task) => {
      if (!task.requiredTasks) return true; // No dependencies mean it's always valid
      console.log('checking requirements...');
      const { any } = task.requiredTasks;
      if (any) {
        return any.some(
          (requiredTaskId) => taskCompletionStatus[requiredTaskId],
        );
      }

      // Handle other requiredTasks configurations (e.g., 'all')
      return false; // Default to false if no matching condition is found
    });
    setRunActive(allTasksCompleted ? '' : 'disabled');
  }, [numaAppData.tasks, taskCompletionStatus, setRunActive]);

  function handleTaskCompletion(taskId) {
    setTaskCompletionStatus((prevStatus) => ({
      ...prevStatus,
      [taskId]: true,
    }));
  }

  function TaskComponent({ task }) {
    const isTaskComplete = taskCompletionStatus[task.id] || false;

    switch (task.type) {
      case 'text-input':
        return (
          <TextInputModule
            key={task.id}
            task={task}
            onComplete={() => handleTaskCompletion(task.id)}
          />
        );
      case 's3-upload':
        return (
          <S3UploadModule
            key={task.id}
            task={task}
            onComplete={() => handleTaskCompletion(task.id)}
          />
        );
      case 'q-app':
        return (
          <QAppModule
            key={task.id}
            task={task}
            onComplete={() => handleTaskCompletion(task.id)}
          />
        );
      case 'http-request':
        return (
          <NumaRequestModule
            key={task.id}
            task={task}
            onComplete={() => handleTaskCompletion(task.id)}
          />
        );
      case 'text-output':
        return <TextOutputModule key={task.id} task={task} />;
      default:
        return <p>Unknown task type</p>;
    }
  }

  if (!numaAppData) {
    return <div>Loading...</div>;
  }

  return (
    <>
      {numaAppData?.tasks?.map((task) => (
        <Col key={task.id} sm={12} md={6} lg={6} xl={6} className="flex">
          <TaskComponent key={task.id} task={task} />
          {!taskCompletionStatus[task.id] && task.requiredTasks && (
            <p className="text-warning small">
              This task requires other tasks to be completed first.
            </p>
          )}
        </Col>
      ))}
    </>
  );
};

export { NumaAppTaskManager };
