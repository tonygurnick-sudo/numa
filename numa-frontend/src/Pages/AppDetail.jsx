import { useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { useParams } from 'react-router-dom';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { JobHistorySidebar } from '../Components/JobHistorySidebar';

import { QAppDetail } from '../Components/QAppDetail';
import { QAppDetailHeader } from '../Components/QAppDetailHeader';

import { useNumaApp } from '../Providers/NumaAppProvider';
import { NumaAppItemHeader } from '../Components/NumaAppItemHeader';
import AppWizard from '../Components/AppWizard';

const AppDetail = () => {
  const { appId } = useParams(); // Get appId from URL
  const { error, isLoading, setNumaAppId, numaAppData } = useNumaApp();

  useEffect(() => {
    setNumaAppId(appId);
  }, [appId]);

  return (
    <div className="dashboard">
      <JobHistorySidebar />
      <header>
        <Container fluid>
          {!isLoading && <Breadcrumbs label={numaAppData?.appName} />}
          <Row>
            <Col lg={8} className="px-5">
              <h1 className="mb-3">{numaAppData?.appName}</h1>
              <p>{numaAppData?.appDescription}</p>
            </Col>
            <Col lg={4} className="pe-4 text-end">
              <div className="d-flex flex-column gap-2">
                {numaAppData?.category && (
                  <span>
                    <strong>Category:</strong>{' '}
                    <span
                      className={`category-tag ${numaAppData.category.toLowerCase()}`}
                    >
                      {numaAppData.category}
                    </span>
                  </span>
                )}
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
          <hr
            style={{
              width: '65%',
              margin: '0 auto 1rem auto',
              height: '2px',
              marginTop: '15px',
              backgroundColor: '#dee2e6',
            }}
          />
        </Container>
      </header>

      <main className="flex-grow-1">
        <Container fluid>
          {error && <Alert variant="danger">{error}</Alert>}
          {isLoading ? (
            <Preloader />
          ) : (
            numaAppData &&
            (numaAppData.type === 'numa-app' ? (
              <AppWizard manifest={numaAppData} />
            ) : numaAppData.type === 'q-app' ? (
              <QAppDetail />
            ) : null)
          )}
        </Container>
      </main>

      <Nav nav1on="on" nav2on="" nav3on="" />
    </div>
  );
};

export default AppDetail;
