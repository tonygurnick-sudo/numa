import { Col } from 'react-bootstrap';

import { S3UploadModule } from '../Modules/S3UploadModule';
import { QAppModule } from '../Modules/QAppModule';
import { BackendModule } from '../Modules/BackendModule';
import { TextOutputModule } from '../Modules/TextOutputModule';

const NumaAppDetail = ({ appData, setRunActive }) => {
  function TaskComponent({ task }) {
    console.log(task);
    switch (task.type) {
      case 's3-upload':
        return <S3UploadModule task={task} />;
      case 'q-app':
        return <QAppModule task={task} />;
      case 'backend':
        return <BackendModule task={task} />;
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
      {appData?.tasks?.map((task, key) => (
        <Col key={task.id} sm={12} md={6} lg={6} xl={6} className="flex">
          <TaskComponent key={key} task={task} />
        </Col>
      ))}
    </>
  );
};

export { NumaAppDetail };
