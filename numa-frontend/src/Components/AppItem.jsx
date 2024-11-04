import { useState, useEffect } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Preloader } from '../Components/Preloader';

import { GetQAppCommand } from '@aws-sdk/client-qapps';

const AppItem = ({ appId, instanceId, qAppsClient }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appData, setApp] = useState(null);

  const fetchApp = async () => {
    try {
      const input = { instanceId: instanceId, appId: appId };
      const command = new GetQAppCommand(input);
      const response = await qAppsClient.send(command);

      setApp(response);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch app details on mount
  useEffect(() => {
    if (!qAppsClient) return;

    fetchApp();
  }, []);

  return (
    <>
      <div className="card card-apps">
        <a href={`/app/${appId}`} rel="noopener">
          <div className="card-header">
            <Row>
              <Col lg={9}>{appData?.title}</Col>
              <Col lg={3} className="right">
                {appData?.appVersion && <label>v{appData?.appVersion}</label>}
              </Col>
            </Row>
          </div>
          <div className="card-body">
            {loading ? (
              <Preloader smallscreen={true} />
            ) : (
              <> {appData?.description}</>
            )}
          </div>
          <div className="card-buttons">
            <Row>
              <Col lg={8}></Col>
              <Col lg={4}>
                {error && <Alert variant="danger">{error}</Alert>}
                {appData?.status}{' '}
                {appData?.status === 'coming_soon' ? (
                  <div className="badge-status comingsoon right">
                    Coming Soon
                  </div>
                ) : appData?.status === 'PUBLISHED' ? (
                  <>
                    <i className="bi bi-box-arrow-in-up-right"></i>
                  </>
                ) : null}
              </Col>
            </Row>
          </div>
          <div className="card-footer" />
        </a>
      </div>
    </>
  );
};

export { AppItem };
