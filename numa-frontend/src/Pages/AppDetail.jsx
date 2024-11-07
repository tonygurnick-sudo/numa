import { useState, useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { useParams } from 'react-router-dom';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { NumaAppDetail } from '../Components/NumaAppDetail';
import { QAppDetail } from '../Components/QAppDetail';
import { QAppDetailHeader } from '../Components/QAppDetailHeader';
import { NumaAppDetailHeader } from '../Components/NumaAppDetailHeader';

const AppDetail = () => {
  // q parts
  const [qSsessionId, setQSessionId] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [qAppData, setqAppData] = useState([]);
  const [cardInputValues, setCardInputValues] = useState({});

  const { appId } = useParams(); // Get appId from URL

  const [numaAppData, setNumaAppData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [runActive, setRunActive] = useState('disabled');

  // Get app details from manifest via session
  useEffect(() => {
    const fetchData = async () => {
      try {
        const appsData = JSON.parse(sessionStorage.getItem('appsData'));
        const app = appsData.apps.find((app) => app.id === appId);

        setNumaAppData(app);
        setIsLoading(false);
      } catch (error) {
        console.error('Error fetching app data:', error);
        setError(error);
        setIsLoading(false);
      }
    };

    fetchData();
  }, [appId]);

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row className="align-items-end">
              <Col lg={9} className="px-5">
                {!isLoading && <Breadcrumbs label={numaAppData?.appName} />}
                <h1>{numaAppData?.appName}</h1>
                <p>{numaAppData?.appDescription}</p>
              </Col>
              <Col lg={3} className="px-5 text-end">
                <div className="d-flex flex-column justify-content-between h-100 gap-3">
                  <div className="d-flex flex-column gap-2 align-items-end">
                    {numaAppData?.type === 'q-app' ? (
                      <QAppDetailHeader
                        qAppId={numaAppData.qAppId}
                        qAppData={qAppData}
                        runActive={runActive}
                        setQSessionId={setQSessionId}
                        setIsPolling={setIsPolling}
                        cardInputValues={cardInputValues}
                      />
                    ) : (
                      numaAppData?.type === 'numa-app' && (
                        <NumaAppDetailHeader
                          numaAppData={numaAppData}
                          runActive={runActive}
                          setIsPolling={setIsPolling}
                        />
                      )
                    )}
                  </div>
                </div>
              </Col>
              <Col lg={9} className="px-5">
                <div className="d-flex align-items-center gap-3">
                  <span>
                    <strong>Created:</strong>{' '}
                    {numaAppData?.createdDate
                      ? new Date(numaAppData.createdDate).toLocaleString()
                      : ''}
                  </span>
                  <span>
                    <strong>Status:</strong> {numaAppData?.status}
                  </span>
                </div>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
            {error && <Alert variant="danger">{error}</Alert>}

            {isLoading ? (
              <Preloader />
            ) : (
              numaAppData &&
              (numaAppData.type === 'numa-app' ? (
                <NumaAppDetail
                  appData={numaAppData}
                  setRunActive={setRunActive}
                />
              ) : (
                numaAppData.type === 'q-app' && (
                  <QAppDetail
                    setRunActive={setRunActive}
                    qAppId={numaAppData.qAppId}
                    setqAppData={setqAppData}
                    qAppData={qAppData}
                    setIsPolling={setIsPolling}
                    isPolling={isPolling}
                    qSsessionId={qSsessionId}
                    setCardInputValues={setCardInputValues}
                    cardInputValues={cardInputValues}
                  />
                )
              ))
            )}
          </Row>
        </LayoutDashboard>

        <Nav nav1on="on" nav2on="" nav3on="" />
      </div>
    </>
  );
};

export default AppDetail;
