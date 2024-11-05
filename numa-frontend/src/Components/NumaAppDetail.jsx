import { useState, useEffect } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';

import { S3UploadModule } from '../Modules/S3UploadModule';
import { QAppModule } from '../Modules/QAppModule';
import { StepFunctionModule } from '../Modules/StepFunctionModule';
import { TextOutputModule } from '../Modules/TextOutputModule';

const NumaAppDetail = ({ appData }) => {
  console.log(appData);
  function TaskComponent({ task }) {
    console.log(task);
    switch (task.type) {
      case 's3-upload':
        return <S3UploadModule task={task} />;
      case 'q-app':
        return <QAppModule task={task} />;
      case 'step-function':
        return <StepFunctionModule task={task} />;
      case 'text-output':
        return <TextOutputModule task={task} />;
      default:
        return <p>Unknown task type</p>;
    }
  }

  if (!appData) {
    return <div>Loading...</div>;
  }

  return (
    <>
      <h2>{appData.appName}</h2>
      <p>{appData.appDescription}</p>

      <h3>Tasks:</h3>

      {appData?.tasks?.map((task, key) => (
        <Col key={task.id} sm={12} md={6} lg={6} xl={6} className="flex">
          <TaskComponent key={key} task={task} />
        </Col>
      ))}
    </>
  );
};

export { NumaAppDetail };
