import { useState, useEffect } from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { AppItem } from '../Components/AppItem';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';

import { useAuth } from '../Providers/AuthProvider';
import {
  ListQAppsCommand,
  ListLibraryItemsCommand,
} from '@aws-sdk/client-qapps';

import { createQApp } from '../qAppHelper';

//import appsData from '../Data/appsData.json';

const Dash = () => {
  const { qAppsClient, loading: authLoading } = useAuth();

  const [apps, setApps] = useState([]);
  const [libraryApps, setLibraryApps] = useState([]);

  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const fetchApps = async () => {
    if (!qAppsClient || authLoading) return;

    try {
      setLoading(true);
      const input = {
        instanceId: APPLICATION_ID,
      };

      const command = new ListQAppsCommand(input);
      const response = await qAppsClient.send(command);

      setApps(response.apps);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
    } finally {
      setLoading(false);
    }

    try {
      setLoading(true);
      const input = {
        instanceId: APPLICATION_ID,
      };

      const lib_command = new ListLibraryItemsCommand(input);
      const lib_response = await qAppsClient.send(lib_command);

      setLibraryApps(lib_response.libraryItems);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApps();
  }, []);

  const handleCreateApp = async () => {
    if (!qAppsClient || authLoading) return;

    // TODO
    // create a UI form to take in a new app
    const appPayload = '{ToDo}';
    createQApp(qAppsClient, appPayload, setLoading, setError, setResponse);
  };

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={8} className="px-5">
                <Breadcrumbs clearStack={true} />
                <h1>Numa Apps</h1>
              </Col>
              <Col lg={3} className="p-5">
                <>
                  {/* TODO  - create app form UI */}

                  <button
                    type="submit"
                    id="submit"
                    className="btn btn-primary x-5 float-end"
                    onClick={handleCreateApp}
                  >
                    Create Demo App
                  </button>
                </>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
            {/* DUMMY DATA */}
            {/*  <h6>Dummy data:</h6>
           {appsData.map((app) => (
              <Col key={app.appId} lg={4} className="flex">
                <AppItem appData={app} />
              </Col>
            ))}
            <hr /> */}

            {loading ? (
              <Preloader />
            ) : (
              <>
                {apps.map((app) => (
                  <Col key={app.appId} lg={4} className="flex">
                    <AppItem appData={app} qAppsClient={qAppsClient} />
                  </Col>
                ))}
              </>
            )}

            <h6>Library data:</h6>
            {loading ? (
              <Preloader />
            ) : (
              <>
                {libraryApps.map((app) => (
                  <Col key={app.appId} lg={4} className="flex">
                    <AppItem appData={app} qAppsClient={qAppsClient} />
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
