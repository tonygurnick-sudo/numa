import { Row, Col } from 'react-bootstrap';

const AppItem = ({ appData }) => {
  console.log(appData)
  return (
    <>
      <div className="card card-apps">

        <a href={`/app/${appData.appId}`} rel="noopener" >
          <AppItemContents appData={appData} />

        </a>

      </div>
    </>
  );
};

function AppItemContents({ appData }) {
  return (
    <>
      <div className="card-header">
        <Row>
          <Col lg={9}>
            {appData.title}
          </Col>
          <Col lg={3} className="right">
            {appData.appVersion && (
              <label>
                v{appData.appVersion}
              </label>
            )}
          </Col>
        </Row>
      </div>
      <div className="card-body">{appData.description}</div>
      <div className="card-buttons">
        <Row>
          <Col lg={8}>
          </Col>
          <Col lg={4}>
            {appData.status === 'coming_soon' ? <div className="badge-status comingsoon right">Coming Soon</div> : ''}
          </Col>
        </Row>
      </div>
      <div className="card-footer" />
    </>
  );
}


export { AppItem };
