import { useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { useParams } from 'react-router-dom';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { QAppDetail } from '../Components/QAppDetail';
import { QAppDetailHeader } from '../Components/QAppDetailHeader';

import { useNumaApp } from '../Providers/NumaAppProvider';
import { NumaAppItemHeader } from '../Components/NumaAppItemHeader';
import { NumaAppTaskManager } from '../Components/NumaAppTaskManager';

const AppDetail = () => {
  const { appId } = useParams(); // Get appId from URL
  const { error, isLoading, setNumaAppId, numaAppData } = useNumaApp();

  useEffect(() => {
    setNumaAppId(appId);
  }, [appId]);

  return (
    <div className="dashboard">
      <header>
        <Container fluid>
          <Row className="align-items-end">
            <Col lg={8} className="px-5">
              {!isLoading && <Breadcrumbs label={numaAppData?.appName} />}
              <h1>{numaAppData?.appName}</h1>
              <p>{numaAppData?.appDescription}</p>
            </Col>
            <Col lg={4} className="pe-5 ps-2 text-end">
              <div className="d-flex flex-column gap-3 mb-4">
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

              <div className="d-flex flex-row gap-2 align-items-end">
                {numaAppData?.type === 'q-app' ? (
                  <QAppDetailHeader />
                ) : (
                  numaAppData?.type === 'numa-app' && <NumaAppItemHeader />
                )}
              </div>
            </Col>
            <Col lg={9} className="px-5"></Col>
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
              <NumaAppTaskManager />
            ) : (
              numaAppData.type === 'q-app' && <QAppDetail />
            ))
          )}
        </Row>
      </LayoutDashboard>

      <Nav nav1on="on" nav2on="" nav3on="" />
    </div>
  );
};

export default AppDetail;
