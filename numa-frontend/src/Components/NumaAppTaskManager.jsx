import { useState, useEffect } from 'react';
import { Tab, Tabs, Col, Row } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { S3UploadModule } from '../Modules/S3UploadModule';
import { TextInputModule } from '../Modules/TextInputModule';
import { TextOutputModule } from '../Modules/TextOutputModule';

const NumaAppTaskManager = () => {
  const {
    appRunning,
    updateTaskCompletionStatus,

    numaAppData,
  } = useNumaApp();
  const [activeTab, setActiveTab] = useState('inputs');
  const [isFading, setIsFading] = useState(false);

  const handleTaskCompletion = (taskId) => {
    console.log('Task complete update...', taskId);
    updateTaskCompletionStatus(taskId);
  };

  const handleTaskIncomplete = (taskId) => {
    console.log('Task incomplete...', taskId);
    updateTaskCompletionStatus(taskId, false);
  };

  useEffect(() => {
    if (appRunning) {
      // Trigger fade and tab switch
      setIsFading(true);
      const timer = setTimeout(() => {
        setActiveTab('outputs'); // Switch to "Outputs" tab
        setIsFading(false); // Reset fading
      }, 500); // Match the fade duration
      return () => clearTimeout(timer);
    }
  }, [appRunning]);

  const renderTaskComponent = (task) => {
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
            onNotComplete={() => handleTaskIncomplete(task.id)}
          />
        );
      case 'text-output':
        return <TextOutputModule key={task.id} task={task} />;
      default:
        return <p>Unknown task type</p>;
    }
  };

  if (!numaAppData) {
    return <div>Loading...</div>;
  }

  const inputTasks = numaAppData?.tasks?.filter(
    (task) => task.type === 'text-input' || task.type === 's3-upload',
  );
  const outputTasks = numaAppData?.tasks?.filter(
    (task) => task.type === 'text-output',
  );

  return (
    <>
      <Tabs
        id="task-tabs"
        activeKey={activeTab}
        onSelect={(k) => setActiveTab(k)}
        className="mb-3"
      >
        <Tab eventKey="inputs" title="Inputs">
          <Row>
            {inputTasks.map((task) => (
              <Col key={task.id} sm={12} md={6} lg={6} xl={6}>
                {renderTaskComponent(task)}
              </Col>
            ))}
          </Row>
        </Tab>
        <Tab eventKey="outputs" title="Reults">
          <Row>
            {outputTasks.map((task) => (
              <Col key={task.id} sm={12} md={12} lg={12} xl={12}>
                {renderTaskComponent(task)}
              </Col>
            ))}
          </Row>
        </Tab>
      </Tabs>
      {/* Use a CSS stylesheet or inline style */}
      <style>
        {`
    .fade-tab {
      opacity: 0;
      transition: opacity 0.5s ease-in-out;
    }
  `}
      </style>
    </>
  );
};

export { NumaAppTaskManager };
