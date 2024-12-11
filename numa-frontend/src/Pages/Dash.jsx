import { useState, useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';
import { QAppCreate } from '../Components/QAppCreate';
import { AppItem } from '../Components/AppItem';

import { useNumaApp } from '../Providers/NumaAppProvider';
import { useAuth } from '../Providers/AuthProvider';
import { fetchApps } from '../qAppHelper';

const Dash = () => {
  const { error, setError, loading, setLoading, setNumaApps, numaApps } =
    useNumaApp();
  const { qAppsClient } = useAuth();
  const [qApps, setQApps] = useState([]);
  const [qAppsLoading, setQAppsLoading] = useState(false);
  const [qAppsError, setQAppsError] = useState(null);

  console.log('Dash Component Data:', { error, loading, numaApps }); // Debug log

  useEffect(() => {
    const fetchAppsFromManifest = async () => {
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

    fetchAppsFromManifest();
  }, [setError, setLoading, setNumaApps]);

  // New effect for fetching Q Apps
  useEffect(() => {
    const loadQApps = async () => {
      if (!qAppsClient) return;

      setQAppsLoading(true);
      try {
        const apps = await fetchApps(qAppsClient);
        if (apps) {
          setQApps(apps);
        }
      } catch (error) {
        console.error('Error loading Q Apps:', error);
        setQAppsError(error.message);
      } finally {
        setQAppsLoading(false);
      }
    };

    loadQApps();
  }, [qAppsClient]);

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={9} className="pe-5">
              <Breadcrumbs label={'Dashboard'} />
                <h1>Numa & Q Library</h1>
              </Col>
              <Col lg={3} className="ps-5">
                <>
                  <QAppCreate />
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
                    <AppItem key={app.id} app={app} />
                  ))}

                {/* Q Apps Section */}
                {/* <Col xs={12}>
                  <h2 className="mt-4">Q Apps</h2>
                  {qAppsError && (
                    <Alert variant="danger" className="my-3">
                      Error loading Q Apps: {qAppsError}
                    </Alert>
                  )}
                  {qAppsLoading ? (
                    <Preloader />
                  ) : (
                    <Row>
                      {qApps?.map((app) => (
                        <Col key={app.id} lg={6} className="flex">
                          <div className="card card-apps">
                            <div className="card-header">
                              <Row>
                                <Col lg={9}>{app?.title}</Col>
                                <Col lg={3} className="right">
                                  <label>v{app?.version || '1.0'}</label>
                                </Col>
                              </Row>
                            </div>
                            <div className="card-body">
                              {app?.description}
                            </div>
                            <div className="card-footer">
                              <Row className="justify-content-end">
                                <Col>
                                  <div className="tooltip clear"></div>
                                </Col>
                                <Col>
                                  <div className="badge-status active right">
                                    Active
                                  </div>
                                </Col>
                              </Row>
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  )}
                </Col> */}
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
