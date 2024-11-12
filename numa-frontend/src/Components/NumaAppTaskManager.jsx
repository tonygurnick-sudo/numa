import { useState, useEffect } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';

import { Col } from 'react-bootstrap';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { QAppModule } from '../Modules/QAppModule';
import { NumaRequestModule } from '../Modules/NumaRequestModule';
import { TextInputModule } from '../Modules/TextInputModule';
import { TextOutputModule } from '../Modules/TextOutputModule';

const NumaAppTaskManager = () => {
  const { updateTaskCompletionStatus, taskCompletionStatus, numaAppData } =
    useNumaApp();

  function handleTaskCompletion(taskId) {
    console.log('task complete run...', taskId);
    updateTaskCompletionStatus(taskId); // Let the provider handle updating the task status
  }

  function handleTaskIncomplete(taskId) {
    console.log('task incomplete...', taskId);
    updateTaskCompletionStatus(taskId, false); // Mark task as incomplete
  }

  function TaskComponent({ task }) {
    switch (task.type) {
      case 'text-input':
        return (
          <TextInputModule
            key={task.id}
            task={task}
            onComplete={() => handleTaskCompletion(task.id)}
            onNotComplete={() => handleTaskIncomplete(task.id)}
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
      {numaAppData?.tasks
        ?.filter(
          (task) => task.type !== 'q-app-' && task.type !== 'http-request',
        ) // Filter out q-app- and http-request tasks
        .map((task) => (
          <Col key={task.id} sm={12} md={6} lg={6} xl={6} className="flex">
            <TaskComponent task={task} />
          </Col>
        ))}
    </>
  );
};

export { NumaAppTaskManager };
