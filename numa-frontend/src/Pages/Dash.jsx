import { useState, useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';

import { useNumaApp } from '../Providers/NumaAppProvider';

// Remove or comment out the direct import
// import appsManifest from '../Data/example-manifest.json';

const Dash = () => {
  const { error, setError, loading, setLoading, setNumaApps, numaApps } =
    useNumaApp();

  console.log('Dash Component Data:', { error, loading, numaApps }); // Debug log

  useEffect(() => {
    const fetchApps = async () => {
      setLoading(true);
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));

        // TODO
        // load from cache if cache time less than x

        // First try to load from sessionStorage
        // const cachedData = sessionStorage.getItem('appsData');

        // if (cachedData) {
        //   const parsedData = JSON.parse(cachedData);
        //   console.log('Loading from cache:', parsedData);
        //   if (Array.isArray(parsedData) && parsedData.length > 0) {
        //     setNumaApps(parsedData);
        //     setLoading(false);
        //     return;
        //   }
        // }

        // If no valid cached data, fetch from manifest
        const response = await fetch('../src/Data/example-manifest.json', {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch manifest');
        }

        const manifestData = await response.json();
        const appsData = manifestData.apps;

        if (!Array.isArray(appsData)) {
          throw new Error('Data must be an array');
        }

        setNumaApps(appsData);
        sessionStorage.setItem('appsData', JSON.stringify(appsData));
      } catch (error) {
        console.error('Error loading apps:', error);
        setError(`Failed to load apps: ${error.message}`);
        setNumaApps([]);
      } finally {
        setLoading(false);
      }
    };

    fetchApps();
  }, [setError, setLoading, setNumaApps]);

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
            {error && (
              <Col xs={12}>
                <Alert variant="danger" data-testid="error-message">
                  {error}
                </Alert>
              </Col>
            )}
            {loading ? (
              <Preloader />
            ) : (
              <>
                {!error &&
                  Array.isArray(numaApps) &&
                  numaApps?.map((app) => (
                    <Col key={app.id} lg={6} className="flex">
                      <div
                        className="card card-apps"
                        data-testid={`app-card-${app.id}`}
                      >
                        <a href={`/app/${app.id}`} rel="noopener">
                          <div className="card-header">
                            <Row>
                              <Col lg={9} data-testid="app-name">
                                {app?.appName}
                              </Col>
                              <Col lg={3} className="right">
                                {app?.appVersion && (
                                  <label data-testid="app-version">
                                    v{app?.appVersion}
                                  </label>
                                )}
                              </Col>
                            </Row>
                          </div>
                          <div
                            className="card-body"
                            data-testid="app-description"
                          >
                            {app?.appDescription === 'Loading...' ? (
                              <Preloader smallscreen={true} />
                            ) : (
                              <>{app?.appDescription}</>
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
                                <div
                                  className="badge-status comingsoon right"
                                  data-testid="app-status"
                                >
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
