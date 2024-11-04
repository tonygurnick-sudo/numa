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

  const [libraryApps, setLibraryApps] = useState([]);
  const [displayApps, setDisplayApps] = useState([]);

  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const APPLICATION_ID = '2594236d-712a-4355-8b0e-6a4cef023f75';

  const fetchLibItems = async () => {
    if (!qAppsClient || authLoading) return;

    // Get lib apps
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
    fetchLibItems();
  }, []);

  const fetchApps = async () => {
    if (!qAppsClient || authLoading) return;

    // Get user appointed apps
    try {
      setLoading(true);
      const input = {
        instanceId: APPLICATION_ID,
      };

      const command = new ListQAppsCommand(input);
      const response = await qAppsClient.send(command);

      // Filter myApps and add a flag
      const uniqueApps = response.apps.map((app) => ({
        ...app,
        isMyApp: libraryApps.some((libApp) => libApp.appID === app.appID),
      }));

      setDisplayApps(uniqueApps);
      //setApps(response.apps);
    } catch (error) {
      console.error('Error fetching Q Apps:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApps();
  }, [libraryApps]);

  const handleCreateApp = async () => {
    if (!qAppsClient || authLoading) return;

    // TODO
    // create a UI form to take in a new app
    const appPayload = '{ToDo}';
    createQApp({ qAppsClient, appPayload, setLoading, setError, setResponse });
  };

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
                  {/* TODO  - create app form UI */}

                  <button
                    type="submit"
                    id="submit"
                    className="btn btn-primary x-5 float-end"
                    onClick={handleCreateApp}
                  >
                    <i className="bi bi-plus-circle me-2"></i>
                    Create New App (deploy demo)
                  </button>
                </>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
            {loading ? (
              <Preloader />
            ) : (
              <>
                {displayApps.map((app) => (
                  <>
                    <Col key={app.appId} lg={4} className="flex">
                      <AppItem
                        key={app.appId}
                        appId={app.appId}
                        instanceId={APPLICATION_ID}
                        qAppsClient={qAppsClient}
                      />
                    </Col>
                  </>
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
