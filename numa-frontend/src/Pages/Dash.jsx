import { useState, useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';

import { QAppCreate } from '../Components/QAppCreate';
import { useNumaApp } from '../Providers/NumaAppProvider';

const Dash = () => {
  const { error, setError, loading, setLoading, setNumaApps, numaApps } =
    useNumaApp();

  const [response, setResponse] = useState(null);

  useEffect(() => {
    const fetchApps = async () => {
      try {
        // TODO
        //const response = await fetch('/api/apps'); // Replace with your actual API endpoint
        //const appsData = await response.json();

        const response = await fetch('../src/Data/example-manifest.json');
        const appsData = await response.json();
        setNumaApps(appsData);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching apps:', error);
        setError(error);
        setLoading(false);
      }
    };

    fetchApps();
  }, []);

  // Persist our apps info for the session
  useEffect(() => {
    if (numaApps) {
      sessionStorage.setItem('appsData', JSON.stringify(numaApps));
    }
  }, [numaApps]);

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={8} className="px-5">
                <Breadcrumbs clearStack={true} />
                <h1>Dashboard</h1>
              </Col>
              <Col lg={3} className="p-5">
                <>
                  {/* here if we want to create app functionality */}
                  {/* <QAppCreate
                    setLoading={setLoading}
                    setError={setError}
                    setResponse={setResponse}
                  /> */}
                </>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
            {error && <Alert variant="danger">{error}</Alert>}
            {loading ? (
              <Preloader />
            ) : (
              <>
                {numaApps?.apps?.map((app) => (
                  <Col key={app.id} lg={4} className="flex">
                    <div className="card card-apps">
                      <a href={`/app/${app.id}`} rel="noopener">
                        <div className="card-header">
                          <Row>
                            <Col lg={9}>{app?.appName}</Col>
                            <Col lg={3} className="right">
                              {app?.appVersion && (
                                <label>v{app?.appVersion}</label>
                              )}
                            </Col>
                          </Row>
                        </div>
                        <div className="card-body">
                          {loading ? (
                            <Preloader smallscreen={true} />
                          ) : (
                            <> {app?.appDescription}</>
                          )}
                        </div>
                        <div className="card-buttons">
                          <Row>
                            <Col lg={8}></Col>
                            <Col lg={4}></Col>
                          </Row>
                        </div>
                        <div className="card-footer">
                          <Row className="justify-content-end">
                            <Col>
                              {' '}
                              <div className="tooltip clear"></div>
                            </Col>
                            <Col>
                              <div className="badge-status comingsoon right">
                                {app?.status}
                              </div>
                            </Col>
                          </Row>
                        </div>
                      </a>
                    </div>
                  </Col>
                ))}
              </>
            )}
          </Row>
        </LayoutDashboard>

        <Nav nav1on="on" nav2on="" nav3on="" />
      </div>
    </>
  );
};

export { Dash };
